"""
test_notebook_api.py
====================
Integration and API endpoint tests for Inferxe Notebook Management REST API
backed by Supabase (`notebook_sessions` + `ssh_public_keys`):
  - POST   /api/v1/notebooks
  - GET    /api/v1/notebooks
  - GET    /api/v1/notebooks/{id}
  - POST   /api/v1/notebooks/{id}/start
  - POST   /api/v1/notebooks/{id}/stop
  - DELETE /api/v1/notebooks/{id}

Enforces:
  - Cognito JWT authentication & tenant isolation (never accepts user_id from client).
  - SSH key ownership validation via `SupabaseSSHKeyRepository` (no local SQLite dependency).
  - Bypass of stale local SQLite `SSHKey` and `NotebookInstance` tables.
  - Cross-user access rejection (returns 404 to prevent user enumeration).
  - Atomic lifecycle state transitions, `starting` status support, and `409 Conflict` on concurrency races.
  - Write-only `token_hash` (never returned in JSON or logs) and simulation notice transparency.
  - Resilience across SSH key deletion (`ON DELETE SET NULL`) and sanitized error mapping.
  - Clean FastAPI lifespan shutdown closing both pooled HTTP clients.
"""

import asyncio
import base64
import inspect
import json
import logging
import os
import sys
import threading
import time
import unittest
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

import httpx2
from cryptography.hazmat.primitives.asymmetric import ed25519, rsa
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

# Force test mode and in-memory SQLite
os.environ["DATABASE_URL"] = "sqlite:///:memory:"
os.environ["INFERXE_TEST_MODE"] = "1"

BACKEND_DIR = Path(__file__).resolve().parents[2]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from inference.database import Base, get_db  # noqa: E402
from inference.main import app, lifespan  # noqa: E402
from inference.models import NotebookInstance, SSHKey  # noqa: E402
from inference.notebook_service import SIMULATION_NOTICE  # noqa: E402
from inference.routes import (  # noqa: E402
    create_notebook_instance as create_notebook_route,
    delete_notebook_instance as delete_notebook_route,
    get_notebook_instance as get_notebook_route,
    list_notebooks as list_notebooks_route,
    start_notebook_instance as start_notebook_route,
    stop_notebook_instance as stop_notebook_route,
)
from inference.supabase_config import SupabaseSettings  # noqa: E402
from inference.supabase_notebooks import (  # noqa: E402
    SupabaseNotebookRepository,
    close_shared_notebooks_http_client,
    get_notebook_repository,
)
from inference.supabase_ssh_keys import (  # noqa: E402
    SupabaseSSHKeyRepository,
    close_shared_ssh_keys_http_client,
    get_ssh_key_repository,
)
from inference.tests.test_supabase_notebooks import MockSupabaseNotebooksTransport  # noqa: E402
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


