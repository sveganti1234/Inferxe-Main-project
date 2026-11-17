"""
test_supabase_notebooks.py
==========================
Comprehensive unit tests for Phase 2 Inferxe Supabase Notebook Management repository
(`backend/inference/supabase_notebooks.py`).

Covers:
- Live Supabase `notebook_sessions` schema parity (`token_hash` write-only, `bot_access_enabled`,
  status CHECK constraint, rejects unknown columns with `PGRST204`)
- Integration with `SupabaseSSHKeyRepository` (`validate_owned_ssh_key`, `ssh_key_type` resolution,
  cross-tenant key rejection, nonexistent key rejection, malformed UUID rejection)
- `ON DELETE SET NULL` resilience when a linked SSH key is permanently deleted
- Tenant-scoped create, list (filtering terminated unless requested), get-by-ID
- Atomic conditional state transitions (`start`, `stop`, `terminate`) including `'starting'` status
- Concurrent state transition race protection (single winner, `InvalidStateTransitionError` on loser)
- Strict token hashing enforcement (rejects raw `ixnb_*` tokens, requires 64-char SHA-256 hex)
- `23503` FK error classification (`profiles`, `ssh_public_keys`, `deployments`)
- Pooled `httpx2.Client` HTTP/1.1 transport sharing across threads and clean close lifecycle
- Timeouts, transport errors, 5xx errors, and strictly sanitized logging (zero secrets, zero raw
  tokens/hashes, zero raw PostgREST `details` / `hint`)
"""

import hashlib
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
from cryptography.hazmat.primitives.asymmetric import ed25519, rsa
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("INFERXE_TEST_MODE", "1")

BACKEND_DIR = Path(__file__).resolve().parents[2]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from inference.supabase_config import SupabaseConfigurationError, SupabaseSettings  # noqa: E402
from inference.supabase_notebooks import (  # noqa: E402
    VALID_NOTEBOOK_STATUSES,
    InvalidStateTransitionError,
    NotebookNotFoundError,
    NotebookValidationError,
    SupabaseNotebookError,
    SupabaseNotebookRecord,
    SupabaseNotebookRepository,
    SupabaseNotebookServiceUnavailableError,
    SupabaseNotebookValidationError,
    close_shared_notebooks_http_client,
)
from inference.supabase_ssh_keys import SupabaseSSHKeyRepository  # noqa: E402
from inference.tests.test_supabase_ssh_keys import MockSupabaseSSHKeysTransport  # noqa: E402

SUPABASE_NOTEBOOK_SESSIONS_COLUMNS = {
    "id",
    "user_id",
    "deployment_id",
    "name",
    "status",
    "session_url",
    "storage_path",
    "bot_access_enabled",
    "started_at",
    "stopped_at",
    "created_at",
    "updated_at",
    "gpu_profile",
    "runtime_type",
    "runtime_reference",
    "selected_ssh_key_id",
    "token_hash",
    "last_active_at",
}


