"""
test_local_connectivity.py
==========================
Regression tests verifying local developer startup resilience:
1. Optional legacy SQLAlchemy DATABASE_URL fallback does not crash when omitted or placeholder.
2. Cognito configuration resolution falls back cleanly to VITE_COGNITO_* only when primary key is unset.
3. Health endpoint reports `ok` when Supabase REST + NVIDIA are configured, even without local pgAdmin 4.
"""

import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

os.environ["DATABASE_URL"] = "sqlite:///:memory:"
os.environ["NVIDIA_API_KEY"] = "nvapi-test-dummy-key-for-unit-testing"
os.environ["INFERXE_TEST_MODE"] = "1"

BACKEND_DIR = Path(__file__).resolve().parents[2]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from fastapi.testclient import TestClient  # noqa: E402
from inference import auth as inf_auth  # noqa: E402
from inference import database as inf_db  # noqa: E402
from inference.main import app  # noqa: E402


class TestLocalConnectivityHelpers(unittest.TestCase):
    def test_optional_sqlalchemy_url_normalization(self):
        self.assertEqual(inf_db._normalize_optional_database_url(""), ("sqlite:///:memory:", False))
        self.assertEqual(
            inf_db._normalize_optional_database_url(
                "postgresql+psycopg2://postgres:YOUR_PASSWORD@localhost:5432/inferxe"
            ),
            ("sqlite:///:memory:", False),
        )
        self.assertEqual(
            inf_db._normalize_optional_database_url("postgres://u:p@host:5432/db"),
            ("postgresql+psycopg2://u:p@host:5432/db", True),
        )

    def test_cognito_resolution_respects_explicit_empty_primary_and_falls_back_when_unset(self):
        with patch.dict(
            os.environ,
            {
                "VITE_COGNITO_USER_POOL_ID": "ap-south-1_vitePool",
                "VITE_COGNITO_CLIENT_ID": "vite_client_123",
            },
            clear=False,
        ):
            saved_pool = os.environ.pop("COGNITO_USER_POOL_ID", None)
            saved_client = os.environ.pop("COGNITO_CLIENT_ID", None)
            try:
                _, pool_id, client_id = inf_auth.get_cognito_runtime_config()
                self.assertEqual(pool_id, "ap-south-1_vitePool")
                self.assertEqual(client_id, "vite_client_123")
            finally:
                if saved_pool is not None:
                    os.environ["COGNITO_USER_POOL_ID"] = saved_pool
                if saved_client is not None:
                    os.environ["COGNITO_CLIENT_ID"] = saved_client

        # Explicit empty COGNITO_CLIENT_ID must remain empty so fail-closed tests pass
        with patch.dict(
            os.environ,
            {
                "COGNITO_USER_POOL_ID": "ap-south-1_primaryPool",
                "COGNITO_CLIENT_ID": "",
                "VITE_COGNITO_CLIENT_ID": "should_not_override_explicit_empty",
            },
            clear=False,
        ):
            _, pool_id, client_id = inf_auth.get_cognito_runtime_config()
            self.assertEqual(pool_id, "ap-south-1_primaryPool")
            self.assertEqual(client_id, "")

    def test_health_reports_ok_with_supabase_rest_without_local_postgres(self):
        client = TestClient(app, raise_server_exceptions=False)
        with (
            patch("inference.routes.check_database_connection", return_value=False),
            patch.dict(
                os.environ,
                {
                    "INFERXE_TEST_MODE": "1",
                    "SUPABASE_URL": "https://example.supabase.co",
                    "SUPABASE_SERVICE_ROLE_KEY": "sb_secret_test_key",
                    "NVIDIA_API_KEY": "nvapi-test-key",
                },
                clear=False,
            ),
        ):
            res = client.get("/api/v1/health")
            self.assertEqual(res.status_code, 200)
            body = res.json()
            self.assertEqual(body["status"], "ok")
            self.assertEqual(body["database"], "supabase_rest")
            self.assertEqual(body["supabase_rest"], "configured")
            self.assertEqual(body["nvidia_provider"], "configured")


if __name__ == "__main__":
    unittest.main()
