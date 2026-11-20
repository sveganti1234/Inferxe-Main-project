"""Unit tests (no database) for the service-table RLS protection used at table creation.

notifications.db.protect_service_tables and inference.database.protect_service_tables enable RLS and revoke
anon/authenticated privileges on the tables each service creates. The scratch-DB behaviour is covered by
test_rls_service_tables.py; these tests pin the decision logic with a fake cursor."""

import logging

import psycopg2
import pytest
from psycopg2 import sql

from backend.notifications import db


def _flatten(q):
    if isinstance(q, str):
        return q
    if isinstance(q, sql.Composed):
        return "".join(_flatten(p) for p in q.seq)
    if isinstance(q, sql.Identifier):
        return ".".join(f'"{s}"' for s in q.strings)
    if isinstance(q, sql.SQL):
        return q.string
    raise TypeError(type(q))


class FakeConnection:
    def __init__(self, autocommit):
        self.autocommit = autocommit


class FakeCursor:
    """Answers the catalog queries from a fixture and records every statement."""

    def __init__(self, rls_state, roles, exposed, autocommit=True, fail_on=None):
        self.rls_state, self.roles, self.exposed = rls_state, roles, exposed
        self.connection = FakeConnection(autocommit)
        self.fail_on = fail_on
        self.statements = []
        self._result = None

    def execute(self, query, params=None):
        text = _flatten(query)
        self.statements.append(text)
        if "FROM pg_class" in text:
            self._result = [(t, on) for t, on in self.rls_state.items() if t in params[0]]
        elif "FROM pg_roles" in text:
            self._result = [(r,) for r in self.roles if r in params[0]]
        elif "has_table_privilege" in text:
            role, table, _ = params
            self._result = (role in self.exposed.get(table.split(".", 1)[1], []),)
        elif self.fail_on and self.fail_on in text and text.startswith(("ALTER", "REVOKE")):
            raise psycopg2.errors.InsufficientPrivilege("must be owner")
        else:
            self._result = None

    def fetchall(self):
        return self._result

    def fetchone(self):
        return self._result

    def changes(self):
        return [s for s in self.statements if s.startswith(("ALTER", "REVOKE", "SAVEPOINT", "RELEASE", "ROLLBACK"))]


def test_only_tables_needing_a_change_are_altered():
    cur = FakeCursor(
        rls_state={"wallets": False, "users": True, "notifications": True},
        roles=["anon", "authenticated"],
        exposed={"wallets": ["anon", "authenticated"], "users": ["anon"], "notifications": []},
    )
    changed = db.protect_service_tables(cur)
    assert changed == ["users", "wallets"]
    assert cur.changes() == [
        'REVOKE ALL ON TABLE public."users" FROM "anon";',
        'ALTER TABLE public."wallets" ENABLE ROW LEVEL SECURITY;',
        'REVOKE ALL ON TABLE public."wallets" FROM "anon", "authenticated";',
    ]
    assert not any("GRANT" in s or "FORCE" in s or "POLICY" in s for s in cur.statements)


def test_already_protected_database_is_a_no_op():
    cur = FakeCursor(rls_state={t: True for t in db.SERVICE_ONLY_TABLES}, roles=["anon", "authenticated"], exposed={})
    assert db.protect_service_tables(cur) == []
    assert cur.changes() == []


def test_plain_postgresql_without_supabase_roles_only_enables_rls():
    cur = FakeCursor(rls_state={"wallets": False}, roles=[], exposed={})
    assert db.protect_service_tables(cur) == ["wallets"]
    assert cur.changes() == ['ALTER TABLE public."wallets" ENABLE ROW LEVEL SECURITY;']


def test_inside_a_transaction_each_table_is_isolated_by_a_savepoint(caplog):
    cur = FakeCursor(
        rls_state={"users": False, "wallets": False}, roles=["anon"],
        exposed={"users": ["anon"], "wallets": ["anon"]}, autocommit=False, fail_on='"users"',
    )
    with caplog.at_level(logging.ERROR):
        changed = db.protect_service_tables(cur)
    assert changed == ["wallets"]
    assert cur.changes()[:2] == ["SAVEPOINT protect_service_table;", 'ALTER TABLE public."users" ENABLE ROW LEVEL SECURITY;']
    assert "ROLLBACK TO SAVEPOINT protect_service_table;" in cur.changes()
    assert any("users" in r.getMessage() and "migration 006" in r.getMessage() for r in caplog.records)


def test_autocommit_failure_is_logged_not_raised(caplog):
    cur = FakeCursor(rls_state={"users": False}, roles=[], exposed={}, autocommit=True, fail_on='"users"')
    with caplog.at_level(logging.ERROR):
        assert db.protect_service_tables(cur) == []
    assert not any(s.startswith("SAVEPOINT") for s in cur.statements)


def test_service_only_tables_cover_every_table_the_service_creates():
    assert set(db.SERVICE_ONLY_TABLES) == {
        "users", "notifications", "notification_outbox", "wallets", "wallet_transactions",
        "gpu_inventory", "gpu_deployments", "gpu_maintenance_schedules", "workspace_settings",
    }


def test_inference_protection_is_a_no_op_off_postgresql():
    from sqlalchemy import create_engine
    from inference import database as inference_db
    engine = create_engine("sqlite:///:memory:")
    try:
        assert inference_db.protect_service_tables(engine, ["ssh_keys"]) == []
    finally:
        engine.dispose()
