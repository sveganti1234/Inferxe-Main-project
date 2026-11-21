"""
supabase_notebooks.py
=====================
Supabase REST API (PostgREST) repository for customer GPU Notebook Sessions
(`notebook_sessions`) in Inferxe.

Security & architectural guarantees:
- Reads `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` exclusively from `backend/.env`
  via `inference.supabase_config`.
- Because `SUPABASE_SERVICE_ROLE_KEY` bypasses Supabase Row Level Security (RLS),
  every query and mutation explicitly filters and validates ownership using the
  verified Cognito `sub` (`user_id`).
- Integrates `inference.supabase_ssh_keys.SupabaseSSHKeyRepository` to verify
  that any `selected_ssh_key_id` belongs to the authenticated user before creating
  a notebook session, and resolves SSH key types for command formatting.
- Persists only 64-character SHA-256 hex digests (`token_hash`) on creation and
  excludes `token_hash` from all `SELECT` projections and API responses.
- Enforces atomic conditional state transitions (`PATCH` with status preconditions)
  to handle concurrent lifecycle updates safely.
- Uses a thread-safe, pooled HTTP/1.1 `httpx2.Client` transport with explicit
  timeouts while keeping secrets, raw tokens, and raw PostgREST `details`/`hint`
  out of server logs and error responses.
"""

import atexit
import http.client
import json
import logging
import re
import socket
import threading
import time
import urllib.error
import urllib.parse
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional, Tuple, Union

import httpx2

from inference.ssh_key_service import SSHKeyValidationError
from inference.supabase_config import (
    SupabaseConfigurationError,
    SupabaseSettings,
    get_supabase_settings,
)
from inference.supabase_ssh_keys import (
    SupabaseSSHKeyError,
    SupabaseSSHKeyRecord,
    SupabaseSSHKeyRepository,
    SupabaseSSHKeyServiceUnavailableError,
    SupabaseSSHKeyValidationError,
    get_ssh_key_repository,
)

logger = logging.getLogger("inferxe.supabase_notebooks")

# Exact columns verified against the live Supabase `notebook_sessions` PostgREST schema.
# `token_hash` is write-only on insert and intentionally omitted from projections.
NOTEBOOK_SESSIONS_COLUMNS = (
    "id,user_id,deployment_id,name,gpu_profile,status,"
    "runtime_type,runtime_reference,selected_ssh_key_id,"
    "bot_access_enabled,started_at,stopped_at,"
    "created_at,updated_at,last_active_at"
)

VALID_NOTEBOOK_STATUSES = frozenset(
    {"starting", "provisioning", "running", "stopped", "failed", "terminated"}
)
ALLOWED_START_SOURCE_STATUSES = frozenset({"stopped", "provisioning", "failed", "starting"})
ALLOWED_STOP_SOURCE_STATUSES = frozenset({"running", "provisioning", "starting"})

SHA256_HEX_RE = re.compile(r"^[0-9a-fA-F]{64}$")

SLOW_SUPABASE_REQUEST_MS = 1500.0
DEFAULT_CONNECT_TIMEOUT_SECONDS = 5.0
DEFAULT_MAX_CONNECTIONS = 20
DEFAULT_MAX_KEEPALIVE_CONNECTIONS = 10
DEFAULT_KEEPALIVE_EXPIRY_SECONDS = 20.0

TRUSTED_HTTP_METHODS = frozenset({"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"})
TRUSTED_NOTEBOOK_RESOURCES = frozenset({"notebook_sessions"})
_SAFE_ERROR_CODE_RE = re.compile(r"^[A-Za-z0-9_]{1,32}$")
_HEX_TOKEN_RE = re.compile(r"^[0-9a-fA-F]{32,}$")

_SENSITIVE_ERROR_PATTERNS = (
    re.compile(r"(?:https?|postgres(?:ql)?)://[^\s\"'<>]+", re.IGNORECASE),
    re.compile(r"\b(?:sb_secret|sbp|sb_publishable)_[A-Za-z0-9._-]+\b"),
    re.compile(r"\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9._-]+\.[A-Za-z0-9._-]+\b"),
    re.compile(r"\binf_(?:live|test)_[A-Za-z0-9_-]+\b"),
    re.compile(r"\bixnb_[A-Za-z0-9_-]+\b"),
    re.compile(r"\bnvapi-[A-Za-z0-9._-]+\b"),
    re.compile(r"\b(?:Bearer|Basic)\s+[A-Za-z0-9+/=._-]+\b", re.IGNORECASE),
    re.compile(
        r"\b(?:apikey|api[-_]?key|secret[-_]?key|service[-_]?role[-_]?key|token[-_]?hash|access[-_]?token|password|passwd|pwd)\s*[:=]\s*[^\s,;\"'<>]+",
        re.IGNORECASE,
    ),
    re.compile(
        r"\b(?:ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(?:256|384|521)|sk-ssh-[^\s]+|sk-ecdsa-[^\s]+)\s+[A-Za-z0-9+/=]+(?:\s+[^\s,;\"'<>]+)?",
        re.IGNORECASE,
    ),
    re.compile(r"-----BEGIN [A-Z0-9\s]+PRIVATE KEY-----", re.IGNORECASE),
    re.compile(r"\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b"),
)

