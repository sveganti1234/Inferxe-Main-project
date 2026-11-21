"""
A3/A4 wallet correctness tests. No database: DBConnection is replaced by an in-memory fake
that implements just the statements recharge/debit/outbox issue.
Run from the repo root:  python -m pytest backend/notifications/tests/test_wallet_correctness.py -q
"""

import json
from decimal import Decimal

import psycopg2
import pytest
from fastapi.testclient import TestClient

from backend.notifications import service
from backend.notifications.service import NotificationService, _to_money


class FakeWalletDB:
    """Single-user in-memory wallet + outbox, shared across FakeConn instances."""

    def __init__(self, balance=None):
        self.balance = balance  # None = no wallet row
        self.alert = "NORMAL"
        self.outbox_keys = {}
        self.transactions = []
        self.statements = []
        self.fail_outbox_insert_with_duplicate = False
        self.audit_logs = []


class FakeCursor:
    def __init__(self, conn):
        self.conn = conn
        self.connection = conn
        self.db = conn.db
        self._row = None

    def execute(self, sql, params=None):
        s = " ".join(sql.split())
        self.db.statements.append(s)
        self._row = None
        if s.startswith("SELECT id, status FROM notification_outbox"):
            key = params[0]
            if key in self.db.outbox_keys:
                self._row = {"id": self.db.outbox_keys[key], "status": "PROCESSED"}
        elif s.startswith("INSERT INTO notification_outbox"):
            evt_id, _, _, _, key, _ = params
            if self.db.fail_outbox_insert_with_duplicate:
                self.db.outbox_keys[key] = "evt_concurrent"  # the other transaction won the race
                self.db.fail_outbox_insert_with_duplicate = False
                raise psycopg2.IntegrityError("duplicate key value violates unique constraint")
            self.db.outbox_keys[key] = evt_id
            self._row = {"id": evt_id}
        elif s.startswith("SELECT balance, low_balance_alert_level FROM wallets"):
            if self.db.balance is not None:
                self._row = {"balance": self.db.balance, "low_balance_alert_level": self.db.alert}
        elif s.startswith("INSERT INTO wallets"):
            self.db.balance = params[1]
        elif s.startswith("UPDATE wallets"):
            self.db.balance, self.db.alert = params[0], params[1]
        elif s.startswith("INSERT INTO wallet_transactions"):
            self.db.transactions.append(params)
        elif s.startswith("SELECT role FROM profiles"):
            self._row = {"role": "customer"}
        elif s.startswith("INSERT INTO audit_logs"):
            json.loads(params[1])  # psycopg2 sends the details string as-is; it must already be valid JSON
            self.db.audit_logs.append(params)

    def fetchone(self):
        return self._row


class FakeConn:
    def __init__(self, db, autocommit):
        self.db = db
        self.autocommit = autocommit

    def cursor(self, *args, **kwargs):
        return FakeCursor(self)

    def commit(self):
        pass

    def rollback(self):
        pass


@pytest.fixture
def wallet(monkeypatch):
    db = FakeWalletDB()

    class FakeDBConnection:
        def __init__(self, autocommit=True):
            self.autocommit = autocommit

        def __enter__(self):
            return FakeConn(db, self.autocommit)

        def __exit__(self, *exc):
            return False

    monkeypatch.setattr(service, "DBConnection", FakeDBConnection)
    monkeypatch.setattr(service, "_get_table_columns",
                        lambda cur, table: {"id": "uuid", "direction": "x", "transaction_type": "x"})
    monkeypatch.setattr(NotificationService, "_create_notification_internal",
                        classmethod(lambda cls, cur, **kw: "notif_test"))
    return db


# ── _to_money ────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("bad", [float("nan"), float("inf"), float("-inf"), 0, -5, "abc", None])
def test_to_money_rejects_invalid(bad):
    with pytest.raises(ValueError):
        _to_money(bad)


@pytest.mark.parametrize("raw, expected", [(10.125, "10.13"), (0.1, "0.10"), ("99.999", "100.00"), (5, "5.00")])
def test_to_money_rounds_to_cents(raw, expected):
    assert _to_money(raw) == Decimal(expected)


# ── A4: exact money arithmetic ───────────────────────────────────────────────

def test_debits_are_exact(wallet):
    wallet.balance = Decimal("0.30")
    NotificationService.process_wallet_debit("u1", 0.1, idempotency_key="k1")
    res = NotificationService.process_wallet_debit("u1", 0.2, idempotency_key="k2")
    assert wallet.balance == Decimal("0.00")  # float math gives 5.55e-17
    assert res["remaining_balance"] == 0.0
    assert isinstance(res["amount"], float)  # API still returns floats


def test_recharge_creates_wallet_and_returns_floats(wallet):
    res = NotificationService.process_wallet_recharge("u1", 100.10, idempotency_key="r1")
    assert wallet.balance == Decimal("100.10")
    assert res["status"] == "success"
    assert res["amount"] == 100.1 and res["new_balance"] == 100.1
    assert isinstance(res["new_balance"], float)


