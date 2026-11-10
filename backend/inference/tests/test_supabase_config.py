"""
test_supabase_config.py
=======================
Configuration and security tests for backend Supabase REST environment loading.
Verifies `backend/.env` path resolution, credential validation, header construction,
secret masking, and protection against Personal Access Tokens or Publishable keys.
"""

import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

BACKEND_DIR = Path(__file__).resolve().parents[2]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from inference.supabase_config import (  # noqa: E402
    BACKEND_ENV_FILE,
    SupabaseConfigurationError,
    SupabaseSettings,
    get_supabase_settings,
    load_backend_env,
)


class TestSupabaseConfig(unittest.TestCase):
    """Test suite for backend/.env loading and SUPABASE_SERVICE_ROLE_KEY validation."""

    def test_backend_env_file_points_to_backend_dotenv(self):
        expected = Path(__file__).resolve().parents[2] / ".env"
        self.assertEqual(BACKEND_ENV_FILE, expected)

    def test_load_backend_env_from_temp_file_respects_override_flag(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            env_path = Path(tmpdir) / ".env"
            env_path.write_text(
                "SUPABASE_URL=https://dummy.supabase.co/\n"
                "SUPABASE_SERVICE_ROLE_KEY=sb_secret_dummy_test_key\n",
                encoding="utf-8",
            )

            with patch.dict(
                os.environ,
                {"SUPABASE_URL": "https://override-wins.supabase.co"},
                clear=True,
            ):
                load_backend_env(env_file=env_path, override=False)
                settings = get_supabase_settings(auto_load=False)
                self.assertEqual(settings.url, "https://override-wins.supabase.co")
                self.assertEqual(settings.service_role_key, "sb_secret_dummy_test_key")

                load_backend_env(env_file=env_path, override=True)
                settings_after_override = get_supabase_settings(auto_load=False)
                self.assertEqual(settings_after_override.url, "https://dummy.supabase.co")

    def test_rejects_personal_access_token_and_publishable_key(self):
        with patch.dict(
            os.environ,
            {
                "SUPABASE_URL": "https://dummy.supabase.co",
                "SUPABASE_SERVICE_ROLE_KEY": "sbp_1234567890abcdef",
            },
            clear=True,
        ):
            with self.assertRaises(SupabaseConfigurationError) as ctx:
                get_supabase_settings(auto_load=False)
            self.assertIn("Personal Access Tokens", str(ctx.exception))

        with patch.dict(
            os.environ,
            {
                "SUPABASE_URL": "https://dummy.supabase.co",
                "SUPABASE_SERVICE_ROLE_KEY": "sb_publishable_1234567890abcdef",
            },
            clear=True,
        ):
            with self.assertRaises(SupabaseConfigurationError) as ctx2:
                get_supabase_settings(auto_load=False)
            self.assertIn("Publishable keys", str(ctx2.exception))

    def test_rejects_placeholder_or_missing_url(self):
        with patch.dict(
            os.environ,
            {
                "SUPABASE_URL": "https://your-project.supabase.co",
                "SUPABASE_SERVICE_ROLE_KEY": "sb_secret_dummy",
            },
            clear=True,
        ):
            with self.assertRaises(SupabaseConfigurationError):
                get_supabase_settings(auto_load=False)

        with patch.dict(
            os.environ,
            {
                "SUPABASE_URL": "ftp://invalid.supabase.co",
                "SUPABASE_SERVICE_ROLE_KEY": "sb_secret_dummy",
            },
            clear=True,
        ):
            with self.assertRaises(SupabaseConfigurationError):
                get_supabase_settings(auto_load=False)

    def test_auth_headers_and_secret_masking(self):
        opaque_settings = SupabaseSettings(
            url="https://dummy.supabase.co",
            service_role_key="sb_secret_top_secret_value",
        )
        opaque_headers = opaque_settings.auth_headers({"Prefer": "return=minimal"})
        self.assertEqual(opaque_headers["apikey"], "sb_secret_top_secret_value")
        self.assertNotIn("Authorization", opaque_headers)
        self.assertEqual(opaque_headers["Prefer"], "return=minimal")
        self.assertEqual(opaque_settings.rest_url("api_keys"), "https://dummy.supabase.co/rest/v1/api_keys")

        jwt_settings = SupabaseSettings(
            url="https://dummy.supabase.co",
            service_role_key="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.dummy.sig",
        )
        jwt_headers = jwt_settings.auth_headers()
        self.assertEqual(jwt_headers["apikey"], jwt_settings.service_role_key)
        self.assertEqual(jwt_headers["Authorization"], f"Bearer {jwt_settings.service_role_key}")

        # Ensure secrets and host refs never leak into repr or masked_summary
        self.assertNotIn("sb_secret_top_secret_value", repr(opaque_settings))
        self.assertNotIn("sb_secret_top_secret_value", str(opaque_settings))
        summary = opaque_settings.masked_summary()
        self.assertEqual(summary, {"configured": True, "scheme": "https", "key_format": "sb_secret"})

    def test_live_backend_env_file_is_valid_when_present(self):
        if not BACKEND_ENV_FILE.is_file():
            self.skipTest("backend/.env not present in CI")

        # Validate loading backend/.env via load_backend_env without exposing values
        with patch.dict(os.environ, {}, clear=True):
            loaded_path = load_backend_env(env_file=BACKEND_ENV_FILE, override=True)
            self.assertEqual(loaded_path, BACKEND_ENV_FILE)
            settings = get_supabase_settings(auto_load=False)
            summary = settings.masked_summary()
            self.assertTrue(summary["configured"])
            self.assertEqual(summary["scheme"], "https")
            self.assertIn(summary["key_format"], ("sb_secret", "jwt"))


if __name__ == "__main__":
    unittest.main()
