"""
Mocked tests for db.init_db() (A2). No database: DBConnection is replaced by a fake
cursor that answers the catalog queries from a scripted schema and records every statement.
Run from the repo root:  python -m pytest backend/notifications/tests/test_init_db_migration.py -q
"""

import pytest

from backend.notifications import db, service


@pytest.fixture(autouse=True)
def protection_calls(monkeypatch):
    """The fake cursors here only script the schema queries; the RLS step (protect_service_tables) has its own
    tests (test_rls_protection_unit.py, test_rls_service_tables.py). Record the calls so these tests can check
    that every path invokes it."""
    calls = []
    monkeypatch.setattr(db, "protect_service_tables", lambda cur, tables=db.SERVICE_ONLY_TABLES: calls.append(tuple(tables)) or [])
    monkeypatch.setattr(service, "protect_service_tables", lambda cur, tables=db.SERVICE_ONLY_TABLES: calls.append(tuple(tables)) or [])
    return calls

TABLES = ["users", "notifications", "notification_outbox", "wallets", "wallet_transactions",
          "gpu_inventory", "gpu_deployments", "gpu_maintenance_schedules"]
MIGRATED = [("notifications", "metadata"), ("notifications", "related_entity_id"), ("notifications", "read_at"),
            ("notification_outbox", "user_id"), ("notification_outbox", "idempotency_key"),
            ("notification_outbox", "retry_count"), ("notification_outbox", "error"),
            ("notification_outbox", "processed_at"), ("wallets", "low_balance_alert_level")]
INDEXES = ["idx_notifications_user_id", "idx_notifications_is_read", "idx_notifications_created_at",
           "idx_outbox_idempotency_key", "idx_outbox_status", "idx_wallet_tx_user_id", "idx_gpu_dep_user_id"]


def full_schema():
    cols = {(t, "id"): ("character varying", 64) for t in TABLES}
    cols.update({k: ("text", None) for k in MIGRATED})
    cols[("wallet_transactions", "id")] = ("uuid", None)
    cols[("wallet_transactions", "parent_transaction_id")] = ("uuid", None)
    cols[("wallet_transactions", "refunded_amount")] = ("numeric", None)
    cols[("wallet_transactions", "source")] = ("character varying", 32)
    return {"cols": cols, "indexes": set(INDEXES), "fks": {("wallet_transactions", "fk_wallet_tx_parent")},
            "bad_parent_values": 0}


class FakeCursor:
    def __init__(self, schema):
        self.schema = schema
        self.statements = []
        self._result = []

    def execute(self, sql, params=None):
        s = " ".join(sql.split())
        self.statements.append(s)
        cols = self.schema["cols"]
        if "FROM information_schema.columns" in s and "ANY(%s)" in s:
            self._result = [(t, c, ty, ln) for (t, c), (ty, ln) in cols.items() if t in params[0]]
        elif "FROM information_schema.columns" in s:
            table, column = params
            self._result = [(cols[(table, column)][0],)] if (table, column) in cols else []
        elif "FROM pg_indexes" in s:
            self._result = [(i,) for i in self.schema["indexes"] if i in params[0]]
        elif "FROM pg_constraint" in s:
            self._result = [fk for fk in self.schema["fks"] if fk[1] in params[0]]
        elif "information_schema.table_constraints" in s:
            self._result = [(1,)] if self.schema["fks"] else []
        elif "SELECT COUNT(*) FROM wallet_transactions" in s:
            self._result = [(self.schema["bad_parent_values"],)]
        else:
            self._result = []

    def fetchall(self):
        return list(self._result)

    def fetchone(self):
        return self._result[0] if self._result else None


class FakeConnMgr:
    cursor_obj = None

    def __init__(self, autocommit=True):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def cursor(self, *args, **kwargs):
        return FakeConnMgr.cursor_obj


def run_init(monkeypatch, schema):
    cur = FakeCursor(schema)
    FakeConnMgr.cursor_obj = cur
    monkeypatch.setattr(db, "DBConnection", FakeConnMgr)
    db.init_db()
    return cur.statements


def ddl(statements):
    return [s for s in statements if s.split()[0] in ("CREATE", "ALTER", "UPDATE")]


def test_fast_path_runs_no_ddl_when_schema_complete(monkeypatch, protection_calls):
    statements = run_init(monkeypatch, full_schema())
    assert len(statements) == 3  # columns, indexes, FK constraints
    assert ddl(statements) == []
    assert protection_calls == [db.SERVICE_ONLY_TABLES]  # the fast path still (re)applies RLS protection


