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
from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parents[1]
BACKEND_ENV_FILE = BACKEND_DIR / ".env"

FORBIDDEN_TOKEN_PREFIXES = (
    ("sbp_", "Supabase Personal Access Tokens (sbp_*) are not permitted; configure SUPABASE_SERVICE_ROLE_KEY with the project Secret/Service Role key."),
    ("sb_publishable_", "Supabase Publishable keys (sb_publishable_*) cannot be used for SUPABASE_SERVICE_ROLE_KEY."),
)


class SupabaseConfigurationError(RuntimeError):
    """Raised when backend Supabase environment configuration is missing or invalid."""


def load_backend_env(env_file: Optional[Path] = None, override: bool = False) -> Path:
    """
    Load backend environment variables from `backend/.env` without overriding
    existing process or test environment variables unless `override=True`.
    """
    target = Path(env_file) if env_file is not None else BACKEND_ENV_FILE
    if target.is_file():
        load_dotenv(target, override=override)
    return target


# Ensure backend/.env is loaded when this module is imported directly.
load_backend_env(override=False)


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

    for prefix, reason in FORBIDDEN_TOKEN_PREFIXES:
        if cleaned.startswith(prefix):
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
    """Read and validate `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from backend env."""
    if auto_load:
        load_backend_env(env_file=env_file, override=False)

    url = _validate_supabase_url(os.getenv("SUPABASE_URL", ""))
    service_role_key = _validate_service_role_key(os.getenv("SUPABASE_SERVICE_ROLE_KEY", ""))
    return SupabaseSettings(url=url, service_role_key=service_role_key)
