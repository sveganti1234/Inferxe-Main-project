"""
test_supabase_api_keys.py
=========================
Comprehensive unit and API integration tests for Inferxe Phase 1 Supabase API Keys integration.

Covers:
- API key creation (live & test, Cognito sub isolation, raw key returned once, hashed storage)
- API key listing & user ownership enforcement
- Revocation by owner & idempotency
- Cross-user revocation / visibility denial (HTTP 403 / empty listing)
- Invalid, inactive, revoked, and expired key rejection (HTTP 401)
- Successful key verification & `last_used_at` timestamp PATCH
- Cross-database local PostgreSQL telemetry FK compatibility
- Supabase connection errors, timeouts, upstream 5xx, FK 23503 errors, and sanitized logging/responses
- Wire-level `urllib.request.urlopen` mocking (zero production Supabase calls)
"""

import base64
import http.client
import inspect
import json
import logging
import os
import sys
import threading
import time
import unittest
import urllib.error
import urllib.parse
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from unittest.mock import MagicMock, patch

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("NVIDIA_API_KEY", "nvapi-test-dummy-key-for-unit-testing")
os.environ.setdefault("INFERXE_TEST_MODE", "1")

BACKEND_DIR = Path(__file__).resolve().parents[2]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine, event  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from inference.auth import generate_api_key, hash_api_key, verify_customer_api_key  # noqa: E402
from inference.database import Base, get_db  # noqa: E402
from inference.main import app  # noqa: E402
from inference.models import InferenceRequest as InferenceRequestRecord  # noqa: E402
from inference.routes import (  # noqa: E402
    create_api_key as create_api_key_route,
    inference_service,
    list_api_keys as list_api_keys_route,
    revoke_api_key as revoke_api_key_route,
)
from inference.supabase_api_keys import (  # noqa: E402
    APIKeyForbiddenError,
    APIKeyNotFoundError,
    SupabaseAPIKeyError,
    SupabaseAPIKeyRecord,
    SupabaseAPIKeyRepository,
    SupabaseAPIKeyServiceUnavailableError,
    SupabaseAPIKeyValidationError,
    get_api_key_repository,
    normalize_api_key_status,
)
from inference.supabase_config import SupabaseSettings  # noqa: E402
from inference.supabase_telemetry import (  # noqa: E402
    SupabaseTelemetryRepository,
    get_telemetry_repository,
)

SUPABASE_API_KEYS_COLUMNS = {
    "id",
    "user_id",
    "organization_id",
    "name",
    "key_prefix",
    "secret_hash",
    "created_at",
    "last_used_at",
    "expires_at",
    "revoked_at",
    "status",
}


def make_mock_cognito_jwt(sub: str, token_use: str = "id") -> str:
    header = base64.urlsafe_b64encode(json.dumps({"alg": "RS256", "typ": "JWT"}).encode()).decode().rstrip("=")
    payload = base64.urlsafe_b64encode(json.dumps({
        "sub": sub,
        "email": f"{sub}@inferxe.internal",
        "token_use": token_use,
        "exp": int(time.time()) + 3600,
    }).encode()).decode().rstrip("=")
    return f"{header}.{payload}.mock_sig"


