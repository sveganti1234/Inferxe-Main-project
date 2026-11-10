"""
supabase_telemetry.py
=====================
Supabase REST API (PostgREST) repository for inference request usage and telemetry
(`inference_requests`) in Inferxe.

Security & architectural guarantees:
- Reads `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` exclusively from `backend/.env`
  via `inference.supabase_config`.
- Because `SUPABASE_SERVICE_ROLE_KEY` bypasses Supabase Row Level Security (RLS),
  every record stores verified tenant attribution (`user_id`, `organization_id`,
  `api_key_id`) derived strictly from the authenticated API key context, never
  from untrusted request payloads, and queries filter explicitly by `user_id`.
- Maps local Inferxe telemetry attributes onto the live Supabase `inference_requests`
  schema (`id`, `user_id`, `organization_id`, `api_key_id`, `deployment_id`,
  `model_name`, `provider_name`, `input_tokens`, `output_tokens`, `latency_ms`,
  `status`, `error_message`, `cost`, `created_at`):
    * `provider`          -> `provider_name`
    * `model`             -> `model_name`
    * `prompt_tokens`     -> `input_tokens`
    * `completion_tokens` -> `output_tokens`
    * `total_tokens`      -> derived (`input_tokens + output_tokens`), not stored in DB
- Never logs or persists raw API keys, Supabase credentials, JWTs, URLs,
  customer prompts, or generated model responses.
"""

import http.client
import json
import logging
import math
import re
import socket
import urllib.error
import urllib.parse
import urllib.request
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any, Callable, Dict, List, Optional, Tuple, Union

from inference.supabase_config import (
    SupabaseConfigurationError,
    SupabaseSettings,
    get_supabase_settings,
)

logger = logging.getLogger("inferxe.supabase_telemetry")

# Exact columns verified against the live Supabase `inference_requests` PostgREST schema.
INFERENCE_REQUEST_COLUMNS = (
    "id,user_id,organization_id,api_key_id,deployment_id,"
    "model_name,provider_name,input_tokens,output_tokens,"
    "latency_ms,status,error_message,cost,created_at"
)

VALID_TELEMETRY_STATUSES = frozenset({"pending", "success", "failed", "timeout"})
INT32_MAX = 2_147_483_647

TRUSTED_HTTP_METHODS = frozenset({"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"})
TRUSTED_TELEMETRY_RESOURCES = frozenset({"inference_requests"})
_SAFE_ERROR_CODE_RE = re.compile(r"^[A-Za-z0-9_]{1,32}$")
_HEX_TOKEN_RE = re.compile(r"^[0-9a-fA-F]{32,}$")

_SENSITIVE_ERROR_PATTERNS = (
    re.compile(r"(?:https?|postgres(?:ql)?)://[^\s\"'<>]+", re.IGNORECASE),
    re.compile(r"\b(?:sb_secret|sbp|sb_publishable)_[A-Za-z0-9._-]+\b"),
    re.compile(r"\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9._-]+\.[A-Za-z0-9._-]+\b"),
    re.compile(r"\binf_(?:live|test)_[A-Za-z0-9_-]+\b"),
    re.compile(r"\bnvapi-[A-Za-z0-9._-]+\b"),
    re.compile(r"\b(?:Bearer|Basic)\s+[A-Za-z0-9+/=._-]+\b", re.IGNORECASE),
    re.compile(r"\b(?:apikey|api[-_]?key|secret[-_]?key|service[-_]?role[-_]?key|password|passwd|pwd)\s*[:=]\s*[^\s,;\"'<>]+", re.IGNORECASE),
    re.compile(r"\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b"),
)

TransportCallable = Callable[
    [str, str, Dict[str, str], Optional[bytes], float],
    Tuple[int, Dict[str, str], bytes],
]


class SupabaseTelemetryError(RuntimeError):
    """Base error raised for sanitized Supabase telemetry repository failures."""


class SupabaseTelemetryServiceUnavailableError(SupabaseTelemetryError):
    """Raised when Supabase is unreachable, misconfigured, timed out, or returns 5xx."""