TransportCallable = Callable[
    [str, str, Dict[str, str], Optional[bytes], float],
    Tuple[int, Dict[str, str], bytes],
]

_HTTP_CLIENT_LOCK = threading.Lock()
_SHARED_HTTP_CLIENT: Optional[httpx2.Client] = None


# --- Exceptions ---

class NotebookError(Exception):
    """Base exception for notebook operations."""


class NotebookNotFoundError(NotebookError):
    """Raised when a notebook is not found or user lacks access."""


class NotebookValidationError(NotebookError):
    """Raised when notebook parameters or SSH key bindings are invalid."""


class InvalidStateTransitionError(NotebookError):
    """Raised when a requested lifecycle state transition is disallowed."""


class SupabaseNotebookError(NotebookError):
    """Base error raised for sanitized Supabase notebook repository failures."""


class SupabaseNotebookServiceUnavailableError(SupabaseNotebookError):
    """Raised when Supabase is unreachable, misconfigured, timed out, or returns 5xx."""


class SupabaseNotebookValidationError(SupabaseNotebookError, NotebookValidationError):
    """Raised for invalid notebook parameters or foreign-key precondition failures."""


# --- Parsing & Sanitization Helpers ---

def normalize_notebook_status(raw_status: Any) -> str:
    """Validate and normalize notebook session statuses against DB CHECK constraints."""
    if not isinstance(raw_status, str):
        raise ValueError("Unsupported status type returned from Supabase.")
    normalized = raw_status.strip().lower()
    if normalized not in VALID_NOTEBOOK_STATUSES:
        raise ValueError("Unsupported notebook status returned from Supabase.")
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


def sanitize_diagnostic_text(text: Any, max_len: int = 240) -> str:
    """Scrub URLs, credentials, notebook tokens, SSH keys, control chars, and UUIDs."""
    cleaned = re.sub(r"[\r\n\t]+", " ", str(text or "")).strip()
    for pattern in _SENSITIVE_ERROR_PATTERNS:
        cleaned = pattern.sub("[REDACTED]", cleaned)
    return cleaned[:max_len]


def _trusted_log_method(method: Any) -> str:
    candidate = method.strip().upper() if isinstance(method, str) else ""
    return candidate if candidate in TRUSTED_HTTP_METHODS else "UNKNOWN"


def _trusted_log_resource(resource: Any) -> str:
    candidate = resource.strip() if isinstance(resource, str) else ""
    return candidate if candidate in TRUSTED_NOTEBOOK_RESOURCES else "unknown_resource"


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
    without extracting `hint` or logging raw database diagnostics.
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


# --- Pooled HTTP/1.1 Transport ---

def _create_pooled_http_client() -> httpx2.Client:
    """Create a thread-safe HTTP/1.1 connection-pooled client for Supabase REST."""
    return httpx2.Client(
        http1=True,
        http2=False,
        limits=httpx2.Limits(
            max_connections=DEFAULT_MAX_CONNECTIONS,
            max_keepalive_connections=DEFAULT_MAX_KEEPALIVE_CONNECTIONS,
            keepalive_expiry=DEFAULT_KEEPALIVE_EXPIRY_SECONDS,
        ),
        headers={"Connection": "keep-alive"},
    )


def _get_shared_http_client() -> httpx2.Client:
    """Return the lazily initialized thread-safe pooled `httpx2.Client` singleton."""
    global _SHARED_HTTP_CLIENT
    with _HTTP_CLIENT_LOCK:
        if _SHARED_HTTP_CLIENT is None or _SHARED_HTTP_CLIENT.is_closed:
            _SHARED_HTTP_CLIENT = _create_pooled_http_client()
        return _SHARED_HTTP_CLIENT


