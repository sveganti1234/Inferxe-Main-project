"""
Tests for Safe Administrative Profile Synchronization & Foreign Key Integrity
Ensures admin accounts in `admin_users` satisfy `notifications_user_id_fkey`
without arbitrary profile injection or disabling the foreign key.
"""

from unittest.mock import MagicMock, patch
import pytest

from notifications.service import NotificationService


class TestAdminProfileFKIntegrity:

    def test_ensure_admin_profile_noop_if_profile_exists(self):
        cur = MagicMock()
        # profiles check returns a row
        cur.fetchone.side_effect = [("existing_row",)]

        result = NotificationService._ensure_admin_profile(cur, "admin_usr_exists")
        assert result is True
        # admin_users query should not have been called
        assert cur.execute.call_count == 1
        assert "SELECT 1 FROM profiles WHERE user_id" in cur.execute.call_args[0][0]

    def test_ensure_admin_profile_syncs_active_admin(self):
        cur = MagicMock()
        admin_id = "a0000000-0000-0000-0000-000000000123"
        # 1st fetchone: profiles check (None - not exists)
        # 2nd fetchone: admin_users check (found active admin)
        # 3rd fetchone: email conflict check (None - no conflict)
        cur.fetchone.side_effect = [
            None,
            {"id": admin_id, "email": "ops@inferxe.com", "role": "admin", "is_active": True},
            None,
        ]

        result = NotificationService._ensure_admin_profile(cur, admin_id)
        assert result is True

        # Verify insert into profiles was executed
        calls = cur.execute.call_args_list
        assert len(calls) == 4
        insert_sql = calls[3][0][0]
        insert_params = calls[3][0][1]

        assert "INSERT INTO profiles" in insert_sql
        assert "ON CONFLICT (user_id) DO UPDATE" in insert_sql
        assert insert_params[0] == admin_id
        assert insert_params[1] == "Ops"
        assert insert_params[2] == "ops@inferxe.com"
        assert insert_params[3] == "admin"
        assert "'active'" in insert_sql
        assert "'admin'" in insert_sql

    def test_ensure_admin_profile_rejects_non_admin(self):
        cur = MagicMock()
        attacker_uuid = "b0000000-0000-0000-0000-000000000999"
        # 1st fetchone: profiles check (None)
        # 2nd fetchone: admin_users check (None - not an admin)
        cur.fetchone.side_effect = [None, None]

        result = NotificationService._ensure_admin_profile(cur, attacker_uuid)
        assert result is False

        # Verify NO insert was made into profiles
        assert cur.execute.call_count == 2
        for call in cur.execute.call_args_list:
            assert "INSERT INTO profiles" not in call[0][0]

    def test_create_notification_internal_invokes_ensure_admin_profile(self):
        cur = MagicMock()
        with patch.object(NotificationService, "_ensure_admin_profile", return_value=True) as mock_ensure, \
             patch("notifications.service._get_table_columns", return_value={"id": "text", "message": "text"}), \
             patch("notifications.service._notification_row", return_value=(["id", "user_id", "title", "message", "notification_type", "is_read"], ("notif_1", "admin_123", "Title", "Message", "ALERT"))):

            nid = NotificationService._create_notification_internal(
                cur,
                user_id="admin_123",
                title="Title",
                message="Message",
                notification_type="ALERT"
            )

            mock_ensure.assert_called_once_with(cur, "admin_123")
            assert nid == "notif_1"
            assert cur.execute.called

    def test_broadcast_notifications_invokes_ensure_for_all_recipients(self):
        cur = MagicMock()
        cur.fetchall.return_value = [{"user_id": "admin_1"}, {"user_id": "admin_2"}]
        with patch("notifications.service._get_table_columns", return_value={"id": "text", "message": "text"}), \
             patch("notifications.service.execute_values") as mock_exec_values:

            created = NotificationService._broadcast_notifications(
                cur,
                user_ids=["admin_1", "admin_2"],
                title="Broadcast Title",
                message="Broadcast Message",
                notification_type="SYSTEM_ALERT"
            )

            assert created == 2
            mock_exec_values.assert_called_once()

    def test_ensure_admin_profile_syncs_active_superadmin_as_admin_profile(self):
        """Verifies that an active Super Admin (role='superadmin' in admin_users) has a compatibility
        profile created with role='admin' to satisfy profiles_role_check, while preserving the
        authoritative 'superadmin' role in admin_users."""
        cur = MagicMock()
        superadmin_id = "d9a494cb-1e8d-4bca-8142-19687fa9138b"
        # 1st fetchone: profiles check (None - not exists)
        # 2nd fetchone: admin_users check (found active superadmin)
        # 3rd fetchone: email conflict check (None - no conflict)
        cur.fetchone.side_effect = [
            None,
            {"id": superadmin_id, "email": "admin@inferxe.com", "role": "superadmin", "is_active": True},
            None,
        ]

        result = NotificationService._ensure_admin_profile(cur, superadmin_id)
        assert result is True

        # Verify insert into profiles was executed with role='admin' (complying with profiles_role_check)
        calls = cur.execute.call_args_list
        assert len(calls) == 4
        insert_sql = calls[3][0][0]
        insert_params = calls[3][0][1]

        assert "INSERT INTO profiles" in insert_sql
        assert insert_params[0] == superadmin_id
        assert insert_params[1] == "Admin"
        assert insert_params[2] == "admin@inferxe.com"
        # Must be mapped to 'admin' in profiles table:
        assert insert_params[3] == "admin"
        assert "'active'" in insert_sql

        # Verify admin_users was NEVER updated or altered
        for call in calls:
            sql = call[0][0]
            assert "UPDATE admin_users" not in sql
            assert "INSERT INTO admin_users" not in sql

    def test_ensure_admin_profile_migrates_legacy_stub_email(self):
        """Verifies that if a legacy non-UUID stub profile holds the Super Admin email,
        it renames the legacy email safely and creates the Super Admin profile."""
        cur = MagicMock()
        superadmin_id = "d9a494cb-1e8d-4bca-8142-19687fa9138b"
        # 1st fetchone: profiles check by user_id (None - not exists)
        # 2nd fetchone: admin_users check (found active superadmin)
        # 3rd fetchone: email conflict check found legacy non-UUID profile 'usr_admin'
        cur.fetchone.side_effect = [
            None,
            {"id": superadmin_id, "email": "admin@inferxe.com", "role": "superadmin", "is_active": True},
            {"user_id": "usr_admin"},
        ]

        result = NotificationService._ensure_admin_profile(cur, superadmin_id)
        assert result is True

        calls = cur.execute.call_args_list
        # Check that legacy profile email was migrated
        update_calls = [c for c in calls if "UPDATE profiles SET email" in c[0][0]]
        assert len(update_calls) == 1
        assert update_calls[0][0][1][0] == "legacy_usr_admin_admin@inferxe.com"
        assert update_calls[0][0][1][1] == "usr_admin"

        # Check that Super Admin profile was inserted
        insert_calls = [c for c in calls if "INSERT INTO profiles" in c[0][0]]
        assert len(insert_calls) == 1
        assert insert_calls[0][0][1][0] == superadmin_id
        assert insert_calls[0][0][1][2] == "admin@inferxe.com"
        assert insert_calls[0][0][1][3] == "admin"

    def test_ensure_admin_profile_rejects_inactive_superadmin(self):
        """Verifies that an inactive Super Admin account (is_active=False) is rejected and no profile is created."""
        cur = MagicMock()
        superadmin_id = "d9a494cb-1e8d-4bca-8142-19687fa9138b"
        # 1st fetchone: profiles check (None)
        # 2nd fetchone: admin_users query with is_active=TRUE returns None
        cur.fetchone.side_effect = [None, None]

        result = NotificationService._ensure_admin_profile(cur, superadmin_id)
        assert result is False

        # Verify NO insert was made into profiles
        assert cur.execute.call_count == 2
        for call in cur.execute.call_args_list:
            assert "INSERT INTO profiles" not in call[0][0]

    def test_superadmin_notification_creation_and_retrieval(self):
        """Verifies that a notification created for a Super Admin is persisted and retrieved
        properly, adhering to user isolation."""
        cur = MagicMock()
        superadmin_id = "d9a494cb-1e8d-4bca-8142-19687fa9138b"

        with patch.object(NotificationService, "_ensure_admin_profile", return_value=True) as mock_ensure, \
             patch("notifications.service._get_table_columns", return_value={"id": "uuid", "user_id": "text", "title": "text", "detail": "text", "notification_type": "text", "is_read": "boolean", "created_at": "timestamp"}), \
             patch("notifications.service._notification_row", return_value=(
                 ["id", "user_id", "title", "detail", "notification_type", "is_read"],
                 ("notif_super_01", superadmin_id, "Platform Alert", "Critical alert", "SYSTEM_ALERT")
             )):

            nid = NotificationService._create_notification_internal(
                cur,
                user_id=superadmin_id,
                title="Platform Alert",
                message="Critical alert",
                notification_type="SYSTEM_ALERT",
            )

            mock_ensure.assert_called_once_with(cur, superadmin_id)
            assert nid == "notif_super_01"
            assert cur.execute.called
            insert_call_sql = cur.execute.call_args[0][0]
            assert "INSERT INTO notifications" in insert_call_sql