class SupabaseTelemetryValidationError(SupabaseTelemetryError):
    """Raised for invalid telemetry inputs or foreign-key precondition violations."""


class SupabaseTelemetryConflictError(SupabaseTelemetryValidationError):
    """Raised when inserting a duplicate inference telemetry request ID."""


def sanitize_diagnostic_text(text: Any, max_len: int = 240) -> str:
    """Scrub URLs, credentials, control characters, and cap length safely."""
    cleaned = re.sub(r"[\r\n\t]+", " ", str(text or "")).strip()
    for pattern in _SENSITIVE_ERROR_PATTERNS:
        cleaned = pattern.sub("[REDACTED]", cleaned)
    return cleaned[:max_len]


def normalize_telemetry_status(raw_status: Any) -> str:
    """Normalize a telemetry status string safely using strip and lowercase."""
    if not isinstance(raw_status, str):
        return "failed"
    normalized = raw_status.strip().lower()
    return normalized or "failed"


def parse_supabase_timestamp(value: Any) -> Optional[datetime]:
    """Parse an ISO-8601 timestamp returned by PostgREST into a timezone-aware UTC datetime."""
    if value is None:
        return None
    if isinstance(value, bool) or isinstance(value, (int, float, list, dict)):
        raise ValueError("Unsupported timestamp type returned from Supabase.")
    if isinstance(value, datetime):
        return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)
    if not isinstance(value, str):
        raise ValueError("Unsupported timestamp value returned from Supabase.")
    text = value.strip()
    if not text:
        return None
    if text.endswith("Z") or text.endswith("z"):
        text = text[:-1] + "+00:00"
    parsed = datetime.fromisoformat(text)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def _parse_optional_uuid(value: Any) -> Optional[uuid.UUID]:
    if value is None or value == "":
        return None
    if isinstance(value, uuid.UUID):
        return value
    if not isinstance(value, str):
        raise ValueError("Malformed UUID value.")
    return uuid.UUID(value.strip())


def _coerce_non_negative_int(
    value: Any,
    *,
    field_name: str,
    allow_none: bool = False,
    max_value: Optional[int] = None,
) -> Optional[int]:
    if value is None:
        if allow_none:
            return None
        return 0
    if isinstance(value, bool) or not isinstance(value, int):
        raise SupabaseTelemetryValidationError(f"{field_name} must be a non-negative integer.")
    if value < 0:
        raise SupabaseTelemetryValidationError(f"{field_name} cannot be negative.")
    if max_value is not None and value > max_value:
        return max_value
    return value


def _coerce_non_negative_cost(value: Any) -> float:
    if value is None:
        return 0.0
    if isinstance(value, bool) or not isinstance(value, (int, float, Decimal, str)):
        raise SupabaseTelemetryValidationError("cost must be a non-negative finite number.")
    if isinstance(value, str) and not value.strip():
        return 0.0
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        raise SupabaseTelemetryValidationError("cost must be a finite number.")
    try:
        dec = Decimal(str(value).strip()) if isinstance(value, str) else Decimal(str(value))
    except (InvalidOperation, ValueError) as dec_err:
        raise SupabaseTelemetryValidationError("cost must be a valid numeric value.") from dec_err
    if not dec.is_finite() or dec < Decimal("0"):
        raise SupabaseTelemetryValidationError("cost cannot be negative or non-finite.")
    rounded = dec.quantize(Decimal("0.00000001"), rounding=ROUND_HALF_UP)
    return float(rounded)


def calculate_inference_cost(
    *,
    model_name: Optional[str],
    input_tokens: int,
    output_tokens: int,
    explicit_cost: Optional[Union[int, float, Decimal, str]] = None,
) -> float:
    """
    Compute non-negative numeric cost for an inference execution.

    Inferxe currently does not configure per-model retail token pricing in the
    inference service; unless `explicit_cost` is supplied by an upstream pricing
    source, telemetry stores `0.0` matching Supabase's `numeric NOT NULL DEFAULT 0`.
    """
    _coerce_non_negative_int(input_tokens, field_name="input_tokens")
    _coerce_non_negative_int(output_tokens, field_name="output_tokens")
    _ = model_name  # Reserved for future per-model pricing lookup
    if explicit_cost is None:
        return 0.0
    return _coerce_non_negative_cost(explicit_cost)


