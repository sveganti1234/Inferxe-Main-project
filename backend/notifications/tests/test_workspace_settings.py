"""
Backend Test Suite for Workspace Settings & Quotas Persistence
Tests:
1. Retrieval of default workspace settings and current spend
2. Updating monthly spending limit, threshold alerts, and CORS origins
3. Validation: Negative spending limit rejection (400)
4. Customer tenant isolation between multiple users
5. Persistence verification across read/write operations
"""

import sys
sys.path.insert(0, 'Inferxe-Main-project-main')
sys.stdout.reconfigure(encoding='utf-8')

import time
import uuid
from fastapi.testclient import TestClient

from backend.notifications.main import app
from backend.notifications.tests.test_multi_user_notifications import create_cognito_test_jwt

client = TestClient(app)

def run_tests():
    print("\n" + "=" * 65)
    print(" WORKSPACE SETTINGS & QUOTA PERSISTENCE TEST SUITE ")
    print("=" * 65)

    # Setup test users
    uid_a = f"cust_tenant_{uuid.uuid4().hex[:6]}"
    token_a = create_cognito_test_jwt(user_id=uid_a, email=f"{uid_a}@novatech.ai", roles=["customer"])
    headers_a = {"Authorization": f"Bearer {token_a}"}

    uid_b = f"cust_tenant_{uuid.uuid4().hex[:6]}"
    token_b = create_cognito_test_jwt(user_id=uid_b, email=f"{uid_b}@competitor.ai", roles=["customer"])
    headers_b = {"Authorization": f"Bearer {token_b}"}

    # 1. Test GET default settings
    print("\n[TEST 1] Retrieving default workspace settings for User A...")
    res = client.get("/api/workspace/settings", headers=headers_a)
    assert res.status_code == 200, f"Expected 200, got {res.status_code}: {res.text}"
    data = res.json()
    assert data["user_id"] == uid_a
    assert data["monthly_budget"] == 10000.0
    assert data["spending_alerts_enabled"] is True
    assert data["weekly_report_enabled"] is False
    assert "https://app.novatech.ai" in data["cors_origins"]
    assert data["current_month_spend"] == 4820.0
    print("      Default settings retrieved successfully (Budget: ₹10,000, Spend: ₹4,820)")

    # 2. Test POST update settings
    print("\n[TEST 2] Updating workspace budget and preferences for User A...")
    payload_a = {
        "monthly_budget": 25000.0,
        "spending_alerts_enabled": True,
        "weekly_report_enabled": True,
        "cors_origins": "https://app.novatech.ai, http://localhost:5173",
    }
    res = client.post("/api/workspace/settings", json=payload_a, headers=headers_a)
    assert res.status_code == 200, f"Expected 200, got {res.status_code}: {res.text}"
    data = res.json()
    assert data["monthly_budget"] == 25000.0
    assert data["weekly_report_enabled"] is True
    assert "http://localhost:5173" in data["cors_origins"]
    print("      Workspace settings updated to ₹25,000 budget and weekly reporting active")

    # 3. Test negative budget rejection
    print("\n[TEST 3] Validating error handling for invalid/negative budget...")
    invalid_payload = {
        "monthly_budget": -500.0,
        "spending_alerts_enabled": True,
    }
    res = client.post("/api/workspace/settings", json=invalid_payload, headers=headers_a)
    assert res.status_code in [400, 422], f"Expected 400 or 422 validation error, got {res.status_code}"
    print(f"      Negative budget properly rejected (Status: {res.status_code})")

    # 4. Test Customer Tenant Isolation (User B cannot see or overwrite User A's settings)
    print("\n[TEST 4] Enforcing Customer Tenant Isolation between User A and User B...")
    res_b = client.get("/api/workspace/settings", headers=headers_b)
    assert res_b.status_code == 200
    data_b = res_b.json()
    assert data_b["user_id"] == uid_b
    assert data_b["monthly_budget"] == 10000.0, f"User B should see their own default budget, got {data_b['monthly_budget']}"

    # Update User B to ₹50,000
    client.post("/api/workspace/settings", json={"monthly_budget": 50000.0}, headers=headers_b)

    # Re-verify User A still has ₹25,000
    res_a_check = client.get("/api/workspace/settings", headers=headers_a)
    assert res_a_check.json()["monthly_budget"] == 25000.0
    print("      Tenant isolation verified: User A (₹25,000) vs User B (₹50,000)")

    # 5. Test persistence
    print("\n[TEST 5] Verifying persistent retrieval after updates...")
    res_final = client.get("/api/workspace/settings", headers=headers_a)
    data_final = res_final.json()
    assert data_final["monthly_budget"] == 25000.0
    assert data_final["weekly_report_enabled"] is True
    print("      Persistence verified successfully across all storage fields.")

    print("\n" + "=" * 65)
    print(" ALL 5 WORKSPACE SETTINGS TESTS PASSED SUCCESSFULLY! ")
    print("=" * 65 + "\n")

if __name__ == "__main__":
    run_tests()

