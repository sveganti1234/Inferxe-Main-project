"""Unit tests for backend/database/supabase_client.py client lifecycle. No network, no real Supabase:
a fake `supabase` module is injected for each test."""

import sys
import threading
import types

import pytest

from backend.database import supabase_client as sc


class FakeOptions:
    def __init__(self, **kw):
        self.kw = kw


def fake_supabase_module(created, with_options=True, fail=False):
    mod = types.ModuleType("supabase")

    def create_client(url, key, options=None):
        if fail:
            raise RuntimeError("cannot reach project")
        created.append(options)
        return object()

    mod.create_client = create_client
    if with_options:
        mod.ClientOptions = FakeOptions
    return mod


@pytest.fixture(autouse=True)
def isolated(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.invalid")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "test-only-not-a-real-key")
    sc.reset_supabase_client()
    yield
    sc.reset_supabase_client()


def test_client_created_once_and_reused(monkeypatch):
    created = []
    monkeypatch.setitem(sys.modules, "supabase", fake_supabase_module(created))
    a, b = sc.get_supabase_client(), sc.get_supabase_client()
    assert a is b and len(created) == 1
    assert created[0].kw["postgrest_client_timeout"] == sc.SUPABASE_CLIENT_TIMEOUT_SECONDS


def test_concurrent_first_use_creates_one_client(monkeypatch):
    created = []
    monkeypatch.setitem(sys.modules, "supabase", fake_supabase_module(created))
    barrier, results = threading.Barrier(16), []
    def worker():
        barrier.wait()
        results.append(sc.get_supabase_client())
    threads = [threading.Thread(target=worker) for _ in range(16)]
    for t in threads: t.start()
    for t in threads: t.join(5)
    assert len(created) == 1 and len({id(r) for r in results}) == 1


def test_older_library_without_client_options_still_works(monkeypatch):
    created = []
    monkeypatch.setitem(sys.modules, "supabase", fake_supabase_module(created, with_options=False))
    monkeypatch.setitem(sys.modules, "supabase.lib", None)  # older layout import also unavailable
    assert sc.get_supabase_client() is not None
    assert created == [None]  # created with library defaults


def test_init_failure_is_remembered_not_retried_every_call(monkeypatch, caplog):
    created = []
    monkeypatch.setitem(sys.modules, "supabase", fake_supabase_module(created, fail=True))
    for _ in range(5):
        assert sc.get_supabase_client() is None
    assert caplog.text.count("Failed to initialize Supabase client") == 1


def test_missing_credentials_warned_once(monkeypatch, caplog):
    monkeypatch.delenv("SUPABASE_URL")
    for _ in range(5):
        assert sc.get_supabase_client() is None
    assert caplog.text.count("Supabase is not configured") == 1


def test_reset_allows_retry_after_fix(monkeypatch):
    created = []
    monkeypatch.setitem(sys.modules, "supabase", fake_supabase_module(created, fail=True))
    assert sc.get_supabase_client() is None
    monkeypatch.setitem(sys.modules, "supabase", fake_supabase_module(created))
    sc.reset_supabase_client()
    assert sc.get_supabase_client() is not None


def test_chat_history_returns_latest_turns_chronologically(monkeypatch):
    rows_desc = [{"id": 3}, {"id": 2}]  # what "ORDER BY created_at DESC LIMIT 2" returns

    class Query:
        def __init__(self): self.calls = []
        def select(self, *a): return self
        def eq(self, *a): return self
        def order(self, col, desc): self.calls.append(("order", col, desc)); return self
        def limit(self, n): self.calls.append(("limit", n)); return self
        def execute(self): return types.SimpleNamespace(data=list(rows_desc))

    q = Query()
    monkeypatch.setattr(sc, "get_supabase_client", lambda: types.SimpleNamespace(table=lambda name: q))
    assert sc.get_chat_history(session_id="s1", limit=2) == [{"id": 2}, {"id": 3}]
    assert ("order", "created_at", True) in q.calls


def test_fallback_cache_db_is_isolated_from_real_dev_data(tmp_path):
    # backend/conftest.py redirects the local fallback cache; tests must never write database/inferxe_rag_cache.db.
    real = sc.ROOT_DIR / "database" / "inferxe_rag_cache.db"
    assert sc.CACHE_DB_PATH != real
    assert tmp_path in sc.CACHE_DB_PATH.parents
    sc._init_local_cache_db()
    assert sc.CACHE_DB_PATH.exists()