def _default_urllib_transport(
    method: str,
    url: str,
    headers: Dict[str, str],
    body: Optional[bytes],
    timeout: float,
) -> Tuple[int, Dict[str, str], bytes]:
    """Execute an HTTPS/HTTP request using stdlib `urllib.request` with explicit timeout."""
    req = urllib.request.Request(url=url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            resp_headers = {k.lower(): v for k, v in resp.headers.items()}
            return resp.status, resp_headers, resp.read()
    except urllib.error.HTTPError as http_err:
        err_headers = {k.lower(): v for k, v in http_err.headers.items()} if http_err.headers else {}
        try:
            err_body = http_err.read()
        finally:
            http_err.close()
        return http_err.code, err_headers, err_body


@dataclass
class SupabaseInferenceTelemetryRecord:
    """Normalized domain representation of a Supabase `inference_requests` row."""

    id: uuid.UUID
    user_id: str
    organization_id: Optional[uuid.UUID] = None
    api_key_id: Optional[uuid.UUID] = None
    deployment_id: Optional[uuid.UUID] = None
    model_name: Optional[str] = None
    provider_name: Optional[str] = None
    input_tokens: int = 0
    output_tokens: int = 0
    latency_ms: Optional[int] = None
    status: str = "pending"
    error_message: Optional[str] = None
    cost: float = 0.0
    created_at: Optional[datetime] = None

    def __post_init__(self) -> None:
        self.status = normalize_telemetry_status(self.status)

    @property
    def total_tokens(self) -> int:
        """Derived total tokens (`input_tokens + output_tokens`) for parity with local usage info."""
        return self.input_tokens + self.output_tokens

    @classmethod
    def from_row(cls, row: Dict[str, Any]) -> "SupabaseInferenceTelemetryRecord":
        if not isinstance(row, dict):
            raise SupabaseTelemetryServiceUnavailableError(
                "Received malformed inference telemetry record from Supabase."
            )

        raw_id = row.get("id")
        if not isinstance(raw_id, (str, uuid.UUID)) or not str(raw_id).strip():
            raise SupabaseTelemetryServiceUnavailableError(
                "Received malformed inference telemetry record from Supabase."
            )

        raw_user_id = row.get("user_id")
        if not isinstance(raw_user_id, str) or not raw_user_id.strip():
            raise SupabaseTelemetryServiceUnavailableError(
                "Received malformed inference telemetry record from Supabase."
            )

        for str_field in ("model_name", "provider_name", "error_message", "status"):
            val = row.get(str_field)
            if val is not None and not isinstance(val, str):
                raise SupabaseTelemetryServiceUnavailableError(
                    "Received malformed inference telemetry record from Supabase."
                )

        try:
            record_uuid = raw_id if isinstance(raw_id, uuid.UUID) else uuid.UUID(raw_id.strip())
            org_uuid = _parse_optional_uuid(row.get("organization_id"))
            key_uuid = _parse_optional_uuid(row.get("api_key_id"))
            deployment_uuid = _parse_optional_uuid(row.get("deployment_id"))
            created_at = parse_supabase_timestamp(row.get("created_at"))
            in_tokens = _coerce_non_negative_int(row.get("input_tokens", 0), field_name="input_tokens")
            out_tokens = _coerce_non_negative_int(row.get("output_tokens", 0), field_name="output_tokens")
            lat_ms = _coerce_non_negative_int(
                row.get("latency_ms"),
                field_name="latency_ms",
                allow_none=True,
                max_value=INT32_MAX,
            )
            parsed_cost = _coerce_non_negative_cost(row.get("cost", 0.0))
        except (ValueError, TypeError, SupabaseTelemetryValidationError) as parse_err:
            logger.warning(
                "Malformed inference telemetry record received from Supabase (%s).",
                type(parse_err).__name__,
            )
            raise SupabaseTelemetryServiceUnavailableError(
                "Received malformed inference telemetry record from Supabase."
            ) from parse_err

        raw_err = row.get("error_message")
        sanitized_err = sanitize_diagnostic_text(raw_err, max_len=500) or None if isinstance(raw_err, str) else None

        return cls(
            id=record_uuid,
            user_id=raw_user_id.strip(),
            organization_id=org_uuid,
            api_key_id=key_uuid,
            deployment_id=deployment_uuid,
            model_name=(row.get("model_name") or "").strip() or None,
            provider_name=(row.get("provider_name") or "").strip() or None,
            input_tokens=in_tokens if in_tokens is not None else 0,
            output_tokens=out_tokens if out_tokens is not None else 0,
            latency_ms=lat_ms,
            status=normalize_telemetry_status(row.get("status")),
            error_message=sanitized_err,
            cost=parsed_cost,
            created_at=created_at,
        )


def _trusted_log_method(method: Any) -> str:
    candidate = method.strip().upper() if isinstance(method, str) else ""
    return candidate if candidate in TRUSTED_HTTP_METHODS else "UNKNOWN"


def _trusted_log_resource(resource: Any) -> str:
    candidate = resource.strip() if isinstance(resource, str) else ""
    return candidate if candidate in TRUSTED_TELEMETRY_RESOURCES else "unknown_resource"


def _sanitize_error_code(raw_code: Any) -> Optional[str]:
    """Validate and return only safe PostgreSQL SQLSTATE or PostgREST error codes."""
    if not isinstance(raw_code, str):
        return None
    scrubbed = sanitize_diagnostic_text(raw_code, max_len=32).strip()
    if not scrubbed or _HEX_TOKEN_RE.fullmatch(scrubbed):
        return None
    if _SAFE_ERROR_CODE_RE.fullmatch(scrubbed):
        return scrubbed
    return None


def _safe_upstream_diagnostic_label(status_code: int, body: bytes) -> str:
    """Derive a fixed, non-content operational classification for 5xx upstream responses."""
    if status_code == 502:
        status_label = "bad_gateway"
    elif status_code == 503:
        status_label = "service_unavailable"
    elif status_code == 504:
        status_label = "gateway_timeout"
    elif status_code == 500:
        status_label = "internal_server_error"
    else:
        status_label = "upstream_server_error"

    if not body or not body.strip():
        return f"{status_label}_empty_body"
    try:
        payload = json.loads(body.decode("utf-8", errors="replace"))
        if isinstance(payload, dict):
            return f"{status_label}_json_error"
        return f"{status_label}_json_payload"
    except Exception:
        return f"{status_label}_non_json_error"


def _extract_sanitized_supabase_error(
    status_code: int, body: bytes
) -> Tuple[Optional[str], str, str]:
    """
    Parse PostgREST error payload safely into sanitized in-memory classification fields
    without extracting `hint` or exposing secret keys, URLs, or full SQL dumps.
    """
    _ = status_code
    code: Optional[str] = None
    message = ""
    details = ""
    if body:
        try:
            payload = json.loads(body.decode("utf-8", errors="replace"))
            if isinstance(payload, dict):
                code = _sanitize_error_code(payload.get("code"))
                if isinstance(payload.get("message"), str) and payload["message"].strip():
                    message = sanitize_diagnostic_text(payload["message"])
                if isinstance(payload.get("details"), str) and payload["details"].strip():
                    details = sanitize_diagnostic_text(payload["details"])
        except Exception:
            pass
    return code, message, details


class SupabaseTelemetryRepository:
    """
    Repository encapsulating PostgREST telemetry persistence and tenant-scoped queries
    against the Supabase `inference_requests` table.
    """

    def __init__(
        self,
        settings: Optional[SupabaseSettings] = None,
        timeout: float = 10.0,
        transport: Optional[TransportCallable] = None,
    ) -> None:
        self._settings = settings
        self.timeout = float(timeout)
        self._transport = transport or _default_urllib_transport

    def _get_settings(self) -> SupabaseSettings:
        if self._settings is not None:
            return self._settings
        try:
            return get_supabase_settings()
        except SupabaseConfigurationError as cfg_err:
            logger.error("Supabase telemetry repository configuration invalid: %s", type(cfg_err).__name__)
            raise SupabaseTelemetryServiceUnavailableError(
                "Telemetry database service is not configured."
            ) from cfg_err

    def _request_json(
        self,
        method: str,
        resource: str,
        query_params: Optional[Dict[str, str]] = None,
        payload: Optional[Dict[str, Any]] = None,
        prefer: Optional[str] = None,
    ) -> Any:
        safe_method = _trusted_log_method(method)
        safe_resource = _trusted_log_resource(resource)
        settings = self._get_settings()
        base_url = settings.rest_url(resource)
        if query_params:
            encoded_qs = urllib.parse.urlencode(query_params, safe=".,()")
            url = f"{base_url}?{encoded_qs}"
        else:
            url = base_url

        extra_headers: Dict[str, str] = {}
        if prefer:
            extra_headers["Prefer"] = prefer
        headers = settings.auth_headers(extra_headers=extra_headers)
        body_bytes = json.dumps(payload).encode("utf-8") if payload is not None else None

        try:
            status_code, _resp_headers, resp_body = self._transport(
                method, url, headers, body_bytes, self.timeout
            )
        except (TimeoutError, socket.timeout) as timeout_err:
            logger.error("Supabase REST %s %s timed out after %.1fs.", safe_method, safe_resource, self.timeout)
            raise SupabaseTelemetryServiceUnavailableError(
                "Telemetry database request timed out."
            ) from timeout_err
        except urllib.error.URLError as conn_err:
            logger.error(
                "Supabase REST %s %s connection error (%s).",
                safe_method,
                safe_resource,
                type(conn_err.reason).__name__ if getattr(conn_err, "reason", None) else type(conn_err).__name__,
            )
            raise SupabaseTelemetryServiceUnavailableError(
                "Telemetry database is temporarily unavailable."
            ) from conn_err
        except http.client.HTTPException as http_err:
            logger.error("Supabase REST %s %s protocol error (%s).", safe_method, safe_resource, type(http_err).__name__)
            raise SupabaseTelemetryServiceUnavailableError(
                "Telemetry database communication failed."
            ) from http_err
        except (OSError, ValueError) as net_err:
            logger.error("Supabase REST %s %s transport error (%s).", safe_method, safe_resource, type(net_err).__name__)
            raise SupabaseTelemetryServiceUnavailableError(
                "Telemetry database is temporarily unavailable."
            ) from net_err

        if status_code >= 500:
            pg_code, _safe_msg, _safe_details = _extract_sanitized_supabase_error(status_code, resp_body)
            diag_label = _safe_upstream_diagnostic_label(status_code, resp_body)
            logger.error(
                "Supabase REST %s %s failed (status=%s, code=%s, diag=%s).",
                safe_method,
                safe_resource,
                status_code,
                pg_code,
                diag_label,
            )
            raise SupabaseTelemetryServiceUnavailableError(
                "Telemetry database returned an upstream error."
            )

        if status_code >= 400:
            pg_code, safe_msg, safe_details = _extract_sanitized_supabase_error(status_code, resp_body)
            logger.warning(
                "Supabase REST %s %s rejected (status=%s, code=%s).",
                safe_method,
                safe_resource,
                status_code,
                pg_code,
            )
            if pg_code == "23503":
                fk_context = f"{safe_msg} {safe_details}".lower()
                if "inference_requests_user_id_fkey" in fk_context or (
                    "(user_id)" in fk_context and "profiles" in fk_context
                ):
                    raise SupabaseTelemetryValidationError(
                        "Customer profile must exist before recording inference telemetry."
                    )
                if "inference_requests_api_key_id_fkey" in fk_context or (
                    "(api_key_id)" in fk_context and "api_keys" in fk_context
                ):
                    raise SupabaseTelemetryValidationError(
                        "Referenced API key record does not exist in Supabase."
                    )
                if "inference_requests_organization_id_fkey" in fk_context or "organizations" in fk_context:
                    raise SupabaseTelemetryValidationError(
                        "Referenced organization record does not exist in Supabase."
                    )
                if "inference_requests_deployment_id_fkey" in fk_context or "deployments" in fk_context:
                    raise SupabaseTelemetryValidationError(
                        "Referenced deployment record does not exist in Supabase."
                    )
                raise SupabaseTelemetryValidationError(
                    "Telemetry record references a missing prerequisite record."
                )
            if pg_code == "23505" or status_code == 409:
                raise SupabaseTelemetryConflictError(
                    "Inference telemetry record already exists for this request ID."
                )
            if status_code in (401, 403):
                raise SupabaseTelemetryServiceUnavailableError(
                    "Telemetry database authentication failed."
                )
            if status_code == 400 or pg_code in ("22P02", "23502", "23514"):
                raise SupabaseTelemetryValidationError("Invalid inference telemetry payload parameters.")
            raise SupabaseTelemetryError("Telemetry database rejected the request.")

        if not resp_body:
            return None

        try:
            return json.loads(resp_body.decode("utf-8"))
        except Exception as json_err:
            logger.error(
                "Supabase REST %s %s returned invalid JSON (%s).",
                safe_method,
                safe_resource,
                type(json_err).__name__,
            )
            raise SupabaseTelemetryServiceUnavailableError(
                "Received invalid response from telemetry database."
            ) from json_err

    def record_inference_request(
        self,
        *,
        user_id: str,
        model_name: str,
        provider_name: str = "nvidia",
        input_tokens: int = 0,
        output_tokens: int = 0,
        latency_ms: Optional[int] = None,
        status: str = "success",
        error_message: Optional[str] = None,
        api_key_id: Optional[Union[str, uuid.UUID]] = None,
        organization_id: Optional[Union[str, uuid.UUID]] = None,
        deployment_id: Optional[Union[str, uuid.UUID]] = None,
        cost: Optional[Union[int, float, Decimal, str]] = None,
        request_id: Optional[Union[str, uuid.UUID]] = None,
        created_at: Optional[datetime] = None,
    ) -> SupabaseInferenceTelemetryRecord:
        """
        Persist an inference telemetry record in Supabase `inference_requests`.
        Uses an explicit UUID primary key (`request_id`) to guarantee uniqueness on retries.
        """
        clean_user_id = user_id.strip() if isinstance(user_id, str) else ""
        if not clean_user_id:
            raise SupabaseTelemetryValidationError("Authenticated user identity is required for telemetry.")

        clean_model = sanitize_diagnostic_text(model_name, max_len=255)
        if not clean_model:
            raise SupabaseTelemetryValidationError("Model name is required for telemetry.")

        clean_provider = sanitize_diagnostic_text(provider_name, max_len=128)
        if not clean_provider:
            raise SupabaseTelemetryValidationError("Provider name is required for telemetry.")

        clean_status = status.strip().lower() if isinstance(status, str) else ""
        if clean_status not in VALID_TELEMETRY_STATUSES:
            raise SupabaseTelemetryValidationError(
                f"Unsupported telemetry status '{sanitize_diagnostic_text(status, max_len=32)}'."
            )

        validated_input_tokens = _coerce_non_negative_int(input_tokens, field_name="input_tokens")
        validated_output_tokens = _coerce_non_negative_int(output_tokens, field_name="output_tokens")
        validated_latency_ms = _coerce_non_negative_int(
            latency_ms,
            field_name="latency_ms",
            allow_none=True,
            max_value=INT32_MAX,
        )
        validated_cost = calculate_inference_cost(
            model_name=clean_model,
            input_tokens=validated_input_tokens if validated_input_tokens is not None else 0,
            output_tokens=validated_output_tokens if validated_output_tokens is not None else 0,
            explicit_cost=cost,
        )

        try:
            record_uuid = (
                request_id
                if isinstance(request_id, uuid.UUID)
                else (uuid.UUID(str(request_id).strip()) if request_id is not None else uuid.uuid4())
            )
            key_uuid = _parse_optional_uuid(api_key_id)
            org_uuid = _parse_optional_uuid(organization_id)
            dep_uuid = _parse_optional_uuid(deployment_id)
        except (ValueError, TypeError) as uuid_err:
            raise SupabaseTelemetryValidationError(
                "Invalid UUID parameter in telemetry payload."
            ) from uuid_err

        clean_error: Optional[str] = None
        if error_message is not None:
            if not isinstance(error_message, str):
                raise SupabaseTelemetryValidationError("error_message must be a string.")
            clean_error = sanitize_diagnostic_text(error_message, max_len=500) or None

        timestamp = created_at or datetime.now(timezone.utc)
        if timestamp.tzinfo is None:
            timestamp = timestamp.replace(tzinfo=timezone.utc)

        payload: Dict[str, Any] = {
            "id": str(record_uuid),
            "user_id": clean_user_id,
            "model_name": clean_model,
            "provider_name": clean_provider,
            "input_tokens": validated_input_tokens,
            "output_tokens": validated_output_tokens,
            "status": clean_status,
            "cost": validated_cost,
            "created_at": timestamp.isoformat(),
        }
        if key_uuid is not None:
            payload["api_key_id"] = str(key_uuid)
        if org_uuid is not None:
            payload["organization_id"] = str(org_uuid)
        if dep_uuid is not None:
            payload["deployment_id"] = str(dep_uuid)
        if validated_latency_ms is not None:
            payload["latency_ms"] = validated_latency_ms
        if clean_error is not None:
            payload["error_message"] = clean_error

        data = self._request_json(
            "POST",
            "inference_requests",
            query_params={"select": INFERENCE_REQUEST_COLUMNS},
            payload=payload,
            prefer="return=representation",
        )

        if not isinstance(data, list) or len(data) != 1:
            raise SupabaseTelemetryServiceUnavailableError(
                "Unexpected response recording inference telemetry."
            )

        record = SupabaseInferenceTelemetryRecord.from_row(data[0])
        if record.user_id != clean_user_id or record.id != record_uuid:
            raise SupabaseTelemetryServiceUnavailableError(
                "Recorded inference telemetry ownership or request ID mismatch."
            )
        return record

    def list_user_inference_requests(
        self,
        user_id: str,
        *,
        limit: int = 100,
    ) -> List[SupabaseInferenceTelemetryRecord]:
        """List inference telemetry records owned strictly by `user_id`, newest first."""
        clean_user_id = user_id.strip() if isinstance(user_id, str) else ""
        if not clean_user_id:
            raise SupabaseTelemetryValidationError("Authenticated user identity is required.")
        if isinstance(limit, bool) or not isinstance(limit, int) or limit < 1 or limit > 1000:
            raise SupabaseTelemetryValidationError("limit must be an integer between 1 and 1000.")

        data = self._request_json(
            "GET",
            "inference_requests",
            query_params={
                "select": INFERENCE_REQUEST_COLUMNS,
                "user_id": f"eq.{clean_user_id}",
                "order": "created_at.desc",
                "limit": str(limit),
            },
        )

        if not isinstance(data, list):
            raise SupabaseTelemetryServiceUnavailableError(
                "Unexpected response querying inference telemetry."
            )

        records = [SupabaseInferenceTelemetryRecord.from_row(row) for row in data]
        return [r for r in records if r.user_id == clean_user_id]


def get_telemetry_repository() -> SupabaseTelemetryRepository:
    """FastAPI dependency returning a configured Supabase telemetry repository."""
    return SupabaseTelemetryRepository()
