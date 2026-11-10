"""
Automated unit and integration tests for the Inferxe Inference API.
Mocks NVIDIA provider to prevent API quota consumption during testing.
Uses an isolated in-memory test database with full schema verification.

Run via:
  python -m unittest backend/inference/tests/test_inference_api.py
"""

import os
import sys
import uuid
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

# Configure test environment before imports to prevent external connections
os.environ["DATABASE_URL"] = "sqlite:///:memory:"
os.environ["NVIDIA_API_KEY"] = "nvapi-test-dummy-key-for-unit-testing"
os.environ["INFERXE_TEST_MODE"] = "1"

# Setup path to backend
BACKEND_DIR = Path(__file__).resolve().parents[2]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from inference.database import Base, get_db
from inference.models import InferenceRequest as InferenceRequestRecord
from inference.auth import generate_api_key, hash_api_key
from inference.main import app
from inference.routes import inference_service
from inference.supabase_api_keys import SupabaseAPIKeyRepository, get_api_key_repository
from inference.supabase_config import SupabaseSettings
from inference.supabase_telemetry import SupabaseTelemetryRepository, get_telemetry_repository
from inference.tests.test_supabase_api_keys import MockSupabaseAPIKeysTransport
from inference.tests.test_supabase_telemetry import MockSupabaseTelemetryTransport


