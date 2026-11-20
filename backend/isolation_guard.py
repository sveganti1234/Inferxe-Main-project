"""
Test isolation guard for the Python backend (one implementation, used by pytest and by every service module).

Service modules load backend/.env through `load_dotenv` from this module (same signature as python-dotenv's).
In a normal process it is exactly python-dotenv's load_dotenv. In a test process (pytest, unittest, or a test
script run directly) it never loads the project .env files and installs the guard below, so protection does not
depend on which runner started the tests.

Guard (installed once per process):
  * Production credentials never enter the process: Supabase/database settings are cleared before any service
    module could read them, and the project .env files are not loaded.
  * Outbound network is limited to loopback. Live integration mode (INFERXE_LIVE_SUPABASE_TESTS=1) additionally
    allows exactly one Supabase host, named explicitly in INFERXE_LIVE_SUPABASE_URL, and only after checking that
    it is not the production project configured in backend/.env (nor listed in INFERXE_PRODUCTION_SUPABASE_HOSTS).
    Everything else (production, Cognito/AWS, NVIDIA, ...) stays blocked in live mode too.
  * Messages name variables and host categories only; never URLs, hosts, keys or connection strings.
"""

import ipaddress
import os
import socket
import sys
from pathlib import Path
from typing import List, Optional, Tuple
from urllib.parse import urlsplit

from dotenv import dotenv_values
from dotenv import load_dotenv as _dotenv_load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent
ROOT_DIR = BACKEND_DIR.parent
PROJECT_ENV_FILES = (BACKEND_DIR / ".env", ROOT_DIR / ".env")

LIVE_FLAG = "INFERXE_LIVE_SUPABASE_TESTS"
LIVE_URL_VAR = "INFERXE_LIVE_SUPABASE_URL"
LIVE_KEY_VAR = "INFERXE_LIVE_SUPABASE_SERVICE_ROLE_KEY"
PRODUCTION_HOSTS_VAR = "INFERXE_PRODUCTION_SUPABASE_HOSTS"

CREDENTIAL_VARS = (
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_SECRET_KEY",
    "SUPABASE_ANON_KEY",
    "SUPABASE_DATABASE_URL",
    "NOTIFICATIONS_DATABASE_URL",
    "DATABASE_URL",
)

_STATE_ATTR = "_inferxe_isolation_guard"  # stored on the socket module: one guard even if imported twice
blocked: List[Tuple[str, str, str]] = []  # (test id, kind, host category)


class IsolationError(RuntimeError):
    """Live-mode or credential safety check failed (raised before any network I/O)."""


class NetworkBlockedError(ConnectionRefusedError):
    """Raised instead of opening a disallowed outbound connection during tests."""


# ── Classification (safe to print) ────────────────────────────────────────────────────────────────

def is_loopback(host) -> bool:
    host = str(host or "").strip("[]").lower()
    if host == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def classify_host(host) -> str:
    """Category of a host for messages: never the host itself."""
    h = str(host or "").strip("[]").lower()
    if is_loopback(h):
        return "loopback"
    try:
        ip = ipaddress.ip_address(h)
        return "private network" if ip.is_private else "external IP address"
    except ValueError:
        pass
    if h.endswith(".supabase.co") or h.endswith(".supabase.com") or "supabase" in h:
        return "supabase project"
    if h.endswith(".amazonaws.com") or "cognito" in h:
        return "aws/cognito"
    if "nvidia" in h:
        return "nvidia api"
    return "external host"


def _host_of(url: str) -> str:
    try:
        return (urlsplit(str(url)).hostname or "").lower()
    except ValueError:
        return ""


# ── Test-process detection ────────────────────────────────────────────────────────────────────────

def is_test_process() -> bool:
    """pytest, unittest (incl. IDE runners), or a test_*.py / *_test.py script run directly."""
    if "pytest" in sys.modules or os.environ.get("PYTEST_CURRENT_TEST"):
        return True
    entry = Path(sys.argv[0]) if sys.argv and sys.argv[0] else None
    if entry is None:
        return False
    name = entry.name.lower()
    if name.startswith("test_") and name.endswith(".py") or name.endswith("_test.py"):
        return True
    parts = [p.lower() for p in entry.parts]
    return any(p in ("unittest", "pytest", "_pytest") for p in parts) or "unittest" in name


def live_mode() -> bool:
    return os.environ.get(LIVE_FLAG) == "1"


# ── Live-mode target validation ───────────────────────────────────────────────────────────────────

def _production_targets() -> Tuple[set, set]:
    """Hosts and keys of the production project (from the project .env files, read without exporting)."""
    hosts, keys = set(), set()
    for env_file in PROJECT_ENV_FILES:
        try:
            values = dotenv_values(env_file) if env_file.is_file() else {}
        except Exception:
            values = {}
        if values.get("SUPABASE_URL"):
            hosts.add(_host_of(values["SUPABASE_URL"]))
        for key_name in ("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY"):
            if values.get(key_name):
                keys.add(values[key_name].strip())
    for extra in (os.environ.get(PRODUCTION_HOSTS_VAR) or "").split(","):
        if extra.strip():
            hosts.add(extra.strip().lower())
    hosts.discard("")
    return hosts, keys


