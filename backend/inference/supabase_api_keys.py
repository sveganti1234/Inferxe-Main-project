"""
supabase_api_keys.py
====================
Supabase REST API (PostgREST) repository for customer API Keys in Inferxe.

Security & architectural guarantees:
- Uses `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` exclusively from `backend/.env`
  via `inference.supabase_config`.
- Because `SUPABASE_SERVICE_ROLE_KEY` bypasses Supabase Row Level Security (RLS),
  every query and mutation explicitly enforces tenant ownership (`user_id` from verified
  Cognito `sub`).
- Never persists, logs, or returns raw API keys after initial creation.
- Never includes secret hashes in API responses or logs.
- Maps local API key fields safely onto the existing Supabase `api_keys` schema:
  `id`, `user_id`, `organization_id`, `name`, `key_prefix`, `secret_hash`,
  `status`, `created_at`, `last_used_at`, `expires_at`, `revoked_at`.
  (`environment` `'live' | 'test'` is derived deterministically from `key_prefix`.)
"""

import hmac
import http.client
import json
import logging
import re
import socket
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional, Tuple

from inference.supabase_config import (
    SupabaseConfigurationError,
    SupabaseSettings,
    get_supabase_settings,
)

logger = logging.getLogger("inferxe.supabase_api_keys")

# Columns present in Supabase `api_keys` (verified against live PostgREST OpenAPI schema).
API_KEY_METADATA_COLUMNS = (
    "id,user_id,organization_id,name,key_prefix,status,"
    "created_at,last_used_at,expires_at,revoked_at"
)
API_KEY_VERIFY_COLUMNS = f"{API_KEY_METADATA_COLUMNS},secret_hash"

SHA256_HEX_RE = re.compile(r"^[0-9a-fA-F]{64}$")

TRUSTED_HTTP_METHODS = frozenset({"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"})
TRUSTED_API_KEY_RESOURCES = frozenset({"api_keys"})
SLOW_SUPABASE_REQUEST_MS = 1500.0
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


class SupabaseAPIKeyError(RuntimeError):
    """Base error raised for sanitized Supabase API key repository failures."""


class SupabaseAPIKeyServiceUnavailableError(SupabaseAPIKeyError):
    """Raised when Supabase is unreachable, misconfigured, timed out, or returns 5xx."""


class SupabaseAPIKeyValidationError(SupabaseAPIKeyError):
    """Raised for invalid input or foreign-key precondition violations (e.g. missing profile)."""


class APIKeyNotFoundError(SupabaseAPIKeyError):
    """Raised when the target API key does not exist."""


class APIKeyForbiddenError(SupabaseAPIKeyError):
    """Raised when a user attempts to access or revoke another user's API key."""


def derive_environment_from_prefix(key_prefix: Optional[str]) -> str:
    """
    Derive `'test'` or `'live'` from `key_prefix` (`inf_test_*` / `inf_live_*`).
    Supabase `api_keys` has no separate `environment` column, while Inferxe key prefixes
    encode environment deterministically.
    """
    prefix = (key_prefix or "").strip()
    if prefix.startswith("inf_test_"):
        return "test"
    return "live"


def normalize_api_key_status(raw_status: Any) -> str:
    """
    Normalize status strings using strip and lowercase.
    Treat missing, empty, whitespace-only, or malformed non-string statuses as inactive (fail closed).
    """
    if not isinstance(raw_status, str):
        return "inactive"
    normalized = raw_status.strip().lower()
    if not normalized:
        return "inactive"
    return normalized


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
        raise ValueError("Malformed UUID value returned from Supabase.")
    return uuid.UUID(value.strip())


