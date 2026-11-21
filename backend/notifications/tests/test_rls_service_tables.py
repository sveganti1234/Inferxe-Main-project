"""
RLS on service-only tables, against an isolated local PostgreSQL that mimics Supabase (scratch-DB test).

Requires INFERXE_TEST_DATABASE_URL (local only; enforced by live_db_guard) connecting as a NON-superuser role that
owns the schema, in a database where the stand-in roles `anon` and `authenticated` exist, the connection role is a
member of both (so it can SET ROLE like PostgREST does), and new tables are granted to them by default
(ALTER DEFAULT PRIVILEGES ... GRANT ALL ON TABLES TO anon, authenticated), as on Supabase. Skips otherwise.

Covers: fresh-database creation applies the protection automatically (notifications init_db, workspace_settings,
legacy inference create_all); anon/authenticated cannot read/insert/update/delete even when a grant reappears;
the owning service role keeps working; migration 006 is idempotent, never grants, refuses FORCEd tables, and its
rollback restores exactly the 9 originally exposed tables.
"""

import os
import re
from pathlib import Path

from backend.notifications.tests.live_db_guard import require_isolated_test_database

TEST_DB_URL = require_isolated_test_database()

import psycopg2  # noqa: E402
import pytest  # noqa: E402

from backend.notifications import db as notifications_db  # noqa: E402

MIGRATION = Path(__file__).resolve().parents[3] / "database" / "migrations" / "006_enable_rls_service_only_tables.sql"
EXPOSED_9 = ["users", "wallets", "gpu_deployments", "notification_outbox", "workspace_settings",
             "gpu_inventory", "gpu_maintenance_schedules", "ssh_keys", "notebook_instances"]
ALREADY_RLS = ["notifications", "wallet_transactions"]
LEGACY_INFERENCE = ["api_keys", "inference_requests", "ssh_keys", "notebook_instances"]
PRIVS = "SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER"


def _conn():
    conn = psycopg2.connect(TEST_DB_URL, connect_timeout=5)
    conn.autocommit = True
    return conn


@pytest.fixture(scope="module")
def admin():
    conn = _conn()
    cur = conn.cursor()
    cur.execute("SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user")
    is_super, bypass = cur.fetchone()
    cur.execute("SELECT count(*) FROM pg_roles WHERE rolname IN ('anon', 'authenticated')")
    roles_present = cur.fetchone()[0] == 2
    if is_super or bypass or not roles_present:
        conn.close()
        pytest.skip("needs a non-superuser owner role and the stand-in anon/authenticated roles (see module doc)")
    cur.execute("SELECT pg_has_role(current_user, 'anon', 'MEMBER') AND pg_has_role(current_user, 'authenticated', 'MEMBER')")
    if not cur.fetchone()[0]:
        conn.close()
        pytest.skip("the connection role must be a member of anon and authenticated to impersonate them")
    yield cur
    conn.close()


def _state(cur, table):
    cur.execute("SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = to_regclass(%s)", (f"public.{table}",))
    row = cur.fetchone()
    if row is None:
        return None
    exposed = []
    for role in ("anon", "authenticated"):
        cur.execute("SELECT has_table_privilege(%s, %s, %s)", (role, f"public.{table}", PRIVS))
        if cur.fetchone()[0]:
            exposed.append(role)
    return {"rls": row[0], "forced": row[1], "exposed": exposed}


def _assert_protected(cur, tables):
    for t in tables:
        st = _state(cur, t)
        assert st is not None, f"{t} missing"
        assert st == {"rls": True, "forced": False, "exposed": []}, (t, st)


def _run_migration(cur, text):
    cur.execute(text)  # simple-query protocol: the whole file (SELECTs, BEGIN, DO block, COMMIT) in one call


def _rollback_sql():
    text = MIGRATION.read_text(encoding="utf-8")
    section = text[text.index("-- ── E. Rollback"):]
    return "\n".join(re.sub(r"^-- ?", "", line) for line in section.splitlines()
                     if line.startswith("-- ") and not line.startswith("-- (") and not line.startswith("-- ──")
                     and not line.startswith("-- Do NOT"))


def test_fresh_database_creation_applies_protection(admin):
    cur = admin
    cur.execute("SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")
    assert cur.fetchone()[0] == 0, "expects an empty scratch database (fresh-creation scenario)"
    notifications_db.init_db()
    with notifications_db.DBConnection() as conn:  # lazily created table, inside a transaction
        from backend.notifications import service
        service._workspace_table_ready = False
        service._ensure_workspace_settings_table(conn.cursor())
        conn.commit()
    from inference import database as inference_db  # legacy SQLAlchemy create_all path
    import inference.models  # noqa: F401  registers the legacy tables on Base.metadata (as the app does)
    engine = inference_db.create_app_engine(TEST_DB_URL)
    try:
        inference_db.init_db(target_engine=engine)
    finally:
        engine.dispose()
    # Supabase-style default privileges granted every new table to anon/authenticated; all were revoked again.
    _assert_protected(cur, list(notifications_db.SERVICE_ONLY_TABLES) + LEGACY_INFERENCE)


