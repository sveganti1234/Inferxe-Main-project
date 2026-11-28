"""
test_api_key_notifications.py
==============================
Unit and integration tests for customer notifications emitted on API key lifecycle
operations (creation and revocation) in the Python Inference Service.

Covers:
1. Successful API key creation emits a SECURITY_KEY notification for the authenticated customer.
2. The raw secret API key is never exposed in notification title, message, or metadata.
3. API key revocation emits a SECURITY_KEY notification for the authenticated owner.
4. Duplicate revocation attempts (already revoked) emit zero duplicate notifications.
5. Tenant isolation: unauthorized revocation attempts (HTTP 403) emit zero notifications.
6. Fault tolerance: failures in notification insertion do not fail or disrupt API key creation/revocation.
"""

import os
import sys
import json
import base64
import time
import uuid
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("NVIDIA_API_KEY", "nvapi-test-dummy-key-for-unit-testing")
os.environ.setdefault("INFERXE_TEST_MODE", "1")

BACKEND_DIR = Path(__file__).resolve().parents[2]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from fastapi.testclient import TestClient  # noqa: E402
from inference.main import app  # noqa: E402
from inference.auth import generate_api_key, hash_api_key  # noqa: E402
from inference.supabase_api_keys import (  # noqa: E402
    SupabaseAPIKeyRecord,
    SupabaseAPIKeyRepository,
    get_api_key_repository,
)
from inference.supabase_notifications import insert_customer_notification_safe  # noqa: E402


def make_cognito_jwt(sub: str) -> str:
    header = base64.urlsafe_b64encode(json.dumps({"alg": "RS256", "typ": "JWT"}).encode()).decode().rstrip("=")
    payload = base64.urlsafe_b64encode(json.dumps({
        "sub": sub,
        "email": f"{sub}@example.com",
        "token_use": "id",
        "exp": int(time.time()) + 3600,
    }).encode()).decode().rstrip("=")
    return f"{header}.{payload}.mock_sig"


class FakeKeyRepo(SupabaseAPIKeyRepository):
    """In-memory key repository mimicking Supabase table operations."""
    def __init__(self):
        self.keys = {}

    def create_api_key(self, *, user_id, name, key_prefix, secret_hash, **kwargs):
        kid = uuid.uuid4()
        rec = SupabaseAPIKeyRecord(
            id=kid,
            user_id=user_id,
            name=name,
            key_prefix=key_prefix,
            secret_hash=secret_hash,
            status="active",
        )
        self.keys[str(kid)] = rec
        return rec

    def revoke_api_key(self, *, key_id, user_id):
        from inference.supabase_api_keys import APIKeyNotFoundError, APIKeyForbiddenError
        rec = self.keys.get(str(key_id))
        if not rec:
            raise APIKeyNotFoundError(f"Key {key_id} not found.")
        if rec.user_id != user_id:
            raise APIKeyForbiddenError("Key belongs to another user.")
        if rec.status == "revoked":
            return rec, True  # already revoked
        rec.status = "revoked"
        return rec, False