def validate_live_target() -> str:
    """Return the allowed live Supabase host, or raise IsolationError. Never reveals the values."""
    url = (os.environ.get(LIVE_URL_VAR) or "").strip()
    key = (os.environ.get(LIVE_KEY_VAR) or "").strip()
    if not url or not key:
        raise IsolationError(
            f"[test-safety] live mode ({LIVE_FLAG}=1) requires {LIVE_URL_VAR} and {LIVE_KEY_VAR} for a dedicated "
            "non-production Supabase project; the project .env files are never used by tests."
        )
    host = _host_of(url)
    if not host:
        raise IsolationError(f"[test-safety] {LIVE_URL_VAR} is not a valid URL.")
    prod_hosts, prod_keys = _production_targets()
    if host in prod_hosts or key in prod_keys:
        raise IsolationError(
            f"[test-safety] {LIVE_URL_VAR}/{LIVE_KEY_VAR} identify the production Supabase project "
            "(matches backend/.env or " + PRODUCTION_HOSTS_VAR + "); refusing to run live tests against it."
        )
    return host


# ── Guard installation ────────────────────────────────────────────────────────────────────────────

def _record(host, kind) -> NetworkBlockedError:
    test_id = (os.environ.get("PYTEST_CURRENT_TEST") or (sys.argv[0] if sys.argv else "") or "test").split(" ")[0]
    category = classify_host(host)
    blocked.append((test_id, kind, category))
    return NetworkBlockedError(
        f"[test-safety] blocked {kind} during tests ({category}). Mock the service or use a local test "
        f"instance; live integration tests need {LIVE_FLAG}=1 with {LIVE_URL_VAR}."
    )


def install_guard() -> dict:
    """Idempotent. Returns the guard state. Raises IsolationError for unsafe configurations."""
    state = getattr(socket, _STATE_ATTR, None)
    if state is not None:
        return state

    allowed_hosts = set()
    if live_mode():
        allowed_hosts.add(validate_live_target())
        live_url = os.environ[LIVE_URL_VAR].strip()
        live_key = os.environ[LIVE_KEY_VAR].strip()
    else:
        shell_url = os.environ.get("SUPABASE_URL", "")
        if shell_url and not is_loopback(_host_of(shell_url)):
            raise IsolationError(
                "[test-safety] SUPABASE_URL in the environment is not loopback "
                f"({classify_host(_host_of(shell_url))}). Unset it before running tests."
            )

    for name in CREDENTIAL_VARS:
        os.environ[name] = ""
    if live_mode():
        os.environ["SUPABASE_URL"] = live_url
        os.environ["SUPABASE_SERVICE_ROLE_KEY"] = live_key

    def allowed(host) -> bool:
        return is_loopback(host) or str(host or "").lower() in allowed_hosts

    real_connect = socket.socket.connect
    real_connect_ex = socket.socket.connect_ex
    real_getaddrinfo = socket.getaddrinfo

    def guarded_connect(self, address):
        if isinstance(address, tuple) and not allowed(address[0]) and not _resolved_from_allowed(address[0]):
            raise _record(address[0], "connection")
        return real_connect(self, address)

    def guarded_connect_ex(self, address):
        if isinstance(address, tuple) and not allowed(address[0]) and not _resolved_from_allowed(address[0]):
            raise _record(address[0], "connection")
        return real_connect_ex(self, address)

    resolved_allowed: set = set()

    def _resolved_from_allowed(ip) -> bool:
        return str(ip) in resolved_allowed

    def guarded_getaddrinfo(host, *args, **kwargs):
        if host is not None and not allowed(host):
            raise _record(host, "DNS lookup")
        result = real_getaddrinfo(host, *args, **kwargs)
        if host is not None and not is_loopback(host):
            resolved_allowed.update(str(info[4][0]) for info in result)  # IPs of the live host only
        return result

    socket.socket.connect = guarded_connect
    socket.socket.connect_ex = guarded_connect_ex
    socket.getaddrinfo = guarded_getaddrinfo

    state = {"live": live_mode(), "allowed_host_count": len(allowed_hosts), "blocked": blocked}
    setattr(socket, _STATE_ATTR, state)
    return state


def guard_installed() -> bool:
    return getattr(socket, _STATE_ATTR, None) is not None


# ── Drop-in load_dotenv ───────────────────────────────────────────────────────────────────────────

def _is_project_env_file(path) -> bool:
    try:
        resolved = Path(path).resolve()
    except (TypeError, OSError):
        return False
    return any(resolved == env_file.resolve() for env_file in PROJECT_ENV_FILES)


def load_dotenv(dotenv_path=None, *args, **kwargs) -> bool:
    """python-dotenv's load_dotenv, except in test processes: the guard is installed and the project .env
    files (production credentials) are not loaded. Other files (e.g. temporary fixtures) still load."""
    if is_test_process():
        install_guard()
        if dotenv_path is None or _is_project_env_file(dotenv_path):
            return False
    return _dotenv_load_dotenv(dotenv_path, *args, **kwargs)


def project_env_values(path) -> Optional[dict]:
    """dotenv_values for code that copies values itself; None (nothing to copy) for project files in tests."""
    if is_test_process():
        install_guard()
        if _is_project_env_file(path):
            return None
    return dotenv_values(path)
