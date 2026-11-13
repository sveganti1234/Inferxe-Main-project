"""
supabase_ssh_keys.py
====================
Supabase REST API (PostgREST) repository for customer SSH Public Keys
(`ssh_public_keys`) in Inferxe.

Security & architectural guarantees:
- Reads `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` exclusively from `backend/.env`
  via `inference.supabase_config`.
- Because `SUPABASE_SERVICE_ROLE_KEY` bypasses Supabase Row Level Security (RLS),
  every query and mutation explicitly filters and validates ownership using the
  verified Cognito `sub` (`user_id`).
- Permanently deletes keys using HTTP `DELETE` from `ssh_public_keys` (no soft delete).
- Maps onto the live Supabase `ssh_public_keys` schema:
  `id`, `user_id`, `name`, `public_key`, `fingerprint`, `created_at`.
  (`key_type` is derived deterministically from `public_key` because the Supabase table
  does not include a separate `key_type` column.)
- Uses a thread-safe, pooled HTTP/1.1 `httpx2.Client` transport with explicit timeouts
  to avoid cold-connection TLS stalls while keeping secrets and full public keys out
  of server logs and error responses.
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
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional, Tuple, Union

import httpx2

from inference.ssh_key_service import (
    DuplicateSSHKeyError,
    SSHKeyValidationError,
    mask_public_key,
    validate_and_parse_ssh_public_key,
)
from inference.supabase_config import (
    SupabaseConfigurationError,
    SupabaseSettings,
    get_supabase_settings,
)

logger = logging.getLogger("inferxe.supabase_ssh_keys")

# Columns present in live Supabase `ssh_public_keys` (verified against PostgREST OpenAPI schema).
SSH_PUBLIC_KEYS_COLUMNS = "id,user_id,name,public_key,fingerprint,created_at"

SLOW_SUPABASE_REQUEST_MS = 1500.0
DEFAULT_CONNECT_TIMEOUT_SECONDS = 5.0
DEFAULT_MAX_CONNECTIONS = 20
DEFAULT_MAX_KEEPALIVE_CONNECTIONS = 10
DEFAULT_KEEPALIVE_EXPIRY_SECONDS = 20.0

TRUSTED_HTTP_METHODS = frozenset({"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"})
TRUSTED_SSH_KEY_RESOURCES = frozenset({"ssh_public_keys"})
_SAFE_ERROR_CODE_RE = re.compile(r"^[A-Za-z0-9_]{1,32}$")
_HEX_TOKEN_RE = re.compile(r"^[0-9a-fA-F]{32,}$")

_SENSITIVE_ERROR_PATTERNS = (
    re.compile(r"(?:https?|postgres(?:ql)?)://[^\s\"'<>]+", re.IGNORECASE),
    re.compile(r"\b(?:sb_secret|sbp|sb_publishable)_[A-Za-z0-9._-]+\b"),
    re.compile(r"\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9._-]+\.[A-Za-z0-9._-]+\b"),
    re.compile(r"\binf_(?:live|test)_[A-Za-z0-9_-]+\b"),
    re.compile(r"\bnvapi-[A-Za-z0-9._-]+\b"),
    re.compile(r"\b(?:Bearer|Basic)\s+[A-Za-z0-9+/=._-]+\b", re.IGNORECASE),
    re.compile(
        r"\b(?:apikey|api[-_]?key|secret[-_]?key|service[-_]?role[-_]?key|password|passwd|pwd)\s*[:=]\s*[^\s,;\"'<>]+",
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


class SupabaseSSHKeyError(RuntimeError):
    """Base error raised for sanitized Supabase SSH key repository failures."""


class SupabaseSSHKeyServiceUnavailableError(SupabaseSSHKeyError):
    """Raised when Supabase is unreachable, misconfigured, timed out, or returns 5xx."""


class SupabaseSSHKeyValidationError(SupabaseSSHKeyError):
    """Raised for invalid SSH key parameters or foreign-key precondition failures."""


def derive_ssh_key_type(public_key: Optional[str]) -> str:
    """
    Derive the canonical OpenSSH key algorithm identifier from `public_key`.
    Supabase `ssh_public_keys` does not store a `key_type` column, so the type is
    derived deterministically from the normalized OpenSSH public key prefix.
    """
    if not isinstance(public_key, str):
        return "unknown"
    parts = public_key.strip().split()
    if not parts:
        return "unknown"
    return parts[0].strip().lower() or "unknown"


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


def sanitize_diagnostic_text(text: Any, max_len: int = 240) -> str:
    """Scrub URLs, credentials, SSH keys, control characters, and UUIDs for safe diagnostics."""
    cleaned = re.sub(r"[\r\n\t]+", " ", str(text or "")).strip()
    for pattern in _SENSITIVE_ERROR_PATTERNS:
        cleaned = pattern.sub("[REDACTED]", cleaned)
    return cleaned[:max_len]


def _trusted_log_method(method: Any) -> str:
    candidate = method.strip().upper() if isinstance(method, str) else ""
    return candidate if candidate in TRUSTED_HTTP_METHODS else "UNKNOWN"


def _trusted_log_resource(resource: Any) -> str:
    candidate = resource.strip() if isinstance(resource, str) else ""
    return candidate if candidate in TRUSTED_SSH_KEY_RESOURCES else "unknown_resource"


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


def close_shared_ssh_keys_http_client() -> None:
    """Cleanly close the shared pooled HTTP client on process exit or shutdown."""
    global _SHARED_HTTP_CLIENT
    with _HTTP_CLIENT_LOCK:
        client = _SHARED_HTTP_CLIENT
        _SHARED_HTTP_CLIENT = None
    if client is not None and not client.is_closed:
        try:
            client.close()
        except Exception:
            pass


atexit.register(close_shared_ssh_keys_http_client)


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


@dataclass
class SupabaseSSHKeyRecord:
    """Normalized representation of a Supabase `ssh_public_keys` row."""

    id: uuid.UUID
    user_id: str
    name: str
    public_key: str = field(repr=False)
    fingerprint: str
    created_at: Optional[datetime] = None

    @property
    def key_type(self) -> str:
        return derive_ssh_key_type(self.public_key)

    def __repr__(self) -> str:
        return (
            f"SupabaseSSHKeyRecord(id={self.id!r}, key_type={self.key_type!r}, "
            f"fingerprint={self.fingerprint!r}, public_key={mask_public_key(self.public_key)!r})"
        )

    @classmethod
    def from_row(cls, row: Dict[str, Any]) -> "SupabaseSSHKeyRecord":
        if not isinstance(row, dict):
            raise SupabaseSSHKeyServiceUnavailableError(
                "Received malformed SSH key record from Supabase."
            )

        raw_id = row.get("id")
        if not isinstance(raw_id, (str, uuid.UUID)) or not str(raw_id).strip():
            raise SupabaseSSHKeyServiceUnavailableError(
                "Received malformed SSH key record from Supabase."
            )

        raw_user_id = row.get("user_id")
        if not isinstance(raw_user_id, str) or not raw_user_id.strip():
            raise SupabaseSSHKeyServiceUnavailableError(
                "Received malformed SSH key record from Supabase."
            )

        raw_public_key = row.get("public_key")
        if not isinstance(raw_public_key, str) or len(raw_public_key.strip().split()) < 2:
            raise SupabaseSSHKeyServiceUnavailableError(
                "Received malformed SSH key record from Supabase."
            )

        raw_fingerprint = row.get("fingerprint")
        if not isinstance(raw_fingerprint, str) or not raw_fingerprint.strip():
            raise SupabaseSSHKeyServiceUnavailableError(
                "Received malformed SSH key record from Supabase."
            )

        raw_name = row.get("name")
        if raw_name is not None and not isinstance(raw_name, str):
            raise SupabaseSSHKeyServiceUnavailableError(
                "Received malformed SSH key record from Supabase."
            )

        try:
            key_uuid = raw_id if isinstance(raw_id, uuid.UUID) else uuid.UUID(raw_id.strip())
            created_at = parse_supabase_timestamp(row.get("created_at"))
        except (ValueError, TypeError) as parse_err:
            logger.warning(
                "Malformed SSH key record received from Supabase (%s).",
                type(parse_err).__name__,
            )
            raise SupabaseSSHKeyServiceUnavailableError(
                "Received malformed SSH key record from Supabase."
            ) from parse_err

        clean_public_key = raw_public_key.strip()
        clean_name = (
            raw_name.strip()
            if isinstance(raw_name, str) and raw_name.strip()
            else f"SSH Key ({derive_ssh_key_type(clean_public_key)})"
        )

        return cls(
            id=key_uuid,
            user_id=raw_user_id.strip(),
            name=clean_name,
            public_key=clean_public_key,
            fingerprint=raw_fingerprint.strip(),
            created_at=created_at,
        )


def _validate_user_id(user_id: Any) -> str:
    if not isinstance(user_id, str):
        raise SSHKeyValidationError("User ID is required for tenant isolation.")
    clean = user_id.strip()
    if not clean or any(ch in clean for ch in ("\r", "\n", "\x00")):
        raise SSHKeyValidationError("User ID is required for tenant isolation.")
    return clean


def _parse_key_uuid(key_id: Any) -> str:
    if not isinstance(key_id, (str, uuid.UUID)):
        raise SupabaseSSHKeyValidationError("Invalid key ID format. Expected UUID.")
    if isinstance(key_id, uuid.UUID):
        return str(key_id)
    cleaned = key_id.strip()
    if not cleaned:
        raise SupabaseSSHKeyValidationError("Invalid key ID format. Expected UUID.")
    try:
        return str(uuid.UUID(cleaned))
    except (ValueError, TypeError) as uuid_err:
        raise SupabaseSSHKeyValidationError("Invalid key ID format. Expected UUID.") from uuid_err


class SupabaseSSHKeyRepository:
    """
    Repository encapsulating all PostgREST CRUD operations against the Supabase
    `ssh_public_keys` table with strict Cognito `user_id` isolation.
    """

    def __init__(
        self,
        settings: Optional[SupabaseSettings] = None,
        timeout: float = 10.0,
        transport: Optional[TransportCallable] = None,
    ) -> None:
        self._settings = settings
        self.timeout = float(timeout)
        self._transport = transport or _default_pooled_http_transport

    def _get_settings(self) -> SupabaseSettings:
        if self._settings is not None:
            return self._settings
        try:
            return get_supabase_settings()
        except SupabaseConfigurationError as cfg_err:
            logger.error(
                "Supabase SSH key repository configuration invalid: %s",
                type(cfg_err).__name__,
            )
            raise SupabaseSSHKeyServiceUnavailableError(
                "SSH key database service is not configured."
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
            raise SupabaseSSHKeyServiceUnavailableError(
                "SSH key database request timed out."
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
            raise SupabaseSSHKeyServiceUnavailableError(
                "SSH key database is temporarily unavailable."
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
            raise SupabaseSSHKeyServiceUnavailableError(
                "SSH key database is temporarily unavailable."
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
            raise SupabaseSSHKeyServiceUnavailableError(
                "SSH key database is temporarily unavailable."
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
            raise SupabaseSSHKeyServiceUnavailableError(
                "SSH key database returned an upstream error."
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
                if "ssh_public_keys_user_id_fkey" in fk_context or (
                    "(user_id)" in fk_context and "profiles" in fk_context
                ):
                    raise SupabaseSSHKeyValidationError(
                        "Customer profile must be initialized before registering SSH keys."
                    )
                if safe_method == "DELETE":
                    raise SupabaseSSHKeyValidationError(
                        "SSH key is currently referenced by another resource and cannot be deleted."
                    )
                raise SupabaseSSHKeyValidationError(
                    "SSH key references a missing prerequisite record."
                )
            if pg_code == "23505" or status_code == 409:
                raise DuplicateSSHKeyError(
                    "An SSH public key with this fingerprint is already registered in your account."
                )
            if status_code in (401, 403):
                raise SupabaseSSHKeyServiceUnavailableError(
                    "SSH key database authentication failed."
                )
            if status_code == 400 or pg_code in ("22P02", "23502", "23514"):
                raise SupabaseSSHKeyValidationError("Invalid SSH key request parameters.")
            raise SupabaseSSHKeyError("SSH key database rejected the request.")

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
            raise SupabaseSSHKeyServiceUnavailableError(
                "Received invalid response from SSH key database."
            ) from json_err

    def check_duplicate_ssh_key(self, user_id: str, fingerprint: str) -> None:
        """
        Check if an SSH key with the given OpenSSH SHA-256 fingerprint already exists
        for this customer in Supabase `ssh_public_keys`.
        """
        clean_user_id = _validate_user_id(user_id)
        rows = self._request_json(
            "GET",
            "ssh_public_keys",
            query_params={
                "select": SSH_PUBLIC_KEYS_COLUMNS,
                "user_id": f"eq.{clean_user_id}",
                "fingerprint": f"eq.{fingerprint}",
                "limit": "1",
            },
        )
        if not isinstance(rows, list):
            raise SupabaseSSHKeyServiceUnavailableError(
                "Unexpected duplicate check response from SSH key database."
            )
        if rows:
            existing = SupabaseSSHKeyRecord.from_row(rows[0])
            if existing.user_id == clean_user_id:
                logger.info(
                    "Duplicate SSH key rejected for existing key_id=%s fingerprint=%s.",
                    existing.id,
                    fingerprint,
                )
                raise DuplicateSSHKeyError(
                    f"An SSH public key with fingerprint '{fingerprint}' already exists in your account (labeled '{existing.name}')."
                )

    def create_ssh_key(
        self,
        user_id: str,
        name: Optional[str],
        raw_public_key: str,
    ) -> SupabaseSSHKeyRecord:
        """
        Cryptographically validate, duplicate-check, and persist a new customer
        SSH public key in Supabase `ssh_public_keys`.
        """
        clean_user_id = _validate_user_id(user_id)
        parsed = validate_and_parse_ssh_public_key(raw_public_key)
        fingerprint = parsed["fingerprint"]
        key_type = parsed["key_type"]
        public_key = parsed["public_key"]

        self.check_duplicate_ssh_key(user_id=clean_user_id, fingerprint=fingerprint)

        clean_name = (
            name.strip()
            if isinstance(name, str) and name.strip()
            else (parsed.get("comment") or f"SSH Key ({key_type})")
        )[:255]

        key_uuid = uuid.uuid4()
        now_utc = datetime.now(timezone.utc)
        payload = {
            "id": str(key_uuid),
            "user_id": clean_user_id,
            "name": clean_name,
            "public_key": public_key,
            "fingerprint": fingerprint,
            "created_at": now_utc.isoformat(),
        }

        try:
            data = self._request_json(
                "POST",
                "ssh_public_keys",
                query_params={"select": SSH_PUBLIC_KEYS_COLUMNS},
                payload=payload,
                prefer="return=representation",
            )
        except DuplicateSSHKeyError as dup_err:
            raise DuplicateSSHKeyError(
                f"An SSH public key with fingerprint '{fingerprint}' already exists in your account."
            ) from dup_err

        if not isinstance(data, list) or len(data) != 1:
            raise SupabaseSSHKeyServiceUnavailableError(
                "Unexpected response creating SSH key."
            )

        record = SupabaseSSHKeyRecord.from_row(data[0])
        if record.user_id != clean_user_id or record.id != key_uuid:
            raise SupabaseSSHKeyServiceUnavailableError(
                "Created SSH key ownership mismatch."
            )

        logger.info(
            "SSH key registered: id=%s key_type=%s fingerprint=%s (masked: %s)",
            record.id,
            record.key_type,
            record.fingerprint,
            mask_public_key(record.public_key),
        )
        return record

    def list_user_ssh_keys(self, user_id: str) -> List[SupabaseSSHKeyRecord]:
        """
        List all SSH keys belonging strictly to the authenticated customer (`user_id`),
        ordered newest first.
        """
        clean_user_id = _validate_user_id(user_id)
        data = self._request_json(
            "GET",
            "ssh_public_keys",
            query_params={
                "select": SSH_PUBLIC_KEYS_COLUMNS,
                "user_id": f"eq.{clean_user_id}",
                "order": "created_at.desc",
            },
        )
        if not isinstance(data, list):
            raise SupabaseSSHKeyServiceUnavailableError(
                "Unexpected list response from SSH key database."
            )

        records = [SupabaseSSHKeyRecord.from_row(row) for row in data]
        return [r for r in records if r.user_id == clean_user_id]

    def get_ssh_key_by_id(
        self,
        user_id: str,
        key_id: Union[str, uuid.UUID],
    ) -> Optional[SupabaseSSHKeyRecord]:
        """
        Fetch a single SSH key by ID scoped strictly to `user_id`.
        Returns `None` if not found or owned by a different customer.
        """
        clean_user_id = _validate_user_id(user_id)
        key_uuid = _parse_key_uuid(key_id)

        data = self._request_json(
            "GET",
            "ssh_public_keys",
            query_params={
                "select": SSH_PUBLIC_KEYS_COLUMNS,
                "id": f"eq.{key_uuid}",
                "user_id": f"eq.{clean_user_id}",
                "limit": "1",
            },
        )
        if not isinstance(data, list):
            raise SupabaseSSHKeyServiceUnavailableError(
                "Unexpected lookup response from SSH key database."
            )
        if not data:
            return None

        record = SupabaseSSHKeyRecord.from_row(data[0])
        if record.user_id != clean_user_id or str(record.id) != key_uuid:
            return None
        return record

    def delete_ssh_key(
        self,
        user_id: str,
        key_id: Union[str, uuid.UUID],
    ) -> bool:
        """
        Permanently delete an SSH key owned by `user_id` from Supabase `ssh_public_keys`.
        Returns True if a row owned by `user_id` was deleted, False if not found or cross-user.
        """
        clean_user_id = _validate_user_id(user_id)
        key_uuid = _parse_key_uuid(key_id)

        deleted = self._request_json(
            "DELETE",
            "ssh_public_keys",
            query_params={
                "id": f"eq.{key_uuid}",
                "user_id": f"eq.{clean_user_id}",
                "select": SSH_PUBLIC_KEYS_COLUMNS,
            },
            prefer="return=representation",
        )
        if deleted is None:
            return False
        if not isinstance(deleted, list):
            raise SupabaseSSHKeyServiceUnavailableError(
                "Unexpected response deleting SSH key."
            )
        if not deleted:
            return False

        record = SupabaseSSHKeyRecord.from_row(deleted[0])
        if record.user_id != clean_user_id or str(record.id) != key_uuid:
            raise SupabaseSSHKeyServiceUnavailableError(
                "Deleted SSH key ownership mismatch."
            )

        logger.info(
            "SSH key permanently deleted: id=%s fingerprint=%s",
            record.id,
            record.fingerprint,
        )
        return True

    def get_user_authorized_keys(self, user_id: str) -> List[str]:
        """
        Return ordered raw OpenSSH public key strings owned by `user_id` for compute/notebook
        `~/.ssh/authorized_keys` injection.
        """
        clean_user_id = _validate_user_id(user_id)
        data = self._request_json(
            "GET",
            "ssh_public_keys",
            query_params={
                "select": SSH_PUBLIC_KEYS_COLUMNS,
                "user_id": f"eq.{clean_user_id}",
                "order": "created_at.asc",
            },
        )
        if not isinstance(data, list):
            raise SupabaseSSHKeyServiceUnavailableError(
                "Unexpected response listing authorized SSH keys."
            )

        records = [SupabaseSSHKeyRecord.from_row(row) for row in data]
        return [r.public_key for r in records if r.user_id == clean_user_id and r.public_key]


def get_ssh_key_repository() -> SupabaseSSHKeyRepository:
    """FastAPI dependency returning a configured Supabase SSH key repository."""
    return SupabaseSSHKeyRepository()
