"""
Security regression tests (P0 #2): Cognito token claims must never grant admin or superadmin on port 8000.

Cognito-verified users resolve as ordinary customers whatever `custom:role`, `role` or `cognito:groups` say. Admin
access comes only from the HS256 admin-session path checked against admin_sessions / admin_users (see
admin_session_fixture.py). No database or network: service calls are replaced by recorders, so each endpoint test
checks the authorisation decision the route makes and passes on.
"""

import time
import uuid
from pathlib import Path

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import HTTPException
from fastapi.testclient import TestClient

from backend.notifications import auth, main
from backend.notifications.service import NotificationService
from backend.notifications.tests.admin_session_fixture import db_backed_admins

_KID = f"role-claims-test-{uuid.uuid4().hex[:6]}"
_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
auth.register_test_key(_KID, _KEY.public_key().public_bytes(
    serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo).decode())

CUSTOMER = "cognito-sub-customer-1"
VICTIM = "cognito-sub-victim-2"


def cognito_token(extra_claims=None, token_use="id", sub=CUSTOMER):
    now = int(time.time())
    claims = {
        "sub": sub, "email": f"{sub}@example.test", "token_use": token_use, "iss": auth.COGNITO_ISSUER,
        "aud": auth.COGNITO_CLIENT_ID or "test-client-id", "iat": now, "exp": now + 600,
    }
    if token_use == "access":
        claims.pop("aud")
        claims["client_id"] = auth.COGNITO_CLIENT_ID or "test-client-id"
    claims.update(extra_claims or {})
    return jwt.encode(claims, _KEY, algorithm="RS256", headers={"kid": _KID})


MALICIOUS_CLAIMS = [
    {"custom:role": "admin"},
    {"custom:role": "superadmin"},
    {"role": "admin"},
    {"role": "superadmin"},
    {"cognito:groups": ["admin"]},
    {"cognito:groups": ["superadmin"]},
    {"cognito:groups": "admin"},                        # string instead of list
    {"custom:role": "Admin"},                           # mixed case
    {"role": "SUPERADMIN"},
    {"cognito:groups": ["Admin", "SuperAdmin"]},
    {"custom:role": "admin", "role": "superadmin", "cognito:groups": ["admin", "superadmin"]},  # combined
    {"custom:role": "customer,admin"},
]
_IDS = [";".join(f"{k}={v}" for k, v in c.items()) for c in MALICIOUS_CLAIMS]


@pytest.mark.parametrize("claims", MALICIOUS_CLAIMS, ids=_IDS)
@pytest.mark.parametrize("token_use", ["id", "access"])
def test_cognito_claims_never_grant_admin(claims, token_use):
    if token_use == "access":  # access tokens are rejected outright (ID tokens only, upstream bd3824a)
        with pytest.raises(HTTPException) as info:
            auth.verify_cognito_jwt(cognito_token(claims, token_use=token_use))
        assert info.value.status_code == 401
        return
    user = auth.verify_cognito_jwt(cognito_token(claims, token_use=token_use))
    assert user.user_id == CUSTOMER
    assert user.roles == []
    assert user.is_admin is False
    assert user.to_dict()["is_admin"] is False


@pytest.fixture
def client(monkeypatch):
    monkeypatch.delenv("WALLET_SELF_RECHARGE_ENABLED", raising=False)
    calls = {}

    def recorder(name, result):
        def record(*args, **kwargs):
            calls.setdefault(name, []).append({**kwargs, "_args": args})
            return result
        return classmethod(lambda cls, *a, **kw: record(*a, **kw)) if name != "chat" else record

    for name in ("process_system_announcement", "process_gpu_price_update", "process_maintenance_schedule",
                 "process_wallet_recharge", "process_deployment_status", "get_gpu_metrics",
                 "get_gpu_recommendations"):
        monkeypatch.setattr(NotificationService, name, recorder(name, {"status": "recorded"}))
    monkeypatch.setattr(main, "_call_rag", recorder("chat", {"history": []}))
    return TestClient(main.app, raise_server_exceptions=False), calls


ADMIN_ONLY = [
    ("post", "/api/notifications/broadcast", {"title": "t", "message": "m"}),
    ("post", "/api/notifications/price-update", {"gpu_id": "gpu-1", "new_price": 1.0}),
    ("post", "/api/gpu/update-price", {"gpu_id": "gpu-1", "new_price": 1.0}),
    ("post", "/api/notifications/maintenance",
     {"gpu_model": "H100", "region": "r", "start_time": "a", "end_time": "b", "reason": "x"}),
]
ATTACKER = {"custom:role": "superadmin", "role": "admin", "cognito:groups": ["admin", "superadmin"]}


@pytest.mark.parametrize("method,path,body", ADMIN_ONLY, ids=[p for _, p, _ in ADMIN_ONLY])
def test_admin_only_endpoints_reject_cognito_users_with_role_claims(client, method, path, body):
    http, calls = client
    res = getattr(http, method)(path, json=body, headers={"Authorization": f"Bearer {cognito_token(ATTACKER)}"})
    assert res.status_code == 403
    assert calls == {}  # the service was never reached


