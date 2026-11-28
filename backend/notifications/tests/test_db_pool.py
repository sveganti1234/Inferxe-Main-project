"""
Unit tests for the notifications DB connection pool (backend/notifications/db.py).

No network or database access: psycopg2.connect is replaced with fake connections and
get_connection_params returns a dummy dict, so these tests never reach Supabase.
Run from the repo root:  python -m pytest backend/notifications/tests/test_db_pool.py -q
"""

import os
import subprocess
import sys
import threading
import time
from pathlib import Path
from types import SimpleNamespace

import psycopg2
import pytest
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.testclient import TestClient
from psycopg2.extensions import TRANSACTION_STATUS_IDLE, TRANSACTION_STATUS_INTRANS, TRANSACTION_STATUS_UNKNOWN
from psycopg2.pool import PoolError

from backend.notifications import db
from backend.notifications.db import DBConfigError, DBConnection, PoolTimeoutError

SIZE = 3
REPO_ROOT = Path(__file__).resolve().parents[3]
DB_ENV_VARS = ("DB_POOL_SIZE", "DB_POOL_TIMEOUT", "DB_STATEMENT_TIMEOUT_MS")


class FakeCursor:
    def __init__(self, conn):
        self.conn = conn

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params=None):
        if self.conn.fail_execute:
            raise psycopg2.OperationalError("simulated execute failure")
        self.conn.executed.append((sql, params, self.conn.autocommit))


class FakeConn:
    def __init__(self):
        self.closed = 0
        self.autocommit = False
        self.info = SimpleNamespace(transaction_status=TRANSACTION_STATUS_IDLE)
        self.executed = []
        self.rollbacks = 0
        self.fail_execute = False

    def cursor(self, *args, **kwargs):
        return FakeCursor(self)

    def rollback(self):
        self.rollbacks += 1
        self.info.transaction_status = TRANSACTION_STATUS_IDLE

    def close(self):
        self.closed = 1


@pytest.fixture
def fake_db(monkeypatch):
    """Patch connection creation; yields the list of connections the pool opened."""
    created = []

    def fake_connect(**kwargs):
        conn = FakeConn()
        created.append(conn)
        return conn

    monkeypatch.setattr(db.psycopg2, "connect", fake_connect)
    monkeypatch.setattr(db, "get_connection_params", lambda: {"host": "127.0.0.1", "port": 5432})
    monkeypatch.setattr(db, "POOL_SIZE", SIZE)
    monkeypatch.setattr(db, "POOL_WAIT_SECONDS", 2.0)
    monkeypatch.setattr(db, "STATEMENT_TIMEOUT_MS", 30000)
    db.close_pool()
    yield created
    db.close_pool()


def free_slots(pool) -> int:
    """Count free semaphore slots without changing them."""
    n = 0
    while pool._slots.acquire(blocking=False):
        n += 1
    for _ in range(n):
        pool._slots.release()
    return n


def test_lazy_creation(fake_db):
    pool = db.get_pool()
    assert fake_db == []  # creating the pool opens nothing
    with DBConnection():
        pass
    assert len(fake_db) == 1
    assert free_slots(pool) == SIZE


def test_reuse(fake_db):
    seen = set()
    for _ in range(5):
        with DBConnection() as conn:
            seen.add(id(conn))
    assert len(seen) == 1
    assert len(fake_db) == 1


