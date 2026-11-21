"""
test_notebook_service.py
========================
Unit tests for Inferxe Notebook Management service layer and runtime drivers
backed by Supabase (`SupabaseNotebookRepository` and `SupabaseSSHKeyRepository`).
Tests cover:
  - Driver abstraction (`SimulatedNotebookDriver`) and simulation transparency.
  - User-scoped notebook creation, retrieval, listing, start, stop, and termination.
  - Multi-tenant isolation and foreign/nonexistent SSH key attachment rejection.
  - Lifecycle state machine (`starting`, `provisioning`, `running`, `stopped`, `failed`, `terminated`)
    and concurrent invalid transition enforcement.
  - Cryptographic token hashing, constant-time verification, and write-only `token_hash` exclusion.
  - SSH key `ON DELETE SET NULL` resilience and clean handling of upstream Supabase failures.
"""

import os
import sys
import threading
import uuid
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import httpx2
from cryptography.hazmat.primitives.asymmetric import ed25519, rsa
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

# Force test mode and in-memory DB config before importing inference modules
os.environ["DATABASE_URL"] = "sqlite:///:memory:"
os.environ["INFERXE_TEST_MODE"] = "1"

BACKEND_DIR = Path(__file__).resolve().parents[2]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from inference.notebook_service import (  # noqa: E402
    SIMULATION_NOTICE,
    InvalidStateTransitionError,
    NotebookNotFoundError,
    NotebookValidationError,
    SimulatedNotebookDriver,
    create_notebook,
    format_notebook_ssh_command,
    generate_notebook_token,
    get_notebook,
    list_user_notebooks,
    serialize_notebook,
    start_notebook,
    stop_notebook,
    terminate_notebook,
    verify_notebook_token,
)
from inference.supabase_config import SupabaseSettings  # noqa: E402
from inference.supabase_notebooks import (  # noqa: E402
    SupabaseNotebookRepository,
    SupabaseNotebookServiceUnavailableError,
    close_shared_notebooks_http_client,
)
from inference.supabase_ssh_keys import (  # noqa: E402
    SupabaseSSHKeyRepository,
    close_shared_ssh_keys_http_client,
)
from inference.tests.test_supabase_notebooks import MockSupabaseNotebooksTransport  # noqa: E402
from inference.tests.test_supabase_ssh_keys import MockSupabaseSSHKeysTransport  # noqa: E402


