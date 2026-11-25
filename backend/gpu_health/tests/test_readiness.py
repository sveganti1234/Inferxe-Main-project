"""
Tests for Deployment Readiness Evaluation
=========================================
Tests workload suitability, available VRAM matching, busy state,
thermal limits, and runtime compatibility.
"""

import unittest
from gpu_health.core.engine import GpuHealthEngine
from gpu_health.core.types import (
    DeploymentRequirement,
    HealthStatus,
    AvailabilityStatus,
)
from gpu_health.collectors.mock_collector import MockGpuCollector


class TestDeploymentReadiness(unittest.IsolatedAsyncioTestCase):

    def setUp(self):
        self.collector = MockGpuCollector()
        self.engine = GpuHealthEngine(collector=self.collector)

    async def test_ready_gpu_satisfies_requirements(self):
        """GPU with 76 GB free VRAM, 42°C temp, and healthy state satisfies 24 GB workload."""
        req = DeploymentRequirement(
            required_vram_bytes=24 * (1024 ** 3),
            required_runtime="cuda",
            max_acceptable_temp_celsius=80.0,
            min_health_score=80.0,
        )
        res = await self.engine.check_deployment_readiness("mock-gpu-0", req)
        self.assertTrue(res.is_ready)
        self.assertEqual(len(res.missing_requirements), 0)
        self.assertEqual(res.overall_status, HealthStatus.HEALTHY)
        self.assertGreaterEqual(res.current_vram_available_bytes, 70 * (1024 ** 3))

    async def test_readiness_fails_insufficient_vram(self):
        """GPU with 6 GB free VRAM fails a 24 GB workload requirement."""
        req = DeploymentRequirement(
            required_vram_bytes=24 * (1024 ** 3),
            required_runtime="cuda",
        )
        # mock-gpu-1 has only 6 GB free VRAM
        res = await self.engine.check_deployment_readiness("mock-gpu-1", req)
        self.assertFalse(res.is_ready)
        self.assertIn("vram_capacity", res.missing_requirements)
        self.assertTrue(any("insufficient free vram" in r.lower() for r in res.reasons))

    async def test_readiness_fails_critical_health(self):
        """Critical GPU cannot accept deployments regardless of VRAM."""
        req = DeploymentRequirement(
            required_vram_bytes=1 * (1024 ** 3),
        )
        res = await self.engine.check_deployment_readiness("mock-gpu-critical", req)
        self.assertFalse(res.is_ready)
        self.assertIn("hardware_health", res.missing_requirements)

    async def test_readiness_fails_runtime_mismatch(self):
        """Requesting ROCm on a CUDA device fails runtime check."""
        req = DeploymentRequirement(
            required_vram_bytes=10 * (1024 ** 3),
            required_runtime="rocm",
        )
        res = await self.engine.check_deployment_readiness("mock-gpu-0", req)
        self.assertFalse(res.is_ready)
        self.assertIn("runtime_compatibility", res.missing_requirements)


if __name__ == "__main__":
    unittest.main()