def test_concurrency_bounded(fake_db):
    active = 0
    peak = 0
    lock = threading.Lock()
    release = threading.Event()
    errors = []

    def worker():
        nonlocal active, peak
        try:
            with DBConnection():
                with lock:
                    active += 1
                    peak = max(peak, active)
                release.wait(0.05)
                with lock:
                    active -= 1
        except Exception as e:  # pragma: no cover - surfaced by assert below
            errors.append(e)

    threads = [threading.Thread(target=worker) for _ in range(12)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(10)
    assert errors == []
    assert peak <= SIZE
    assert len(fake_db) <= SIZE
    assert free_slots(db.get_pool()) == SIZE


def test_wait_timeout(fake_db):
    pool = db.get_pool()
    held = [pool.getconn() for _ in range(SIZE)]
    with pytest.raises(PoolTimeoutError) as info:
        pool.getconn(timeout=0.1)
    assert isinstance(info.value, PoolError)
    for conn in held:
        pool.putconn(conn)
    assert free_slots(pool) == SIZE


def test_slot_released_on_errors(fake_db):
    for _ in range(SIZE * 2):
        with pytest.raises(ValueError):
            with DBConnection():
                raise ValueError("boom")
    with DBConnection():
        pass
    assert free_slots(db.get_pool()) == SIZE


def test_enter_failure_connect_releases_slot(fake_db, monkeypatch):
    def failing_connect(**kwargs):
        raise psycopg2.OperationalError("db down")

    monkeypatch.setattr(db.psycopg2, "connect", failing_connect)
    pool = db.get_pool()
    with pytest.raises(psycopg2.OperationalError):
        with DBConnection():
            pass
    assert free_slots(pool) == SIZE


def test_enter_failure_autocommit_releases(fake_db, monkeypatch):
    class BrokenAutocommit(FakeConn):
        @property
        def autocommit(self):
            return False

        @autocommit.setter
        def autocommit(self, value):
            if value is not False:
                raise psycopg2.InterfaceError("connection already closed")

    broken = BrokenAutocommit()
    monkeypatch.setattr(db.psycopg2, "connect", lambda **kw: broken)
    pool = db.get_pool()
    with pytest.raises(psycopg2.InterfaceError):
        with DBConnection():
            pass
    assert broken.closed
    assert pool._idle == []
    assert free_slots(pool) == SIZE


def test_enter_failure_set_timeout_releases(fake_db):
    pool = db.get_pool()
    conn = pool.getconn()
    conn.fail_execute = True
    pool.putconn(conn)  # back in the idle list, not yet configured
    with pytest.raises(psycopg2.OperationalError):
        with DBConnection():
            pass
    assert conn.closed
    assert pool._idle == []
    assert free_slots(pool) == SIZE


def test_closed_connection_discarded(fake_db):
    with DBConnection() as first:
        pass
    first.closed = 1  # dropped while idle
    with DBConnection() as second:
        assert second is not first
        second.closed = 2  # dropped during use
    with DBConnection() as third:
        assert third is not second
    assert len(fake_db) == 3
    assert free_slots(db.get_pool()) == SIZE


def test_operational_error_discards_connection(fake_db):
    with pytest.raises(psycopg2.OperationalError):
        with DBConnection() as conn:
            raise psycopg2.OperationalError("server closed the connection")
    assert conn.closed
    with DBConnection() as fresh:
        assert fresh is not conn


def test_dirty_connection_rolled_back_and_reused(fake_db):
    with DBConnection(autocommit=False) as conn:
        conn.info.transaction_status = TRANSACTION_STATUS_INTRANS  # caller forgot to commit
    assert conn.rollbacks == 1
    assert not conn.closed
    with DBConnection() as again:
        assert again is conn


def test_unknown_status_connection_closed(fake_db):
    with DBConnection() as conn:
        conn.info.transaction_status = TRANSACTION_STATUS_UNKNOWN
    assert conn.closed
    assert db.get_pool()._idle == []


def test_rollback_on_error(fake_db):
    with pytest.raises(RuntimeError):
        with DBConnection(autocommit=False) as conn:
            raise RuntimeError("fail inside transaction")
    assert conn.rollbacks == 1


def test_init_lock_single_pool(fake_db, monkeypatch):
    built = []
    real_cls = db._ConnectionPool
    barrier = threading.Barrier(20)

    def counting_pool(size, **params):
        built.append(1)
        threading.Event().wait(0.05)  # widen the race window
        return real_cls(size, **params)

    monkeypatch.setattr(db, "_ConnectionPool", counting_pool)
    pools = []

    def worker():
        barrier.wait()
        pools.append(db.get_pool())

    threads = [threading.Thread(target=worker) for _ in range(20)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(10)
    assert len(built) == 1
    assert len({id(p) for p in pools}) == 1


def test_init_failure_keeps_state_consistent(fake_db, monkeypatch):
    calls = {"n": 0}

    def flaky_params():
        calls["n"] += 1
        if calls["n"] == 1:
            raise ValueError("bad database URL")
        return {"host": "127.0.0.1", "port": 5432}

    monkeypatch.setattr(db, "get_connection_params", flaky_params)
    with pytest.raises(ValueError):
        db.get_pool()
    assert db._pool is None
    pool = db.get_pool()
    assert free_slots(pool) == SIZE
    with DBConnection():
        pass


def test_getconn_on_closed_pool_does_not_leak_slot(fake_db):
    pool = db.get_pool()
    pool.closeall()
    with pytest.raises(PoolError):
        pool.getconn()
    assert free_slots(pool) == SIZE


def test_close_pool_with_in_flight_request(fake_db):
    with DBConnection() as conn:
        old_pool = db.get_pool()
        db.close_pool()
        assert not conn.closed  # in-flight query is not cut off
    assert conn.closed  # closed on return, not re-pooled
    assert old_pool._idle == []
    assert free_slots(old_pool) == SIZE
    new_pool = db.get_pool()
    assert new_pool is not old_pool
    with DBConnection() as fresh:
        assert fresh is not conn


def _slow_connect_factory(connecting, proceed, made):
    def slow_connect(**kwargs):
        connecting.set()
        assert proceed.wait(5)
        conn = FakeConn()
        made.append(conn)
        return conn

    return slow_connect


def test_closeall_during_connect_does_not_hand_out_connection(fake_db, monkeypatch):
    connecting, proceed, made = threading.Event(), threading.Event(), []
    monkeypatch.setattr(db.psycopg2, "connect", _slow_connect_factory(connecting, proceed, made))
    pool = db.get_pool()
    result = {}

    def worker():
        try:
            result["conn"] = pool.getconn()
        except Exception as e:
            result["err"] = e

    t = threading.Thread(target=worker)
    t.start()
    assert connecting.wait(5)  # worker is inside psycopg2.connect, lock released
    pool.closeall()
    proceed.set()
    t.join(5)

    assert "conn" not in result
    assert isinstance(result["err"], PoolError)
    assert not isinstance(result["err"], PoolTimeoutError)
    assert len(made) == 1 and made[0].closed
    assert pool._idle == []
    assert free_slots(pool) == SIZE


def test_close_pool_during_connect_via_dbconnection(fake_db, monkeypatch):
    connecting, proceed, made = threading.Event(), threading.Event(), []
    monkeypatch.setattr(db.psycopg2, "connect", _slow_connect_factory(connecting, proceed, made))
    old_pool = db.get_pool()
    result = {}

    def worker():
        try:
            with DBConnection():
                result["ran"] = True
        except Exception as e:
            result["err"] = e

    t = threading.Thread(target=worker)
    t.start()
    assert connecting.wait(5)
    db.close_pool()
    proceed.set()
    t.join(5)

    assert "ran" not in result
    assert isinstance(result["err"], PoolError)
    assert made[0].closed
    assert free_slots(old_pool) == SIZE
    with DBConnection():  # a fresh pool works afterwards
        pass
    assert db.get_pool() is not old_pool


def test_statement_timeout_set_once_in_autocommit(fake_db):
    for autocommit in (False, True, False):
        with DBConnection(autocommit=autocommit) as conn:
            assert conn.autocommit is autocommit
    sets = [e for e in conn.executed if e[0].startswith("SET statement_timeout")]
    assert sets == [("SET statement_timeout = %s", (30000,), True)]


def test_statement_timeout_skipped_in_transaction_mode(fake_db, monkeypatch):
    monkeypatch.setattr(db, "get_connection_params", lambda: {"host": "127.0.0.1", "port": 6543})
    with DBConnection() as conn:
        pass
    assert conn.executed == []


def test_statement_timeout_disabled(fake_db, monkeypatch):
    monkeypatch.setattr(db, "STATEMENT_TIMEOUT_MS", 0)
    with DBConnection() as conn:
        pass
    assert conn.executed == []


def test_pool_timeout_returns_503_with_retry_after_and_cors():
    from backend.notifications.main import pool_timeout_handler

    app = FastAPI()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_exception_handler(PoolTimeoutError, pool_timeout_handler)

    @app.get("/busy")
    def busy():  # sync endpoint, like the notification routes
        raise PoolTimeoutError("No database connection available.")

    res = TestClient(app).get("/busy", headers={"Origin": "http://localhost:5173"})
    assert res.status_code == 503
    assert res.headers["retry-after"] == "1"
    assert res.json() == {"detail": "Database busy, please retry."}
    assert res.headers["access-control-allow-origin"] == "http://localhost:5173"


def test_health_endpoints_report_degraded_on_pool_timeout(monkeypatch):
    from backend.notifications import main, router

    class BusyConnection:
        def __init__(self, autocommit=True, **kwargs):
            pass

        def __enter__(self):
            raise PoolTimeoutError("No database connection available.")

        def __exit__(self, *exc):
            return False

    monkeypatch.setattr(router, "DBConnection", BusyConnection)
    monkeypatch.setattr(main, "DBConnection", BusyConnection)
    status = router.get_db_status()
    assert status["status"] == "degraded" and status["pool_saturated"] is True
    health = main._build_notifications_health()
    assert health["database_connected"] is False
    assert health["database_pool_saturated"] is True
    assert health["status"] == "degraded"


def test_health_reports_real_db_failure_without_pool_flag(monkeypatch):
    from backend.notifications import main, router

    class DownConnection:
        def __init__(self, autocommit=True, **kwargs):
            pass

        def __enter__(self):
            raise psycopg2.OperationalError("connection refused")

        def __exit__(self, *exc):
            return False

    monkeypatch.setattr(router, "DBConnection", DownConnection)
    monkeypatch.setattr(main, "DBConnection", DownConnection)
    assert router.get_db_status().get("pool_saturated") is None
    health = main._build_notifications_health()
    assert health["database_connected"] is False and health["database_pool_saturated"] is False


def test_per_use_timeout_overrides_pool_wait(fake_db, monkeypatch):
    monkeypatch.setattr(db, "POOL_WAIT_SECONDS", 30.0)  # a normal request would wait this long
    pool = db.get_pool()
    held = [pool.getconn() for _ in range(SIZE)]
    t0 = time.perf_counter()
    with pytest.raises(PoolTimeoutError):
        with DBConnection(timeout=0.1):
            pass
    assert time.perf_counter() - t0 < 1.0
    for c in held:
        pool.putconn(c)
    assert free_slots(pool) == SIZE


def test_health_probes_use_short_pool_wait(monkeypatch):
    from backend.notifications import main, router
    seen = []

    class Recorder:
        def __init__(self, autocommit=True, timeout=None):
            seen.append(timeout)

        def __enter__(self):
            raise PoolTimeoutError("busy")

        def __exit__(self, *exc):
            return False

    monkeypatch.setattr(router, "DBConnection", Recorder)
    monkeypatch.setattr(main, "DBConnection", Recorder)
    router.get_db_status()
    main._build_notifications_health()
    assert seen == [db.HEALTH_CHECK_POOL_WAIT_SECONDS] * 2 and db.HEALTH_CHECK_POOL_WAIT_SECONDS <= 1.0


def test_main_app_registers_503_handler():
    from backend.notifications.main import app, pool_timeout_handler

    assert app.exception_handlers.get(PoolTimeoutError) is pool_timeout_handler


# ── F5: double / foreign putconn ──────────────────────────────────────────────

def test_double_putconn_rejected(fake_db):
    pool = db.get_pool()
    conn = pool.getconn()
    pool.putconn(conn)
    with pytest.raises(PoolError):
        pool.putconn(conn)
    assert pool._idle == [conn]  # not added twice
    assert free_slots(pool) == SIZE  # slot not released twice
    a, b = pool.getconn(), pool.getconn()
    assert a is not b  # two requests never share one connection
    pool.putconn(a)
    pool.putconn(b)


def test_foreign_putconn_rejected(fake_db):
    pool = db.get_pool()
    with pytest.raises(PoolError):
        pool.putconn(FakeConn())
    assert pool._idle == []
    assert free_slots(pool) == SIZE


# ── F6: thread-safe statement_timeout tracking ────────────────────────────────

def test_statement_timeout_tracking_thread_safe(fake_db, monkeypatch):
    monkeypatch.setattr(db, "POOL_SIZE", 8)
    db.close_pool()
    errors = []
    barrier = threading.Barrier(8)

    def worker():
        try:
            barrier.wait()
            for _ in range(25):
                with DBConnection():
                    pass
        except Exception as e:  # pragma: no cover - surfaced by assert below
            errors.append(e)

    threads = [threading.Thread(target=worker) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(10)
    assert errors == []
    for conn in fake_db:  # exactly one SET per physical connection
        assert sum(1 for e in conn.executed if e[0].startswith("SET statement_timeout")) == 1


# ── F2: environment variable validation ───────────────────────────────────────

@pytest.fixture
def clean_db_env(monkeypatch):
    for name in DB_ENV_VARS:
        monkeypatch.delenv(name, raising=False)
    return monkeypatch


@pytest.mark.parametrize(
    "name, raw",
    [
        ("DB_POOL_SIZE", "abc"),
        ("DB_POOL_SIZE", "1.5"),
        ("DB_POOL_SIZE", "0"),
        ("DB_POOL_SIZE", "-5"),
        ("DB_POOL_SIZE", "101"),
        ("DB_POOL_TIMEOUT", "abc"),
        ("DB_POOL_TIMEOUT", "nan"),
        ("DB_POOL_TIMEOUT", "inf"),
        ("DB_POOL_TIMEOUT", "-inf"),
        ("DB_POOL_TIMEOUT", "-1"),
        ("DB_POOL_TIMEOUT", "0.05"),
        ("DB_POOL_TIMEOUT", "61"),
        ("DB_STATEMENT_TIMEOUT_MS", "abc"),
        ("DB_STATEMENT_TIMEOUT_MS", "1.5"),
        ("DB_STATEMENT_TIMEOUT_MS", "-1"),
        ("DB_STATEMENT_TIMEOUT_MS", "2147483648"),
    ],
)
def test_env_number_rejects_invalid(clean_db_env, name, raw):
    specs = {
        "DB_POOL_SIZE": (5, int, 1, 100),
        "DB_POOL_TIMEOUT": (5.0, float, 0.1, 60),
        "DB_STATEMENT_TIMEOUT_MS": (30000, int, 0, 2147483647),
    }
    clean_db_env.setenv(name, raw)
    with pytest.raises(DBConfigError) as info:
        db._env_number(name, *specs[name])
    assert name in str(info.value)
    assert repr(raw) in str(info.value)


@pytest.mark.parametrize(
    "name, raw, expected, cast, lo, hi",
    [
        ("DB_POOL_SIZE", "1", 1, int, 1, 100),
        ("DB_POOL_SIZE", " 100 ", 100, int, 1, 100),
        ("DB_POOL_TIMEOUT", "0.1", 0.1, float, 0.1, 60),
        ("DB_POOL_TIMEOUT", "60", 60.0, float, 0.1, 60),
        ("DB_STATEMENT_TIMEOUT_MS", "0", 0, int, 0, 2147483647),
        ("DB_STATEMENT_TIMEOUT_MS", "2147483647", 2147483647, int, 0, 2147483647),
    ],
)
def test_env_number_accepts_valid(clean_db_env, name, raw, expected, cast, lo, hi):
    clean_db_env.setenv(name, raw)
    assert db._env_number(name, None, cast, lo, hi) == expected


@pytest.mark.parametrize("raw", [None, "", "   "])
def test_env_number_unset_or_empty_uses_default(clean_db_env, raw):
    if raw is not None:
        clean_db_env.setenv("DB_POOL_SIZE", raw)
    assert db._env_number("DB_POOL_SIZE", 5, int, 1, 100) == 5


def _import_db_in_subprocess(extra_env):
    """Import db.py in a fresh interpreter (import only: no pool is created, nothing connects)."""
    env = {k: v for k, v in os.environ.items() if k not in DB_ENV_VARS}
    env.update(extra_env)
    env["PYTHONPATH"] = str(REPO_ROOT)
    code = "from backend.notifications import db; print(db.POOL_SIZE, db.POOL_WAIT_SECONDS, db.STATEMENT_TIMEOUT_MS)"
    return subprocess.run([sys.executable, "-c", code], cwd=REPO_ROOT, env=env,
                          capture_output=True, text=True, timeout=60)


def test_startup_fails_clearly_on_invalid_env():
    res = _import_db_in_subprocess({"DB_POOL_TIMEOUT": "nan"})
    assert res.returncode != 0
    assert "DBConfigError" in res.stderr
    assert "Invalid DB_POOL_TIMEOUT='nan'" in res.stderr


def test_defaults_when_env_unset():
    res = _import_db_in_subprocess({})
    assert res.returncode == 0, res.stderr
    assert res.stdout.split() == ["5", "5.0", "30000"]


def test_unconfigured_database_returns_503_not_500(monkeypatch):
    """No DSN must surface as a clear 503 to customers instead of a bare 500."""
    from backend.notifications.main import app

    def no_dsn():
        raise db.DBNotConfiguredError("no dsn")

    monkeypatch.setattr(db, "get_connection_params", no_dsn)
    db.close_pool()

    @app.get("/__test/db-not-configured")
    def _probe():
        with DBConnection():
            pass

    try:
        r = TestClient(app, raise_server_exceptions=False).get("/__test/db-not-configured")
        assert r.status_code == 503
        assert "SUPABASE_DATABASE_URL" in r.json()["detail"]
    finally:
        app.router.routes[:] = [rt for rt in app.router.routes if getattr(rt, "path", "") != "/__test/db-not-configured"]