class MockSupabaseNotebooksTransport:
    """
    Thread-safe in-memory PostgREST simulator modeling live Supabase `notebook_sessions`:
    - Enforces exact Supabase columns (rejects unknown columns with `PGRST204`).
    - Enforces `status` CHECK constraint (`23514`) and NOT NULL constraints (`23502`).
    - Optionally validates `selected_ssh_key_id` FK against a `MockSupabaseSSHKeysTransport`
      and supports simulating PostgreSQL `ON DELETE SET NULL`.
    - Supports `GET`, `POST`, and atomic conditional `PATCH` (`eq.`, `neq.`, `is.null`).
    """

    def __init__(
        self,
        ssh_keys_transport: Optional[MockSupabaseSSHKeysTransport] = None,
    ) -> None:
        self._lock = threading.Lock()
        self.rows: Dict[str, Dict[str, Any]] = {}
        self.requests: List[Dict[str, Any]] = []
        self.next_error: Optional[Exception] = None
        self.next_response: Optional[Tuple[int, Dict[str, str], bytes]] = None
        self.ssh_keys_transport = ssh_keys_transport
        self.before_patch_barrier: Optional[threading.Barrier] = None

    def seed_row(self, row: Dict[str, Any]) -> Dict[str, Any]:
        unknown = set(row.keys()) - SUPABASE_NOTEBOOK_SESSIONS_COLUMNS
        if unknown:
            raise AssertionError(f"Unknown Supabase notebook_sessions columns in seed: {unknown}")
        now_iso = datetime.now(timezone.utc).isoformat()
        stored = {
            "id": str(row.get("id") or uuid.uuid4()),
            "user_id": row["user_id"],
            "deployment_id": str(row["deployment_id"]) if row.get("deployment_id") else None,
            "name": row.get("name", "Untitled Notebook"),
            "status": row.get("status", "running"),
            "session_url": row.get("session_url"),
            "storage_path": row.get("storage_path"),
            "bot_access_enabled": bool(row.get("bot_access_enabled", False)),
            "started_at": row.get("started_at"),
            "stopped_at": row.get("stopped_at"),
            "created_at": row.get("created_at") or now_iso,
            "updated_at": row.get("updated_at") or now_iso,
            "gpu_profile": row.get("gpu_profile", "NVIDIA L4"),
            "runtime_type": row.get("runtime_type", "simulated"),
            "runtime_reference": row.get("runtime_reference"),
            "selected_ssh_key_id": (
                str(row["selected_ssh_key_id"]) if row.get("selected_ssh_key_id") else None
            ),
            "token_hash": row.get("token_hash"),
            "last_active_at": row.get("last_active_at") or now_iso,
        }
        with self._lock:
            self.rows[stored["id"]] = stored
        return stored

    def simulate_ssh_key_deleted(self, key_id: str) -> None:
        """Apply `ON DELETE SET NULL` to any linked `notebook_sessions` rows."""
        with self._lock:
            for row in self.rows.values():
                if row.get("selected_ssh_key_id") == str(key_id):
                    row["selected_ssh_key_id"] = None

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

        barrier: Optional[threading.Barrier] = None
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

            if method == "PATCH" and self.before_patch_barrier is not None:
                barrier = self.before_patch_barrier

        if barrier is not None:
            barrier.wait(timeout=5.0)

        with self._lock:
            if not parsed.path.endswith("/rest/v1/notebook_sessions"):
                return (
                    404,
                    {"content-type": "application/json"},
                    json.dumps({"message": "Not found"}).encode(),
                )

            select_cols: Optional[List[str]] = None
            if "select" in query:
                select_cols = [c.strip() for c in query["select"][0].split(",") if c.strip()]
                unknown_sel = set(select_cols) - SUPABASE_NOTEBOOK_SESSIONS_COLUMNS
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
                unknown_ins = set(parsed_body.keys()) - SUPABASE_NOTEBOOK_SESSIONS_COLUMNS
                if unknown_ins:
                    return (
                        400,
                        {"content-type": "application/json"},
                        json.dumps({
                            "code": "PGRST204",
                            "message": f"Could not find columns {sorted(unknown_ins)}",
                        }).encode(),
                    )
                for req_col in ("id", "user_id", "name", "status", "gpu_profile", "runtime_type"):
                    if not parsed_body.get(req_col):
                        return (
                            400,
                            {"content-type": "application/json"},
                            json.dumps({
                                "code": "23502",
                                "message": f"null value in column {req_col}",
                            }).encode(),
                        )
                if "bot_access_enabled" not in parsed_body or not isinstance(
                    parsed_body["bot_access_enabled"], bool
                ):
                    return (
                        400,
                        {"content-type": "application/json"},
                        json.dumps({
                            "code": "23502",
                            "message": "null value in column bot_access_enabled",
                        }).encode(),
                    )
                if parsed_body["status"] not in VALID_NOTEBOOK_STATUSES:
                    return (
                        400,
                        {"content-type": "application/json"},
                        json.dumps({
                            "code": "23514",
                            "message": 'new row for relation "notebook_sessions" violates check constraint "notebook_sessions_status_check"',
                        }).encode(),
                    )
                ssh_key_id = parsed_body.get("selected_ssh_key_id")
                if ssh_key_id and self.ssh_keys_transport is not None:
                    with self.ssh_keys_transport._lock:
                        key_exists = str(ssh_key_id) in self.ssh_keys_transport.rows
                    if not key_exists:
                        return (
                            409,
                            {"content-type": "application/json"},
                            json.dumps({
                                "code": "23503",
                                "message": 'insert on table "notebook_sessions" violates foreign key constraint "notebook_sessions_selected_ssh_key_id_fkey"',
                                "details": f'Key (selected_ssh_key_id)=({ssh_key_id}) is not present in table "ssh_public_keys".',
                            }).encode(),
                        )

                now_iso = datetime.now(timezone.utc).isoformat()
                stored = {
                    "id": str(parsed_body.get("id") or uuid.uuid4()),
                    "user_id": parsed_body["user_id"],
                    "deployment_id": parsed_body.get("deployment_id"),
                    "name": parsed_body["name"],
                    "status": parsed_body["status"],
                    "session_url": parsed_body.get("session_url"),
                    "storage_path": parsed_body.get("storage_path"),
                    "bot_access_enabled": parsed_body["bot_access_enabled"],
                    "started_at": parsed_body.get("started_at"),
                    "stopped_at": parsed_body.get("stopped_at"),
                    "created_at": parsed_body.get("created_at") or now_iso,
                    "updated_at": parsed_body.get("updated_at") or now_iso,
                    "gpu_profile": parsed_body["gpu_profile"],
                    "runtime_type": parsed_body["runtime_type"],
                    "runtime_reference": parsed_body.get("runtime_reference"),
                    "selected_ssh_key_id": ssh_key_id,
                    "token_hash": parsed_body.get("token_hash"),
                    "last_active_at": parsed_body.get("last_active_at"),
                }
                if stored["id"] in self.rows:
                    return (
                        409,
                        {"content-type": "application/json"},
                        json.dumps({"code": "23505", "message": "duplicate key value"}).encode(),
                    )
                self.rows[stored["id"]] = stored
                return (
                    201,
                    {"content-type": "application/json"},
                    json.dumps([self._project(stored, select_cols)]).encode(),
                )

            if method in ("GET", "PATCH"):
                filter_checks: List[Tuple[str, str, Optional[str]]] = []
                for k, vals in query.items():
                    if k in ("select", "order", "limit"):
                        continue
                    if k not in SUPABASE_NOTEBOOK_SESSIONS_COLUMNS:
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
                        elif val.startswith("neq."):
                            filter_checks.append((k, "neq", val[4:]))
                        else:
                            raise AssertionError(f"Unexpected filter expression for {k}: {val}")

                def _matches(row: Dict[str, Any]) -> bool:
                    for fk, op, fval in filter_checks:
                        cur = row.get(fk)
                        if op == "is.null":
                            if cur is not None:
                                return False
                        elif op == "eq":
                            if cur is None or str(cur) != fval:
                                return False
                        elif op == "neq":
                            if cur is not None and str(cur) == fval:
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

                # PATCH
                assert isinstance(parsed_body, dict)
                unknown_upd = set(parsed_body.keys()) - SUPABASE_NOTEBOOK_SESSIONS_COLUMNS
                if unknown_upd:
                    return (
                        400,
                        {"content-type": "application/json"},
                        json.dumps({
                            "code": "PGRST204",
                            "message": f"Could not find columns {sorted(unknown_upd)}",
                        }).encode(),
                    )
                if "status" in parsed_body and parsed_body["status"] not in VALID_NOTEBOOK_STATUSES:
                    return (
                        400,
                        {"content-type": "application/json"},
                        json.dumps({
                            "code": "23514",
                            "message": "violates check constraint notebook_sessions_status_check",
                        }).encode(),
                    )

                updated_projected: List[Dict[str, Any]] = []
                for row in matched:
                    row.update(parsed_body)
                    updated_projected.append(self._project(row, select_cols))
                if headers.get("Prefer") == "return=minimal":
                    return 204, {}, b""
                return (
                    200,
                    {"content-type": "application/json"},
                    json.dumps(updated_projected).encode(),
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


class TestSupabaseNotebookRepository(unittest.TestCase):
    """Focused unit tests for `SupabaseNotebookRepository`."""

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
        self.settings = SupabaseSettings(
            url="https://notebook-test.supabase.co",
            service_role_key="sb_secret_" + "notebook_test_mock",
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
            timeout=7.5,
            transport=self.nb_transport,
            ssh_key_repo=self.ssh_repo,
        )
        self.token_hash = hashlib.sha256(b"ixnb_secret_test_token_value").hexdigest()

        self.alice_key = self.ssh_repo.create_ssh_key(
            user_id="cognito-sub-alice",
            name="Alice Ed25519",
            raw_public_key=self.ed25519_pub,
        )
        self.bob_key = self.ssh_repo.create_ssh_key(
            user_id="cognito-sub-bob",
            name="Bob RSA",
            raw_public_key=self.rsa_2048_pub,
        )

    def tearDown(self) -> None:
        close_shared_notebooks_http_client()

    def test_create_notebook_schema_parity_token_hash_exclusion_and_ssh_binding(self) -> None:
        rec = self.repo.create_notebook_session(
            user_id="cognito-sub-alice",
            name="Qwen Train Pod",
            gpu_profile="NVIDIA L40S",
            status="running",
            runtime_type="simulated",
            runtime_reference="sim-worker-deadbeef",
            selected_ssh_key_id=self.alice_key.id,
            token_hash=self.token_hash,
        )
        self.assertEqual(rec.user_id, "cognito-sub-alice")
        self.assertEqual(rec.name, "Qwen Train Pod")
        self.assertEqual(rec.gpu_profile, "NVIDIA L40S")
        self.assertEqual(rec.status, "running")
        self.assertEqual(rec.runtime_type, "simulated")
        self.assertEqual(rec.runtime_reference, "sim-worker-deadbeef")
        self.assertEqual(rec.selected_ssh_key_id, self.alice_key.id)
        self.assertEqual(rec.ssh_key_type, "ssh-ed25519")
        self.assertFalse(rec.bot_access_enabled)
        self.assertIsNotNone(rec.started_at)

        post_reqs = [r for r in self.nb_transport.requests if r["method"] == "POST"]
        self.assertEqual(len(post_reqs), 1)
        sent_body = post_reqs[0]["body"]
        self.assertEqual(sent_body["token_hash"], self.token_hash)
        self.assertIn("bot_access_enabled", sent_body)
        # Never project `token_hash` back over PostgREST select queries
        select_param = post_reqs[0]["query"]["select"][0]
        self.assertNotIn("token_hash", select_param.split(","))
        # Record class exposes no `token_hash` attribute
        self.assertFalse(hasattr(rec, "token_hash"))

    def test_token_hash_validation_rejects_raw_tokens_and_invalid_digests(self) -> None:
        for bad_hash in ("", "   ", "ixnb_raw_token_must_never_be_stored", "abc123", "z" * 64):
            with self.assertRaises(NotebookValidationError):
                self.repo.create_notebook_session(
                    user_id="cognito-sub-alice",
                    name="Bad Token Test",
                    gpu_profile="NVIDIA L4",
                    token_hash=bad_hash,
                )
        self.assertEqual(self.nb_transport.requests, [])

    def test_ssh_key_ownership_validation_and_on_delete_set_null(self) -> None:
        # Cross-tenant SSH key (Bob's key) must be rejected before any notebook INSERT
        with self.assertRaises(NotebookValidationError) as ctx:
            self.repo.create_notebook_session(
                user_id="cognito-sub-alice",
                name="Cross Tenant Attempt",
                gpu_profile="NVIDIA L4",
                selected_ssh_key_id=self.bob_key.id,
                token_hash=self.token_hash,
            )
        self.assertIn("does not belong to your account", str(ctx.exception))
        self.assertEqual(self.nb_transport.requests, [])

        # Nonexistent SSH key ID must be rejected
        with self.assertRaises(NotebookValidationError):
            self.repo.create_notebook_session(
                user_id="cognito-sub-alice",
                name="Missing Key Attempt",
                gpu_profile="NVIDIA L4",
                selected_ssh_key_id=uuid.uuid4(),
                token_hash=self.token_hash,
            )

        # Malformed SSH key ID string must be rejected
        with self.assertRaises(NotebookValidationError):
            self.repo.validate_owned_ssh_key("cognito-sub-alice", "not-a-uuid")

        # Create valid notebook with Alice's key, then permanently hard-delete SSH key
        nb = self.repo.create_notebook_session(
            user_id="cognito-sub-alice",
            name="Resilient Notebook",
            gpu_profile="NVIDIA L4",
            selected_ssh_key_id=self.alice_key.id,
            token_hash=self.token_hash,
        )
        self.assertTrue(self.ssh_repo.delete_ssh_key("cognito-sub-alice", self.alice_key.id))
        self.nb_transport.simulate_ssh_key_deleted(str(self.alice_key.id))

        fetched = self.repo.get_notebook("cognito-sub-alice", nb.id)
        self.assertIsNone(fetched.selected_ssh_key_id)
        self.assertIsNone(fetched.ssh_key_type)

    def test_list_get_and_tenant_isolation_with_terminated_filtering(self) -> None:
        nb_a1 = self.repo.create_notebook_session(
            user_id="cognito-sub-alice",
            name="Alice Running",
            gpu_profile="NVIDIA L4",
            status="running",
            selected_ssh_key_id=self.alice_key.id,
            token_hash=self.token_hash,
        )
        nb_a2_term = self.repo.create_notebook_session(
            user_id="cognito-sub-alice",
            name="Alice Terminated",
            gpu_profile="NVIDIA L4",
            status="terminated",
            token_hash=self.token_hash,
        )
        nb_b1 = self.repo.create_notebook_session(
            user_id="cognito-sub-bob",
            name="Bob Running",
            gpu_profile="NVIDIA A100",
            status="running",
            selected_ssh_key_id=self.bob_key.id,
            token_hash=self.token_hash,
        )

        alice_active = self.repo.list_user_notebooks("cognito-sub-alice")
        self.assertEqual([n.id for n in alice_active], [nb_a1.id])
        self.assertEqual(alice_active[0].ssh_key_type, "ssh-ed25519")

        alice_all = self.repo.list_user_notebooks("cognito-sub-alice", include_terminated=True)
        self.assertEqual({n.id for n in alice_all}, {nb_a1.id, nb_a2_term.id})

        bob_active = self.repo.list_user_notebooks("cognito-sub-bob")
        self.assertEqual([n.id for n in bob_active], [nb_b1.id])
        self.assertEqual(bob_active[0].ssh_key_type, "ssh-rsa")

        # Cross-tenant get must fail with NotebookNotFoundError
        with self.assertRaises(NotebookNotFoundError):
            self.repo.get_notebook("cognito-sub-alice", nb_b1.id)

    def test_concurrent_state_transitions_single_winner_and_conflict(self) -> None:
        nb = self.repo.create_notebook_session(
            user_id="cognito-sub-alice",
            name="Concurrent Stop Test",
            gpu_profile="NVIDIA L4",
            status="running",
            token_hash=self.token_hash,
        )
        self.nb_transport.before_patch_barrier = threading.Barrier(2)

        def _stop_worker() -> str:
            try:
                res = self.repo.transition_notebook_status(
                    user_id="cognito-sub-alice",
                    notebook_id=nb.id,
                    action="stop",
                    expected_status="running",
                    new_status="stopped",
                )
                return f"ok:{res.status}"
            except InvalidStateTransitionError as conflict:
                return f"conflict:{conflict}"

        with ThreadPoolExecutor(max_workers=2) as pool:
            f1 = pool.submit(_stop_worker)
            f2 = pool.submit(_stop_worker)
            results = [f1.result(timeout=10), f2.result(timeout=10)]

        self.nb_transport.before_patch_barrier = None
        winners = [r for r in results if r.startswith("ok:")]
        conflicts = [r for r in results if r.startswith("conflict:")]
        self.assertEqual(len(winners), 1)
        self.assertEqual(winners[0], "ok:stopped")
        self.assertEqual(len(conflicts), 1)
        self.assertIn("already stopped", conflicts[0])

    def test_starting_status_supported_by_schema_and_transitions(self) -> None:
        seeded = self.nb_transport.seed_row({
            "user_id": "cognito-sub-alice",
            "name": "Booting Session",
            "gpu_profile": "NVIDIA L4",
            "status": "starting",
            "runtime_type": "simulated",
        })
        rec = self.repo.get_notebook("cognito-sub-alice", seeded["id"])
        self.assertEqual(rec.status, "starting")

        running = self.repo.transition_notebook_status(
            user_id="cognito-sub-alice",
            notebook_id=rec.id,
            action="start",
            expected_status="starting",
            new_status="running",
        )
        self.assertEqual(running.status, "running")
        self.assertIsNotNone(running.started_at)

    def test_23503_fk_error_classification_without_leaks(self) -> None:
        cases = [
            (
                {
                    "code": "23503",
                    "message": 'insert on table "notebook_sessions" violates foreign key constraint "notebook_sessions_user_id_fkey"',
                    "details": 'Key (user_id)=(cognito-sub-alice) is not present in table "profiles".',
                    "hint": "RAW_SENSITIVE_HINT",
                },
                SupabaseNotebookValidationError,
                "Customer profile must be initialized",
            ),
            (
                {
                    "code": "23503",
                    "message": 'insert on table "notebook_sessions" violates foreign key constraint "notebook_sessions_selected_ssh_key_id_fkey"',
                    "details": 'Key (selected_ssh_key_id)=(11111111-1111-1111-1111-111111111111) is not present in table "ssh_public_keys".',
                    "hint": "RAW_SENSITIVE_HINT",
                },
                NotebookValidationError,
                "Selected SSH key does not exist",
            ),
            (
                {
                    "code": "23503",
                    "message": 'insert on table "notebook_sessions" violates foreign key constraint "notebook_sessions_deployment_id_fkey"',
                    "details": 'Key (deployment_id)=(22222222-2222-2222-2222-222222222222) is not present in table "deployments".',
                    "hint": "RAW_SENSITIVE_HINT",
                },
                SupabaseNotebookValidationError,
                "Referenced deployment record does not exist",
            ),
        ]
        nb_logger = logging.getLogger("inferxe.supabase_notebooks")
        handler = _CaptureLogHandler()
        nb_logger.addHandler(handler)
        try:
            for payload, exc_cls, expected_msg in cases:
                self.nb_transport.next_response = (
                    409,
                    {"content-type": "application/json"},
                    json.dumps(payload).encode(),
                )
                with self.assertRaises(exc_cls) as ctx:
                    self.repo.create_notebook_session(
                        user_id="cognito-sub-alice",
                        name="FK Test",
                        gpu_profile="NVIDIA L4",
                        token_hash=self.token_hash,
                    )
                self.assertIn(expected_msg, str(ctx.exception))
                self.assertNotIn("RAW_SENSITIVE_HINT", str(ctx.exception))
        finally:
            nb_logger.removeHandler(handler)

        joined_logs = "\n".join(handler.messages)
        self.assertNotIn("RAW_SENSITIVE_HINT", joined_logs)
        self.assertNotIn("cognito-sub-alice", joined_logs)
        self.assertNotIn("11111111-1111-1111-1111-111111111111", joined_logs)

    def test_timeouts_5xx_malformed_rows_and_sanitized_logging(self) -> None:
        nb_logger = logging.getLogger("inferxe.supabase_notebooks")
        handler = _CaptureLogHandler()
        nb_logger.addHandler(handler)
        try:
            # Timeouts and transport errors
            for err in (
                TimeoutError("timed out calling https://secret.supabase.co ixnb_raw_leak"),
                httpx2.ReadTimeout("read timeout"),
                httpx2.ConnectError("connect failed"),
                httpx2.RemoteProtocolError("protocol closed"),
                OSError("socket broken"),
            ):
                self.nb_transport.next_error = err
                with self.assertRaises(SupabaseNotebookServiceUnavailableError) as ctx:
                    self.repo.list_user_notebooks("cognito-sub-alice")
                self.assertNotIn("secret.supabase.co", str(ctx.exception))
                self.assertNotIn("ixnb_raw_leak", str(ctx.exception))

            # 401/403 -> unavailable
            for code_num in (401, 403):
                self.nb_transport.next_response = (
                    code_num,
                    {"content-type": "application/json"},
                    b'{"message":"invalid sb_secret_leak"}',
                )
                with self.assertRaises(SupabaseNotebookServiceUnavailableError):
                    self.repo.list_user_notebooks("cognito-sub-alice")

            # 5xx -> unavailable
            self.nb_transport.next_response = (
                503,
                {"content-type": "application/json"},
                b'{"message":"db down","details":"internal host https://db.internal","hint":"secret hint"}',
            )
            with self.assertRaises(SupabaseNotebookServiceUnavailableError):
                self.repo.list_user_notebooks("cognito-sub-alice")

            # Unhandled 4xx -> SupabaseNotebookError
            self.nb_transport.next_response = (
                406,
                {"content-type": "application/json"},
                b'{"code":"42883","message":"function missing","details":"secret","hint":"secret hint"}',
            )
            with self.assertRaises(SupabaseNotebookError):
                self.repo.list_user_notebooks("cognito-sub-alice")

            # Malformed status in returned row -> ServiceUnavailable
            self.nb_transport.next_response = (
                200,
                {"content-type": "application/json"},
                json.dumps([
                    {
                        "id": str(uuid.uuid4()),
                        "user_id": "cognito-sub-alice",
                        "name": "Corrupt",
                        "status": "unknown_status_value",
                        "bot_access_enabled": False,
                    }
                ]).encode(),
            )
            with self.assertRaises(SupabaseNotebookServiceUnavailableError):
                self.repo.list_user_notebooks("cognito-sub-alice")

            # Invalid JSON -> ServiceUnavailable
            self.nb_transport.next_response = (200, {"content-type": "text/html"}, b"<html>502</html>")
            with self.assertRaises(SupabaseNotebookServiceUnavailableError):
                self.repo.list_user_notebooks("cognito-sub-alice")

            # Missing config -> ServiceUnavailable
            unconfigured = SupabaseNotebookRepository(transport=self.nb_transport)
            with patch(
                "inference.supabase_notebooks.get_supabase_settings",
                side_effect=SupabaseConfigurationError("missing SUPABASE_URL"),
            ):
                with self.assertRaises(SupabaseNotebookServiceUnavailableError):
                    unconfigured.list_user_notebooks("cognito-sub-alice")
        finally:
            nb_logger.removeHandler(handler)

        joined_logs = "\n".join(handler.messages)
        self.assertNotIn("sb_secret_", joined_logs)
        self.assertNotIn("ixnb_raw_leak", joined_logs)
        self.assertNotIn("secret hint", joined_logs)
        self.assertNotIn("db.internal", joined_logs)

    def test_pooled_httpx2_transport_reuses_client_and_closes_cleanly(self) -> None:
        close_shared_notebooks_http_client()
        created_clients: List[Any] = []

        class _FakeClient:
            def __init__(self, *args: Any, **kwargs: Any) -> None:
                self.is_closed = False
                self.calls = 0
                created_clients.append(self)

            def request(self, **kwargs: Any) -> Any:
                self.calls += 1

                class _Resp:
                    status_code = 200
                    headers = {"content-type": "application/json", "connection": "keep-alive"}
                    content = b"[]"

                return _Resp()

            def close(self) -> None:
                self.is_closed = True

        with patch("inference.supabase_notebooks.httpx2.Client", side_effect=_FakeClient):
            pooled_repo = SupabaseNotebookRepository(settings=self.settings)

            with ThreadPoolExecutor(max_workers=4) as pool:
                list(pool.map(lambda _: pooled_repo.list_user_notebooks("cognito-sub-alice"), range(8)))

            self.assertEqual(len(created_clients), 1)
            self.assertEqual(created_clients[0].calls, 8)
            self.assertFalse(created_clients[0].is_closed)

            close_shared_notebooks_http_client()
            self.assertTrue(created_clients[0].is_closed)


if __name__ == "__main__":
    unittest.main()