class MockSupabaseAPIKeysTransport:
    """
    Thread-safe in-memory PostgREST simulator enforcing real Supabase `api_keys` columns,
    `eq.` / `is.null` filters, ordering, `Prefer: return=representation`, and header inspection.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.rows: Dict[str, Dict[str, Any]] = {}
        self.requests: List[Dict[str, Any]] = []
        self.next_error: Optional[Exception] = None
        self.next_response: Optional[Tuple[int, Dict[str, str], bytes]] = None

    def seed_row(self, row: Dict[str, Any]) -> Dict[str, Any]:
        unknown = set(row.keys()) - SUPABASE_API_KEYS_COLUMNS
        if unknown:
            raise AssertionError(f"Unknown Supabase api_keys columns in seed: {unknown}")
        stored = {
            "id": str(row.get("id") or uuid.uuid4()),
            "user_id": row["user_id"],
            "organization_id": row.get("organization_id"),
            "name": row.get("name", "Test Key"),
            "key_prefix": row["key_prefix"],
            "secret_hash": row["secret_hash"],
            "created_at": row.get("created_at") or datetime.now(timezone.utc).isoformat(),
            "last_used_at": row.get("last_used_at"),
            "expires_at": row.get("expires_at"),
            "revoked_at": row.get("revoked_at"),
            "status": row.get("status", "active"),
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

            if not parsed.path.endswith("/rest/v1/api_keys"):
                return 404, {"content-type": "application/json"}, json.dumps({"message": "Not found"}).encode()

            # Validate select columns if specified
            select_cols: Optional[List[str]] = None
            if "select" in query:
                select_cols = [c.strip() for c in query["select"][0].split(",") if c.strip()]
                unknown_sel = set(select_cols) - SUPABASE_API_KEYS_COLUMNS
                if unknown_sel:
                    return (
                        400,
                        {"content-type": "application/json"},
                        json.dumps({"code": "PGRST204", "message": f"Unknown columns: {sorted(unknown_sel)}"}).encode(),
                    )

            if method == "POST":
                assert isinstance(parsed_body, dict)
                unknown_ins = set(parsed_body.keys()) - SUPABASE_API_KEYS_COLUMNS
                if unknown_ins:
                    return (
                        400,
                        {"content-type": "application/json"},
                        json.dumps({"code": "PGRST204", "message": f"Could not find columns {sorted(unknown_ins)}"}).encode(),
                    )
                for req_col in ("id", "user_id", "name", "key_prefix", "secret_hash", "status"):
                    if not parsed_body.get(req_col):
                        return (
                            400,
                            {"content-type": "application/json"},
                            json.dumps({"code": "23502", "message": f"null value in column {req_col}"}).encode(),
                        )
                stored = {
                    "id": str(parsed_body.get("id") or uuid.uuid4()),
                    "user_id": parsed_body["user_id"],
                    "organization_id": parsed_body.get("organization_id"),
                    "name": parsed_body.get("name", "Test Key"),
                    "key_prefix": parsed_body["key_prefix"],
                    "secret_hash": parsed_body["secret_hash"],
                    "created_at": parsed_body.get("created_at") or datetime.now(timezone.utc).isoformat(),
                    "last_used_at": parsed_body.get("last_used_at"),
                    "expires_at": parsed_body.get("expires_at"),
                    "revoked_at": parsed_body.get("revoked_at"),
                    "status": parsed_body.get("status", "active"),
                }
                self.rows[stored["id"]] = stored
                return 201, {"content-type": "application/json"}, json.dumps([self._project(stored, select_cols)]).encode()

            if method in ("GET", "PATCH"):
                filter_checks: List[Tuple[str, str, Optional[str]]] = []
                for k, vals in query.items():
                    if k in ("select", "order", "limit"):
                        continue
                    if k not in SUPABASE_API_KEYS_COLUMNS:
                        return (
                            400,
                            {"content-type": "application/json"},
                            json.dumps({"code": "PGRST204", "message": f"Unknown filter column {k}"}).encode(),
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
                    if "limit" in query:
                        matched = matched[: int(query["limit"][0])]
                    projected = [self._project(r, select_cols) for r in matched]
                    return 200, {"content-type": "application/json"}, json.dumps(projected).encode()

                # PATCH
                assert isinstance(parsed_body, dict)
                unknown_upd = set(parsed_body.keys()) - SUPABASE_API_KEYS_COLUMNS
                if unknown_upd:
                    return (
                        400,
                        {"content-type": "application/json"},
                        json.dumps({"code": "PGRST204", "message": f"Could not find columns {sorted(unknown_upd)}"}).encode(),
                    )
                updated_rows = []
                for row in matched:
                    row.update(parsed_body)
                    updated_rows.append(self._project(row, select_cols))
                if headers.get("Prefer") == "return=minimal":
                    return 204, {}, b""
                return 200, {"content-type": "application/json"}, json.dumps(updated_rows).encode()

            return 405, {}, b""

    @staticmethod
    def _project(row: Dict[str, Any], select_cols: Optional[List[str]]) -> Dict[str, Any]:
        if not select_cols:
            return dict(row)
        return {col: row.get(col) for col in select_cols}


class TestSupabaseAPIKeyRepository(unittest.TestCase):
    """Focused unit tests for `SupabaseAPIKeyRepository` HTTP calls, validation, and errors."""

    def setUp(self) -> None:
        # Dynamically construct synthetic test key so GitHub Push Protection does not flag mock fixtures
        self.secret_key = "sb_secret_" + "mock_test_key"
        self.supabase_url = "https://unit-test-project.supabase.co"
        self.settings = SupabaseSettings(url=self.supabase_url, service_role_key=self.secret_key)
        self.transport = MockSupabaseAPIKeysTransport()
        self.repo = SupabaseAPIKeyRepository(settings=self.settings, timeout=7.5, transport=self.transport)

    def test_create_live_and_test_keys_headers_and_schema(self) -> None:
        raw_live, prefix_live, hash_live = generate_api_key("live")
        rec_live = self.repo.create_api_key(
            user_id="cognito-sub-1",
            name="Primary Live Key",
            key_prefix=prefix_live,
            secret_hash=hash_live,
        )
        self.assertEqual(rec_live.user_id, "cognito-sub-1")
        self.assertEqual(rec_live.environment, "live")
        self.assertTrue(rec_live.is_active)

        raw_test, prefix_test, hash_test = generate_api_key("test")
        rec_test = self.repo.create_api_key(
            user_id="cognito-sub-1",
            name="Staging Key",
            key_prefix=prefix_test,
            secret_hash=hash_test,
        )
        self.assertEqual(rec_test.environment, "test")

        # Verify wire-level PostgREST headers, timeout, and schema compliance
        first_req = self.transport.requests[0]
        self.assertEqual(first_req["method"], "POST")
        self.assertEqual(first_req["headers"]["apikey"], self.secret_key)
        self.assertNotIn("Authorization", first_req["headers"])
        self.assertEqual(first_req["headers"]["Prefer"], "return=representation")
        self.assertEqual(first_req["timeout"], 7.5)
        self.assertNotIn("environment", first_req["body"])
        self.assertNotIn(raw_live, json.dumps(first_req["body"]))
        self.assertNotIn(raw_test, json.dumps(self.transport.requests[1]["body"]))

    def test_list_ownership_and_defense_in_depth_filtering(self) -> None:
        _, p1, h1 = generate_api_key("live")
        _, p2, h2 = generate_api_key("test")
        self.transport.seed_row({
            "user_id": "sub-owner",
            "name": "Older",
            "key_prefix": p1,
            "secret_hash": h1,
            "created_at": "2026-11-01T10:00:00+00:00",
        })
        self.transport.seed_row({
            "user_id": "sub-owner",
            "name": "Newer",
            "key_prefix": p2,
            "secret_hash": h2,
            "created_at": "2026-11-02T10:00:00+00:00",
        })
        self.transport.seed_row({
            "user_id": "sub-other",
            "name": "Other User Key",
            "key_prefix": p1,
            "secret_hash": h1,
        })

        keys = self.repo.list_user_api_keys("sub-owner")
        self.assertEqual([k.name for k in keys], ["Newer", "Older"])
        self.assertEqual(keys[0].environment, "test")
        self.assertEqual(keys[1].environment, "live")
        # Ensure secret_hash is never selected or returned in list responses
        self.assertIsNone(keys[0].secret_hash)

    def test_revoke_ownership_conditional_filters_and_idempotency(self) -> None:
        _, prefix, secret_hash = generate_api_key("live")
        seeded = self.transport.seed_row({
            "user_id": "sub-alice",
            "name": "Alice Key",
            "key_prefix": prefix,
            "secret_hash": secret_hash,
        })

        # Cross-user revoke: conditional PATCH includes owner filter and updates 0 rows -> 403
        with self.assertRaises(APIKeyForbiddenError):
            self.repo.revoke_api_key(key_id=seeded["id"], user_id="sub-mallory")
        mallory_patch = [r for r in self.transport.requests if r["method"] == "PATCH"][0]
        self.assertEqual(mallory_patch["query"]["id"], [f"eq.{seeded['id']}"])
        self.assertEqual(mallory_patch["query"]["user_id"], ["eq.sub-mallory"])
        self.assertEqual(mallory_patch["query"]["status"], ["eq.active"])
        self.assertEqual(mallory_patch["query"]["revoked_at"], ["is.null"])
        self.assertEqual(self.transport.rows[seeded["id"]]["status"], "active")
        self.assertIsNone(self.transport.rows[seeded["id"]]["revoked_at"])

        # Owner revokes active key -> atomic PATCH updates status & revoked_at
        revoked, already = self.repo.revoke_api_key(key_id=seeded["id"], user_id="sub-alice")
        self.assertFalse(already)
        self.assertEqual(revoked.status, "revoked")
        self.assertFalse(revoked.is_active)
        self.assertIsNotNone(revoked.revoked_at)
        original_revoked_at = self.transport.rows[seeded["id"]]["revoked_at"]

        alice_patch = [r for r in self.transport.requests if r["method"] == "PATCH"][1]
        self.assertEqual(alice_patch["query"]["id"], [f"eq.{seeded['id']}"])
        self.assertEqual(alice_patch["query"]["user_id"], ["eq.sub-alice"])
        self.assertEqual(alice_patch["query"]["status"], ["eq.active"])
        self.assertEqual(alice_patch["query"]["revoked_at"], ["is.null"])

        # Repeated revocation returns idempotent True and preserves original revoked_at timestamp
        revoked_again, already_again = self.repo.revoke_api_key(key_id=seeded["id"], user_id="sub-alice")
        self.assertTrue(already_again)
        self.assertFalse(revoked_again.is_active)
        self.assertEqual(self.transport.rows[seeded["id"]]["revoked_at"], original_revoked_at)

        with self.assertRaises(APIKeyNotFoundError):
            self.repo.revoke_api_key(key_id=str(uuid.uuid4()), user_id="sub-alice")

    def test_concurrent_revocation_atomic_single_winner_and_idempotent(self) -> None:
        _, prefix, secret_hash = generate_api_key("live")
        seeded = self.transport.seed_row({
            "user_id": "sub-concurrent",
            "name": "Concurrent Revoke Key",
            "key_prefix": prefix,
            "secret_hash": secret_hash,
        })

        thread_count = 4
        barrier = threading.Barrier(thread_count)
        results: List[Tuple[SupabaseAPIKeyRecord, bool]] = []
        errors: List[Exception] = []
        res_lock = threading.Lock()

        def worker() -> None:
            try:
                barrier.wait(timeout=3.0)
                rec, already = self.repo.revoke_api_key(key_id=seeded["id"], user_id="sub-concurrent")
                with res_lock:
                    results.append((rec, already))
            except Exception as exc:  # pragma: no cover - assertion catches below
                with res_lock:
                    errors.append(exc)

        threads = [threading.Thread(target=worker) for _ in range(thread_count)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=5.0)

        self.assertEqual(errors, [])
        self.assertEqual(len(results), thread_count)
        winners = [r for r in results if not r[1]]
        idempotent_losers = [r for r in results if r[1]]
        self.assertEqual(len(winners), 1)
        self.assertEqual(len(idempotent_losers), thread_count - 1)

        stored_revoked_at = self.transport.rows[seeded["id"]]["revoked_at"]
        self.assertIsNotNone(stored_revoked_at)
        for rec, _already in results:
            self.assertEqual(rec.status, "revoked")
            self.assertFalse(rec.is_active)
            self.assertIsNotNone(rec.revoked_at)
            assert rec.revoked_at is not None
            self.assertEqual(rec.revoked_at.isoformat(), stored_revoked_at)

    def test_update_last_used_requires_user_id_and_skips_revoked_or_inactive_keys(self) -> None:
        _, p_active, h_active = generate_api_key("live")
        active_row = self.transport.seed_row({
            "user_id": "sub-owner",
            "name": "Active Key",
            "key_prefix": p_active,
            "secret_hash": h_active,
            "status": "active",
        })

        # user_id is mandatory
        with self.assertRaises(SupabaseAPIKeyValidationError):
            self.repo.update_last_used(key_id=uuid.UUID(active_row["id"]), user_id="   ")

        # Mismatched owner leaves last_used_at unchanged
        t1 = datetime(2026, 11, 10, 10, 0, tzinfo=timezone.utc)
        self.repo.update_last_used(key_id=uuid.UUID(active_row["id"]), user_id="sub-other", used_at=t1)
        self.assertIsNone(self.transport.rows[active_row["id"]]["last_used_at"])

        # Active owner update succeeds and includes owner + active-status predicates
        self.repo.update_last_used(key_id=uuid.UUID(active_row["id"]), user_id="sub-owner", used_at=t1)
        self.assertEqual(self.transport.rows[active_row["id"]]["last_used_at"], t1.isoformat())
        last_patch = [r for r in self.transport.requests if r["method"] == "PATCH"][-1]
        self.assertEqual(last_patch["query"]["id"], [f"eq.{active_row['id']}"])
        self.assertEqual(last_patch["query"]["user_id"], ["eq.sub-owner"])
        self.assertEqual(last_patch["query"]["status"], ["eq.active"])
        self.assertEqual(last_patch["query"]["revoked_at"], ["is.null"])

        # Once revoked, update_last_used must NOT overwrite last_used_at
        self.repo.revoke_api_key(key_id=active_row["id"], user_id="sub-owner")
        t2 = datetime(2026, 11, 10, 12, 0, tzinfo=timezone.utc)
        self.repo.update_last_used(key_id=uuid.UUID(active_row["id"]), user_id="sub-owner", used_at=t2)
        self.assertEqual(self.transport.rows[active_row["id"]]["last_used_at"], t1.isoformat())

        # Direct revoked_at non-null or inactive status rows are also protected
        _, p_rev, h_rev = generate_api_key("live")
        stale_revoked = self.transport.seed_row({
            "user_id": "sub-owner",
            "name": "Revoked With Timestamp",
            "key_prefix": p_rev,
            "secret_hash": h_rev,
            "status": "active",
            "revoked_at": "2026-11-09T09:00:00+00:00",
        })
        self.repo.update_last_used(key_id=uuid.UUID(stale_revoked["id"]), user_id="sub-owner", used_at=t2)
        self.assertIsNone(self.transport.rows[stale_revoked["id"]]["last_used_at"])

    def test_verify_customer_api_key_race_does_not_stamp_last_used_on_concurrently_revoked_key(self) -> None:
        raw_key, prefix, secret_hash = generate_api_key("live")
        seeded = self.transport.seed_row({
            "user_id": "sub-race",
            "name": "Race Key",
            "key_prefix": prefix,
            "secret_hash": secret_hash,
        })

        def racing_transport(
            method: str,
            url: str,
            headers: Dict[str, str],
            body: Optional[bytes],
            timeout: float,
        ) -> Tuple[int, Dict[str, str], bytes]:
            resp = self.transport(method, url, headers, body, timeout)
            if method == "GET" and "secret_hash=" in url and resp[0] == 200:
                # Simulate owner revoking the key right after lookup and before update_last_used PATCH
                self.repo.revoke_api_key(key_id=seeded["id"], user_id="sub-race")
            return resp

        racing_repo = SupabaseAPIKeyRepository(settings=self.settings, transport=racing_transport)
        record = verify_customer_api_key(authorization=f"Bearer {raw_key}", repo=racing_repo)
        self.assertEqual(str(record.id), seeded["id"])
        self.assertEqual(self.transport.rows[seeded["id"]]["status"], "revoked")
        self.assertIsNone(self.transport.rows[seeded["id"]]["last_used_at"])

    def test_expired_and_valid_key_record_states(self) -> None:
        _, prefix, secret_hash = generate_api_key("live")
        past_iso = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
        self.transport.seed_row({
            "user_id": "sub-exp",
            "name": "Expired Key",
            "key_prefix": prefix,
            "secret_hash": secret_hash,
            "expires_at": past_iso,
        })

        rec = self.repo.get_by_secret_hash(secret_hash)
        self.assertIsNotNone(rec)
        assert rec is not None
        self.assertTrue(rec.is_expired)
        self.assertFalse(rec.is_active)

    def test_status_normalization_and_malformed_api_key_records(self) -> None:
        self.assertEqual(normalize_api_key_status("  AcTiVe \n"), "active")
        self.assertEqual(normalize_api_key_status("  REVOKED  "), "revoked")
        for bad_status in ("", "   ", None, 123, ["active"], {"state": "active"}):
            self.assertEqual(normalize_api_key_status(bad_status), "inactive")

        valid_id = str(uuid.uuid4())
        trimmed_active = SupabaseAPIKeyRecord.from_row({
            "id": valid_id,
            "user_id": "  sub-norm  ",
            "name": "  Trimmed Key  ",
            "key_prefix": "inf_live_abc123",
            "status": "  ACTIVE ",
        })
        self.assertEqual(trimmed_active.user_id, "sub-norm")
        self.assertEqual(trimmed_active.status, "active")
        self.assertTrue(trimmed_active.is_active)

        # Empty, non-string, or unrecognized statuses fail closed as inactive
        for status_val in ("", "   ", None, 999, {}, "suspended", "garbage_status"):
            rec = SupabaseAPIKeyRecord.from_row({
                "id": valid_id,
                "user_id": "sub-fail-closed",
                "name": "Status Check",
                "key_prefix": "inf_live_abc123",
                "status": status_val,
            })
            self.assertTrue(rec.is_revoked_or_inactive)
            self.assertFalse(rec.is_active)

        # Malformed records raise SupabaseAPIKeyServiceUnavailableError rather than ValueError/TypeError
        malformed_rows: List[Any] = [
            "not-a-dict",
            {"id": valid_id},  # missing user_id
            {"id": valid_id, "user_id": "   "},  # blank user_id
            {"id": "not-a-uuid", "user_id": "sub-1", "status": "active"},
            {"id": valid_id, "user_id": "sub-1", "organization_id": "bad-org-uuid"},
            {"id": valid_id, "user_id": "sub-1", "created_at": "not-an-iso-date"},
            {"id": valid_id, "user_id": "sub-1", "expires_at": 12345},
            {"id": valid_id, "user_id": "sub-1", "key_prefix": 42},
            {"id": valid_id, "user_id": "sub-1", "secret_hash": ["hash"]},
        ]
        for bad_row in malformed_rows:
            with self.assertRaises(SupabaseAPIKeyServiceUnavailableError):
                SupabaseAPIKeyRecord.from_row(bad_row)

        # Non-list lookup JSON fails closed with 503-mapped error rather than None/401
        _, _, h = generate_api_key("live")
        self.transport.next_response = (200, {"content-type": "application/json"}, b'{"unexpected": true}')
        with self.assertRaises(SupabaseAPIKeyServiceUnavailableError):
            self.repo.get_by_secret_hash(h)

    def test_connection_errors_timeouts_http_exceptions_and_sanitized_logging(self) -> None:
        with self.assertLogs("inferxe.supabase_api_keys", level=logging.WARNING) as log_cm:
            self.transport.next_error = TimeoutError("timed out")
            with self.assertRaises(SupabaseAPIKeyServiceUnavailableError) as ctx1:
                self.repo.list_user_api_keys("sub-1")
            self.assertIn("timed out", str(ctx1.exception).lower())

            self.transport.next_error = urllib.error.URLError("DNS lookup failed for unit-test-project.supabase.co")
            with self.assertRaises(SupabaseAPIKeyServiceUnavailableError) as ctx2:
                self.repo.list_user_api_keys("sub-1")
            self.assertIn("unavailable", str(ctx2.exception).lower())

            self.transport.next_error = http.client.IncompleteRead(b"partial")
            with self.assertRaises(SupabaseAPIKeyServiceUnavailableError) as ctx_http:
                self.repo.list_user_api_keys("sub-1")
            self.assertIn("communication failed", str(ctx_http.exception).lower())

            self.transport.next_response = (
                502,
                {"content-type": "application/json"},
                json.dumps({"message": f"Internal error referencing {self.secret_key} and {self.supabase_url}"}).encode(),
            )
            with self.assertRaises(SupabaseAPIKeyServiceUnavailableError) as ctx3:
                self.repo.list_user_api_keys("sub-1")
            self.assertNotIn(self.secret_key, str(ctx3.exception))
            self.assertNotIn(self.supabase_url, str(ctx3.exception))

            # Unhandled 4xx keeps only HTTP status & sanitized error code in logs while omitting raw text/details
            raw_postgrest_msg = f"relation api_keys internal constraint failed near {self.secret_key}"
            self.transport.next_response = (
                406,
                {"content-type": "application/json"},
                json.dumps({"code": "PGRST116", "message": raw_postgrest_msg, "details": "row details"}).encode(),
            )
            with self.assertRaises(SupabaseAPIKeyError) as ctx4:
                self.repo.list_user_api_keys("sub-1")
            self.assertNotIn("PGRST116", str(ctx4.exception))
            self.assertNotIn("internal constraint failed", str(ctx4.exception))
            self.assertNotIn(self.secret_key, str(ctx4.exception))

        combined_logs = "\n".join(log_cm.output)
        self.assertNotIn(self.secret_key, combined_logs)
        self.assertNotIn(self.supabase_url, combined_logs)
        self.assertNotIn("Internal error referencing", combined_logs)
        self.assertNotIn("internal constraint failed", combined_logs)
        self.assertNotIn("row details", combined_logs)
        self.assertIn("Supabase REST GET api_keys failed (status=502, code=None, diag=bad_gateway_json_error).", combined_logs)
        self.assertIn("Supabase REST GET api_keys rejected (status=406, code=PGRST116).", combined_logs)

    def test_postgrest_error_logging_omits_details_hint_and_raw_messages(self) -> None:
        _, prefix, secret_hash = generate_api_key("live")
        secret_user_id = "cognito_secret_api_key_owner_55"
        secret_org_id = str(uuid.uuid4())
        secret_key_id = str(uuid.uuid4())
        secret_submitted_uuid = "submitted-bad-uuid-secret-123"
        secret_dsn = "postgresql://postgres:secret_pw@db.internal:5432/postgres"
        secret_hint = f"HINT_LEAK_CHECK {secret_user_id}"

        with self.assertLogs("inferxe.supabase_api_keys", level=logging.WARNING) as log_cm:
            # 1. Missing profile FK keeps profile classification while omitting user_id details/message/hint
            self.transport.next_response = (
                409,
                {"content-type": "application/json"},
                json.dumps({
                    "code": "23503",
                    "message": 'insert or update on table "api_keys" violates foreign key constraint "api_keys_user_id_fkey"',
                    "details": f'Key (user_id)=({secret_user_id}) is not present in table "profiles".',
                    "hint": secret_hint,
                }).encode(),
            )
            with self.assertRaises(SupabaseAPIKeyValidationError) as ctx_prof:
                self.repo.create_api_key(
                    user_id=secret_user_id,
                    name="Key",
                    key_prefix=prefix,
                    secret_hash=secret_hash,
                )
            self.assertIn("profile", str(ctx_prof.exception).lower())

            # 2. Organization FK keeps organization classification while omitting organization_id details/message/hint
            self.transport.next_response = (
                409,
                {"content-type": "application/json"},
                json.dumps({
                    "code": "23503",
                    "message": 'insert or update on table "api_keys" violates foreign key constraint "api_keys_organization_id_fkey"',
                    "details": f'Key (organization_id)=({secret_org_id}) is not present in table "organizations".',
                    "hint": secret_hint,
                }).encode(),
            )
            with self.assertRaises(SupabaseAPIKeyValidationError) as ctx_org:
                self.repo.create_api_key(
                    user_id=secret_user_id,
                    name="Org Key",
                    key_prefix=prefix,
                    secret_hash=secret_hash,
                    organization_id=secret_org_id,
                )
            self.assertIn("organization", str(ctx_org.exception).lower())

            # 3. 23505 conflict containing key UUID is omitted from logs
            self.transport.next_response = (
                409,
                {"content-type": "application/json"},
                json.dumps({
                    "code": "23505",
                    "message": f'duplicate key value violates unique constraint "api_keys_pkey" {secret_key_id}',
                    "details": f"Key (id)=({secret_key_id}) already exists.",
                    "hint": secret_hint,
                }).encode(),
            )
            with self.assertRaises(SupabaseAPIKeyValidationError):
                self.repo.create_api_key(
                    user_id=secret_user_id,
                    name="Dup Key",
                    key_prefix=prefix,
                    secret_hash=secret_hash,
                )

            # 4. 400 malformed UUID + adversarial code string never leaks submitted values
            adversarial_code = str(uuid.uuid4())
            self.transport.next_response = (
                400,
                {"content-type": "application/json"},
                json.dumps({
                    "code": "22P02",
                    "message": f'invalid input syntax for type uuid: "{secret_submitted_uuid}"',
                    "details": f"Key (id)=({secret_key_id}) for user {secret_user_id}",
                    "hint": secret_hint,
                }).encode(),
            )
            with self.assertRaises(SupabaseAPIKeyValidationError) as ctx_400:
                self.repo.revoke_api_key(key_id=secret_key_id, user_id=secret_user_id)
            self.assertNotIn(secret_submitted_uuid, str(ctx_400.exception))

            self.transport.next_response = (
                400,
                {"content-type": "application/json"},
                json.dumps({
                    "code": adversarial_code,
                    "message": f"submitted {secret_submitted_uuid}",
                    "details": secret_org_id,
                }).encode(),
            )
            with self.assertRaises(SupabaseAPIKeyValidationError):
                self.repo.list_user_api_keys(secret_user_id)

            # 5. 5xx error logs safe category without raw message/details/hint/DSNs
            self.transport.next_response = (
                503,
                {"content-type": "application/json"},
                json.dumps({
                    "code": "08006",
                    "message": f"upstream failure {secret_dsn} for {secret_user_id} {secret_key_id}",
                    "details": f"Key (organization_id)=({secret_org_id})",
                    "hint": secret_hint,
                }).encode(),
            )
            with self.assertRaises(SupabaseAPIKeyServiceUnavailableError) as ctx_503:
                self.repo.list_user_api_keys(secret_user_id)
            self.assertNotIn(secret_dsn, str(ctx_503.exception))

            # 6. Untrusted method/resource values are never echoed into logs
            self.transport.next_response = (
                400,
                {"content-type": "application/json"},
                json.dumps({"code": "PGRST100", "message": "bad filter"}).encode(),
            )
            with self.assertRaises(SupabaseAPIKeyValidationError):
                self.repo._request_json("UNTRUSTED", f"bad_resource/{secret_user_id}")

        combined = "\n".join(log_cm.output)
        for forbidden in (
            secret_user_id,
            secret_org_id,
            secret_key_id,
            secret_submitted_uuid,
            secret_dsn,
            "secret_pw",
            secret_hint,
            adversarial_code,
            "violates foreign key constraint",
            "duplicate key value",
            "invalid input syntax",
            "upstream failure",
            "Key (",
            "details=",
            "hint=",
            "UNTRUSTED",
            "bad_resource",
        ):
            self.assertNotIn(forbidden, combined)

        self.assertIn("Supabase REST POST api_keys rejected (status=409, code=23503).", combined)
        self.assertIn("Supabase REST POST api_keys rejected (status=409, code=23505).", combined)
        self.assertIn("Supabase REST PATCH api_keys rejected (status=400, code=22P02).", combined)
        self.assertIn("Supabase REST GET api_keys rejected (status=400, code=None).", combined)
        self.assertIn(
            "Supabase REST GET api_keys failed (status=503, code=08006, diag=service_unavailable_json_error).",
            combined,
        )
        self.assertIn("Supabase REST UNKNOWN unknown_resource rejected (status=400, code=PGRST100).", combined)

    def test_fk_profile_missing_vs_unrelated_foreign_key(self) -> None:
        _, prefix, secret_hash = generate_api_key("live")

        # 1. Missing profile constraint -> customer profile initialization message, zero profile writes
        self.transport.next_response = (
            409,
            {"content-type": "application/json"},
            json.dumps({
                "code": "23503",
                "message": 'insert or update on table "api_keys" violates foreign key constraint "api_keys_user_id_fkey"',
                "details": 'Key (user_id)=(sub-unsynced) is not present in table "profiles".',
            }).encode(),
        )
        with self.assertRaises(SupabaseAPIKeyValidationError) as ctx_profile:
            self.repo.create_api_key(
                user_id="sub-unsynced",
                name="Key",
                key_prefix=prefix,
                secret_hash=secret_hash,
            )
        self.assertIn("profile", str(ctx_profile.exception).lower())
        self.assertFalse(any("/profiles" in req["path"] for req in self.transport.requests))

        # 2. Organization FK constraint -> organization error, NOT missing profile
        self.transport.next_response = (
            409,
            {"content-type": "application/json"},
            json.dumps({
                "code": "23503",
                "message": 'insert or update on table "api_keys" violates foreign key constraint "api_keys_organization_id_fkey"',
                "details": 'Key (organization_id)=(org-1) is not present in table "organizations".',
            }).encode(),
        )
        with self.assertRaises(SupabaseAPIKeyValidationError) as ctx_org:
            self.repo.create_api_key(
                user_id="sub-synced",
                name="Org Key",
                key_prefix=prefix,
                secret_hash=secret_hash,
                organization_id=str(uuid.uuid4()),
            )
        self.assertIn("organization", str(ctx_org.exception).lower())
        self.assertNotIn("profile", str(ctx_org.exception).lower())

        # 3. Any other unrelated FK constraint -> generic prerequisite error, NOT missing profile or raw SQL
        self.transport.next_response = (
            409,
            {"content-type": "application/json"},
            json.dumps({
                "code": "23503",
                "message": 'insert or update on table "api_keys" violates foreign key constraint "api_keys_workspace_id_fkey"',
                "details": 'Key (workspace_id)=(ws-1) is not present in table "workspaces".',
            }).encode(),
        )
        with self.assertRaises(SupabaseAPIKeyValidationError) as ctx_other:
            self.repo.create_api_key(
                user_id="sub-synced",
                name="Other FK Key",
                key_prefix=prefix,
                secret_hash=secret_hash,
            )
        self.assertNotIn("profile", str(ctx_other.exception).lower())
        self.assertNotIn("workspaces", str(ctx_other.exception).lower())

    def test_real_urllib_urlopen_transport_mocked(self) -> None:
        repo = SupabaseAPIKeyRepository(settings=self.settings, timeout=4.2)
        fake_response = MagicMock()
        fake_response.status = 200
        fake_response.headers = {"Content-Type": "application/json"}
        fake_response.read.return_value = b"[]"
        fake_cm = MagicMock()
        fake_cm.__enter__.return_value = fake_response
        fake_cm.__exit__.return_value = False

        with patch("urllib.request.urlopen", return_value=fake_cm) as mock_urlopen:
            keys = repo.list_user_api_keys("cognito-sub-wire")
            self.assertEqual(keys, [])
            mock_urlopen.assert_called_once()
            req_obj = mock_urlopen.call_args[0][0]
            self.assertEqual(mock_urlopen.call_args[1]["timeout"], 4.2)
            self.assertEqual(req_obj.get_header("Apikey"), self.secret_key)
            self.assertIsNone(req_obj.get_header("Authorization"))
            self.assertIn("user_id=eq.cognito-sub-wire", req_obj.full_url)

    def test_safe_timing_and_phase_diagnostic_logging_without_leaking_secrets(self) -> None:
        secret_user = "cognito_secret_user_diag_99"
        _, prefix, secret_hash = generate_api_key("live")
        seeded = self.transport.seed_row({
            "user_id": secret_user,
            "name": "Diag Key",
            "key_prefix": prefix,
            "secret_hash": secret_hash,
        })

        # 1. Info diagnostic log includes allowlisted non-secret timing and upstream latency fields only
        self.transport.next_response = (
            200,
            {
                "Content-Type": "application/json",
                "Connection": "close",
                "X-Envoy-Upstream-Service-Time": "24",
                "X-Envoy-Attempt-Count": "1",
                "CF-Ray": f"secret-ray-{secret_user}",
            },
            json.dumps([seeded]).encode(),
        )
        with self.assertLogs("inferxe.supabase_api_keys", level=logging.INFO) as info_cm:
            keys = self.repo.list_user_api_keys(secret_user)
            self.assertEqual(len(keys), 1)
        info_logs = "\n".join(info_cm.output)
        self.assertIn("Supabase REST GET api_keys completed (status=200, elapsed_ms=", info_logs)
        self.assertIn("conn=close, upstream_ms=24, attempts=1", info_logs)
        for forbidden in (secret_user, prefix, secret_hash, seeded["id"], self.secret_key, self.supabase_url, "secret-ray"):
            self.assertNotIn(forbidden, info_logs)

        # 2. Adversarial header values fail closed to safe defaults and never enter logs
        self.transport.next_response = (
            200,
            {
                "connection": f"https://evil.internal/{self.secret_key}",
                "x-envoy-upstream-service-time": f"20 {self.secret_key}",
                "x-envoy-attempt-count": "not-an-int",
            },
            b"[]",
        )
        with self.assertLogs("inferxe.supabase_api_keys", level=logging.INFO) as adv_cm:
            self.repo.list_user_api_keys(secret_user)
        adv_logs = "\n".join(adv_cm.output)
        self.assertIn("conn=unknown, upstream_ms=None, attempts=None", adv_logs)
        self.assertNotIn(self.secret_key, adv_logs)
        self.assertNotIn("evil.internal", adv_logs)

        # 3. Slow threshold warning triggers cleanly without exposing sensitive query details
        with patch("inference.supabase_api_keys.SLOW_SUPABASE_REQUEST_MS", 0.0):
            with self.assertLogs("inferxe.supabase_api_keys", level=logging.WARNING) as slow_cm:
                self.repo.list_user_api_keys(secret_user)
            slow_logs = "\n".join(slow_cm.output)
            self.assertIn("Slow Supabase REST GET api_keys response (status=200, elapsed_ms=", slow_logs)
            self.assertNotIn(secret_user, slow_logs)
            self.assertNotIn(self.secret_key, slow_logs)

        # 4. Urllib transport phase diagnostics distinguish urlopen_headers vs read_body timeouts safely
        real_repo = SupabaseAPIKeyRepository(settings=self.settings, timeout=2.5)
        with self.assertLogs("inferxe.supabase_api_keys", level=logging.WARNING) as phase_cm:
            with patch("urllib.request.urlopen", side_effect=TimeoutError("timed out at headers")):
                with self.assertRaises(SupabaseAPIKeyServiceUnavailableError):
                    real_repo.list_user_api_keys(secret_user)

            hang_resp = MagicMock()
            hang_resp.status = 200
            hang_resp.headers = {"Connection": "close"}
            hang_resp.read.side_effect = TimeoutError("timed out reading body")
            hang_cm = MagicMock()
            hang_cm.__enter__.return_value = hang_resp
            hang_cm.__exit__.return_value = False
            with patch("urllib.request.urlopen", return_value=hang_cm):
                with self.assertRaises(SupabaseAPIKeyServiceUnavailableError):
                    real_repo.list_user_api_keys(secret_user)

        phase_logs = "\n".join(phase_cm.output)
        self.assertIn("Supabase urllib GET transport failed (phase=urlopen_headers,", phase_logs)
        self.assertIn("error=TimeoutError", phase_logs)
        self.assertIn("Supabase urllib GET transport failed (phase=read_body,", phase_logs)
        self.assertIn("Supabase REST GET api_keys timed out after 2.5s (elapsed_ms=", phase_logs)
        for forbidden in (secret_user, self.secret_key, self.supabase_url, "timed out at headers", "timed out reading body"):
            self.assertNotIn(forbidden, phase_logs)


class TestSupabaseAPIKeysFastAPIIntegration(unittest.TestCase):
    """End-to-end FastAPI endpoint tests for Phase 1 API Keys + Inference verification."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.engine = create_engine(
            "sqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )

        # Enforce SQLite FK checks to test cross-DB telemetry safety with PostgreSQL-like FK behavior
        @event.listens_for(cls.engine, "connect")
        def _set_sqlite_pragma(dbapi_connection, _connection_record):
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()

        cls.TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=cls.engine)
        Base.metadata.create_all(bind=cls.engine)
        cls.client = TestClient(app, raise_server_exceptions=False)

    def setUp(self) -> None:
        self.db = self.TestingSessionLocal()
        self.transport = MockSupabaseAPIKeysTransport()
        self.telemetry_rows: List[Dict[str, Any]] = []

        def telemetry_capture_transport(
            _method: str,
            _url: str,
            _headers: Dict[str, str],
            body: Optional[bytes],
            _timeout: float,
        ) -> Tuple[int, Dict[str, str], bytes]:
            payload = json.loads(body.decode("utf-8")) if body else {}
            row = {
                "id": str(payload.get("id") or uuid.uuid4()),
                "user_id": payload.get("user_id"),
                "organization_id": payload.get("organization_id"),
                "api_key_id": payload.get("api_key_id"),
                "deployment_id": payload.get("deployment_id"),
                "model_name": payload.get("model_name"),
                "provider_name": payload.get("provider_name"),
                "input_tokens": payload.get("input_tokens", 0),
                "output_tokens": payload.get("output_tokens", 0),
                "latency_ms": payload.get("latency_ms"),
                "status": payload.get("status", "success"),
                "error_message": payload.get("error_message"),
                "cost": payload.get("cost", 0.0),
                "created_at": payload.get("created_at") or datetime.now(timezone.utc).isoformat(),
            }
            self.telemetry_rows.append(row)
            return 201, {"content-type": "application/json"}, json.dumps([row]).encode()

        self.settings = SupabaseSettings(
            url="https://api-test-project.supabase.co",
            service_role_key="sb_secret_" + "endpoint_test_mock",
        )
        self.repo = SupabaseAPIKeyRepository(settings=self.settings, transport=self.transport)
        self.telemetry_repo = SupabaseTelemetryRepository(
            settings=self.settings, transport=telemetry_capture_transport
        )

        def override_get_db():
            try:
                yield self.db
            finally:
                pass

        app.dependency_overrides[get_db] = override_get_db
        app.dependency_overrides[get_api_key_repository] = lambda: self.repo
        app.dependency_overrides[get_telemetry_repository] = lambda: self.telemetry_repo

    def tearDown(self) -> None:
        self.db.query(InferenceRequestRecord).delete()
        self.db.commit()
        self.db.close()
        app.dependency_overrides.clear()

    def test_api_key_routes_are_synchronous_def_handlers(self) -> None:
        self.assertFalse(inspect.iscoroutinefunction(create_api_key_route))
        self.assertFalse(inspect.iscoroutinefunction(list_api_keys_route))
        self.assertFalse(inspect.iscoroutinefunction(revoke_api_key_route))

    def test_create_ignores_untrusted_user_id_and_lists_only_owners_keys(self) -> None:
        jwt_alice = make_mock_cognito_jwt("cognito_alice_sub")
        jwt_bob = make_mock_cognito_jwt("cognito_bob_sub")

        create_resp = self.client.post(
            "/api/v1/api-keys",
            json={
                "name": "Alice Test Env Key",
                "environment": "test",
                "user_id": "cognito_attacker_sub",
            },
            headers={"Authorization": f"Bearer {jwt_alice}"},
        )
        self.assertEqual(create_resp.status_code, 201)
        body = create_resp.json()
        self.assertEqual(body["environment"], "test")
        self.assertTrue(body["api_key"].startswith("inf_test_"))

        # Verify persisted under verified Cognito sub, not spoofed body user_id
        stored = self.transport.rows[body["id"]]
        self.assertEqual(stored["user_id"], "cognito_alice_sub")
        self.assertEqual(stored["secret_hash"], hash_api_key(body["api_key"]))

        # Bob cannot see Alice's key and cannot revoke it
        bob_list = self.client.get("/api/v1/api-keys", headers={"Authorization": f"Bearer {jwt_bob}"})
        self.assertEqual(bob_list.status_code, 200)
        self.assertEqual(bob_list.json()["keys"], [])

        bob_del = self.client.delete(
            f"/api/v1/api-keys/{body['id']}",
            headers={"Authorization": f"Bearer {jwt_bob}"},
        )
        self.assertEqual(bob_del.status_code, 403)

    def test_concurrent_delete_endpoint_returns_single_revoked_and_idempotent_responses(self) -> None:
        jwt_alice = make_mock_cognito_jwt("cognito_concurrent_user")
        create_resp = self.client.post(
            "/api/v1/api-keys",
            json={"name": "Parallel Key", "environment": "live"},
            headers={"Authorization": f"Bearer {jwt_alice}"},
        )
        self.assertEqual(create_resp.status_code, 201)
        key_id = create_resp.json()["id"]

        r1 = self.client.delete(f"/api/v1/api-keys/{key_id}", headers={"Authorization": f"Bearer {jwt_alice}"})
        r2 = self.client.delete(f"/api/v1/api-keys/{key_id}", headers={"Authorization": f"Bearer {jwt_alice}"})
        self.assertEqual(r1.status_code, 200)
        self.assertEqual(r2.status_code, 200)
        self.assertEqual(r1.json()["message"], "API key revoked successfully.")
        self.assertEqual(r2.json()["message"], "API key is already revoked.")

    def test_expired_and_malformed_status_keys_rejected_on_inference_without_updating_last_used(self) -> None:
        raw_exp, prefix_exp, hash_exp = generate_api_key("live")
        seeded_exp = self.transport.seed_row({
            "user_id": "cognito_exp_user",
            "name": "Expired Key",
            "key_prefix": prefix_exp,
            "secret_hash": hash_exp,
            "expires_at": (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat(),
        })

        resp = self.client.post(
            "/api/v1/inference",
            json={"prompt": "Hello"},
            headers={"Authorization": f"Bearer {raw_exp}"},
        )
        self.assertEqual(resp.status_code, 401)
        self.assertIn("expired", resp.json()["detail"].lower())
        self.assertIsNone(self.transport.rows[seeded_exp["id"]]["last_used_at"])

        raw_blank, prefix_blank, hash_blank = generate_api_key("live")
        seeded_blank = self.transport.seed_row({
            "user_id": "cognito_blank_status_user",
            "name": "Blank Status Key",
            "key_prefix": prefix_blank,
            "secret_hash": hash_blank,
            "status": "   ",
        })
        resp_blank = self.client.post(
            "/api/v1/inference",
            json={"prompt": "Hello"},
            headers={"Authorization": f"Bearer {raw_blank}"},
        )
        self.assertEqual(resp_blank.status_code, 401)
        self.assertIn("revoked or is inactive", resp_blank.json()["detail"].lower())
        self.assertIsNone(self.transport.rows[seeded_blank["id"]]["last_used_at"])

    def test_valid_key_inference_updates_last_used_and_records_supabase_telemetry(self) -> None:
        raw_valid, prefix_valid, hash_valid = generate_api_key("live")
        seeded = self.transport.seed_row({
            "user_id": "cognito_live_user",
            "name": "Active Key",
            "key_prefix": prefix_valid,
            "secret_hash": hash_valid,
            "expires_at": (datetime.now(timezone.utc) + timedelta(days=30)).isoformat(),
        })

        mock_result = {
            "provider": "nvidia",
            "model": "nvidia/nemotron-3.5-bolt-e4b",
            "content": "Inference response ok.",
            "finish_reason": "stop",
            "usage": {"prompt_tokens": 5, "completion_tokens": 7, "total_tokens": 12},
        }
        with patch.object(inference_service.provider, "generate", return_value=mock_result):
            resp = self.client.post(
                "/api/v1/inference",
                json={"prompt": "Say hello"},
                headers={"Authorization": f"Bearer {raw_valid}"},
            )

        self.assertEqual(resp.status_code, 200)
        self.assertIsNotNone(self.transport.rows[seeded["id"]]["last_used_at"])

        # Confirm Phase 2 telemetry persisted directly to Supabase with actual api_key_id and zero local DB writes
        self.assertEqual(self.db.query(InferenceRequestRecord).all(), [])
        self.assertEqual(len(self.telemetry_rows), 1)
        self.assertEqual(self.telemetry_rows[0]["user_id"], "cognito_live_user")
        self.assertEqual(self.telemetry_rows[0]["api_key_id"], seeded["id"])

    def test_sanitized_502_and_503_responses_for_postgrest_and_malformed_payloads(self) -> None:
        jwt_alice = make_mock_cognito_jwt("cognito_alice_sub")
        raw_key, _, _ = generate_api_key("live")

        with self.assertLogs("inferxe", level=logging.WARNING) as log_cm:
            # 1. Raw PostgREST 4xx rejection never leaks internal SQL/constraint details to HTTP client
            raw_postgrest_detail = json.dumps({
                "code": "42883",
                "message": "operator does not exist referencing " + "sb_secret_mock",
                "details": "secret internal hint",
            }).encode()
            for method_call in (
                lambda: self.client.post("/api/v1/api-keys", json={"name": "K"}, headers={"Authorization": f"Bearer {jwt_alice}"}),
                lambda: self.client.get("/api/v1/api-keys", headers={"Authorization": f"Bearer {jwt_alice}"}),
                lambda: self.client.delete(f"/api/v1/api-keys/{uuid.uuid4()}", headers={"Authorization": f"Bearer {jwt_alice}"}),
            ):
                self.transport.next_response = (406, {"content-type": "application/json"}, raw_postgrest_detail)
                resp = method_call()
                self.assertEqual(resp.status_code, 502)
                self.assertEqual(resp.json()["detail"], "Upstream API key database rejected the request.")
                self.assertNotIn("operator does not exist", resp.text)
                self.assertNotIn("sb_secret_", resp.text)

            # 2. Malformed API key row from Supabase fails closed cleanly with HTTP 503
            self.transport.next_response = (
                200,
                {"content-type": "application/json"},
                json.dumps([{"id": "not-a-uuid", "user_id": "cognito_alice_sub"}]).encode(),
            )
            r_malformed = self.client.get("/api/v1/api-keys", headers={"Authorization": f"Bearer {jwt_alice}"})
            self.assertEqual(r_malformed.status_code, 503)

            # 3. HTTP transport failure and URLError/timeout fail cleanly with sanitized 503
            self.transport.next_error = urllib.error.URLError("connection refused")
            r_list = self.client.get("/api/v1/api-keys", headers={"Authorization": f"Bearer {jwt_alice}"})
            self.assertEqual(r_list.status_code, 503)
            self.assertNotIn("sb_secret_", r_list.text)
            self.assertNotIn("api-test-project", r_list.text)

            self.transport.next_error = TimeoutError("socket timeout")
            r_inf = self.client.post(
                "/api/v1/inference",
                json={"prompt": "Test"},
                headers={"Authorization": f"Bearer {raw_key}"},
            )
            self.assertEqual(r_inf.status_code, 503)
            self.assertNotIn("sb_secret_", r_inf.text)
            self.assertNotIn("api-test-project", r_inf.text)

        joined_logs = "\n".join(log_cm.output)
        self.assertNotIn("sb_secret_", joined_logs)
        self.assertNotIn(raw_key, joined_logs)
        self.assertIn("42883", joined_logs)


if __name__ == "__main__":
    unittest.main()