def test_public_roles_cannot_read_insert_update_or_delete(admin):
    cur = admin
    cur.execute("INSERT INTO wallets (user_id, balance, updated_at) VALUES ('rls-owner-check', 10, now()::text) ON CONFLICT DO NOTHING")
    for role in ("anon", "authenticated"):
        for table in EXPOSED_9 + ALREADY_RLS:
            for stmt in (f"SELECT count(*) FROM public.{table}",
                         f"DELETE FROM public.{table}",
                         f"UPDATE public.{table} SET {_any_column(cur, table)} = {_any_column(cur, table)}"):
                cur.execute(f"SET ROLE {role}")
                try:
                    with pytest.raises(psycopg2.errors.InsufficientPrivilege):
                        cur.execute(stmt)
                finally:
                    cur.execute("RESET ROLE")
        cur.execute(f"SET ROLE {role}")
        try:
            with pytest.raises(psycopg2.errors.InsufficientPrivilege):
                cur.execute("INSERT INTO public.wallets (user_id, balance, updated_at) VALUES ('attacker', 1000000, now()::text)")
        finally:
            cur.execute("RESET ROLE")


def test_rls_still_denies_rows_if_a_grant_reappears(admin):
    # Defence in depth: even if someone re-grants SELECT, RLS without a policy returns no rows.
    cur = admin
    cur.execute("INSERT INTO wallets (user_id, balance, updated_at) VALUES ('rls-row-check', 5, now()::text) ON CONFLICT DO NOTHING")
    cur.execute("GRANT SELECT ON public.wallets TO anon")
    try:
        cur.execute("SET ROLE anon")
        cur.execute("SELECT count(*) FROM public.wallets")
        assert cur.fetchone()[0] == 0
    finally:
        cur.execute("RESET ROLE")
        cur.execute("REVOKE ALL ON public.wallets FROM anon")


def test_owning_service_role_keeps_full_access(admin):
    cur = admin
    cur.execute("INSERT INTO wallets (user_id, balance, updated_at) VALUES ('rls-owner-rw', 1, now()::text) ON CONFLICT (user_id) DO UPDATE SET balance = 1")
    cur.execute("UPDATE wallets SET balance = balance + 41 WHERE user_id = 'rls-owner-rw' RETURNING balance")
    assert float(cur.fetchone()[0]) == 42.0
    cur.execute("DELETE FROM wallets WHERE user_id = 'rls-owner-rw'")
    assert cur.rowcount == 1


def _any_column(cur, table):
    cur.execute("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=%s "
                "ORDER BY ordinal_position LIMIT 1", (table,))
    return cur.fetchone()[0]


def _make_exposed(cur, tables):
    """Recreate the 2026-11-18 state: RLS off, full privileges for anon/authenticated."""
    for t in tables:
        cur.execute(f"ALTER TABLE public.{t} DISABLE ROW LEVEL SECURITY")
        cur.execute(f"GRANT {PRIVS} ON public.{t} TO anon, authenticated")


def test_migration_006_protects_is_idempotent_and_never_grants(admin):
    cur = admin
    _make_exposed(cur, EXPOSED_9)
    text = MIGRATION.read_text(encoding="utf-8")
    _run_migration(cur, text)
    _assert_protected(cur, EXPOSED_9 + ALREADY_RLS)
    _run_migration(cur, text)  # re-run: no error, same result
    _assert_protected(cur, EXPOSED_9 + ALREADY_RLS)
    cur.execute("SELECT count(*) FROM pg_policies WHERE schemaname = 'public'")
    assert cur.fetchone()[0] == 0, "006 must not create policies"


def test_migration_006_refuses_forced_tables_and_changes_nothing(admin):
    cur = admin
    _make_exposed(cur, EXPOSED_9)
    cur.execute("ALTER TABLE public.gpu_inventory FORCE ROW LEVEL SECURITY")
    try:
        with pytest.raises(psycopg2.Error, match="FORCE ROW LEVEL SECURITY"):
            _run_migration(cur, MIGRATION.read_text(encoding="utf-8"))
        cur.execute("ROLLBACK")  # the script's own BEGIN left the session in an aborted transaction
        assert _state(cur, "users") == {"rls": False, "forced": False, "exposed": ["anon", "authenticated"]}
    finally:
        cur.execute("ALTER TABLE public.gpu_inventory NO FORCE ROW LEVEL SECURITY")
    _run_migration(cur, MIGRATION.read_text(encoding="utf-8"))
    _assert_protected(cur, EXPOSED_9 + ALREADY_RLS)


def test_migration_006_rollback_restores_only_the_original_exposure(admin):
    cur = admin
    _run_migration(cur, _rollback_sql())
    for t in EXPOSED_9:
        assert _state(cur, t) == {"rls": False, "forced": False, "exposed": ["anon", "authenticated"]}, t
    _assert_protected(cur, ALREADY_RLS)  # rollback leaves the previously protected tables alone
    _run_migration(cur, MIGRATION.read_text(encoding="utf-8"))  # fix forward again
    _assert_protected(cur, EXPOSED_9 + ALREADY_RLS)


def test_service_startup_repairs_an_exposed_existing_database(admin):
    # Startup on an existing schema takes init_db's fast path; it must still re-apply the protection.
    cur = admin
    _make_exposed(cur, ["wallets", "users"])
    notifications_db.init_db()
    _assert_protected(cur, ["wallets", "users"])
