"""
Security regression tests for the notifications service. No network/database.
Run from the repo root:  python -m pytest backend/notifications/tests/test_security_hardening.py -q
"""

import time

import jwt
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from backend.notifications import auth, main, service
from backend.notifications.auth import AuthenticatedUser, get_current_user
from backend.notifications.service import NotificationService

SECRET = "test-only-admin-session-secret-of-adequate-length"


# ── ix- / dev token bypass removed ───────────────────────────────────────────

@pytest.mark.parametrize("token", ["ix-tok-anything", "ix-admin-123", "admin-dev-token"])
def test_dev_bypass_tokens_rejected(token):
    with pytest.raises(HTTPException) as info:
        auth.verify_cognito_jwt(token)
    assert info.value.status_code == 401


# ── HS256 admin session tokens ───────────────────────────────────────────────

def _hs256(payload, secret=SECRET):
    return jwt.encode(payload, secret, algorithm="HS256")


def _admin_payload(**overrides):
    now = int(time.time())
    # Admin session tokens (backend/auth/adminAuth.js) carry the DB session id (sid) and version (sv).
    payload = {"sub": "usr_admin", "email": "admin@example.test", "role": "admin", "sid": "sess_test",
               "sv": 1, "iat": now, "exp": now + 60}
    payload.update(overrides)
    return payload


@pytest.fixture
def admin_session(monkeypatch):
    """Secret from the environment (read per call) and an active DB session for the token's sid."""
    monkeypatch.setenv("ADMIN_SESSION_SECRET", SECRET)
    lookups = []

    def active_session(session_id, admin_user_id, token_session_version):
        lookups.append((session_id, admin_user_id, token_session_version))
        return {"id": admin_user_id, "email": "admin@example.test", "role": "admin", "session_version": 1}

    monkeypatch.setattr(auth, "_verify_admin_session_in_supabase", active_session)
    return lookups


def test_hs256_rejected_when_secret_not_configured(monkeypatch):
    # Fails closed: no secret means admin tokens cannot be verified at all (503 = not configured).
    monkeypatch.setenv("ADMIN_SESSION_SECRET", "")
    with pytest.raises(HTTPException) as info:
        auth.verify_cognito_jwt(_hs256(_admin_payload()))
    assert info.value.status_code == 503


def test_hs256_rejected_with_old_committed_default_secret(admin_session):
    forged = _hs256(_admin_payload(), secret="inferxe_dev_secret_key_2026_super_secure")
    with pytest.raises(HTTPException) as info:
        auth.verify_cognito_jwt(forged)
    assert info.value.status_code == 401
    assert admin_session == []  # rejected on the signature, before any session lookup


def test_hs256_valid_admin_token_accepted(admin_session):
    user = auth.verify_cognito_jwt(_hs256(_admin_payload()))
    assert user.is_admin and user.user_id == "usr_admin"
    assert admin_session == [("sess_test", "usr_admin", 1)]  # the DB session check was not skipped


@pytest.mark.parametrize("bad", [
    {"role": "customer"},  # signed but not an admin session
    {"role": None},
    {"exp": None},         # expiry required
    {"sub": None},
    {"sid": None},         # session id required (revocation)
    {"sv": None},          # session version required
])
def test_hs256_requires_admin_role_exp_and_sub(admin_session, bad):
    payload = {k: v for k, v in _admin_payload(**bad).items() if v is not None}
    with pytest.raises(HTTPException) as info:
        auth.verify_cognito_jwt(_hs256(payload))
    assert info.value.status_code == 401
    assert admin_session == []


def test_hs256_expired_rejected(admin_session):
    with pytest.raises(HTTPException) as info:
        auth.verify_cognito_jwt(_hs256(_admin_payload(exp=int(time.time()) - 10)))
    assert info.value.status_code == 401


# ── Free wallet credit ───────────────────────────────────────────────────────

@pytest.fixture
def wallet_client(monkeypatch):
    calls = {"recharge": [], "debit": []}
    monkeypatch.setattr(NotificationService, "process_wallet_recharge",
                        classmethod(lambda cls, **kw: calls["recharge"].append(kw) or {"status": "success"}))
    monkeypatch.setattr(NotificationService, "process_wallet_debit",
                        classmethod(lambda cls, **kw: calls["debit"].append(kw) or {"status": "success"}))
    monkeypatch.delenv("WALLET_SELF_RECHARGE_ENABLED", raising=False)

    def as_user(is_admin):
        main.app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
            user_id="u1", email="u1@example.test", roles=["admin" if is_admin else "customer"], claims={})
        return TestClient(main.app)

    yield as_user, calls
    main.app.dependency_overrides.clear()


def test_customer_cannot_credit_own_wallet(wallet_client):
    as_user, calls = wallet_client
    res = as_user(False).post("/api/wallet/transactions", json={"amount": 5000})
    assert res.status_code == 403
    assert calls["recharge"] == []


def test_customer_zero_amount_is_not_a_bypass(wallet_client):
    as_user, calls = wallet_client
    assert as_user(False).post("/api/wallet/transactions", json={"amount": 0}).status_code == 403
    assert calls["recharge"] == []


