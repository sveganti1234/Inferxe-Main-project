"""
test_ssh_api.py
===============
Integration and API endpoint tests for Inferxe SSH Keys Management backed by Supabase.
Tests POST /api/v1/ssh-keys, GET /api/v1/ssh-keys, and DELETE /api/v1/ssh-keys/{key_id}.
Enforces tenant isolation, private key rejection, duplicate rejection, permanent hard DELETE,
and sanitized error handling without local SQLite SSHKey persistence.

Run via:
  .venv\Scripts\python.exe -m unittest backend/inference/tests/test_ssh_api.py
"""

import base64
import inspect
import json
import logging
import os
import sys
import time
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

import httpx2

# Ensure test mode is enabled before importing app
os.environ["DATABASE_URL"] = "sqlite:///:memory:"
os.environ["INFERXE_TEST_MODE"] = "1"

# Setup path to backend root
BACKEND_DIR = Path(__file__).resolve().parents[2]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from cryptography.hazmat.primitives.asymmetric import ed25519, rsa  # noqa: E402
from cryptography.hazmat.primitives.serialization import (  # noqa: E402
    Encoding,
    NoEncryption,
    PrivateFormat,
    PublicFormat,
)

from inference.database import Base, get_db  # noqa: E402
from inference.main import app  # noqa: E402
from inference.models import SSHKey  # noqa: E402
from inference.routes import (  # noqa: E402
    get_customer_ssh_keys as list_ssh_keys_route,
    register_ssh_key as register_ssh_key_route,
    remove_ssh_key as remove_ssh_key_route,
)
from inference.ssh_key_service import validate_and_parse_ssh_public_key  # noqa: E402
from inference.supabase_config import SupabaseSettings  # noqa: E402
from inference.supabase_ssh_keys import (  # noqa: E402
    SupabaseSSHKeyRepository,
    close_shared_ssh_keys_http_client,
    get_ssh_key_repository,
)
from inference.tests.test_supabase_ssh_keys import MockSupabaseSSHKeysTransport  # noqa: E402


def make_mock_jwt(sub: str, role: str = "customer", token_use: str = "id") -> str:
    """Generate a mock Cognito RS256 JWT parsed by verify_cognito_jwt in test mode."""
    header = base64.urlsafe_b64encode(json.dumps({"alg": "RS256", "typ": "JWT"}).encode()).decode().rstrip("=")
    payload = base64.urlsafe_b64encode(json.dumps({
        "sub": sub,
        "email": f"{sub}@inferxe.internal",
        "cognito:username": sub,
        "token_use": token_use,
        "exp": int(time.time()) + 3600,
    }).encode()).decode().rstrip("=")
    return f"{header}.{payload}.mock_signature"


