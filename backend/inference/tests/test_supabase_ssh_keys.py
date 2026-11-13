"""
test_supabase_ssh_keys.py
=========================
Comprehensive unit tests for Phase 1 Inferxe Supabase SSH Keys integration
(`backend/inference/supabase_ssh_keys.py`).

Covers:
- Live Supabase `ssh_public_keys` schema parity (rejects unknown columns like `key_type`)
- Deterministic `key_type` derivation from `public_key`
- OpenSSH cryptographic validation, private key rejection, and RSA >= 2048-bit enforcement
- URL-encoding of fingerprint filters containing `+`, `/`, and `:`
- Tenant-scoped create, list, get-by-ID, authorized-keys lookup, and permanent hard DELETE
- Re-registration after permanent delete
- Concurrent `23505` duplicate conflict & `23503` missing-profile FK error mapping
- Pooled `httpx2.Client` HTTP/1.1 transport sharing across threads and clean close lifecycle
- Timeouts, transport errors, 5xx errors, and strictly sanitized logging (zero secrets,
  zero full public keys, zero raw PostgREST `details` / `hint`)
"""

import json
import logging
import os
import sys
import threading
import unittest
import urllib.parse
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from unittest.mock import patch

import httpx2
from cryptography.hazmat.primitives.asymmetric import ec, ed25519, rsa
from cryptography.hazmat.primitives.serialization import (
    Encoding,
    NoEncryption,
    PrivateFormat,
    PublicFormat,
)

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("INFERXE_TEST_MODE", "1")

BACKEND_DIR = Path(__file__).resolve().parents[2]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from inference.ssh_key_service import (  # noqa: E402
    DuplicateSSHKeyError,
    SSHKeyValidationError,
    validate_and_parse_ssh_public_key,
)
from inference.supabase_config import SupabaseConfigurationError, SupabaseSettings  # noqa: E402
from inference.supabase_ssh_keys import (  # noqa: E402
    SupabaseSSHKeyError,
    SupabaseSSHKeyRecord,
    SupabaseSSHKeyRepository,
    SupabaseSSHKeyServiceUnavailableError,
    SupabaseSSHKeyValidationError,
    close_shared_ssh_keys_http_client,
    derive_ssh_key_type,
)

SUPABASE_SSH_PUBLIC_KEYS_COLUMNS = {
    "id",
    "user_id",
    "name",
    "public_key",
    "fingerprint",
    "created_at",
    "revoked_at",
}


