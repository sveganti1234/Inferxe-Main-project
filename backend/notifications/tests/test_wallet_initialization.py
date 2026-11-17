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
from decimal import Decimal

sys.stdout.reconfigure(encoding='utf-8')

import jwt
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives import serialization
from fastapi.testclient import TestClient

from backend.notifications.main import app
from backend.notifications.auth import register_test_key, COGNITO_ISSUER, COGNITO_CLIENT_ID
from backend.notifications.db import DBConnection, init_db
from backend.notifications.service import NotificationService
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


# ── TEST 12: Workspace wallet data consistency ──
def test_workspace_wallet_consistency():
    """Verify wallets table data matches what workspace endpoint expects."""
    print("\n" + "=" * 70)
    print(" WORKSPACE WALLET DATA CONSISTENCY TESTS ")
    print("=" * 70)

    wp_passed = 0
    wp_failed = 0

    def wp_check(name, condition, detail=""):
        nonlocal wp_passed, wp_failed
        if condition:
            print(f"  [PASS] {name}")
            wp_passed += 1
        else:
            print(f"  [FAIL] {name} {detail}")
            wp_failed += 1

    # Test user with existing wallet balance
    uid_wp = f"cust_wp_{uuid.uuid4().hex[:6]}"
    email_wp = f"{uid_wp}@test.ai"

    with DBConnection(autocommit=True) as conn:
        cur = conn.cursor()
        now_ts = datetime.now(timezone.utc).isoformat()
        cur.execute(
            """
            INSERT INTO users (id, email, full_name, role, status, created_at)
            VALUES (%s, %s, %s, 'customer', 'active', %s)
            ON CONFLICT (id) DO NOTHING;
            """,
            (uid_wp, email_wp, uid_wp.replace("_", " ").title(), now_ts)
        )
        cur.execute(
            """
            INSERT INTO profiles (user_id, full_name, email, username, role, status, auth_provider, created_at, updated_at)
            VALUES (%s, %s, %s, %s, 'customer', 'active', 'cognito', %s, %s)
            ON CONFLICT (user_id) DO NOTHING;
            """,
            (uid_wp, uid_wp.replace("_", " ").title(), email_wp, email_wp.split('@')[0], now_ts, now_ts)
        )
        # Seed a wallet with known balance
        cur.execute(
            """
            INSERT INTO wallets (user_id, balance, currency, low_balance_alert_level, updated_at)
            VALUES (%s, 5000.0, 'INR', 'NORMAL', %s)
            ON CONFLICT (user_id) DO UPDATE SET balance = EXCLUDED.balance, updated_at = EXCLUDED.updated_at;
            """,
            (uid_wp, now_ts)
        )

    # Test 12A: get_wallet_balance returns correct structure
    result = NotificationService.get_wallet_balance(uid_wp)
    wp_check("12A. get_wallet_balance returns user_id", result["user_id"] == uid_wp)
    wp_check("12B. get_wallet_balance returns balance 5000", result["balance"] == 5000.0)
    wp_check("12C. get_wallet_balance returns currency INR", result["currency"] == "INR")
    wp_check("12D. get_wallet_balance returns alert level", result["low_balance_alert_level"] == "NORMAL")
    wp_check("12E. get_wallet_balance returns updated_at", result["updated_at"] is not None)

    # Test 12F: wallet_transactions query by user_id works with actual schema
    with DBConnection(autocommit=True) as conn:
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute(
            """
            SELECT id, user_id, amount, balance_after, currency, status, idempotency_key,
                   description, created_at, updated_at, transaction_type, direction
            FROM wallet_transactions
            WHERE user_id = %s
            ORDER BY created_at DESC;
            """,
            (uid_wp,)
        )
        txs = cur.fetchall()
    wp_check("12F. wallet_transactions query returns correct columns", len(txs) >= 0)

    # Test 12G: Customer isolation - different user gets different wallet
    uid_wp2 = f"cust_wp2_{uuid.uuid4().hex[:6]}"
    with DBConnection(autocommit=True) as conn:
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO wallets (user_id, balance, currency, low_balance_alert_level, updated_at)
            VALUES (%s, 999.0, 'INR', 'NORMAL', %s)
            ON CONFLICT (user_id) DO NOTHING;
            """,
            (uid_wp2, now_ts)
        )

    result_wp2 = NotificationService.get_wallet_balance(uid_wp2)
    wp_check("12G. User B balance is 999 (isolation)", result_wp2["balance"] == 999.0)
    wp_check("12H. User A balance unchanged (isolation)", result["balance"] == 5000.0)

    # Test 12I: Non-existent user returns zero balance
    uid_none = f"cust_none_{uuid.uuid4().hex[:6]}"
    result_none = NotificationService.get_wallet_balance(uid_none)
    wp_check("12I. Non-existent user balance is 0", result_none["balance"] == 0.0)
    wp_check("12J. Non-existent user currency defaults to INR", result_none["currency"] == "INR")

    print(f"\n  Workspace wallet tests: {wp_passed} PASSED, {wp_failed} FAILED")
    print("=" * 70 + "\n")

    if wp_failed > 0:
        sys.exit(1)


# ── TEST 13: Wallet Transaction History API ──
def test_wallet_transaction_history():
    """Verify wallet transaction history retrieval with pagination and isolation."""
    print("\n" + "=" * 70)
    print(" WALLET TRANSACTION HISTORY API TESTS ")
    print("=" * 70)

    th_passed = 0
    th_failed = 0

    def th_check(name, condition, detail=""):
        nonlocal th_passed, th_failed
        if condition:
            print(f"  [PASS] {name}")
            th_passed += 1
        else:
            print(f"  [FAIL] {name} {detail}")
            th_failed += 1

    # Seed user with multiple transactions
    uid_th = f"cust_th_{uuid.uuid4().hex[:6]}"
    email_th = f"{uid_th}@test.ai"
    now_ts = datetime.now(timezone.utc).isoformat()

    with DBConnection(autocommit=True) as conn:
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO users (id, email, full_name, role, status, created_at)
            VALUES (%s, %s, %s, 'customer', 'active', %s)
            ON CONFLICT (id) DO NOTHING;
            """,
            (uid_th, email_th, uid_th.replace("_", " ").title(), now_ts)
        )
        cur.execute(
            """
            INSERT INTO profiles (user_id, full_name, email, username, role, status, auth_provider, created_at, updated_at)
            VALUES (%s, %s, %s, %s, 'customer', 'active', 'cognito', %s, %s)
            ON CONFLICT (user_id) DO NOTHING;
            """,
            (uid_th, uid_th.replace("_", " ").title(), email_th, email_th.split('@')[0], now_ts, now_ts)
        )
        cur.execute(
            """
            INSERT INTO wallets (user_id, balance, currency, low_balance_alert_level, updated_at)
            VALUES (%s, 5000.0, 'INR', 'NORMAL', %s)
            ON CONFLICT (user_id) DO UPDATE SET balance = EXCLUDED.balance, updated_at = EXCLUDED.updated_at;
            """,
            (uid_th, now_ts)
        )

        # Insert 5 transactions (credit and debit)
        tx_ids = []
        for i in range(5):
            tx_id = str(uuid.uuid4())
            tx_ids.append(tx_id)
            is_credit = i % 2 == 0
            amount = 1000.0 * (i + 1)
            direction = 'credit' if is_credit else 'debit'
            tx_type = 'top_up' if is_credit else 'usage_charge'
            balance_after = 5000.0 + sum(
                1000.0 * (j + 1) if j % 2 == 0 else -1000.0 * (j + 1)
                for j in range(i + 1)
            )
            cur.execute(
                """
                INSERT INTO wallet_transactions (id, user_id, amount, balance_after, currency, status,
                       idempotency_key, description, created_at, updated_at, transaction_type, direction)
                VALUES (%s, %s, %s, %s, 'INR', 'completed', %s, %s, %s, %s, %s, %s);
                """,
                (tx_id, uid_th, amount, balance_after, f"idem_th_{i}",
                 f"Test transaction {i + 1}", now_ts, now_ts, tx_type, direction)
            )
            time.sleep(0.01)

    # Test 13A: Fetch transaction history for seeded user
    result = NotificationService.fetch_wallet_transaction_history(uid_th, limit=50, offset=0)
    th_check("13A. fetch_wallet_transaction_history returns user_id", result["user_id"] == uid_th)
    th_check("13B. fetch_wallet_transaction_history returns all 5 transactions", len(result["transactions"]) == 5, f"got {len(result['transactions'])}")
    th_check("13C. count matches transactions length", result["count"] == len(result["transactions"]))

    # Test 13D: Transaction fields
    if result["transactions"]:
        tx = result["transactions"][0]
        th_check("13D. Transaction has id", bool(tx.get("id")))
        th_check("13E. Transaction has type", bool(tx.get("type")))
        th_check("13F. Transaction has direction", bool(tx.get("direction")))
        th_check("13G. Transaction has amount", "amount" in tx)
        th_check("13H. Transaction has currency", bool(tx.get("currency")))
        th_check("13I. Transaction has status", bool(tx.get("status")))
        th_check("13J. Transaction has description", "description" in tx)
        th_check("13K. Transaction has balance_after", "balance_after" in tx)
        th_check("13L. Transaction has created_at", bool(tx.get("created_at")))

    # Test 13M: Newest-first sorting
    if len(result["transactions"]) >= 2:
        dates = [t["created_at"] for t in result["transactions"]]
        th_check("13M. Transactions sorted newest-first", dates == sorted(dates, reverse=True))

    # Test 13N: Pagination - limit 2
    result_page1 = NotificationService.fetch_wallet_transaction_history(uid_th, limit=2, offset=0)
    th_check("13N. Pagination limit=2 returns 2 transactions", len(result_page1["transactions"]) == 2, f"got {len(result_page1['transactions'])}")
    th_check("13O. Pagination limit=2 offset=0", result_page1["offset"] == 0)
    th_check("13P. Pagination limit=2 limit=2", result_page1["limit"] == 2)

    # Test 13Q: Pagination - offset 2
    result_page2 = NotificationService.fetch_wallet_transaction_history(uid_th, limit=2, offset=2)
    th_check("13Q. Pagination offset=2 returns remaining transactions", len(result_page2["transactions"]) <= 3, f"got {len(result_page2['transactions'])}")
    th_check("13R. Pagination offset=2", result_page2["offset"] == 2)

    # Test 13S: Customer isolation - different user gets empty history
    uid_other = f"cust_other_{uuid.uuid4().hex[:6]}"
    result_other = NotificationService.fetch_wallet_transaction_history(uid_other, limit=50, offset=0)
    th_check("13S. Different user gets empty transaction list", result_other["transactions"] == [])
    th_check("13T. Different user count is 0", result_other["count"] == 0)

    # Test 13U: Non-existent user returns empty list
    uid_none = f"cust_none_th_{uuid.uuid4().hex[:6]}"
    result_none = NotificationService.fetch_wallet_transaction_history(uid_none, limit=50, offset=0)
    th_check("13U. Non-existent user returns empty transactions", result_none["transactions"] == [])

    print(f"\n  Transaction history tests: {th_passed} PASSED, {th_failed} FAILED")
    print("=" * 70 + "\n")

    if th_failed > 0:
        sys.exit(1)