def close_shared_notebooks_http_client() -> None:
    """Cleanly close the shared pooled notebook HTTP client on process exit or shutdown."""
    global _SHARED_HTTP_CLIENT
    with _HTTP_CLIENT_LOCK:
        client = _SHARED_HTTP_CLIENT
        _SHARED_HTTP_CLIENT = None
    if client is not None and not client.is_closed:
        try:
            client.close()
        except Exception:
            pass


atexit.register(close_shared_notebooks_http_client)


def _default_pooled_http_transport(
    method: str,
    url: str,
    headers: Dict[str, str],
    body: Optional[bytes],
    timeout: float,
) -> Tuple[int, Dict[str, str], bytes]:
    """
    Execute an HTTPS/HTTP request using the shared pooled `httpx2.Client`.
    Preserves keep-alive connections across requests and avoids cold-connection stalls.
    """
    client = _get_shared_http_client()
    timeout_val = float(timeout)
    req_timeout = httpx2.Timeout(
        timeout_val,
        connect=min(timeout_val, DEFAULT_CONNECT_TIMEOUT_SECONDS),
    )
    response = client.request(
        method=method,
        url=url,
        headers=headers,
        content=body,
        timeout=req_timeout,
    )
    resp_headers = {k.lower(): v for k, v in response.headers.items()}
    return response.status_code, resp_headers, response.content


# --- Domain Record & Validators ---

@dataclass
class SupabaseNotebookRecord:
    """Normalized representation of a Supabase `notebook_sessions` row."""

    id: uuid.UUID
    user_id: str
    name: str
    gpu_profile: str
    status: str
    runtime_type: str = "simulated"
    runtime_reference: Optional[str] = None
    selected_ssh_key_id: Optional[uuid.UUID] = None
    ssh_key_type: Optional[str] = None
    deployment_id: Optional[uuid.UUID] = None
    bot_access_enabled: bool = False
    started_at: Optional[datetime] = None
    stopped_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    last_active_at: Optional[datetime] = None

    @classmethod
    def from_row(
        cls,
        row: Dict[str, Any],
        ssh_key_type: Optional[str] = None,
    ) -> "SupabaseNotebookRecord":
        if not isinstance(row, dict):
            raise SupabaseNotebookServiceUnavailableError(
                "Received malformed notebook record from Supabase."
            )

        raw_id = row.get("id")
        if not isinstance(raw_id, (str, uuid.UUID)) or not str(raw_id).strip():
            raise SupabaseNotebookServiceUnavailableError(
                "Received malformed notebook record from Supabase."
            )

        raw_user_id = row.get("user_id")
        if not isinstance(raw_user_id, str) or not raw_user_id.strip():
            raise SupabaseNotebookServiceUnavailableError(
                "Received malformed notebook record from Supabase."
            )

        raw_name = row.get("name")
        if raw_name is not None and not isinstance(raw_name, str):
            raise SupabaseNotebookServiceUnavailableError(
                "Received malformed notebook record from Supabase."
            )

        raw_gpu_profile = row.get("gpu_profile")
        if raw_gpu_profile is not None and not isinstance(raw_gpu_profile, str):
            raise SupabaseNotebookServiceUnavailableError(
                "Received malformed notebook record from Supabase."
            )

        raw_runtime_type = row.get("runtime_type")
        if raw_runtime_type is not None and not isinstance(raw_runtime_type, str):
            raise SupabaseNotebookServiceUnavailableError(
                "Received malformed notebook record from Supabase."
            )

        raw_runtime_ref = row.get("runtime_reference")
        if raw_runtime_ref is not None and not isinstance(raw_runtime_ref, str):
            raise SupabaseNotebookServiceUnavailableError(
                "Received malformed notebook record from Supabase."
            )

        raw_bot_access = row.get("bot_access_enabled", False)
        if not isinstance(raw_bot_access, bool):
            raise SupabaseNotebookServiceUnavailableError(
                "Received malformed notebook record from Supabase."
            )

        try:
            notebook_uuid = raw_id if isinstance(raw_id, uuid.UUID) else uuid.UUID(raw_id.strip())
            selected_ssh_key_uuid = _parse_optional_uuid(row.get("selected_ssh_key_id"))
            deployment_uuid = _parse_optional_uuid(row.get("deployment_id"))
            status = normalize_notebook_status(row.get("status"))
            started_at = parse_supabase_timestamp(row.get("started_at"))
            stopped_at = parse_supabase_timestamp(row.get("stopped_at"))
            created_at = parse_supabase_timestamp(row.get("created_at"))
            updated_at = parse_supabase_timestamp(row.get("updated_at"))
            last_active_at = parse_supabase_timestamp(row.get("last_active_at"))
        except (ValueError, TypeError) as parse_err:
            logger.warning(
                "Malformed notebook record received from Supabase (%s).",
                type(parse_err).__name__,
            )
            raise SupabaseNotebookServiceUnavailableError(
                "Received malformed notebook record from Supabase."
            ) from parse_err

        clean_name = (
            raw_name.strip()
            if isinstance(raw_name, str) and raw_name.strip()
            else "Untitled Notebook"
        )
        clean_gpu = (
            raw_gpu_profile.strip()
            if isinstance(raw_gpu_profile, str) and raw_gpu_profile.strip()
            else "NVIDIA L4"
        )
        clean_runtime = (
            raw_runtime_type.strip()
            if isinstance(raw_runtime_type, str) and raw_runtime_type.strip()
            else "simulated"
        )
        clean_runtime_ref = (
            raw_runtime_ref.strip() or None
            if isinstance(raw_runtime_ref, str)
            else None
        )

        return cls(
            id=notebook_uuid,
            user_id=raw_user_id.strip(),
            name=clean_name,
            gpu_profile=clean_gpu,
            status=status,
            runtime_type=clean_runtime,
            runtime_reference=clean_runtime_ref,
            selected_ssh_key_id=selected_ssh_key_uuid,
            ssh_key_type=ssh_key_type,
            deployment_id=deployment_uuid,
            bot_access_enabled=raw_bot_access,
            started_at=started_at,
            stopped_at=stopped_at,
            created_at=created_at,
            updated_at=updated_at,
            last_active_at=last_active_at,
        )


