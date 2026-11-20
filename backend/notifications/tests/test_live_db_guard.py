"""The live-database guard refuses unsafe targets. No database access."""

import pytest

from backend.notifications.tests import live_db_guard as g


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    for k in (g.TEST_URL_VAR, g.ALLOW_REMOTE_VAR, "_INFERXE_TEST_DB_GUARD_APPLIED"):
        monkeypatch.delenv(k, raising=False)
    return monkeypatch


def test_missing_url_refused():
    with pytest.raises(g.UnsafeTestDatabaseError, match="not set"):
        g.require_isolated_test_database()


@pytest.mark.parametrize("url", [
    "postgresql://u:p@aws-0-ap-south-1.pooler.supabase.com:5432/postgres",
    "postgresql://u:p@db.abcdefgh.supabase.co:5432/postgres",
])
def test_supabase_hosts_refused_without_explicit_opt_in(clean_env, url):
    clean_env.setenv(g.TEST_URL_VAR, url)
    with pytest.raises(g.UnsafeTestDatabaseError):
        g.require_isolated_test_database()


def test_remote_host_refused_without_opt_in(clean_env):
    clean_env.setenv(g.TEST_URL_VAR, "postgresql://u@10.1.2.3:5432/test")
    with pytest.raises(g.UnsafeTestDatabaseError, match="not local"):
        g.require_isolated_test_database()


def test_project_env_database_url_always_refused(clean_env, monkeypatch):
    prod = "postgresql://u:p@127.0.0.1:5432/looks_local_but_is_the_project_db"
    monkeypatch.setattr(g, "_production_dsns", lambda: {prod})
    clean_env.setenv(g.TEST_URL_VAR, prod)
    clean_env.setenv(g.ALLOW_REMOTE_VAR, "1")
    with pytest.raises(g.UnsafeTestDatabaseError, match="production"):
        g.require_isolated_test_database()


def test_local_url_refused_if_db_module_already_imported(clean_env):
    # In this pytest process backend.notifications.db is already imported by other tests,
    # so applying the guard late must fail loudly rather than silently use the old DSN.
    import backend.notifications.db  # noqa: F401
    clean_env.setenv(g.TEST_URL_VAR, "postgresql://postgres@127.0.0.1:5432/inferxe_staging_test")
    with pytest.raises(g.UnsafeTestDatabaseError, match="imported before"):
        g.require_isolated_test_database()