def _default_urllib_transport(
    method: str,
    url: str,
    headers: Dict[str, str],
    body: Optional[bytes],
    timeout: float,
) -> Tuple[int, Dict[str, str], bytes]:
    """Execute an HTTPS/HTTP request using stdlib `urllib.request` with explicit timeout."""
    req = urllib.request.Request(url=url, data=body, headers=headers, method=method)
    started_at = time.perf_counter()
    phase = "urlopen_headers"
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            phase = "read_body"
            resp_headers = {k.lower(): v for k, v in resp.headers.items()}
            resp_body = resp.read()
            return resp.status, resp_headers, resp_body
    except urllib.error.HTTPError as http_err:
        err_headers = {k.lower(): v for k, v in http_err.headers.items()} if http_err.headers else {}
        try:
            err_body = http_err.read()
        finally:
            http_err.close()
        return http_err.code, err_headers, err_body
    except (TimeoutError, socket.timeout, urllib.error.URLError, http.client.HTTPException, OSError) as net_err:
        elapsed_ms = max(0.0, (time.perf_counter() - started_at) * 1000.0)
        logger.warning(
            "Supabase urllib %s transport failed (phase=%s, elapsed_ms=%.1f, error=%s).",
            _trusted_log_method(method),
            phase,
            elapsed_ms,
            type(net_err).__name__,
        )
        raise


@dataclass
class SupabaseAPIKeyRecord:
    """Normalized representation of a Supabase `api_keys` row."""

    id: uuid.UUID
    user_id: str
    name: str
    key_prefix: str
    status: str = "inactive"
    organization_id: Optional[uuid.UUID] = None
    secret_hash: Optional[str] = field(default=None, repr=False)
    created_at: Optional[datetime] = None
    last_used_at: Optional[datetime] = None
    expires_at: Optional[datetime] = None
    revoked_at: Optional[datetime] = None

    def __post_init__(self) -> None:
        self.status = normalize_api_key_status(self.status)

    @property
    def environment(self) -> str:
        return derive_environment_from_prefix(self.key_prefix)

    @property
    def is_revoked_or_inactive(self) -> bool:
        return self.status != "active" or self.revoked_at is not None

    @property
    def is_expired(self) -> bool:
        if self.expires_at is None:
            return False
        exp = self.expires_at if self.expires_at.tzinfo else self.expires_at.replace(tzinfo=timezone.utc)
        return exp <= datetime.now(timezone.utc)

    @property
    def is_active(self) -> bool:
        return not self.is_revoked_or_inactive and not self.is_expired

    @classmethod
    def from_row(cls, row: Dict[str, Any]) -> "SupabaseAPIKeyRecord":
        if not isinstance(row, dict):
            raise SupabaseAPIKeyServiceUnavailableError("Received malformed API key record from Supabase.")

        raw_user_id = row.get("user_id")
        if not isinstance(raw_user_id, str) or not raw_user_id.strip():
            raise SupabaseAPIKeyServiceUnavailableError("Received malformed API key record from Supabase.")

        raw_id = row.get("id")
        if not isinstance(raw_id, (str, uuid.UUID)) or not str(raw_id).strip():
            raise SupabaseAPIKeyServiceUnavailableError("Received malformed API key record from Supabase.")

        raw_name = row.get("name")
        if raw_name is not None and not isinstance(raw_name, str):
            raise SupabaseAPIKeyServiceUnavailableError("Received malformed API key record from Supabase.")

        raw_prefix = row.get("key_prefix")
        if raw_prefix is not None and not isinstance(raw_prefix, str):
            raise SupabaseAPIKeyServiceUnavailableError("Received malformed API key record from Supabase.")

        raw_secret_hash = row.get("secret_hash")
        if raw_secret_hash is not None and not isinstance(raw_secret_hash, str):
            raise SupabaseAPIKeyServiceUnavailableError("Received malformed API key record from Supabase.")

        try:
            key_uuid = raw_id if isinstance(raw_id, uuid.UUID) else uuid.UUID(raw_id.strip())
            org_uuid = _parse_optional_uuid(row.get("organization_id"))
            created_at = parse_supabase_timestamp(row.get("created_at"))
            last_used_at = parse_supabase_timestamp(row.get("last_used_at"))
            expires_at = parse_supabase_timestamp(row.get("expires_at"))
            revoked_at = parse_supabase_timestamp(row.get("revoked_at"))
        except (ValueError, TypeError) as parse_err:
            logger.warning("Malformed API key record received from Supabase (%s).", type(parse_err).__name__)
            raise SupabaseAPIKeyServiceUnavailableError(
                "Received malformed API key record from Supabase."
            ) from parse_err

        return cls(
            id=key_uuid,
            user_id=raw_user_id.strip(),
            organization_id=org_uuid,
            name=(raw_name.strip() if isinstance(raw_name, str) and raw_name.strip() else "Default Key"),
            key_prefix=(raw_prefix or "").strip(),
            status=normalize_api_key_status(row.get("status")),
            secret_hash=(raw_secret_hash.strip() or None) if isinstance(raw_secret_hash, str) else None,
            created_at=created_at,
            last_used_at=last_used_at,
            expires_at=expires_at,
            revoked_at=revoked_at,
        )