class TestNotebookAPI(unittest.TestCase):
    """Integration test suite for Supabase-backed Notebook Management endpoints."""

    @classmethod
    def setUpClass(cls) -> None:
        # Local SQLite DB kept ONLY to prove zero writes/reads touch local ORM tables
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

        cls.ed25519_pub = (
            ed25519.Ed25519PrivateKey.generate()
            .public_key()
            .public_bytes(Encoding.OpenSSH, PublicFormat.OpenSSH)
            .decode("utf-8")
        )
        cls.rsa_2048_pub = (
            rsa.generate_private_key(public_exponent=65537, key_size=2048)
            .public_key()
            .public_bytes(Encoding.OpenSSH, PublicFormat.OpenSSH)
            .decode("utf-8")
        )

    def setUp(self) -> None:
        self.db = self.TestingSessionLocal()
        self.settings = SupabaseSettings(
            url="https://notebook-api-test.supabase.co",
            service_role_key="sb_secret_" + "notebook_api_test_mock",
        )
        self.ssh_transport = MockSupabaseSSHKeysTransport()
        self.ssh_repo = SupabaseSSHKeyRepository(
            settings=self.settings,
            timeout=5.0,
            transport=self.ssh_transport,
        )
        self.nb_transport = MockSupabaseNotebooksTransport(
            ssh_keys_transport=self.ssh_transport
        )
        self.nb_repo = SupabaseNotebookRepository(
            settings=self.settings,
            timeout=5.0,
            transport=self.nb_transport,
            ssh_key_repo=self.ssh_repo,
        )

        def override_get_db():
            try:
                yield self.db
            finally:
                pass

        app.dependency_overrides[get_db] = override_get_db
        app.dependency_overrides[get_ssh_key_repository] = lambda: self.ssh_repo
        app.dependency_overrides[get_notebook_repository] = lambda: self.nb_repo

        self.jwt_alice = make_mock_jwt("user_alice_api")
        self.jwt_bob = make_mock_jwt("user_bob_api")

        # Seed SSH keys in Supabase mock store (not local SQLite!)
        self.alice_ssh_key = self.ssh_repo.create_ssh_key(
            user_id="user_alice_api",
            name="Alice MacBook",
            raw_public_key=f"{self.ed25519_pub} alice@mbp",
        )
        self.bob_ssh_key = self.ssh_repo.create_ssh_key(
            user_id="user_bob_api",
            name="Bob Desktop",
            raw_public_key=f"{self.rsa_2048_pub} bob@pc",
        )

    def tearDown(self) -> None:
        self.db.query(NotebookInstance).delete()
        self.db.query(SSHKey).delete()
        self.db.commit()
        self.db.close()
        app.dependency_overrides.clear()
        close_shared_notebooks_http_client()
        close_shared_ssh_keys_http_client()

    # --- 0. Handler Execution Mode ---

    def test_notebook_routes_are_synchronous_def_handlers(self) -> None:
        """All 6 notebook routes must be sync `def` handlers for FastAPI threadpool execution."""
        self.assertFalse(inspect.iscoroutinefunction(create_notebook_route))
        self.assertFalse(inspect.iscoroutinefunction(list_notebooks_route))
        self.assertFalse(inspect.iscoroutinefunction(get_notebook_route))
        self.assertFalse(inspect.iscoroutinefunction(start_notebook_route))
        self.assertFalse(inspect.iscoroutinefunction(stop_notebook_route))
        self.assertFalse(inspect.iscoroutinefunction(delete_notebook_route))

    # --- 1. Authentication & Creation Tests ---

    def test_unauthenticated_requests_rejected(self) -> None:
        """All 6 notebook endpoints require verified Cognito authentication."""
        fake_id = str(uuid.uuid4())
        self.assertEqual(self.client.post("/api/v1/notebooks", json={"name": "Test"}).status_code, 401)
        self.assertEqual(self.client.get("/api/v1/notebooks").status_code, 401)
        self.assertEqual(self.client.get(f"/api/v1/notebooks/{fake_id}").status_code, 401)
        self.assertEqual(self.client.post(f"/api/v1/notebooks/{fake_id}/start").status_code, 401)
        self.assertEqual(self.client.post(f"/api/v1/notebooks/{fake_id}/stop").status_code, 401)
        self.assertEqual(self.client.delete(f"/api/v1/notebooks/{fake_id}").status_code, 401)

    def test_create_notebook_success_ignores_spoofed_user_id_and_bypasses_local_db(self) -> None:
        """Create notebook in Supabase with hashed token, SSH key binding, and zero local ORM writes."""
        resp = self.client.post(
            "/api/v1/notebooks",
            headers={"Authorization": f"Bearer {self.jwt_alice}"},
            json={
                "name": "Qwen Fine-Tuning Sandbox",
                "gpu_profile": "NVIDIA L40S",
                "selected_ssh_key_id": str(self.alice_ssh_key.id),
                "user_id": "victim_spoof_user",
            },
        )
        self.assertEqual(resp.status_code, 201)
        data = resp.json()
        self.assertEqual(data["name"], "Qwen Fine-Tuning Sandbox")
        self.assertEqual(data["user_id"], "user_alice_api")
        self.assertEqual(data["gpu_profile"], "NVIDIA L40S")
        self.assertEqual(data["status"], "running")
        self.assertEqual(data["selected_ssh_key_id"], str(self.alice_ssh_key.id))
        self.assertTrue(data["is_simulated"])
        self.assertEqual(data["simulation_notice"], SIMULATION_NOTICE)
        self.assertIsNotNone(data["access_token"])
        self.assertTrue(data["access_token"].startswith("ixnb_"))
        self.assertIn("id_ed25519", data["ssh_command"])
        self.assertNotIn("token_hash", data)

        # Stored in Supabase with SHA-256 hash (not raw token), zero rows in local SQLite
        stored = self.nb_transport.rows[data["id"]]
        self.assertEqual(stored["user_id"], "user_alice_api")
        self.assertNotEqual(stored["token_hash"], data["access_token"])
        self.assertEqual(len(stored["token_hash"]), 64)
        self.assertEqual(self.db.query(NotebookInstance).count(), 0)

    def test_create_notebook_rejects_foreign_and_nonexistent_ssh_key(self) -> None:
        """Attempting to bind Bob's SSH key or unknown SSH key returns 400 Bad Request."""
        resp_foreign = self.client.post(
            "/api/v1/notebooks",
            headers={"Authorization": f"Bearer {self.jwt_alice}"},
            json={
                "name": "Malicious Key Attempt",
                "selected_ssh_key_id": str(self.bob_ssh_key.id),
            },
        )
        self.assertEqual(resp_foreign.status_code, 400)
        self.assertIn("does not belong to your account", resp_foreign.json()["detail"])
        self.assertEqual(len(self.nb_transport.rows), 0)

        resp_missing = self.client.post(
            "/api/v1/notebooks",
            headers={"Authorization": f"Bearer {self.jwt_alice}"},
            json={
                "name": "Missing Key Attempt",
                "selected_ssh_key_id": str(uuid.uuid4()),
            },
        )
        self.assertEqual(resp_missing.status_code, 400)
        self.assertIn("does not exist", resp_missing.json()["detail"])

        resp_bad_uuid = self.client.post(
            "/api/v1/notebooks",
            headers={"Authorization": f"Bearer {self.jwt_alice}"},
            json={
                "name": "Malformed Key UUID",
                "selected_ssh_key_id": "not-a-uuid",
            },
        )
        self.assertEqual(resp_bad_uuid.status_code, 400)

    def test_notebook_endpoints_bypass_local_sqlalchemy_tables(self) -> None:
        """Prove notebook API ignores stale local SQLite NotebookInstance and SSHKey rows."""
        local_ssh = SSHKey(
            id=uuid.uuid4(),
            user_id="user_alice_api",
            name="Stale Local Key",
            public_key=f"{self.rsa_2048_pub} stale@local",
            fingerprint="SHA256:stale_local_nb_fp",
            key_type="ssh-rsa",
        )
        local_nb = NotebookInstance(
            id=uuid.uuid4(),
            user_id="user_alice_api",
            name="Stale Local SQLite Notebook",
            gpu_profile="NVIDIA L4",
            status="running",
            token_hash="0" * 64,
        )
        self.db.add_all([local_ssh, local_nb])
        self.db.commit()

        # GET /notebooks must ignore stale local row and return empty Supabase list
        list_res = self.client.get(
            "/api/v1/notebooks",
            headers={"Authorization": f"Bearer {self.jwt_alice}"},
        )
        self.assertEqual(list_res.status_code, 200)
        self.assertEqual(list_res.json()["notebooks"], [])

        # GET /notebooks/{local_nb.id} must return 404 (not in Supabase)
        get_res = self.client.get(
            f"/api/v1/notebooks/{local_nb.id}",
            headers={"Authorization": f"Bearer {self.jwt_alice}"},
        )
        self.assertEqual(get_res.status_code, 404)

        # POST /notebooks with SQLite-only SSH key ID must return 400 (not in Supabase)
        create_res = self.client.post(
            "/api/v1/notebooks",
            headers={"Authorization": f"Bearer {self.jwt_alice}"},
            json={
                "name": "Local Key Ref",
                "selected_ssh_key_id": str(local_ssh.id),
            },
        )
        self.assertEqual(create_res.status_code, 400)

    # --- 2. Listing & Tenant Isolation ---

    def test_list_notebooks_isolation_and_hides_tokens_and_terminated(self) -> None:
        """GET /notebooks returns only non-terminated caller sessions without raw tokens."""
        r1 = self.client.post(
            "/api/v1/notebooks",
            headers={"Authorization": f"Bearer {self.jwt_alice}"},
            json={"name": "Alice NB 1"},
        )
        nb_to_term = self.client.post(
            "/api/v1/notebooks",
            headers={"Authorization": f"Bearer {self.jwt_alice}"},
            json={"name": "Alice Terminated"},
        ).json()["id"]
        self.client.delete(
            f"/api/v1/notebooks/{nb_to_term}",
            headers={"Authorization": f"Bearer {self.jwt_alice}"},
        )
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
        self.assertEqual([n["id"] for n in alice_data["notebooks"]], [r1.json()["id"]])
        self.assertIsNone(alice_data["notebooks"][0]["access_token"])
        self.assertNotIn("ixnb_", r_alice.text)

        r_bob = self.client.get(
            "/api/v1/notebooks",
            headers={"Authorization": f"Bearer {self.jwt_bob}"},
        )
        self.assertEqual(r_bob.status_code, 200)
        bob_data = r_bob.json()
        self.assertEqual(len(bob_data["notebooks"]), 1)
        self.assertEqual(bob_data["notebooks"][0]["name"], "Bob NB 1")

    # --- 3. Retrieval & Cross-User Security ---

    def test_get_notebook_cross_user_404(self) -> None:
        """Accessing another user's notebook returns 404 to prevent enumeration."""
        resp = self.client.post(
            "/api/v1/notebooks",
            headers={"Authorization": f"Bearer {self.jwt_alice}"},
            json={"name": "Alice Secret Workload"},
        )
        nb_id = resp.json()["id"]

        r_owner = self.client.get(
            f"/api/v1/notebooks/{nb_id}",
            headers={"Authorization": f"Bearer {self.jwt_alice}"},
        )
        self.assertEqual(r_owner.status_code, 200)
        self.assertIsNone(r_owner.json()["access_token"])

        r_other = self.client.get(
            f"/api/v1/notebooks/{nb_id}",
            headers={"Authorization": f"Bearer {self.jwt_bob}"},
        )
        self.assertEqual(r_other.status_code, 404)

    # --- 4. Start, Stop, Starting Status & State Transitions ---

    def test_start_and_stop_lifecycle(self) -> None:
        """Stop and start endpoints update notebook state atomically in Supabase."""
        resp = self.client.post(
            "/api/v1/notebooks",
            headers={"Authorization": f"Bearer {self.jwt_alice}"},
            json={"name": "Lifecycle API NB"},
        )
        nb_id = resp.json()["id"]

        stop_resp = self.client.post(
            f"/api/v1/notebooks/{nb_id}/stop",
            headers={"Authorization": f"Bearer {self.jwt_alice}"},
        )
        self.assertEqual(stop_resp.status_code, 200)
        self.assertEqual(stop_resp.json()["notebook"]["status"], "stopped")

        stop_dup = self.client.post(
            f"/api/v1/notebooks/{nb_id}/stop",
            headers={"Authorization": f"Bearer {self.jwt_alice}"},
        )
        self.assertEqual(stop_dup.status_code, 409)

        start_resp = self.client.post(
            f"/api/v1/notebooks/{nb_id}/start",
            headers={"Authorization": f"Bearer {self.jwt_alice}"},
        )
        self.assertEqual(start_resp.status_code, 200)
        self.assertEqual(start_resp.json()["notebook"]["status"], "running")

        start_dup = self.client.post(
            f"/api/v1/notebooks/{nb_id}/start",
            headers={"Authorization": f"Bearer {self.jwt_alice}"},
        )
        self.assertEqual(start_dup.status_code, 409)

    def test_starting_status_exposed_and_transitionable_via_api(self) -> None:
        """Supabase rows in `starting` status list cleanly and can transition via API."""
        seeded = self.nb_transport.seed_row({
            "user_id": "user_alice_api",
            "name": "Warming Pod",
            "gpu_profile": "NVIDIA L4",
            "status": "starting",
            "runtime_type": "simulated",
        })
        nb_id = seeded["id"]

        list_res = self.client.get(
            "/api/v1/notebooks",
            headers={"Authorization": f"Bearer {self.jwt_alice}"},
        )
        self.assertEqual(list_res.status_code, 200)
        self.assertEqual(list_res.json()["notebooks"][0]["status"], "starting")

        stop_res = self.client.post(
            f"/api/v1/notebooks/{nb_id}/stop",
            headers={"Authorization": f"Bearer {self.jwt_alice}"},
        )
        self.assertEqual(stop_res.status_code, 200)
        self.assertEqual(stop_res.json()["notebook"]["status"], "stopped")

    def test_concurrent_stop_requests_single_winner_and_409(self) -> None:
        """Concurrent POST /stop requests produce one 200 OK and one 409 Conflict."""
        resp = self.client.post(
            "/api/v1/notebooks",
            headers={"Authorization": f"Bearer {self.jwt_alice}"},
            json={"name": "Race Condition NB"},
        )
        nb_id = resp.json()["id"]
        self.nb_transport.before_patch_barrier = threading.Barrier(2)

        def _hit_stop() -> int:
            return self.client.post(
                f"/api/v1/notebooks/{nb_id}/stop",
                headers={"Authorization": f"Bearer {self.jwt_alice}"},
            ).status_code

        with ThreadPoolExecutor(max_workers=2) as pool:
            f1 = pool.submit(_hit_stop)
            f2 = pool.submit(_hit_stop)
            statuses = sorted([f1.result(timeout=10), f2.result(timeout=10)])

        self.nb_transport.before_patch_barrier = None
        self.assertEqual(statuses, [200, 409])

    def test_cross_user_stop_start_delete_rejected(self) -> None:
        """User Bob cannot stop, start, or terminate Alice's notebook (all 404)."""
        resp = self.client.post(
            "/api/v1/notebooks",
            headers={"Authorization": f"Bearer {self.jwt_alice}"},
            json={"name": "Alice Private"},
        )
        nb_id = resp.json()["id"]

        self.assertEqual(
            self.client.post(
                f"/api/v1/notebooks/{nb_id}/stop",
                headers={"Authorization": f"Bearer {self.jwt_bob}"},
            ).status_code,
            404,
        )
        self.assertEqual(
            self.client.post(
                f"/api/v1/notebooks/{nb_id}/start",
                headers={"Authorization": f"Bearer {self.jwt_bob}"},
            ).status_code,
            404,
        )
        self.assertEqual(
            self.client.delete(
                f"/api/v1/notebooks/{nb_id}",
                headers={"Authorization": f"Bearer {self.jwt_bob}"},
            ).status_code,
            404,
        )

    # --- 5. Termination & Phase 1+2 Integrated ON DELETE SET NULL ---

    def test_terminate_notebook_success_and_idempotency(self) -> None:
        """DELETE terminates notebook and subsequent operations return 409."""
        resp = self.client.post(
            "/api/v1/notebooks",
            headers={"Authorization": f"Bearer {self.jwt_alice}"},
            json={"name": "To Terminate"},
        )
        nb_id = resp.json()["id"]

        del_resp = self.client.delete(
            f"/api/v1/notebooks/{nb_id}",
            headers={"Authorization": f"Bearer {self.jwt_alice}"},
        )
        self.assertEqual(del_resp.status_code, 200)
        self.assertEqual(del_resp.json()["notebook"]["status"], "terminated")

        del_dup = self.client.delete(
            f"/api/v1/notebooks/{nb_id}",
            headers={"Authorization": f"Bearer {self.jwt_alice}"},
        )
        self.assertEqual(del_dup.status_code, 409)

        start_del = self.client.post(
            f"/api/v1/notebooks/{nb_id}/start",
            headers={"Authorization": f"Bearer {self.jwt_alice}"},
        )
        self.assertEqual(start_del.status_code, 409)

    def test_ssh_key_hard_delete_nullifies_linked_notebook_ssh_key_and_keeps_notebook_working(self) -> None:
        """
        End-to-end Phase 1 + Phase 2 workflow:
        register SSH key -> bind to notebook -> permanently delete SSH key ->
        linked notebook degrades cleanly with selected_ssh_key_id=None via ON DELETE SET NULL.
        """
        new_key_pub = (
            ed25519.Ed25519PrivateKey.generate()
            .public_key()
            .public_bytes(Encoding.OpenSSH, PublicFormat.OpenSSH)
            .decode("utf-8")
        )
        key_res = self.client.post(
            "/api/v1/ssh-keys",
            headers={"Authorization": f"Bearer {self.jwt_alice}"},
            json={"name": "Ephemeral Notebook Key", "public_key": new_key_pub},
        )
        self.assertEqual(key_res.status_code, 201)
        key_id = key_res.json()["id"]

        nb_res = self.client.post(
            "/api/v1/notebooks",
            headers={"Authorization": f"Bearer {self.jwt_alice}"},
            json={
                "name": "Bound Then Detached NB",
                "selected_ssh_key_id": key_id,
            },
        )
        self.assertEqual(nb_res.status_code, 201)
        nb_id = nb_res.json()["id"]
        self.assertEqual(nb_res.json()["selected_ssh_key_id"], key_id)
        self.assertIn("id_ed25519", nb_res.json()["ssh_command"])

        # Hard-delete the SSH key via API + apply PostgreSQL ON DELETE SET NULL
        del_key = self.client.delete(
            f"/api/v1/ssh-keys/{key_id}",
            headers={"Authorization": f"Bearer {self.jwt_alice}"},
        )
        self.assertEqual(del_key.status_code, 200)
        self.nb_transport.simulate_ssh_key_deleted(key_id)

        # Notebook still loads cleanly with selected_ssh_key_id=None and fallback SSH command
        nb_after = self.client.get(
            f"/api/v1/notebooks/{nb_id}",
            headers={"Authorization": f"Bearer {self.jwt_alice}"},
        )
        self.assertEqual(nb_after.status_code, 200)
        body = nb_after.json()
        self.assertIsNone(body["selected_ssh_key_id"])
        self.assertNotIn("-i ", body["ssh_command"])

        # Lifecycle operations continue working
        stop_after = self.client.post(
            f"/api/v1/notebooks/{nb_id}/stop",
            headers={"Authorization": f"Bearer {self.jwt_alice}"},
        )
        self.assertEqual(stop_after.status_code, 200)
        self.assertEqual(stop_after.json()["notebook"]["status"], "stopped")

    def test_invalid_uuid_returns_400(self) -> None:
        """Endpoints return 400 Bad Request on invalid UUIDs."""
        bad_id = "invalid-uuid-format"
        self.assertEqual(
            self.client.get(
                f"/api/v1/notebooks/{bad_id}",
                headers={"Authorization": f"Bearer {self.jwt_alice}"},
            ).status_code,
            400,
        )
        self.assertEqual(
            self.client.post(
                f"/api/v1/notebooks/{bad_id}/start",
                headers={"Authorization": f"Bearer {self.jwt_alice}"},
            ).status_code,
            400,
        )
        self.assertEqual(
            self.client.post(
                f"/api/v1/notebooks/{bad_id}/stop",
                headers={"Authorization": f"Bearer {self.jwt_alice}"},
            ).status_code,
            400,
        )
        self.assertEqual(
            self.client.delete(
                f"/api/v1/notebooks/{bad_id}",
                headers={"Authorization": f"Bearer {self.jwt_alice}"},
            ).status_code,
            400,
        )

    # --- 6. Sanitized Error Mapping & Lifespan Pool Cleanup ---

    def test_missing_profile_fk_23503_returns_400_without_leaks(self) -> None:
        """23503 profile FK maps to sanitized 400 without exposing SQL details or hint."""
        self.nb_transport.next_response = (
            409,
            {"content-type": "application/json"},
            json.dumps({
                "code": "23503",
                "message": 'insert on table "notebook_sessions" violates foreign key constraint "notebook_sessions_user_id_fkey"',
                "details": 'Key (user_id)=(user_alice_api) is not present in table "profiles".',
                "hint": "SECRET_NB_HINT",
            }).encode(),
        )
        with self.assertLogs("inferxe.supabase_notebooks", level=logging.WARNING) as log_cm:
            resp = self.client.post(
                "/api/v1/notebooks",
                headers={"Authorization": f"Bearer {self.jwt_alice}"},
                json={"name": "No Profile Notebook"},
            )
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(
            resp.json()["detail"],
            "Customer profile must be initialized before creating notebooks.",
        )
        self.assertNotIn("SECRET_NB_HINT", resp.text)
        self.assertNotIn("notebook_sessions_user_id_fkey", resp.text)
        self.assertNotIn("SECRET_NB_HINT", "\n".join(log_cm.output))

    def test_supabase_error_mapping_503_502_and_internal_500_without_leaks(self) -> None:
        """Upstream timeouts/5xx -> 503, unhandled 4xx -> 502, unexpected exceptions -> 500 without leaks."""
        self.nb_transport.next_error = httpx2.ReadTimeout(
            "timeout calling " + "sb_secret_mock ixnb_secret_raw"
        )
        r_timeout = self.client.get(
            "/api/v1/notebooks",
            headers={"Authorization": f"Bearer {self.jwt_alice}"},
        )
        self.assertEqual(r_timeout.status_code, 503)
        self.assertNotIn("sb_secret_", r_timeout.text)
        self.assertNotIn("ixnb_secret_raw", r_timeout.text)
        self.assertNotIn("notebook-api-test", r_timeout.text)

        self.nb_transport.next_response = (
            406,
            {"content-type": "application/json"},
            json.dumps({
                "code": "42883",
                "message": "raw internal sql message",
                "details": "raw detail",
            }).encode(),
        )
        r_406 = self.client.post(
            "/api/v1/notebooks",
            headers={"Authorization": f"Bearer {self.jwt_alice}"},
            json={"name": "Fail"},
        )
        self.assertEqual(r_406.status_code, 502)
        self.assertEqual(r_406.json()["detail"], "Upstream notebook database rejected the request.")
        self.assertNotIn("raw internal sql message", r_406.text)

        with patch.object(
            self.nb_repo,
            "create_notebook_session",
            side_effect=RuntimeError("sensitive internal pool error ixnb_leak"),
        ):
            r_500 = self.client.post(
                "/api/v1/notebooks",
                headers={"Authorization": f"Bearer {self.jwt_alice}"},
                json={"name": "Unexpected Error"},
            )
        self.assertEqual(r_500.status_code, 500)
        self.assertNotIn("sensitive internal pool error", r_500.text)
        self.assertNotIn("ixnb_leak", r_500.text)
        self.assertEqual(r_500.json()["detail"], "Failed to create notebook instance.")

    def test_fastapi_lifespan_closes_both_pooled_http_clients(self) -> None:
        """FastAPI lifespan shutdown closes both SSH keys and notebooks pooled HTTP clients cleanly."""
        async def _run_lifespan() -> None:
            with (
                patch("inference.main.check_database_connection", return_value=False),
                patch("inference.main.close_shared_ssh_keys_http_client") as close_ssh_mock,
                patch("inference.main.close_shared_notebooks_http_client") as close_nb_mock,
            ):
                async with lifespan(app):
                    self.assertEqual(close_ssh_mock.call_count, 0)
                    self.assertEqual(close_nb_mock.call_count, 0)
                self.assertEqual(close_ssh_mock.call_count, 1)
                self.assertEqual(close_nb_mock.call_count, 1)

        asyncio.run(_run_lifespan())


if __name__ == "__main__":
    unittest.main()
