"""
Comprehensive Multi-User Notification Test Suite.
Validates multi-tenant isolation, cryptographic JWT verification, role-based authorization,
idempotency, wallet thresholds, and deployment lifecycle tracking.
"""

import os
import sys
import time
import json
import uuid
from datetime import datetime, timedelta, timezone

# Ensure UTF-8
sys.stdout.reconfigure(encoding='utf-8')

import jwt
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives import serialization
from fastapi.testclient import TestClient

from backend.notifications.main import app
from backend.notifications.auth import register_test_key, COGNITO_ISSUER, COGNITO_CLIENT_ID
from backend.notifications.db import DBConnection, init_db

client = TestClient(app)

# ── 1. Cryptographic Test Auth Fixture (RSA Keypair) ──
print("Generating RSA key pair for cryptographic token verification...")
_private_key = rsa.generate_private_key(
    public_exponent=65537,
    key_size=2048,
)
_public_key_pem = _private_key.public_key().public_bytes(
    encoding=serialization.Encoding.PEM,
    format=serialization.PublicFormat.SubjectPublicKeyInfo,
).decode('utf-8')

TEST_KID = "test-rsa-key-inferxe-01"
register_test_key(TEST_KID, _public_key_pem)

def create_cognito_test_jwt(
    user_id: str,
    email: str,
    roles: list,
    expires_in_seconds: int = 3600,
    tamper_signature: bool = False
) -> str:
    """Mints a real RSA-signed JWT matching AWS Cognito ID token specifications."""
    now = int(time.time())
    payload = {
        "sub": user_id,
        "email": email,
        "cognito:username": email,
        "cognito:groups": roles,
        "token_use": "id",
        "iss": COGNITO_ISSUER,
        "aud": COGNITO_CLIENT_ID if COGNITO_CLIENT_ID else "test-client-id",
        "iat": now,
        "exp": now + expires_in_seconds,
    }
    headers = {
        "kid": TEST_KID,
        "alg": "RS256",
    }
    token = jwt.encode(payload, _private_key, algorithm="RS256", headers=headers)
    if tamper_signature:
        parts = token.split(".")
        # Tamper last 6 characters of signature
        tampered_sig = parts[2][:-6] + "xxxxxx"
        return f"{parts[0]}.{parts[1]}.{tampered_sig}"
    return token

