import json
import os
import subprocess
import sys
import time
import unittest
import urllib.error
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

import jwt
from fastapi import HTTPException

ROOT_DIR = Path(__file__).resolve().parents[3]
BACKEND_DIR = ROOT_DIR / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from notifications import auth as notif_auth

TEST_SECRET = "cross-service-test-admin-session-secret-with-32-plus-chars"
TEST_SUPABASE_URL = "https://example.supabase.co"
TEST_SB_SECRET_KEY = "sb_secret_unit_test_service_role_key_1234567890"
SUPERADMIN_ID = "d9a494cb-1e8d-4bca-8142-19687fa9138b"
SUPERADMIN_EMAIL = "admin@inferxe.com"
DEV_ADMIN_ID = "11111111-1111-4111-8111-111111111111"
DEV_ADMIN_EMAIL = "dev@inferxe.com"


def _make_hs256_token(
    *,
    sub=SUPERADMIN_ID,
    sid="sess-active-001",
    sv=1,
    email=SUPERADMIN_EMAIL,
    role="superadmin",
    secret=TEST_SECRET,
    exp_offset=3600,
    iat_offset=0,
    headers=None,
    omit_claims=(),
):
    now = int(time.time())
    payload = {
        "sub": sub,
        "sid": sid,
        "sv": sv,
        "email": email,
        "role": role,
        "iat": now + iat_offset,
        "exp": now + exp_offset,
    }
    for claim in omit_claims:
        payload.pop(claim, None)
    return jwt.encode(payload, secret, algorithm="HS256", headers=headers or {"typ": "JWT"})


def _json_resp(status_code, data):
    return status_code, json.dumps(data)


