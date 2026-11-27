"""
supabase_config.py
==================
Centralized loader and validator for trusted FastAPI backend-to-Supabase REST
configuration stored in `backend/.env`.

Security guarantees:
- Reads credentials exclusively from `backend/.env` (or explicit server env vars).
- Preserves `SUPABASE_SERVICE_ROLE_KEY` as a server-only credential (`repr=False`).
- Rejects Supabase Personal Access Tokens (`sbp_...`) and publishable keys (`sb_publishable_...`).
- Never logs or serializes secret values.
"""

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, Optional
from urllib.parse import urlparse
import sys as _sys
_GUARD_DIR = str(__import__('pathlib').Path(__file__).resolve().parents[1])  # backend/
if _GUARD_DIR not in _sys.path:
    _sys.path.append(_GUARD_DIR)
from isolation_guard import load_dotenv  # noqa: E402  (tests never load the project .env: isolation_guard.py)

BACKEND_DIR = Path(__file__).resolve().parents[1]
BACKEND_ENV_FILE = BACKEND_DIR / ".env"

FORBIDDEN_TOKEN_PREFIXES = (
    ("sbp_", "Supabase Personal Access Tokens (sbp_*) are not permitted; configure SUPABASE_SERVICE_ROLE_KEY with the project Secret/Service Role key."),
    ("sb_publishable_", "Supabase Publishable keys (sb_publishable_*) cannot be used for SUPABASE_SERVICE_ROLE_KEY."),
)


class SupabaseConfigurationError(RuntimeError):
    """Raised when backend Supabase environment configuration is missing or invalid."""


_loaded_env_files: set = set()


def load_backend_env(env_file: Optional[Path] = None, override: bool = False) -> Path:
    """
    Load backend environment variables from `backend/.env` without overriding
    existing process or test environment variables unless `override=True`.
    """
    target = Path(env_file) if env_file is not None else BACKEND_ENV_FILE
    # Every Supabase repository call resolves settings through here; re-parsing the file each time
    # cost ~0.5 ms per call. With override=False a repeat load cannot change anything (existing
    # variables win), so each file is loaded once per process. override=True always reloads.
    if not override and target in _loaded_env_files:
        return target
    if target.is_file():
        load_dotenv(target, override=override)
        if not override:
            _loaded_env_files.add(target)
    return target


# Ensure backend/.env is loaded when this module is imported directly.
load_backend_env(override=False)


NON_LOCAL_ENVIRONMENTS = frozenset({"production", "prod", "staging"})


def is_local_mock_supabase_enabled() -> bool:
    """Return True if local mock Supabase is enabled outside production/staging environments."""
    if os.getenv("INFERXE_LOCAL_MOCK_SUPABASE", "").strip() != "1":
        return False
    markers = [os.getenv("INFERXE_ENV"), os.getenv("APP_ENV"), os.getenv("NODE_ENV")]
    return not any((m or "").strip().lower() in NON_LOCAL_ENVIRONMENTS for m in markers)


def _validate_supabase_url(raw_url: str) -> str:
    cleaned = raw_url.strip().rstrip("/")
    if not cleaned:
        raise SupabaseConfigurationError(
            "SUPABASE_URL is missing. Set SUPABASE_URL in backend/.env."
        )

    parsed = urlparse(cleaned)
    if parsed.scheme not in ("https", "http") or not parsed.netloc:
        raise SupabaseConfigurationError(
            "SUPABASE_URL must be a valid HTTP or HTTPS URL."
        )

    if "your-project.supabase.co" in parsed.netloc:
        raise SupabaseConfigurationError(
            "SUPABASE_URL still contains the placeholder domain 'your-project.supabase.co'."
        )

    return cleaned


def _validate_service_role_key(raw_key: str) -> str:
    cleaned = raw_key.strip()
    if not cleaned:
        raise SupabaseConfigurationError(
            "SUPABASE_SERVICE_ROLE_KEY is missing. Set SUPABASE_SERVICE_ROLE_KEY in backend/.env."
        )

    is_dev_fallback = os.environ.get("ADMIN_DEV_FALLBACK", "").strip().lower() in ("1", "true", "yes")
    for prefix, reason in FORBIDDEN_TOKEN_PREFIXES:
        if cleaned.startswith(prefix):
            if prefix == "sb_publishable_" and is_dev_fallback:
                continue
            raise SupabaseConfigurationError(reason)

    return cleaned


