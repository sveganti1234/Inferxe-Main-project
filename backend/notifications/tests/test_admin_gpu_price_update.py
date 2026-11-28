"""
test_admin_gpu_price_update.py
==============================
Unit tests for Admin GPU Price Update with atomic notification:
1. Successful price update and admin audit alert in a single transaction.
2. Safe admin profile handling: non-UUID customer IDs are never queried against admin_users.
3. Broadcast notifications: customers do not trigger _ensure_admin_profile.
4. Duplicate prevention via idempotency key.
5. Admin authorization guard: customers cannot call update-price endpoint.
"""

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch
import pytest

ROOT_DIR = Path(__file__).resolve().parents[3]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from backend.notifications import auth, router
from backend.notifications.service import NotificationService, _is_valid_uuid


class TestAdminGpuPriceUpdate:

    def test_is_valid_uuid_helper(self):
        """Verifies _is_valid_uuid correctly distinguishes UUIDs from strings."""
        assert _is_valid_uuid("ab4948d8-55ed-4448-9d16-8c9801f43dc1") is True
        assert _is_valid_uuid("usr_demo_customer") is False
        assert _is_valid_uuid("12345") is False
        assert _is_valid_uuid(None) is False
        assert _is_valid_uuid("") is False

    def test_ensure_admin_profile_skips_non_uuid(self):
        """Verifies _ensure_admin_profile safely returns False for non-UUID user IDs without executing admin_users query."""
        mock_cur = MagicMock()
        mock_cur.fetchone.return_value = None  # profiles query returns None

        res = NotificationService._ensure_admin_profile(mock_cur, "usr_demo_customer")
        assert res is False
        # Ensure it checked profiles, but NEVER queried admin_users
        executed_sqls = [call[0][0] for call in mock_cur.execute.call_args_list]
        assert any("profiles" in s for s in executed_sqls)
        assert not any("admin_users" in s for s in executed_sqls)

    def test_process_gpu_price_update_success(self):
        """Verifies price update, customer broadcast, and admin audit alert in a transaction."""
        mock_cur = MagicMock()
        mock_conn = MagicMock()
        mock_conn.cursor.return_value = mock_cur

        # Mock existing GPU inventory lookup: NVIDIA L40S at 100/hr
        mock_cur.fetchone.side_effect = [
            {"id": "gpu-101", "name": "NVIDIA L40S", "price": 100.0, "region": "Mumbai, IN"},
        ]
        # Mock users for customer and admin queries
        mock_cur.fetchall.side_effect = [
            [{"id": "usr_cust_01"}, {"id": "usr_cust_02"}],  # customers
            [{"id": "ab4948d8-55ed-4448-9d16-8c9801f43dc1"}],  # admin_users
        ]

        with patch("backend.notifications.service.DBConnection") as mock_db, \
             patch.object(NotificationService, "record_outbox_event", return_value=("evt_price_01", False)), \
             patch.object(NotificationService, "_ensure_admin_profile", return_value=True), \
             patch.object(NotificationService, "_broadcast_notifications", side_effect=[2, 1]) as mock_broadcast:

            mock_db.return_value.__enter__.return_value = mock_conn

            res = NotificationService.process_gpu_price_update(
                admin_user_id="ab4948d8-55ed-4448-9d16-8c9801f43dc1",
                gpu_id="gpu-101",
                new_price=120.0,
                idempotency_key="idem_price_test_01",
            )

            assert res["status"] == "success"
            assert res["gpu_id"] == "gpu-101"
            assert res["old_price"] == 100.0
            assert res["new_price"] == 120.0
            assert res["notifications_created"] == 2
            assert res["admin_notifications_created"] == 1

            # Two broadcasts: 1 for customers (GPU_PRICE_INCREASE), 1 for admins (GPU_PRICE_AUDIT)
            assert mock_broadcast.call_count == 2
            cust_call = mock_broadcast.call_args_list[0][1]
            assert cust_call["notification_type"] == "GPU_PRICE_INCREASE"
            assert cust_call["related_entity_id"] == "gpu-101"

            admin_call = mock_broadcast.call_args_list[1][1]
            assert admin_call["notification_type"] == "GPU_PRICE_AUDIT"
            assert admin_call["related_entity_id"] == "gpu-101"

            mock_conn.commit.assert_called_once()

    def test_process_gpu_price_update_noop_when_identical_price(self):
        """Verifies no-op when new_price equals old_price."""
        mock_cur = MagicMock()
        mock_conn = MagicMock()
        mock_conn.cursor.return_value = mock_cur

        mock_cur.fetchone.return_value = {"id": "gpu-101", "name": "NVIDIA L40S", "price": 100.0, "region": "Mumbai, IN"}

        with patch("backend.notifications.service.DBConnection") as mock_db, \
             patch.object(NotificationService, "record_outbox_event", return_value=("evt_price_noop", False)):

            mock_db.return_value.__enter__.return_value = mock_conn

            res = NotificationService.process_gpu_price_update(
                admin_user_id="adm-001",
                gpu_id="gpu-101",
                new_price=100.0,
                idempotency_key="idem_noop",
            )

            assert res["status"] == "noop"
            assert res["old_price"] == 100.0
            assert res["new_price"] == 100.0
            mock_conn.commit.assert_called_once()

    def test_process_gpu_price_update_duplicate_idempotency(self):
        """Verifies duplicate idempotency keys return skipped."""
        mock_conn = MagicMock()
        with patch("backend.notifications.service.DBConnection") as mock_db, \
             patch.object(NotificationService, "record_outbox_event", return_value=("evt_dup", True)):

            mock_db.return_value.__enter__.return_value = mock_conn

            res = NotificationService.process_gpu_price_update(
                admin_user_id="adm-001",
                gpu_id="gpu-101",
                new_price=150.0,
                idempotency_key="idem_dup",
            )

            assert res["status"] == "skipped"
            mock_conn.rollback.assert_called_once()

    def test_admin_auth_guard_blocks_customer(self):
        """Verifies router.require_admin_user rejects non-admin customers."""
        customer_user = auth.AuthenticatedUser(
            user_id="usr_cust_123",
            email="cust@example.com",
            roles=["customer"],
            claims={},
        )

        with pytest.raises(HTTPException) as exc_info:
            auth.require_admin_user(customer_user)
        assert exc_info.value.status_code == 403
        assert "Admin privileges required" in exc_info.value.detail

    def test_price_update_route_supports_post_put_patch(self):
        """Verifies that the price-update route supports POST, PUT, and PATCH methods to prevent HTTP 405."""
        price_routes = [r for r in router.router.routes if "price-update" in r.path or "update-price" in r.path]
        assert price_routes, "Price update route must be registered in router"
        methods = set.union(*[r.methods for r in price_routes])
        assert "POST" in methods
        assert "PUT" in methods
        assert "PATCH" in methods

    def test_gpu_listing_route_supports_post_put_patch(self):
        """Verifies that the gpu-listing route supports POST, PUT, and PATCH methods to prevent HTTP 405."""
        listing_routes = [r for r in router.router.routes if "gpu-listing" in r.path]
        assert listing_routes, "GPU listing route must be registered in router"
        methods = set.union(*[r.methods for r in listing_routes])
        assert "POST" in methods
        assert "PUT" in methods
        assert "PATCH" in methods

    def test_broadcast_notifications_prefilters_profiles_for_fast_batch(self):
        """Verifies that _broadcast_notifications pre-filters user_ids against profiles before execute_values."""
        mock_cur = MagicMock()
        mock_cur.connection.autocommit = False

        # When queried against profiles, only usr_1 exists, usr_stale does not
        mock_cur.fetchall.return_value = [{"user_id": "usr_1"}]

        with patch("backend.notifications.service._get_table_columns", return_value={"id": "uuid", "user_id": "text", "title": "text", "message": "text", "type": "text", "is_read": "boolean", "created_at": "timestamp"}), \
             patch("backend.notifications.service.execute_values") as mock_exec_val:

            created = NotificationService._broadcast_notifications(
                cur=mock_cur,
                user_ids=["usr_1", "usr_stale"],
                title="Price Change",
                message="New price",
                notification_type="GPU_PRICE_INCREASE",
            )

            # usr_stale was filtered out, only usr_1 was inserted
            assert created == 1
            mock_exec_val.assert_called_once()
            inserted_rows = mock_exec_val.call_args[0][2]
            assert len(inserted_rows) == 1
            assert inserted_rows[0][1] == "usr_1"