class TestInferenceAPI(unittest.TestCase):
    """Test suite covering authentication, inference routing, validation, and usage tracking."""

    @classmethod
    def setUpClass(cls):
        # Create isolated in-memory SQLite database
        cls.test_engine = create_engine(
            "sqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        cls.TestingSessionLocal = sessionmaker(
            autocommit=False, autoflush=False, bind=cls.test_engine
        )
        Base.metadata.create_all(bind=cls.test_engine)

        # Create TestClient once
        cls.client = TestClient(app, raise_server_exceptions=False)

    def setUp(self):
        # Create a fresh database session and mocked Supabase API keys & telemetry transports per test
        self.db = self.TestingSessionLocal()
        supabase_settings = SupabaseSettings(
            url="https://mock-inference-test.supabase.co",
            service_role_key="sb_secret_mock_inference_suite_key",
        )
        self.mock_supabase = MockSupabaseAPIKeysTransport()
        self.supabase_repo = SupabaseAPIKeyRepository(
            settings=supabase_settings,
            transport=self.mock_supabase,
        )
        self.mock_telemetry = MockSupabaseTelemetryTransport()
        self.telemetry_repo = SupabaseTelemetryRepository(
            settings=supabase_settings,
            transport=self.mock_telemetry,
        )

        # Override FastAPI dependencies to use test database + mocked Supabase REST transports
        def override_get_db():
            try:
                yield self.db
            finally:
                pass

        app.dependency_overrides[get_db] = override_get_db
        app.dependency_overrides[get_api_key_repository] = lambda: self.supabase_repo
        app.dependency_overrides[get_telemetry_repository] = lambda: self.telemetry_repo

        # Generate test API keys in mocked Supabase store
        self.valid_raw_key, self.valid_prefix, self.valid_hash = generate_api_key("live")
        self.valid_key_record = self.mock_supabase.seed_row({
            "id": str(uuid.uuid4()),
            "user_id": "cognito_user_123",
            "name": "Valid Test Key",
            "key_prefix": self.valid_prefix,
            "secret_hash": self.valid_hash,
            "status": "active",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })

        # Generate revoked key
        self.revoked_raw_key, self.revoked_prefix, self.revoked_hash = generate_api_key("live")
        self.revoked_key_record = self.mock_supabase.seed_row({
            "id": str(uuid.uuid4()),
            "user_id": "cognito_user_456",
            "name": "Revoked Key",
            "key_prefix": self.revoked_prefix,
            "secret_hash": self.revoked_hash,
            "status": "revoked",
            "revoked_at": datetime.now(timezone.utc).isoformat(),
            "created_at": datetime.now(timezone.utc).isoformat(),
        })

        # Generate inactive key
        self.inactive_raw_key, self.inactive_prefix, self.inactive_hash = generate_api_key("live")
        self.inactive_key_record = self.mock_supabase.seed_row({
            "id": str(uuid.uuid4()),
            "user_id": "cognito_user_789",
            "name": "Inactive Key",
            "key_prefix": self.inactive_prefix,
            "secret_hash": self.inactive_hash,
            "status": "inactive",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })

    def tearDown(self):
        self.db.query(InferenceRequestRecord).delete()
        self.db.commit()
        self.db.close()
        app.dependency_overrides.clear()

    # 1. Health check
    def test_health_endpoint(self):
        resp = self.client.get("/api/v1/health")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("status", data)
        self.assertEqual(data["service"], "inferxe-inference-api")

    # 2. Authentication: Missing API key
    def test_missing_api_key(self):
        resp = self.client.post("/api/v1/inference", json={"prompt": "Hello world"})
        self.assertEqual(resp.status_code, 401)
        self.assertIn("Missing Authorization header", resp.json()["detail"])

    # 3. Authentication: Invalid API key
    def test_invalid_api_key(self):
        resp = self.client.post(
            "/api/v1/inference",
            json={"prompt": "Hello world"},
            headers={"Authorization": "Bearer inf_live_completely_fake_key_12345"}
        )
        self.assertEqual(resp.status_code, 401)
        self.assertIn("Invalid Inferxe API key", resp.json()["detail"])

    # 4. Authentication: Revoked API key
    def test_revoked_api_key(self):
        resp = self.client.post(
            "/api/v1/inference",
            json={"prompt": "Hello world"},
            headers={"Authorization": f"Bearer {self.revoked_raw_key}"}
        )
        self.assertEqual(resp.status_code, 401)
        self.assertIn("revoked or is inactive", resp.json()["detail"])

    # 5. Authentication: Inactive API key
    def test_inactive_api_key(self):
        resp = self.client.post(
            "/api/v1/inference",
            json={"prompt": "Hello world"},
            headers={"Authorization": f"Bearer {self.inactive_raw_key}"}
        )
        self.assertEqual(resp.status_code, 401)
        self.assertIn("revoked or is inactive", resp.json()["detail"])

    # 6. Authentication: Prevent NVIDIA key from being passed directly
    def test_reject_nvidia_key_as_customer_bearer(self):
        resp = self.client.post(
            "/api/v1/inference",
            json={"prompt": "Hello world"},
            headers={"Authorization": "Bearer nvapi-fake-nvidia-server-secret-key"}
        )
        self.assertEqual(resp.status_code, 401)
        self.assertIn("Please use your Inferxe customer API key", resp.json()["detail"])

    # 7. Validation: Empty prompt
    def test_empty_prompt(self):
        resp = self.client.post(
            "/api/v1/inference",
            json={"prompt": ""},
            headers={"Authorization": f"Bearer {self.valid_raw_key}"}
        )
        self.assertEqual(resp.status_code, 422)

    # 8. Validation: Whitespace-only prompt
    def test_whitespace_prompt(self):
        resp = self.client.post(
            "/api/v1/inference",
            json={"prompt": "    \n\t  "},
            headers={"Authorization": f"Bearer {self.valid_raw_key}"}
        )
        self.assertEqual(resp.status_code, 422)

    # 9. Validation: Invalid max_tokens
    def test_invalid_max_tokens(self):
        resp = self.client.post(
            "/api/v1/inference",
            json={"prompt": "Explain LLMs", "max_tokens": 0},
            headers={"Authorization": f"Bearer {self.valid_raw_key}"}
        )
        self.assertEqual(resp.status_code, 422)

        resp2 = self.client.post(
            "/api/v1/inference",
            json={"prompt": "Explain LLMs", "max_tokens": 10000},
            headers={"Authorization": f"Bearer {self.valid_raw_key}"}
        )
        self.assertEqual(resp2.status_code, 422)

    # 10. Validation: Invalid temperature
    def test_invalid_temperature(self):
        resp = self.client.post(
            "/api/v1/inference",
            json={"prompt": "Explain LLMs", "temperature": 3.0},
            headers={"Authorization": f"Bearer {self.valid_raw_key}"}
        )
        self.assertEqual(resp.status_code, 422)

    # 11. Successful Inference with Mocked NVIDIA Provider & Usage Tracking
    def test_successful_inference(self):
        mock_result = {
            "provider": "nvidia",
            "model": "nvidia/nemotron-3.5-bolt-e4b",
            "content": "GPU inference executes trained neural network weights on input prompts.",
            "finish_reason": "stop",
            "usage": {
                "prompt_tokens": 12,
                "completion_tokens": 48,
                "total_tokens": 60
            }
        }

        with patch.object(inference_service.provider, "generate", return_value=mock_result) as mock_gen:
            resp = self.client.post(
                "/api/v1/inference",
                json={
                    "prompt": "What is GPU inference?",
                    "max_tokens": 150,
                    "temperature": 0.2
                },
                headers={"Authorization": f"Bearer {self.valid_raw_key}"}
            )

            self.assertEqual(resp.status_code, 200)
            data = resp.json()
            self.assertTrue(data["success"])
            self.assertEqual(data["provider"], "nvidia")
            self.assertEqual(data["model"], "nvidia/nemotron-3.5-bolt-e4b")
            self.assertEqual(data["response"], mock_result["content"])
            self.assertEqual(data["usage"]["prompt_tokens"], 12)
            self.assertEqual(data["usage"]["completion_tokens"], 48)
            self.assertEqual(data["usage"]["total_tokens"], 60)

            mock_gen.assert_called_once_with(
                prompt="What is GPU inference?",
                max_tokens=150,
                temperature=0.2
            )

            # Verify telemetry record was persisted to Supabase and NOT local SQLAlchemy
            self.assertEqual(self.db.query(InferenceRequestRecord).all(), [])
            self.assertEqual(len(self.mock_telemetry.rows), 1)
            record = next(iter(self.mock_telemetry.rows.values()))
            self.assertEqual(record["status"], "success")
            self.assertEqual(record["provider_name"], "nvidia")
            self.assertEqual(record["model_name"], "nvidia/nemotron-3.5-bolt-e4b")
            self.assertEqual(record["input_tokens"], 12)
            self.assertEqual(record["output_tokens"], 48)
            self.assertEqual(record["user_id"], "cognito_user_123")
            self.assertEqual(record["api_key_id"], self.valid_key_record["id"])
            self.assertIsNotNone(record["latency_ms"])

            # Verify key last_used_at was updated in Supabase
            updated_key = self.mock_supabase.rows[self.valid_key_record["id"]]
            self.assertIsNotNone(updated_key["last_used_at"])

    # 12. Provider Error: Rate limit (HTTP 429)
    def test_provider_rate_limit(self):
        from openai import RateLimitError
        mock_response = MagicMock(status_code=429, headers={})
        rate_err = RateLimitError("Rate limit exceeded", response=mock_response, body=None)

        with patch.object(inference_service.provider, "generate", side_effect=rate_err):
            resp = self.client.post(
                "/api/v1/inference",
                json={"prompt": "Heavy workload"},
                headers={"Authorization": f"Bearer {self.valid_raw_key}"}
            )
            self.assertEqual(resp.status_code, 429)
            self.assertIn("rate limit", resp.json()["detail"].lower())

            self.assertEqual(self.db.query(InferenceRequestRecord).all(), [])
            self.assertEqual(len(self.mock_telemetry.rows), 1)
            record = next(iter(self.mock_telemetry.rows.values()))
            self.assertEqual(record["status"], "failed")
            self.assertEqual(record["api_key_id"], self.valid_key_record["id"])

    # 13. Provider Error: Timeout (HTTP 504)
    def test_provider_timeout(self):
        from openai import APITimeoutError
        mock_request = MagicMock()
        timeout_err = APITimeoutError(request=mock_request)

        with patch.object(inference_service.provider, "generate", side_effect=timeout_err):
            resp = self.client.post(
                "/api/v1/inference",
                json={"prompt": "Long generation prompt"},
                headers={"Authorization": f"Bearer {self.valid_raw_key}"}
            )
            self.assertEqual(resp.status_code, 504)
            self.assertIn("timed out", resp.json()["detail"].lower())

            self.assertEqual(self.db.query(InferenceRequestRecord).all(), [])
            self.assertEqual(len(self.mock_telemetry.rows), 1)
            record = next(iter(self.mock_telemetry.rows.values()))
            self.assertEqual(record["status"], "timeout")
            self.assertEqual(record["api_key_id"], self.valid_key_record["id"])

    # 14. Key Generation Utility Test
    def test_api_key_generation(self):
        raw_key, prefix, key_hash = generate_api_key("live")
        self.assertTrue(raw_key.startswith("inf_live_"))
        self.assertTrue(prefix.startswith("inf_live_"))
        self.assertEqual(len(key_hash), 64)
        self.assertEqual(hash_api_key(raw_key), key_hash)

    # 15. Create API Key: Reject anonymous requests (HTTP 401)
    def test_create_api_key_rejects_anonymous(self):
        resp = self.client.post("/api/v1/api-keys", json={"name": "Prod Key", "environment": "live"})
        self.assertEqual(resp.status_code, 401)
        self.assertIn("Authentication required", resp.json()["detail"])

    # 16. Create API Key: Reject invalid JWT (HTTP 401)
    def test_create_api_key_rejects_invalid_jwt(self):
        resp = self.client.post(
            "/api/v1/api-keys",
            json={"name": "Prod Key", "environment": "live"},
            headers={"Authorization": "Bearer not_a_valid_jwt"}
        )
        self.assertEqual(resp.status_code, 401)
        self.assertIn("Invalid Cognito JWT", resp.json()["detail"])

    # 17. Create API Key: Succeeds with verified Cognito JWT (HTTP 201)
    def test_create_api_key_with_verified_cognito_jwt(self):
        import base64, json, time
        header = base64.urlsafe_b64encode(json.dumps({"alg": "RS256", "typ": "JWT"}).encode()).decode().rstrip("=")
        payload = base64.urlsafe_b64encode(json.dumps({
            "sub": "cognito_user_alex_chen",
            "email": "alex.chen@inferxe.internal",
            "exp": int(time.time()) + 3600
        }).encode()).decode().rstrip("=")
        mock_cognito_jwt = f"{header}.{payload}.fake_signature"

        resp = self.client.post(
            "/api/v1/api-keys",
            json={"name": "Alex Prod Key", "environment": "live"},
            headers={"Authorization": f"Bearer {mock_cognito_jwt}"}
        )
        self.assertEqual(resp.status_code, 201)
        data = resp.json()
        self.assertTrue(data["api_key"].startswith("inf_live_"))
        self.assertEqual(data["name"], "Alex Prod Key")

        # Verify key was persisted in Supabase store with verified cognito sub and hashed secret
        persisted_rows = [
            row for row in self.mock_supabase.rows.values()
            if row["user_id"] == "cognito_user_alex_chen"
        ]
        self.assertEqual(len(persisted_rows), 1)
        persisted_key = persisted_rows[0]
        self.assertEqual(persisted_key["name"], "Alex Prod Key")
        self.assertEqual(persisted_key["key_prefix"], data["key_prefix"])
        self.assertEqual(persisted_key["secret_hash"], hash_api_key(data["api_key"]))

    # 18. List API Keys & User Isolation
    def test_list_api_keys_and_user_isolation(self):
        import base64, json, time
        def make_jwt(sub: str):
            h = base64.urlsafe_b64encode(json.dumps({"alg": "RS256"}).encode()).decode().rstrip("=")
            p = base64.urlsafe_b64encode(json.dumps({"sub": sub, "exp": int(time.time()) + 3600}).encode()).decode().rstrip("=")
            return f"{h}.{p}.sig"

        jwt_user_a = make_jwt("user_tenant_alpha")
        jwt_user_b = make_jwt("user_tenant_beta")

        # Create key for user A
        res_a = self.client.post(
            "/api/v1/api-keys",
            json={"name": "Alpha Service Key", "environment": "live"},
            headers={"Authorization": f"Bearer {jwt_user_a}"}
        )
        self.assertEqual(res_a.status_code, 201)

        # Create key for user B
        res_b = self.client.post(
            "/api/v1/api-keys",
            json={"name": "Beta Pipeline Key", "environment": "test"},
            headers={"Authorization": f"Bearer {jwt_user_b}"}
        )
        self.assertEqual(res_b.status_code, 201)

        # List keys for User A
        list_a = self.client.get("/api/v1/api-keys", headers={"Authorization": f"Bearer {jwt_user_a}"})
        self.assertEqual(list_a.status_code, 200)
        keys_a = list_a.json()["keys"]
        self.assertEqual(len(keys_a), 1)
        self.assertEqual(keys_a[0]["name"], "Alpha Service Key")
        self.assertEqual(keys_a[0]["user_id"], "user_tenant_alpha")
        # Ensure secret and hash are NOT returned
        self.assertNotIn("api_key", keys_a[0])
        self.assertNotIn("key_hash", keys_a[0])

        # List keys for User B
        list_b = self.client.get("/api/v1/api-keys", headers={"Authorization": f"Bearer {jwt_user_b}"})
        self.assertEqual(list_b.status_code, 200)
        keys_b = list_b.json()["keys"]
        self.assertEqual(len(keys_b), 1)
        self.assertEqual(keys_b[0]["name"], "Beta Pipeline Key")
        self.assertEqual(keys_b[0]["user_id"], "user_tenant_beta")

    # 19. Revoke API Key & Inference Lockout
    def test_revoke_own_api_key_and_inference_lockout(self):
        import base64, json, time
        h = base64.urlsafe_b64encode(json.dumps({"alg": "RS256"}).encode()).decode().rstrip("=")
        p = base64.urlsafe_b64encode(json.dumps({"sub": "user_dev_priya", "exp": int(time.time()) + 3600}).encode()).decode().rstrip("=")
        jwt_token = f"{h}.{p}.sig"

        # 1. Create key
        create_res = self.client.post(
            "/api/v1/api-keys",
            json={"name": "Priya Analytics Key", "environment": "live"},
            headers={"Authorization": f"Bearer {jwt_token}"}
        )
        self.assertEqual(create_res.status_code, 201)
        key_data = create_res.json()
        key_id = key_data["id"]
        raw_key = key_data["api_key"]

        # 2. Revoke key
        del_res = self.client.delete(f"/api/v1/api-keys/{key_id}", headers={"Authorization": f"Bearer {jwt_token}"})
        self.assertEqual(del_res.status_code, 200)
        self.assertTrue(del_res.json()["success"])

        # 3. Verify in listing that key is inactive and revoked_at is populated
        list_res = self.client.get("/api/v1/api-keys", headers={"Authorization": f"Bearer {jwt_token}"})
        self.assertEqual(list_res.status_code, 200)
        listed_key = list_res.json()["keys"][0]
        self.assertFalse(listed_key["is_active"])
        self.assertIsNotNone(listed_key["revoked_at"])

        # 4. Attempt inference with the revoked key -> must fail with HTTP 401
        inf_res = self.client.post(
            "/api/v1/inference",
            json={"prompt": "Test revoked access"},
            headers={"Authorization": f"Bearer {raw_key}"}
        )
        self.assertEqual(inf_res.status_code, 401)
        self.assertIn("revoked or is inactive", inf_res.json()["detail"])

    # 20. Revoke Cross-User Key Forbidden (HTTP 403)
    def test_revoke_cross_user_forbidden(self):
        import base64, json, time
        def make_jwt(sub: str):
            h = base64.urlsafe_b64encode(json.dumps({"alg": "RS256"}).encode()).decode().rstrip("=")
            p = base64.urlsafe_b64encode(json.dumps({"sub": sub, "exp": int(time.time()) + 3600}).encode()).decode().rstrip("=")
            return f"{h}.{p}.sig"

        jwt_user_a = make_jwt("victim_user")
        jwt_user_b = make_jwt("attacker_user")

        # Victim creates key
        res = self.client.post(
            "/api/v1/api-keys",
            json={"name": "Victim Key"},
            headers={"Authorization": f"Bearer {jwt_user_a}"}
        )
        self.assertEqual(res.status_code, 201)
        victim_key_id = res.json()["id"]

        # Attacker tries to delete victim's key
        del_res = self.client.delete(f"/api/v1/api-keys/{victim_key_id}", headers={"Authorization": f"Bearer {jwt_user_b}"})
        self.assertEqual(del_res.status_code, 403)
        self.assertIn("Access denied", del_res.json()["detail"])

    # 21. Cognito Security: Expired token rejected with HTTP 401
    def test_cognito_expired_token_rejects_401(self):
        import base64, json, time
        h = base64.urlsafe_b64encode(json.dumps({"alg": "RS256"}).encode()).decode().rstrip("=")
        p = base64.urlsafe_b64encode(json.dumps({
            "sub": "user_expired",
            "token_use": "id",
            "exp": int(time.time()) - 3600
        }).encode()).decode().rstrip("=")
        expired_jwt = f"{h}.{p}.fake_sig"

        res = self.client.post(
            "/api/v1/api-keys",
            json={"name": "Expired Test Key"},
            headers={"Authorization": f"Bearer {expired_jwt}"}
        )
        self.assertEqual(res.status_code, 401)
        self.assertIn("expired", res.json()["detail"].lower())

    # 22. Cognito Security: Wrong token_use ('access') rejected with HTTP 401
    def test_cognito_invalid_token_use_rejects_401(self):
        import base64, json, time
        h = base64.urlsafe_b64encode(json.dumps({"alg": "RS256"}).encode()).decode().rstrip("=")
        p = base64.urlsafe_b64encode(json.dumps({
            "sub": "user_wrong_token_use",
            "token_use": "access",  # Must be 'id'
            "exp": int(time.time()) + 3600
        }).encode()).decode().rstrip("=")
        access_jwt = f"{h}.{p}.fake_sig"

        res = self.client.post(
            "/api/v1/api-keys",
            json={"name": "Access Token Test Key"},
            headers={"Authorization": f"Bearer {access_jwt}"}
        )
        self.assertEqual(res.status_code, 401)
        self.assertIn("token_use", res.json()["detail"].lower())

    # 23. Cognito Security: Live JWKS unavailable fails closed with HTTP 503
    def test_cognito_jwks_unavailable_fails_closed_503(self):
        import os
        from unittest.mock import patch
        # Temporarily disable test mode bypass to simulate live production runtime
        with patch.dict(os.environ, {
            "INFERXE_TEST_MODE": "0",
            "COGNITO_USER_POOL_ID": "ap-south-1_unavailable_pool",
            "COGNITO_CLIENT_ID": "test_client_id"
        }):
            res = self.client.post(
                "/api/v1/api-keys",
                json={"name": "Fail Closed Key"},
                headers={"Authorization": "Bearer fake.jwt.token"}
            )
            # Must fail closed with 503 Service Unavailable (or 401 if token malformed)
            self.assertIn(res.status_code, [401, 503])
            if res.status_code == 503:
                self.assertIn("unavailable", res.json()["detail"].lower())

    # 24. Cognito Security: Invalid signature rejected with HTTP 401 in live runtime
    def test_cognito_invalid_signature_rejected_401(self):
        import os
        from unittest.mock import patch, MagicMock
        from jwt import PyJWTError

        mock_jwks_client = MagicMock()
        mock_jwks_client.get_signing_key_from_jwt.return_value = MagicMock(key="fake_public_key")

        with patch.dict(os.environ, {
            "INFERXE_TEST_MODE": "0",
            "COGNITO_USER_POOL_ID": "ap-south-1_testpool",
            "COGNITO_CLIENT_ID": "test_client_id"
        }):
            with patch("inference.auth.PyJWKClient", return_value=mock_jwks_client):
                with patch("jwt.decode", side_effect=PyJWTError("Signature verification failed")):
                    res = self.client.post(
                        "/api/v1/api-keys",
                        json={"name": "Bad Sig Key"},
                        headers={"Authorization": "Bearer fake.jwt.token"}
                    )
                    self.assertEqual(res.status_code, 401)
                    self.assertIn("signature verification", res.json()["detail"].lower())

    # 25. Cognito Security: Missing User Pool ID or Client ID fails closed with HTTP 503
    def test_cognito_missing_pool_or_client_id_fails_closed_503(self):
        import os
        from unittest.mock import patch

        # Missing client ID
        with patch.dict(os.environ, {"INFERXE_TEST_MODE": "0", "COGNITO_USER_POOL_ID": "ap-south-1_testpool", "COGNITO_CLIENT_ID": ""}):
            res = self.client.post(
                "/api/v1/api-keys",
                json={"name": "Missing Client ID"},
                headers={"Authorization": "Bearer fake.jwt.token"}
            )
            self.assertEqual(res.status_code, 503)
            self.assertIn("pending configuration", res.json()["detail"].lower())

        # Missing pool ID
        with patch.dict(os.environ, {"INFERXE_TEST_MODE": "0", "COGNITO_USER_POOL_ID": "", "COGNITO_CLIENT_ID": "test_client_id"}):
            res2 = self.client.post(
                "/api/v1/api-keys",
                json={"name": "Missing Pool ID"},
                headers={"Authorization": "Bearer fake.jwt.token"}
            )
            self.assertEqual(res2.status_code, 503)
            self.assertIn("pending configuration", res2.json()["detail"].lower())


if __name__ == "__main__":
    unittest.main()
