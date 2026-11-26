"""
Normalized GPU catalogue (DPR §11), built from the curated datasets in database/datasets.

Hardware facts (dataset_1) are kept apart from provider offers (dataset_2): one GPU model, many offers.
Measured benchmarks (dataset_4) are attached to the GPU model they were run on.

shortcut: read from the versioned JSON datasets once per process; move to Supabase tables when a live
provider price/availability sync exists.
"""

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict

DATASETS_DIR = Path(__file__).resolve().parents[2] / "database" / "datasets"

# The pricing dataset includes our own list price; it is a reference rate, not a provider offer.
LIST_RATE_PROVIDER = "Inferxe Marketplace (List Rate)"


def slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def gpu_id(name: str) -> str:
    """Canonical GPU id shared across datasets: 'NVIDIA H100 SXM (80GB)' and 'NVIDIA H100 SXM' -> 'h100'."""
    name = re.sub(r"\(.*?\)", "", name.lower())
    return slugify(re.sub(r"\b(nvidia|sxm\d?)\b", "", name))


def _load(relative: str) -> Any:
    return json.loads((DATASETS_DIR / relative).read_text(encoding="utf-8"))


@lru_cache(maxsize=1)
def load_catalog() -> Dict[str, Any]:
    gpus: Dict[str, Dict[str, Any]] = {}
    for hw in _load("hardware/dataset_1_nvidia_gpu_hardware_specs.json"):
        gid = gpu_id(hw["gpu_model"])
        gpus[gid] = {
            "id": gid,
            "name": hw["gpu_model"],
            "architecture": hw.get("architecture"),
            "vram_gb": hw.get("vram_gb"),
            "memory_type": hw.get("memory_type"),
            "memory_bandwidth_gbps": round(hw["memory_bandwidth_tb_s"] * 1000) if hw.get("memory_bandwidth_tb_s") else None,
            "fp16_tflops": hw.get("fp16_tensor_tflops"),
            "form_factor": hw.get("form_factor"),
            "recommended_workloads": hw.get("recommended_workloads"),
            "list_rate_inr_hr": None,
            "benchmarks": [],
        }

    providers: Dict[str, Dict[str, Any]] = {}
    offers = []
    for row in _load("pricing/dataset_2_gpu_cloud_pricing.json"):
        gid = gpu_id(row["gpu_model"])
        # GPUs that are offered but missing from the hardware dataset still get a (thinner) model record.
        gpu = gpus.setdefault(gid, {
            "id": gid, "name": row["gpu_model"], "architecture": None,
            "vram_gb": row["total_vram_gb"] / max(row["gpu_count"], 1), "memory_type": None,
            "memory_bandwidth_gbps": None, "fp16_tflops": None, "form_factor": None,
            "recommended_workloads": None, "list_rate_inr_hr": None, "benchmarks": [],
        })
        if row["provider"] == LIST_RATE_PROVIDER:
            gpu["list_rate_inr_hr"] = row["on_demand_hourly_inr"]
            continue

        pid = slugify(row["provider"])
        provider = providers.setdefault(pid, {
            "id": pid,
            "name": row["provider"],
            "type": row.get("provider_type"),
            "api_support": row.get("api_support"),
            "regions": [],
            "gpu_ids": [],
            # No live adapter reports health yet; the catalogue only says the rate card is known.
            "status": "catalogue_only",
        })
        if row["data_center_region"] not in provider["regions"]:
            provider["regions"].append(row["data_center_region"])
        if gid not in provider["gpu_ids"]:
            provider["gpu_ids"].append(gid)

        inr, usd = row["on_demand_hourly_inr"], row["on_demand_hourly_usd"]
        offers.append({
            "id": f"{pid}:{gid}",
            "provider_id": pid,
            "provider_name": row["provider"],
            "gpu_id": gid,
            "gpu_count": row["gpu_count"],
            "vram_gb": row["total_vram_gb"],
            "vcpu": row.get("vcpu"),
            "system_ram_gb": row.get("system_ram_gb"),
            "region": row["data_center_region"],
            "sovereign_india_hosted": bool(row.get("sovereign_india_hosted")),
            "billing_unit": row.get("billing_unit"),
            "on_demand_hourly_inr": inr,
            "spot_hourly_inr": row.get("spot_hourly_inr"),
            "storage_inr_per_gb_month": round(row.get("storage_cost_per_gb_month_usd", 0) * inr / usd, 2) if usd else None,
            "price_source": row.get("source"),
        })

    for bm in _load("models/dataset_4_inference_benchmarks_and_token_economics.json"):
        gpu = gpus.get(gpu_id(bm["gpu_model"]))
        if gpu is not None:
            gpu["benchmarks"].append({
                "model_id": bm["model_id"],
                "serving_engine": bm.get("serving_engine"),
                "concurrency": bm.get("concurrency_streams"),
                "ttft_ms": bm.get("ttft_ms"),
                "throughput_tokens_per_sec": bm.get("effective_throughput_tokens_per_sec"),
                "cost_per_1m_tokens_inr": bm.get("effective_cost_per_1m_tokens_inr"),
            })

    return {"gpus": gpus, "providers": providers, "offers": offers}
