"""
Deployment status authorization and refund input validation. No database: in-memory fakes.
Run from the repo root:  python -m pytest backend/notifications/tests/test_deployment_and_refund_security.py -q
"""

from decimal import Decimal

import pytest

from backend.notifications import service
from backend.notifications.service import NotificationService


class FakeDB:
    def __init__(self):
        self.deployments = {}
        self.outbox = {}
        self.statements = []
        self.notified = []


class FakeCursor:
    def __init__(self, db):
        self.db = db
        self.connection = type("C", (), {"autocommit": False})()
        self._row = None

    def execute(self, sql, params=None):
        s = " ".join(sql.split())
        self.db.statements.append(s)
        self._row = None
        if s.startswith("SELECT id, user_id, status, name, gpu, region FROM gpu_deployments"):
            self._row = self.db.deployments.get(params[0])
        elif s.startswith("SELECT id, status FROM notification_outbox"):
            if params[0] in self.db.outbox:
                self._row = {"id": self.db.outbox[params[0]], "status": "PROCESSED"}
        elif s.startswith("INSERT INTO notification_outbox"):
            self.db.outbox[params[4]] = params[0]
        elif s.startswith("UPDATE gpu_deployments"):
            self.db.deployments[params[3]]["status"] = params[0]
        elif s.startswith("INSERT INTO gpu_deployments"):
            dep_id, user_id, name, gpu, region, status = params[:6]
            self.db.deployments[dep_id] = {"id": dep_id, "user_id": user_id, "status": status,
                                           "name": name, "gpu": gpu, "region": region}
        elif s.startswith("SELECT balance, currency FROM wallets"):
            self._row = {"balance": Decimal("100.00"), "currency": "INR"}

    def fetchone(self):
        return self._row


@pytest.fixture
def db(monkeypatch):
    fake = FakeDB()

    class Conn:
        def __init__(self, autocommit=True):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def cursor(self, *a, **k):
            return FakeCursor(fake)

        def commit(self):
            pass

        def rollback(self):
            pass

    monkeypatch.setattr(service, "DBConnection", Conn)
    monkeypatch.setattr(service, "_get_table_columns", lambda cur, table: {"id": "uuid"})
    monkeypatch.setattr(NotificationService, "_create_notification_internal",
                        classmethod(lambda cls, cur, **kw: fake.notified.append(kw["user_id"]) or "n1"))
    return fake


def set_status(db, user, dep_id, status, admin=False, key=None):
    return NotificationService.process_deployment_status(
        user_id=user, deployment_id=dep_id, new_status=status, idempotency_key=key, is_admin=admin)


def test_unknown_status_rejected(db):
    with pytest.raises(ValueError, match="Unsupported deployment status"):
        set_status(db, "u1", "d1", "Hacked")
    assert db.deployments == {}


@pytest.mark.parametrize("status", ["Running", "Failed", "running"])
def test_customer_cannot_claim_system_statuses(db, status):
    with pytest.raises(PermissionError):
        set_status(db, "u1", "d1", status)


def test_customer_lifecycle_create_stop_terminate(db):
    assert set_status(db, "u1", "d1", "Provisioning")["status"] == "success"
    assert set_status(db, "u1", "d1", "stopped")["new_status"] == "Stopped"  # case-insensitive
    assert set_status(db, "u1", "d1", "Terminated")["status"] == "success"
    assert db.deployments["d1"]["status"] == "Terminated"


def test_new_deployment_must_start_provisioning(db):
    with pytest.raises(ValueError, match="Provisioning"):
        set_status(db, "u1", "d-new", "Stopped")


def test_terminated_is_final(db):
    set_status(db, "u1", "d1", "Provisioning")
    set_status(db, "u1", "d1", "Terminated")
    with pytest.raises(ValueError, match="terminated"):
        set_status(db, "u1", "d1", "Provisioning")
    with pytest.raises(ValueError, match="terminated"):
        set_status(db, "admin", "d1", "Running", admin=True)


def test_customer_cannot_touch_other_customers_deployment(db):
    set_status(db, "owner", "d1", "Provisioning")
    with pytest.raises(PermissionError):
        set_status(db, "intruder", "d1", "Stopped")


def test_rejected_request_does_not_consume_idempotency_key(db):
    set_status(db, "owner", "d1", "Provisioning")
    with pytest.raises(PermissionError):
        set_status(db, "intruder", "d1", "Stopped", key="k-stop")
    assert "k-stop" not in db.outbox
    assert set_status(db, "owner", "d1", "Stopped", key="k-stop")["status"] == "success"


def test_admin_can_report_running_and_owner_is_notified(db):
    set_status(db, "owner", "d1", "Provisioning")
    db.notified.clear()
    assert set_status(db, "admin", "d1", "Running", admin=True)["new_status"] == "Running"
    assert db.notified == ["owner"]


def test_route_maps_errors_to_400_and_403(db):
    from fastapi.testclient import TestClient
    from backend.notifications import main
    from backend.notifications.auth import AuthenticatedUser, get_current_user

    main.app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
        user_id="u1", email="u1@example.test", roles=["customer"], claims={})
    try:
        client = TestClient(main.app)
        assert client.post("/api/deployments/status", json={"deployment_id": "d9", "new_status": "Bogus"}).status_code == 400
        assert client.post("/api/deployments/status", json={"deployment_id": "d9", "new_status": "Running"}).status_code == 403
        assert client.post("/api/deployments/status", json={"deployment_id": "d9", "new_status": "Provisioning"}).status_code == 200
    finally:
        main.app.dependency_overrides.clear()


# ── Refund input validation ──────────────────────────────────────────────────

@pytest.mark.parametrize("bad_id", ["not-a-uuid", "1; DROP TABLE wallet_transactions", ""])
def test_refund_malformed_transaction_id_is_400_not_500(db, bad_id):
    with pytest.raises(ValueError, match="not found or does not belong"):
        NotificationService.process_wallet_refund(
            user_id="u1", original_transaction_id=bad_id, amount=Decimal("1.00"), idempotency_key="rf1")
    assert not any(s.startswith("SELECT id, user_id, amount, currency") for s in db.statements)