def _sanitize_diagnostic_text(text: Any, max_len: int = 240) -> str:
    """Scrub URLs, tokens, control characters, and cap length for server-side logs only."""
    cleaned = re.sub(r"[\r\n\t]+", " ", str(text or "")).strip()
    for pattern in _SENSITIVE_ERROR_PATTERNS:
        cleaned = pattern.sub("[REDACTED]", cleaned)
    return cleaned[:max_len]


def _trusted_log_method(method: Any) -> str:
    candidate = method.strip().upper() if isinstance(method, str) else ""
    return candidate if candidate in TRUSTED_HTTP_METHODS else "UNKNOWN"


def _trusted_log_resource(resource: Any) -> str:
    candidate = resource.strip() if isinstance(resource, str) else ""
    return candidate if candidate in TRUSTED_API_KEY_RESOURCES else "unknown_resource"


def _safe_response_diagnostics(resp_headers: Any) -> Tuple[str, Optional[int], Optional[int]]:
    """Extract strictly non-secret connection and upstream latency metadata from response headers."""
    if not isinstance(resp_headers, dict):
        return "unknown", None, None

    lowered = {str(k).lower(): v for k, v in resp_headers.items()}
    raw_conn = lowered.get("connection")
    conn_mode = "unknown"
    if isinstance(raw_conn, str):
        normalized_conn = raw_conn.strip().lower()
        if normalized_conn in ("close", "keep-alive"):
            conn_mode = normalized_conn

    def _parse_non_negative_int_header(header_name: str) -> Optional[int]:
        raw_val = lowered.get(header_name)
        if isinstance(raw_val, str):
            stripped = raw_val.strip()
            if stripped.isdigit():
                return int(stripped)
        elif isinstance(raw_val, int) and not isinstance(raw_val, bool) and raw_val >= 0:
            return raw_val
        return None

    return (
        conn_mode,
        _parse_non_negative_int_header("x-envoy-upstream-service-time"),
        _parse_non_negative_int_header("x-envoy-attempt-count"),
    )


def _sanitize_error_code(raw_code: Any) -> Optional[str]:
    """Validate and return only safe PostgreSQL SQLSTATE or PostgREST error codes."""
    if not isinstance(raw_code, str):
        return None
    scrubbed = _sanitize_diagnostic_text(raw_code, max_len=32).strip()
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
                    message = _sanitize_diagnostic_text(payload["message"])
                if isinstance(payload.get("details"), str) and payload["details"].strip():
                    details = _sanitize_diagnostic_text(payload["details"])
        except Exception:
            pass
    return code, message, details


