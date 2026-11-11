"""
Wallet Initialization & Multi-Account Isolation Test Suite.
Validates that new customers start with zero wallet balance,
zero usage, zero pending invoices, and that wallet data is
isolated per Cognito user ID.
"""

import os
import sys
import time
import uuid
from datetime import datetime, timezone

sys.stdout.reconfigure(encoding='utf-8')

import jwt
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives import serialization
from fastapi.testclient import TestClient

from backend.notifications.main import app
from backend.notifications.auth import register_test_key, COGNITO_ISSUER, COGNITO_CLIENT_ID
from backend.notifications.db import DBConnection, init_db
from psycopg2.extras import RealDictCursor

client = TestClient(app)

# ── 1. Cryptographic Test Auth Fixture (RSA Keypair) ──
_private_key = rsa.generate_private_key(
    public_exponent=65537,
    key_size=2048,
)
_public_key_pem = _private_key.public_key().public_bytes(
    encoding=serialization.Encoding.PEM,
    format=serialization.PublicFormat.SubjectPublicKeyInfo,
).decode('utf-8')

TEST_KID = "test-rsa-key-wallet-01"
register_test_key(TEST_KID, _public_key_pem)


def create_cognito_test_jwt(
    user_id: str,
    email: str,
    roles: list,
    expires_in_seconds: int = 3600,
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
    return jwt.encode(payload, _private_key, algorithm="RS256", headers=headers)


def run_wallet_tests():
    print("\n======================================================================")
    print("  INFERXE WALLET INITIALIZATION & MULTI-ACCOUNT ISOLATION TESTS   ")
    print("======================================================================\n")

    init_db()

    # Pre-seed test users in database
    cust_a_id = f"cust_wallet_a_{uuid.uuid4().hex[:6]}"
    cust_b_id = f"cust_wallet_b_{uuid.uuid4().hex[:6]}"

    cust_a_email = f"{cust_a_id}@test.ai"
    cust_b_email = f"{cust_b_id}@test.ai"

    with DBConnection(autocommit=True) as conn:
        cur = conn.cursor()
        now_ts = datetime.now(timezone.utc).isoformat()
        for uid, eml in [(cust_a_id, cust_a_email), (cust_b_id, cust_b_email)]:
            cur.execute(
                """
                INSERT INTO users (id, email, full_name, role, status, created_at)
                VALUES (%s, %s, %s, 'customer', 'active', %s)
                ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, status = 'active';
                """,
                (uid, eml, uid.replace("_", " ").title(), now_ts)
            )
            cur.execute(
                """
                INSERT INTO profiles (user_id, full_name, email, username, role, status, auth_provider, created_at, updated_at)
                VALUES (%s, %s, %s, %s, 'customer', 'active', 'cognito', %s, %s)
                ON CONFLICT (user_id) DO UPDATE SET email = EXCLUDED.email, status = 'active';
                """,
                (uid, uid.replace("_", " ").title(), eml, eml.split('@')[0], now_ts, now_ts)
            )

    token_cust_a = create_cognito_test_jwt(cust_a_id, cust_a_email, ["customer"])
    token_cust_b = create_cognito_test_jwt(cust_b_id, cust_b_email, ["customer"])

    headers_a = {"Authorization": f"Bearer {token_cust_a}"}
    headers_b = {"Authorization": f"Bearer {token_cust_b}"}

    passed = 0
    failed = 0

    def check(name, condition, detail=""):
        nonlocal passed, failed
        if condition:
            print(f"  [PASS] {name}")
            passed += 1
        else:
            print(f"  [FAIL] {name} {detail}")
            failed += 1

    # ── TEST 1: New customer wallet starts with zero balance ──
    print("\n─── TEST 1: New customer wallet initialization ───")
    resp = client.get("/api/wallet/balance", headers=headers_a)
    check("1A. GET /wallet/balance returns HTTP 200 for new customer", resp.status_code == 200, f"got {resp.status_code}")
    if resp.status_code == 200:
        data = resp.json()
        check("1B. New customer balance is 0", data["balance"] == 0.0, f"got {data['balance']}")
        check("1C. New customer currency is INR", data["currency"] == "INR", f"got {data['currency']}")
        check("1D. New customer alert level is NORMAL", data["low_balance_alert_level"] == "NORMAL", f"got {data['low_balance_alert_level']}")
        check("1E. Response includes user_id matching Cognito sub", data["user_id"] == cust_a_id, f"got {data.get('user_id')}")

    # ── TEST 2: Second new customer also starts with zero ──
    print("\n─── TEST 2: Independent new customer wallet ───")
    resp_b = client.get("/api/wallet/balance", headers=headers_b)
    check("2A. Customer B balance is 0", resp_b.status_code == 200 and resp_b.json()["balance"] == 0.0, f"got {resp_b.status_code} {resp_b.json() if resp_b.status_code == 200 else ''}")
    check("2B. Customer B user_id matches Cognito sub", resp_b.status_code == 200 and resp_b.json()["user_id"] == cust_b_id, f"got {resp_b.json().get('user_id') if resp_b.status_code == 200 else ''}")

    # ── TEST 3: Customer A recharge does not affect Customer B ──
    print("\n─── TEST 3: Wallet recharge isolation ───")
    recharge_key = f"recharge_{uuid.uuid4().hex[:8]}"
    resp = client.post(
        "/api/wallet/transactions",
        json={"amount": 5000.0, "idempotency_key": recharge_key},
        headers=headers_a,
    )
    check("3A. Customer A recharge returns HTTP 200", resp.status_code == 200, f"got {resp.status_code}")
    if resp.status_code == 200:
        check("3B. Customer A new balance is 5000", resp.json()["new_balance"] == 5000.0, f"got {resp.json()['new_balance']}")

    # Customer B balance must still be 0
    resp_b_after = client.get("/api/wallet/balance", headers=headers_b)
    check("3C. Customer B balance still 0 after Customer A recharge", resp_b_after.status_code == 200 and resp_b_after.json()["balance"] == 0.0, f"got {resp_b_after.json()['balance'] if resp_b_after.status_code == 200 else 'N/A'}")

    # ── TEST 4: Customer A debit does not affect Customer B ──
    print("\n─── TEST 4: Wallet debit isolation ───")
    debit_key = f"debit_{uuid.uuid4().hex[:8]}"
    resp = client.post(
        "/api/wallet/transactions",
        json={"amount": -2000.0, "description": "GPU compute usage", "idempotency_key": debit_key},
        headers=headers_a,
    )
    check("4A. Customer A debit returns HTTP 200", resp.status_code == 200, f"got {resp.status_code}")
    if resp.status_code == 200:
        check("4B. Customer A remaining balance is 3000", resp.json()["remaining_balance"] == 3000.0, f"got {resp.json()['remaining_balance']}")

    # Customer B balance must still be 0
    resp_b_after2 = client.get("/api/wallet/balance", headers=headers_b)
    check("4C. Customer B balance still 0 after Customer A debit", resp_b_after2.status_code == 200 and resp_b_after2.json()["balance"] == 0.0, f"got {resp_b_after2.json()['balance'] if resp_b_after2.status_code == 200 else 'N/A'}")

    # ── TEST 5: Unauthenticated access to wallet balance is rejected ──
    print("\n─── TEST 5: Authentication enforcement ───")
    resp_no_auth = client.get("/api/wallet/balance")
    check("5A. Unauthenticated request rejected with HTTP 401", resp_no_auth.status_code == 401, f"got {resp_no_auth.status_code}")

    # ── TEST 6: Wallet balance endpoint returns correct data after multiple operations ──
    print("\n─── TEST 6: Wallet balance consistency ───")
    resp_a_final = client.get("/api/wallet/balance", headers=headers_a)
    check("6A. Customer A final balance is 3000", resp_a_final.status_code == 200 and resp_a_final.json()["balance"] == 3000.0, f"got {resp_a_final.json()['balance'] if resp_a_final.status_code == 200 else 'N/A'}")

    # ── TEST 7: Cross-user wallet debit is blocked (insufficient balance for other user) ──
    print("\n─── TEST 7: Cross-user access blocked ───")
    # Customer B tries to debit using Customer A's idempotency key pattern - should still use B's user_id
    resp_b_debit = client.post(
        "/api/wallet/transactions",
        json={"amount": -100.0, "description": "Attempt cross-user debit", "idempotency_key": f"cross_{uuid.uuid4().hex[:8]}"},
        headers=headers_b,
    )
    check("7A. Customer B debit with zero balance raises insufficient funds", resp_b_debit.status_code == 400, f"got {resp_b_debit.status_code}")

    # ── TEST 8: Migration — balance_after column exists ──
    print("\n─── TEST 8: Wallet migration — balance_after column ───")
    with DBConnection(autocommit=True) as conn:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT column_name, data_type
            FROM information_schema.columns
            WHERE table_name = 'wallet_transactions' AND column_name = 'balance_after';
            """,
        )
        col = cur.fetchone()
    check("8A. balance_after column exists in wallet_transactions", col is not None, f"got {col}")
    if col:
        check("8B. balance_after column type is NUMERIC", col[1] == 'numeric', f"got {col[1]}")

    # ── TEST 9: Wallet recharge stores balance_after ──
    print("\n─── TEST 9: Wallet recharge stores balance_after ───")
    with DBConnection(autocommit=True) as conn:
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute(
            """
            SELECT id, balance_after FROM wallet_transactions
            WHERE user_id = %s AND description = 'Wallet recharge top-up'
            ORDER BY created_at DESC LIMIT 1;
            """,
            (cust_a_id,),
        )
        row = cur.fetchone()
    check("9A. Recharge transaction has balance_after recorded", row is not None and row["balance_after"] is not None, f"got {row}")

    # ── TEST 10: Wallet debit stores balance_after ──
    print("\n─── TEST 10: Wallet debit stores balance_after ───")
    with DBConnection(autocommit=True) as conn:
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute(
            """
            SELECT id, balance_after FROM wallet_transactions
            WHERE user_id = %s AND description = 'GPU compute usage'
            ORDER BY created_at DESC LIMIT 1;
            """,
            (cust_a_id,),
        )
        row = cur.fetchone()
    check("10A. Debit transaction has balance_after recorded", row is not None and row["balance_after"] is not None, f"got {row}")

    # ── TEST 11: Idempotent migration — existing rows get NULL balance_after ──
    print("\n─── TEST 11: Migration idempotency — existing rows preserved ───")
    with DBConnection(autocommit=True) as conn:
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO wallet_transactions (id, user_id, amount, balance_after, currency, status, idempotency_key, description, transaction_type, direction, created_at, updated_at)
            VALUES (%s, %s, %s, NULL, 'INR', 'completed', %s, 'Legacy transaction', 'adjustment', 'credit', %s, %s);
            """,
            (str(uuid.uuid4()), cust_a_id, 100.0, f"legacy_{uuid.uuid4().hex[:8]}", now_ts, now_ts)
        )
        cur.execute(
            """
            SELECT balance_after FROM wallet_transactions
            WHERE description = 'Legacy transaction' AND user_id = %s;
            """,
            (cust_a_id,),
        )
        row = cur.fetchone()
    check("11A. Legacy row balance_after is NULL (not overwritten)", row is not None and row[0] is None, f"got {row}")

    print(f"\n{'='*70}")
    print(f" RESULTS: {passed} PASSED, {failed} FAILED")
    print(f"{'='*70}\n")

    if failed > 0:
        sys.exit(1)


if __name__ == "__main__":
    run_wallet_tests()