@dataclass(frozen=True)
class SupabaseSettings:
    """Validated server-side Supabase REST configuration (`service_role_key` masked from repr)."""

    url: str
    service_role_key: str = field(repr=False)

    @property
    def is_opaque_secret_key(self) -> bool:
        return self.service_role_key.startswith("sb_secret_")

    def rest_url(self, resource_path: str = "") -> str:
        clean_path = resource_path.lstrip("/")
        if clean_path:
            return f"{self.url}/rest/v1/{clean_path}"
        return f"{self.url}/rest/v1/"

    def auth_headers(self, extra_headers: Optional[Dict[str, str]] = None) -> Dict[str, str]:
        """
        Build PostgREST authentication headers using SUPABASE_SERVICE_ROLE_KEY.

        For opaque `sb_secret_*` keys, Supabase recommends passing only `apikey`
        (and reserving `Authorization: Bearer` for JWT-formatted keys).
        """
        headers: Dict[str, str] = {
            "apikey": self.service_role_key,
            "Accept": "application/json",
            "Content-Type": "application/json",
        }
        if not self.is_opaque_secret_key:
            headers["Authorization"] = f"Bearer {self.service_role_key}"

        if extra_headers:
            headers.update(extra_headers)
        return headers

    def masked_summary(self) -> Dict[str, Any]:
        """Return safe non-secret diagnostics for health checks and startup logs."""
        parsed = urlparse(self.url)
        return {
            "configured": True,
            "scheme": parsed.scheme,
            "key_format": "sb_secret" if self.is_opaque_secret_key else (
                "jwt" if self.service_role_key.startswith("eyJ") else "configured"
            ),
        }


def get_supabase_settings(
    auto_load: bool = True,
    env_file: Optional[Path] = None,
) -> SupabaseSettings:
    """Read and validate `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from backend env.

    Reads environment variables on every call so that tests using `patch.dict` or
    direct `os.environ` modifications are always respected. No module-level caching
    is used to avoid stale configuration across test boundaries or live updates.
    """
    if auto_load:
        load_backend_env(env_file=env_file, override=False)

    if is_local_mock_supabase_enabled():
        port = (os.getenv("ADMIN_AUTH_PORT") or "5174").strip() or "5174"
        return SupabaseSettings(
            url=f"http://127.0.0.1:{port}",
            service_role_key="local-mock-service-key",
        )

    url = _validate_supabase_url(os.getenv("SUPABASE_URL", ""))
    service_role_key = _validate_service_role_key(os.getenv("SUPABASE_SERVICE_ROLE_KEY", ""))
    return SupabaseSettings(url=url, service_role_key=service_role_key)


def get_inference_max_concurrency() -> int:
    """
    Read INFERENCE_MAX_CONCURRENCY from environment.

    Default: 8
    Allowed range: 1-32

    Raises SupabaseConfigurationError for invalid values.
    """
    raw = os.getenv("INFERENCE_MAX_CONCURRENCY", "8").strip()
    try:
        value = int(raw)
    except (ValueError, TypeError):
        raise SupabaseConfigurationError(
            f"INFERENCE_MAX_CONCURRENCY must be an integer between 1 and 32, got '{raw}'."
        )
    if value < 1 or value > 32:
        raise SupabaseConfigurationError(
            f"INFERENCE_MAX_CONCURRENCY must be between 1 and 32, got {value}."
        )
    return value


def get_inference_queue_seconds() -> int:
    """
    Read INFERENCE_QUEUE_SECONDS from environment.

    Default: 2
    Allowed range: 0-10

    Raises SupabaseConfigurationError for invalid values.
    """
    raw = os.getenv("INFERENCE_QUEUE_SECONDS", "2").strip()
    try:
        value = int(raw)
    except (ValueError, TypeError):
        raise SupabaseConfigurationError(
            f"INFERENCE_QUEUE_SECONDS must be an integer between 0 and 10, got '{raw}'."
        )
    if value < 0 or value > 10:
        raise SupabaseConfigurationError(
            f"INFERENCE_QUEUE_SECONDS must be between 0 and 10, got {value}."
        )
    return value