class SupabaseAPIKeyRepository:
    """
    Repository encapsulating all PostgREST CRUD and verification operations
    against the Supabase `api_keys` table.
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
            logger.error("Supabase API key repository configuration invalid: %s", type(cfg_err).__name__)
            raise SupabaseAPIKeyServiceUnavailableError(
                "API key service is not configured."
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

        started_at = time.perf_counter()
        try:
            status_code, resp_headers, resp_body = self._transport(
                method, url, headers, body_bytes, self.timeout
            )
        except (TimeoutError, socket.timeout) as timeout_err:
            elapsed_ms = max(0.0, (time.perf_counter() - started_at) * 1000.0)
            logger.error(
                "Supabase REST %s %s timed out after %.1fs (elapsed_ms=%.1f).",
                safe_method,
                safe_resource,
                self.timeout,
                elapsed_ms,
            )
            raise SupabaseAPIKeyServiceUnavailableError(
                "API key database request timed out."
            ) from timeout_err
        except urllib.error.URLError as conn_err:
            elapsed_ms = max(0.0, (time.perf_counter() - started_at) * 1000.0)
            logger.error(
                "Supabase REST %s %s connection error (%s, elapsed_ms=%.1f).",
                safe_method,
                safe_resource,
                type(conn_err.reason).__name__ if getattr(conn_err, "reason", None) else type(conn_err).__name__,
                elapsed_ms,
            )
            raise SupabaseAPIKeyServiceUnavailableError(
                "API key database is temporarily unavailable."
            ) from conn_err
        except http.client.HTTPException as http_err:
            elapsed_ms = max(0.0, (time.perf_counter() - started_at) * 1000.0)
            logger.error(
                "Supabase REST %s %s protocol error (%s, elapsed_ms=%.1f).",
                safe_method,
                safe_resource,
                type(http_err).__name__,
                elapsed_ms,
            )
            raise SupabaseAPIKeyServiceUnavailableError(
                "API key database communication failed."
            ) from http_err
        except (OSError, ValueError) as net_err:
            elapsed_ms = max(0.0, (time.perf_counter() - started_at) * 1000.0)
            logger.error(
                "Supabase REST %s %s transport error (%s, elapsed_ms=%.1f).",
                safe_method,
                safe_resource,
                type(net_err).__name__,
                elapsed_ms,
            )
            raise SupabaseAPIKeyServiceUnavailableError(
                "API key database is temporarily unavailable."
            ) from net_err

        transport_ms = max(0.0, (time.perf_counter() - started_at) * 1000.0)
        resp_bytes = len(resp_body) if isinstance(resp_body, (bytes, bytearray)) else 0
        conn_mode, upstream_ms, envoy_attempts = _safe_response_diagnostics(resp_headers)

        if transport_ms >= SLOW_SUPABASE_REQUEST_MS:
            logger.warning(
                "Slow Supabase REST %s %s response (status=%s, elapsed_ms=%.1f, bytes=%d, conn=%s, upstream_ms=%s, attempts=%s).",
                safe_method,
                safe_resource,
                status_code,
                transport_ms,
                resp_bytes,
                conn_mode,
                upstream_ms,
                envoy_attempts,
            )

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
            raise SupabaseAPIKeyServiceUnavailableError(
                "API key database returned an upstream error."
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
                is_profile_fk = (
                    "api_keys_user_id_fkey" in fk_context
                    or ("(user_id)" in fk_context and "profiles" in fk_context)
                )
                if is_profile_fk:
                    raise SupabaseAPIKeyValidationError(
                        "Customer profile must be initialized before creating API keys."
                    )
                if "api_keys_organization_id_fkey" in fk_context or "organizations" in fk_context:
                    raise SupabaseAPIKeyValidationError(
                        "Specified organization record does not exist."
                    )
                raise SupabaseAPIKeyValidationError(
                    "API key references a missing prerequisite record."
                )
            if pg_code == "23505":
                raise SupabaseAPIKeyValidationError(
                    "API key conflict detected. Please retry key generation."
                )
            if status_code in (401, 403):
                raise SupabaseAPIKeyServiceUnavailableError(
                    "API key database authentication failed."
                )
            if status_code == 400 or pg_code in ("22P02", "23514"):
                raise SupabaseAPIKeyValidationError("Invalid API key request parameters.")
            raise SupabaseAPIKeyError("API key database rejected the request.")

        if not resp_body:
            logger.info(
                "Supabase REST %s %s completed (status=%s, elapsed_ms=%.1f, json_ms=0.00, bytes=0, conn=%s, upstream_ms=%s, attempts=%s).",
                safe_method,
                safe_resource,
                status_code,
                transport_ms,
                conn_mode,
                upstream_ms,
                envoy_attempts,
            )
            return None

        parse_started = time.perf_counter()
        try:
            parsed = json.loads(resp_body.decode("utf-8"))
        except Exception as json_err:
            logger.error(
                "Supabase REST %s %s returned invalid JSON (%s).",
                safe_method,
                safe_resource,
                type(json_err).__name__,
            )
            raise SupabaseAPIKeyServiceUnavailableError(
                "Received invalid response from API key database."
            ) from json_err

        json_ms = max(0.0, (time.perf_counter() - parse_started) * 1000.0)
        logger.info(
            "Supabase REST %s %s completed (status=%s, elapsed_ms=%.1f, json_ms=%.2f, bytes=%d, conn=%s, upstream_ms=%s, attempts=%s).",
            safe_method,
            safe_resource,
            status_code,
            transport_ms,
            json_ms,
            resp_bytes,
            conn_mode,
            upstream_ms,
            envoy_attempts,
        )
        return parsed

    def create_api_key(
        self,
        *,
        user_id: str,
        name: str,
        key_prefix: str,
        secret_hash: str,
        expires_at: Optional[datetime] = None,
        organization_id: Optional[str] = None,
    ) -> SupabaseAPIKeyRecord:
        """Persist a new hashed API key bound strictly to `user_id` (verified Cognito `sub`)."""
        clean_user_id = (user_id or "").strip()
        if not clean_user_id:
            raise SupabaseAPIKeyValidationError("Authenticated user identity is required.")
        if not SHA256_HEX_RE.match(secret_hash or ""):
            raise SupabaseAPIKeyValidationError("API key secret hash must be a valid SHA-256 hex digest.")

        clean_name = (name or "Default Key").strip() or "Default Key"
        now_utc = datetime.now(timezone.utc)

        payload: Dict[str, Any] = {
            "id": str(uuid.uuid4()),
            "user_id": clean_user_id,
            "name": clean_name[:100],
            "key_prefix": key_prefix,
            "secret_hash": secret_hash,
            "status": "active",
            "created_at": now_utc.isoformat(),
        }
        if expires_at is not None:
            exp_utc = expires_at if expires_at.tzinfo else expires_at.replace(tzinfo=timezone.utc)
            payload["expires_at"] = exp_utc.isoformat()
        if organization_id is not None:
            try:
                payload["organization_id"] = str(uuid.UUID(str(organization_id)))
            except (ValueError, TypeError) as org_err:
                raise SupabaseAPIKeyValidationError(
                    "Invalid organization ID format. Expected UUID."
                ) from org_err

        data = self._request_json(
            "POST",
            "api_keys",
            query_params={"select": API_KEY_METADATA_COLUMNS},
            payload=payload,
            prefer="return=representation",
        )

        if not isinstance(data, list) or len(data) != 1:
            raise SupabaseAPIKeyServiceUnavailableError("Unexpected response creating API key.")

        record = SupabaseAPIKeyRecord.from_row(data[0])
        if record.user_id != clean_user_id:
            raise SupabaseAPIKeyServiceUnavailableError("Created API key ownership mismatch.")
        return record

    def list_user_api_keys(self, user_id: str) -> List[SupabaseAPIKeyRecord]:
        """List all API keys owned strictly by `user_id`, ordered newest first."""
        clean_user_id = (user_id or "").strip()
        if not clean_user_id:
            raise SupabaseAPIKeyValidationError("Authenticated user identity is required.")

        data = self._request_json(
            "GET",
            "api_keys",
            query_params={
                "select": API_KEY_METADATA_COLUMNS,
                "user_id": f"eq.{clean_user_id}",
                "order": "created_at.desc",
            },
        )

        if not isinstance(data, list):
            raise SupabaseAPIKeyServiceUnavailableError("Unexpected list response from API key database.")

        records = [SupabaseAPIKeyRecord.from_row(row) for row in data]
        # Defense in depth when using service role key (bypasses RLS):
        return [r for r in records if r.user_id == clean_user_id]

    def revoke_api_key(self, *, key_id: str, user_id: str) -> Tuple[SupabaseAPIKeyRecord, bool]:
        """
        Atomically revoke an active API key owned by `user_id`.
        Returns `(record, already_revoked)`.
        Uses conditional predicates (`id`, `user_id`, `status=eq.active`, `revoked_at=is.null`)
        so concurrent requests cannot overwrite `revoked_at` or mutate another user's row.
        """
        clean_user_id = (user_id or "").strip()
        if not clean_user_id:
            raise SupabaseAPIKeyValidationError("Authenticated user identity is required.")

        try:
            key_uuid = str(uuid.UUID(str(key_id)))
        except (ValueError, TypeError) as uuid_err:
            raise SupabaseAPIKeyValidationError("Invalid key ID format. Expected UUID.") from uuid_err

        now_iso = datetime.now(timezone.utc).isoformat()
        updated = self._request_json(
            "PATCH",
            "api_keys",
            query_params={
                "id": f"eq.{key_uuid}",
                "user_id": f"eq.{clean_user_id}",
                "status": "eq.active",
                "revoked_at": "is.null",
                "select": API_KEY_METADATA_COLUMNS,
            },
            payload={
                "status": "revoked",
                "revoked_at": now_iso,
            },
            prefer="return=representation",
        )

        if not isinstance(updated, list):
            raise SupabaseAPIKeyServiceUnavailableError("Unexpected response revoking API key.")

        if len(updated) > 0:
            revoked_record = SupabaseAPIKeyRecord.from_row(updated[0])
            if revoked_record.user_id != clean_user_id:
                raise SupabaseAPIKeyServiceUnavailableError("Revoked API key ownership mismatch.")
            return revoked_record, False

        rows = self._request_json(
            "GET",
            "api_keys",
            query_params={
                "select": API_KEY_METADATA_COLUMNS,
                "id": f"eq.{key_uuid}",
                "limit": "1",
            },
        )
        if not isinstance(rows, list):
            raise SupabaseAPIKeyServiceUnavailableError("Unexpected response verifying API key revocation.")
        if len(rows) == 0:
            raise APIKeyNotFoundError("API key not found.")

        existing = SupabaseAPIKeyRecord.from_row(rows[0])
        if existing.user_id != clean_user_id:
            raise APIKeyForbiddenError(
                "Access denied: You cannot revoke an API key belonging to another user."
            )

        if existing.is_revoked_or_inactive:
            return existing, True

        raise SupabaseAPIKeyServiceUnavailableError(
            "Concurrent API key state change detected; please retry revocation."
        )

    def get_by_secret_hash(self, secret_hash: str) -> Optional[SupabaseAPIKeyRecord]:
        """
        Look up an API key by its SHA-256 `secret_hash` and verify the hash
        in constant time before returning the record.
        """
        clean_hash = (secret_hash or "").strip().lower()
        if not SHA256_HEX_RE.match(clean_hash):
            return None

        rows = self._request_json(
            "GET",
            "api_keys",
            query_params={
                "select": API_KEY_VERIFY_COLUMNS,
                "secret_hash": f"eq.{clean_hash}",
                "limit": "1",
            },
        )
        if not isinstance(rows, list):
            raise SupabaseAPIKeyServiceUnavailableError("Unexpected lookup response from API key database.")
        if len(rows) == 0:
            return None

        record = SupabaseAPIKeyRecord.from_row(rows[0])
        if not record.secret_hash or not hmac.compare_digest(record.secret_hash.lower(), clean_hash):
            return None

        return record

    def update_last_used(
        self,
        *,
        key_id: uuid.UUID,
        user_id: str,
        used_at: Optional[datetime] = None,
    ) -> None:
        """
        Update `last_used_at` for a verified, active, unrevoked API key owned by `user_id`.
        """
        clean_user_id = (user_id or "").strip()
        if not clean_user_id:
            raise SupabaseAPIKeyValidationError("Authenticated user identity is required.")

        try:
            key_uuid = str(uuid.UUID(str(key_id)))
        except (ValueError, TypeError) as uuid_err:
            raise SupabaseAPIKeyValidationError("Invalid API key ID.") from uuid_err

        timestamp = used_at or datetime.now(timezone.utc)
        if timestamp.tzinfo is None:
            timestamp = timestamp.replace(tzinfo=timezone.utc)

        query_params: Dict[str, str] = {
            "id": f"eq.{key_uuid}",
            "user_id": f"eq.{clean_user_id}",
            "status": "eq.active",
            "revoked_at": "is.null",
        }

        self._request_json(
            "PATCH",
            "api_keys",
            query_params=query_params,
            payload={"last_used_at": timestamp.isoformat()},
            prefer="return=minimal",
        )


def get_api_key_repository() -> SupabaseAPIKeyRepository:
    """FastAPI dependency returning a configured Supabase API key repository."""
    return SupabaseAPIKeyRepository()
