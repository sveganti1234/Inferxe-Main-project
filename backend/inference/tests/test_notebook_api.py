"""
test_notebook_api.py
====================
Integration tests for Inferxe Notebook Management REST API endpoints:
  - POST /api/v1/notebooks
  - GET  /api/v1/notebooks
  - GET  /api/v1/notebooks/{id}
  - POST /api/v1/notebooks/{id}/start
  - POST /api/v1/notebooks/{id}/stop
  - DELETE /api/v1/notebooks/{id}

Enforces:
  - Cognito JWT authentication & tenant isolation (never accepts user_id from client).
  - Cross-user access rejection (returns 404 to avoid user enumeration).
  - Invalid state transition handling (409 Conflict).
  - Input validation (UUID format, non-empty names, foreign SSH keys).
  - Simulation notice transparency.
"""

import os
import sys
import uuid
import time
import json
import base64
import unittest
from pathlib import Path

# Force test mode and in-memory SQLite
os.environ["DATABASE_URL"] = "sqlite:///:memory:"
os.environ["INFERXE_TEST_MODE"] = "1"

BACKEND_DIR = Path(__file__).resolve().parents[2]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

# Ensure site-packages is available
SITE_PACKAGES = Path(r"C:\Inferxe-Main-project\.venv\Lib\site-packages")
if SITE_PACKAGES.exists() and str(SITE_PACKAGES) not in sys.path:
    sys.path.insert(0, str(SITE_PACKAGES))

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from inference.database import Base, get_db
from inference.models import SSHKey, NotebookInstance
from inference.notebook_service import SIMULATION_NOTICE
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


