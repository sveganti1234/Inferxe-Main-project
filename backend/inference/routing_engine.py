"""
routing_engine.py
=================
Automated Backend Placement & Routing Decision Engine for DPR (§7.4–§7.5, §10).
Evaluates open-model workloads (weights, KV cache, context, concurrency, quantization)
against provider GPU catalogs (Mock, JarvisLabs, Sovereign nodes) and produces
deterministic, multi-criteria placement recommendations.
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional

from inference.model_registry import estimate_memory_components, get_registry


class PriorityEnum(str, Enum):
    COST = "cost"
    SPEED = "speed"
    POLICY = "policy"


class QuantizationEnum(str, Enum):
    FP16 = "fp16"
    FP8 = "fp8"
    INT8 = "int8"
    INT4 = "int4"


# Bytes per parameter by quantization, from the central model registry.
QUANT_BYTES_MAP: Dict[str, float] = dict(get_registry().estimation_quant_bytes)


@dataclass(frozen=True)
class ModelSpec:
    id: str
    family: str
    name: str
    params_billion: float
    kv_bytes_per_token: int
    architecture: str


# Built from the central model registry, in registry order (which is the order /routing/catalogue lists).
# params_billion is the registry's planning value, which keeps placement results unchanged.
REFERENCE_MODELS: Dict[str, ModelSpec] = {
    m.key: ModelSpec(
        id=m.key,
        family=m.family,
        name=m.display_name,
        params_billion=m.params_billion,
        kv_bytes_per_token=m.kv_bytes_per_token,
        architecture=m.architecture_label,
    )
    for m in get_registry().models
}


@dataclass(frozen=True)
class HardwareSpec:
    gpu_id: str
    name: str
    vram_gb: float
    memory_bandwidth_gbps: float
    hourly_rate_inr: float
    hourly_rate_usd: float
    architecture: str
    provider: str = "Mock/JarvisLabs"


REFERENCE_HARDWARE: Dict[str, HardwareSpec] = {
    "l4": HardwareSpec(
        gpu_id="l4",
        name="NVIDIA L4",
        vram_gb=24.0,
        memory_bandwidth_gbps=300.0,
        hourly_rate_inr=41.0,
        hourly_rate_usd=0.44,
        architecture="Ada Lovelace",
    ),
    "l40s": HardwareSpec(
        gpu_id="l40s",
        name="NVIDIA L40S",
        vram_gb=48.0,
        memory_bandwidth_gbps=864.0,
        hourly_rate_inr=118.0,
        hourly_rate_usd=1.25,
        architecture="Ada Lovelace",
    ),
    "h100": HardwareSpec(
        gpu_id="h100",
        name="NVIDIA H100 SXM5",
        vram_gb=80.0,
        memory_bandwidth_gbps=3350.0,
        hourly_rate_inr=330.0,
        hourly_rate_usd=3.49,
        architecture="Hopper",
    ),
    "h200": HardwareSpec(
        gpu_id="h200",
        name="NVIDIA H200 141GB",
        vram_gb=141.0,
        memory_bandwidth_gbps=4800.0,
        hourly_rate_inr=480.0,
        hourly_rate_usd=5.10,
        architecture="Hopper",
    ),
    "a100-80gb": HardwareSpec(
        gpu_id="a100-80gb",
        name="NVIDIA A100 PCIe 80GB",
        vram_gb=80.0,
        memory_bandwidth_gbps=2039.0,
        hourly_rate_inr=220.0,
        hourly_rate_usd=2.60,
        architecture="Ampere",
    ),
}

DEFAULT_TOPOLOGY_CONFIGS = [
    {"gpu_id": "l4", "count": 1},
    {"gpu_id": "l40s", "count": 1},
    {"gpu_id": "a100-80gb", "count": 1},
    {"gpu_id": "h100", "count": 1},
    {"gpu_id": "h200", "count": 1},
    {"gpu_id": "h100", "count": 2},
    {"gpu_id": "h100", "count": 4},
    {"gpu_id": "h100", "count": 8},
]

VLLM_USABLE_FRACTION = 0.90  # Default gpu_memory_utilization = 0.90


@dataclass
class MemoryBreakdown:
    weights_gb: float
    kv_cache_gb: float
    overhead_gb: float
    total_needed_gb: float

    def to_dict(self) -> Dict[str, float]:
        return {
            "weights_gb": round(self.weights_gb, 2),
            "kv_cache_gb": round(self.kv_cache_gb, 2),
            "overhead_gb": round(self.overhead_gb, 2),
            "total_needed_gb": round(self.total_needed_gb, 2),
        }


@dataclass
class PlacementCandidate:
    key: str
    label: str
    gpu_id: str
    count: int
    total_vram_gb: float
    usable_vram_gb: float
    rate_inr_hr: float
    rate_usd_hr: float
    decode_tps_ceiling: float
    state: str  # "recommended", "fits", "too-small", "over-budget", "too-slow"
    headroom_pct: float
    score: float = 0.0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "key": self.key,
            "label": self.label,
            "gpu_id": self.gpu_id,
            "count": self.count,
            "total_vram_gb": round(self.total_vram_gb, 1),
            "usable_vram_gb": round(self.usable_vram_gb, 1),
            "rate_inr_hr": round(self.rate_inr_hr, 2),
            "rate_usd_hr": round(self.rate_usd_hr, 2),
            "decode_tps_ceiling": round(self.decode_tps_ceiling, 1),
            "state": self.state,
            "headroom_pct": round(self.headroom_pct * 100.0, 1),
            "score": round(self.score, 3),
        }


def calculate_memory_demand(
    model_id: str,
    quantization: str = "fp16",
    context_tokens: int = 4096,
    concurrency: int = 1,
) -> MemoryBreakdown:
    """Computes exact VRAM footprint for model weights, PagedAttention KV cache, and CUDA overhead."""
    model = REFERENCE_MODELS.get(model_id.lower())
    if not model:
        # Fallback heuristic for arbitrary model parameter count (assume 8B default)
        model = REFERENCE_MODELS["llama-3.1-8b"]

    bytes_per_param = QUANT_BYTES_MAP.get(quantization.lower(), 2.0)
    m = estimate_memory_components(
        model.params_billion, model.kv_bytes_per_token, bytes_per_param, context_tokens, concurrency
    )

    return MemoryBreakdown(
        weights_gb=m.weights_gb,
        kv_cache_gb=m.kv_cache_gb,
        overhead_gb=m.overhead_gb,
        total_needed_gb=m.total_gb,
    )


def evaluate_placement(
    model_id: str,
    quantization: str = "fp16",
    context_tokens: int = 4096,
    concurrency: int = 1,
    priority: str = "cost",
    budget_inr_hr: Optional[float] = None,
    min_tokens_per_sec: float = 0.0,
) -> Dict[str, Any]:
    """
    Evaluates candidate GPU placements and recommends the optimal match
    according to user constraints (budget, throughput, cost-efficiency).
    """
    memory = calculate_memory_demand(
        model_id=model_id,
        quantization=quantization,
        context_tokens=context_tokens,
        concurrency=concurrency,
    )

    candidates: List[PlacementCandidate] = []

    for cfg in DEFAULT_TOPOLOGY_CONFIGS:
        gpu_id = cfg["gpu_id"]
        count = cfg["count"]
        hw = REFERENCE_HARDWARE.get(gpu_id)
        if not hw:
            continue

        total_vram = hw.vram_gb * count
        usable_vram = total_vram * VLLM_USABLE_FRACTION
        rate_inr = hw.hourly_rate_inr * count
        rate_usd = hw.hourly_rate_usd * count

        # Inter-GPU communication efficiency factor for decode ceiling
        interconnect_eff = 0.85 if count > 1 else 1.0
        decode_tps_ceiling = (
            (hw.memory_bandwidth_gbps * count * interconnect_eff)
            / max(memory.weights_gb, 0.1)
        )

        fits = memory.total_needed_gb <= usable_vram
        headroom = 1.0 - (memory.total_needed_gb / usable_vram)

        state = "fits" if fits else "too-small"
        if fits and budget_inr_hr is not None and rate_inr > budget_inr_hr:
            state = "over-budget"
        elif fits and priority == "policy" and decode_tps_ceiling < min_tokens_per_sec:
            state = "too-slow"

        # Multi-attribute scoring function
        score = 0.0
        if state == "fits":
            # Higher headroom is safer up to 0.5, lower cost is better, higher tps is better
            vram_score = min(max(headroom, 0.0), 0.5) * 2.0
            cost_score = 1000.0 / max(rate_inr, 1.0)
            speed_score = min(decode_tps_ceiling / 20.0, 5.0)

            if priority == "speed":
                score = (speed_score * 0.6) + (vram_score * 0.2) + (cost_score * 0.2)
            elif priority == "policy":
                score = (vram_score * 0.4) + (speed_score * 0.4) + (cost_score * 0.2)
            else:  # default 'cost'
                score = (cost_score * 0.6) + (vram_score * 0.25) + (speed_score * 0.15)

        label = f"{count}× {hw.name}" if count > 1 else hw.name

        candidates.append(
            PlacementCandidate(
                key=f"{gpu_id}x{count}",
                label=label,
                gpu_id=gpu_id,
                count=count,
                total_vram_gb=total_vram,
                usable_vram_gb=usable_vram,
                rate_inr_hr=rate_inr,
                rate_usd_hr=rate_usd,
                decode_tps_ceiling=decode_tps_ceiling,
                state=state,
                headroom_pct=headroom,
                score=score,
            )
        )

    # Sort eligible candidates by score
    eligible = [c for c in candidates if c.state == "fits"]
    pick: Optional[PlacementCandidate] = None

    if eligible:
        if priority == "speed":
            eligible.sort(key=lambda c: (-c.decode_tps_ceiling, c.rate_inr_hr))
        elif priority == "cost":
            eligible.sort(key=lambda c: (c.rate_inr_hr, -c.headroom_pct))
        else:
            eligible.sort(key=lambda c: -c.score)

        pick = eligible[0]
        pick.state = "recommended"

    note = ""
    if not pick:
        if not any(c.total_vram_gb * VLLM_USABLE_FRACTION >= memory.total_needed_gb for c in candidates):
            note = "No single or multi-GPU topology holds this workload; reduce precision (FP8/INT4), context length, or concurrency."
        elif any(c.state == "over-budget" for c in candidates):
            note = "Compatible GPU configurations exist but exceed your hourly budget cap; increase budget limit."
        elif any(c.state == "too-slow" for c in candidates):
            note = "Compatible configurations exist but throughput is below your target tokens/sec ceiling."
        else:
            note = "No placement candidate met all constraints."

    return {
        "workload": {
            "model_id": model_id,
            "quantization": quantization,
            "context_tokens": context_tokens,
            "concurrency": concurrency,
            "priority": priority,
            "budget_inr_hr": budget_inr_hr,
            "min_tokens_per_sec": min_tokens_per_sec,
        },
        "memory_breakdown": memory.to_dict(),
        "recommended_placement": pick.to_dict() if pick else None,
        "candidates": [c.to_dict() for c in candidates],
        "note": note,
    }
