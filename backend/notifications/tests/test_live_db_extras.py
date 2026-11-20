"""
Live checks against an ISOLATED test database (never production). Only collected when
INFERXE_TEST_DATABASE_URL is set; see live_db_guard.py. Covers what the mocked suites cannot:
real Postgres behaviour of the broadcast batch/fallback, the connection pool, and row locking.

Run from the repo root:
    INFERXE_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/inferxe_staging_test?sslmode=disable \
        python -m pytest backend/notifications/tests/test_live_db_extras.py -v
"""

from backend.notifications.tests.live_db_guard import require_isolated_test_database  # noqa: E402
require_isolated_test_database()  # refuses to run without an isolated test DB (never production)

import threading  # noqa: E402
import time  # noqa: E402
import uuid  # noqa: E402
from pathlib import Path  # noqa: E402

import psycopg2  # noqa: E402
import pytest  # noqa: E402

from backend.notifications import db  # noqa: E402
from backend.notifications.service import NotificationService  # noqa: E402

FIXTURES = Path(__file__).parent / "fixtures"


def _sql(statement, params=None, fetch=False):
    with db.DBConnection(autocommit=True) as conn:
        cur = conn.cursor()
        cur.execute(statement, params)
        return cur.fetchall() if fetch else None


@pytest.fixture(scope="module", autouse=True)
def schema():
    db.init_db()
    _sql((FIXTURES / "supabase_profiles_stub.sql").read_text(encoding="utf-8"))
    yield
    db.close_pool()


def _make_users(prefix, n, with_profile):
    ids = [f"{prefix}_{uuid.uuid4().hex[:8]}" for _ in range(n)]
    for uid in ids:
        _sql("INSERT INTO users (id, email, full_name, role, status, created_at) VALUES (%s, %s, %s, 'customer', 'active', now()::text)",
             (uid, f"{uid}@example.test", uid))
        if with_profile:
            _sql("INSERT INTO profiles (user_id, email, created_at, updated_at) VALUES (%s, %s, now()::text, now()::text)",
                 (uid, f"{uid}@example.test"))
    return ids


def _count_notifications(user_ids, entity):
    rows = _sql("SELECT COUNT(*) FROM notifications WHERE user_id = ANY(%s) AND related_entity_id = %s",
                (user_ids, entity), fetch=True)
    return rows[0][0]


def _broadcast(user_ids, entity):
    with db.DBConnection(autocommit=False) as conn:
        cur = conn.cursor()
        n = NotificationService._broadcast_notifications(
            cur, user_ids, title="Live broadcast", message="hello", notification_type="SYSTEM",
            metadata={"t": 1}, related_entity_id=entity)
        conn.commit()
        return n


def test_broadcast_batch_insert_on_real_postgres():
    users = _make_users("bc", 25, with_profile=True)
    entity = f"ent_{uuid.uuid4().hex[:8]}"
    assert _broadcast(users, entity) == 25
    assert _count_notifications(users, entity) == 25


def test_broadcast_falls_back_and_skips_users_without_profile_when_fk_exists():
    fk_sql = (FIXTURES / "notifications_profile_fk_stub.sql").read_text(encoding="utf-8")
    _sql(fk_sql)
    try:
        with_profile = _make_users("bcp", 4, with_profile=True)
        without_profile = _make_users("bcn", 3, with_profile=False)
        entity = f"ent_{uuid.uuid4().hex[:8]}"
        assert _broadcast(with_profile + without_profile, entity) == 4
        assert _count_notifications(with_profile, entity) == 4
        assert _count_notifications(without_profile, entity) == 0
    finally:
        _sql("ALTER TABLE notifications DROP CONSTRAINT IF EXISTS fk_notifications_profile_stub")


def test_pool_saturation_queues_then_times_out_cleanly(monkeypatch):
    monkeypatch.setattr(db, "POOL_SIZE", 3)
    monkeypatch.setattr(db, "POOL_WAIT_SECONDS", 1.5)
    db.close_pool()
    results, lock = {"ok": 0, "timeout": 0, "other": []}, threading.Lock()
    backend_pids = set()

    def worker():
        try:
            with db.DBConnection() as conn:
                cur = conn.cursor()
                cur.execute("SELECT pg_backend_pid(), pg_sleep(0.4)")
                with lock:
                    backend_pids.add(cur.fetchone()[0])
                    results["ok"] += 1
        except db.PoolTimeoutError:
            with lock:
                results["timeout"] += 1
        except Exception as e:  # pragma: no cover - reported by the assert
            with lock:
                results["other"].append(repr(e))

    threads = [threading.Thread(target=worker) for _ in range(12)]
    t0 = time.perf_counter()
    for t in threads:
        t.start()
    for t in threads:
        t.join(30)
    elapsed = time.perf_counter() - t0
    print(f"\npool=3 wait=1.5s, 12 x 0.4s queries: ok={results['ok']} timeout={results['timeout']} "
          f"distinct server connections={len(backend_pids)} elapsed={elapsed:.2f}s")
    assert results["other"] == []
    assert results["ok"] + results["timeout"] == 12
    assert len(backend_pids) <= 3  # never more server connections than the pool size
    assert results["ok"] >= 9      # ~3 waves of 0.4s fit in the 1.5s wait
    db.close_pool()


def test_statement_timeout_applies_on_real_server(monkeypatch):
    monkeypatch.setattr(db, "STATEMENT_TIMEOUT_MS", 300)
    db.close_pool()
    with pytest.raises(psycopg2.errors.QueryCanceled):
        with db.DBConnection() as conn:
            conn.cursor().execute("SELECT pg_sleep(2)")
    with db.DBConnection() as conn:  # pool still healthy afterwards
        cur = conn.cursor()
        cur.execute("SHOW statement_timeout")
        assert cur.fetchone()[0] == "300ms"
    db.close_pool()


