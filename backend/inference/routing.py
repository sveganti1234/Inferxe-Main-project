"""
Server-side workload compatibility + routing (DPR §8-§9).

Deterministic pipeline: estimate memory -> hard gates (memory, policy, budget, speed) -> score -> rank.
Model data and the memory formula come from the central model registry (inference/model_registry.py,
database/datasets/models/model_registry.json). The formula mirrors frontend/src/lib/calc.ts so the console
widgets and the API agree; test_model_registry.py checks frontend/src/data/gpus.ts against the registry.
"""

from typing import Any, Dict, List, Optional

from inference.catalog import load_catalog
from inference.model_registry import estimate_memory_components, get_registry

UTIL = 0.9  # vLLM default gpu_memory_utilization (equals the registry default; asserted in tests)
GPU_COUNTS = (1, 2, 4, 8)
MULTI_GPU_EFFICIENCY = 0.8
HOURS_PER_MONTH = 730

# The quantizations this API accepts (RecommendRequest.quant), with bytes per parameter from the registry.
QUANT_BYTES = {q: get_registry().estimation_quant_bytes[q] for q in ("fp16", "fp8", "int4")}

# id -> (params in billions, FP16 KV-cache bytes per token). Uses the registry's planning parameter counts
# (params_billion), which keeps recommendation results unchanged.
MODELS = {m.key: (m.params_billion, m.kv_bytes_per_token) for m in get_registry().models}

ROUTING_MODES = ("cost", "speed", "balanced")


def estimate_memory(model_id: str, quant: str, context: int, concurrency: int) -> Dict[str, float]:
    params, kv_bytes_per_token = MODELS[model_id]
    m = estimate_memory_components(params, kv_bytes_per_token, QUANT_BYTES[quant], context, concurrency)
    return {"weights_gb": m.weights_gb, "kv_cache_gb": m.kv_cache_gb, "overhead_gb": m.overhead_gb, "need_gb": m.total_gb}


def _evaluate(offer: Dict[str, Any], gpu: Dict[str, Any], memory: Dict[str, float], w: Dict[str, Any]) -> Dict[str, Any]:
    per_gpu_vram = offer["vram_gb"] / max(offer["gpu_count"], 1)
    # shortcut: multi-GPU is priced as N x the 1-GPU offer; replace with real multi-GPU SKUs from provider sync.
    count = next((n for n in GPU_COUNTS if per_gpu_vram * n * UTIL >= memory["need_gb"]), None)
    candidate = {
        "offer_id": offer["id"],
        "provider_id": offer["provider_id"],
        "provider_name": offer["provider_name"],
        "gpu_id": gpu["id"],
        "gpu_name": gpu["name"],
        "region": offer["region"],
        "sovereign_india_hosted": offer["sovereign_india_hosted"],
        "gpu_count": count,
        "usable_vram_gb": None,
        "headroom": None,
        "hourly_rate_inr": None,
        "tokens_per_sec_ceiling": None,
        "state": "eligible",
        "reason": None,
        "score": None,
    }

    providers = w.get("providers") or []
    if providers and offer["provider_id"] not in providers:
        return {**candidate, "state": "excluded", "reason": "provider not in allow-list"}
    if w.get("region") and w["region"].lower() not in offer["region"].lower():
        return {**candidate, "state": "excluded", "reason": "region does not match policy"}
    if w.get("sovereign_only") and not offer["sovereign_india_hosted"]:
        return {**candidate, "state": "excluded", "reason": "not India-sovereign hosted"}
    if count is None:
        return {**candidate, "state": "too-small", "reason": f"needs {memory['need_gb']:.1f} GB, more than {GPU_COUNTS[-1]} GPUs hold"}

    usable = per_gpu_vram * count * UTIL
    rate = offer["on_demand_hourly_inr"] * count
    bandwidth = gpu.get("memory_bandwidth_gbps")
    eff = MULTI_GPU_EFFICIENCY if count > 1 else 1.0
    # Decode is memory-bound: bandwidth / weight bytes is an upper bound per stream, not a benchmark.
    ceiling = bandwidth * count * eff / max(memory["weights_gb"], 0.1) if bandwidth else None
    candidate.update(
        usable_vram_gb=round(usable, 1),
        headroom=round(1 - memory["need_gb"] / usable, 3),
        hourly_rate_inr=round(rate, 2),
        tokens_per_sec_ceiling=round(ceiling, 1) if ceiling is not None else None,
    )

    if w.get("max_hourly_inr") is not None and rate > w["max_hourly_inr"]:
        return {**candidate, "state": "over-budget", "reason": f"₹{rate:.0f}/hr exceeds ₹{w['max_hourly_inr']:.0f}/hr cap"}
    if w.get("min_tokens_per_sec"):
        if ceiling is None:
            return {**candidate, "state": "too-slow", "reason": "no bandwidth data to verify the speed target"}
        if ceiling < w["min_tokens_per_sec"]:
            return {**candidate, "state": "too-slow", "reason": f"ceiling {ceiling:.0f} tok/s below target"}
    return candidate


