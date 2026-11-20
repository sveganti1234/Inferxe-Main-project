"""
pytest entry point for the Python test-isolation guard (backend/isolation_guard.py).

pytest loads this file before collecting any test module, so the guard is active before any service module is
imported. Other runners (unittest, IDE runners, test scripts run directly) get the same guard from the service
modules themselves, which load .env only through isolation_guard.load_dotenv.
"""

import sys
from pathlib import Path

import pytest

_BACKEND_DIR = str(Path(__file__).resolve().parent)
if _BACKEND_DIR not in sys.path:
    sys.path.append(_BACKEND_DIR)

import isolation_guard  # noqa: E402

try:
    isolation_guard.install_guard()
except isolation_guard.IsolationError as err:
    raise pytest.UsageError(str(err)) from None


def pytest_terminal_summary(terminalreporter):
    if isolation_guard.blocked:
        terminalreporter.section("test-safety: blocked outbound network")
        for test_id, kind, category in isolation_guard.blocked:
            terminalreporter.write_line(f"{kind} ({category})  <- {test_id}")


@pytest.fixture(autouse=True)
def _isolated_rag_cache_db(monkeypatch, tmp_path):
    """The Supabase fallback cache (database/inferxe_rag_cache.db) is real local dev data: point it at a temp file."""
    for name in ("backend.database.supabase_client", "database.supabase_client"):
        mod = sys.modules.get(name)
        if mod is not None and hasattr(mod, "CACHE_DB_PATH"):
            monkeypatch.setattr(mod, "CACHE_DB_PATH", tmp_path / "rag_cache.db")
            monkeypatch.setattr(mod, "_local_cache_ready", False)
