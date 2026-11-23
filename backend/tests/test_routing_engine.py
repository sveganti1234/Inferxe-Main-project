"""
test_routing_engine.py
======================
Unit tests for the DPR Automated Backend Placement & Routing Engine.
"""

import sys
from pathlib import Path
import unittest

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from inference.routing_engine import (
    calculate_memory_demand,
    evaluate_placement,
    REFERENCE_MODELS,
    REFERENCE_HARDWARE,
)


class TestRoutingEngine(unittest.TestCase):
    def test_calculate_memory_demand_llama_8b(self):
        # 8.03B params * 2 bytes = 16.06 GB weights
        # KV cache: (4096 * 1 * 131072) / 1e9 = 0.53687 GB
        # Overhead: 2.0 + 0.04 * 16.06 = 2.6424 GB
        mem = calculate_memory_demand("llama-3.1-8b", quantization="fp16", context_tokens=4096, concurrency=1)
        self.assertAlmostEqual(mem.weights_gb, 16.06, places=2)
        self.assertGreater(mem.kv_cache_gb, 0.5)
        self.assertLess(mem.kv_cache_gb, 0.6)
        self.assertGreater(mem.total_needed_gb, 19.0)
        self.assertLess(mem.total_needed_gb, 20.0)

    def test_quantization_reduces_weight_memory(self):
        fp16 = calculate_memory_demand("llama-3.1-8b", quantization="fp16")
        fp8 = calculate_memory_demand("llama-3.1-8b", quantization="fp8")
        int4 = calculate_memory_demand("llama-3.1-8b", quantization="int4")

        self.assertAlmostEqual(fp8.weights_gb, fp16.weights_gb / 2.0, places=2)
        self.assertLess(int4.weights_gb, fp8.weights_gb)

    def test_placement_fits_on_l4_for_int4(self):
        result = evaluate_placement(
            model_id="llama-3.1-8b",
            quantization="int4",
            context_tokens=2048,
            concurrency=1,
            priority="cost",
        )
        self.assertIsNotNone(result["recommended_placement"])
        pick = result["recommended_placement"]
        self.assertEqual(pick["gpu_id"], "l4")
        self.assertEqual(pick["state"], "recommended")
        self.assertEqual(pick["count"], 1)

    def test_large_model_requires_multi_gpu(self):
        # 70B model at FP16 requires > 140GB weights, cannot fit on single 80GB H100
        result = evaluate_placement(
            model_id="llama-3.1-70b",
            quantization="fp16",
            context_tokens=4096,
            concurrency=2,
            priority="cost",
        )
        self.assertIsNotNone(result["recommended_placement"])
        pick = result["recommended_placement"]
        self.assertGreaterEqual(pick["count"], 2)
        self.assertIn("h100", pick["gpu_id"])

    def test_budget_constraint_enforcement(self):
        # L40S rate is 118 INR, budget cap set to 60 INR -> L40S should be over-budget
        result = evaluate_placement(
            model_id="qwen2.5-14b",
            quantization="fp16",
            budget_inr_hr=60.0,
        )
        # 14B at FP16 needs ~32GB, does not fit on L4 (24GB usable is 21.6GB)
        # So L4 is too-small, and L40S is over-budget
        for cand in result["candidates"]:
            if cand["gpu_id"] == "l40s":
                self.assertEqual(cand["state"], "over-budget")

    def test_speed_priority_prefers_higher_bandwidth(self):
        result = evaluate_placement(
            model_id="llama-3.1-8b",
            quantization="fp16",
            priority="speed",
        )
        pick = result["recommended_placement"]
        # Hopper (H100/H200) has 3350+ GB/s bandwidth vs L4/L40S
        self.assertIn(pick["gpu_id"], ["h100", "h200"])


if __name__ == "__main__":
    unittest.main()