def test_close_pool_with_in_flight_query_on_real_server():
    db.close_pool()
    done = {}

    def long_query():
        with db.DBConnection() as conn:
            cur = conn.cursor()
            cur.execute("SELECT pg_sleep(0.5), 42")
            done["value"] = cur.fetchone()[1]

    t = threading.Thread(target=long_query)
    t.start()
    time.sleep(0.15)
    db.close_pool()  # must not kill the running query
    t.join(10)
    assert done.get("value") == 42
    with db.DBConnection() as conn:  # a new pool works
        cur = conn.cursor()
        cur.execute("SELECT 1")
        assert cur.fetchone()[0] == 1


def test_deployment_row_lock_serialises_concurrent_transitions():
    owner = _make_users("dep", 1, with_profile=True)[0]
    dep_id = f"DEP-{uuid.uuid4().hex[:6]}"
    NotificationService.process_deployment_status(user_id=owner, deployment_id=dep_id, new_status="Provisioning")
    outcomes, lock = [], threading.Lock()

    def terminate(i):
        try:
            r = NotificationService.process_deployment_status(
                user_id=owner, deployment_id=dep_id, new_status="Terminated", idempotency_key=f"term_{dep_id}_{i}")
            with lock:
                outcomes.append(r["status"])
        except ValueError as e:
            with lock:
                outcomes.append(f"rejected:{e}")

    threads = [threading.Thread(target=terminate, args=(i,)) for i in range(5)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(15)
    # Exactly one transition happens; the rest see the locked, already-terminated row.
    assert outcomes.count("success") == 1, outcomes
    assert all(o == "success" or o == "noop" for o in outcomes), outcomes
    notes = _sql("SELECT COUNT(*) FROM notifications WHERE related_entity_id = %s AND title = 'GPU Deployment Terminated'",
                 (dep_id,), fetch=True)[0][0]
    assert notes == 1


def test_money_and_deployment_succeed_without_profile_when_fk_exists():
    """With a notifications->profiles FK, a missing profile row skips only the notification."""
    _sql((FIXTURES / "notifications_profile_fk_stub.sql").read_text(encoding="utf-8"))
    try:
        ghost = _make_users("noprof", 1, with_profile=False)[0]
        known = _make_users("withprof", 1, with_profile=True)[0]
        for uid in (ghost, known):
            r = NotificationService.process_wallet_recharge(uid, 100, idempotency_key=f"r_{uid}")
            assert r["status"] == "success" and r["new_balance"] == 100.0
            d = NotificationService.process_wallet_debit(uid, 40, idempotency_key=f"d_{uid}")
            assert d["status"] == "success" and d["remaining_balance"] == 60.0
            dep = NotificationService.process_deployment_status(user_id=uid, deployment_id=f"DEP-{uid}", new_status="Provisioning")
            assert dep["status"] == "success"
        bal = dict(_sql("SELECT user_id, balance FROM wallets WHERE user_id = ANY(%s)", ([ghost, known],), fetch=True))
        assert float(bal[ghost]) == 60.0 and float(bal[known]) == 60.0
        notes = dict(_sql("SELECT user_id, COUNT(*) FROM notifications WHERE user_id = ANY(%s) GROUP BY user_id",
                          ([ghost, known],), fetch=True))
        assert ghost not in notes            # skipped, not failed
        assert notes[known] == 4             # recharge, debit, low-balance warning (60 <= 100), deployment
    finally:
        _sql("ALTER TABLE notifications DROP CONSTRAINT IF EXISTS fk_notifications_profile_stub")


def test_mark_read_and_delete_keep_404_403_semantics_on_real_postgres():
    owner, other = f"own_{uuid.uuid4().hex[:6]}", f"oth_{uuid.uuid4().hex[:6]}"
    nid = f"notif_{uuid.uuid4().hex[:12]}"
    _sql("INSERT INTO notifications (id,user_id,title,message,notification_type,is_read,metadata,created_at) "
         "VALUES (%s,%s,'t','m','SYSTEM',FALSE,'{}',now()::text)", (nid, owner))
    with pytest.raises(PermissionError):
        NotificationService.mark_as_read(nid, other)
    with pytest.raises(PermissionError):
        NotificationService.delete_notification(nid, other)
    assert _sql("SELECT is_read FROM notifications WHERE id=%s", (nid,), fetch=True)[0][0] is False  # untouched
    assert NotificationService.mark_as_read(nid, owner)["is_read"] is True
    assert NotificationService.delete_notification(nid, owner) is True
    with pytest.raises(KeyError):
        NotificationService.mark_as_read(nid, owner)
    with pytest.raises(KeyError):
        NotificationService.delete_notification(nid, owner)


def test_deployment_lookup_exact_and_case_insensitive_with_ownership():
    owner = f"dl_{uuid.uuid4().hex[:6]}"
    dep = f"DEP-LIVE-{uuid.uuid4().hex[:6].upper()}"
    _sql("INSERT INTO gpu_deployments (id,user_id,name,model,gpu,vram,region,hourly_rate,status,created_at,updated_at) "
         "VALUES (%s,%s,'d','m','NVIDIA L4','24 GB','Mumbai, IN',60,'Running',now()::text,now()::text)", (dep, owner))
    assert NotificationService.get_gpu_metrics(owner, dep)["instance_id"] in (dep, dep.lower(), dep.upper())
    NotificationService.get_gpu_metrics(owner, dep.lower())  # different case still found (fallback)
    with pytest.raises(PermissionError):
        NotificationService.get_gpu_metrics("someone-else", dep)
    with pytest.raises(KeyError):
        NotificationService.get_gpu_metrics(owner, "DEP-DOES-NOT-EXIST")
