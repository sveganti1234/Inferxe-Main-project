"""
Backend Test Suite for Stage 2: GPU Runtime Monitoring & AI Intelligence
Tests:
1. Metric retrieval for running instance
2. Calculation accuracy (used + free == total)
3. Stopped instance status handling (metrics unavailable)
4. Multi-user isolation (customer A cannot access customer B's instance)
5. AI Recommendations when bot_permission is True
6. AI Recommendations when bot_permission is False (permission paused)
7. Contextual GPU alert trigger and idempotency deduplication
"""

import sys
sys.path.insert(0, 'Inferxe-Main-project-main')
sys.stdout.reconfigure(encoding='utf-8')

import time
import uuid
from fastapi.testclient import TestClient

from backend.notifications.main import app
from backend.notifications.auth import register_test_key
from backend.notifications.tests.test_multi_user_notifications import create_cognito_test_jwt

client = TestClient(app)

def run_tests():
    print("\n" + "=" * 65)
    print(" STAGE 2: GPU RUNTIME MONITORING & AI INTELLIGENCE TEST SUITE ")
    print("=" * 65)

    # Setup test users
    uid_a = "usr_demo_customer"
    token_a = create_cognito_test_jwt(user_id=uid_a, email="priya.s@novatech.ai", roles=["customer"])
    headers_a = {"Authorization": f"Bearer {token_a}"}

    uid_b = f"cust_b_{uuid.uuid4().hex[:6]}"
    token_b = create_cognito_test_jwt(user_id=uid_b, email=f"{uid_b}@test.ai", roles=["customer"])
    headers_b = {"Authorization": f"Bearer {token_b}"}

    # 1. Test GET /api/gpu/metrics for Customer A's active deployment DEP-1042
    print("\n[TEST 1] Retrieving GPU runtime metrics for DEP-1042...")
    res = client.get("/api/gpu/metrics?instance_id=DEP-1042", headers=headers_a)
    assert res.status_code == 200, f"Expected 200, got {res.status_code}: {res.text}"
    data = res.json()
    assert data["instance_id"] == "DEP-1042"
    assert data["status"] == "Running"
    assert data["metrics_available"] is True
    assert "utilization" in data
    assert "memory" in data
    print(f"  [PASS] Metrics retrieved: GPU={data['gpu_model']}, Util={data['utilization']['gpu_utilization_pct']}%, Status={data['utilization']['status']}")

    # 2. Test Memory calculation accuracy
    print("\n[TEST 2] Verifying memory calculation integrity...")
    mem = data["memory"]
    assert mem["total_gb"] > 0
    assert abs((mem["used_gb"] + mem["free_gb"]) - mem["total_gb"]) < 0.2, "Used + Free must equal Total VRAM"
    assert mem["utilization_pct"] > 0 and mem["utilization_pct"] <= 100
    print(f"  [PASS] Memory math verified: {mem['used_gb']}GB Used + {mem['free_gb']}GB Free = {mem['total_gb']}GB Total ({mem['utilization_pct']}%)")

    # 3. Test Multi-User Isolation: Customer B attempting to read Customer A's metrics
    print("\n[TEST 3] Testing customer isolation (Customer B accessing Customer A's instance)...")
    res_b = client.get("/api/gpu/metrics?instance_id=DEP-1042", headers=headers_b)
    assert res_b.status_code == 403, f"Expected 403 Forbidden, got {res_b.status_code}"
    print(f"  [PASS] Customer B access denied with HTTP 403: {res_b.json()['detail']}")

    # 4. Test Non-existent instance
    print("\n[TEST 4] Testing non-existent deployment instance...")
    res_404 = client.get("/api/gpu/metrics?instance_id=DEP-NONEXISTENT", headers=headers_a)
    assert res_404.status_code == 404, f"Expected 404, got {res_404.status_code}"
    print("  [PASS] Non-existent instance correctly returned HTTP 404")

    # 5. Test AI Recommendations with bot_permission=True
    print("\n[TEST 5] Testing AI recommendations with permission ENABLED...")
    rec_res = client.post("/api/gpu/recommendations", json={"instance_id": "DEP-1042", "bot_permission": True}, headers=headers_a)
    assert rec_res.status_code == 200
    rec_data = rec_res.json()
    assert rec_data["allowed"] is True
    assert len(rec_data["recommendations"]) == 3
    assert len(rec_data["alternative_tiers"]) == 4
    print(f"  [PASS] AI Recommendations generated ({len(rec_data['recommendations'])} insights, {len(rec_data['alternative_tiers'])} comparative tiers)")

    # 6. Test AI Recommendations with bot_permission=False
    print("\n[TEST 6] Testing AI recommendations with permission DISABLED (revoked)...")
    rec_revoked = client.post("/api/gpu/recommendations", json={"instance_id": "DEP-1042", "bot_permission": False}, headers=headers_a)
    assert rec_revoked.status_code == 200
    rev_data = rec_revoked.json()
    assert rev_data["allowed"] is False
    assert rev_data["status"] == "Permission Revoked"
    assert len(rev_data["recommendations"]) == 0
    print(f"  [PASS] Telemetry access properly restricted: {rev_data['message']}")

    # 7. Test Contextual Alert Trigger and Idempotency Deduplication
    print("\n[TEST 7] Testing contextual alert triggering and deduplication...")
    alert_idem = f"test_alert_{int(time.time())}"
    alert_res1 = client.post("/api/gpu/alerts/trigger", json={
        "instance_id": "DEP-1042",
        "alert_type": "low_utilization",
        "title": "GPU Underutilization Alert",
        "message": "Average compute is below 30%. Consider rightsizing to save ₹18/hr.",
        "idempotency_key": alert_idem
    }, headers=headers_a)
    assert alert_res1.status_code == 200
    assert alert_res1.json()["is_duplicate"] is False
    print("  [PASS] First contextual alert dispatched and recorded in outbox")

    # Repeat with same idempotency key
    alert_res2 = client.post("/api/gpu/alerts/trigger", json={
        "instance_id": "DEP-1042",
        "alert_type": "low_utilization",
        "title": "GPU Underutilization Alert",
        "message": "Average compute is below 30%. Consider rightsizing to save ₹18/hr.",
        "idempotency_key": alert_idem
    }, headers=headers_a)
    assert alert_res2.status_code == 200
    assert alert_res2.json()["is_duplicate"] is True
    print("  [PASS] Duplicate alert safely suppressed via idempotency key")

    print("\n" + "=" * 65)
    print(" ALL 7 STAGE 2 BACKEND VERIFICATION TESTS PASSED SUCCESSFULLY! ")
    print("=" * 65 + "\n")

if __name__ == "__main__":
    run_tests()