def _validate_user_id(user_id: Any) -> str:
    if not isinstance(user_id, str):
        raise NotebookValidationError("User ID is required for tenant isolation.")
    clean = user_id.strip()
    if not clean or any(ch in clean for ch in ("\r", "\n", "\x00")):
        raise NotebookValidationError("User ID is required for tenant isolation.")
    return clean


def _parse_notebook_uuid(notebook_id: Any) -> str:
    if not isinstance(notebook_id, (str, uuid.UUID)):
        raise SupabaseNotebookValidationError("Invalid notebook ID format. Expected UUID.")
    if isinstance(notebook_id, uuid.UUID):
        return str(notebook_id)
    cleaned = notebook_id.strip()
    if not cleaned:
        raise SupabaseNotebookValidationError("Invalid notebook ID format. Expected UUID.")
    try:
        return str(uuid.UUID(cleaned))
    except (ValueError, TypeError) as uuid_err:
        raise SupabaseNotebookValidationError("Invalid notebook ID format. Expected UUID.") from uuid_err


def _parse_ssh_key_uuid(ssh_key_id: Any) -> uuid.UUID:
    if isinstance(ssh_key_id, uuid.UUID):
        return ssh_key_id
    if not isinstance(ssh_key_id, str):
        raise NotebookValidationError("Invalid selected_ssh_key_id format. Expected UUID.")
    cleaned = ssh_key_id.strip()
    if not cleaned:
        raise NotebookValidationError("Invalid selected_ssh_key_id format. Expected UUID.")
    try:
        return uuid.UUID(cleaned)
    except (ValueError, TypeError) as uuid_err:
        raise NotebookValidationError(
            "Invalid selected_ssh_key_id format. Expected UUID."
        ) from uuid_err


# --- Repository ---