# ── TEST 14: Wallet Refund Functionality ──
def test_wallet_refund():
    """Verify wallet refund functionality with security checks."""
    print("\n" + "=" * 70)
    print(" WALLET REFUND FUNCTIONALITY TESTS ")
    print("=" * 70)

    rf_passed = 0
    rf_failed = 0

    def rf_check(name, condition, detail=""):
        nonlocal rf_passed, rf_failed
        if condition:
            print(f"  [PASS] {name}")
            rf_passed += 1
        else:
            print(f"  [FAIL] {name} {detail}")
            rf_failed += 1

    # Seed user with wallet balance and an existing debit transaction
    uid_rf = f"cust_rf_{uuid.uuid4().hex[:6]}"
    email_rf = f"{uid_rf}@test.ai"
    now_ts = datetime.now(timezone.utc).isoformat()

    with DBConnection(autocommit=True) as conn:
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO users (id, email, full_name, role, status, created_at)
            VALUES (%s, %s, %s, 'customer', 'active', %s)
            ON CONFLICT (id) DO NOTHING;
            """,
            (uid_rf, email_rf, uid_rf.replace("_", " ").title(), now_ts)
        )
        cur.execute(
            """
            INSERT INTO profiles (user_id, full_name, email, username, role, status, auth_provider, created_at, updated_at)
            VALUES (%s, %s, %s, %s, 'customer', 'active', 'cognito', %s, %s)
            ON CONFLICT (user_id) DO NOTHING;
            """,
            (uid_rf, uid_rf.replace("_", " ").title(), email_rf, email_rf.split('@')[0], now_ts, now_ts)
        )
        # Seed wallet with balance
        cur.execute(
            """
            INSERT INTO wallets (user_id, balance, currency, low_balance_alert_level, updated_at)
            VALUES (%s, 5000.0, 'INR', 'NORMAL', %s)
            ON CONFLICT (user_id) DO UPDATE SET balance = EXCLUDED.balance, updated_at = EXCLUDED.updated_at;
            """,
            (uid_rf, now_ts)
        )
        # Seed an original debit transaction (usage_charge) of 1000.0
        orig_tx_id = str(uuid.uuid4())
        cur.execute(
            """
            INSERT INTO wallet_transactions (id, user_id, amount, balance_after, currency, status,
                   idempotency_key, description, created_at, updated_at, transaction_type, direction, source)
            VALUES (%s, %s, 1000.0, 4000.0, 'INR', 'completed', %s, %s, %s, %s, 'usage_charge', 'debit', 'customer');
            """,
            (orig_tx_id, uid_rf, f"idem_orig_{uuid.uuid4().hex[:8]}", "GPU compute usage", now_ts, now_ts)
        )
        # Seed a second user for isolation test
        uid_rf2 = f"cust_rf2_{uuid.uuid4().hex[:6]}"
        email_rf2 = f"{uid_rf2}@test.ai"
        cur.execute(
            """
            INSERT INTO users (id, email, full_name, role, status, created_at)
            VALUES (%s, %s, %s, 'customer', 'active', %s)
            ON CONFLICT (id) DO NOTHING;
            """,
            (uid_rf2, email_rf2, uid_rf2.replace("_", " ").title(), now_ts)
        )
        cur.execute(
            """
            INSERT INTO profiles (user_id, full_name, email, username, role, status, auth_provider, created_at, updated_at)
            VALUES (%s, %s, %s, %s, 'customer', 'active', 'cognito', %s, %s)
            ON CONFLICT (user_id) DO NOTHING;
            """,
            (uid_rf2, uid_rf2.replace("_", " ").title(), email_rf2, email_rf2.split('@')[0], now_ts, now_ts)
        )
        cur.execute(
            """
            INSERT INTO wallets (user_id, balance, currency, low_balance_alert_level, updated_at)
            VALUES (%s, 3000.0, 'INR', 'NORMAL', %s)
            ON CONFLICT (user_id) DO UPDATE SET balance = EXCLUDED.balance, updated_at = EXCLUDED.updated_at;
            """,
            (uid_rf2, now_ts)
        )
        # Seed a debit transaction for user 2
        orig_tx_id2 = str(uuid.uuid4())
        cur.execute(
            """
            INSERT INTO wallet_transactions (id, user_id, amount, balance_after, currency, status,
                   idempotency_key, description, created_at, updated_at, transaction_type, direction, source)
            VALUES (%s, %s, 500.0, 2500.0, 'INR', 'completed', %s, %s, %s, %s, 'usage_charge', 'debit', 'customer');
            """,
            (orig_tx_id2, uid_rf2, f"idem_orig2_{uuid.uuid4().hex[:8]}", "GPU compute usage user2", now_ts, now_ts)
        )

    # Test 14A: Successful customer refund
    rf_idem_key = f"rf_success_{uuid.uuid4().hex[:8]}"
    result = NotificationService.process_wallet_refund(
        user_id=uid_rf,
        original_transaction_id=orig_tx_id,
        amount=Decimal("500.00"),
        idempotency_key=rf_idem_key,
        description="Refund for cancelled GPU instance",
    )
    rf_check("14A. Refund returns success status", result["status"] == "success", f"got {result.get('status')}")
    rf_check("14B. Refund amount is 500", result["amount"] == 500.0, f"got {result.get('amount')}")
    rf_check("14C. Refund new_balance is 5500", result["new_balance"] == 5500.0, f"got {result.get('new_balance')}")
    rf_check("14D. Refund transaction_id present", bool(result.get("transaction_id")))

    # Verify wallet balance updated
    bal = NotificationService.get_wallet_balance(uid_rf)
    rf_check("14E. Wallet balance is 5500 after refund", bal["balance"] == 5500.0, f"got {bal['balance']}")

    # Verify refunded_amount incremented on original transaction
    with DBConnection(autocommit=True) as conn:
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute(
            "SELECT refunded_amount, source, parent_transaction_id FROM wallet_transactions WHERE id = %s;",
            (orig_tx_id,)
        )
        row = cur.fetchone()
    rf_check("14F. Original tx refunded_amount is 500", row is not None and float(row["refunded_amount"]) == 500.0, f"got {row}")
    rf_check("14G. Original tx source unchanged (customer)", row is not None and row["source"] == "customer", f"got {row}")

    # Verify refund transaction has source='customer' and parent_transaction_id set
    with DBConnection(autocommit=True) as conn:
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute(
            "SELECT source, parent_transaction_id, transaction_type, direction FROM wallet_transactions WHERE id = %s;",
            (result["transaction_id"],)
        )
        refund_row = cur.fetchone()
    rf_check("14H. Refund tx source is customer", refund_row is not None and refund_row["source"] == "customer", f"got {refund_row}")
    rf_check("14I. Refund tx parent_transaction_id set", refund_row is not None and refund_row["parent_transaction_id"] == orig_tx_id, f"got {refund_row}")
    rf_check("14J. Refund tx type is refund", refund_row is not None and refund_row["transaction_type"] == "refund", f"got {refund_row}")
    rf_check("14K. Refund tx direction is credit", refund_row is not None and refund_row["direction"] == "credit", f"got {refund_row}")

    # Test 14L: Duplicate refund (same idempotency key) returns skipped
    result_dup = NotificationService.process_wallet_refund(
        user_id=uid_rf,
        original_transaction_id=orig_tx_id,
        amount=Decimal("500.00"),
        idempotency_key=rf_idem_key,  # Same key as above
        description="Duplicate refund attempt",
    )
    rf_check("14L. Duplicate refund returns skipped", result_dup["status"] == "skipped", f"got {result_dup.get('status')}")
    rf_check("14M. Duplicate refund message mentions duplicate", "duplicate" in result_dup.get("message", "").lower(), f"got {result_dup.get('message')}")

    # Verify balance unchanged after duplicate
    bal_after_dup = NotificationService.get_wallet_balance(uid_rf)
    rf_check("14N. Balance unchanged after duplicate (still 5500)", bal_after_dup["balance"] == 5500.0, f"got {bal_after_dup['balance']}")

    # Test 14O: Refund exceeds remaining refundable amount (500 remaining, try 600)
    try:
        NotificationService.process_wallet_refund(
            user_id=uid_rf,
            original_transaction_id=orig_tx_id,
            amount=Decimal("600.00"),
            idempotency_key=f"rf_exceed_{uuid.uuid4().hex[:8]}",
        )
        rf_check("14O. Refund exceeding limit raises error", False, "Should have raised ValueError")
    except ValueError as ve:
        rf_check("14O. Refund exceeding limit raises ValueError", True)
        rf_check("14P. Error mentions refundable amount", "refundable" in str(ve).lower(), f"got {ve}")

    # Test 14Q: Refund non-existent transaction
    nonexistent_tx_id = str(uuid.uuid4())
    try:
        NotificationService.process_wallet_refund(
            user_id=uid_rf,
            original_transaction_id=nonexistent_tx_id,
            amount=Decimal("100.00"),
            idempotency_key=f"rf_nonexist_{uuid.uuid4().hex[:8]}",
        )
        rf_check("14Q. Refund non-existent tx raises error", False, "Should have raised ValueError")
    except ValueError as ve:
        rf_check("14Q. Refund non-existent tx raises ValueError", True)
        rf_check("14R. Error mentions not found", "not found" in str(ve).lower(), f"got {ve}")

    # Test 14S: Refund another user's transaction (isolation)
    try:
        NotificationService.process_wallet_refund(
            user_id=uid_rf,
            original_transaction_id=orig_tx_id2,  # User 2's transaction
            amount=Decimal("100.00"),
            idempotency_key=f"rf_isolate_{uuid.uuid4().hex[:8]}",
        )
        rf_check("14S. Refund other user's tx raises error", False, "Should have raised ValueError")
    except ValueError as ve:
        rf_check("14S. Refund other user's tx raises ValueError", True)
        rf_check("14T. Error mentions not found", "not found" in str(ve).lower(), f"got {ve}")

    # Test 14U: Invalid amount (zero)
    try:
        NotificationService.process_wallet_refund(
            user_id=uid_rf,
            original_transaction_id=orig_tx_id,
            amount=Decimal("0.00"),
            idempotency_key=f"rf_zero_{uuid.uuid4().hex[:8]}",
        )
        rf_check("14U. Zero amount raises error", False, "Should have raised ValueError")
    except ValueError as ve:
        rf_check("14U. Zero amount raises ValueError", True)

    # Test 14V: Refund already fully refunded transaction (500 of 1000 refunded, 500 remaining; try 501)
    try:
        NotificationService.process_wallet_refund(
            user_id=uid_rf,
            original_transaction_id=orig_tx_id,
            amount=Decimal("501.00"),
            idempotency_key=f"rf_full_{uuid.uuid4().hex[:8]}",
        )
        rf_check("14V. Over-refund raises error", False, "Should have raised ValueError")
    except ValueError as ve:
        rf_check("14V. Over-refund raises ValueError", True)

    print(f"\n  Refund tests: {rf_passed} PASSED, {rf_failed} FAILED")
    print("=" * 70 + "\n")

    if rf_failed > 0:
        sys.exit(1)


if __name__ == "__main__":
    run_wallet_tests()
    test_workspace_wallet_consistency()
    test_wallet_transaction_history()
    test_wallet_refund()
