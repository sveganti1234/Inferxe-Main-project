"""
notebook_access.py
==================
Secure access to GPU notebooks through the Inferxe notebook proxy (no FastAPI imports; pure logic).

Two credentials keep customers away from JupyterLab's own token:
  * Internal JupyterLab token: HMAC(NOTEBOOK_PROXY_SECRET, deployment id), set as JUPYTER_TOKEN at launch.
    Never stored, never returned; the proxy recomputes it to talk to JupyterLab.
  * Customer access: a short-lived single-use ticket minted for the Cognito-authenticated owner (the console's
    Open button), or the customer's rotatable notebook token (only its SHA-256 is stored). Either one buys a
    signed, notebook-scoped proxy session cookie that is bound to the current token hash, so rotating the token
    invalidates every outstanding ticket and session at once.

Configuration (environment, read at call time so a dev URL can later be swapped for a dedicated notebook domain):
  NOTEBOOK_PROXY_SECRET    >= 32 characters. Without it GPU notebooks cannot be launched or opened.
  NOTEBOOK_PROXY_BASE_URL  Public origin that serves /nb/... through this backend, e.g. the backend's HTTPS URL
                           today, a dedicated notebook domain later. https required (http only for localhost).
                           Without it notebooks run but no customer URL is issued.
"""

import base64
import hashlib
import hmac
import json
import os
import secrets
import threading
import time
import urllib.parse
import uuid
from dataclasses import dataclass
from typing import Any, Dict, Mapping, Optional, Union

NOTEBOOK_PROXY_SECRET_ENV = "NOTEBOOK_PROXY_SECRET"
NOTEBOOK_PROXY_BASE_URL_ENV = "NOTEBOOK_PROXY_BASE_URL"
MIN_SECRET_LENGTH = 32
PROXY_PREFIX = "/nb"
SESSION_COOKIE = "ixnb_session"
SESSION_TTL_SECONDS = 8 * 3600
TICKET_TTL_SECONDS = 60
_LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}


class NotebookAccessNotConfiguredError(Exception):
    """Notebook access (proxy secret / public URL) is not configured on this server."""


@dataclass(frozen=True)
class AccessConfig:
    secret: bytes
    base_url: Optional[str]  # scheme://host[:port], no trailing slash; None = no customer URL yet

    @property
    def secure_cookies(self) -> bool:
        return bool(self.base_url and self.base_url.startswith("https://"))


def _clean_base_url(raw: Optional[str]) -> Optional[str]:
    if not raw or not raw.strip():
        return None
    parsed = urllib.parse.urlsplit(raw.strip())
    if parsed.path not in ("", "/") or parsed.query or parsed.fragment or parsed.username or not parsed.hostname:
        return None
    if parsed.scheme == "https" or (parsed.scheme == "http" and parsed.hostname in _LOCAL_HOSTS):
        return f"{parsed.scheme}://{parsed.netloc}"
    return None


def load_access_config(env: Optional[Mapping[str, str]] = None) -> Optional[AccessConfig]:
    """The configured access settings, or None when no usable secret is set (GPU notebooks are then refused)."""
    source = os.environ if env is None else env
    secret = (source.get(NOTEBOOK_PROXY_SECRET_ENV) or "").strip()
    if len(secret) < MIN_SECRET_LENGTH:
        return None
    return AccessConfig(secret=secret.encode("utf-8"), base_url=_clean_base_url(source.get(NOTEBOOK_PROXY_BASE_URL_ENV)))


def require_access_config(config: Optional[AccessConfig] = None) -> AccessConfig:
    active = config or load_access_config()
    if active is None:
        raise NotebookAccessNotConfiguredError(
            f"Notebook access is not configured on this server ({NOTEBOOK_PROXY_SECRET_ENV} is missing).")
    return active


def _mac(secret: bytes, *parts: str) -> bytes:
    return hmac.new(secret, "\x1f".join(parts).encode("utf-8"), hashlib.sha256).digest()


def internal_jupyter_token(config: AccessConfig, deployment_id: Union[str, uuid.UUID]) -> str:
    return _mac(config.secret, "jupyter-token", str(uuid.UUID(str(deployment_id)))).hex()


def notebook_path(notebook_id: Union[str, uuid.UUID]) -> str:
    """Path JupyterLab is served under (its --ServerApp.base_url) and the proxy route prefix for the notebook."""
    return f"{PROXY_PREFIX}/{uuid.UUID(str(notebook_id))}/"


def public_notebook_url(config: Optional[AccessConfig], notebook_id: Union[str, uuid.UUID]) -> Optional[str]:
    if config is None or not config.base_url:
        return None
    return f"{config.base_url}{notebook_path(notebook_id)}"


def token_fingerprint(config: AccessConfig, token_hash: str) -> str:
    """Binds tickets/sessions to the current token hash without revealing it."""
    return base64.urlsafe_b64encode(_mac(config.secret, "token-fp", token_hash)[:12]).decode().rstrip("=")


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def sign(config: AccessConfig, purpose: str, claims: Dict[str, Any]) -> str:
    payload = _b64(json.dumps(claims, separators=(",", ":"), sort_keys=True).encode())
    return f"{payload}.{_b64(_mac(config.secret, purpose, payload))}"


def verify(config: AccessConfig, purpose: str, value: Optional[str], now: Optional[float] = None) -> Optional[Dict[str, Any]]:
    """Claims of a value signed for `purpose`, or None when forged, malformed, for another purpose or expired."""
    if not value or value.count(".") != 1 or len(value) > 2048:
        return None
    payload, signature = value.split(".")
    try:
        if not hmac.compare_digest(_unb64(signature), _mac(config.secret, purpose, payload)):
            return None
        claims = json.loads(_unb64(payload))
    except (ValueError, TypeError):
        return None
    if not isinstance(claims, dict) or not isinstance(claims.get("exp"), (int, float)):
        return None
    return claims if claims["exp"] > (time.time() if now is None else now) else None


def new_ticket(config: AccessConfig, notebook_id: str, user_id: str, token_hash: str, now: Optional[float] = None) -> str:
    issued = time.time() if now is None else now
    return sign(config, "ticket", {
        "nb": str(notebook_id), "uid": user_id, "fp": token_fingerprint(config, token_hash),
        "exp": int(issued + TICKET_TTL_SECONDS), "n": secrets.token_urlsafe(12),
    })


def new_session(config: AccessConfig, notebook_id: str, token_hash: str, now: Optional[float] = None) -> str:
    issued = time.time() if now is None else now
    return sign(config, "session", {
        "nb": str(notebook_id), "fp": token_fingerprint(config, token_hash), "exp": int(issued + SESSION_TTL_SECONDS),
    })


def ticket_url(config: AccessConfig, notebook_id: str, ticket: str) -> str:
    # The ticket rides in the fragment: browsers never send it to servers, so it stays out of access logs.
    return f"{config.base_url}{notebook_path(notebook_id)}_inferxe/enter#ticket={ticket}"


class UsedTickets:
    """Single-use enforcement for tickets.

    shortcut: in-process memory, correct only while one backend instance serves /nb (the Render setup today);
    move to a shared store before running several instances."""

    def __init__(self):
        self._used: Dict[str, float] = {}
        self._lock = threading.Lock()

    def claim(self, nonce: str, expires_at: float, now: Optional[float] = None) -> bool:
        current = time.time() if now is None else now
        with self._lock:
            for key in [k for k, exp in self._used.items() if exp <= current]:
                del self._used[key]
            if nonce in self._used:
                return False
            self._used[nonce] = expires_at
            return True


used_tickets = UsedTickets()
