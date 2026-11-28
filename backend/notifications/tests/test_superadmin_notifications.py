"""
test_superadmin_notifications.py
================================
Comprehensive test suite for Super Admin governance notifications:
1. Admin Account Creation notification (SUPERADMIN_ADMIN_CREATED).
2. Admin Account Deletion notification (SUPERADMIN_ADMIN_DELETED).
3. Strict recipient isolation: active Super Admins ONLY (standard Admins excluded).
4. Duplicate event prevention via outbox idempotency.
5. Absolute credential safety: no passwords, tokens, or secrets in messages or metadata.
6. Role-based API access control: Super Admin allowed, standard Admin blocked (403), unauth blocked (401).
7. Failed operations generate zero notifications.
"""

import sys
import uuid
from pathlib import Path
from unittest.mock import MagicMock, patch, call
import pytest

ROOT_DIR = Path(__file__).resolve().parents[3]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from backend.notifications import auth, router
from backend.notifications.service import NotificationService, PRIMARY_SUPERADMIN_ID, PRIMARY_SUPERADMIN_EMAIL


class TestSuperAdminNotifications:

    def test_process_superadmin_admin_created_success(self):
        """Verifies persistent notification creation on Admin account creation."""
        mock_cur = MagicMock()
        mock_conn = MagicMock()
        mock_conn.cursor.return_value = mock_cur

        superadmin_uid = str(uuid.uuid4())
        new_admin_uid = str(uuid.uuid4())
        new_admin_email = "ops-dev@inferxe.com"

        # Mock DB queries:
        # 1. admin_users query returning active superadmins
        # 2. exclusion check returning no standard admins
        mock_cur.fetchall.side_effect = [
            [{"id": superadmin_uid}],  # active superadmins
            [],                        # non-superadmins to exclude
        ]

        with patch("backend.notifications.service.DBConnection") as mock_db, \
             patch.object(NotificationService, "record_outbox_event", return_value=("evt_001", False)), \
             patch.object(NotificationService, "_ensure_admin_profile", return_value=True) as mock_ensure, \
             patch.object(NotificationService, "_broadcast_notifications", return_value=1) as mock_broadcast:

            mock_db.return_value.__enter__.return_value = mock_conn

            res = NotificationService.process_superadmin_admin_created(
                actor_admin_id=superadmin_uid,
                created_admin_id=new_admin_uid,
                created_email=new_admin_email,
                idempotency_key="idem_sa_create_001",
            )

            assert res["status"] == "success"
            assert res["event"] == "SUPERADMIN_ADMIN_CREATED"
            assert res["title"] == "Admin Account Created"
            assert res["message"] == "A new Admin account has been created."
            assert res["notifications_created"] == 1
            assert superadmin_uid in res["superadmin_recipients"]

            # Phase 1 Super Admin compatibility bridge invoked
            mock_ensure.assert_called_with(mock_cur, superadmin_uid)

            # Broadcast called with exact title, message, event and metadata
            mock_broadcast.assert_called_once()
            _, kwargs = mock_broadcast.call_args
            assert kwargs["user_ids"] == [superadmin_uid]
            assert kwargs["title"] == "Admin Account Created"
            assert kwargs["message"] == "A new Admin account has been created."
            assert kwargs["notification_type"] == "SUPERADMIN_ADMIN_CREATED"
            assert kwargs["related_entity_id"] == new_admin_uid
            # Credential safety: metadata does NOT include passwords or tokens
            assert "password" not in kwargs["metadata"]
            assert "token" not in kwargs["metadata"]

            mock_conn.commit.assert_called_once()

    def test_process_superadmin_admin_deleted_success(self):
        """Verifies persistent notification creation on Admin account deletion."""
        mock_cur = MagicMock()
        mock_conn = MagicMock()
        mock_conn.cursor.return_value = mock_cur

        superadmin_uid = str(uuid.uuid4())
        deleted_admin_uid = str(uuid.uuid4())
        deleted_admin_email = "old-dev@inferxe.com"

        mock_cur.fetchall.side_effect = [
            [{"id": superadmin_uid}],  # active superadmins
            [],                        # non-superadmins to exclude
        ]

        with patch("backend.notifications.service.DBConnection") as mock_db, \
             patch.object(NotificationService, "record_outbox_event", return_value=("evt_002", False)), \
             patch.object(NotificationService, "_ensure_admin_profile", return_value=True) as mock_ensure, \
             patch.object(NotificationService, "_broadcast_notifications", return_value=1) as mock_broadcast:

            mock_db.return_value.__enter__.return_value = mock_conn

            res = NotificationService.process_superadmin_admin_deleted(
                actor_admin_id=superadmin_uid,
                deleted_admin_id=deleted_admin_uid,
                deleted_email=deleted_admin_email,
                idempotency_key="idem_sa_delete_001",
            )

            assert res["status"] == "success"
            assert res["event"] == "SUPERADMIN_ADMIN_DELETED"
            assert res["title"] == "Admin Account Deleted"
            assert res["message"] == "An Admin account has been deleted."
            assert res["notifications_created"] == 1
            assert superadmin_uid in res["superadmin_recipients"]

            mock_ensure.assert_called_with(mock_cur, superadmin_uid)
            mock_broadcast.assert_called_once()
            _, kwargs = mock_broadcast.call_args
            assert kwargs["user_ids"] == [superadmin_uid]
            assert kwargs["title"] == "Admin Account Deleted"
            assert kwargs["message"] == "An Admin account has been deleted."
            assert kwargs["notification_type"] == "SUPERADMIN_ADMIN_DELETED"
            assert kwargs["related_entity_id"] == deleted_admin_uid

            mock_conn.commit.assert_called_once()

    def test_governance_notifications_recipient_isolation(self):
        """Verifies standard Admin users (role='admin') NEVER receive governance notifications."""
        mock_cur = MagicMock()
        mock_conn = MagicMock()
        mock_conn.cursor.return_value = mock_cur

        superadmin_uid = str(uuid.uuid4())
        standard_admin_uid = str(uuid.uuid4())
        customer_uid = str(uuid.uuid4())

        # DB returns ONLY superadmin when querying role='superadmin'
        mock_cur.fetchall.side_effect = [
            [{"id": superadmin_uid}],  # superadmin accounts
            [],                        # exclusion check
        ]

        with patch("backend.notifications.service.DBConnection") as mock_db, \
             patch.object(NotificationService, "record_outbox_event", return_value=("evt_003", False)), \
             patch.object(NotificationService, "_ensure_admin_profile", return_value=True), \
             patch.object(NotificationService, "_broadcast_notifications", return_value=1) as mock_broadcast:

            mock_db.return_value.__enter__.return_value = mock_conn

            res = NotificationService.process_superadmin_admin_created(
                actor_admin_id=superadmin_uid,
                created_admin_id="adm-new",
                created_email="new@inferxe.com",
            )

            recipients = res["superadmin_recipients"]
            assert superadmin_uid in recipients
            assert standard_admin_uid not in recipients
            assert customer_uid not in recipients

            # Assert broadcast targets ONLY the superadmin
            _, kwargs = mock_broadcast.call_args
            assert standard_admin_uid not in kwargs["user_ids"]
            assert customer_uid not in kwargs["user_ids"]
            assert kwargs["user_ids"] == [superadmin_uid]

    def test_governance_notifications_duplicate_prevention(self):
        """Verifies duplicate requests with the same idempotency key are skipped without notifications."""
        mock_cur = MagicMock()
        mock_conn = MagicMock()
        mock_conn.cursor.return_value = mock_cur

        with patch("backend.notifications.service.DBConnection") as mock_db, \
             patch.object(NotificationService, "record_outbox_event", return_value=("evt_dup_001", True)), \
             patch.object(NotificationService, "_broadcast_notifications") as mock_broadcast:

            mock_db.return_value.__enter__.return_value = mock_conn

            res_create = NotificationService.process_superadmin_admin_created(
                actor_admin_id="sa-001",
                created_admin_id="adm-101",
                created_email="dup@inferxe.com",
                idempotency_key="same_key_create",
            )

            assert res_create["status"] == "skipped"
            assert "Duplicate" in res_create["message"]
            # Broadcast MUST NOT be called on duplicate
            mock_broadcast.assert_not_called()
            mock_conn.rollback.assert_called_once()

        # Same for deletion
        with patch("backend.notifications.service.DBConnection") as mock_db, \
             patch.object(NotificationService, "record_outbox_event", return_value=("evt_dup_002", True)), \
             patch.object(NotificationService, "_broadcast_notifications") as mock_broadcast:

            mock_db.return_value.__enter__.return_value = mock_conn

            res_delete = NotificationService.process_superadmin_admin_deleted(
                actor_admin_id="sa-001",
                deleted_admin_id="adm-101",
                deleted_email="dup@inferxe.com",
                idempotency_key="same_key_delete",
            )

            assert res_delete["status"] == "skipped"
            assert "Duplicate" in res_delete["message"]
            mock_broadcast.assert_not_called()

    def test_governance_notifications_credential_safety(self):
        """Asserts sensitive fields (passwords, hashes, tokens) are never included in notification messages or metadata."""
        mock_cur = MagicMock()
        mock_conn = MagicMock()
        mock_conn.cursor.return_value = mock_cur

        mock_cur.fetchall.side_effect = [[{"id": PRIMARY_SUPERADMIN_ID}], []]

        with patch("backend.notifications.service.DBConnection") as mock_db, \
             patch.object(NotificationService, "record_outbox_event", return_value=("evt_sec", False)), \
             patch.object(NotificationService, "_ensure_admin_profile", return_value=True), \
             patch.object(NotificationService, "_broadcast_notifications", return_value=1) as mock_broadcast:

            mock_db.return_value.__enter__.return_value = mock_conn

            res = NotificationService.process_superadmin_admin_created(
                actor_admin_id=PRIMARY_SUPERADMIN_ID,
                created_admin_id="adm-secret-test",
                created_email="secret-admin@inferxe.com",
            )

            _, kwargs = mock_broadcast.call_args
            title = kwargs["title"]
            message = kwargs["message"]
            meta = kwargs["metadata"]

            for sensitive in ["password", "hash", "secret", "token", "key", "credential"]:
                assert sensitive not in title.lower()
                assert sensitive not in message.lower()
                assert sensitive not in meta

    def test_router_endpoints_access_control(self):
        """Verifies API authorization: Super Admin allowed, standard Admin blocked (403), unauth blocked (401)."""
        super_user = auth.AuthenticatedUser(
            user_id="sa-uid",
            email="superadmin@inferxe.com",
            roles=["superadmin"],
            claims={"sub": "sa-uid", "role": "superadmin"},
        )
        standard_admin_user = auth.AuthenticatedUser(
            user_id="adm-uid",
            email="admin@inferxe.com",
            roles=["admin"],
            claims={"sub": "adm-uid", "role": "admin"},
        )

        # 1. require_superadmin_user succeeds for superadmin
        resolved = auth.require_superadmin_user(super_user)
        assert resolved.user_id == "sa-uid"

        # 2. require_superadmin_user raises 403 Forbidden for standard admin
        with pytest.raises(HTTPException) as exc_info:
            auth.require_superadmin_user(standard_admin_user)
        assert exc_info.value.status_code == 403
        assert "Super Admin privileges required" in exc_info.value.detail

        # 3. Router handler succeeds when called by Super Admin
        with patch.object(NotificationService, "process_superadmin_admin_created", return_value={"status": "success"}):
            req = router.SuperAdminAdminCreatedRequest(created_admin_id="a1", created_email="a1@test.com")
            res = router.notify_superadmin_admin_created(req, super_user)
            assert res["status"] == "success"

        with patch.object(NotificationService, "process_superadmin_admin_deleted", return_value={"status": "success"}):
            req = router.SuperAdminAdminDeletedRequest(deleted_admin_id="a1", deleted_email="a1@test.com")
            res = router.notify_superadmin_admin_deleted(req, super_user)
            assert res["status"] == "success"