def test_admin_credit_audit_log_serialises_decimal_balances(wallet):
    # Regression: Decimal balances in the audit details made json.dumps raise, so every admin credit failed.
    wallet.balance = Decimal("10.25")
    res = NotificationService.process_wallet_recharge(
        "u1", 5, idempotency_key="adm1", admin_credit={"administrator_email": "a@example.test", "reason": "goodwill"})
    assert res["status"] == "success" and wallet.balance == Decimal("15.25")
    details = json.loads(wallet.audit_logs[0][1])
    assert details["balance_before"] == 10.25 and details["balance_after"] == 15.25 and details["reason"] == "goodwill"


def test_debit_insufficient_balance_uses_exact_comparison(wallet):
    wallet.balance = Decimal("10.00")
    with pytest.raises(ValueError, match="Insufficient"):
        NotificationService.process_wallet_debit("u1", 10.01, idempotency_key="d1")
    NotificationService.process_wallet_debit("u1", 10.00, idempotency_key="d2")
    assert wallet.balance == Decimal("0.00")


@pytest.mark.parametrize("bad", [float("nan"), float("inf"), 0, -1])
def test_service_rejects_invalid_amounts_with_existing_messages(wallet, bad):
    with pytest.raises(ValueError, match="Recharge amount must be greater than zero"):
        NotificationService.process_wallet_recharge("u1", bad)
    with pytest.raises(ValueError, match="Debit amount must be greater than zero"):
        NotificationService.process_wallet_debit("u1", bad)


# ── A3: idempotency ──────────────────────────────────────────────────────────

def test_duplicate_key_is_skipped(wallet):
    NotificationService.process_wallet_recharge("u1", 50, idempotency_key="same")
    res = NotificationService.process_wallet_recharge("u1", 50, idempotency_key="same")
    assert res["status"] == "skipped"
    assert wallet.balance == Decimal("50.00")


def test_concurrent_duplicate_inside_transaction_uses_savepoint(wallet):
    wallet.fail_outbox_insert_with_duplicate = True  # another request inserted the key first
    res = NotificationService.process_wallet_recharge("u1", 50, idempotency_key="race")
    assert res["status"] == "skipped"  # previously a 500 (lookup ran on an aborted transaction)
    stmts = wallet.statements
    i_sp, i_ins, i_rb, i_sel = (stmts.index("SAVEPOINT outbox_insert;"),
                                next(i for i, s in enumerate(stmts) if s.startswith("INSERT INTO notification_outbox")),
                                stmts.index("ROLLBACK TO SAVEPOINT outbox_insert;"),
                                max(i for i, s in enumerate(stmts) if s.startswith("SELECT id, status")))
    assert i_sp < i_ins < i_rb < i_sel
    assert wallet.balance is None  # nothing credited


def test_autocommit_outbox_does_not_use_savepoint(wallet):
    evt_id, dup = NotificationService.record_outbox_event("SYSTEM", {"a": 1}, idempotency_key="auto1")
    assert dup is False
    assert not any("SAVEPOINT" in s for s in wallet.statements)


def test_fallback_keys_distinguish_amounts(wallet, monkeypatch):
    keys = []
    real = NotificationService.record_outbox_event.__func__

    def spy(cls, *args, **kwargs):
        keys.append(kwargs["idempotency_key"])
        return real(cls, *args, **kwargs)

    monkeypatch.setattr(NotificationService, "record_outbox_event", classmethod(spy))
    NotificationService.process_wallet_recharge("u1", 100.40)
    NotificationService.process_wallet_recharge("u1", 100.90)
    assert keys[0] != keys[1]  # int(amount) made both "100"
    assert wallet.balance == Decimal("201.30")


# ── Router boundary ──────────────────────────────────────────────────────────

def test_wallet_endpoint_rejects_nan_and_infinity_with_400(wallet):
    # NaN/Infinity are valid JSON to FastAPI's parser. They must be rejected by the service
    # (400), not by a pydantic allow_inf_nan=False guard: the 422 body would echo the NaN
    # input and fail to serialize, turning the rejection into a 500.
    from backend.notifications import main
    from backend.notifications.auth import AuthenticatedUser, get_current_user

    main.app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
        user_id="u1", email="u1@example.test", roles=["admin"], claims={})  # admin: reaches the recharge path too
    wallet.balance = Decimal("100.00")
    try:
        client = TestClient(main.app)
        for raw in ('{"amount": NaN}', '{"amount": Infinity}', '{"amount": -Infinity}'):
            res = client.post("/api/wallet/transactions", content=raw, headers={"Content-Type": "application/json"})
            assert res.status_code == 400, (raw, res.status_code, res.text)
        assert wallet.balance == Decimal("100.00")
        assert wallet.transactions == []
    finally:
        main.app.dependency_overrides.clear()