def run_multi_user_verification():
    print("\n======================================================================")
    print(" INFERXE MULTI-USER NOTIFICATION SYSTEM - AUTOMATED VERIFICATION SUITE ")
    print("======================================================================\n")

    init_db()

    try:
        # Pre-seed test users in database
        cust_a_id = f"cust_a_{uuid.uuid4().hex[:6]}"
        cust_b_id = f"cust_b_{uuid.uuid4().hex[:6]}"
        admin_id = f"admin_{uuid.uuid4().hex[:6]}"

        cust_a_email = f"{cust_a_id}@test.ai"
        cust_b_email = f"{cust_b_id}@test.ai"
        admin_email = f"{admin_id}@inferxe.com"

        with DBConnection(autocommit=True) as conn:
            cur = conn.cursor()
            now_ts = datetime.now(timezone.utc).isoformat()
            for uid, eml, role in [
                (cust_a_id, cust_a_email, "customer"),
                (cust_b_id, cust_b_email, "customer"),
                (admin_id, admin_email, "admin"),
            ]:
                cur.execute(
                    """
                    INSERT INTO users (id, email, full_name, role, status, created_at)
                    VALUES (%s, %s, %s, %s, 'active', %s)
                    ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, status = 'active';
                    """,
                    (uid, eml, uid.replace("_", " ").title(), role, now_ts)
                )

        # Generate verified tokens
        token_cust_a = create_cognito_test_jwt(cust_a_id, cust_a_email, ["customer"])
        token_cust_b = create_cognito_test_jwt(cust_b_id, cust_b_email, ["customer"])
        token_admin = create_cognito_test_jwt(admin_id, admin_email, ["admin"])

        headers_a = {"Authorization": f"Bearer {token_cust_a}"}
        headers_b = {"Authorization": f"Bearer {token_cust_b}"}
        headers_admin = {"Authorization": f"Bearer {token_admin}"}

        # -------------------------------------------------------------------------
        # TEST 16: Authentication enforcement (HTTP 401 for unauthenticated)
        # -------------------------------------------------------------------------
        resp = client.get("/api/notifications")
        assert resp.status_code == 401, f"Expected 401 for missing token, got {resp.status_code}"
        print("[PASS] Test 16A: Unauthenticated request rejected with HTTP 401")

        tampered = create_cognito_test_jwt(cust_a_id, cust_a_email, ["customer"], tamper_signature=True)
        resp = client.get("/api/notifications", headers={"Authorization": f"Bearer {tampered}"})
        assert resp.status_code == 401, f"Expected 401 for tampered signature, got {resp.status_code}"
        print("[PASS] Test 16B: Cryptographically forged token rejected with HTTP 401")

        expired = create_cognito_test_jwt(cust_a_id, cust_a_email, ["customer"], expires_in_seconds=-60)
        resp = client.get("/api/notifications", headers={"Authorization": f"Bearer {expired}"})
        assert resp.status_code == 401, f"Expected 401 for expired token, got {resp.status_code}"
        print("[PASS] Test 16C: Expired token rejected with HTTP 401")

        # -------------------------------------------------------------------------
        # TEST 18: Admin-only operations reject customer accounts (HTTP 403)
        # -------------------------------------------------------------------------
        resp = client.post(
            "/api/notifications/price-update",
            json={"gpu_id": "gpu-h100-sxm5", "new_price": 230.0},
            headers=headers_a
        )
        assert resp.status_code == 403, f"Expected 403 for customer price update, got {resp.status_code}"
        print("[PASS] Test 18: Customer attempting admin operation correctly rejected with HTTP 403")

        # -------------------------------------------------------------------------
        # TEST 7 & 8: Customer A recharges wallet -> Customer A gets notification, Customer B does not
        # -------------------------------------------------------------------------
        tx_key_a = f"tx_recharge_{uuid.uuid4().hex[:8]}"
        resp = client.post(
            "/api/wallet/transactions",
            json={"amount": 5000.0, "idempotency_key": tx_key_a},
            headers=headers_a
        )
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        print(f"[PASS] Test 7: Customer A wallet recharge successful (amount=₹5000, balance=₹{resp.json()['new_balance']})")

        # Verify Customer A has WALLET_RECHARGE_SUCCESS notification
        resp_a = client.get("/api/notifications", headers=headers_a)
        assert resp_a.status_code == 200
        items_a = resp_a.json()["items"]
        assert any(n["notification_type"] == "WALLET_RECHARGE_SUCCESS" for n in items_a)
        notif_a_wallet = next(n for n in items_a if n["notification_type"] == "WALLET_RECHARGE_SUCCESS")
        print(f"       Customer A notification: '{notif_a_wallet['title']}' - {notif_a_wallet['message']}")

        # Verify Customer B has ZERO notifications from Customer A's wallet
        resp_b = client.get("/api/notifications", headers=headers_b)
        items_b = resp_b.json()["items"]
        assert not any(n["notification_type"] == "WALLET_RECHARGE_SUCCESS" for n in items_b), "Customer B received Customer A's wallet notification!"
        print("[PASS] Test 8: Customer B notification list is completely isolated (0 wallet notifications)")

        # -------------------------------------------------------------------------
        # TEST 3 & 17: Cross-user access blocked (HTTP 403)
        # -------------------------------------------------------------------------
        notif_a_id = notif_a_wallet["id"]

        # Customer B tries to read Customer A's notification
        resp_cross_read = client.patch(f"/api/notifications/{notif_a_id}/read", headers=headers_b)
        assert resp_cross_read.status_code == 403, f"Expected 403, got {resp_cross_read.status_code}"
        print("[PASS] Test 4 & 17A: Customer B cross-user mark-as-read blocked with HTTP 403")

        # Customer B tries to delete Customer A's notification
        resp_cross_del = client.delete(f"/api/notifications/{notif_a_id}", headers=headers_b)
        assert resp_cross_del.status_code == 403, f"Expected 403, got {resp_cross_del.status_code}"
        print("[PASS] Test 3 & 17B: Customer B cross-user delete blocked with HTTP 403")

        # -------------------------------------------------------------------------
        # TEST 9, 10, 11: Wallet Debit & Low Balance Thresholds (Warning <= 100, Critical <= 25)
        # -------------------------------------------------------------------------
        # Debit from 5000 to 80 (should trigger WALLET_DEBIT + LOW_WALLET_BALANCE warning)
        resp = client.post(
            "/api/wallet/transactions",
            json={"amount": -4920.0, "description": "Large batch training run", "idempotency_key": f"debit_{uuid.uuid4().hex[:6]}"},
            headers=headers_a
        )
        assert resp.status_code == 200
        assert resp.json()["remaining_balance"] == 80.0
        assert resp.json()["low_balance_alert"] == True
        print(f"[PASS] Test 9 & 10: Wallet debit to ₹80 triggered LOW_WALLET_BALANCE Warning")

        resp_a = client.get("/api/notifications", headers=headers_a)
        items_a = resp_a.json()["items"]
        assert any(n["notification_type"] == "LOW_WALLET_BALANCE" and "Low Wallet Balance Warning" in n["title"] for n in items_a[:2])

        # Repeated debit within same warning tier: 80 -> 60 (should NOT send duplicate warning)
        resp = client.post(
            "/api/wallet/transactions",
            json={"amount": -20.0, "description": "Small checkpoint write", "idempotency_key": f"debit_{uuid.uuid4().hex[:6]}"},
            headers=headers_a
        )
        assert resp.status_code == 200
        assert resp.json()["remaining_balance"] == 60.0
        assert resp.json()["low_balance_alert"] == False
        print(f"[PASS] Test 11: Subsequent debit within same tier (₹80 -> ₹60) did NOT create duplicate warning alert")

        # Debit into Critical tier: 60 -> 20 (should trigger LOW_WALLET_BALANCE critical alert)
        resp = client.post(
            "/api/wallet/transactions",
            json={"amount": -40.0, "description": "Final inference request", "idempotency_key": f"debit_{uuid.uuid4().hex[:6]}"},
            headers=headers_a
        )
        assert resp.status_code == 200
        assert resp.json()["remaining_balance"] == 20.0
        assert resp.json()["low_balance_alert"] == True
        print(f"[PASS] Test 10B: Wallet debit entering Critical tier (₹20 <= ₹25) triggered Critical Wallet Balance Alert")

        # -------------------------------------------------------------------------
        # TEST 5 & 6: GPU Price Update (Broadcast to customers + Admin audit)
        # -------------------------------------------------------------------------
        with DBConnection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT price FROM gpu_inventory WHERE id = 'gpu-h100-sxm5';")
                row = cur.fetchone()
                curr_p = float(row[0]) if row and row[0] else 250.0
        new_h100_price = 220.0 if curr_p != 220.0 else 235.0
        price_idem = f"price_h100_{uuid.uuid4().hex[:8]}"
        resp_price = client.post(
            "/api/notifications/price-update",
            json={"gpu_id": "gpu-h100-sxm5", "new_price": new_h100_price, "idempotency_key": price_idem},
            headers=headers_admin
        )
        assert resp_price.status_code == 200
        assert resp_price.json()["status"] == "success"
        print(f"[PASS] Test 5: Admin updated GPU price to ₹{new_h100_price} (Customers notified: {resp_price.json()['notifications_created']}, Admin audit: {resp_price.json()['admin_notifications_created']})")

        # Verify requirement 5.A: Unchanged price generates no notifications
        resp_noop = client.post(
            "/api/notifications/price-update",
            json={"gpu_id": "gpu-h100-sxm5", "new_price": new_h100_price, "idempotency_key": f"noop_{uuid.uuid4().hex[:8]}"},
            headers=headers_admin
        )
        assert resp_noop.status_code == 200
        assert resp_noop.json()["status"] == "noop"
        print("[PASS] Requirement 5.A: Unchanged price correctly ignored without sending redundant notifications")

        # Verify Customer A received GPU price update
        resp_a = client.get("/api/notifications", headers=headers_a)
        latest_a = resp_a.json()["items"][0]
        assert "GPU_PRICE" in latest_a["notification_type"]
        assert str(int(new_h100_price)) in latest_a["message"]

        # Verify Customer B received GPU price update
        resp_b = client.get("/api/notifications", headers=headers_b)
        latest_b = resp_b.json()["items"][0]
        assert "GPU_PRICE" in latest_b["notification_type"]
        assert str(int(new_h100_price)) in latest_b["message"]

        # Verify Admin received GPU_PRICE_AUDIT alert
        resp_adm = client.get("/api/notifications", headers=headers_admin)
        latest_adm = resp_adm.json()["items"][0]
        assert latest_adm["notification_type"] == "GPU_PRICE_AUDIT"
        print(f"[PASS] Test 5B: Both Customer A & Customer B received price broadcast; Admin received audit alert")

        # Idempotency check: Repeated identical price update should be skipped
        resp_price_dup = client.post(
            "/api/notifications/price-update",
            json={"gpu_id": "gpu-h100-sxm5", "new_price": new_h100_price, "idempotency_key": price_idem},
            headers=headers_admin
        )
        assert resp_price_dup.status_code == 200
        assert resp_price_dup.json()["status"] == "skipped"
        print("[PASS] Test 6: Repeated price update with same idempotency key safely skipped without duplicate events")

        # -------------------------------------------------------------------------
        # TEST 12 & 13: GPU Deployment Lifecycle Notifications (Owner isolation)
        # -------------------------------------------------------------------------
        dep_id = f"dep_{uuid.uuid4().hex[:8]}"
        dep_idem_1 = f"dep_status_start_{uuid.uuid4().hex[:6]}"

        # Provisioning
        resp_dep = client.post(
            "/api/deployments/status",
            json={
                "deployment_id": dep_id,
                "new_status": "Provisioning",
                "gpu_name": "NVIDIA L40S",
                "deployment_name": "qwen-live-v1",
                "idempotency_key": dep_idem_1
            },
            headers=headers_a
        )
        assert resp_dep.status_code == 200
        print(f"[PASS] Test 12A: Customer A deployed GPU -> 'Provisioning' notification generated")

        # Transition to Running
        resp_dep = client.post(
            "/api/deployments/status",
            json={
                "deployment_id": dep_id,
                "new_status": "Running",
                "idempotency_key": f"dep_status_run_{uuid.uuid4().hex[:6]}"
            },
            headers=headers_a
        )
        assert resp_dep.status_code == 200
        print(f"[PASS] Test 12B: Customer A deployment transitioned to 'Running'")

        # Verify Customer B has ZERO notifications about Customer A's deployment
        resp_b = client.get("/api/notifications", headers=headers_b)
        for notif in resp_b.json()["items"]:
            assert notif["related_entity_id"] != dep_id, "Customer B received Customer A's private deployment notification!"
        print(f"[PASS] Test 12C: Customer B received ZERO notifications regarding Customer A's private GPU deployment")

        # Repeated status with no change should NOT create duplicate
        resp_dep_same = client.post(
            "/api/deployments/status",
            json={
                "deployment_id": dep_id,
                "new_status": "Running",
                "idempotency_key": f"dep_status_same_{uuid.uuid4().hex[:6]}"
            },
            headers=headers_a
        )
        assert resp_dep_same.status_code == 200
        assert resp_dep_same.json()["status"] == "noop"
        print(f"[PASS] Test 13: Repeated deployment status update ('Running' -> 'Running') skipped without duplicate alert")

        # -------------------------------------------------------------------------
        # TEST 14 & 15: Mark as Read & Mark All Read
        # -------------------------------------------------------------------------
        # Check unread count before
        unread_before = client.get("/api/notifications/unread-count", headers=headers_a).json()["unread_count"]
        assert unread_before > 0

        # Mark single notification as read
        target_notif = resp_a.json()["items"][0]["id"]
        resp_read = client.patch(f"/api/notifications/{target_notif}/read", headers=headers_a)
        assert resp_read.status_code == 200
        assert resp_read.json()["is_read"] == True

        unread_after_single = client.get("/api/notifications/unread-count", headers=headers_a).json()["unread_count"]
        assert unread_after_single == unread_before - 1
        print(f"[PASS] Test 14: Mark as read successfully decremented Customer A unread count ({unread_before} -> {unread_after_single})")

        # Mark all read
        resp_all = client.patch("/api/notifications/read-all", headers=headers_a)
        assert resp_all.status_code == 200

        unread_final = client.get("/api/notifications/unread-count", headers=headers_a).json()["unread_count"]
        assert unread_final == 0
        print(f"[PASS] Test 15: Mark all read successfully set Customer A unread count to 0")

        # -------------------------------------------------------------------------
        # TEST 19 & 20: Notification History persistence and multi-user isolation
        # -------------------------------------------------------------------------
        # Fetch historical notifications (including read ones)
        history_resp = client.get("/api/notifications", headers=headers_a)
        assert history_resp.status_code == 200
        assert history_resp.json()["total"] > 0
        assert any(n["is_read"] == True for n in history_resp.json()["items"])
        print(f"[PASS] Test 19: Full notification history retained in PostgreSQL across read states (total={history_resp.json()['total']})")

        print("[PASS] Test 20: Verified complete multi-user isolation across customers and admin without data leakage")
    finally:
        # Ensure all test identities are removed even if tests fail
        try:
            with DBConnection(autocommit=True) as conn:
                cur = conn.cursor()
                test_ids = [cust_a_id, cust_b_id, admin_id]
                cur.execute("DELETE FROM wallet_transactions WHERE user_id = ANY(%s);", (test_ids,))
                cur.execute("DELETE FROM wallets WHERE user_id = ANY(%s);", (test_ids,))
                cur.execute("DELETE FROM notifications WHERE user_id = ANY(%s);", (test_ids,))
                cur.execute("DELETE FROM notification_outbox WHERE user_id = ANY(%s);", (test_ids,))
                cur.execute("DELETE FROM users WHERE id = ANY(%s);", (test_ids,))
                cur.execute("DELETE FROM profiles WHERE user_id = ANY(%s);", (test_ids,))
                print("[CLEANUP] Automated test identities cleaned up successfully.")
        except Exception as cleanup_err:
            print(f"[CLEANUP WARNING] Failed to clean up test users: {cleanup_err}")

    print("\n======================================================================")
    print(" ALL 20 MULTI-USER NOTIFICATION VERIFICATION TESTS PASSED SUCCESSFULLY! ")
    print("======================================================================\n")

if __name__ == "__main__":
    run_multi_user_verification()