def test_wallet_admin_top_up_is_refused_for_cognito_users_with_role_claims(client):
    http, calls = client
    res = http.post("/api/wallet/transactions", json={"amount": 100000},
                    headers={"Authorization": f"Bearer {cognito_token(ATTACKER)}"})
    assert res.status_code == 403
    assert "process_wallet_recharge" not in calls


@pytest.mark.parametrize("method,path,body,service", [
    ("post", "/api/deployments/status", {"deployment_id": "dep-of-victim", "new_status": "Running"},
     "process_deployment_status"),
    ("get", "/api/gpu/metrics?instance_id=dep-of-victim", None, "get_gpu_metrics"),
    ("post", "/api/gpu/recommendations", {"instance_id": "dep-of-victim"}, "get_gpu_recommendations"),
])
def test_cross_user_deployment_routes_get_no_admin_override(client, method, path, body, service):
    http, calls = client
    kwargs = {"headers": {"Authorization": f"Bearer {cognito_token(ATTACKER)}"}}
    if body is not None:
        kwargs["json"] = body
    getattr(http, method)(path, **kwargs)
    assert calls[service][0]["is_admin"] is False  # ownership is enforced by the service for non-admins
    call = calls[service][0]
    assert call.get("user_id") == CUSTOMER or (call["_args"] and call["_args"][0] == CUSTOMER)


def test_cross_user_chat_history_is_refused_for_cognito_users_with_role_claims(client):
    http, calls = client
    res = http.get(f"/api/chat/history?user_id={VICTIM}",
                   headers={"Authorization": f"Bearer {cognito_token(ATTACKER)}"})
    assert res.status_code == 403
    assert "chat" not in calls


# ── Legitimate, database-backed admins ──────────────────────────────────────────────────────────

def test_database_backed_admin_can_use_admin_endpoints(client):
    http, calls = client
    with db_backed_admins() as admins:
        token = admins.issue(admins.add_admin("adm-ops", "ops@example.test"))
        headers = {"Authorization": f"Bearer {token}"}
        for method, path, body in ADMIN_ONLY:
            assert getattr(http, method)(path, json=body, headers=headers).status_code == 200, path
        credit = {"amount": 500, "target_user_id": VICTIM, "reason": "support credit"}
        assert http.post("/api/wallet/transactions", json=credit, headers=headers).status_code == 200
        http.get("/api/gpu/metrics?instance_id=any-dep", headers=headers)
    assert calls["get_gpu_metrics"][-1]["is_admin"] is True
    assert {"process_system_announcement", "process_gpu_price_update", "process_maintenance_schedule",
            "process_wallet_recharge"} <= set(calls)


def test_database_role_is_authoritative_and_keeps_the_superadmin_distinction():
    with db_backed_admins() as admins:
        admin_token = admins.issue(admins.add_admin("adm-1", "a1@example.test", role="admin"), token_role="superadmin")
        super_token = admins.issue(admins.add_admin("sup-1", "s1@example.test", role="superadmin"))
        admin_user = auth.verify_cognito_jwt(admin_token)
        super_user = auth.verify_cognito_jwt(super_token)
    assert admin_user.roles == ["admin"]  # token claimed superadmin; the database says admin
    assert super_user.roles == ["superadmin", "admin"]
    assert admin_user.is_admin and super_user.is_admin


@pytest.mark.parametrize("scenario", ["expired_token", "expired_db_session", "revoked", "deactivated",
                                      "session_version_bumped", "wrong_secret", "unknown_session"])
def test_invalid_admin_sessions_are_rejected(client, scenario):
    http, calls = client
    with db_backed_admins() as admins:
        admin_id = admins.add_admin("adm-x", "x@example.test")
        if scenario == "expired_token":
            token = admins.issue(admin_id, expires_in=-30, db_session_expires_in=3600)
        elif scenario == "expired_db_session":
            token = admins.issue(admin_id, db_session_expires_in=-30)
        elif scenario == "wrong_secret":
            token = admins.issue(admin_id, secret="another-secret-that-is-also-long-enough-123")
        else:
            token = admins.issue(admin_id)
            if scenario == "revoked":
                admins.revoke_all(admin_id)
            elif scenario == "deactivated":
                admins.deactivate(admin_id)
            elif scenario == "session_version_bumped":
                admins.bump_session_version(admin_id)
            elif scenario == "unknown_session":
                admins.sessions.clear()
        res = http.post("/api/notifications/broadcast", json={"title": "t", "message": "m"},
                        headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 401
    assert calls == {}


def test_cognito_path_never_reads_role_claims():
    source = (Path(auth.__file__)).read_text(encoding="utf-8")
    for claim in ('"custom:role"', "'custom:role'", 'payload.get("role")', '"cognito:groups"'):
        assert claim not in source, f"auth.py must not read {claim} for authorisation"
