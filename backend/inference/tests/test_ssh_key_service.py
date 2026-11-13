"""
Unit and integration tests for the Inferxe SSH Key Management Service.
Tests cryptographic parsing, RSA/Ed25519/ECDSA validation, 2048-bit minimum checks,
private key rejection, OpenSSH SHA-256 fingerprints, and tenant duplicate detection.

Run via:
  .venv\\Scripts\\python.exe -m unittest backend/inference/tests/test_ssh_key_service.py
"""

import sys
import uuid
import base64
import hashlib
import unittest
from pathlib import Path
from datetime import datetime, timezone

# Ensure backend root is on Python path
BACKEND_DIR = Path(__file__).resolve().parents[2]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from cryptography.hazmat.primitives.asymmetric import rsa, ed25519, ec
from cryptography.hazmat.primitives.serialization import (
    Encoding,
    PublicFormat,
    PrivateFormat,
    NoEncryption,
)
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from inference.database import Base
from inference.models import SSHKey
from inference.ssh_key_service import (
    validate_and_parse_ssh_public_key,
    compute_openssh_fingerprint,
    mask_public_key,
    create_ssh_key,
    list_user_ssh_keys,
    get_ssh_key_by_id,
    delete_ssh_key,
    get_user_authorized_keys,
    SSHKeyValidationError,
    DuplicateSSHKeyError,
    ALLOWED_KEY_TYPES,
    MIN_RSA_BIT_LENGTH,
)


