"""Keep database-writing suites from being imported (and run) without an isolated test database."""

import sys
from pathlib import Path

import pytest

from backend.notifications.tests import live_db_guard


def pytest_ignore_collect(collection_path: Path, config):
    if collection_path.name in live_db_guard.LIVE_TEST_MODULES:
        return not live_db_guard.configured_test_database_url()
    return None


def pytest_configure(config):
    if live_db_guard.configured_test_database_url():
        live_db_guard.require_isolated_test_database()


@pytest.fixture(autouse=True)
def _profile_status_check_without_database(monkeypatch):
    """get_current_user runs assert_profile_active, which reads profiles.status (503 without a DB).
    Unit tests have no database, so the check is a no-op here. A test of the check itself should call
    the function captured at import time (e.g. `from ...auth import assert_profile_active`)."""
    for name in ("backend.notifications.auth", "notifications.auth"):
        mod = sys.modules.get(name)
        if mod is not None and hasattr(mod, "assert_profile_active"):
            monkeypatch.setattr(mod, "assert_profile_active", lambda user: None)