def test_customer_can_still_debit(wallet_client):
    as_user, calls = wallet_client
    assert as_user(False).post("/api/wallet/transactions", json={"amount": -50}).status_code == 200
    assert calls["debit"][0]["amount"] == 50 and calls["debit"][0]["user_id"] == "u1"


def test_admin_can_recharge(wallet_client):
    as_user, calls = wallet_client
    body = {"amount": 100, "target_user_id": "cust-9", "reason": "goodwill credit"}
    assert as_user(True).post("/api/wallet/transactions", json=body).status_code == 200
    assert len(calls["recharge"]) == 1 and calls["recharge"][0]["user_id"] == "cust-9"


def test_self_recharge_flag_no_longer_allows_customer_top_ups(wallet_client, monkeypatch):
    # Upstream (bd3824a) made top-ups admin-only with an audit reason; the old opt-in flag grants nothing.
    as_user, calls = wallet_client
    monkeypatch.setenv("WALLET_SELF_RECHARGE_ENABLED", "true")
    assert as_user(False).post("/api/wallet/transactions", json={"amount": 100}).status_code == 403
    assert calls["recharge"] == []


# ── GPU deployment isolation (former "usr_demo_admin" identity exemption) ────

class _OneDeployment:
    def __init__(self, autocommit=True):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def cursor(self, *a, **k):
        return self

    def execute(self, *a, **k):
        pass

    def fetchone(self):
        return {"id": "DEP1", "user_id": "owner", "gpu": "NVIDIA L4", "vram": "24 GB",
                "created_at": "2026-01-01T00:00:00+00:00", "status": "Running", "hourly_rate": 60}


@pytest.mark.parametrize("call", [
    lambda uid, **kw: NotificationService.get_gpu_metrics(uid, "DEP1", **kw),
    lambda uid, **kw: NotificationService.get_gpu_recommendations(uid, "DEP1", True, **kw),
])
def test_gpu_endpoints_enforce_ownership(monkeypatch, call):
    monkeypatch.setattr(service, "DBConnection", _OneDeployment)
    for intruder in ("someone-else", "usr_demo_admin"):
        with pytest.raises(PermissionError):
            call(intruder)


# ── RAG document upload requires authentication ──────────────────────────────

@pytest.mark.skipif(not main.RAG_MOUNTED, reason="RAG routes not mounted in this environment")
def test_anonymous_document_upload_rejected(monkeypatch):
    called = []
    monkeypatch.setattr(main, "upload_document_endpoint", lambda *a, **k: called.append(1))
    res = TestClient(main.app).post("/api/documents/upload", json={"filename": "kb.txt", "content": "poison"})
    assert res.status_code == 401
    assert called == []


# ── Cognito audience is required (not skipped when absent) ───────────────────

def _rs256_setup(monkeypatch):
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pub = key.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo).decode()
    auth.register_test_key("aud-test-kid", pub)
    monkeypatch.setattr(auth, "COGNITO_CLIENT_ID", "expected-client")
    priv = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
    return priv


def _rs256(priv, **claims):
    now = int(time.time())
    payload = {"sub": "cognito-user", "email": "c@example.test", "token_use": "id", "iss": auth.COGNITO_ISSUER,
               "iat": now, "exp": now + 300}
    payload.update(claims)
    payload = {k: v for k, v in payload.items() if v is not None}
    return jwt.encode(payload, priv, algorithm="RS256", headers={"kid": "aud-test-kid"})


def test_cognito_token_with_matching_aud_accepted(monkeypatch):
    priv = _rs256_setup(monkeypatch)
    assert auth.verify_cognito_jwt(_rs256(priv, aud="expected-client")).user_id == "cognito-user"


def test_cognito_access_token_rejected_only_id_tokens_accepted(monkeypatch):
    # Upstream (bd3824a) accepts Cognito ID tokens only (aud required, token_use == "id").
    priv = _rs256_setup(monkeypatch)
    with pytest.raises(HTTPException) as info:
        auth.verify_cognito_jwt(_rs256(priv, token_use="access", client_id="expected-client"))
    assert info.value.status_code == 401


@pytest.mark.parametrize("claims", [{"aud": "other-client"}, {"client_id": "other-client"}, {}])
def test_cognito_token_without_matching_audience_rejected(monkeypatch, claims):
    priv = _rs256_setup(monkeypatch)
    with pytest.raises(HTTPException) as info:
        auth.verify_cognito_jwt(_rs256(priv, **claims))
    assert info.value.status_code == 401


# ── GPU deployment lookup: indexed exact match first, case-insensitive fallback ──

def test_find_deployment_uses_exact_match_then_fallback():
    class Cur:
        def __init__(self, rows): self.rows, self.sql = rows, []
        def execute(self, sql, params=None): self.sql.append(sql)
        def fetchone(self): return self.rows.pop(0)
    hit = Cur([{"id": "DEP1"}])
    assert service._find_deployment(hit, "DEP1") == {"id": "DEP1"}
    assert len(hit.sql) == 1 and "WHERE id = %s" in hit.sql[0]  # indexed path only
    miss_then_ci = Cur([None, {"id": "DEP1"}])
    assert service._find_deployment(miss_then_ci, "dep1") == {"id": "DEP1"}
    assert "UPPER(id) = UPPER(%s)" in miss_then_ci.sql[1]
    none = Cur([None, None])
    assert service._find_deployment(none, "nope") is None
