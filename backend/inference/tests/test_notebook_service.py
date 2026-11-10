"""
Unit tests for Inferxe Notebook Management service layer and runtime drivers.
Tests cover:
  - Driver abstraction (SimulatedNotebookDriver) and simulation transparency.
  - User-scoped notebook creation, retrieval, listing, start, stop, and termination.
  - Multi-tenant isolation and foreign SSH key attachment rejection.
  - Lifecycle state machine and invalid transition enforcement.
  - Cryptographic token hashing and constant-time verification.
  - Database rollback and error handling.
"""

import os
import sys
import uuid
import unittest
from pathlib import Path
from unittest.mock import patch, MagicMock

# Force in-memory SQLite and test mode
os.environ["DATABASE_URL"] = "sqlite:///:memory:"
os.environ["INFERXE_TEST_MODE"] = "1"

BACKEND_DIR = Path(__file__).resolve().parents[2]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

# Ensure site-packages is available
SITE_PACKAGES = Path(r"C:\Inferxe-Main-project\.venv\Lib\site-packages")
if SITE_PACKAGES.exists() and str(SITE_PACKAGES) not in sys.path:
    sys.path.insert(0, str(SITE_PACKAGES))

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from inference.database import Base
from inference.models import SSHKey, NotebookInstance
from inference.notebook_service import (
    SimulatedNotebookDriver,
    create_notebook,
    list_user_notebooks,
    get_notebook,
    start_notebook,
    stop_notebook,
    terminate_notebook,
    generate_notebook_token,
    verify_notebook_token,
    serialize_notebook,
    NotebookNotFoundError,
    NotebookValidationError,
    InvalidStateTransitionError,
    SIMULATION_NOTICE,
)


