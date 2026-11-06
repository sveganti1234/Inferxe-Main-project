"""
test_ssh_api.py
===============
Integration and API endpoint tests for Inferxe SSH Keys Management.
Tests POST /api/v1/ssh-keys, GET /api/v1/ssh-keys, and DELETE /api/v1/ssh-keys/{key_id}.
Enforces tenant isolation, private key rejection, duplicate rejection, and error handling.

Run via:
  .venv\\Scripts\\python.exe -m unittest backend/inference/tests/test_ssh_api.py
"""

import os
import sys
import uuid
import time
import json
import base64
import unittest
from pathlib import Path
from unittest.mock import patch

# Ensure test mode is enabled before importing app
os.environ["DATABASE_URL"] = "sqlite:///:memory:"
os.environ["INFERXE_TEST_MODE"] = "1"

# Setup path to backend root
BACKEND_DIR = Path(__file__).resolve().parents[2]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from cryptography.hazmat.primitives.asymmetric import rsa, ed25519
from cryptography.hazmat.primitives.serialization import (
    Encoding,
    PublicFormat,
    PrivateFormat,
    NoEncryption,
)

from inference.database import Base, get_db
from inference.models import SSHKey
from inference.main import app


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
    """Integration test suite covering SSH Key REST API endpoints."""

    @classmethod
    def setUpClass(cls):
        # Create an isolated in-memory SQLite database
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

    def setUp(self):
        self.db = self.TestingSessionLocal()

        def override_get_db():
            try:
                yield self.db
            finally:
                pass

        app.dependency_overrides[get_db] = override_get_db

        self.jwt_alice = make_mock_jwt("user_alice")
        self.jwt_bob = make_mock_jwt("user_bob")

    def tearDown(self):
        self.db.query(SSHKey).delete()
        self.db.commit()
        self.db.close()
        app.dependency_overrides.clear()

    # 1. Successful key creation
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

        # Verify persisted in database under user_alice
        db_key = self.db.query(SSHKey).filter(SSHKey.id == uuid.UUID(data["id"])).first()
        self.assertIsNotNone(db_key)
        self.assertEqual(db_key.user_id, "user_alice")

    # 2. Never accept user_id from request body (tenant isolation spoof protection)
    def test_ignore_spoofed_user_id_in_request(self):
        resp = self.client.post(
            "/api/v1/ssh-keys",
            json={
                "name": "Spoof Attempt",
                "public_key": self.rsa_2048_pub,
                "user_id": "victim_user",  # Attacker attempts to inject under another user
            },
            headers={"Authorization": f"Bearer {self.jwt_alice}"},
        )
        self.assertEqual(resp.status_code, 201)
        data = resp.json()

        # Database record must be owned strictly by user_alice, not victim_user
        db_key = self.db.query(SSHKey).filter(SSHKey.id == uuid.UUID(data["id"])).first()
        self.assertEqual(db_key.user_id, "user_alice")

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

    # 4. Reject insecure RSA key (< 2048 bits)
    def test_reject_insecure_rsa_key(self):
        resp = self.client.post(
            "/api/v1/ssh-keys",
            json={"name": "1024-bit RSA", "public_key": self.rsa_1024_pub},
            headers={"Authorization": f"Bearer {self.jwt_alice}"},
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn("at least 2048 bits", resp.json()["detail"])

    # 5. Reject malformed and empty public keys
    def test_reject_malformed_keys(self):
        # Empty string
        resp1 = self.client.post(
            "/api/v1/ssh-keys",
            json={"name": "Empty Key", "public_key": "   "},
            headers={"Authorization": f"Bearer {self.jwt_alice}"},
        )
        self.assertEqual(resp1.status_code, 422)

        # Corrupted key
        resp2 = self.client.post(
            "/api/v1/ssh-keys",
            json={"name": "Corrupt Key", "public_key": "ssh-ed25519 invalid_base64_blob"},
            headers={"Authorization": f"Bearer {self.jwt_alice}"},
        )
        self.assertEqual(resp2.status_code, 400)
        self.assertIn("Failed to cryptographically decode", resp2.json()["detail"])

    # 6. Reject duplicate keys for the same tenant (HTTP 409)
    def test_reject_duplicate_key_same_tenant(self):
        # First registration succeeds
        resp1 = self.client.post(
            "/api/v1/ssh-keys",
            json={"name": "Initial Key", "public_key": self.ed25519_pub},
            headers={"Authorization": f"Bearer {self.jwt_alice}"},
        )
        self.assertEqual(resp1.status_code, 201)

        # Duplicate registration for same user fails with 409 Conflict
        resp2 = self.client.post(
            "/api/v1/ssh-keys",
            json={"name": "Duplicate Key", "public_key": self.ed25519_pub},
            headers={"Authorization": f"Bearer {self.jwt_alice}"},
        )
        self.assertEqual(resp2.status_code, 409)
        self.assertIn("already exists in your account", resp2.json()["detail"])

    # 7. List keys with strict tenant isolation
    def test_list_ssh_keys_tenant_isolation(self):
        # Alice registers 2 keys
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

        # Bob registers 1 key
        new_ed_priv = ed25519.Ed25519PrivateKey.generate()
        bob_key_pub = new_ed_priv.public_key().public_bytes(Encoding.OpenSSH, PublicFormat.OpenSSH).decode("utf-8")
        self.client.post(
            "/api/v1/ssh-keys",
            json={"name": "Bob Key 1", "public_key": bob_key_pub},
            headers={"Authorization": f"Bearer {self.jwt_bob}"},
        )

        # Alice lists her keys -> must return exactly 2 keys
        list_alice = self.client.get("/api/v1/ssh-keys", headers={"Authorization": f"Bearer {self.jwt_alice}"})
        self.assertEqual(list_alice.status_code, 200)
        alice_keys = list_alice.json()["keys"]
        self.assertEqual(len(alice_keys), 2)
        self.assertTrue(all(k["name"].startswith("Alice") for k in alice_keys))

        # Bob lists his keys -> must return exactly 1 key
        list_bob = self.client.get("/api/v1/ssh-keys", headers={"Authorization": f"Bearer {self.jwt_bob}"})
        self.assertEqual(list_bob.status_code, 200)
        bob_keys = list_bob.json()["keys"]
        self.assertEqual(len(bob_keys), 1)
        self.assertEqual(bob_keys[0]["name"], "Bob Key 1")

    # 8. Successful deletion by key owner
    def test_delete_own_ssh_key_success(self):
        # Create key
        create_res = self.client.post(
            "/api/v1/ssh-keys",
            json={"name": "Key To Delete", "public_key": self.ed25519_pub},
            headers={"Authorization": f"Bearer {self.jwt_alice}"},
        )
        key_id = create_res.json()["id"]

        # Delete key
        del_res = self.client.delete(f"/api/v1/ssh-keys/{key_id}", headers={"Authorization": f"Bearer {self.jwt_alice}"})
        self.assertEqual(del_res.status_code, 200)
        self.assertTrue(del_res.json()["success"])
        self.assertEqual(del_res.json()["id"], key_id)

        # Verify key is gone from listing
        list_res = self.client.get("/api/v1/ssh-keys", headers={"Authorization": f"Bearer {self.jwt_alice}"})
        self.assertEqual(len(list_res.json()["keys"]), 0)

    # 9. Cross-customer deletion protection (returns 404 to avoid enumeration)
    def test_cross_customer_deletion_protection_returns_404(self):
        # Alice creates a key
        create_res = self.client.post(
            "/api/v1/ssh-keys",
            json={"name": "Alice Secret Key", "public_key": self.ed25519_pub},
            headers={"Authorization": f"Bearer {self.jwt_alice}"},
        )
        alice_key_id = create_res.json()["id"]

        # Bob attempts to delete Alice's key -> must return 404 Not Found
        del_res = self.client.delete(
            f"/api/v1/ssh-keys/{alice_key_id}",
            headers={"Authorization": f"Bearer {self.jwt_bob}"},
        )
        self.assertEqual(del_res.status_code, 404)
        self.assertIn("not found", del_res.json()["detail"].lower())

        # Verify Alice's key was NOT deleted
        db_key = self.db.query(SSHKey).filter(SSHKey.id == uuid.UUID(alice_key_id)).first()
        self.assertIsNotNone(db_key)

    # 10. Unauthenticated requests rejected with HTTP 401
    def test_unauthenticated_requests_rejected_401(self):
        # POST without auth
        res_post = self.client.post("/api/v1/ssh-keys", json={"name": "Key", "public_key": self.ed25519_pub})
        self.assertEqual(res_post.status_code, 401)
        self.assertIn("Authentication required", res_post.json()["detail"])

        # GET without auth
        res_get = self.client.get("/api/v1/ssh-keys")
        self.assertEqual(res_get.status_code, 401)

        # DELETE without auth
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

    # 13. Database failure handling (HTTP 500 without leaking SQL details)
    def test_database_failure_handling_500(self):
        with patch("inference.routes.create_ssh_key", side_effect=Exception("Database connection timeout")):
            resp = self.client.post(
                "/api/v1/ssh-keys",
                json={"name": "Fail Key", "public_key": self.ed25519_pub},
                headers={"Authorization": f"Bearer {self.jwt_alice}"},
            )
            self.assertEqual(resp.status_code, 500)
            # Ensure internal SQL/driver details are NOT leaked to customer
            self.assertNotIn("Database connection timeout", resp.json()["detail"])
            self.assertIn("Failed to register SSH key in database", resp.json()["detail"])


if __name__ == "__main__":
    unittest.main()