class TestSSHKeyAPI(unittest.TestCase):
    """Integration test suite covering Supabase-backed SSH Key REST API endpoints."""

    @classmethod
    def setUpClass(cls):
        # In-memory SQLite session only used to verify zero local ORM ssh_keys writes occur
        cls.test_engine = create_engine(
            "sqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        cls.TestingSessionLocal = sessionmaker(
            autocommit=False, autoflush=False, bind=cls.test_engine
        )
        Base.metadata.create_all(bind=cls.test_engine)

        cls.client = TestClient(app, raise_server_exceptions=False)

        # Generate sample keys for testing
        cls.ed25519_priv = ed25519.Ed25519PrivateKey.generate()
        cls.ed25519_pub = cls.ed25519_priv.public_key().public_bytes(
            Encoding.OpenSSH, PublicFormat.OpenSSH
        ).decode("utf-8")

        cls.rsa_2048_priv = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        cls.rsa_2048_pub = cls.rsa_2048_priv.public_key().public_bytes(
            Encoding.OpenSSH, PublicFormat.OpenSSH
        ).decode("utf-8")

        cls.rsa_1024_priv = rsa.generate_private_key(public_exponent=65537, key_size=1024)
        cls.rsa_1024_pub = cls.rsa_1024_priv.public_key().public_bytes(
            Encoding.OpenSSH, PublicFormat.OpenSSH
        ).decode("utf-8")

        # Locate an Ed25519 public key whose OpenSSH SHA-256 fingerprint contains '+' and '/'
        cls.special_fp_pub = None
        for _ in range(500):
            candidate = (
                ed25519.Ed25519PrivateKey.generate()
                .public_key()
                .public_bytes(Encoding.OpenSSH, PublicFormat.OpenSSH)
                .decode("utf-8")
            )
            fp = validate_and_parse_ssh_public_key(candidate)["fingerprint"]
            if "+" in fp and "/" in fp:
                cls.special_fp_pub = candidate
                break
        if cls.special_fp_pub is None:
            raise RuntimeError("Failed to generate SSH key with '+' and '/' in fingerprint.")

    def setUp(self):
        self.db = self.TestingSessionLocal()
        self.transport = MockSupabaseSSHKeysTransport()
        self.settings = SupabaseSettings(
            url="https://ssh-api-test.supabase.co",
            service_role_key="sb_secret_" + "ssh_api_test_mock",
        )
        self.repo = SupabaseSSHKeyRepository(settings=self.settings, transport=self.transport)

        def override_get_db():
            try:
                yield self.db
            finally:
                pass

        app.dependency_overrides[get_db] = override_get_db
        app.dependency_overrides[get_ssh_key_repository] = lambda: self.repo

        self.jwt_alice = make_mock_jwt("user_alice")
        self.jwt_bob = make_mock_jwt("user_bob")

    def tearDown(self):
        self.db.query(SSHKey).delete()
        self.db.commit()
        self.db.close()
        app.dependency_overrides.clear()
        close_shared_ssh_keys_http_client()

    def test_ssh_key_routes_are_synchronous_def_handlers(self):
        self.assertFalse(inspect.iscoroutinefunction(register_ssh_key_route))
        self.assertFalse(inspect.iscoroutinefunction(list_ssh_keys_route))
        self.assertFalse(inspect.iscoroutinefunction(remove_ssh_key_route))

    # 1. Successful key creation persisted to Supabase (not local SQLite)
    def test_create_ssh_key_success(self):
        resp = self.client.post(
            "/api/v1/ssh-keys",
            json={
                "name": "Alice Workstation",
                "public_key": f"{self.ed25519_pub} alice@laptop",
            },
            headers={"Authorization": f"Bearer {self.jwt_alice}"},
        )
        self.assertEqual(resp.status_code, 201)
        data = resp.json()
        self.assertIn("id", data)
        self.assertEqual(data["name"], "Alice Workstation")
        self.assertEqual(data["key_type"], "ssh-ed25519")
        self.assertTrue(data["fingerprint"].startswith("SHA256:"))
        self.assertIn("alice@laptop", data["public_key"])

        # Verify persisted in Supabase mock store under user_alice and zero rows written locally
        stored = self.transport.rows.get(data["id"])
        self.assertIsNotNone(stored)
        self.assertEqual(stored["user_id"], "user_alice")
        self.assertEqual(self.db.query(SSHKey).all(), [])

        post_reqs = [r for r in self.transport.requests if r["method"] == "POST"]
        self.assertEqual(len(post_reqs), 1)
        self.assertNotIn("key_type", post_reqs[0]["body"])

    # 2. Never accept user_id from request body (tenant isolation spoof protection)
    def test_ignore_spoofed_user_id_in_request(self):
        resp = self.client.post(
            "/api/v1/ssh-keys",
            json={
                "name": "Spoof Attempt",
                "public_key": self.rsa_2048_pub,
                "user_id": "victim_user",
            },
            headers={"Authorization": f"Bearer {self.jwt_alice}"},
        )
        self.assertEqual(resp.status_code, 201)
        data = resp.json()

        stored = self.transport.rows[data["id"]]
        self.assertEqual(stored["user_id"], "user_alice")

    # 3. Reject private key material (OpenSSH private key & RSA PEM)
    def test_reject_private_key(self):
        priv_bytes = self.ed25519_priv.private_bytes(
            Encoding.PEM, PrivateFormat.OpenSSH, NoEncryption()
        ).decode("utf-8")

        resp = self.client.post(
            "/api/v1/ssh-keys",
            json={"name": "Private Key Leak", "public_key": priv_bytes},
            headers={"Authorization": f"Bearer {self.jwt_alice}"},
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn("Private keys are strictly prohibited", resp.json()["detail"])
        self.assertEqual(self.transport.requests, [])

    # 4. Reject insecure RSA key (< 2048 bits)
    def test_reject_insecure_rsa_key(self):
        resp = self.client.post(
            "/api/v1/ssh-keys",
            json={"name": "1024-bit RSA", "public_key": self.rsa_1024_pub},
            headers={"Authorization": f"Bearer {self.jwt_alice}"},
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn("at least 2048 bits", resp.json()["detail"])
        self.assertEqual(self.transport.requests, [])

    # 5. Reject malformed and empty public keys
    def test_reject_malformed_keys(self):
        resp1 = self.client.post(
            "/api/v1/ssh-keys",
            json={"name": "Empty Key", "public_key": "   "},
            headers={"Authorization": f"Bearer {self.jwt_alice}"},
        )
        self.assertEqual(resp1.status_code, 422)

        resp2 = self.client.post(
            "/api/v1/ssh-keys",
            json={"name": "Corrupt Key", "public_key": "ssh-ed25519 invalid_base64_blob"},
            headers={"Authorization": f"Bearer {self.jwt_alice}"},
        )
        self.assertEqual(resp2.status_code, 400)
        self.assertIn("Failed to cryptographically decode", resp2.json()["detail"])
        self.assertEqual(self.transport.requests, [])

    # 6. Reject duplicate keys for the same tenant (HTTP 409) including '+'/'/'/`:` fingerprints
    def test_reject_duplicate_key_same_tenant(self):
        resp1 = self.client.post(
            "/api/v1/ssh-keys",
            json={"name": "Initial Key", "public_key": self.special_fp_pub},
            headers={"Authorization": f"Bearer {self.jwt_alice}"},
        )
        self.assertEqual(resp1.status_code, 201)

        resp2 = self.client.post(
            "/api/v1/ssh-keys",
            json={"name": "Duplicate Key", "public_key": self.special_fp_pub},
            headers={"Authorization": f"Bearer {self.jwt_alice}"},
        )
        self.assertEqual(resp2.status_code, 409)
        self.assertIn("already exists in your account", resp2.json()["detail"])

    # 7. List keys with strict tenant isolation and derived key_type
    def test_list_ssh_keys_tenant_isolation(self):
        self.client.post(
            "/api/v1/ssh-keys",
            json={"name": "Alice Key 1", "public_key": self.ed25519_pub},
            headers={"Authorization": f"Bearer {self.jwt_alice}"},
        )
        self.client.post(
            "/api/v1/ssh-keys",
            json={"name": "Alice Key 2", "public_key": self.rsa_2048_pub},
            headers={"Authorization": f"Bearer {self.jwt_alice}"},
        )

        new_ed_priv = ed25519.Ed25519PrivateKey.generate()
        bob_key_pub = new_ed_priv.public_key().public_bytes(Encoding.OpenSSH, PublicFormat.OpenSSH).decode("utf-8")
        self.client.post(
            "/api/v1/ssh-keys",
            json={"name": "Bob Key 1", "public_key": bob_key_pub},
            headers={"Authorization": f"Bearer {self.jwt_bob}"},
        )

        list_alice = self.client.get("/api/v1/ssh-keys", headers={"Authorization": f"Bearer {self.jwt_alice}"})
        self.assertEqual(list_alice.status_code, 200)
        alice_keys = list_alice.json()["keys"]
        self.assertEqual(len(alice_keys), 2)
        self.assertTrue(all(k["name"].startswith("Alice") for k in alice_keys))
        self.assertEqual({k["key_type"] for k in alice_keys}, {"ssh-ed25519", "ssh-rsa"})

        list_bob = self.client.get("/api/v1/ssh-keys", headers={"Authorization": f"Bearer {self.jwt_bob}"})
        self.assertEqual(list_bob.status_code, 200)
        bob_keys = list_bob.json()["keys"]
        self.assertEqual(len(bob_keys), 1)
        self.assertEqual(bob_keys[0]["name"], "Bob Key 1")
        self.assertEqual(bob_keys[0]["key_type"], "ssh-ed25519")

    # 8. Permanent hard DELETE by key owner & re-registration
    def test_delete_own_ssh_key_success_and_reregister(self):
        create_res = self.client.post(
            "/api/v1/ssh-keys",
            json={"name": "Key To Delete", "public_key": self.ed25519_pub},
            headers={"Authorization": f"Bearer {self.jwt_alice}"},
        )
        key_id = create_res.json()["id"]

        del_res = self.client.delete(
            f"/api/v1/ssh-keys/{key_id}",
            headers={"Authorization": f"Bearer {self.jwt_alice}"},
        )
        self.assertEqual(del_res.status_code, 200)
        self.assertTrue(del_res.json()["success"])
        self.assertEqual(del_res.json()["id"], key_id)
        self.assertNotIn(key_id, self.transport.rows)

        list_res = self.client.get("/api/v1/ssh-keys", headers={"Authorization": f"Bearer {self.jwt_alice}"})
        self.assertEqual(len(list_res.json()["keys"]), 0)

        # Identical key can be re-registered cleanly after permanent hard delete
        recreate_res = self.client.post(
            "/api/v1/ssh-keys",
            json={"name": "Re-registered Key", "public_key": self.ed25519_pub},
            headers={"Authorization": f"Bearer {self.jwt_alice}"},
        )
        self.assertEqual(recreate_res.status_code, 201)
        self.assertNotEqual(recreate_res.json()["id"], key_id)

    # 8b. Proves SSH key endpoints use Supabase strictly and ignore stale local PostgreSQL ssh_keys rows
    def test_ssh_endpoints_bypass_local_sqlalchemy_ssh_keys_table(self):
        # Seed a stale row in local SQLAlchemy `ssh_keys` table (simulating pre-migration key like "ml project")
        stale_local = SSHKey(
            id=uuid.uuid4(),
            user_id="user_alice",
            name="ml project",
            public_key=f"{self.rsa_2048_pub} stale@local",
            fingerprint="SHA256:stale_local_fp",
            key_type="ssh-rsa",
        )
        self.db.add(stale_local)
        self.db.commit()

        # GET /api/v1/ssh-keys returns empty from Supabase (must NOT read stale local SQLAlchemy row)
        list_res = self.client.get(
            "/api/v1/ssh-keys",
            headers={"Authorization": f"Bearer {self.jwt_alice}"},
        )
        self.assertEqual(list_res.status_code, 200)
        self.assertEqual(list_res.json()["keys"], [])

        # POST + GET + DELETE operate strictly against Supabase and leave stale local table untouched
        create_res = self.client.post(
            "/api/v1/ssh-keys",
            json={"name": "Supabase Key", "public_key": self.ed25519_pub},
            headers={"Authorization": f"Bearer {self.jwt_alice}"},
        )
        self.assertEqual(create_res.status_code, 201)
        created_id = create_res.json()["id"]

        list_after_create = self.client.get(
            "/api/v1/ssh-keys",
            headers={"Authorization": f"Bearer {self.jwt_alice}"},
        )
        self.assertEqual([k["id"] for k in list_after_create.json()["keys"]], [created_id])

        # Stale local row cannot be deleted via Supabase DELETE endpoint (returns 404)
        del_local_res = self.client.delete(
            f"/api/v1/ssh-keys/{stale_local.id}",
            headers={"Authorization": f"Bearer {self.jwt_alice}"},
        )
        self.assertEqual(del_local_res.status_code, 404)
        self.assertEqual(self.db.query(SSHKey).count(), 1)

    # 9. Cross-customer deletion protection (returns 404 to avoid enumeration)
    def test_cross_customer_deletion_protection_returns_404(self):
        create_res = self.client.post(
            "/api/v1/ssh-keys",
            json={"name": "Alice Secret Key", "public_key": self.ed25519_pub},
            headers={"Authorization": f"Bearer {self.jwt_alice}"},
        )
        alice_key_id = create_res.json()["id"]

        del_res = self.client.delete(
            f"/api/v1/ssh-keys/{alice_key_id}",
            headers={"Authorization": f"Bearer {self.jwt_bob}"},
        )
        self.assertEqual(del_res.status_code, 404)
        self.assertIn("not found", del_res.json()["detail"].lower())
        self.assertIn(alice_key_id, self.transport.rows)

    # 10. Unauthenticated requests rejected with HTTP 401
    def test_unauthenticated_requests_rejected_401(self):
        res_post = self.client.post("/api/v1/ssh-keys", json={"name": "Key", "public_key": self.ed25519_pub})
        self.assertEqual(res_post.status_code, 401)
        self.assertIn("Authentication required", res_post.json()["detail"])

        res_get = self.client.get("/api/v1/ssh-keys")
        self.assertEqual(res_get.status_code, 401)

        res_del = self.client.delete(f"/api/v1/ssh-keys/{uuid.uuid4()}")
        self.assertEqual(res_del.status_code, 401)

    # 11. Invalid UUID handling (HTTP 400)
    def test_invalid_uuid_format_returns_400(self):
        resp = self.client.delete(
            "/api/v1/ssh-keys/not-a-valid-uuid-string",
            headers={"Authorization": f"Bearer {self.jwt_alice}"},
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn("Invalid key ID format. Expected UUID", resp.json()["detail"])

    # 12. Non-existent UUID returns 404
    def test_nonexistent_key_returns_404(self):
        random_id = str(uuid.uuid4())
        resp = self.client.delete(
            f"/api/v1/ssh-keys/{random_id}",
            headers={"Authorization": f"Bearer {self.jwt_alice}"},
        )
        self.assertEqual(resp.status_code, 404)
        self.assertIn("not found", resp.json()["detail"].lower())

    # 13. Missing profile FK (23503) maps to sanitized HTTP 400 without exposing SQL details
    def test_missing_profile_fk_23503_returns_400_without_leaks(self):
        def fk_transport(method, url, headers, body, timeout):
            if method == "GET":
                return 200, {"content-type": "application/json"}, b"[]"
            return (
                409,
                {"content-type": "application/json"},
                json.dumps({
                    "code": "23503",
                    "message": 'insert on table "ssh_public_keys" violates foreign key constraint "ssh_public_keys_user_id_fkey"',
                    "details": 'Key (user_id)=(user_alice) is not present in table "profiles".',
                    "hint": "SECRET_DB_HINT",
                }).encode(),
            )

        fk_repo = SupabaseSSHKeyRepository(settings=self.settings, transport=fk_transport)
        app.dependency_overrides[get_ssh_key_repository] = lambda: fk_repo

        with self.assertLogs("inferxe.supabase_ssh_keys", level=logging.WARNING) as log_cm:
            resp = self.client.post(
                "/api/v1/ssh-keys",
                json={"name": "No Profile Key", "public_key": self.ed25519_pub},
                headers={"Authorization": f"Bearer {self.jwt_alice}"},
            )

        self.assertEqual(resp.status_code, 400)
        self.assertEqual(
            resp.json()["detail"],
            "Customer profile must be initialized before registering SSH keys.",
        )
        self.assertNotIn("SECRET_DB_HINT", resp.text)
        self.assertNotIn("ssh_public_keys_user_id_fkey", resp.text)
        self.assertNotIn("SECRET_DB_HINT", "\n".join(log_cm.output))

    # 14. Upstream Supabase 503/502 and unexpected 500 error handling without leaks
    def test_supabase_error_mapping_503_502_and_internal_500_without_leaks(self):
        # Timeout -> 503
        self.transport.next_error = httpx2.ReadTimeout("timeout calling " + "sb_secret_mock")
        r_timeout = self.client.get("/api/v1/ssh-keys", headers={"Authorization": f"Bearer {self.jwt_alice}"})
        self.assertEqual(r_timeout.status_code, 503)
        self.assertNotIn("sb_secret_", r_timeout.text)
        self.assertNotIn("ssh-api-test", r_timeout.text)

        # Upstream 5xx -> 503
        self.transport.next_response = (
            502,
            {"content-type": "application/json"},
            json.dumps({"message": "upstream secret dump", "details": "raw pg detail"}).encode(),
        )
        r_502 = self.client.get("/api/v1/ssh-keys", headers={"Authorization": f"Bearer {self.jwt_alice}"})
        self.assertEqual(r_502.status_code, 503)
        self.assertNotIn("upstream secret dump", r_502.text)

        # Unhandled PostgREST 4xx -> 502
        self.transport.next_response = (
            406,
            {"content-type": "application/json"},
            json.dumps({"code": "42883", "message": "raw sql error", "details": "internal detail"}).encode(),
        )
        r_postgrest_406 = self.client.post(
            "/api/v1/ssh-keys",
            json={"name": "Fail", "public_key": self.ed25519_pub},
            headers={"Authorization": f"Bearer {self.jwt_alice}"},
        )
        self.assertEqual(r_postgrest_406.status_code, 502)
        self.assertEqual(r_postgrest_406.json()["detail"], "Upstream SSH key database rejected the request.")
        self.assertNotIn("raw sql error", r_postgrest_406.text)

        # Unexpected internal exception -> 500 without leaking exception text
        with patch.object(self.repo, "create_ssh_key", side_effect=RuntimeError("Database connection timeout")):
            r_500 = self.client.post(
                "/api/v1/ssh-keys",
                json={"name": "Fail Key", "public_key": self.ed25519_pub},
                headers={"Authorization": f"Bearer {self.jwt_alice}"},
            )
        self.assertEqual(r_500.status_code, 500)
        self.assertNotIn("Database connection timeout", r_500.text)
        self.assertIn("Failed to register SSH key in database", r_500.json()["detail"])

    # 15. FastAPI lifespan shutdown closes pooled SSH keys HTTP client cleanly
    def test_fastapi_lifespan_closes_shared_ssh_keys_http_client(self):
        import asyncio
        from inference.main import lifespan

        async def _run_lifespan():
            with patch("inference.main.check_database_connection", return_value=False), patch(
                "inference.main.close_shared_ssh_keys_http_client"
            ) as close_mock:
                async with lifespan(app):
                    self.assertEqual(close_mock.call_count, 0)
                self.assertEqual(close_mock.call_count, 1)

        asyncio.run(_run_lifespan())


if __name__ == "__main__":
    unittest.main()