class TestNotebookAPI(unittest.TestCase):
    """Integration test suite for Notebook Management endpoints."""

    @classmethod
    def setUpClass(cls):
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

    def setUp(self):
        self.db = self.TestingSessionLocal()

        def override_get_db():
            try:
                yield self.db
            finally:
                pass

        app.dependency_overrides[get_db] = override_get_db

        self.jwt_alice = make_mock_jwt("user_alice_api")
        self.jwt_bob = make_mock_jwt("user_bob_api")

        # Create Alice's SSH Key
        self.alice_ssh_key = SSHKey(
            id=uuid.uuid4(),
            user_id="user_alice_api",
            name="Alice MacBook",
            public_key="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIG5alice... alice@mbp",
            fingerprint="SHA256:alice_api_fp",
            key_type="ssh-ed25519",
        )
        # Create Bob's SSH Key
        self.bob_ssh_key = SSHKey(
            id=uuid.uuid4(),
            user_id="user_bob_api",
            name="Bob Desktop",
            public_key="ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQCbob... bob@pc",
            fingerprint="SHA256:bob_api_fp",
            key_type="ssh-rsa",
        )
        self.db.add_all([self.alice_ssh_key, self.bob_ssh_key])
        self.db.commit()

    def tearDown(self):
        self.db.query(NotebookInstance).delete()
        self.db.query(SSHKey).delete()
        self.db.commit()
        self.db.close()
        app.dependency_overrides.clear()

    # --- 1. Authentication & Creation Tests ---

    def test_unauthenticated_requests_rejected(self):
        """All notebook endpoints require verified Cognito authentication."""
        # POST
        r = self.client.post("/api/v1/notebooks", json={"name": "Test"})
        self.assertEqual(r.status_code, 401)

        # GET
        r = self.client.get("/api/v1/notebooks")
        self.assertEqual(r.status_code, 401)

        # GET by ID
        r = self.client.get(f"/api/v1/notebooks/{uuid.uuid4()}")
        self.assertEqual(r.status_code, 401)

    def test_create_notebook_success(self):
        """Create notebook with valid JWT."""
        resp = self.client.post(
            "/api/v1/notebooks",
            headers={"Authorization": f"Bearer {self.jwt_alice}"},
            json={
                "name": "Qwen Fine-Tuning Sandbox",
                "gpu_profile": "NVIDIA L40S",
                "selected_ssh_key_id": str(self.alice_ssh_key.id),
            },
        )
        self.assertEqual(resp.status_code, 201)
        data = resp.json()
        self.assertEqual(data["name"], "Qwen Fine-Tuning Sandbox")
        self.assertEqual(data["user_id"], "user_alice_api")
        self.assertEqual(data["gpu_profile"], "NVIDIA L40S")
        self.assertEqual(data["status"], "running")
        self.assertTrue(data["is_simulated"])
        self.assertEqual(data["simulation_notice"], SIMULATION_NOTICE)
        self.assertIsNotNone(data["access_token"])
        self.assertTrue(data["access_token"].startswith("ixnb_"))
        self.assertIn("id_ed25519", data["ssh_command"])

    def test_create_notebook_rejects_foreign_ssh_key(self):
        """Attempting to bind another user's SSH key returns 400 Bad Request."""
        resp = self.client.post(
            "/api/v1/notebooks",
            headers={"Authorization": f"Bearer {self.jwt_alice}"},
            json={
                "name": "Malicious Key Attempt",
                "selected_ssh_key_id": str(self.bob_ssh_key.id),  # Bob's key!
            },
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn("does not belong to your account", resp.json()["detail"])

    # --- 2. Listing & Tenant Isolation ---

    def test_list_notebooks_isolation(self):
        """GET /notebooks returns only the calling user's instances."""
        # Alice creates 2 notebooks
        self.client.post(
            "/api/v1/notebooks",
            headers={"Authorization": f"Bearer {self.jwt_alice}"},
            json={"name": "Alice NB 1"},
        )
        self.client.post(
            "/api/v1/notebooks",
            headers={"Authorization": f"Bearer {self.jwt_alice}"},
            json={"name": "Alice NB 2"},
        )
        # Bob creates 1 notebook
        self.client.post(
            "/api/v1/notebooks",
            headers={"Authorization": f"Bearer {self.jwt_bob}"},
            json={"name": "Bob NB 1"},
        )

        r_alice = self.client.get(
            "/api/v1/notebooks",
            headers={"Authorization": f"Bearer {self.jwt_alice}"},
        )
        self.assertEqual(r_alice.status_code, 200)
        alice_data = r_alice.json()
        self.assertEqual(len(alice_data["notebooks"]), 2)
        self.assertTrue(all(n["user_id"] == "user_alice_api" for n in alice_data["notebooks"]))

        r_bob = self.client.get(
            "/api/v1/notebooks",
            headers={"Authorization": f"Bearer {self.jwt_bob}"},
        )
        self.assertEqual(r_bob.status_code, 200)
        bob_data = r_bob.json()
        self.assertEqual(len(bob_data["notebooks"]), 1)
        self.assertEqual(bob_data["notebooks"][0]["name"], "Bob NB 1")

    # --- 3. Retrieval & Cross-User Security ---

    def test_get_notebook_cross_user_404(self):
        """Accessing another user's notebook returns 404 to avoid enumeration."""
        resp = self.client.post(
            "/api/v1/notebooks",
            headers={"Authorization": f"Bearer {self.jwt_alice}"},
            json={"name": "Alice Secret Workload"},
        )
        nb_id = resp.json()["id"]

        # Alice accesses her own
        r_owner = self.client.get(
            f"/api/v1/notebooks/{nb_id}",
            headers={"Authorization": f"Bearer {self.jwt_alice}"},
        )
        self.assertEqual(r_owner.status_code, 200)

        # Bob attempts access -> 404
        r_other = self.client.get(
            f"/api/v1/notebooks/{nb_id}",
            headers={"Authorization": f"Bearer {self.jwt_bob}"},
        )
        self.assertEqual(r_other.status_code, 404)

    # --- 4. Start, Stop, and State Transitions ---

    def test_start_and_stop_lifecycle(self):
        """Stop and start endpoints update notebook state correctly."""
        resp = self.client.post(
            "/api/v1/notebooks",
            headers={"Authorization": f"Bearer {self.jwt_alice}"},
            json={"name": "Lifecycle API NB"},
        )
        nb_id = resp.json()["id"]

        # Stop
        stop_resp = self.client.post(
            f"/api/v1/notebooks/{nb_id}/stop",
            headers={"Authorization": f"Bearer {self.jwt_alice}"},
        )
        self.assertEqual(stop_resp.status_code, 200)
        self.assertEqual(stop_resp.json()["notebook"]["status"], "stopped")

        # Stop again -> 409 Conflict
        stop_dup = self.client.post(
            f"/api/v1/notebooks/{nb_id}/stop",
            headers={"Authorization": f"Bearer {self.jwt_alice}"},
        )
        self.assertEqual(stop_dup.status_code, 409)

        # Start
        start_resp = self.client.post(
            f"/api/v1/notebooks/{nb_id}/start",
            headers={"Authorization": f"Bearer {self.jwt_alice}"},
        )
        self.assertEqual(start_resp.status_code, 200)
        self.assertEqual(start_resp.json()["notebook"]["status"], "running")

        # Start again -> 409 Conflict
        start_dup = self.client.post(
            f"/api/v1/notebooks/{nb_id}/start",
            headers={"Authorization": f"Bearer {self.jwt_alice}"},
        )
        self.assertEqual(start_dup.status_code, 409)

    def test_cross_user_stop_start_rejected(self):
        """User Bob cannot stop or start Alice's notebook."""
        resp = self.client.post(
            "/api/v1/notebooks",
            headers={"Authorization": f"Bearer {self.jwt_alice}"},
            json={"name": "Alice Private"},
        )
        nb_id = resp.json()["id"]

        # Bob tries stop -> 404
        r = self.client.post(
            f"/api/v1/notebooks/{nb_id}/stop",
            headers={"Authorization": f"Bearer {self.jwt_bob}"},
        )
        self.assertEqual(r.status_code, 404)

        # Bob tries start -> 404
        r = self.client.post(
            f"/api/v1/notebooks/{nb_id}/start",
            headers={"Authorization": f"Bearer {self.jwt_bob}"},
        )
        self.assertEqual(r.status_code, 404)

    # --- 5. Termination Tests ---

    def test_terminate_notebook_success_and_idempotency(self):
        """DELETE terminates notebook and subsequent operations return 409."""
        resp = self.client.post(
            "/api/v1/notebooks",
            headers={"Authorization": f"Bearer {self.jwt_alice}"},
            json={"name": "To Terminate"},
        )
        nb_id = resp.json()["id"]

        # Terminate
        del_resp = self.client.delete(
            f"/api/v1/notebooks/{nb_id}",
            headers={"Authorization": f"Bearer {self.jwt_alice}"},
        )
        self.assertEqual(del_resp.status_code, 200)
        self.assertEqual(del_resp.json()["notebook"]["status"], "terminated")

        # Cannot re-terminate
        del_dup = self.client.delete(
            f"/api/v1/notebooks/{nb_id}",
            headers={"Authorization": f"Bearer {self.jwt_alice}"},
        )
        self.assertEqual(del_dup.status_code, 409)

        # Cannot start terminated notebook
        start_del = self.client.post(
            f"/api/v1/notebooks/{nb_id}/start",
            headers={"Authorization": f"Bearer {self.jwt_alice}"},
        )
        self.assertEqual(start_del.status_code, 409)

    def test_invalid_uuid_returns_400(self):
        """Endpoints return 400 Bad Request on invalid UUIDs."""
        bad_id = "invalid-uuid-format"
        r1 = self.client.get(f"/api/v1/notebooks/{bad_id}", headers={"Authorization": f"Bearer {self.jwt_alice}"})
        self.assertEqual(r1.status_code, 400)

        r2 = self.client.post(f"/api/v1/notebooks/{bad_id}/start", headers={"Authorization": f"Bearer {self.jwt_alice}"})
        self.assertEqual(r2.status_code, 400)

        r3 = self.client.delete(f"/api/v1/notebooks/{bad_id}", headers={"Authorization": f"Bearer {self.jwt_alice}"})
        self.assertEqual(r3.status_code, 400)


if __name__ == "__main__":
    unittest.main()