class SupabaseNotebookRepository:
    """
    Repository encapsulating all PostgREST CRUD and atomic lifecycle operations against
    the Supabase `notebook_sessions` table with strict Cognito `user_id` isolation.
    """

    def __init__(
        self,
        settings: Optional[SupabaseSettings] = None,
        timeout: float = 10.0,
        transport: Optional[TransportCallable] = None,
        ssh_key_repo: Optional[SupabaseSSHKeyRepository] = None,
    ) -> None:
        self._settings = settings
        self.timeout = float(timeout)
        self._transport = transport or _default_pooled_http_transport
        self._ssh_key_repo = ssh_key_repo

    def _get_settings(self) -> SupabaseSettings:
        if self._settings is not None:
            return self._settings
        try:
            return get_supabase_settings()
        except SupabaseConfigurationError as cfg_err:
            logger.error(
                "Supabase notebook repository configuration invalid: %s",
                type(cfg_err).__name__,
            )
            raise SupabaseNotebookServiceUnavailableError(
                "Notebook database service is not configured."
            ) from cfg_err

    def _get_ssh_key_repository(self) -> SupabaseSSHKeyRepository:
        if self._ssh_key_repo is not None:
            return self._ssh_key_repo
        if self._settings is not None:
            return SupabaseSSHKeyRepository(
                settings=self._settings,
                timeout=self.timeout,
            )
        return get_ssh_key_repository()

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
        except (TimeoutError, socket.timeout, httpx2.TimeoutException) as timeout_err:
            elapsed_ms = max(0.0, (time.perf_counter() - started_at) * 1000.0)
            logger.error(
                "Supabase REST %s %s timed out after %.1fs (elapsed_ms=%.1f, error=%s).",
                safe_method,
                safe_resource,
                self.timeout,
                elapsed_ms,
                type(timeout_err).__name__,
            )
            raise SupabaseNotebookServiceUnavailableError(
                "Notebook database request timed out."
            ) from timeout_err
        except urllib.error.URLError as conn_err:
            elapsed_ms = max(0.0, (time.perf_counter() - started_at) * 1000.0)
            reason_name = (
                type(conn_err.reason).__name__
                if getattr(conn_err, "reason", None)
                else type(conn_err).__name__
            )
            logger.error(
                "Supabase REST %s %s connection error (%s, elapsed_ms=%.1f).",
                safe_method,
                safe_resource,
                reason_name,
                elapsed_ms,
            )
            raise SupabaseNotebookServiceUnavailableError(
                "Notebook database is temporarily unavailable."
            ) from conn_err
        except (
            httpx2.ProtocolError,
            httpx2.TransportError,
            httpx2.HTTPError,
            http.client.HTTPException,
        ) as proto_err:
            elapsed_ms = max(0.0, (time.perf_counter() - started_at) * 1000.0)
            logger.error(
                "Supabase REST %s %s transport error (%s, elapsed_ms=%.1f).",
                safe_method,
                safe_resource,
                type(proto_err).__name__,
                elapsed_ms,
            )
            raise SupabaseNotebookServiceUnavailableError(
                "Notebook database is temporarily unavailable."
            ) from proto_err
        except (OSError, ValueError) as net_err:
            elapsed_ms = max(0.0, (time.perf_counter() - started_at) * 1000.0)
            logger.error(
                "Supabase REST %s %s transport error (%s, elapsed_ms=%.1f).",
                safe_method,
                safe_resource,
                type(net_err).__name__,
                elapsed_ms,
            )
            raise SupabaseNotebookServiceUnavailableError(
                "Notebook database is temporarily unavailable."
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
            pg_code, _safe_msg, _safe_details = _extract_sanitized_supabase_error(
                status_code, resp_body
            )
            diag_label = _safe_upstream_diagnostic_label(status_code, resp_body)
            logger.error(
                "Supabase REST %s %s failed (status=%s, code=%s, diag=%s).",
                safe_method,
                safe_resource,
                status_code,
                pg_code,
                diag_label,
            )
            raise SupabaseNotebookServiceUnavailableError(
                "Notebook database returned an upstream error."
            )

        if status_code >= 400:
            pg_code, safe_msg, safe_details = _extract_sanitized_supabase_error(
                status_code, resp_body
            )
            logger.warning(
                "Supabase REST %s %s rejected (status=%s, code=%s).",
                safe_method,
                safe_resource,
                status_code,
                pg_code,
            )
            if pg_code == "23503":
                fk_context = f"{safe_msg} {safe_details}".lower()
                if "selected_ssh_key_id" in fk_context or "ssh_public_keys" in fk_context:
                    raise NotebookValidationError(
                        "Selected SSH key does not exist or does not belong to your account."
                    )
                if "notebook_sessions_user_id_fkey" in fk_context or (
                    "(user_id)" in fk_context and "profiles" in fk_context
                ):
                    raise SupabaseNotebookValidationError(
                        "Customer profile must be initialized before creating notebooks."
                    )
                if "deployment_id" in fk_context or "deployments" in fk_context:
                    raise SupabaseNotebookValidationError(
                        "Referenced deployment record does not exist."
                    )
                raise SupabaseNotebookValidationError(
                    "Notebook references a missing prerequisite record."
                )
            if pg_code == "23505" or status_code == 409:
                raise SupabaseNotebookError("Notebook record conflict detected.")
            if status_code in (401, 403):
                raise SupabaseNotebookServiceUnavailableError(
                    "Notebook database authentication failed."
                )
            if status_code == 400 or pg_code in ("22P02", "23502", "23514"):
                raise SupabaseNotebookValidationError("Invalid notebook request parameters.")
            raise SupabaseNotebookError("Notebook database rejected the request.")

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
            raise SupabaseNotebookServiceUnavailableError(
                "Received invalid response from notebook database."
            ) from json_err

    def validate_owned_ssh_key(
        self,
        user_id: str,
        selected_ssh_key_id: Union[str, uuid.UUID],
    ) -> SupabaseSSHKeyRecord:
        """
        Verify via `SupabaseSSHKeyRepository` that `selected_ssh_key_id` exists
        and belongs strictly to the authenticated Cognito user (`user_id`).
        """
        clean_user_id = _validate_user_id(user_id)
        ssh_key_uuid = _parse_ssh_key_uuid(selected_ssh_key_id)
        ssh_repo = self._get_ssh_key_repository()

        try:
            record = ssh_repo.get_ssh_key_by_id(user_id=clean_user_id, key_id=ssh_key_uuid)
        except (SSHKeyValidationError, SupabaseSSHKeyValidationError) as ve:
            raise NotebookValidationError(str(ve)) from ve
        except SupabaseSSHKeyServiceUnavailableError as sue:
            raise SupabaseNotebookServiceUnavailableError(
                "SSH key service is temporarily unavailable to validate selected SSH key."
            ) from sue
        except SupabaseSSHKeyError as se:
            raise SupabaseNotebookError(
                "Failed to validate selected SSH key against SSH key repository."
            ) from se

        if record is None or record.user_id != clean_user_id:
            raise NotebookValidationError(
                "Selected SSH key does not exist or does not belong to your account."
            )
        return record

    def _enrich_ssh_key_types(
        self,
        clean_user_id: str,
        records: List[SupabaseNotebookRecord],
    ) -> None:
        """Resolve `ssh_key_type` metadata for notebooks bound to an SSH key."""
        needed_ids = {r.selected_ssh_key_id for r in records if r.selected_ssh_key_id is not None}
        if not needed_ids:
            return

        ssh_repo = self._get_ssh_key_repository()
        key_type_map: Dict[uuid.UUID, str] = {}
        try:
            if len(needed_ids) == 1:
                only_id = next(iter(needed_ids))
                key_rec = ssh_repo.get_ssh_key_by_id(user_id=clean_user_id, key_id=only_id)
                if key_rec is not None and key_rec.user_id == clean_user_id:
                    key_type_map[key_rec.id] = key_rec.key_type
            else:
                for key_rec in ssh_repo.list_user_ssh_keys(user_id=clean_user_id):
                    if key_rec.user_id == clean_user_id:
                        key_type_map[key_rec.id] = key_rec.key_type
        except (SupabaseSSHKeyError, SSHKeyValidationError) as err:
            logger.warning(
                "Unable to enrich SSH key metadata for notebook response (%s).",
                type(err).__name__,
            )
            return

        for rec in records:
            if rec.selected_ssh_key_id is not None:
                rec.ssh_key_type = key_type_map.get(rec.selected_ssh_key_id)

    def create_notebook_session(
        self,
        *,
        user_id: str,
        name: str,
        gpu_profile: str,
        token_hash: str,
        status: str = "running",
        runtime_type: str = "simulated",
        runtime_reference: Optional[str] = None,
        selected_ssh_key_id: Optional[Union[str, uuid.UUID]] = None,
        validated_ssh_key: Optional[SupabaseSSHKeyRecord] = None,
        instance_id: Optional[uuid.UUID] = None,
        now: Optional[datetime] = None,
        bot_access_enabled: bool = False,
    ) -> SupabaseNotebookRecord:
        """
        Persist a new notebook session in Supabase `notebook_sessions` bound strictly
        to `user_id`, storing only the SHA-256 `token_hash`.
        """
        clean_user_id = _validate_user_id(user_id)
        if not isinstance(token_hash, str) or not SHA256_HEX_RE.fullmatch(token_hash.strip()):
            raise NotebookValidationError(
                "Notebook token hash must be a valid 64-character SHA-256 hex digest."
            )
        clean_hash = token_hash.strip().lower()

        try:
            normalized_status = normalize_notebook_status(status)
        except ValueError as err:
            raise NotebookValidationError("Unsupported initial notebook status.") from err

        resolved_ssh_key: Optional[SupabaseSSHKeyRecord] = validated_ssh_key
        resolved_ssh_key_id: Optional[uuid.UUID] = None
        if selected_ssh_key_id is not None:
            resolved_ssh_key_id = _parse_ssh_key_uuid(selected_ssh_key_id)
            if (
                resolved_ssh_key is None
                or resolved_ssh_key.id != resolved_ssh_key_id
                or resolved_ssh_key.user_id != clean_user_id
            ):
                resolved_ssh_key = self.validate_owned_ssh_key(
                    user_id=clean_user_id,
                    selected_ssh_key_id=resolved_ssh_key_id,
                )

        nb_uuid = instance_id or uuid.uuid4()
        ts = now or datetime.now(timezone.utc)
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        now_iso = ts.isoformat()

        clean_name = (
            name.strip()[:255]
            if isinstance(name, str) and name.strip()
            else "Untitled Notebook"
        )
        clean_gpu = (
            gpu_profile.strip()[:128]
            if isinstance(gpu_profile, str) and gpu_profile.strip()
            else "NVIDIA L4"
        )
        clean_runtime_type = (
            runtime_type.strip()[:64]
            if isinstance(runtime_type, str) and runtime_type.strip()
            else "simulated"
        )
        clean_runtime_ref = (
            runtime_reference.strip()[:255] or None
            if isinstance(runtime_reference, str)
            else None
        )

        payload: Dict[str, Any] = {
            "id": str(nb_uuid),
            "user_id": clean_user_id,
            "name": clean_name,
            "gpu_profile": clean_gpu,
            "status": normalized_status,
            "runtime_type": clean_runtime_type,
            "runtime_reference": clean_runtime_ref,
            "selected_ssh_key_id": str(resolved_ssh_key_id) if resolved_ssh_key_id else None,
            "token_hash": clean_hash,
            "bot_access_enabled": bool(bot_access_enabled),
            "created_at": now_iso,
            "updated_at": now_iso,
            "last_active_at": now_iso,
            "started_at": now_iso if normalized_status == "running" else None,
            "stopped_at": None,
        }

        data = self._request_json(
            "POST",
            "notebook_sessions",
            query_params={"select": NOTEBOOK_SESSIONS_COLUMNS},
            payload=payload,
            prefer="return=representation",
        )
        if not isinstance(data, list) or len(data) != 1:
            raise SupabaseNotebookServiceUnavailableError(
                "Unexpected response creating notebook session."
            )

        record = SupabaseNotebookRecord.from_row(
            data[0],
            ssh_key_type=resolved_ssh_key.key_type if resolved_ssh_key is not None else None,
        )
        if record.user_id != clean_user_id or record.id != nb_uuid:
            raise SupabaseNotebookServiceUnavailableError(
                "Created notebook ownership mismatch."
            )

        logger.info(
            "Notebook created in Supabase: id=%s gpu_profile=%s status=%s ssh_key_bound=%s",
            record.id,
            sanitize_diagnostic_text(record.gpu_profile, max_len=64),
            record.status,
            record.selected_ssh_key_id is not None,
        )
        return record

    def list_user_notebooks(
        self,
        user_id: str,
        include_terminated: bool = False,
    ) -> List[SupabaseNotebookRecord]:
        """
        List notebook sessions belonging strictly to `user_id`, ordered newest first.
        By default excludes `'terminated'` sessions.
        """
        clean_user_id = _validate_user_id(user_id)
        query_params: Dict[str, str] = {
            "select": NOTEBOOK_SESSIONS_COLUMNS,
            "user_id": f"eq.{clean_user_id}",
            "order": "created_at.desc",
        }
        if not include_terminated:
            query_params["status"] = "neq.terminated"

        data = self._request_json(
            "GET",
            "notebook_sessions",
            query_params=query_params,
        )
        if not isinstance(data, list):
            raise SupabaseNotebookServiceUnavailableError(
                "Unexpected list response from notebook database."
            )

        records = [
            SupabaseNotebookRecord.from_row(row)
            for row in data
        ]
        # Defense in depth when using service role key (bypasses RLS):
        owned = [
            r
            for r in records
            if r.user_id == clean_user_id and (include_terminated or r.status != "terminated")
        ]
        self._enrich_ssh_key_types(clean_user_id, owned)
        return owned

    def get_notebook_by_id(
        self,
        user_id: str,
        notebook_id: Union[str, uuid.UUID],
        resolve_ssh_key: bool = True,
    ) -> Optional[SupabaseNotebookRecord]:
        """
        Fetch a single notebook session by ID scoped strictly to `user_id`.
        Returns `None` if not found or owned by another user.
        """
        clean_user_id = _validate_user_id(user_id)
        nb_uuid = _parse_notebook_uuid(notebook_id)

        data = self._request_json(
            "GET",
            "notebook_sessions",
            query_params={
                "select": NOTEBOOK_SESSIONS_COLUMNS,
                "id": f"eq.{nb_uuid}",
                "user_id": f"eq.{clean_user_id}",
                "limit": "1",
            },
        )
        if not isinstance(data, list):
            raise SupabaseNotebookServiceUnavailableError(
                "Unexpected lookup response from notebook database."
            )
        if not data:
            return None

        record = SupabaseNotebookRecord.from_row(data[0])
        if record.user_id != clean_user_id or str(record.id) != nb_uuid:
            return None

        if resolve_ssh_key and record.selected_ssh_key_id is not None:
            self._enrich_ssh_key_types(clean_user_id, [record])
        return record

    def get_notebook(
        self,
        user_id: str,
        notebook_id: Union[str, uuid.UUID],
        resolve_ssh_key: bool = True,
    ) -> SupabaseNotebookRecord:
        """
        Retrieve a single notebook session by ID scoped to `user_id`, raising
        `NotebookNotFoundError` when missing or owned by another user.
        """
        record = self.get_notebook_by_id(
            user_id=user_id,
            notebook_id=notebook_id,
            resolve_ssh_key=resolve_ssh_key,
        )
        if record is None:
            nb_uuid = _parse_notebook_uuid(notebook_id)
            raise NotebookNotFoundError(f"Notebook '{nb_uuid}' not found.")
        return record

    def transition_notebook_status(
        self,
        *,
        user_id: str,
        notebook_id: Union[str, uuid.UUID],
        action: str,
        expected_status: str,
        new_status: str,
        now: Optional[datetime] = None,
        resolve_ssh_key: bool = True,
    ) -> SupabaseNotebookRecord:
        """
        Atomically transition a notebook session's lifecycle state in Supabase using
        conditional predicates (`id`, `user_id`, and prior `status` precondition) to
        prevent concurrent race conditions.
        """
        clean_user_id = _validate_user_id(user_id)
        nb_uuid = _parse_notebook_uuid(notebook_id)
        norm_expected = normalize_notebook_status(expected_status)
        norm_new = normalize_notebook_status(new_status)

        ts = now or datetime.now(timezone.utc)
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        now_iso = ts.isoformat()

        patch_payload: Dict[str, Any] = {
            "status": norm_new,
            "updated_at": now_iso,
        }
        if action == "start":
            patch_payload["last_active_at"] = now_iso
            patch_payload["started_at"] = now_iso
            patch_payload["stopped_at"] = None
        elif action in ("stop", "terminate"):
            patch_payload["stopped_at"] = now_iso

        status_filter = "neq.terminated" if action == "terminate" else f"eq.{norm_expected}"
        updated = self._request_json(
            "PATCH",
            "notebook_sessions",
            query_params={
                "id": f"eq.{nb_uuid}",
                "user_id": f"eq.{clean_user_id}",
                "status": status_filter,
                "select": NOTEBOOK_SESSIONS_COLUMNS,
            },
            payload=patch_payload,
            prefer="return=representation",
        )
        if not isinstance(updated, list):
            raise SupabaseNotebookServiceUnavailableError(
                "Unexpected response updating notebook state."
            )

        if len(updated) > 0:
            record = SupabaseNotebookRecord.from_row(updated[0])
            if record.user_id != clean_user_id or str(record.id) != nb_uuid:
                raise SupabaseNotebookServiceUnavailableError(
                    "Updated notebook ownership mismatch."
                )
            if resolve_ssh_key and record.selected_ssh_key_id is not None:
                self._enrich_ssh_key_types(clean_user_id, [record])
            logger.info(
                "Notebook transitioned: id=%s action=%s status=%s",
                record.id,
                action,
                record.status,
            )
            return record

        # Conditional update matched 0 rows: classify missing/cross-tenant vs concurrent conflict.
        current = self.get_notebook_by_id(
            user_id=clean_user_id,
            notebook_id=nb_uuid,
            resolve_ssh_key=False,
        )
        if current is None:
            raise NotebookNotFoundError(f"Notebook '{nb_uuid}' not found.")

        if action == "terminate" and current.status == "terminated":
            raise InvalidStateTransitionError("Notebook is already terminated.")
        if action == "start":
            if current.status == "running":
                raise InvalidStateTransitionError("Notebook is already running.")
            if current.status == "terminated":
                raise InvalidStateTransitionError("Cannot start a terminated notebook.")
        if action == "stop":
            if current.status == "stopped":
                raise InvalidStateTransitionError("Notebook is already stopped.")
            if current.status == "terminated":
                raise InvalidStateTransitionError("Cannot stop a terminated notebook.")

        raise InvalidStateTransitionError(
            f"Concurrent notebook state change detected; notebook is currently '{current.status}'."
        )


def get_notebook_repository() -> SupabaseNotebookRepository:
    """FastAPI dependency returning a configured Supabase notebook repository."""
    return SupabaseNotebookRepository()
