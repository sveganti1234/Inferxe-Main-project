"""
test_supabase_telemetry.py
==========================
Comprehensive unit and API integration tests for Inferxe Phase 2 Supabase
Inference Usage Tracking and Telemetry migration (`inference_requests`).

Covers:
- Live Supabase `inference_requests` schema column & constraint fidelity
- Direct `api_key_id`, `user_id`, `organization_id`, and `deployment_id` persistence
- Field mapping (`provider_name`, `model_name`, `input_tokens`, `output_tokens`, `cost`)
  and derived `total_tokens` (`input_tokens + output_tokens`)
- Rejection of spoofed payload ownership fields
- Failure & timeout telemetry (`RateLimitError`, `APITimeoutError`, `AuthenticationError`,
  `APIConnectionError`/`APIStatusError`, unexpected `Exception`)
- Telemetry resilience when Supabase fails/times out/returns 4xx/5xx/FK error
- Sanitized logging & telemetry storage (never leaks prompts, responses, API keys, JWTs, URLs)
- Duplicate request ID prevention (`23505` / `409 Conflict`)
- Concurrent inference execution thread-safety (`threading.Barrier`)
- Zero local PostgreSQL `InferenceRequestRecord` or `APIKey` dependency
- Wire-level `urllib.request.urlopen` mocking (zero live Supabase calls)
"""

import http.client
import inspect
import json
import logging
import os
import sys
import threading
import unittest
import urllib.error
import urllib.parse
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Dict, List, Optional, Tuple
from unittest.mock import MagicMock, patch

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("NVIDIA_API_KEY", "nvapi-test-dummy-key-for-unit-testing")
os.environ.setdefault("INFERXE_TEST_MODE", "1")

BACKEND_DIR = Path(__file__).resolve().parents[2]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from fastapi import HTTPException  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from openai import (  # noqa: E402
    APIConnectionError,
    APITimeoutError,
    AuthenticationError,
    RateLimitError,
)
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from inference.auth import generate_api_key  # noqa: E402
from inference.database import Base, get_db  # noqa: E402
from inference.main import app  # noqa: E402
from inference.models import InferenceRequest as InferenceRequestRecord  # noqa: E402
from inference.routes import inference_service, run_inference as run_inference_route  # noqa: E402
from inference.schemas import InferenceRequest  # noqa: E402
from inference.service import InferenceService  # noqa: E402
from inference.supabase_api_keys import (  # noqa: E402
    SupabaseAPIKeyRecord,
    SupabaseAPIKeyRepository,
    get_api_key_repository,
)
from inference.supabase_config import SupabaseSettings  # noqa: E402
from inference.supabase_telemetry import (  # noqa: E402
    INT32_MAX,
    SupabaseInferenceTelemetryRecord,
    SupabaseTelemetryConflictError,
    SupabaseTelemetryError,
    SupabaseTelemetryRepository,
    SupabaseTelemetryServiceUnavailableError,
    SupabaseTelemetryValidationError,
    calculate_inference_cost,
    get_telemetry_repository,
    sanitize_diagnostic_text,
)
from inference.tests.test_supabase_api_keys import MockSupabaseAPIKeysTransport  # noqa: E402

SUPABASE_INFERENCE_REQUEST_COLUMNS = {
    "id",
    "user_id",
    "organization_id",
    "api_key_id",
    "deployment_id",
    "model_name",
    "provider_name",
    "input_tokens",
    "output_tokens",
    "latency_ms",
    "status",
    "error_message",
    "cost",
    "created_at",
}


