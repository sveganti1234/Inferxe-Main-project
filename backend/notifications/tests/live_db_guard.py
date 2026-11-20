"""
Guard for the database-writing test suites (wallet initialization/idempotency, multi-user
notifications, workspace settings).

Without it, those suites resolve the database from the project .env files, whose DATABASE_URL points
at the production Supabase pooler, so running them would write to production. This guard makes them
refuse to run unless an explicit, isolated test database is configured:

    INFERXE_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/inferxe_staging_test

Only localhost databases are accepted unless INFERXE_TEST_DATABASE_ALLOW_REMOTE=1 is also set
(for a dedicated non-production Supabase project). Production-looking hosts are always refused.
It must run before any backend module is imported.
"""

import os
import sys
from urllib.parse import urlsplit

TEST_URL_VAR = "INFERXE_TEST_DATABASE_URL"
ALLOW_REMOTE_VAR = "INFERXE_TEST_DATABASE_ALLOW_REMOTE"
LIVE_TEST_MODULES = (
    "test_wallet_initialization.py",
    "test_wallet_idempotency.py",
    "test_multi_user_notifications.py",
    "test_workspace_settings.py",
    "test_gpu_runtime_monitoring.py",
    "test_live_db_extras.py",
    "test_rls_service_tables.py",
)
_LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}


class UnsafeTestDatabaseError(RuntimeError):
    pass


def configured_test_database_url() -> str:
    return (os.environ.get(TEST_URL_VAR) or "").strip()


def _production_dsns() -> set:
    """Database URLs from the project .env files, which must never be used by these suites."""
    from pathlib import Path

    root = Path(__file__).resolve().parents[3]
    found = set()
    for env_file in (root / ".env", root / "backend" / ".env"):
        try:
            for line in env_file.read_text(encoding="utf-8").splitlines():
                key, _, value = line.partition("=")
                if key.strip() in ("DATABASE_URL", "SUPABASE_DATABASE_URL", "NOTIFICATIONS_DATABASE_URL") and value.strip():
                    found.add(value.strip().strip('"').strip("'"))
        except OSError:
            pass
    return found


def require_isolated_test_database() -> str:
    """Point the notifications service at the isolated test database, or refuse to run."""
    url = configured_test_database_url()
    if not url:
        raise UnsafeTestDatabaseError(
            f"{TEST_URL_VAR} is not set. These tests write to a database; set it to an isolated test "
            "database (never production). See backend/notifications/tests/live_db_guard.py."
        )
    if os.environ.get("_INFERXE_TEST_DB_GUARD_APPLIED") == url:
        return url  # already applied in this process (pytest conftest, then the module itself)
    host = (urlsplit(url).hostname or "").lower()
    if url in _production_dsns() or "supabase.co" in host and os.environ.get(ALLOW_REMOTE_VAR) != "1":
        raise UnsafeTestDatabaseError(f"{TEST_URL_VAR} points at a project/production database; refusing.")
    if host not in _LOCAL_HOSTS and os.environ.get(ALLOW_REMOTE_VAR) != "1":
        raise UnsafeTestDatabaseError(
            f"{TEST_URL_VAR} host is not local; set {ALLOW_REMOTE_VAR}=1 only for a dedicated non-production project."
        )
    if "backend.notifications.db" in sys.modules:
        raise UnsafeTestDatabaseError("backend.notifications.db was imported before the test database guard ran.")

    # Highest-priority DSN for the notifications service; the others are neutralised so nothing
    # falls back to the .env values (load_dotenv(override=False) keeps these).
    os.environ["NOTIFICATIONS_DATABASE_URL"] = url
    os.environ["DATABASE_URL"] = url
    os.environ["SUPABASE_DATABASE_URL"] = url
    os.environ["SUPABASE_URL"] = ""
    os.environ["SUPABASE_SERVICE_ROLE_KEY"] = ""
    os.environ["_INFERXE_TEST_DB_GUARD_APPLIED"] = url
    return url