class TestSSHKeyService(unittest.TestCase):
    """Comprehensive test suite for SSH Key Service and database model."""

    @classmethod
    def setUpClass(cls):
        # Set up in-memory SQLite database for testing
        cls.test_engine = create_engine(
            "sqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        cls.TestingSessionLocal = sessionmaker(
            autocommit=False, autoflush=False, bind=cls.test_engine
        )
        # Create all tables (api_keys, inference_requests, ssh_keys)
        Base.metadata.create_all(bind=cls.test_engine)

        # Generate sample keys for testing
        # 1. Ed25519
        cls.ed25519_priv = ed25519.Ed25519PrivateKey.generate()
        cls.ed25519_pub = cls.ed25519_priv.public_key().public_bytes(
            Encoding.OpenSSH, PublicFormat.OpenSSH
        ).decode("utf-8")

        # 2. RSA 2048 (valid)
        cls.rsa_2048_priv = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        cls.rsa_2048_pub = cls.rsa_2048_priv.public_key().public_bytes(
            Encoding.OpenSSH, PublicFormat.OpenSSH
        ).decode("utf-8")

        # 3. RSA 4096 (valid)
        cls.rsa_4096_priv = rsa.generate_private_key(public_exponent=65537, key_size=4096)
        cls.rsa_4096_pub = cls.rsa_4096_priv.public_key().public_bytes(
            Encoding.OpenSSH, PublicFormat.OpenSSH
        ).decode("utf-8")

        # 4. RSA 1024 (insecure - must be rejected)
        cls.rsa_1024_priv = rsa.generate_private_key(public_exponent=65537, key_size=1024)
        cls.rsa_1024_pub = cls.rsa_1024_priv.public_key().public_bytes(
            Encoding.OpenSSH, PublicFormat.OpenSSH
        ).decode("utf-8")

        # 5. ECDSA NIST P-256
        cls.ecdsa_p256_priv = ec.generate_private_key(ec.SECP256R1())
        cls.ecdsa_p256_pub = cls.ecdsa_p256_priv.public_key().public_bytes(
            Encoding.OpenSSH, PublicFormat.OpenSSH
        ).decode("utf-8")

        # 6. ECDSA NIST P-384
        cls.ecdsa_p384_priv = ec.generate_private_key(ec.SECP384R1())
        cls.ecdsa_p384_pub = cls.ecdsa_p384_priv.public_key().public_bytes(
            Encoding.OpenSSH, PublicFormat.OpenSSH
        ).decode("utf-8")

    def setUp(self):
        self.db = self.TestingSessionLocal()

    def tearDown(self):
        self.db.query(SSHKey).delete()
        self.db.commit()
        self.db.close()

    # 1. Ed25519 key parsing & fingerprint
    def test_parse_valid_ed25519_key(self):
        key_with_comment = f"{self.ed25519_pub} dev@novatech.ai"
        parsed = validate_and_parse_ssh_public_key(key_with_comment)

        self.assertEqual(parsed["key_type"], "ssh-ed25519")
        self.assertEqual(parsed["comment"], "dev@novatech.ai")
        self.assertEqual(parsed["key_size"], 256)
        self.assertTrue(parsed["fingerprint"].startswith("SHA256:"))
        self.assertEqual(len(parsed["fingerprint"]), 50)  # "SHA256:" (7) + 43 b64 chars

    # 2. RSA 2048 & 4096 key parsing
    def test_parse_valid_rsa_keys(self):
        # 2048-bit
        parsed_2048 = validate_and_parse_ssh_public_key(self.rsa_2048_pub)
        self.assertEqual(parsed_2048["key_type"], "ssh-rsa")
        self.assertEqual(parsed_2048["key_size"], 2048)
        self.assertTrue(parsed_2048["fingerprint"].startswith("SHA256:"))

        # 4096-bit
        parsed_4096 = validate_and_parse_ssh_public_key(self.rsa_4096_pub)
        self.assertEqual(parsed_4096["key_type"], "ssh-rsa")
        self.assertEqual(parsed_4096["key_size"], 4096)

    # 3. ECDSA keys parsing
    def test_parse_valid_ecdsa_keys(self):
        parsed_p256 = validate_and_parse_ssh_public_key(self.ecdsa_p256_pub)
        self.assertEqual(parsed_p256["key_type"], "ecdsa-sha2-nistp256")
        self.assertEqual(parsed_p256["key_size"], 256)
        self.assertTrue(parsed_p256["fingerprint"].startswith("SHA256:"))

        parsed_p384 = validate_and_parse_ssh_public_key(self.ecdsa_p384_pub)
        self.assertEqual(parsed_p384["key_type"], "ecdsa-sha2-nistp384")
        self.assertEqual(parsed_p384["key_size"], 384)

    # 4. Reject RSA keys smaller than 2048 bits
    def test_reject_rsa_below_2048_bits(self):
        with self.assertRaises(SSHKeyValidationError) as ctx:
            validate_and_parse_ssh_public_key(self.rsa_1024_pub)
        self.assertIn("at least 2048 bits", str(ctx.exception))
        self.assertIn("1024 bits", str(ctx.exception))

    # 5. Strict rejection of private key material
    def test_reject_private_key_material(self):
        # OpenSSH private key format
        openssh_priv_bytes = self.ed25519_priv.private_bytes(
            Encoding.PEM, PrivateFormat.OpenSSH, NoEncryption()
        ).decode("utf-8")
        with self.assertRaises(SSHKeyValidationError) as ctx1:
            validate_and_parse_ssh_public_key(openssh_priv_bytes)
        self.assertIn("Private keys are strictly prohibited", str(ctx1.exception))

        # PKCS8 / RSA private key format
        rsa_priv_bytes = self.rsa_2048_priv.private_bytes(
            Encoding.PEM, PrivateFormat.PKCS8, NoEncryption()
        ).decode("utf-8")
        with self.assertRaises(SSHKeyValidationError) as ctx2:
            validate_and_parse_ssh_public_key(rsa_priv_bytes)
        self.assertIn("Private keys are strictly prohibited", str(ctx2.exception))

        # Inline "PRIVATE KEY" string attempt
        with self.assertRaises(SSHKeyValidationError) as ctx3:
            validate_and_parse_ssh_public_key("ssh-ed25519 AAAAC3NzaC1lZDI1NTE5 PRIVATE KEY user@machine")
        self.assertIn("Private keys are strictly prohibited", str(ctx3.exception))

    # 6. Reject empty or whitespace-only inputs
    def test_reject_empty_and_whitespace(self):
        for empty_val in ["", "   ", "\n\t  \n"]:
            with self.assertRaises(SSHKeyValidationError) as ctx:
                validate_and_parse_ssh_public_key(empty_val)
            self.assertIn("cannot be empty", str(ctx.exception))

    # 7. Reject malformed keys
    def test_reject_malformed_keys(self):
        malformed_cases = [
            "ssh-ed25519",  # Missing base64 blob
            "ssh-ed25519 not_a_valid_base64_blob!!",
            "just random text pasted here",
            "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5 truncated",
        ]
        for bad_key in malformed_cases:
            with self.assertRaises(SSHKeyValidationError):
                validate_and_parse_ssh_public_key(bad_key)

    # 8. Reject unsupported algorithms (e.g. ssh-dss / DSA)
    def test_reject_unsupported_key_type(self):
        fake_dss = "ssh-dss AAAAB3NzaC1kc3MAAACBA... user@test"
        with self.assertRaises(SSHKeyValidationError) as ctx:
            validate_and_parse_ssh_public_key(fake_dss)
        self.assertIn("Unsupported key algorithm", str(ctx.exception))

    # 9. Fingerprint calculation matches OpenSSH standard
    def test_fingerprint_generation_standard_matches(self):
        parts = self.ed25519_pub.split()
        raw_blob = parts[1]
        expected_digest = hashlib.sha256(base64.b64decode(raw_blob)).digest()
        expected_fp = "SHA256:" + base64.b64encode(expected_digest).decode("ascii").rstrip("=")

        computed = compute_openssh_fingerprint(raw_blob)
        self.assertEqual(computed, expected_fp)
        self.assertFalse(computed.endswith("="))  # No trailing padding per OpenSSH

    # 10. Masking helper never logs full key
    def test_mask_public_key(self):
        masked = mask_public_key(f"{self.ed25519_pub} dev@box")
        self.assertTrue(masked.startswith("ssh-ed25519"))
        self.assertIn("...", masked)
        self.assertIn("(dev@box)", masked)
        self.assertNotIn(self.ed25519_pub, masked)

    # 11. Database creation and field persistence
    def test_create_and_persist_ssh_key(self):
        user_id = "cognito_user_101"
        key = create_ssh_key(
            db=self.db,
            user_id=user_id,
            name="Primary Workstation",
            raw_public_key=f"{self.ed25519_pub} primary@workstation",
        )

        self.assertIsNotNone(key.id)
        self.assertEqual(key.user_id, user_id)
        self.assertEqual(key.name, "Primary Workstation")
        self.assertEqual(key.key_type, "ssh-ed25519")
        self.assertTrue(key.fingerprint.startswith("SHA256:"))
        self.assertIn("primary@workstation", key.public_key)

        # Verify queried from database
        persisted = self.db.query(SSHKey).filter(SSHKey.id == key.id).first()
        self.assertIsNotNone(persisted)
        self.assertEqual(persisted.name, "Primary Workstation")

    # 12. Duplicate detection for the same user
    def test_duplicate_key_rejection_same_user(self):
        user_id = "cognito_user_202"
        create_ssh_key(
            db=self.db,
            user_id=user_id,
            name="Key One",
            raw_public_key=self.ed25519_pub,
        )

        # Attempt to insert identical key for same user
        with self.assertRaises(DuplicateSSHKeyError) as ctx:
            create_ssh_key(
                db=self.db,
                user_id=user_id,
                name="Key Duplicate",
                raw_public_key=self.ed25519_pub,
            )
        self.assertIn("already exists in your account", str(ctx.exception))

    # 13. Same key allowed for different tenants (multi-tenant boundary)
    def test_same_key_allowed_for_different_users(self):
        user_a = "tenant_alpha"
        user_b = "tenant_beta"

        key_a = create_ssh_key(
            db=self.db,
            user_id=user_a,
            name="Alpha Key",
            raw_public_key=self.ed25519_pub,
        )
        key_b = create_ssh_key(
            db=self.db,
            user_id=user_b,
            name="Beta Key",
            raw_public_key=self.ed25519_pub,
        )

        self.assertNotEqual(key_a.id, key_b.id)
        self.assertEqual(key_a.fingerprint, key_b.fingerprint)
        self.assertEqual(key_a.user_id, user_a)
        self.assertEqual(key_b.user_id, user_b)

    # 14. List user SSH keys with tenant isolation
    def test_list_user_ssh_keys_tenant_isolation(self):
        user_a = "tenant_alice"
        user_b = "tenant_bob"

        # Alice creates 2 keys
        create_ssh_key(self.db, user_a, "Alice Key 1", self.ed25519_pub)
        create_ssh_key(self.db, user_a, "Alice Key 2", self.rsa_2048_pub)

        # Bob creates 1 key
        create_ssh_key(self.db, user_b, "Bob Key 1", self.ecdsa_p256_pub)

        alice_keys = list_user_ssh_keys(self.db, user_a)
        bob_keys = list_user_ssh_keys(self.db, user_b)

        self.assertEqual(len(alice_keys), 2)
        self.assertEqual(len(bob_keys), 1)
        self.assertTrue(all(k.user_id == user_a for k in alice_keys))
        self.assertTrue(all(k.user_id == user_b for k in bob_keys))

    # 15. Delete SSH key with ownership verification
    def test_delete_ssh_key_ownership(self):
        user_a = "tenant_charlie"
        user_b = "tenant_dave"

        key_a = create_ssh_key(self.db, user_a, "Charlie Key", self.ed25519_pub)

        # Dave tries to delete Charlie's key -> returns False
        deleted_by_dave = delete_ssh_key(self.db, user_b, key_a.id)
        self.assertFalse(deleted_by_dave)
        self.assertIsNotNone(get_ssh_key_by_id(self.db, user_a, key_a.id))

        # Charlie deletes their own key -> returns True
        deleted_by_charlie = delete_ssh_key(self.db, user_a, key_a.id)
        self.assertTrue(deleted_by_charlie)
        self.assertIsNone(get_ssh_key_by_id(self.db, user_a, key_a.id))

    # 16. Integration helper: get_user_authorized_keys for notebooks module
    def test_get_user_authorized_keys_for_notebooks(self):
        user_id = "tenant_notebook_user"
        create_ssh_key(self.db, user_id, "Dev Key", f"{self.ed25519_pub} user@box")
        create_ssh_key(self.db, user_id, "CI Key", f"{self.rsa_2048_pub} ci@bot")

        authorized = get_user_authorized_keys(self.db, user_id)
        self.assertEqual(len(authorized), 2)
        self.assertTrue(authorized[0].startswith("ssh-ed25519"))
        self.assertTrue(authorized[1].startswith("ssh-rsa"))


if __name__ == "__main__":
    unittest.main()