def recommend(workload: Dict[str, Any]) -> Dict[str, Any]:
    """Rank provider/GPU offers for a workload. `workload` is a validated RecommendRequest dict."""
    catalog = load_catalog()
    memory = estimate_memory(workload["model_id"], workload["quant"], workload["context"], workload["concurrency"])
    evaluated = [_evaluate(o, catalog["gpus"][o["gpu_id"]], memory, workload) for o in catalog["offers"]]
    eligible = [c for c in evaluated if c["state"] == "eligible"]

    mode = workload.get("mode", "cost")
    if eligible:
        min_rate = min(c["hourly_rate_inr"] for c in eligible)
        max_ceiling = max((c["tokens_per_sec_ceiling"] or 0) for c in eligible) or 1
        for c in eligible:
            cost_score = min_rate / c["hourly_rate_inr"] if c["hourly_rate_inr"] else 0
            speed_score = (c["tokens_per_sec_ceiling"] or 0) / max_ceiling
            weight = {"cost": 1.0, "speed": 0.0, "balanced": 0.5}[mode]
            c["score"] = round(weight * cost_score + (1 - weight) * speed_score, 4)
        # Ties break on cheaper rate, then less over-provisioned memory.
        eligible.sort(key=lambda c: (-c["score"], c["hourly_rate_inr"], c["usable_vram_gb"]))

    excluded = [c for c in evaluated if c["state"] != "eligible"]
    note = None
    if not eligible:
        if all(c["state"] in ("too-small", "excluded") for c in excluded):
            note = "No allowed configuration can hold this workload; try lower precision, shorter context or fewer concurrent requests."
        else:
            note = "Compatible GPUs exist but none meets the budget or speed target; relax a constraint."

    return {
        "mode": mode,
        "memory": {k: round(v, 2) for k, v in memory.items()},
        "selected": eligible[0] if eligible else None,
        "candidates": eligible,
        "excluded": excluded,
        "note": note,
    }


def estimate_price(offer_id: str, gpu_count: int, hours: float, storage_gb: float = 0, spot: bool = False) -> Optional[Dict[str, Any]]:
    """Estimated infrastructure cost (DPR §24.3): runtime x provider rate + storage. None if the offer is unknown."""
    offer = next((o for o in load_catalog()["offers"] if o["id"] == offer_id), None)
    if offer is None:
        return None
    use_spot = spot and offer.get("spot_hourly_inr") is not None
    rate = offer["spot_hourly_inr"] if use_spot else offer["on_demand_hourly_inr"]
    compute = rate * gpu_count * hours
    storage = storage_gb * (offer.get("storage_inr_per_gb_month") or 0) * hours / HOURS_PER_MONTH
    return {
        "offer_id": offer_id,
        "provider_id": offer["provider_id"],
        "gpu_id": offer["gpu_id"],
        "gpu_count": gpu_count,
        "hours": hours,
        "pricing": "spot" if use_spot else "on_demand",
        "hourly_rate_inr": round(rate * gpu_count, 2),
        "compute_inr": round(compute, 2),
        "storage_inr": round(storage, 2),
        "total_inr": round(compute + storage, 2),
        "currency": "INR",
        "price_source": offer.get("price_source"),
        "disclaimer": "Planning estimate from the reference rate card; excludes tax and platform fee.",
    }


def summarize_usage(records: List[Any]) -> Dict[str, Any]:
    """Aggregate inference telemetry rows (SupabaseInferenceTelemetryRecord) for /usage."""
    by_model: Dict[str, Dict[str, Any]] = {}
    latencies = [r.latency_ms for r in records if r.latency_ms is not None]
    for r in records:
        m = by_model.setdefault(r.model_name or "unknown", {"requests": 0, "input_tokens": 0, "output_tokens": 0, "cost": 0.0})
        m["requests"] += 1
        m["input_tokens"] += r.input_tokens
        m["output_tokens"] += r.output_tokens
        m["cost"] = round(m["cost"] + r.cost, 6)
    return {
        "requests": len(records),
        "successful": sum(1 for r in records if r.status == "success"),
        "failed": sum(1 for r in records if r.status in ("failed", "timeout")),
        "input_tokens": sum(r.input_tokens for r in records),
        "output_tokens": sum(r.output_tokens for r in records),
        "cost": round(sum(r.cost for r in records), 6),
        "avg_latency_ms": round(sum(latencies) / len(latencies)) if latencies else None,
        "by_model": by_model,
    }