class TestApiKeyNotifications(unittest.TestCase):
    def setUp(self):
        self.repo = FakeKeyRepo()
        app.dependency_overrides[get_api_key_repository] = lambda: self.repo
        self.client = TestClient(app)

    def tearDown(self):
        app.dependency_overrides.clear()

    @patch("inference.routes.insert_customer_notification_safe")
    def test_create_api_key_emits_security_key_notification(self, mock_notify):
        user_id = "cust_alice_111"
        token = make_cognito_jwt(user_id)

        resp = self.client.post(
            "/api/v1/api-keys",
            json={"name": "Production Bot Key", "environment": "live"},
            headers={"Authorization": f"Bearer {token}"},
        )
        self.assertEqual(resp.status_code, 201)
        data = resp.json()
        raw_key = data["api_key"]
        key_id = data["id"]

        # Notification was emitted once
        self.assertEqual(mock_notify.call_count, 1)
        call_kwargs = mock_notify.call_args.kwargs

        # Strictly isolated to authenticated user
        self.assertEqual(call_kwargs["user_id"], user_id)
        self.assertEqual(call_kwargs["notification_type"], "SECURITY_KEY")
        self.assertEqual(call_kwargs["title"], "API Key Created")
        self.assertEqual(call_kwargs["related_entity_id"], key_id)
        self.assertIn("Production Bot Key", call_kwargs["message"])
        self.assertIn(data["key_prefix"], call_kwargs["message"])

        # Security: Raw secret key is NEVER exposed in the notification or metadata
        self.assertNotIn(raw_key, call_kwargs["message"])
        self.assertNotIn(raw_key, str(call_kwargs["metadata"]))

    @patch("inference.routes.insert_customer_notification_safe")
    def test_revoke_api_key_emits_security_key_notification(self, mock_notify):
        user_id = "cust_alice_111"
        token = make_cognito_jwt(user_id)

        # Create key first
        create_resp = self.client.post(
            "/api/v1/api-keys",
            json={"name": "Key To Revoke", "environment": "live"},
            headers={"Authorization": f"Bearer {token}"},
        )
        self.assertEqual(create_resp.status_code, 201)
        key_id = create_resp.json()["id"]

        mock_notify.reset_mock()

        # Revoke key
        del_resp = self.client.delete(
            f"/api/v1/api-keys/{key_id}",
            headers={"Authorization": f"Bearer {token}"},
        )
        self.assertEqual(del_resp.status_code, 200)

        # Revocation notification was emitted
        self.assertEqual(mock_notify.call_count, 1)
        call_kwargs = mock_notify.call_args.kwargs
        self.assertEqual(call_kwargs["user_id"], user_id)
        self.assertEqual(call_kwargs["notification_type"], "SECURITY_KEY")
        self.assertEqual(call_kwargs["title"], "API Key Revoked")
        self.assertEqual(call_kwargs["related_entity_id"], key_id)
        self.assertIn("Key To Revoke", call_kwargs["message"])
        self.assertEqual(call_kwargs["metadata"]["action"], "revoked")

    @patch("inference.routes.insert_customer_notification_safe")
    def test_duplicate_revocation_does_not_emit_duplicate_notification(self, mock_notify):
        user_id = "cust_alice_111"
        token = make_cognito_jwt(user_id)

        # Create key
        create_resp = self.client.post(
            "/api/v1/api-keys",
            json={"name": "Key Duplicate Check", "environment": "live"},
            headers={"Authorization": f"Bearer {token}"},
        )
        key_id = create_resp.json()["id"]

        # First revocation
        r1 = self.client.delete(
            f"/api/v1/api-keys/{key_id}",
            headers={"Authorization": f"Bearer {token}"},
        )
        self.assertEqual(r1.status_code, 200)
        self.assertEqual(mock_notify.call_count, 2)  # 1 create + 1 revoke

        # Second revocation (already revoked)
        r2 = self.client.delete(
            f"/api/v1/api-keys/{key_id}",
            headers={"Authorization": f"Bearer {token}"},
        )
        self.assertEqual(r2.status_code, 200)
        self.assertEqual(r2.json()["message"], "API key is already revoked.")

        # Notification count should remain 2 (NO duplicate emitted)
        self.assertEqual(mock_notify.call_count, 2)

    @patch("inference.routes.insert_customer_notification_safe")
    def test_customer_isolation_unauthorized_revocation_emits_no_notification(self, mock_notify):
        token_alice = make_cognito_jwt("cust_alice_owner")
        token_bob = make_cognito_jwt("cust_bob_attacker")

        # Alice creates key
        create_resp = self.client.post(
            "/api/v1/api-keys",
            json={"name": "Alice Private Key", "environment": "live"},
            headers={"Authorization": f"Bearer {token_alice}"},
        )
        key_id = create_resp.json()["id"]
        mock_notify.reset_mock()

        # Bob attempts to revoke Alice's key
        del_resp = self.client.delete(
            f"/api/v1/api-keys/{key_id}",
            headers={"Authorization": f"Bearer {token_bob}"},
        )
        self.assertEqual(del_resp.status_code, 403)

        # No notification sent to either user
        self.assertEqual(mock_notify.call_count, 0)

    @patch("backend.database.supabase_client.get_supabase_client")
    def test_notification_helper_failure_does_not_break_api_key_flow(self, mock_get_client):
        # Configure client to raise network/DB error
        mock_client = MagicMock()
        mock_client.table.side_effect = RuntimeError("Database connection timed out")
        mock_get_client.return_value = mock_client

        user_id = "cust_resilience_test"
        token = make_cognito_jwt(user_id)

        # 1. Key creation succeeds despite notification error
        create_resp = self.client.post(
            "/api/v1/api-keys",
            json={"name": "Resilient Key", "environment": "live"},
            headers={"Authorization": f"Bearer {token}"},
        )
        self.assertEqual(create_resp.status_code, 201)
        key_id = create_resp.json()["id"]
        self.assertTrue(create_resp.json()["api_key"].startswith("inf_live_"))

        # 2. Key revocation succeeds despite notification error
        del_resp = self.client.delete(
            f"/api/v1/api-keys/{key_id}",
            headers={"Authorization": f"Bearer {token}"},
        )
        self.assertEqual(del_resp.status_code, 200)
        self.assertEqual(del_resp.json()["message"], "API key revoked successfully.")


if __name__ == "__main__":
    unittest.main()