class TestNotebookService(unittest.TestCase):
    """Test suite for Notebook Service and Runtime Driver."""

    @classmethod
    def setUpClass(cls):
        cls.engine = create_engine(
            "sqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        cls.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=cls.engine)
        Base.metadata.create_all(bind=cls.engine)

    def setUp(self):
        self.db = self.SessionLocal()
        self.user_alice = "user_alice_123"
        self.user_bob = "user_bob_456"

        # Create sample SSH keys
        self.alice_ssh_key = SSHKey(
            id=uuid.uuid4(),
            user_id=self.user_alice,
            name="Alice Key",
            public_key="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIG5... alice@laptop",
            fingerprint="SHA256:alice_fp_test",
            key_type="ssh-ed25519",
        )
        self.bob_ssh_key = SSHKey(
            id=uuid.uuid4(),
            user_id=self.user_bob,
            name="Bob Key",
            public_key="ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQC... bob@desktop",
            fingerprint="SHA256:bob_fp_test",
            key_type="ssh-rsa",
        )
        self.db.add_all([self.alice_ssh_key, self.bob_ssh_key])
        self.db.commit()

    def tearDown(self):
        self.db.query(NotebookInstance).delete()
        self.db.query(SSHKey).delete()
        self.db.commit()
        self.db.close()

    # --- 1. Simulated Driver Tests ---

    def test_simulated_driver_lifecycle(self):
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

    def test_token_generation_and_hashing(self):
        """Verify raw tokens start with ixnb_ and are never stored plaintext."""
        raw_token, token_hash = generate_notebook_token()
        self.assertTrue(raw_token.startswith("ixnb_"))
        self.assertNotEqual(raw_token, token_hash)
        self.assertEqual(len(token_hash), 64)  # SHA-256 hex length
        self.assertTrue(verify_notebook_token(raw_token, token_hash))
        self.assertFalse(verify_notebook_token("invalid_token", token_hash))

    # --- 3. Notebook Creation Tests ---

    def test_create_notebook_success_default_profile(self):
        """Create notebook with defaults."""
        nb, raw_token = create_notebook(
            db=self.db,
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
        # Database must only contain hash, never the raw token!
        self.assertNotEqual(nb.token_hash, raw_token)
        self.assertTrue(verify_notebook_token(raw_token, nb.token_hash))

    def test_create_notebook_with_valid_ssh_key(self):
        """Create notebook bound to customer's own SSH key."""
        nb, raw_token = create_notebook(
            db=self.db,
            user_id=self.user_alice,
            name="Alice GPU Notebook",
            gpu_profile="NVIDIA L40S",
            selected_ssh_key_id=self.alice_ssh_key.id,
        )
        self.assertEqual(nb.selected_ssh_key_id, self.alice_ssh_key.id)
        self.assertEqual(nb.ssh_key.id, self.alice_ssh_key.id)

    def test_create_notebook_rejects_foreign_ssh_key(self):
        """Customer cannot attach another customer's SSH key."""
        with self.assertRaises(NotebookValidationError) as ctx:
            create_notebook(
                db=self.db,
                user_id=self.user_alice,
                name="Alice Rogue Notebook",
                selected_ssh_key_id=self.bob_ssh_key.id,  # Belongs to Bob!
            )
        self.assertIn("does not belong to your account", str(ctx.exception))

    def test_create_notebook_rejects_nonexistent_ssh_key(self):
        """Customer cannot attach a non-existent SSH key ID."""
        with self.assertRaises(NotebookValidationError):
            create_notebook(
                db=self.db,
                user_id=self.user_alice,
                selected_ssh_key_id=uuid.uuid4(),
            )

    # --- 4. User Isolation & Listing Tests ---

    def test_list_notebooks_tenant_isolation(self):
        """Listing only returns notebooks owned by the authenticated customer."""
        create_notebook(db=self.db, user_id=self.user_alice, name="Alice 1")
        create_notebook(db=self.db, user_id=self.user_alice, name="Alice 2")
        create_notebook(db=self.db, user_id=self.user_bob, name="Bob 1")

        alice_list = list_user_notebooks(db=self.db, user_id=self.user_alice)
        bob_list = list_user_notebooks(db=self.db, user_id=self.user_bob)

        self.assertEqual(len(alice_list), 2)
        self.assertTrue(all(n.user_id == self.user_alice for n in alice_list))
        self.assertEqual(len(bob_list), 1)
        self.assertEqual(bob_list[0].name, "Bob 1")

    def test_get_notebook_tenant_isolation(self):
        """Customer cannot get another customer's notebook."""
        nb_alice, _ = create_notebook(db=self.db, user_id=self.user_alice, name="Alice Private")

        # Alice retrieves her own
        retrieved = get_notebook(db=self.db, user_id=self.user_alice, notebook_id=nb_alice.id)
        self.assertEqual(retrieved.id, nb_alice.id)

        # Bob attempts retrieval -> NotebookNotFoundError
        with self.assertRaises(NotebookNotFoundError):
            get_notebook(db=self.db, user_id=self.user_bob, notebook_id=nb_alice.id)

    # --- 5. Lifecycle State Transitions ---

    def test_stop_and_start_lifecycle(self):
        """Test transitioning running -> stopped -> running."""
        nb, _ = create_notebook(db=self.db, user_id=self.user_alice, name="Lifecycle Test")
        self.assertEqual(nb.status, "running")

        # Stop
        stopped = stop_notebook(db=self.db, user_id=self.user_alice, notebook_id=nb.id)
        self.assertEqual(stopped.status, "stopped")

        # Start again
        started = start_notebook(db=self.db, user_id=self.user_alice, notebook_id=nb.id)
        self.assertEqual(started.status, "running")

    def test_invalid_state_transitions(self):
        """Disallowed transitions must raise InvalidStateTransitionError."""
        nb, _ = create_notebook(db=self.db, user_id=self.user_alice, name="State Checks")

        # Already running -> cannot start
        with self.assertRaises(InvalidStateTransitionError):
            start_notebook(db=self.db, user_id=self.user_alice, notebook_id=nb.id)

        # Stop once -> ok
        stop_notebook(db=self.db, user_id=self.user_alice, notebook_id=nb.id)

        # Already stopped -> cannot stop again
        with self.assertRaises(InvalidStateTransitionError):
            stop_notebook(db=self.db, user_id=self.user_alice, notebook_id=nb.id)

        # Terminate
        terminated = terminate_notebook(db=self.db, user_id=self.user_alice, notebook_id=nb.id)
        self.assertEqual(terminated.status, "terminated")

        # Cannot start, stop, or re-terminate a terminated notebook
        with self.assertRaises(InvalidStateTransitionError):
            start_notebook(db=self.db, user_id=self.user_alice, notebook_id=nb.id)

        with self.assertRaises(InvalidStateTransitionError):
            stop_notebook(db=self.db, user_id=self.user_alice, notebook_id=nb.id)

        with self.assertRaises(InvalidStateTransitionError):
            terminate_notebook(db=self.db, user_id=self.user_alice, notebook_id=nb.id)

    def test_cross_user_state_modification_rejected(self):
        """User cannot start, stop, or terminate another user's notebook."""
        nb_alice, _ = create_notebook(db=self.db, user_id=self.user_alice, name="Alice Protected")

        with self.assertRaises(NotebookNotFoundError):
            stop_notebook(db=self.db, user_id=self.user_bob, notebook_id=nb_alice.id)

        with self.assertRaises(NotebookNotFoundError):
            terminate_notebook(db=self.db, user_id=self.user_bob, notebook_id=nb_alice.id)

    # --- 6. Serialization & Response Formatting ---

    def test_serialize_notebook_with_raw_token(self):
        """Serialization includes raw_token and simulation notice."""
        nb, raw_token = create_notebook(
            db=self.db,
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

    # --- 7. Database Rollback on Failure ---

    def test_database_rollback_on_failure(self):
        """Ensure failure triggers rollback cleanly."""
        with patch.object(self.db, "commit", side_effect=Exception("DB Commit Failure")):
            with self.assertRaises(Exception):
                create_notebook(db=self.db, user_id=self.user_alice, name="Failing")

        # Record should not be in the database
        items = self.db.query(NotebookInstance).filter(NotebookInstance.user_id == self.user_alice).all()
        self.assertEqual(len(items), 0)


if __name__ == "__main__":
    unittest.main()