class TestNotebookService(unittest.TestCase):
    """Test suite for Supabase-backed Notebook Service and Runtime Driver."""

    @classmethod
    def setUpClass(cls) -> None:
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
        self.user_alice = "user_alice_123"
        self.user_bob = "user_bob_456"
        self.settings = SupabaseSettings(
            url="https://notebook-service-test.supabase.co",
            service_role_key="sb_secret_" + "notebook_service_test_mock",
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
        self.repo = SupabaseNotebookRepository(
            settings=self.settings,
            timeout=5.0,
            transport=self.nb_transport,
            ssh_key_repo=self.ssh_repo,
        )

        # Register sample SSH keys in Supabase mock repository
        self.alice_ssh_key = self.ssh_repo.create_ssh_key(
            user_id=self.user_alice,
            name="Alice Key",
            raw_public_key=f"{self.ed25519_pub} alice@laptop",
        )
        self.bob_ssh_key = self.ssh_repo.create_ssh_key(
            user_id=self.user_bob,
            name="Bob Key",
            raw_public_key=f"{self.rsa_2048_pub} bob@desktop",
        )

    def tearDown(self) -> None:
        close_shared_notebooks_http_client()
        close_shared_ssh_keys_http_client()

    # --- 1. Simulated Driver Tests ---

    def test_simulated_driver_lifecycle(self) -> None:
        """Verify driver reports simulated state and correct notices."""
        driver = SimulatedNotebookDriver()
        inst_id = str(uuid.uuid4())

        prov = driver.provision(inst_id, gpu_profile="NVIDIA L4")
        self.assertEqual(prov["status"], "running")
        self.assertTrue(prov["is_simulated"])
        self.assertEqual(prov["notice"], SIMULATION_NOTICE)
        self.assertIn(".simulated.nodes.inferxe.com", prov["host"])

        started = driver.start(prov["runtime_reference"])
        self.assertEqual(started["status"], "running")
        self.assertTrue(started["is_simulated"])

        stopped = driver.stop(prov["runtime_reference"])
        self.assertEqual(stopped["status"], "stopped")

        terminated = driver.terminate(prov["runtime_reference"])
        self.assertEqual(terminated["status"], "terminated")

    # --- 2. Token Security & Hashing Tests ---

    def test_token_generation_and_hashing(self) -> None:
        """Verify raw tokens start with ixnb_ and are never stored plaintext."""
        raw_token, token_hash = generate_notebook_token()
        self.assertTrue(raw_token.startswith("ixnb_"))
        self.assertNotEqual(raw_token, token_hash)
        self.assertEqual(len(token_hash), 64)  # SHA-256 hex length
        self.assertTrue(verify_notebook_token(raw_token, token_hash))
        self.assertFalse(verify_notebook_token("invalid_token", token_hash))

    # --- 3. Notebook Creation Tests ---

    def test_create_notebook_success_default_profile(self) -> None:
        """Create notebook with defaults and verify SHA-256 token hash persistence."""
        nb, raw_token = create_notebook(
            repo=self.repo,
            user_id=self.user_alice,
            name="Alice Analytics",
        )
        self.assertIsNotNone(nb.id)
        self.assertEqual(nb.user_id, self.user_alice)
        self.assertEqual(nb.name, "Alice Analytics")
        self.assertEqual(nb.gpu_profile, "NVIDIA L4")
        self.assertEqual(nb.status, "running")
        self.assertEqual(nb.runtime_type, "simulated")
        self.assertTrue(raw_token.startswith("ixnb_"))
        self.assertFalse(hasattr(nb, "token_hash"))

        # Supabase stored row must contain only SHA-256 hash, never raw token
        stored = self.nb_transport.rows[str(nb.id)]
        self.assertNotEqual(stored["token_hash"], raw_token)
        self.assertTrue(verify_notebook_token(raw_token, stored["token_hash"]))

    def test_create_notebook_with_valid_ssh_key(self) -> None:
        """Create notebook bound to customer's own SSH key."""
        nb, _ = create_notebook(
            repo=self.repo,
            user_id=self.user_alice,
            name="Alice GPU Notebook",
            gpu_profile="NVIDIA L40S",
            selected_ssh_key_id=self.alice_ssh_key.id,
        )
        self.assertEqual(nb.selected_ssh_key_id, self.alice_ssh_key.id)
        self.assertEqual(nb.ssh_key_type, "ssh-ed25519")

    def test_create_notebook_rejects_foreign_ssh_key(self) -> None:
        """Customer cannot attach another customer's SSH key."""
        with self.assertRaises(NotebookValidationError) as ctx:
            create_notebook(
                repo=self.repo,
                user_id=self.user_alice,
                name="Alice Rogue Notebook",
                selected_ssh_key_id=self.bob_ssh_key.id,  # Belongs to Bob!
            )
        self.assertIn("does not belong to your account", str(ctx.exception))
        self.assertEqual(len(self.nb_transport.rows), 0)

    def test_create_notebook_rejects_nonexistent_ssh_key(self) -> None:
        """Customer cannot attach a non-existent SSH key ID."""
        with self.assertRaises(NotebookValidationError):
            create_notebook(
                repo=self.repo,
                user_id=self.user_alice,
                selected_ssh_key_id=uuid.uuid4(),
            )
        self.assertEqual(len(self.nb_transport.rows), 0)

    # --- 4. User Isolation & Listing Tests ---

    def test_list_notebooks_tenant_isolation(self) -> None:
        """Listing only returns notebooks owned by the authenticated customer."""
        create_notebook(repo=self.repo, user_id=self.user_alice, name="Alice 1")
        create_notebook(repo=self.repo, user_id=self.user_alice, name="Alice 2")
        create_notebook(repo=self.repo, user_id=self.user_bob, name="Bob 1")

        alice_list = list_user_notebooks(repo=self.repo, user_id=self.user_alice)
        bob_list = list_user_notebooks(repo=self.repo, user_id=self.user_bob)

        self.assertEqual(len(alice_list), 2)
        self.assertTrue(all(n.user_id == self.user_alice for n in alice_list))
        self.assertEqual(len(bob_list), 1)
        self.assertEqual(bob_list[0].name, "Bob 1")

    def test_get_notebook_tenant_isolation(self) -> None:
        """Customer cannot get another customer's notebook."""
        nb_alice, _ = create_notebook(repo=self.repo, user_id=self.user_alice, name="Alice Private")

        # Alice retrieves her own
        retrieved = get_notebook(repo=self.repo, user_id=self.user_alice, notebook_id=nb_alice.id)
        self.assertEqual(retrieved.id, nb_alice.id)

        # Bob attempts retrieval -> NotebookNotFoundError
        with self.assertRaises(NotebookNotFoundError):
            get_notebook(repo=self.repo, user_id=self.user_bob, notebook_id=nb_alice.id)

    # --- 5. Lifecycle State Transitions ---

    def test_stop_and_start_lifecycle(self) -> None:
        """Test transitioning running -> stopped -> running."""
        nb, _ = create_notebook(repo=self.repo, user_id=self.user_alice, name="Lifecycle Test")
        self.assertEqual(nb.status, "running")

        # Stop
        stopped = stop_notebook(repo=self.repo, user_id=self.user_alice, notebook_id=nb.id)
        self.assertEqual(stopped.status, "stopped")

        # Start again
        started = start_notebook(repo=self.repo, user_id=self.user_alice, notebook_id=nb.id)
        self.assertEqual(started.status, "running")

    def test_starting_status_transitions(self) -> None:
        """Verify notebooks in Supabase `starting` state can start or stop cleanly."""
        starting_start_row = self.nb_transport.seed_row({
            "user_id": self.user_alice,
            "name": "Booting Notebook Start",
            "gpu_profile": "NVIDIA L4",
            "status": "starting",
            "runtime_type": "simulated",
        })
        started = start_notebook(
            repo=self.repo,
            user_id=self.user_alice,
            notebook_id=starting_start_row["id"],
        )
        self.assertEqual(started.status, "running")

        starting_stop_row = self.nb_transport.seed_row({
            "user_id": self.user_alice,
            "name": "Booting Notebook Stop",
            "gpu_profile": "NVIDIA L4",
            "status": "starting",
            "runtime_type": "simulated",
        })
        stopped = stop_notebook(
            repo=self.repo,
            user_id=self.user_alice,
            notebook_id=starting_stop_row["id"],
        )
        self.assertEqual(stopped.status, "stopped")

    def test_invalid_state_transitions(self) -> None:
        """Disallowed transitions must raise InvalidStateTransitionError."""
        nb, _ = create_notebook(repo=self.repo, user_id=self.user_alice, name="State Checks")

        # Already running -> cannot start
        with self.assertRaises(InvalidStateTransitionError):
            start_notebook(repo=self.repo, user_id=self.user_alice, notebook_id=nb.id)

        # Stop once -> ok
        stop_notebook(repo=self.repo, user_id=self.user_alice, notebook_id=nb.id)

        # Already stopped -> cannot stop again
        with self.assertRaises(InvalidStateTransitionError):
            stop_notebook(repo=self.repo, user_id=self.user_alice, notebook_id=nb.id)

        # Terminate
        terminated = terminate_notebook(repo=self.repo, user_id=self.user_alice, notebook_id=nb.id)
        self.assertEqual(terminated.status, "terminated")

        # Cannot start, stop, or re-terminate a terminated notebook
        with self.assertRaises(InvalidStateTransitionError):
            start_notebook(repo=self.repo, user_id=self.user_alice, notebook_id=nb.id)

        with self.assertRaises(InvalidStateTransitionError):
            stop_notebook(repo=self.repo, user_id=self.user_alice, notebook_id=nb.id)

        with self.assertRaises(InvalidStateTransitionError):
            terminate_notebook(repo=self.repo, user_id=self.user_alice, notebook_id=nb.id)

    def test_concurrent_stop_service_conflict_safety(self) -> None:
        """Concurrent stop_notebook calls allow one winner and raise InvalidStateTransitionError for loser."""
        nb, _ = create_notebook(repo=self.repo, user_id=self.user_alice, name="Concurrent Stop")
        self.nb_transport.before_patch_barrier = threading.Barrier(2)

        def _worker() -> str:
            try:
                stopped = stop_notebook(repo=self.repo, user_id=self.user_alice, notebook_id=nb.id)
                return f"stopped:{stopped.status}"
            except InvalidStateTransitionError as conflict:
                return f"conflict:{conflict}"

        with ThreadPoolExecutor(max_workers=2) as pool:
            f1 = pool.submit(_worker)
            f2 = pool.submit(_worker)
            outcomes = [f1.result(timeout=10), f2.result(timeout=10)]

        self.nb_transport.before_patch_barrier = None
        self.assertEqual(len([o for o in outcomes if o == "stopped:stopped"]), 1)
        self.assertEqual(len([o for o in outcomes if o.startswith("conflict:")]), 1)

    def test_cross_user_state_modification_rejected(self) -> None:
        """User cannot start, stop, or terminate another user's notebook."""
        nb_alice, _ = create_notebook(repo=self.repo, user_id=self.user_alice, name="Alice Protected")

        with self.assertRaises(NotebookNotFoundError):
            start_notebook(repo=self.repo, user_id=self.user_bob, notebook_id=nb_alice.id)

        with self.assertRaises(NotebookNotFoundError):
            stop_notebook(repo=self.repo, user_id=self.user_bob, notebook_id=nb_alice.id)

        with self.assertRaises(NotebookNotFoundError):
            terminate_notebook(repo=self.repo, user_id=self.user_bob, notebook_id=nb_alice.id)

    # --- 6. Serialization, SSH Key Enrichment & ON DELETE SET NULL ---

    def test_serialize_notebook_with_raw_token_and_ssh_key_deletion_resilience(self) -> None:
        """Serialization includes raw_token once, formats key path, and survives SSH key deletion."""
        nb, raw_token = create_notebook(
            repo=self.repo,
            user_id=self.user_alice,
            name="Alice Server",
            selected_ssh_key_id=self.alice_ssh_key.id,
        )
        resp = serialize_notebook(nb, raw_token=raw_token)
        self.assertEqual(resp.name, "Alice Server")
        self.assertEqual(resp.access_token, raw_token)
        self.assertTrue(resp.is_simulated)
        self.assertEqual(resp.simulation_notice, SIMULATION_NOTICE)
        self.assertIn(raw_token, resp.jupyter_url)
        self.assertIn("id_ed25519", resp.ssh_command)

        # Permanently delete the SSH key (ON DELETE SET NULL on selected_ssh_key_id)
        self.assertTrue(self.ssh_repo.delete_ssh_key(self.user_alice, self.alice_ssh_key.id))
        self.nb_transport.simulate_ssh_key_deleted(str(self.alice_ssh_key.id))

        fetched = get_notebook(repo=self.repo, user_id=self.user_alice, notebook_id=nb.id)
        resp_after = serialize_notebook(fetched)
        self.assertIsNone(resp_after.selected_ssh_key_id)
        self.assertIsNone(resp_after.access_token)
        self.assertEqual(
            format_notebook_ssh_command(fetched, "abc.simulated.nodes.inferxe.com"),
            "ssh -p 2222 ubuntu@abc.simulated.nodes.inferxe.com",
        )

    # --- 7. Upstream Failure Atomicity ---

    def test_upstream_persistence_failure_leaves_no_partial_record(self) -> None:
        """Ensure Supabase persistence failures raise sanitized service error with no leaked row."""
        self.nb_transport.next_error = httpx2.ConnectError("upstream down")
        with self.assertRaises(SupabaseNotebookServiceUnavailableError):
            create_notebook(repo=self.repo, user_id=self.user_alice, name="Failing")

        self.assertEqual(len(self.nb_transport.rows), 0)
        self.assertEqual(list_user_notebooks(repo=self.repo, user_id=self.user_alice), [])


if __name__ == "__main__":
    unittest.main()