class TestNotificationsAdminAuthHardening(unittest.TestCase):
    def _base_env(self, extra=None):
        env = {
            "ADMIN_SESSION_SECRET": TEST_SECRET,
            "SUPABASE_URL": TEST_SUPABASE_URL,
            "SUPABASE_SERVICE_ROLE_KEY": TEST_SB_SECRET_KEY,
        }
        if extra:
            env.update(extra)
        return env

    def _active_supabase_get(
        self,
        captured,
        *,
        session_row=None,
        admin_row=None,
        missing_role_column=False,
        session_status=200,
        admin_status=200,
    ):
        future_iso = (datetime.now(timezone.utc) + timedelta(hours=6)).isoformat()
        default_session = {
            "id": "sess-active-001",
            "admin_user_id": SUPERADMIN_ID,
            "session_version": 1,
            "expires_at": future_iso,
            "revoked_at": None,
        }
        default_admin = {
            "id": SUPERADMIN_ID,
            "email": SUPERADMIN_EMAIL,
            "role": "superadmin",
            "is_active": True,
            "session_version": 1,
        }
        s_row = default_session if session_row is None else session_row
        a_row = default_admin if admin_row is None else admin_row

        def fake_get(url, headers, params):
            captured.append({"url": url, "headers": dict(headers or {}), "params": dict(params or {})})
            if url.endswith("/rest/v1/admin_sessions"):
                if session_status != 200:
                    return _json_resp(session_status, {"message": "db error"})
                return _json_resp(200, [] if s_row == [] else [s_row])

            if url.endswith("/rest/v1/admin_users"):
                if missing_role_column and "role" in params.get("select", ""):
                    return _json_resp(
                        400,
                        {"code": "42703", "message": "column admin_users.role does not exist"},
                    )
                if admin_status != 200:
                    return _json_resp(admin_status, {"message": "db error"})
                if a_row == []:
                    return _json_resp(200, [])
                row_copy = dict(a_row)
                if missing_role_column:
                    row_copy.pop("role", None)
                return _json_resp(200, [row_copy])

            return _json_resp(404, {"message": "not found"})

        return fake_get

    def test_dev_bypass_tokens_are_rejected(self):
        for fake_token in ("ix-tok-12345", "ix-admin-dev", "admin-dev-token"):
            with self.assertRaises(HTTPException) as ctx:
                notif_auth.verify_cognito_jwt(fake_token)
            self.assertEqual(ctx.exception.status_code, 401)

    def test_hs256_fails_closed_without_configured_secret(self):
        token = _make_hs256_token()
        with patch.dict(os.environ, self._base_env({"ADMIN_SESSION_SECRET": ""}), clear=False):
            with self.assertRaises(HTTPException) as ctx:
                notif_auth.verify_cognito_jwt(token)
            self.assertEqual(ctx.exception.status_code, 503)

    def test_hs256_requires_typ_jwt_and_sid_and_sv_claims(self):
        with patch.dict(os.environ, self._base_env(), clear=False):
            # Missing sid
            no_sid = _make_hs256_token(omit_claims=("sid",))
            with self.assertRaises(HTTPException) as ctx:
                notif_auth.verify_cognito_jwt(no_sid)
            self.assertEqual(ctx.exception.status_code, 401)

            # Missing sv
            no_sv = _make_hs256_token(omit_claims=("sv",))
            with self.assertRaises(HTTPException) as ctx:
                notif_auth.verify_cognito_jwt(no_sv)
            self.assertEqual(ctx.exception.status_code, 401)

            # Wrong typ header
            wrong_typ = _make_hs256_token(headers={"typ": "at+jwt"})
            with self.assertRaises(HTTPException) as ctx:
                notif_auth.verify_cognito_jwt(wrong_typ)
            self.assertEqual(ctx.exception.status_code, 401)

            # Customer role in HS256 rejected
            customer_hs256 = _make_hs256_token(role="customer")
            with self.assertRaises(HTTPException) as ctx:
                notif_auth.verify_cognito_jwt(customer_hs256)
            self.assertEqual(ctx.exception.status_code, 401)

    def test_valid_active_session_uses_sb_secret_headers_and_authoritative_db_role(self):
        captured = []
        # Token claims role='admin' & stale email, DB says superadmin & canonical email
        token = _make_hs256_token(role="admin", email="stale@inferxe.com")
        fake_get = self._active_supabase_get(captured)

        with patch.dict(os.environ, self._base_env({"ADMIN_SESSION_SECRET": f"  {TEST_SECRET}  "}), clear=False):
            with patch.object(notif_auth, "_supabase_rest_get", side_effect=fake_get):
                user = notif_auth.verify_cognito_jwt(token)

        self.assertTrue(user.is_admin)
        self.assertEqual(user.user_id, SUPERADMIN_ID)
        self.assertEqual(user.email, SUPERADMIN_EMAIL)
        self.assertIn("superadmin", user.roles)
        self.assertEqual(user.claims["role"], "superadmin")
        # Verify sb_secret_* key was sent in apikey header only (no Bearer Authorization)
        self.assertEqual(len(captured), 2)
        for req in captured:
            self.assertEqual(req["headers"].get("apikey"), TEST_SB_SECRET_KEY)
            self.assertNotIn("Authorization", req["headers"])

    def test_revoked_session_after_nodejs_logout_is_immediately_rejected(self):
        captured = []
        token = _make_hs256_token()
        future_iso = (datetime.now(timezone.utc) + timedelta(hours=6)).isoformat()
        revoked_session = {
            "id": "sess-active-001",
            "admin_user_id": SUPERADMIN_ID,
            "session_version": 1,
            "expires_at": future_iso,
            "revoked_at": datetime.now(timezone.utc).isoformat(),
        }
        fake_get = self._active_supabase_get(captured, session_row=revoked_session)

        with patch.dict(os.environ, self._base_env(), clear=False):
            with patch.object(notif_auth, "_supabase_rest_get", side_effect=fake_get):
                with self.assertRaises(HTTPException) as ctx:
                    notif_auth.verify_cognito_jwt(token)
        self.assertEqual(ctx.exception.status_code, 401)
        self.assertIn("revoked", ctx.exception.detail.lower())

    def test_expired_db_session_is_rejected(self):
        captured = []
        token = _make_hs256_token()
        past_iso = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
        expired_session = {
            "id": "sess-active-001",
            "admin_user_id": SUPERADMIN_ID,
            "session_version": 1,
            "expires_at": past_iso,
            "revoked_at": None,
        }
        fake_get = self._active_supabase_get(captured, session_row=expired_session)

        with patch.dict(os.environ, self._base_env(), clear=False):
            with patch.object(notif_auth, "_supabase_rest_get", side_effect=fake_get):
                with self.assertRaises(HTTPException) as ctx:
                    notif_auth.verify_cognito_jwt(token)
        self.assertEqual(ctx.exception.status_code, 401)
        self.assertIn("expired", ctx.exception.detail.lower())

    def test_deactivated_admin_and_version_mismatch_are_rejected(self):
        captured = []
        token = _make_hs256_token(sub=DEV_ADMIN_ID, email=DEV_ADMIN_EMAIL, role="admin", sv=1)
        future_iso = (datetime.now(timezone.utc) + timedelta(hours=6)).isoformat()
        dev_session = {
            "id": "sess-active-001",
            "admin_user_id": DEV_ADMIN_ID,
            "session_version": 1,
            "expires_at": future_iso,
            "revoked_at": None,
        }

        # 1. Deactivated account (is_active = False)
        inactive_admin = {
            "id": DEV_ADMIN_ID,
            "email": DEV_ADMIN_EMAIL,
            "role": "admin",
            "is_active": False,
            "session_version": 2,
        }
        fake_get_inactive = self._active_supabase_get(
            captured,
            session_row=dev_session,
            admin_row=inactive_admin,
        )
        with patch.dict(os.environ, self._base_env(), clear=False):
            with patch.object(notif_auth, "_supabase_rest_get", side_effect=fake_get_inactive):
                with self.assertRaises(HTTPException) as ctx:
                    notif_auth.verify_cognito_jwt(token)
        self.assertEqual(ctx.exception.status_code, 401)

        # 2. Reactivated account with bumped session_version = 2 -> old sv=1 token still rejected
        reactivated_admin = {
            "id": DEV_ADMIN_ID,
            "email": DEV_ADMIN_EMAIL,
            "role": "admin",
            "is_active": True,
            "session_version": 2,
        }
        fake_get_bumped = self._active_supabase_get(
            captured,
            session_row=dev_session,
            admin_row=reactivated_admin,
        )
        with patch.dict(os.environ, self._base_env(), clear=False):
            with patch.object(notif_auth, "_supabase_rest_get", side_effect=fake_get_bumped):
                with self.assertRaises(HTTPException) as ctx:
                    notif_auth.verify_cognito_jwt(token)
        self.assertEqual(ctx.exception.status_code, 401)
        self.assertIn("invalidated", ctx.exception.detail.lower())

    def test_pre_migration_missing_role_column_compatibility(self):
        captured = []
        super_token = _make_hs256_token(sub=SUPERADMIN_ID, email=SUPERADMIN_EMAIL, role="superadmin")
        fake_get_super = self._active_supabase_get(captured, missing_role_column=True)

        with patch.dict(os.environ, self._base_env(), clear=False):
            with patch.object(notif_auth, "_supabase_rest_get", side_effect=fake_get_super):
                user = notif_auth.verify_cognito_jwt(super_token)
        self.assertEqual(user.user_id, SUPERADMIN_ID)
        self.assertIn("superadmin", user.roles)

        # Any other account resolves strictly to 'admin' even if JWT claimed superadmin
        dev_token = _make_hs256_token(sub=DEV_ADMIN_ID, email=DEV_ADMIN_EMAIL, role="superadmin")
        future_iso = (datetime.now(timezone.utc) + timedelta(hours=6)).isoformat()
        fake_get_dev = self._active_supabase_get(
            captured,
            session_row={
                "id": "sess-active-001",
                "admin_user_id": DEV_ADMIN_ID,
                "session_version": 1,
                "expires_at": future_iso,
                "revoked_at": None,
            },
            admin_row={
                "id": DEV_ADMIN_ID,
                "email": DEV_ADMIN_EMAIL,
                "is_active": True,
                "session_version": 1,
            },
            missing_role_column=True,
        )
        with patch.dict(os.environ, self._base_env(), clear=False):
            with patch.object(notif_auth, "_supabase_rest_get", side_effect=fake_get_dev):
                dev_user = notif_auth.verify_cognito_jwt(dev_token)
        self.assertEqual(dev_user.roles, ["admin"])
        self.assertNotIn("superadmin", dev_user.roles)

    def test_fails_closed_503_when_supabase_config_missing_or_db_unavailable(self):
        token = _make_hs256_token()

        # 1. Missing SUPABASE_SERVICE_ROLE_KEY
        with patch.dict(os.environ, self._base_env({"SUPABASE_SERVICE_ROLE_KEY": ""}), clear=False):
            with self.assertRaises(HTTPException) as ctx:
                notif_auth.verify_cognito_jwt(token)
            self.assertEqual(ctx.exception.status_code, 503)

        # 2. Invalid publishable key
        with patch.dict(os.environ, self._base_env({"SUPABASE_SERVICE_ROLE_KEY": "sb_publishable_bad"}), clear=False):
            with self.assertRaises(HTTPException) as ctx:
                notif_auth.verify_cognito_jwt(token)
            self.assertEqual(ctx.exception.status_code, 503)

        # 3. Supabase 500 error
        captured = []
        fake_get_500 = self._active_supabase_get(captured, session_status=500)
        with patch.dict(os.environ, self._base_env(), clear=False):
            with patch.object(notif_auth, "_supabase_rest_get", side_effect=fake_get_500):
                with self.assertRaises(HTTPException) as ctx:
                    notif_auth.verify_cognito_jwt(token)
            self.assertEqual(ctx.exception.status_code, 503)

        # 4. Network error
        def raising_get(*args, **kwargs):
            raise urllib.error.URLError("connection failed")

        with patch.dict(os.environ, self._base_env(), clear=False):
            with patch.object(notif_auth, "_supabase_rest_get", side_effect=raising_get):
                with self.assertRaises(HTTPException) as ctx:
                    notif_auth.verify_cognito_jwt(token)
            self.assertEqual(ctx.exception.status_code, 503)

    def test_cross_service_nodejs_minted_token_verifies_in_python(self):
        """Mint an actual HS256 JWT using Node.js createAdminToken() and verify it in Python."""
        node_script = (
            "import('./backend/auth/adminAuth.js').then(({ createAdminToken }) => {"
            "const now = Math.floor(Date.now() / 1000);"
            f"const tok = createAdminToken({{ sub: '{SUPERADMIN_ID}', sid: 'sess-active-001', sv: 1, "
            f"email: '{SUPERADMIN_EMAIL}', role: 'superadmin', iat: now, exp: now + 3600 }}, "
            f"'  {TEST_SECRET}  ');"
            "process.stdout.write(tok);"
            "})"
        )
        proc = subprocess.run(
            ["node", "-e", node_script],
            cwd=str(ROOT_DIR),
            capture_output=True,
            text=True,
            check=True,
        )
        node_token = proc.stdout.strip()
        self.assertEqual(len(node_token.split(".")), 3)

        captured = []
        fake_get = self._active_supabase_get(captured)
        with patch.dict(os.environ, self._base_env(), clear=False):
            with patch.object(notif_auth, "_supabase_rest_get", side_effect=fake_get):
                user = notif_auth.verify_cognito_jwt(node_token)

        self.assertEqual(user.user_id, SUPERADMIN_ID)
        self.assertEqual(user.email, SUPERADMIN_EMAIL)
        self.assertIn("superadmin", user.roles)


if __name__ == "__main__":
    unittest.main()
