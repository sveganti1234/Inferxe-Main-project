"""
test_admin_gpu_listing_create.py
================================
Unit tests for Admin GPU Listing creation with atomic notification:
1. Successful listing insertion and admin notification in a single transaction.
2. Atomic rollback: if notification broadcast fails, listing insertion is rolled back.
3. Duplicate prevention via idempotency key.
4. Admin authorization guard: customers cannot create GPU listings.
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
from backend.notifications.service import NotificationService


class TestAdminGpuListingCreate:

    def test_process_gpu_listing_create_success(self):
        """Verifies listing and notification are created and committed together."""
        mock_cur = MagicMock()
        mock_conn = MagicMock()
        mock_conn.cursor.return_value = mock_cur

        # Mock outbox duplicate check: not duplicate
        # Mock existing listing check: not existing
        # Mock information_schema for columns: has quantity
        # Mock admin_users lookup: active admin found
        mock_cur.fetchall.side_effect = [
            [{"column_name": "id"}, {"column_name": "name"}, {"column_name": "quantity"}],  # columns
            [{"id": "adm-001"}],  # admin_users
        ]
        mock_cur.fetchone.side_effect = [
            None,  # SELECT id FROM gpu_inventory WHERE id = %s
        ]

        with patch("backend.notifications.service.DBConnection") as mock_db, \
             patch.object(NotificationService, "record_outbox_event", return_value=("evt_001", False)), \
             patch.object(NotificationService, "_ensure_admin_profile", return_value=True), \
             patch.object(NotificationService, "_broadcast_notifications", return_value=1) as mock_broadcast:

            mock_db.return_value.__enter__.return_value = mock_conn

            res = NotificationService.process_gpu_listing_create(
                admin_user_id="adm-001",
                name="NVIDIA L4",
                gpu_model="L4",
                vram="24 GB",
                region="Hyderabad, IN",
                price=60.0,
                listing_id="gpu-test-101",
                quantity=4,
                idempotency_key="idem_create_101",
            )

            assert res["status"] == "success"
            assert res["listing"]["id"] == "gpu-test-101"
            assert res["listing"]["name"] == "NVIDIA L4"
            assert res["listing"]["price"] == 60.0
            assert res["listing"]["quantity"] == 4
            assert res["admin_notifications_created"] == 1

            # Verify broadcast was called with GPU_LISTING_CREATED and related_entity_id
            mock_broadcast.assert_called_once()
            call_kwargs = mock_broadcast.call_args[1]
            assert call_kwargs["notification_type"] == "GPU_LISTING_CREATED"
            assert call_kwargs["related_entity_id"] == "gpu-test-101"
            assert "NVIDIA L4" in call_kwargs["message"]

            # Verify transaction commit was called
            mock_conn.commit.assert_called_once()

    def test_process_gpu_listing_create_rollback_on_notification_failure(self):
        """
        Requirement 1: If notification creation fails, roll back the listing too.
        Ensures we never leave a listing persisted without its notification.
        """
        mock_cur = MagicMock()
        mock_conn = MagicMock()
        mock_conn.cursor.return_value = mock_cur

        mock_cur.fetchall.side_effect = [
            [{"column_name": "id"}, {"column_name": "name"}, {"column_name": "quantity"}],
            [{"id": "adm-001"}],
        ]
        mock_cur.fetchone.side_effect = [None]

        with patch("backend.notifications.service.DBConnection") as mock_db, \
             patch.object(NotificationService, "record_outbox_event", return_value=("evt_001", False)), \
             patch.object(NotificationService, "_ensure_admin_profile", return_value=True), \
             patch.object(NotificationService, "_broadcast_notifications", side_effect=RuntimeError("Notification write failed")):

            mock_db.return_value.__enter__.return_value = mock_conn

            # The exception must bubble up so DBConnection __exit__ rolls back
            with pytest.raises(RuntimeError, match="Notification write failed"):
                NotificationService.process_gpu_listing_create(
                    admin_user_id="adm-001",
                    name="NVIDIA H100",
                    gpu_model="H100",
                    vram="80 GB",
                    region="Mumbai, IN",
                    price=250.0,
                    listing_id="gpu-fail-102",
                )

            # Transaction must NOT have been committed
            mock_conn.commit.assert_not_called()

    def test_process_gpu_listing_create_idempotency_duplicate_prevented(self):
        """
        Requirement 3: Ensure idempotency prevents duplicate listings and notifications.
        """
        mock_cur = MagicMock()
        mock_conn = MagicMock()
        mock_conn.cursor.return_value = mock_cur

        with patch("backend.notifications.service.DBConnection") as mock_db, \
             patch.object(NotificationService, "record_outbox_event", return_value=("evt_dup_001", True)), \
             patch.object(NotificationService, "_broadcast_notifications") as mock_broadcast:

            mock_db.return_value.__enter__.return_value = mock_conn

            res = NotificationService.process_gpu_listing_create(
                admin_user_id="adm-001",
                name="NVIDIA L4",
                gpu_model="L4",
                vram="24 GB",
                region="Hyderabad, IN",
                price=60.0,
                listing_id="gpu-test-101",
                idempotency_key="idem_duplicate_key",
            )

            assert res["status"] == "skipped"
            assert "Duplicate listing creation event ignored" in res["message"]
            # No notification broadcast executed
            mock_broadcast.assert_not_called()
            # Transaction was rolled back
            mock_conn.rollback.assert_called_once()
            mock_conn.commit.assert_not_called()

    def test_customer_user_forbidden_from_creating_listing(self):
        """
        Requirement 2: Customers cannot create GPU listings.
        """
        customer_user = auth.AuthenticatedUser(
            user_id="cust-123",
            email="customer@example.com",
            roles=["customer"],
            claims={},
        )

        with pytest.raises(HTTPException) as exc_info:
            auth.require_admin_user(customer_user)

        assert exc_info.value.status_code == 403
        assert "Admin privileges required" in str(exc_info.value.detail)