def test_fk_check_compares_names_not_row_tuples(monkeypatch):
    statements = run_init(monkeypatch, full_schema())
    fk_query = next(s for s in statements if "FROM pg_constraint" in s)
    assert "conname = ANY(%s)" in fk_query


def test_full_migration_skips_detail_backfill_without_detail_column(monkeypatch):
    schema = full_schema()
    schema["indexes"] = set()  # force the slow path
    statements = run_init(monkeypatch, schema)
    assert not any("SET message = detail" in s for s in statements)
    assert any("CREATE INDEX IF NOT EXISTS idx_gpu_dep_user_id" in s for s in statements)  # reached the end


def test_full_migration_backfills_detail_on_legacy_db(monkeypatch):
    schema = full_schema()
    schema["indexes"] = set()
    schema["cols"][("notifications", "detail")] = ("text", None)
    statements = run_init(monkeypatch, schema)
    assert any("SET message = detail" in s for s in statements)


def test_parent_uuid_conversion_skipped_when_values_invalid(monkeypatch):
    schema = full_schema()
    schema["cols"][("wallet_transactions", "parent_transaction_id")] = ("character varying", 64)
    schema["fks"] = set()
    schema["bad_parent_values"] = 2
    statements = run_init(monkeypatch, schema)
    assert not any("TYPE UUID" in s for s in statements)
    assert not any("ADD CONSTRAINT fk_wallet_tx_parent" in s for s in statements)
    assert any("CREATE INDEX IF NOT EXISTS idx_gpu_dep_user_id" in s for s in statements)


def test_parent_uuid_conversion_and_fk_when_values_valid(monkeypatch):
    schema = full_schema()
    schema["cols"][("wallet_transactions", "parent_transaction_id")] = ("character varying", 64)
    schema["fks"] = set()
    statements = run_init(monkeypatch, schema)
    assert any("ALTER COLUMN parent_transaction_id TYPE UUID" in s for s in statements)
    assert any("ADD CONSTRAINT fk_wallet_tx_parent" in s for s in statements)


def test_fk_skipped_on_legacy_varchar_ids(monkeypatch):
    schema = full_schema()
    schema["cols"][("wallet_transactions", "id")] = ("character varying", 64)
    schema["fks"] = set()
    statements = run_init(monkeypatch, schema)
    assert not any("ADD CONSTRAINT fk_wallet_tx_parent" in s for s in statements)
    assert any("CREATE INDEX IF NOT EXISTS idx_gpu_dep_user_id" in s for s in statements)


def test_fast_path_error_is_logged_and_full_migration_runs(monkeypatch, caplog):
    class BrokenFirstQuery(FakeCursor):
        def execute(self, sql, params=None):
            if "ANY(%s)" in sql and "information_schema.columns" in sql:
                self.statements.append("broken")
                raise RuntimeError("catalog unavailable")
            super().execute(sql, params)

    cur = BrokenFirstQuery(full_schema())
    FakeConnMgr.cursor_obj = cur
    monkeypatch.setattr(db, "DBConnection", FakeConnMgr)
    db.init_db()
    assert "Schema fast-path check failed (RuntimeError)" in caplog.text
    assert any("CREATE TABLE IF NOT EXISTS users" in s for s in cur.statements)


def test_full_migration_applies_rls_protection(monkeypatch, protection_calls):
    run_init(monkeypatch, {"cols": {}, "indexes": set(), "fks": set(), "bad_parent_values": 0})
    assert protection_calls == [db.SERVICE_ONLY_TABLES]


def test_workspace_settings_ddl_runs_once_per_process(monkeypatch, protection_calls):
    executed = []

    class Cur:
        def execute(self, sql, params=None):
            executed.append(sql)

    monkeypatch.setattr(service, "_workspace_table_ready", False)
    for _ in range(3):
        service._ensure_workspace_settings_table(Cur())
    assert len([s for s in executed if "CREATE TABLE IF NOT EXISTS workspace_settings" in s]) == 1
    assert protection_calls == [("workspace_settings",)]  # protected once, right after creation


def test_workspace_settings_ddl_retried_after_failure(monkeypatch):
    class FailingCur:
        def execute(self, sql, params=None):
            raise RuntimeError("db down")

    monkeypatch.setattr(service, "_workspace_table_ready", False)
    with pytest.raises(RuntimeError):
        service._ensure_workspace_settings_table(FailingCur())
    assert service._workspace_table_ready is False  # next request tries again