class MockSupabaseSSHKeysTransport:
    """
    Thread-safe in-memory PostgREST simulator modeling live Supabase `ssh_public_keys`:
    - Enforces exact Supabase columns (rejects `key_type` with `PGRST204`).
    - Supports `GET`, `POST`, and permanent hard `DELETE`.
    - Enforces per-tenant unique `(user_id, fingerprint)` returning SQLSTATE `23505`.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.rows: Dict[str, Dict[str, Any]] = {}
        self.requests: List[Dict[str, Any]] = []
        self.next_error: Optional[Exception] = None
        self.next_response: Optional[Tuple[int, Dict[str, str], bytes]] = None

    def seed_row(self, row: Dict[str, Any]) -> Dict[str, Any]:
        unknown = set(row.keys()) - SUPABASE_SSH_PUBLIC_KEYS_COLUMNS
        if unknown:
            raise AssertionError(f"Unknown Supabase ssh_public_keys columns in seed: {unknown}")
        stored = {
            "id": str(row.get("id") or uuid.uuid4()),
            "user_id": row["user_id"],
            "name": row.get("name", "Seeded SSH Key"),
            "public_key": row["public_key"],
            "fingerprint": row["fingerprint"],
            "created_at": row.get("created_at") or datetime.now(timezone.utc).isoformat(),
            "revoked_at": row.get("revoked_at"),
        }
        with self._lock:
            self.rows[stored["id"]] = stored
        return stored

    def __call__(
        self,
        method: str,
        url: str,
        headers: Dict[str, str],
        body: Optional[bytes],
        timeout: float,
    ) -> Tuple[int, Dict[str, str], bytes]:
        parsed = urllib.parse.urlparse(url)
        query = urllib.parse.parse_qs(parsed.query, keep_blank_values=True)
        parsed_body = json.loads(body.decode("utf-8")) if body else None
        with self._lock:
            self.requests.append({
                "method": method,
                "path": parsed.path,
                "raw_query": parsed.query,
                "query": query,
                "headers": dict(headers),
                "body": parsed_body,
                "timeout": timeout,
            })

            if self.next_error is not None:
                err = self.next_error
                self.next_error = None
                raise err

            if self.next_response is not None:
                resp = self.next_response
                self.next_response = None
                return resp

            if not parsed.path.endswith("/rest/v1/ssh_public_keys"):
                return (
                    404,
                    {"content-type": "application/json"},
                    json.dumps({"message": "Not found"}).encode(),
                )

            select_cols: Optional[List[str]] = None
            if "select" in query:
                select_cols = [c.strip() for c in query["select"][0].split(",") if c.strip()]
                unknown_sel = set(select_cols) - SUPABASE_SSH_PUBLIC_KEYS_COLUMNS
                if unknown_sel:
                    return (
                        400,
                        {"content-type": "application/json"},
                        json.dumps({
                            "code": "PGRST204",
                            "message": f"Unknown columns: {sorted(unknown_sel)}",
                        }).encode(),
                    )

            if method == "POST":
                assert isinstance(parsed_body, dict)
                unknown_ins = set(parsed_body.keys()) - SUPABASE_SSH_PUBLIC_KEYS_COLUMNS
                if unknown_ins:
                    return (
                        400,
                        {"content-type": "application/json"},
                        json.dumps({
                            "code": "PGRST204",
                            "message": f"Could not find columns {sorted(unknown_ins)}",
                        }).encode(),
                    )
                for req_col in ("id", "user_id", "name", "public_key", "fingerprint"):
                    if not parsed_body.get(req_col):
                        return (
                            400,
                            {"content-type": "application/json"},
                            json.dumps({
                                "code": "23502",
                                "message": f"null value in column {req_col}",
                            }).encode(),
                        )
                # Enforce per-tenant unique (user_id, fingerprint)
                for existing in self.rows.values():
                    if (
                        existing["user_id"] == parsed_body["user_id"]
                        and existing["fingerprint"] == parsed_body["fingerprint"]
                    ):
                        return (
                            409,
                            {"content-type": "application/json"},
                            json.dumps({
                                "code": "23505",
                                "message": 'duplicate key value violates unique constraint "uq_ssh_public_keys_user_fingerprint"',
                                "details": f'Key (user_id, fingerprint)=({parsed_body["user_id"]}, {parsed_body["fingerprint"]}) already exists.',
                            }).encode(),
                        )
                stored = {
                    "id": str(parsed_body.get("id") or uuid.uuid4()),
                    "user_id": parsed_body["user_id"],
                    "name": parsed_body["name"],
                    "public_key": parsed_body["public_key"],
                    "fingerprint": parsed_body["fingerprint"],
                    "created_at": parsed_body.get("created_at") or datetime.now(timezone.utc).isoformat(),
                    "revoked_at": None,
                }
                self.rows[stored["id"]] = stored
                return (
                    201,
                    {"content-type": "application/json"},
                    json.dumps([self._project(stored, select_cols)]).encode(),
                )

            if method in ("GET", "DELETE"):
                filter_checks: List[Tuple[str, str, Optional[str]]] = []
                for k, vals in query.items():
                    if k in ("select", "order", "limit"):
                        continue
                    if k not in SUPABASE_SSH_PUBLIC_KEYS_COLUMNS:
                        return (
                            400,
                            {"content-type": "application/json"},
                            json.dumps({
                                "code": "PGRST204",
                                "message": f"Unknown filter column {k}",
                            }).encode(),
                        )
                    for val in vals:
                        if val == "is.null":
                            filter_checks.append((k, "is.null", None))
                        elif val.startswith("eq."):
                            filter_checks.append((k, "eq", val[3:]))
                        else:
                            raise AssertionError(f"Unexpected filter expression for {k}: {val}")

                def _matches(row: Dict[str, Any]) -> bool:
                    for fk, op, fval in filter_checks:
                        cur = row.get(fk)
                        if op == "is.null":
                            if cur is not None:
                                return False
                        else:
                            if cur is None or str(cur) != fval:
                                return False
                    return True

                matched = [row for row in self.rows.values() if _matches(row)]

                if method == "GET":
                    order_expr = query.get("order", [""])[0]
                    if order_expr == "created_at.desc":
                        matched.sort(key=lambda r: r.get("created_at") or "", reverse=True)
                    elif order_expr == "created_at.asc":
                        matched.sort(key=lambda r: r.get("created_at") or "")
                    if "limit" in query:
                        matched = matched[: int(query["limit"][0])]
                    projected = [self._project(r, select_cols) for r in matched]
                    return 200, {"content-type": "application/json"}, json.dumps(projected).encode()

                # Permanent hard DELETE
                deleted_projected: List[Dict[str, Any]] = []
                for row in list(matched):
                    removed = self.rows.pop(row["id"])
                    deleted_projected.append(self._project(removed, select_cols))
                if headers.get("Prefer") == "return=minimal":
                    return 204, {}, b""
                return (
                    200,
                    {"content-type": "application/json"},
                    json.dumps(deleted_projected).encode(),
                )

            return 405, {}, b""

    @staticmethod
    def _project(row: Dict[str, Any], select_cols: Optional[List[str]]) -> Dict[str, Any]:
        if not select_cols:
            return dict(row)
        return {col: row.get(col) for col in select_cols}


class _CaptureLogHandler(logging.Handler):
    def __init__(self) -> None:
        super().__init__(level=logging.DEBUG)
        self.messages: List[str] = []

    def emit(self, record: logging.LogRecord) -> None:
        self.messages.append(self.format(record))


class TestSupabaseSSHKeyRepository(unittest.TestCase):
    """Focused unit tests for `SupabaseSSHKeyRepository`."""

    @classmethod
    def setUpClass(cls) -> None:
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

        cls.ecdsa_p256_priv = ec.generate_private_key(ec.SECP256R1())
        cls.ecdsa_p256_pub = cls.ecdsa_p256_priv.public_key().public_bytes(
            Encoding.OpenSSH, PublicFormat.OpenSSH
        ).decode("utf-8")

        cls.ecdsa_p384_priv = ec.generate_private_key(ec.SECP384R1())
        cls.ecdsa_p384_pub = cls.ecdsa_p384_priv.public_key().public_bytes(
            Encoding.OpenSSH, PublicFormat.OpenSSH
        ).decode("utf-8")

        # Deterministically locate an Ed25519 public key whose OpenSSH SHA-256 fingerprint
        # contains both '+' and '/' so URL percent-encoding is exercised end-to-end.
        cls.special_fp_pub = None
        for _ in range(500):
            candidate_pub = (
                ed25519.Ed25519PrivateKey.generate()
                .public_key()
                .public_bytes(Encoding.OpenSSH, PublicFormat.OpenSSH)
                .decode("utf-8")
            )
            fp = validate_and_parse_ssh_public_key(candidate_pub)["fingerprint"]
            if "+" in fp and "/" in fp:
                cls.special_fp_pub = candidate_pub
                cls.special_fp = fp
                break
        if cls.special_fp_pub is None:
            raise RuntimeError("Could not generate SSH key containing both '+' and '/' in fingerprint.")

    def setUp(self) -> None:
        # Dynamically construct synthetic test key so GitHub Push Protection does not flag mock fixtures
        self.secret_key = "sb_secret_" + "mock_test_key"
        self.supabase_url = "https://unit-test-project.supabase.co"
        self.settings = SupabaseSettings(url=self.supabase_url, service_role_key=self.secret_key)
        self.transport = MockSupabaseSSHKeysTransport()
        self.repo = SupabaseSSHKeyRepository(
            settings=self.settings,
            timeout=7.5,
            transport=self.transport,
        )

    def tearDown(self) -> None:
        close_shared_ssh_keys_http_client()

    def test_derive_ssh_key_type_for_all_supported_algorithms(self) -> None:
        self.assertEqual(derive_ssh_key_type(f"  {self.ed25519_pub} user@host "), "ssh-ed25519")
        self.assertEqual(derive_ssh_key_type(self.rsa_2048_pub), "ssh-rsa")
        self.assertEqual(derive_ssh_key_type(self.ecdsa_p256_pub), "ecdsa-sha2-nistp256")
        self.assertEqual(derive_ssh_key_type(self.ecdsa_p384_pub), "ecdsa-sha2-nistp384")
        self.assertEqual(derive_ssh_key_type("SSH-RSA AAAAB3Nza..."), "ssh-rsa")
        self.assertEqual(derive_ssh_key_type(""), "unknown")
        self.assertEqual(derive_ssh_key_type(None), "unknown")

    def test_create_ssh_key_schema_parity_and_derived_key_type(self) -> None:
        record = self.repo.create_ssh_key(
            user_id="cognito-sub-alice",
            name="Alice MacBook Pro",
            raw_public_key=f"  {self.ed25519_pub} alice@mbp  ",
        )
        self.assertIsInstance(record.id, uuid.UUID)
        self.assertEqual(record.user_id, "cognito-sub-alice")
        self.assertEqual(record.name, "Alice MacBook Pro")
        self.assertEqual(record.key_type, "ssh-ed25519")
        self.assertTrue(record.fingerprint.startswith("SHA256:"))
        self.assertIn("alice@mbp", record.public_key)
        self.assertIsNotNone(record.created_at)

        post_reqs = [r for r in self.transport.requests if r["method"] == "POST"]
        self.assertEqual(len(post_reqs), 1)
        payload = post_reqs[0]["body"]
        self.assertEqual(
            set(payload.keys()),
            {"id", "user_id", "name", "public_key", "fingerprint", "created_at"},
        )
        self.assertNotIn("key_type", payload)
        self.assertEqual(post_reqs[0]["headers"].get("apikey"), self.secret_key)
        self.assertNotIn("Authorization", post_reqs[0]["headers"])
        self.assertEqual(post_reqs[0]["headers"].get("Prefer"), "return=representation")

        # JWT secret format includes Bearer header as well
        jwt_settings = SupabaseSettings(
            url=self.supabase_url,
            service_role_key="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.sig",
        )
        jwt_repo = SupabaseSSHKeyRepository(settings=jwt_settings, transport=self.transport)
        jwt_repo.create_ssh_key(
            user_id="cognito-sub-jwt",
            name="RSA Workstation",
            raw_public_key=self.rsa_2048_pub,
        )
        last_post = self.transport.requests[-1]
        self.assertEqual(
            last_post["headers"].get("Authorization"),
            f"Bearer {jwt_settings.service_role_key}",
        )

    def test_create_uses_comment_or_algorithm_when_name_blank(self) -> None:
        r1 = self.repo.create_ssh_key(
            user_id="u-1",
            name="   ",
            raw_public_key=f"{self.ed25519_pub} ops@gpu-node",
        )
        self.assertEqual(r1.name, "ops@gpu-node")

        r2 = self.repo.create_ssh_key(
            user_id="u-2",
            name=None,
            raw_public_key=self.rsa_2048_pub,
        )
        self.assertEqual(r2.name, "SSH Key (ssh-rsa)")

    def test_validation_rejects_private_weak_rsa_and_malformed_keys(self) -> None:
        openssh_priv = self.ed25519_priv.private_bytes(
            Encoding.PEM, PrivateFormat.OpenSSH, NoEncryption()
        ).decode("utf-8")
        with self.assertRaises(SSHKeyValidationError):
            self.repo.create_ssh_key("u-1", "Leak", openssh_priv)

        with self.assertRaises(SSHKeyValidationError):
            self.repo.create_ssh_key("u-1", "Weak", self.rsa_1024_pub)

        with self.assertRaises(SSHKeyValidationError):
            self.repo.create_ssh_key("u-1", "Unsupported", "ssh-dss AAAAB3NzaC1kc3M= user@box")

        with self.assertRaises(SSHKeyValidationError):
            self.repo.create_ssh_key("u-1", "Bad", "ssh-ed25519 not-valid-base64")

        with self.assertRaises(SSHKeyValidationError):
            self.repo.create_ssh_key("   ", "Valid Name", self.ed25519_pub)

        # Validation failures must never make network calls
        self.assertEqual(len(self.transport.requests), 0)

    def test_fingerprint_filter_url_encodes_plus_slash_and_colon(self) -> None:
        created = self.repo.create_ssh_key(
            user_id="u-special-fp",
            name="Special FP Key",
            raw_public_key=self.special_fp_pub,
        )
        self.assertEqual(created.fingerprint, self.special_fp)

        dup_check_req = [
            r
            for r in self.transport.requests
            if r["method"] == "GET" and "fingerprint" in r["query"]
        ][0]
        raw_qs = dup_check_req["raw_query"]
        self.assertIn("%3A", raw_qs)
        self.assertIn("%2B", raw_qs)
        self.assertIn("%2F", raw_qs)
        self.assertNotIn("+", raw_qs)
        self.assertEqual(dup_check_req["query"]["fingerprint"][0], f"eq.{self.special_fp}")

        with self.assertRaises(DuplicateSSHKeyError) as ctx:
            self.repo.create_ssh_key(
                user_id="u-special-fp",
                name="Duplicate Attempt",
                raw_public_key=self.special_fp_pub,
            )
        self.assertIn("already exists in your account", str(ctx.exception))
        self.assertIn("Special FP Key", str(ctx.exception))

    def test_same_key_allowed_for_different_tenants_and_list_is_isolated(self) -> None:
        k_alice_1 = self.repo.create_ssh_key("sub-alice", "Alice Ed", self.ed25519_pub)
        k_alice_2 = self.repo.create_ssh_key("sub-alice", "Alice ECDSA", self.ecdsa_p256_pub)
        k_bob = self.repo.create_ssh_key("sub-bob", "Bob Ed", self.ed25519_pub)

        self.assertNotEqual(k_alice_1.id, k_bob.id)
        self.assertEqual(k_alice_1.fingerprint, k_bob.fingerprint)

        alice_list = self.repo.list_user_ssh_keys("sub-alice")
        bob_list = self.repo.list_user_ssh_keys("sub-bob")
        self.assertEqual({k.id for k in alice_list}, {k_alice_1.id, k_alice_2.id})
        self.assertEqual({k.id for k in bob_list}, {k_bob.id})
        self.assertEqual(
            {k.key_type for k in alice_list},
            {"ssh-ed25519", "ecdsa-sha2-nistp256"},
        )

        # Defense-in-depth: even if transport returned another user's row, repository filters it out
        foreign_row = {
            "id": str(uuid.uuid4()),
            "user_id": "sub-other",
            "name": "Leaked",
            "public_key": self.rsa_2048_pub,
            "fingerprint": "SHA256:leaked",
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        self.transport.next_response = (
            200,
            {"content-type": "application/json"},
            json.dumps([foreign_row]).encode(),
        )
        self.assertEqual(self.repo.list_user_ssh_keys("sub-alice"), [])

    def test_get_ssh_key_by_id_and_authorized_keys_tenant_isolation(self) -> None:
        k_alice = self.repo.create_ssh_key("sub-alice", "Alice Key", self.ed25519_pub)
        self.repo.create_ssh_key("sub-alice", "Alice Second", self.rsa_2048_pub)
        self.repo.create_ssh_key("sub-bob", "Bob Key", self.ecdsa_p256_pub)

        found = self.repo.get_ssh_key_by_id("sub-alice", k_alice.id)
        self.assertIsNotNone(found)
        self.assertEqual(found.id, k_alice.id)
        self.assertEqual(found.key_type, "ssh-ed25519")

        # Cross-user lookup returns None
        self.assertIsNone(self.repo.get_ssh_key_by_id("sub-bob", k_alice.id))
        # Non-existent UUID returns None
        self.assertIsNone(self.repo.get_ssh_key_by_id("sub-alice", uuid.uuid4()))

        with self.assertRaises(SupabaseSSHKeyValidationError):
            self.repo.get_ssh_key_by_id("sub-alice", "not-a-uuid")

        auth_keys = self.repo.get_user_authorized_keys("sub-alice")
        self.assertEqual(len(auth_keys), 2)
        self.assertTrue(auth_keys[0].startswith("ssh-ed25519"))
        self.assertTrue(auth_keys[1].startswith("ssh-rsa"))

    def test_permanent_hard_delete_and_re_add_behavior(self) -> None:
        k_alice = self.repo.create_ssh_key("sub-alice", "Removable Key", self.ed25519_pub)

        # Cross-user delete fails closed (returns False, row remains intact)
        self.assertFalse(self.repo.delete_ssh_key("sub-bob", k_alice.id))
        self.assertIn(str(k_alice.id), self.transport.rows)

        # Non-existent key delete returns False
        self.assertFalse(self.repo.delete_ssh_key("sub-alice", uuid.uuid4()))

        # Owner deletes -> HTTP DELETE executed and row permanently removed
        self.transport.requests.clear()
        self.assertTrue(self.repo.delete_ssh_key("sub-alice", str(k_alice.id)))
        self.assertNotIn(str(k_alice.id), self.transport.rows)
        self.assertEqual(len(self.transport.requests), 1)
        del_req = self.transport.requests[0]
        self.assertEqual(del_req["method"], "DELETE")
        self.assertEqual(del_req["query"]["id"][0], f"eq.{k_alice.id}")
        self.assertEqual(del_req["query"]["user_id"][0], "eq.sub-alice")
        self.assertEqual(del_req["headers"].get("Prefer"), "return=representation")

        # Deleting a second time returns False
        self.assertFalse(self.repo.delete_ssh_key("sub-alice", k_alice.id))

        # Re-adding identical key after permanent hard DELETE succeeds cleanly
        recreated = self.repo.create_ssh_key("sub-alice", "Re-added Key", self.ed25519_pub)
        self.assertNotEqual(recreated.id, k_alice.id)
        self.assertEqual(recreated.fingerprint, k_alice.fingerprint)

    def test_23505_concurrent_duplicate_and_23503_fk_errors(self) -> None:
        # Simulate race condition: GET returns [] then POST hits 23505
        self.transport.seed_row({
            "id": str(uuid.uuid4()),
            "user_id": "sub-race",
            "name": "Existing",
            "public_key": self.ed25519_pub,
            "fingerprint": validate_and_parse_ssh_public_key(self.ed25519_pub)["fingerprint"],
        })
        original_call = self.transport.__call__

        def race_transport(method: str, url: str, headers: Dict[str, str], body: Optional[bytes], timeout: float):
            if method == "GET":
                return 200, {"content-type": "application/json"}, b"[]"
            return original_call(method, url, headers, body, timeout)

        race_repo = SupabaseSSHKeyRepository(settings=self.settings, transport=race_transport)
        with self.assertRaises(DuplicateSSHKeyError):
            race_repo.create_ssh_key("sub-race", "Concurrent", self.ed25519_pub)

        # Simulate missing profile FK violation (23503) on POST after empty GET
        def fk_transport(method: str, url: str, headers: Dict[str, str], body: Optional[bytes], timeout: float):
            if method == "GET":
                return 200, {"content-type": "application/json"}, b"[]"
            return (
                409,
                {"content-type": "application/json"},
                json.dumps({
                    "code": "23503",
                    "message": 'insert or update on table "ssh_public_keys" violates foreign key constraint "ssh_public_keys_user_id_fkey"',
                    "details": 'Key (user_id)=(sub-unsynced) is not present in table "profiles".',
                    "hint": "Create a profile row first.",
                }).encode(),
            )

        fk_repo = SupabaseSSHKeyRepository(settings=self.settings, transport=fk_transport)
        with self.assertRaises(SupabaseSSHKeyValidationError) as fk_ctx:
            fk_repo.create_ssh_key("sub-unsynced", "No Profile", self.ed25519_pub)
        self.assertIn("Customer profile must be initialized", str(fk_ctx.exception))

        # Simulate FK violation (23503) on DELETE when referenced without ON DELETE SET NULL
        self.transport.next_response = (
            409,
            {"content-type": "application/json"},
            json.dumps({
                "code": "23503",
                "message": 'update or delete on table "ssh_public_keys" violates foreign key constraint',
                "details": 'Key (id)=(...) is still referenced from table "notebook_sessions".',
            }).encode(),
        )
        with self.assertRaises(SupabaseSSHKeyValidationError) as del_fk_ctx:
            self.repo.delete_ssh_key("sub-alice", uuid.uuid4())
        self.assertIn("currently referenced", str(del_fk_ctx.exception))

    def test_timeouts_5xx_transport_errors_and_missing_config(self) -> None:
        for net_exc in (
            TimeoutError("timed out"),
            httpx2.ReadTimeout("read timed out"),
            httpx2.ConnectTimeout("connect timed out"),
            httpx2.ConnectError("connection refused"),
            httpx2.RemoteProtocolError("server disconnected"),
            OSError("network unreachable"),
        ):
            self.transport.next_error = net_exc
            with self.assertRaises(SupabaseSSHKeyServiceUnavailableError):
                self.repo.list_user_ssh_keys("sub-alice")

        for status_code in (401, 403, 500, 502, 503, 504):
            self.transport.next_response = (
                status_code,
                {"content-type": "application/json"},
                json.dumps({"message": "upstream failure"}).encode(),
            )
            with self.assertRaises(SupabaseSSHKeyServiceUnavailableError):
                self.repo.list_user_ssh_keys("sub-alice")

        # Invalid JSON body -> 503 equivalent
        self.transport.next_response = (200, {"content-type": "application/json"}, b"not-json")
        with self.assertRaises(SupabaseSSHKeyServiceUnavailableError):
            self.repo.list_user_ssh_keys("sub-alice")

        # Missing configuration
        unconfigured_repo = SupabaseSSHKeyRepository(settings=None, transport=self.transport)
        with patch(
            "inference.supabase_ssh_keys.get_supabase_settings",
            side_effect=SupabaseConfigurationError("missing env"),
        ):
            with self.assertRaises(SupabaseSSHKeyServiceUnavailableError):
                unconfigured_repo.list_user_ssh_keys("sub-alice")

    def test_sanitized_logging_and_repr_never_leak_secrets_keys_details_or_hints(self) -> None:
        secret_sub = "cognito-sensitive-user-991"
        secret_url = "https://unit-test-project.supabase.co/rest/v1/ssh_public_keys"
        secret_hint = "SUPER_SECRET_HINT_SHOULD_NEVER_LOG"
        secret_details = f'Key (user_id, public_key)=({secret_sub}, {self.ed25519_pub}) failed constraint'

        handler = _CaptureLogHandler()
        ssh_logger = logging.getLogger("inferxe.supabase_ssh_keys")
        old_level = ssh_logger.level
        ssh_logger.setLevel(logging.DEBUG)
        ssh_logger.addHandler(handler)
        try:
            rec = self.repo.create_ssh_key(secret_sub, "Audit Key", f"{self.ed25519_pub} user@host")
            self.repo.delete_ssh_key(secret_sub, rec.id)

            # Check repr masks the public key blob
            rec_repr = repr(rec)
            ed_blob = self.ed25519_pub.split()[1]
            self.assertNotIn(ed_blob, rec_repr)

            # Trigger 400 with raw PostgREST details + hint containing secrets
            self.transport.next_response = (
                400,
                {"content-type": "application/json"},
                json.dumps({
                    "code": "22P02",
                    "message": f"invalid syntax near {secret_sub} {self.secret_key}",
                    "details": secret_details,
                    "hint": secret_hint,
                }).encode(),
            )
            with self.assertRaises(SupabaseSSHKeyValidationError):
                self.repo.list_user_ssh_keys(secret_sub)

            # Trigger 502 and timeout including URL/key text in exception message
            self.transport.next_response = (
                502,
                {"content-type": "application/json"},
                json.dumps({"message": f"bad gateway {self.secret_key}", "details": secret_details}).encode(),
            )
            with self.assertRaises(SupabaseSSHKeyServiceUnavailableError):
                self.repo.list_user_ssh_keys(secret_sub)

            self.transport.next_error = httpx2.ReadTimeout(
                f"timeout calling {secret_url} with apikey={self.secret_key}"
            )
            with self.assertRaises(SupabaseSSHKeyServiceUnavailableError):
                self.repo.list_user_ssh_keys(secret_sub)
        finally:
            ssh_logger.removeHandler(handler)
            ssh_logger.setLevel(old_level)

        combined = "\n".join(handler.messages)
        ed_blob = self.ed25519_pub.split()[1]
        self.assertNotIn(ed_blob, combined)
        self.assertNotIn(self.ed25519_pub, combined)
        self.assertNotIn(self.secret_key, combined)
        self.assertNotIn(self.supabase_url, combined)
        self.assertNotIn(secret_hint, combined)
        self.assertNotIn(secret_sub, combined)
        self.assertNotIn("failed constraint", combined)
        self.assertIn("Supabase REST GET ssh_public_keys rejected (status=400, code=22P02).", combined)

    def test_pooled_httpx2_transport_reuses_client_across_threads_and_closes_cleanly(self) -> None:
        mock_store = MockSupabaseSSHKeysTransport()
        created_clients: List[httpx2.Client] = []

        def mock_handler(request: httpx2.Request) -> httpx2.Response:
            headers = {k: v for k, v in request.headers.items()}
            status_code, resp_headers, body = mock_store(
                request.method,
                str(request.url),
                headers,
                request.content,
                10.0,
            )
            return httpx2.Response(
                status_code=status_code,
                headers=resp_headers,
                content=body,
            )

        def client_factory() -> httpx2.Client:
            client = httpx2.Client(
                transport=httpx2.MockTransport(mock_handler),
                http1=True,
                http2=False,
                limits=httpx2.Limits(max_connections=20, max_keepalive_connections=10, keepalive_expiry=20.0),
                headers={"Connection": "keep-alive"},
            )
            created_clients.append(client)
            return client

        close_shared_ssh_keys_http_client()
        with patch("inference.supabase_ssh_keys._create_pooled_http_client", side_effect=client_factory):
            def worker(idx: int) -> str:
                repo = SupabaseSSHKeyRepository(settings=self.settings, timeout=5.0)
                user = f"sub-thread-{idx}"
                created = repo.create_ssh_key(user, f"Thread Key {idx}", self.ed25519_pub)
                listed = repo.list_user_ssh_keys(user)
                self.assertEqual(len(listed), 1)
                self.assertTrue(repo.delete_ssh_key(user, created.id))
                return str(created.id)

            with ThreadPoolExecutor(max_workers=4) as executor:
                ids = list(executor.map(worker, range(8)))

            self.assertEqual(len(ids), 8)
            # Single pooled httpx2.Client shared across all repositories & threads
            self.assertEqual(len(created_clients), 1)
            self.assertFalse(created_clients[0].is_closed)
            self.assertTrue(
                all(
                    req["headers"].get("connection") == "keep-alive"
                    for req in mock_store.requests
                )
            )

            close_shared_ssh_keys_http_client()
            self.assertTrue(created_clients[0].is_closed)

            # Subsequent use lazily opens a fresh pooled client
            repo_after_close = SupabaseSSHKeyRepository(settings=self.settings, timeout=5.0)
            self.assertEqual(repo_after_close.list_user_ssh_keys("sub-thread-0"), [])
            self.assertEqual(len(created_clients), 2)
            close_shared_ssh_keys_http_client()
            self.assertTrue(created_clients[1].is_closed)


if __name__ == "__main__":
    unittest.main()
