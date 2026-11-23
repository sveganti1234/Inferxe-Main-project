"""Catalogue normalization, routing engine and the /gpus, /providers, /recommend, /pricing/estimate, /usage routes."""

import os
import sys
import uuid
from pathlib import Path
from types import SimpleNamespace

os.environ.setdefault("INFERXE_TEST_MODE", "1")
BACKEND_DIR = Path(__file__).resolve().parents[2]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from inference.auth import verify_customer_api_key  # noqa: E402
from inference.catalog import gpu_id, load_catalog  # noqa: E402
from inference.main import app  # noqa: E402
from inference.routing import estimate_memory, estimate_price, recommend  # noqa: E402
from inference.supabase_telemetry import get_telemetry_repository  # noqa: E402

BASE = dict(model_id="llama-3.1-8b", quant="fp16", context=8192, concurrency=8, mode="cost")


def test_gpu_id_joins_dataset_spellings():
    assert gpu_id("NVIDIA H100 SXM") == gpu_id("NVIDIA H100 SXM (80GB)") == "h100"
    assert gpu_id("NVIDIA A100 80GB SXM") == gpu_id("NVIDIA A100 80GB") == "a100-80gb"
    assert gpu_id("NVIDIA H100 NVL") == "h100-nvl"


def test_catalog_separates_hardware_offers_and_list_rate():
    c = load_catalog()
    assert "inferxe-marketplace-list-rate" not in c["providers"]  # our list price is not a provider
    assert c["gpus"]["l4"]["list_rate_inr_hr"] == 60.0
    assert c["gpus"]["h100"]["memory_bandwidth_gbps"] == 3350
    assert c["gpus"]["l4"]["benchmarks"], "dataset_4 benchmarks attach to the GPU they ran on"
    assert {o["provider_id"] for o in c["offers"] if o["gpu_id"] == "h100"} == {
        "jarvislabs-ai", "e2e-networks", "yotta-data-services-shakti-cloud"}


def test_memory_matches_frontend_formula():
    # Same inputs as frontend calc.ts estimateMemory: 8.03*2 + 8192*8*131072/1e9 + (2 + 0.04*16.06)
    m = estimate_memory("llama-3.1-8b", "fp16", 8192, 8)
    assert m["need_gb"] == pytest.approx(16.06 + 8.589934592 + 2.6424)


def test_cost_mode_picks_cheapest_fitting_offer_with_gpu_count():
    s = recommend(BASE)["selected"]
    assert (s["offer_id"], s["gpu_count"], s["hourly_rate_inr"]) == ("jarvislabs-ai:a30", 2, 68.46)


def test_speed_mode_picks_highest_bandwidth():
    assert recommend({**BASE, "mode": "speed"})["selected"]["offer_id"] == "jarvislabs-ai:h200"


def test_policy_gates_are_hard_filters():
    r = recommend({**BASE, "providers": ["e2e-networks"]})
    assert r["selected"]["offer_id"] == "e2e-networks:l40s"
    assert all(c["provider_id"] == "e2e-networks" for c in r["candidates"])
    assert recommend({**BASE, "region": "mumbai"})["selected"]["provider_id"] == "tata-communications-vayu"


def test_speed_target_excludes_unverifiable_and_slow_gpus():
    r = recommend({**BASE, "min_tokens_per_sec": 100})
    assert r["selected"]["offer_id"] == "jarvislabs-ai:a100-80gb"
    states = {c["offer_id"]: c["state"] for c in r["excluded"]}
    assert states["jarvislabs-ai:a30"] == "too-slow"  # no bandwidth data, cannot verify the target


def test_budget_cap_leaves_no_selection_with_note():
    r = recommend({**BASE, "max_hourly_inr": 50})
    assert r["selected"] is None and r["candidates"] == [] and "budget" in r["note"]


def test_workload_too_big_for_anything():
    r = recommend({**BASE, "model_id": "llama-3.1-70b", "context": 131072, "concurrency": 64})
    assert r["selected"] is None and "lower precision" in r["note"]


def test_price_estimate_compute_storage_and_spot():
    e = estimate_price("jarvislabs-ai:h100", gpu_count=2, hours=10, storage_gb=100)
    assert e["compute_inr"] == pytest.approx(291.42 * 2 * 10)
    assert e["storage_inr"] > 0 and e["total_inr"] == pytest.approx(e["compute_inr"] + e["storage_inr"])
    assert estimate_price("jarvislabs-ai:h100", 1, 1, spot=True)["pricing"] == "spot"
    assert estimate_price("nope:h100", 1, 1) is None


class FakeTelemetryRepo:
    def __init__(self, fail=False):
        self.fail, self.decisions = fail, []

    def record_routing_decision(self, **kw):
        if self.fail:
            raise RuntimeError("db down")
        self.decisions.append(kw)
        return "decision-1"

    def list_user_inference_requests(self, user_id, limit=100):
        row = dict(model_name="m", input_tokens=10, output_tokens=5, cost=0.5, latency_ms=100, status="success")
        return [SimpleNamespace(**row), SimpleNamespace(**{**row, "status": "failed", "latency_ms": 300})]


@pytest.fixture
def client():
    key = SimpleNamespace(id=uuid.uuid4(), user_id="user-1", organization_id=None)
    repo = FakeTelemetryRepo()
    app.dependency_overrides[verify_customer_api_key] = lambda: key
    app.dependency_overrides[get_telemetry_repository] = lambda: repo
    with TestClient(app) as c:
        c.repo = repo
        yield c
    app.dependency_overrides.clear()


def test_catalogue_routes_are_public_and_filter(client):
    gpus = client.get("/api/v1/gpus", params={"provider": "e2e-networks"}).json()["gpus"]
    assert {g["id"] for g in gpus} == {"l4", "l40s", "h100"}
    assert all(o["provider_id"] == "e2e-networks" for g in gpus for o in g["offers"])
    assert client.get("/api/v1/providers").json()["count"] == 4


def test_recommend_route_records_decision_for_key_owner(client):
    body = client.post("/api/v1/recommend", json=BASE).json()
    assert body["decision_id"] == "decision-1"
    d = client.repo.decisions[0]
    assert d["user_id"] == "user-1" and d["selected_offer_id"] == body["selected"]["offer_id"]


def test_recommend_survives_recording_failure(client):
    client.repo.fail = True
    r = client.post("/api/v1/recommend", json=BASE)
    assert r.status_code == 200 and r.json()["decision_id"] is None


def test_recommend_rejects_unknown_model(client):
    assert client.post("/api/v1/recommend", json={**BASE, "model_id": "gpt-5"}).status_code == 422


def test_pricing_and_usage_routes(client):
    assert client.post("/api/v1/pricing/estimate", json={"offer_id": "nope", "hours": 1}).status_code == 404
    usage = client.get("/api/v1/usage").json()
    assert (usage["requests"], usage["successful"], usage["failed"], usage["avg_latency_ms"]) == (2, 1, 1, 200)
    assert usage["by_model"]["m"]["input_tokens"] == 20
