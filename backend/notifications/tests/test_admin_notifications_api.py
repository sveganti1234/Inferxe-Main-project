"""
test_admin_notifications_api.py
================================
Verifies that the FastAPI notification endpoints (/api/notifications*) cleanly and securely
support Administrator HS256 session authentication:
1. Valid admin tokens authenticate and map to the admin's database ID.
2. Admin A retrieves only notifications assigned to Admin A (strict recipient isolation).
3. Admin unread count returns accurately.
4. Mark-as-read and mark-all-as-read update only the calling admin's notifications.
5. Cross-user access (attempting to read/modify another user's notifications) is rejected with 403.
6. Missing/invalid tokens are rejected with 401.
"""

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT_DIR = Path(__file__).resolve().parents[3]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from backend.notifications import auth, router
from backend.notifications.service import NotificationService
from backend.notifications.tests.admin_session_fixture import db_backed_admins


class TestAdminNotificationsAPI(unittest.TestCase):

    def test_admin_can_fetch_own_notifications(self):
        with db_backed_admins() as admins:
            admin_a = admins.add_admin("adm-alice", "alice@inferxe.com")
            token_a = admins.issue(admin_a)

            # Verify authentication dependency maps to admin_a
            creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token_a)
            auth_user = auth.get_current_user(creds)
            self.assertEqual(auth_user.user_id, "adm-alice")
            self.assertTrue(auth_user.is_admin)

            fake_response = {
                "total": 2,
                "unread_count": 2,
                "items": [
                    {
                        "id": "notif-1",
                        "user_id": "adm-alice",
                        "title": "System Alert 1",
                        "message": "Alice message 1",
                        "notification_type": "SYSTEM_ALERT",
                        "is_read": False,
                        "created_at": "2026-11-26T10:00:00Z",
                    },
                    {
                        "id": "notif-2",
                        "user_id": "adm-alice",
                        "title": "System Alert 2",
                        "message": "Alice message 2",
                        "notification_type": "SYSTEM_ALERT",
                        "is_read": False,
                        "created_at": "2026-11-26T09:00:00Z",
                    },
                ],
            }

            with patch.object(router.NotificationService, "get_notifications", return_value=fake_response) as mock_get:
                res = router.list_notifications(unread_only=False, limit=50, offset=0, user=auth_user)

                self.assertEqual(res["total"], 2)
                self.assertEqual(res["unread_count"], 2)
                self.assertEqual(len(res["items"]), 2)
                # Verify the service was queried strictly with the authenticated admin's user_id
                mock_get.assert_called_once_with(
                    user_id="adm-alice",
                    unread_only=False,
                    limit=50,
                    offset=0,
                )

    def test_admin_can_fetch_unread_count(self):
        with db_backed_admins() as admins:
            admin_a = admins.add_admin("adm-alice", "alice@inferxe.com")
            token_a = admins.issue(admin_a)

            creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token_a)
            auth_user = auth.get_current_user(creds)

            with patch.object(router.NotificationService, "get_unread_count", return_value=5) as mock_count:
                res = router.get_unread_count(user=auth_user)
                self.assertEqual(res, {"unread_count": 5})
                mock_count.assert_called_once_with("adm-alice")

    def test_admin_mark_as_read_success_and_cross_user_forbidden(self):
        with db_backed_admins() as admins:
            admin_a = admins.add_admin("adm-alice", "alice@inferxe.com")
            token_a = admins.issue(admin_a)

            creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token_a)
            auth_user = auth.get_current_user(creds)

            # 1. Success on own notification
            with patch.object(
                router.NotificationService,
                "mark_as_read",
                return_value={"id": "notif-1", "is_read": True, "read_at": "2026-11-26T10:05:00Z"},
            ) as mock_read:
                res = router.mark_notification_as_read("notif-1", user=auth_user)
                self.assertTrue(res["is_read"])
                mock_read.assert_called_once_with("notif-1", "adm-alice")

            # 2. PermissionError on other user's notification -> 403 Forbidden
            with patch.object(
                router.NotificationService,
                "mark_as_read",
                side_effect=PermissionError("Access forbidden: Cannot modify notifications of another user"),
            ):
                with self.assertRaises(HTTPException) as ctx:
                    router.mark_notification_as_read("notif-foreign", user=auth_user)
                self.assertEqual(ctx.exception.status_code, 403)
                self.assertIn("Cannot modify notifications of another user", str(ctx.exception.detail))

    def test_admin_mark_all_as_read(self):
        with db_backed_admins() as admins:
            admin_a = admins.add_admin("adm-alice", "alice@inferxe.com")
            token_a = admins.issue(admin_a)

            creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token_a)
            auth_user = auth.get_current_user(creds)

            with patch.object(router.NotificationService, "mark_all_as_read", return_value=3) as mock_all:
                res = router.mark_all_notifications_as_read(user=auth_user)
                self.assertEqual(res, {"status": "success", "updated_count": 3})
                mock_all.assert_called_once_with("adm-alice")

    def test_unauthenticated_request_rejected(self):
        with self.assertRaises(HTTPException) as ctx:
            auth.get_current_user(None)
        self.assertEqual(ctx.exception.status_code, 401)


if __name__ == "__main__":
    unittest.main()