class MockSupabaseTelemetryTransport:
    """
    Thread-safe in-memory PostgREST simulator enforcing the verified Supabase
    `inference_requests` schema, PK uniqueness, `eq.` filters, ordering, and limit.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.rows: Dict[str, Dict[str, Any]] = {}
        self.requests: List[Dict[str, Any]] = []
        self.next_error: Optional[Exception] = None
        self.next_response: Optional[Tuple[int, Dict[str, str], bytes]] = None

    def seed_row(self, row: Dict[str, Any]) -> Dict[str, Any]:
        unknown = set(row.keys()) - SUPABASE_INFERENCE_REQUEST_COLUMNS
        if unknown:
            raise AssertionError(f"Unknown Supabase inference_requests columns in seed: {unknown}")
        stored = {
            "id": str(row.get("id") or uuid.uuid4()),
            "user_id": row["user_id"],
            "organization_id": row.get("organization_id"),
            "api_key_id": row.get("api_key_id"),
            "deployment_id": row.get("deployment_id"),
            "model_name": row.get("model_name"),
            "provider_name": row.get("provider_name"),
            "input_tokens": row.get("input_tokens", 0),
            "output_tokens": row.get("output_tokens", 0),
            "latency_ms": row.get("latency_ms"),
            "status": row.get("status", "pending"),
            "error_message": row.get("error_message"),
            "cost": row.get("cost", 0.0),
            "created_at": row.get("created_at") or datetime.now(timezone.utc).isoformat(),
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

            if not parsed.path.endswith("/rest/v1/inference_requests"):
                return 404, {"content-type": "application/json"}, json.dumps({"message": "Not found"}).encode()

            select_cols: Optional[List[str]] = None
            if "select" in query:
                select_cols = [c.strip() for c in query["select"][0].split(",") if c.strip()]
                unknown_sel = set(select_cols) - SUPABASE_INFERENCE_REQUEST_COLUMNS
                if unknown_sel:
                    return (
                        400,
                        {"content-type": "application/json"},
                        json.dumps({"code": "PGRST204", "message": f"Unknown columns: {sorted(unknown_sel)}"}).encode(),
                    )

            if method == "POST":
                assert isinstance(parsed_body, dict)
                unknown_ins = set(parsed_body.keys()) - SUPABASE_INFERENCE_REQUEST_COLUMNS
                if unknown_ins:
                    return (
                        400,
                        {"content-type": "application/json"},
                        json.dumps({"code": "PGRST204", "message": f"Could not find columns {sorted(unknown_ins)}"}).encode(),
                    )

                for req_col in ("input_tokens", "output_tokens", "status", "cost"):
                    if parsed_body.get(req_col) is None:
                        return (
                            400,
                            {"content-type": "application/json"},
                            json.dumps({"code": "23502", "message": f"null value in column {req_col}"}).encode(),
                        )

                row_id = str(parsed_body.get("id") or uuid.uuid4())
                if row_id in self.rows:
                    return (
                        409,
                        {"content-type": "application/json"},
                        json.dumps({
                            "code": "23505",
                            "message": 'duplicate key value violates unique constraint "inference_requests_pkey"',
                        }).encode(),
                    )

                stored = {
                    "id": row_id,
                    "user_id": parsed_body.get("user_id"),
                    "organization_id": parsed_body.get("organization_id"),
                    "api_key_id": parsed_body.get("api_key_id"),
                    "deployment_id": parsed_body.get("deployment_id"),
                    "model_name": parsed_body.get("model_name"),
                    "provider_name": parsed_body.get("provider_name"),
                    "input_tokens": parsed_body["input_tokens"],
                    "output_tokens": parsed_body["output_tokens"],
                    "latency_ms": parsed_body.get("latency_ms"),
                    "status": parsed_body["status"],
                    "error_message": parsed_body.get("error_message"),
                    "cost": parsed_body["cost"],
                    "created_at": parsed_body.get("created_at") or datetime.now(timezone.utc).isoformat(),
                }
                self.rows[stored["id"]] = stored
                return 201, {"content-type": "application/json"}, json.dumps([self._project(stored, select_cols)]).encode()

            if method == "GET":
                filter_checks: List[Tuple[str, str, Optional[str]]] = []
                for k, vals in query.items():
                    if k in ("select", "order", "limit"):
                        continue
                    if k not in SUPABASE_INFERENCE_REQUEST_COLUMNS:
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
                        elif cur is None or str(cur) != fval:
                            return False
                    return True

                matched = [row for row in self.rows.values() if _matches(row)]
                order_expr = query.get("order", [""])[0]
                if order_expr == "created_at.desc":
                    matched.sort(key=lambda r: r.get("created_at") or "", reverse=True)
                if "limit" in query:
                    matched = matched[: int(query["limit"][0])]
                return (
                    200,
                    {"content-type": "application/json"},
                    json.dumps([self._project(r, select_cols) for r in matched]).encode(),
                )

            return 405, {}, b""

    @staticmethod
    def _project(row: Dict[str, Any], select_cols: Optional[List[str]]) -> Dict[str, Any]:
        if not select_cols:
            return dict(row)
        return {col: row.get(col) for col in select_cols}


class TestSupabaseTelemetryRepository(unittest.TestCase):
    """Focused unit tests for `SupabaseTelemetryRepository`, validation, mapping, and resilience."""

    def setUp(self) -> None:
        self.secret_key = "sb_secret_telemetry_unit_secret"
        self.supabase_url = "https://unit-telemetry-project.supabase.co"
        self.settings = SupabaseSettings(url=self.supabase_url, service_role_key=self.secret_key)
        self.transport = MockSupabaseTelemetryTransport()
        self.repo = SupabaseTelemetryRepository(settings=self.settings, timeout=6.5, transport=self.transport)

    def test_record_inference_request_schema_headers_and_derived_total_tokens(self) -> None:
        req_id = uuid.uuid4()
        key_id = uuid.uuid4()
        org_id = uuid.uuid4()
        dep_id = uuid.uuid4()

        rec = self.repo.record_inference_request(
            request_id=req_id,
            user_id="cognito-sub-telemetry",
            organization_id=org_id,
            api_key_id=key_id,
            deployment_id=dep_id,
            model_name="nvidia/nemotron-3.5-bolt-e4b",
            provider_name="nvidia",
            input_tokens=140,
            output_tokens=60,
            latency_ms=345,
            status="success",
            cost=Decimal("0.0025"),
        )

        self.assertEqual(rec.id, req_id)
        self.assertEqual(rec.user_id, "cognito-sub-telemetry")
        self.assertEqual(rec.organization_id, org_id)
        self.assertEqual(rec.api_key_id, key_id)
        self.assertEqual(rec.deployment_id, dep_id)
        self.assertEqual(rec.model_name, "nvidia/nemotron-3.5-bolt-e4b")
        self.assertEqual(rec.provider_name, "nvidia")
        self.assertEqual(rec.input_tokens, 140)
        self.assertEqual(rec.output_tokens, 60)
        self.assertEqual(rec.total_tokens, 200)
        self.assertEqual(rec.latency_ms, 345)
        self.assertEqual(rec.status, "success")
        self.assertAlmostEqual(rec.cost, 0.0025)
        self.assertIsNotNone(rec.created_at)

        sent = self.transport.requests[0]
        self.assertEqual(sent["method"], "POST")
        self.assertEqual(sent["path"], "/rest/v1/inference_requests")
        self.assertEqual(sent["headers"]["apikey"], self.secret_key)
        self.assertNotIn("Authorization", sent["headers"])
        self.assertEqual(sent["headers"]["Prefer"], "return=representation")
        self.assertEqual(sent["timeout"], 6.5)
        # Ensure unmapped local column names are never sent to PostgREST
        for forbidden_col in ("provider", "model", "prompt_tokens", "completion_tokens", "total_tokens"):
            self.assertNotIn(forbidden_col, sent["body"])

    def test_input_validation_and_cost_calculation(self) -> None:
        self.assertEqual(
            calculate_inference_cost(model_name="nvidia/nemotron-3.5-bolt-e4b", input_tokens=10, output_tokens=20),
            0.0,
        )
        self.assertEqual(
            calculate_inference_cost(
                model_name="nvidia/nemotron-3.5-bolt-e4b",
                input_tokens=10,
                output_tokens=20,
                explicit_cost="0.012345678",
            ),
            0.01234568,
        )

        invalid_kwargs_list: List[Dict[str, Any]] = [
            {"user_id": "   ", "model_name": "m"},
            {"user_id": "u1", "model_name": ""},
            {"user_id": "u1", "model_name": "m", "provider_name": " "},
            {"user_id": "u1", "model_name": "m", "status": "bogus"},
            {"user_id": "u1", "model_name": "m", "input_tokens": -1},
            {"user_id": "u1", "model_name": "m", "output_tokens": True},
            {"user_id": "u1", "model_name": "m", "latency_ms": -5},
            {"user_id": "u1", "model_name": "m", "cost": -0.01},
            {"user_id": "u1", "model_name": "m", "cost": float("nan")},
            {"user_id": "u1", "model_name": "m", "cost": True},
            {"user_id": "u1", "model_name": "m", "api_key_id": "not-a-uuid"},
            {"user_id": "u1", "model_name": "m", "organization_id": "bad-org"},
            {"user_id": "u1", "model_name": "m", "deployment_id": "bad-dep"},
            {"user_id": "u1", "model_name": "m", "request_id": "bad-req"},
            {"user_id": "u1", "model_name": "m", "error_message": 123},
        ]
        for kwargs in invalid_kwargs_list:
            with self.assertRaises(SupabaseTelemetryValidationError):
                self.repo.record_inference_request(**kwargs)

        # Validation failures fail locally before sending HTTP traffic
        self.assertEqual(self.transport.requests, [])

        # Massive latency values are safely clamped to PostgreSQL int32 max
        clamped = self.repo.record_inference_request(
            user_id="u1",
            model_name="m",
            latency_ms=INT32_MAX + 5000,
        )
        self.assertEqual(clamped.latency_ms, INT32_MAX)

    def test_duplicate_request_id_rejected_without_duplicate_rows(self) -> None:
        req_id = uuid.uuid4()
        self.repo.record_inference_request(
            request_id=req_id,
            user_id="sub-dup",
            model_name="nvidia/nemotron-3.5-bolt-e4b",
            input_tokens=10,
            output_tokens=15,
            status="success",
        )
        with self.assertRaises(SupabaseTelemetryConflictError):
            self.repo.record_inference_request(
                request_id=req_id,
                user_id="sub-dup",
                model_name="nvidia/nemotron-3.5-bolt-e4b",
                input_tokens=10,
                output_tokens=15,
                status="success",
            )
        self.assertEqual(len(self.transport.rows), 1)

    def test_error_message_sanitization_and_secret_redaction(self) -> None:
        leaked_uuid = "123e4567-e89b-12d3-a456-426614174000"
        raw_text = (
            "Failed talking to https://secret.supabase.co/rest/v1/x "
            "postgresql://postgres:topsecret@db.internal:5432/inferxe "
            "using sb_secret_abc123 nvapi-xyz987 inf_live_secret_token "
            f"apikey=raw_apikey_value Basic dXNlcjpwYXNz uuid={leaked_uuid} "
            "Bearer supersecrettoken eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1MSJ9.sig\nline2"
        )
        scrubbed = sanitize_diagnostic_text(raw_text, max_len=500)
        for leaked in (
            "secret.supabase.co",
            "topsecret",
            "db.internal",
            "sb_secret_",
            "nvapi-",
            "inf_live_",
            "raw_apikey_value",
            "dXNlcjpwYXNz",
            leaked_uuid,
            "supersecrettoken",
            "eyJhbG",
            "\n",
        ):
            self.assertNotIn(leaked, scrubbed)

        rec = self.repo.record_inference_request(
            user_id="sub-clean",
            model_name="nvidia/nemotron-3.5-bolt-e4b",
            status="failed",
            error_message=raw_text,
        )
        stored_err = self.transport.rows[str(rec.id)]["error_message"]
        self.assertEqual(stored_err, rec.error_message)
        for leaked in (
            "secret.supabase.co",
            "topsecret",
            "sb_secret_",
            "nvapi-",
            "inf_live_",
            "raw_apikey_value",
            leaked_uuid,
            "supersecrettoken",
            "eyJhbG",
        ):
            self.assertNotIn(leaked, stored_err)

    def test_fk_violations_and_transport_error_resilience_without_secret_leaks(self) -> None:
        fk_cases = [
            (
                'insert on table "inference_requests" violates foreign key constraint "inference_requests_user_id_fkey"',
                'Key (user_id)=(u1) is not present in table "profiles".',
                "profile",
            ),
            (
                'insert on table "inference_requests" violates foreign key constraint "inference_requests_api_key_id_fkey"',
                'Key (api_key_id)=(k1) is not present in table "api_keys".',
                "api key",
            ),
            (
                'insert on table "inference_requests" violates foreign key constraint "inference_requests_organization_id_fkey"',
                'Key (organization_id)=(o1) is not present in table "organizations".',
                "organization",
            ),
            (
                'insert on table "inference_requests" violates foreign key constraint "inference_requests_deployment_id_fkey"',
                'Key (deployment_id)=(d1) is not present in table "deployments".',
                "deployment",
            ),
        ]
        with self.assertLogs("inferxe.supabase_telemetry", level=logging.WARNING) as log_cm:
            for msg, details, expected_substr in fk_cases:
                self.transport.next_response = (
                    409,
                    {"content-type": "application/json"},
                    json.dumps({"code": "23503", "message": msg, "details": details}).encode(),
                )
                with self.assertRaises(SupabaseTelemetryValidationError) as ctx:
                    self.repo.record_inference_request(user_id="u1", model_name="m")
                self.assertIn(expected_substr, str(ctx.exception).lower())

            self.transport.next_error = TimeoutError("socket timed out")
            with self.assertRaises(SupabaseTelemetryServiceUnavailableError):
                self.repo.record_inference_request(user_id="u1", model_name="m")

            self.transport.next_error = urllib.error.URLError(f"failed connecting to {self.supabase_url}")
            with self.assertRaises(SupabaseTelemetryServiceUnavailableError):
                self.repo.record_inference_request(user_id="u1", model_name="m")

            self.transport.next_error = http.client.IncompleteRead(b"partial")
            with self.assertRaises(SupabaseTelemetryServiceUnavailableError):
                self.repo.record_inference_request(user_id="u1", model_name="m")

            self.transport.next_response = (
                503,
                {"content-type": "application/json"},
                json.dumps({"message": f"upstream failure with {self.secret_key} and {self.supabase_url}"}).encode(),
            )
            with self.assertRaises(SupabaseTelemetryServiceUnavailableError) as ctx_503:
                self.repo.record_inference_request(user_id="u1", model_name="m")
            self.assertNotIn(self.secret_key, str(ctx_503.exception))
            self.assertNotIn(self.supabase_url, str(ctx_503.exception))

            self.transport.next_response = (200, {"content-type": "application/json"}, b"not-json")
            with self.assertRaises(SupabaseTelemetryServiceUnavailableError):
                self.repo.record_inference_request(user_id="u1", model_name="m")

            self.transport.next_response = (
                201,
                {"content-type": "application/json"},
                json.dumps([{"id": "bad-uuid", "user_id": "u1"}]).encode(),
            )
            with self.assertRaises(SupabaseTelemetryServiceUnavailableError):
                self.repo.record_inference_request(user_id="u1", model_name="m")

        combined = "\n".join(log_cm.output)
        self.assertNotIn(self.secret_key, combined)
        self.assertNotIn(self.supabase_url, combined)
        self.assertNotIn("upstream failure", combined)
        self.assertNotIn("Key (user_id)", combined)
        self.assertIn("Supabase REST POST inference_requests rejected (status=409, code=23503).", combined)
        self.assertIn("status=503", combined)
        self.assertIn("service_unavailable_json_error", combined)

    def test_postgrest_error_logging_omits_sensitive_details_hints_and_messages(self) -> None:
        secret_user_id = "cognito_secret_sub_999111"
        secret_api_key_id = str(uuid.uuid4())
        secret_org_id = str(uuid.uuid4())
        secret_dep_id = str(uuid.uuid4())
        secret_req_id = str(uuid.uuid4())
        secret_submitted_uuid = "malformed-submitted-uuid-secret-value"
        secret_dsn = "postgresql://postgres:dbpass_secret@db.internal:5432/postgres"
        secret_hint = f"HINT_SHOULD_NEVER_BE_LOGGED for {secret_user_id}"

        with self.assertLogs("inferxe.supabase_telemetry", level=logging.WARNING) as log_cm:
            # 1. FK errors containing user_id, api_key_id, organization_id, deployment_id
            fk_payloads = [
                (
                    'insert on table "inference_requests" violates foreign key constraint "inference_requests_user_id_fkey"',
                    f'Key (user_id)=({secret_user_id}) is not present in table "profiles".',
                    "profile",
                ),
                (
                    'insert on table "inference_requests" violates foreign key constraint "inference_requests_api_key_id_fkey"',
                    f'Key (api_key_id)=({secret_api_key_id}) is not present in table "api_keys".',
                    "api key",
                ),
                (
                    'insert on table "inference_requests" violates foreign key constraint "inference_requests_organization_id_fkey"',
                    f'Key (organization_id)=({secret_org_id}) is not present in table "organizations".',
                    "organization",
                ),
                (
                    'insert on table "inference_requests" violates foreign key constraint "inference_requests_deployment_id_fkey"',
                    f'Key (deployment_id)=({secret_dep_id}) is not present in table "deployments".',
                    "deployment",
                ),
            ]
            for msg, details, expected_exc in fk_payloads:
                self.transport.next_response = (
                    409,
                    {"content-type": "application/json"},
                    json.dumps({
                        "code": "23503",
                        "message": msg,
                        "details": details,
                        "hint": secret_hint,
                    }).encode(),
                )
                with self.assertRaises(SupabaseTelemetryValidationError) as ctx_fk:
                    self.repo.record_inference_request(
                        request_id=secret_req_id,
                        user_id=secret_user_id,
                        api_key_id=secret_api_key_id,
                        organization_id=secret_org_id,
                        deployment_id=secret_dep_id,
                        model_name="m",
                    )
                self.assertIn(expected_exc, str(ctx_fk.exception).lower())

            # 2. Duplicate request UUID conflict (23505)
            self.transport.next_response = (
                409,
                {"content-type": "application/json"},
                json.dumps({
                    "code": "23505",
                    "message": f'duplicate key value violates unique constraint "inference_requests_pkey" {secret_req_id}',
                    "details": f"Key (id)=({secret_req_id}) already exists.",
                    "hint": secret_hint,
                }).encode(),
            )
            with self.assertRaises(SupabaseTelemetryConflictError):
                self.repo.record_inference_request(request_id=secret_req_id, user_id=secret_user_id, model_name="m")

            # 3. 400 malformed UUID / submitted identifier in message + details + hint
            self.transport.next_response = (
                400,
                {"content-type": "application/json"},
                json.dumps({
                    "code": "22P02",
                    "message": f'invalid input syntax for type uuid: "{secret_submitted_uuid}" {self.secret_key}',
                    "details": f"Failing row contains user={secret_user_id}, org={secret_org_id}",
                    "hint": secret_hint,
                }).encode(),
            )
            with self.assertRaises(SupabaseTelemetryValidationError) as ctx_bad_uuid:
                self.repo.record_inference_request(user_id=secret_user_id, model_name="m")
            self.assertNotIn(secret_submitted_uuid, str(ctx_bad_uuid.exception))

            # 4. Adversarial PostgREST "code" field containing a UUID or secret is stripped from logs
            adversarial_code_uuid = str(uuid.uuid4())
            self.transport.next_response = (
                406,
                {"content-type": "application/json"},
                json.dumps({
                    "code": adversarial_code_uuid,
                    "message": f"bad query from {secret_user_id}",
                    "details": f"key={secret_api_key_id}",
                    "hint": secret_hint,
                }).encode(),
            )
            with self.assertRaises(SupabaseTelemetryError):
                self.repo.record_inference_request(user_id=secret_user_id, model_name="m")

            # 5. 5xx error responses never leak raw database message/details/hint/DSNs/HTML
            self.transport.next_response = (
                500,
                {"content-type": "application/json"},
                json.dumps({
                    "code": "XX000",
                    "message": f"DB failure {secret_dsn} for {secret_user_id} key {secret_api_key_id} req {secret_req_id}",
                    "details": f"Key (organization_id)=({secret_org_id})",
                    "hint": secret_hint,
                }).encode(),
            )
            with self.assertRaises(SupabaseTelemetryServiceUnavailableError) as ctx_500:
                self.repo.record_inference_request(user_id=secret_user_id, model_name="m")
            self.assertNotIn(secret_dsn, str(ctx_500.exception))

            self.transport.next_response = (
                502,
                {"content-type": "text/html"},
                f"<html>Proxy error talking to {self.supabase_url} for {secret_user_id}</html>".encode(),
            )
            with self.assertRaises(SupabaseTelemetryServiceUnavailableError):
                self.repo.record_inference_request(user_id=secret_user_id, model_name="m")

            self.transport.next_response = (504, {}, b"")
            with self.assertRaises(SupabaseTelemetryServiceUnavailableError):
                self.repo.record_inference_request(user_id=secret_user_id, model_name="m")

            # 6. Untrusted method/resource strings cannot inject arbitrary text into logs
            self.transport.next_response = (
                400,
                {"content-type": "application/json"},
                json.dumps({"code": "PGRST100", "message": "bad filter", "details": secret_user_id}).encode(),
            )
            with self.assertRaises(SupabaseTelemetryValidationError):
                self.repo._request_json("UNTRUSTED_METHOD", f"untrusted/{secret_user_id}")

        combined_logs = "\n".join(log_cm.output)
        for forbidden in (
            secret_user_id,
            secret_api_key_id,
            secret_org_id,
            secret_dep_id,
            secret_req_id,
            secret_submitted_uuid,
            secret_dsn,
            "dbpass_secret",
            secret_hint,
            adversarial_code_uuid,
            self.secret_key,
            self.supabase_url,
            "violates foreign key constraint",
            "duplicate key value",
            "invalid input syntax",
            "Key (",
            "details=",
            "hint=",
            "UNTRUSTED_METHOD",
            "untrusted/",
        ):
            self.assertNotIn(forbidden, combined_logs)

        self.assertIn("Supabase REST POST inference_requests rejected (status=409, code=23503).", combined_logs)
        self.assertIn("Supabase REST POST inference_requests rejected (status=409, code=23505).", combined_logs)
        self.assertIn("Supabase REST POST inference_requests rejected (status=400, code=22P02).", combined_logs)
        self.assertIn("Supabase REST POST inference_requests rejected (status=406, code=None).", combined_logs)
        self.assertIn(
            "Supabase REST POST inference_requests failed (status=500, code=XX000, diag=internal_server_error_json_error).",
            combined_logs,
        )
        self.assertIn(
            "Supabase REST POST inference_requests failed (status=502, code=None, diag=bad_gateway_non_json_error).",
            combined_logs,
        )
        self.assertIn(
            "Supabase REST POST inference_requests failed (status=504, code=None, diag=gateway_timeout_empty_body).",
            combined_logs,
        )
        self.assertIn("Supabase REST UNKNOWN unknown_resource rejected (status=400, code=PGRST100).", combined_logs)

    def test_list_user_inference_requests_enforces_user_isolation(self) -> None:
        self.transport.seed_row({
            "user_id": "user-alpha",
            "model_name": "m1",
            "provider_name": "nvidia",
            "input_tokens": 10,
            "output_tokens": 5,
            "status": "success",
            "cost": "0.001",
            "created_at": "2026-11-10T08:00:00+00:00",
        })
        self.transport.seed_row({
            "user_id": "user-alpha",
            "model_name": "m2",
            "provider_name": "nvidia",
            "input_tokens": 20,
            "output_tokens": 30,
            "status": "success",
            "cost": 0,
            "created_at": "2026-11-10T09:00:00+00:00",
        })
        self.transport.seed_row({
            "user_id": "user-beta",
            "model_name": "secret-model",
            "provider_name": "nvidia",
            "input_tokens": 99,
            "output_tokens": 99,
            "status": "success",
            "created_at": "2026-11-10T10:00:00+00:00",
        })

        records = self.repo.list_user_inference_requests("user-alpha", limit=10)
        self.assertEqual([r.model_name for r in records], ["m2", "m1"])
        self.assertTrue(all(r.user_id == "user-alpha" for r in records))
        self.assertEqual(records[0].total_tokens, 50)
        self.assertAlmostEqual(records[1].cost, 0.001)

    def test_real_urllib_urlopen_transport_mocked(self) -> None:
        repo = SupabaseTelemetryRepository(settings=self.settings, timeout=3.5)
        req_id = str(uuid.uuid4())
        row_payload = [{
            "id": req_id,
            "user_id": "cognito-wire-user",
            "organization_id": None,
            "api_key_id": None,
            "deployment_id": None,
            "model_name": "nvidia/nemotron-3.5-bolt-e4b",
            "provider_name": "nvidia",
            "input_tokens": 8,
            "output_tokens": 12,
            "latency_ms": 42,
            "status": "success",
            "error_message": None,
            "cost": 0,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }]
        fake_response = MagicMock()
        fake_response.status = 201
        fake_response.headers = {"Content-Type": "application/json"}
        fake_response.read.return_value = json.dumps(row_payload).encode()
        fake_cm = MagicMock()
        fake_cm.__enter__.return_value = fake_response
        fake_cm.__exit__.return_value = False

        with patch("urllib.request.urlopen", return_value=fake_cm) as mock_urlopen:
            rec = repo.record_inference_request(
                request_id=req_id,
                user_id="cognito-wire-user",
                model_name="nvidia/nemotron-3.5-bolt-e4b",
                input_tokens=8,
                output_tokens=12,
                latency_ms=42,
            )
            self.assertEqual(rec.total_tokens, 20)
            mock_urlopen.assert_called_once()
            req_obj = mock_urlopen.call_args[0][0]
            self.assertEqual(mock_urlopen.call_args[1]["timeout"], 3.5)
            self.assertEqual(req_obj.get_header("Apikey"), self.secret_key)
            self.assertIsNone(req_obj.get_header("Authorization"))
            self.assertEqual(req_obj.get_header("Prefer"), "return=representation")
            self.assertTrue(req_obj.full_url.startswith(f"{self.supabase_url}/rest/v1/inference_requests"))


class TestSupabaseTelemetryFastAPIIntegration(unittest.TestCase):
    """End-to-end tests integrating `/api/v1/inference` and `InferenceService` with Supabase telemetry."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.engine = create_engine(
            "sqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        cls.TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=cls.engine)
        Base.metadata.create_all(bind=cls.engine)
        cls.client = TestClient(app, raise_server_exceptions=False)

    def setUp(self) -> None:
        self.db = self.TestingSessionLocal()
        self.settings = SupabaseSettings(
            url="https://api-telemetry-test.supabase.co",
            service_role_key="sb_secret_fastapi_telemetry_secret",
        )
        self.api_keys_transport = MockSupabaseAPIKeysTransport()
        self.telemetry_transport = MockSupabaseTelemetryTransport()
        self.api_keys_repo = SupabaseAPIKeyRepository(
            settings=self.settings, transport=self.api_keys_transport
        )
        self.telemetry_repo = SupabaseTelemetryRepository(
            settings=self.settings, transport=self.telemetry_transport
        )

        def override_get_db():
            try:
                yield self.db
            finally:
                pass

        app.dependency_overrides[get_db] = override_get_db
        app.dependency_overrides[get_api_key_repository] = lambda: self.api_keys_repo
        app.dependency_overrides[get_telemetry_repository] = lambda: self.telemetry_repo

        self.org_id = str(uuid.uuid4())
        self.raw_key, self.key_prefix, self.key_hash = generate_api_key("live")
        self.key_row = self.api_keys_transport.seed_row({
            "user_id": "cognito_owner_sub",
            "organization_id": self.org_id,
            "name": "Telemetry Integration Key",
            "key_prefix": self.key_prefix,
            "secret_hash": self.key_hash,
            "status": "active",
        })

    def tearDown(self) -> None:
        self.db.query(InferenceRequestRecord).delete()
        self.db.commit()
        self.db.close()
        app.dependency_overrides.clear()

    def test_run_inference_route_is_synchronous_def_handler(self) -> None:
        self.assertFalse(inspect.iscoroutinefunction(run_inference_route))

    def test_successful_inference_writes_supabase_telemetry_ignores_spoofing_and_avoids_local_db(self) -> None:
        prompt_secret = "CONFIDENTIAL_CUSTOMER_PROMPT_TEXT_DO_NOT_LOG"
        response_secret = "GENERATED_MODEL_SECRET_OUTPUT"
        mock_result = {
            "provider": "nvidia",
            "model": "nvidia/nemotron-3.5-bolt-e4b",
            "content": response_secret,
            "finish_reason": "stop",
            "usage": {"prompt_tokens": 17, "completion_tokens": 43, "total_tokens": 60},
        }

        with patch.object(inference_service.provider, "generate", return_value=mock_result):
            resp = self.client.post(
                "/api/v1/inference",
                json={
                    "prompt": prompt_secret,
                    "max_tokens": 200,
                    "temperature": 0.2,
                    # Untrusted client spoofing attempts must be ignored
                    "user_id": "spoofed_attacker_sub",
                    "api_key_id": str(uuid.uuid4()),
                    "organization_id": str(uuid.uuid4()),
                    "cost": 999.99,
                },
                headers={"Authorization": f"Bearer {self.raw_key}"},
            )

        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body["usage"]["prompt_tokens"], 17)
        self.assertEqual(body["usage"]["completion_tokens"], 43)
        self.assertEqual(body["usage"]["total_tokens"], 60)

        # Zero rows written to local PostgreSQL/SQLite `inference_requests`
        self.assertEqual(self.db.query(InferenceRequestRecord).all(), [])

        # Exact 1 row persisted in Supabase `inference_requests` with authenticated ownership
        self.assertEqual(len(self.telemetry_transport.rows), 1)
        stored = next(iter(self.telemetry_transport.rows.values()))
        self.assertEqual(stored["user_id"], "cognito_owner_sub")
        self.assertEqual(stored["api_key_id"], self.key_row["id"])
        self.assertEqual(stored["organization_id"], self.org_id)
        self.assertEqual(stored["provider_name"], "nvidia")
        self.assertEqual(stored["model_name"], "nvidia/nemotron-3.5-bolt-e4b")
        self.assertEqual(stored["input_tokens"], 17)
        self.assertEqual(stored["output_tokens"], 43)
        self.assertEqual(stored["status"], "success")
        self.assertEqual(stored["cost"], 0.0)
        self.assertIsNone(stored["error_message"])
        self.assertIsInstance(stored["latency_ms"], int)
        self.assertGreaterEqual(stored["latency_ms"], 0)

        # Prompt text, response text, and credentials never persisted in Supabase telemetry
        telemetry_json = json.dumps(stored)
        self.assertNotIn(prompt_secret, telemetry_json)
        self.assertNotIn(response_secret, telemetry_json)
        self.assertNotIn(self.raw_key, telemetry_json)
        self.assertNotIn(self.settings.service_role_key, telemetry_json)

    def test_provider_failure_and_timeout_record_sanitized_supabase_telemetry(self) -> None:
        fake_nvidia_key = "nvapi-secret-upstream-token-123"
        mock_http_req = MagicMock()
        mock_http_resp = MagicMock(status_code=429, headers={})

        cases = [
            (
                RateLimitError(
                    f"Rate limited calling https://integrate.api.nvidia.com with {fake_nvidia_key}",
                    response=mock_http_resp,
                    body=None,
                ),
                429,
                "failed",
                "Upstream rate limit exceeded.",
            ),
            (
                APITimeoutError(request=mock_http_req),
                504,
                "timeout",
                "Upstream request timed out.",
            ),
            (
                AuthenticationError(
                    f"Invalid {fake_nvidia_key}",
                    response=MagicMock(status_code=401, headers={}),
                    body=None,
                ),
                502,
                "failed",
                "Upstream provider authentication failed.",
            ),
            (
                APIConnectionError(
                    message=f"Connection error Bearer {fake_nvidia_key}",
                    request=mock_http_req,
                ),
                502,
                "failed",
                "Upstream provider connection error.",
            ),
            (
                RuntimeError(f"Unexpected crash exposing {fake_nvidia_key}"),
                500,
                "failed",
                "Internal inference execution failure.",
            ),
        ]

        with self.assertLogs("inferxe.service", level=logging.WARNING) as log_cm:
            for exc, expected_http_status, expected_db_status, expected_err_msg in cases:
                self.telemetry_transport.rows.clear()
                with patch.object(inference_service.provider, "generate", side_effect=exc):
                    resp = self.client.post(
                        "/api/v1/inference",
                        json={"prompt": "DO_NOT_LOG_THIS_PROMPT"},
                        headers={"Authorization": f"Bearer {self.raw_key}"},
                    )
                self.assertEqual(resp.status_code, expected_http_status)
                self.assertEqual(self.db.query(InferenceRequestRecord).all(), [])
                self.assertEqual(len(self.telemetry_transport.rows), 1)
                stored = next(iter(self.telemetry_transport.rows.values()))
                self.assertEqual(stored["status"], expected_db_status)
                self.assertEqual(stored["error_message"], expected_err_msg)
                self.assertEqual(stored["input_tokens"], 0)
                self.assertEqual(stored["output_tokens"], 0)
                self.assertEqual(stored["user_id"], "cognito_owner_sub")
                self.assertEqual(stored["api_key_id"], self.key_row["id"])
                self.assertNotIn(fake_nvidia_key, json.dumps(stored))

        joined_logs = "\n".join(log_cm.output)
        self.assertNotIn(fake_nvidia_key, joined_logs)
        self.assertNotIn("DO_NOT_LOG_THIS_PROMPT", joined_logs)
        self.assertNotIn(self.raw_key, joined_logs)

    def test_telemetry_failure_does_not_fail_inference_or_mask_provider_errors(self) -> None:
        mock_result = {
            "provider": "nvidia",
            "model": "nvidia/nemotron-3.5-bolt-e4b",
            "content": "Response still succeeds!",
            "finish_reason": "stop",
            "usage": {"prompt_tokens": 9, "completion_tokens": 11, "total_tokens": 20},
        }

        with self.assertLogs("inferxe.service", level=logging.ERROR) as log_cm:
            for telemetry_failure in (
                TimeoutError("Supabase telemetry timed out"),
                urllib.error.URLError(f"Cannot reach {self.settings.url}"),
            ):
                self.telemetry_transport.next_error = telemetry_failure
                with patch.object(inference_service.provider, "generate", return_value=mock_result):
                    resp = self.client.post(
                        "/api/v1/inference",
                        json={"prompt": "Keep inference resilient"},
                        headers={"Authorization": f"Bearer {self.raw_key}"},
                    )
                self.assertEqual(resp.status_code, 200)
                self.assertEqual(resp.json()["response"], "Response still succeeds!")
                self.assertEqual(resp.json()["usage"]["total_tokens"], 20)

            # Even if Supabase returns 503 or FK violation during an upstream 429,
            # the client still receives HTTP 429 cleanly.
            self.telemetry_transport.next_response = (
                503,
                {"content-type": "application/json"},
                json.dumps({"message": f"Supabase unavailable referencing {self.settings.service_role_key}"}).encode(),
            )
            rate_err = RateLimitError(
                "Rate limited",
                response=MagicMock(status_code=429, headers={}),
                body=None,
            )
            with patch.object(inference_service.provider, "generate", side_effect=rate_err):
                resp_429 = self.client.post(
                    "/api/v1/inference",
                    json={"prompt": "Upstream 429 test"},
                    headers={"Authorization": f"Bearer {self.raw_key}"},
                )
            self.assertEqual(resp_429.status_code, 429)

        joined_logs = "\n".join(log_cm.output)
        self.assertNotIn(self.settings.service_role_key, joined_logs)
        self.assertNotIn(self.settings.url, joined_logs)
        self.assertNotIn(self.raw_key, joined_logs)

    def test_concurrent_inference_requests_isolated_telemetry_and_unique_ids(self) -> None:
        users: List[Tuple[str, Dict[str, Any]]] = []
        for idx in range(5):
            raw_k, prefix_k, hash_k = generate_api_key("live")
            seeded_k = self.api_keys_transport.seed_row({
                "user_id": f"concurrent_user_{idx}",
                "organization_id": str(uuid.uuid4()),
                "name": f"Concurrent Key {idx}",
                "key_prefix": prefix_k,
                "secret_hash": hash_k,
                "status": "active",
            })
            users.append((raw_k, seeded_k))

        fake_provider = MagicMock()
        fake_provider.generate.return_value = {
            "provider": "nvidia",
            "model": "nvidia/nemotron-3.5-bolt-e4b",
            "content": "Concurrent OK",
            "finish_reason": "stop",
            "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
        }
        service = InferenceService(provider=fake_provider, telemetry_repo=self.telemetry_repo)

        barrier = threading.Barrier(len(users))
        errors: List[Exception] = []
        results: List[str] = []
        lock = threading.Lock()

        def worker(key_row: Dict[str, Any], index: int) -> None:
            try:
                api_record = SupabaseAPIKeyRecord.from_row(key_row)
                req = InferenceRequest(prompt=f"Concurrent prompt {index}")
                barrier.wait(timeout=3.0)
                resp = service.execute_inference(request=req, api_key=api_record)
                with lock:
                    results.append(resp.response)
            except Exception as exc:  # pragma: no cover
                with lock:
                    errors.append(exc)

        threads = [
            threading.Thread(target=worker, args=(key_row, idx))
            for idx, (_raw_k, key_row) in enumerate(users)
        ]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=5.0)

        self.assertEqual(errors, [])
        self.assertEqual(len(results), len(users))
        self.assertEqual(len(self.telemetry_transport.rows), len(users))

        recorded_by_user = {r["user_id"]: r for r in self.telemetry_transport.rows.values()}
        self.assertEqual(set(recorded_by_user.keys()), {f"concurrent_user_{idx}" for idx in range(len(users))})
        for idx, (_raw_k, seeded_k) in enumerate(users):
            row = recorded_by_user[f"concurrent_user_{idx}"]
            self.assertEqual(row["api_key_id"], seeded_k["id"])
            self.assertEqual(row["organization_id"], seeded_k["organization_id"])
            self.assertEqual(row["input_tokens"], 10)
            self.assertEqual(row["output_tokens"], 5)

    def test_malformed_non_dict_provider_response_records_failure_telemetry(self) -> None:
        malformed_payloads = [None, "plain string output", ["unexpected", "list"], 42, True]
        with self.assertLogs("inferxe.service", level=logging.ERROR):
            for bad_result in malformed_payloads:
                self.telemetry_transport.rows.clear()
                with patch.object(inference_service.provider, "generate", return_value=bad_result):
                    resp = self.client.post(
                        "/api/v1/inference",
                        json={"prompt": "SECRET_PROMPT_MUST_NOT_LEAK"},
                        headers={"Authorization": f"Bearer {self.raw_key}"},
                    )
                self.assertEqual(resp.status_code, 502)
                self.assertEqual(
                    resp.json()["detail"],
                    "Upstream inference provider returned a malformed response.",
                )
                self.assertEqual(self.db.query(InferenceRequestRecord).all(), [])
                self.assertEqual(len(self.telemetry_transport.rows), 1)
                stored = next(iter(self.telemetry_transport.rows.values()))
                self.assertEqual(stored["status"], "failed")
                self.assertEqual(stored["input_tokens"], 0)
                self.assertEqual(stored["output_tokens"], 0)
                self.assertEqual(stored["error_message"], "Upstream provider returned a malformed response.")
                self.assertEqual(stored["user_id"], "cognito_owner_sub")
                self.assertEqual(stored["api_key_id"], self.key_row["id"])
                self.assertEqual(stored["model_name"], "nvidia/nemotron-3.5-bolt-e4b")
                self.assertNotIn("SECRET_PROMPT_MUST_NOT_LEAK", json.dumps(stored))

    def test_malformed_non_dict_usage_or_invalid_payload_records_failure_telemetry(self) -> None:
        bad_payloads = [
            {"provider": "nvidia", "model": "nvidia/nemotron-3.5-bolt-e4b", "content": "ok", "usage": "invalid"},
            {"provider": "nvidia", "model": "nvidia/nemotron-3.5-bolt-e4b", "content": "ok", "usage": ["10", "20"]},
            {"provider": "nvidia", "model": "nvidia/nemotron-3.5-bolt-e4b", "content": "ok", "usage": None},
            {"provider": "nvidia", "model": "nvidia/nemotron-3.5-bolt-e4b", "content": "ok"},
            {"provider": "nvidia", "model": "nvidia/nemotron-3.5-bolt-e4b", "content": 12345, "usage": {"prompt_tokens": 5, "completion_tokens": 5}},
        ]
        with self.assertLogs("inferxe.service", level=logging.ERROR):
            for bad_result in bad_payloads:
                self.telemetry_transport.rows.clear()
                with patch.object(inference_service.provider, "generate", return_value=bad_result):
                    resp = self.client.post(
                        "/api/v1/inference",
                        json={"prompt": "Malformed usage test"},
                        headers={"Authorization": f"Bearer {self.raw_key}"},
                    )
                self.assertEqual(resp.status_code, 502)
                self.assertEqual(len(self.telemetry_transport.rows), 1)
                stored = next(iter(self.telemetry_transport.rows.values()))
                self.assertEqual(stored["status"], "failed")
                self.assertEqual(stored["input_tokens"], 0)
                self.assertEqual(stored["output_tokens"], 0)

    def test_non_numeric_and_invalid_token_values_rejected_and_recorded_as_failed(self) -> None:
        invalid_usages = [
            {"prompt_tokens": "abc", "completion_tokens": 5},
            {"prompt_tokens": 5, "completion_tokens": "NaN"},
            {"prompt_tokens": ["10"], "completion_tokens": 5},
            {"prompt_tokens": {"val": 5}, "completion_tokens": 5},
            {"prompt_tokens": None, "completion_tokens": 5},
            {"prompt_tokens": 5},  # missing completion_tokens
            {"prompt_tokens": -1, "completion_tokens": 5},
            {"prompt_tokens": 12.5, "completion_tokens": 5},
            {"prompt_tokens": 5, "completion_tokens": 5, "total_tokens": "not-an-int"},
            {"prompt_tokens": 5, "completion_tokens": 5, "total_tokens": -2},
        ]
        with self.assertLogs("inferxe.service", level=logging.ERROR):
            for bad_usage in invalid_usages:
                self.telemetry_transport.rows.clear()
                bad_result = {
                    "provider": "nvidia",
                    "model": "nvidia/nemotron-3.5-bolt-e4b",
                    "content": "Should be rejected",
                    "usage": bad_usage,
                }
                with patch.object(inference_service.provider, "generate", return_value=bad_result):
                    resp = self.client.post(
                        "/api/v1/inference",
                        json={"prompt": "Non-numeric token test"},
                        headers={"Authorization": f"Bearer {self.raw_key}"},
                    )
                self.assertEqual(resp.status_code, 502)
                self.assertEqual(len(self.telemetry_transport.rows), 1)
                stored = next(iter(self.telemetry_transport.rows.values()))
                self.assertEqual(stored["status"], "failed")
                self.assertEqual(stored["input_tokens"], 0)
                self.assertEqual(stored["output_tokens"], 0)

    def test_boolean_token_values_rejected_not_coerced_to_ints(self) -> None:
        boolean_usages = [
            {"prompt_tokens": True, "completion_tokens": 5},
            {"prompt_tokens": 5, "completion_tokens": False},
            {"prompt_tokens": True, "completion_tokens": False},
            {"prompt_tokens": 5, "completion_tokens": 5, "total_tokens": True},
        ]
        with self.assertLogs("inferxe.service", level=logging.ERROR):
            for bool_usage in boolean_usages:
                self.telemetry_transport.rows.clear()
                bad_result = {
                    "provider": "nvidia",
                    "model": "nvidia/nemotron-3.5-bolt-e4b",
                    "content": "Boolean usage must fail",
                    "usage": bool_usage,
                }
                with patch.object(inference_service.provider, "generate", return_value=bad_result):
                    resp = self.client.post(
                        "/api/v1/inference",
                        json={"prompt": "Boolean token test"},
                        headers={"Authorization": f"Bearer {self.raw_key}"},
                    )
                self.assertEqual(resp.status_code, 502)
                self.assertEqual(len(self.telemetry_transport.rows), 1)
                stored = next(iter(self.telemetry_transport.rows.values()))
                self.assertEqual(stored["status"], "failed")
                self.assertEqual(stored["input_tokens"], 0)
                self.assertEqual(stored["output_tokens"], 0)

    def test_valid_provider_response_records_exact_zero_and_numeric_tokens(self) -> None:
        valid_cases = [
            ({"prompt_tokens": 17, "completion_tokens": 43, "total_tokens": 60}, 17, 43, 60),
            ({"prompt_tokens": 14, "completion_tokens": 9}, 14, 9, 23),
            ({"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}, 0, 0, 0),
            ({"prompt_tokens": "12", "completion_tokens": "8"}, 12, 8, 20),
        ]
        for usage_payload, expected_in, expected_out, expected_total in valid_cases:
            self.telemetry_transport.rows.clear()
            mock_result = {
                "provider": "nvidia",
                "model": "nvidia/nemotron-3.5-bolt-e4b",
                "content": "Valid response",
                "usage": usage_payload,
            }
            with patch.object(inference_service.provider, "generate", return_value=mock_result):
                resp = self.client.post(
                    "/api/v1/inference",
                    json={"prompt": "Valid token count test"},
                    headers={"Authorization": f"Bearer {self.raw_key}"},
                )
            self.assertEqual(resp.status_code, 200)
            body = resp.json()
            self.assertEqual(body["usage"]["prompt_tokens"], expected_in)
            self.assertEqual(body["usage"]["completion_tokens"], expected_out)
            self.assertEqual(body["usage"]["total_tokens"], expected_total)
            self.assertEqual(len(self.telemetry_transport.rows), 1)
            stored = next(iter(self.telemetry_transport.rows.values()))
            self.assertEqual(stored["status"], "success")
            self.assertEqual(stored["input_tokens"], expected_in)
            self.assertEqual(stored["output_tokens"], expected_out)

    def test_error_telemetry_prefers_actual_provider_model_over_request_model(self) -> None:
        api_record = SupabaseAPIKeyRecord.from_row(self.key_row)
        actual_provider_model = "meta/llama-3.1-70b-instruct"

        provider_exc_cases = [
            RateLimitError(
                "rate limit",
                response=MagicMock(status_code=429, headers={}),
                body=None,
            ),
            APITimeoutError(request=MagicMock()),
            APIConnectionError(message="conn failed", request=MagicMock()),
            ValueError("Upstream provider rejected model option"),
            RuntimeError("unexpected crash"),
        ]
        for exc in provider_exc_cases:
            self.telemetry_transport.rows.clear()
            fake_provider = SimpleNamespace(
                model=actual_provider_model,
                generate=MagicMock(side_effect=exc),
            )
            service = InferenceService(provider=fake_provider, telemetry_repo=self.telemetry_repo)
            req = InferenceRequest(prompt="Model attribution check", model="custom/requested-model")
            with self.assertRaises(HTTPException):
                service.execute_inference(request=req, api_key=api_record)
            self.assertEqual(len(self.telemetry_transport.rows), 1)
            stored = next(iter(self.telemetry_transport.rows.values()))
            self.assertEqual(stored["model_name"], actual_provider_model)

        # Malformed provider response error telemetry also uses actual provider model
        self.telemetry_transport.rows.clear()
        fake_provider_bad = SimpleNamespace(
            model=actual_provider_model,
            generate=MagicMock(return_value="not-a-dict"),
        )
        service_bad = InferenceService(provider=fake_provider_bad, telemetry_repo=self.telemetry_repo)
        with self.assertRaises(HTTPException) as ctx:
            service_bad.execute_inference(
                request=InferenceRequest(prompt="Model check on malformed payload", model="other/model"),
                api_key=api_record,
            )
        self.assertEqual(ctx.exception.status_code, 502)
        stored_bad = next(iter(self.telemetry_transport.rows.values()))
        self.assertEqual(stored_bad["model_name"], actual_provider_model)

    def test_error_telemetry_falls_back_to_request_model_then_default(self) -> None:
        api_record = SupabaseAPIKeyRecord.from_row(self.key_row)

        providers_without_model = [
            SimpleNamespace(generate=MagicMock(side_effect=APITimeoutError(request=MagicMock()))),
            SimpleNamespace(model=None, generate=MagicMock(side_effect=RuntimeError("boom"))),
            SimpleNamespace(model="   ", generate=MagicMock(return_value=["malformed"])),
            MagicMock(**{"generate.side_effect": ValueError("provider error")}),
        ]
        for prov in providers_without_model:
            self.telemetry_transport.rows.clear()
            service = InferenceService(provider=prov, telemetry_repo=self.telemetry_repo)
            with self.assertRaises(HTTPException):
                service.execute_inference(
                    request=InferenceRequest(prompt="Fallback request model test", model="nvidia/llama-3.3-70b-instruct"),
                    api_key=api_record,
                )
            self.assertEqual(len(self.telemetry_transport.rows), 1)
            stored = next(iter(self.telemetry_transport.rows.values()))
            self.assertEqual(stored["model_name"], "nvidia/llama-3.3-70b-instruct")

        # When both provider.model and request.model are unavailable, falls back to default model
        self.telemetry_transport.rows.clear()
        prov_no_model = SimpleNamespace(model=None, generate=MagicMock(side_effect=RuntimeError("boom")))
        service_default = InferenceService(provider=prov_no_model, telemetry_repo=self.telemetry_repo)
        with self.assertRaises(HTTPException):
            service_default.execute_inference(
                request=InferenceRequest(prompt="Fallback default model test", model=None),
                api_key=api_record,
            )
        stored_default = next(iter(self.telemetry_transport.rows.values()))
        self.assertEqual(stored_default["model_name"], "nvidia/nemotron-3.5-bolt-e4b")

    def test_provider_value_error_after_attempt_records_telemetry_and_returns_422(self) -> None:
        secret_msg = "Invalid parameter near https://upstream.nvidia.internal/v1 with nvapi-secret-leak-999"
        with patch.object(inference_service.provider, "generate", side_effect=ValueError(secret_msg)) as mock_gen:
            with self.assertLogs("inferxe.service", level=logging.WARNING) as log_cm:
                resp = self.client.post(
                    "/api/v1/inference",
                    json={"prompt": "SECRET_PROMPT_VALUE_ERROR", "model": "nvidia/nemotron-3.5-bolt-e4b"},
                    headers={"Authorization": f"Bearer {self.raw_key}"},
                )

        mock_gen.assert_called_once()
        self.assertEqual(resp.status_code, 422)
        self.assertNotIn("nvapi-secret-leak-999", resp.text)
        self.assertNotIn("https://upstream.nvidia.internal", resp.text)

        self.assertEqual(len(self.telemetry_transport.rows), 1)
        stored = next(iter(self.telemetry_transport.rows.values()))
        self.assertEqual(stored["status"], "failed")
        self.assertEqual(stored["model_name"], "nvidia/nemotron-3.5-bolt-e4b")
        self.assertEqual(stored["input_tokens"], 0)
        self.assertEqual(stored["output_tokens"], 0)
        self.assertEqual(stored["error_message"], "Upstream provider rejected the inference request.")
        self.assertEqual(stored["user_id"], "cognito_owner_sub")
        self.assertEqual(stored["api_key_id"], self.key_row["id"])
        self.assertNotIn("SECRET_PROMPT_VALUE_ERROR", json.dumps(stored))

        joined_logs = "\n".join(log_cm.output)
        self.assertNotIn("nvapi-secret-leak-999", joined_logs)
        self.assertNotIn("SECRET_PROMPT_VALUE_ERROR", joined_logs)

    def test_pre_inference_validation_errors_create_no_telemetry(self) -> None:
        # 1. HTTP-level FastAPI/Pydantic 422 rejections never attempt inference or record telemetry
        invalid_http_payloads = [
            {"prompt": ""},
            {"prompt": "   \n\t "},
            {"prompt": "Valid", "max_tokens": 0},
            {"prompt": "Valid", "max_tokens": 5000},
            {"prompt": "Valid", "temperature": -0.1},
            {"prompt": "Valid", "temperature": 3.0},
        ]
        with patch.object(inference_service.provider, "generate") as mock_gen:
            for payload in invalid_http_payloads:
                resp = self.client.post(
                    "/api/v1/inference",
                    json=payload,
                    headers={"Authorization": f"Bearer {self.raw_key}"},
                )
                self.assertEqual(resp.status_code, 422)
            mock_gen.assert_not_called()
            self.assertEqual(len(self.telemetry_transport.rows), 0)

        # 2. Direct service calls bypassing Pydantic validation (model_construct) also reject pre-inference with 0 telemetry
        api_record = SupabaseAPIKeyRecord.from_row(self.key_row)
        fake_provider = SimpleNamespace(model="nvidia/nemotron-3.5-bolt-e4b", generate=MagicMock())
        service = InferenceService(provider=fake_provider, telemetry_repo=self.telemetry_repo)

        invalid_direct_requests = [
            None,
            InferenceRequest.model_construct(prompt="", max_tokens=100, temperature=0.2),
            InferenceRequest.model_construct(prompt="   \t\n ", max_tokens=100, temperature=0.2),
            InferenceRequest.model_construct(prompt=None, max_tokens=100, temperature=0.2),
            InferenceRequest.model_construct(prompt="Valid", max_tokens=0, temperature=0.2),
            InferenceRequest.model_construct(prompt="Valid", max_tokens=5000, temperature=0.2),
            InferenceRequest.model_construct(prompt="Valid", max_tokens=True, temperature=0.2),
            InferenceRequest.model_construct(prompt="Valid", max_tokens=100, temperature=-0.1),
            InferenceRequest.model_construct(prompt="Valid", max_tokens=100, temperature=2.5),
            InferenceRequest.model_construct(prompt="Valid", max_tokens=100, temperature=float("nan")),
            InferenceRequest.model_construct(prompt="Valid", max_tokens=100, temperature=True),
            InferenceRequest.model_construct(prompt="Valid", model=123, max_tokens=100, temperature=0.2),
        ]
        for bad_req in invalid_direct_requests:
            with self.assertRaises(HTTPException) as ctx:
                service.execute_inference(request=bad_req, api_key=api_record)
            self.assertEqual(ctx.exception.status_code, 422)

        fake_provider.generate.assert_not_called()
        self.assertEqual(len(self.telemetry_transport.rows), 0)

        # 3. Pre-attempt provider initialization failure (e.g. missing NVIDIA_API_KEY) records 0 telemetry
        uninit_service = InferenceService(telemetry_repo=self.telemetry_repo)
        with patch(
            "inference.service.NVIDIAProvider",
            side_effect=ValueError("NVIDIA_API_KEY is missing from backend/.env"),
        ):
            with self.assertRaises(HTTPException) as ctx_cfg:
                uninit_service.execute_inference(
                    request=InferenceRequest(prompt="Should fail before provider attempt"),
                    api_key=api_record,
                )
            self.assertEqual(ctx_cfg.exception.status_code, 422)
        self.assertEqual(len(self.telemetry_transport.rows), 0)

    def test_telemetry_failure_behavior_unchanged_for_malformed_and_value_errors(self) -> None:
        with self.assertLogs("inferxe.service", level=logging.ERROR) as log_cm:
            # Malformed provider response still returns HTTP 502 even when telemetry write raises TimeoutError
            self.telemetry_transport.next_error = TimeoutError("Supabase timed out")
            with patch.object(inference_service.provider, "generate", return_value={"content": "hi", "usage": "bad"}):
                resp_bad = self.client.post(
                    "/api/v1/inference",
                    json={"prompt": "Malformed + telemetry failure"},
                    headers={"Authorization": f"Bearer {self.raw_key}"},
                )
            self.assertEqual(resp_bad.status_code, 502)

            # Attempted provider ValueError still returns HTTP 422 even when telemetry returns 503
            self.telemetry_transport.next_response = (
                503,
                {"content-type": "application/json"},
                json.dumps({"message": f"Service down {self.settings.service_role_key}"}).encode(),
            )
            with patch.object(inference_service.provider, "generate", side_effect=ValueError("Invalid upstream option")):
                resp_val = self.client.post(
                    "/api/v1/inference",
                    json={"prompt": "ValueError + telemetry failure"},
                    headers={"Authorization": f"Bearer {self.raw_key}"},
                )
            self.assertEqual(resp_val.status_code, 422)

        joined_logs = "\n".join(log_cm.output)
        self.assertNotIn(self.settings.service_role_key, joined_logs)
        self.assertNotIn(self.settings.url, joined_logs)
        self.assertNotIn(self.raw_key, joined_logs)


if __name__ == "__main__":
    unittest.main()
