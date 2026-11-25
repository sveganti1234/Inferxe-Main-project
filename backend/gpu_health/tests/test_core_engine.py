"""
Tests for Core GpuHealthEngine
==============================
Tests GPU detection, multi-GPU handling, unknown GPU models, unsupported metrics,
healthy/warning/critical states, health score calculation, and timeouts.
"""

import unittest
import asyncio
from typing import List

from gpu_health.core.engine import GpuHealthEngine
from gpu_health.core.config import HealthThresholds
from gpu_health.core.types import (
    HealthStatus,
    CheckResultStatus,
    AvailabilityStatus,
    MetricCapability,
    GpuDeviceInfo,
    GpuMetrics,
)
from gpu_health.collectors.mock_collector import MockGpuCollector


class TestGpuHealthEngineCore(unittest.IsolatedAsyncioTestCase):

    def setUp(self):
        self.collector = MockGpuCollector()
        self.engine = GpuHealthEngine(collector=self.collector)

    async def test_detect_multiple_gpus(self):
        """Verify engine detects all available GPUs in the system."""
        devices = await self.engine.detect_gpus()
        self.assertGreaterEqual(len(devices), 4)
        gpu_ids = [d.gpu_id for d in devices]
        self.assertIn("mock-gpu-0", gpu_ids)
        self.assertIn("mock-gpu-1", gpu_ids)
        self.assertIn("mock-gpu-critical", gpu_ids)
        self.assertIn("mock-gpu-minimal", gpu_ids)

    async def test_unknown_gpu_model_handling(self):
        """Verify engine operates smoothly on arbitrary, unknown, or generic GPU models."""
        custom_info = GpuDeviceInfo(
            gpu_id="custom-arm-npu-99",
            device_index=99,
            vendor="CustomVendor",
            model="Experimental Neural Core v4",
            total_vram_bytes=32 * (1024 ** 3),
            driver_version="0.9.1",
            capabilities=[MetricCapability.ACCESSIBILITY, MetricCapability.MEMORY_INFO],
        )
        custom_metrics = GpuMetrics(
            gpu_id="custom-arm-npu-99",
            vram_used_bytes=2 * (1024 ** 3),
            vram_free_bytes=30 * (1024 ** 3),
        )
        self.collector.add_mock_device(custom_info, custom_metrics)

        report = await self.engine.run_all_checks("custom-arm-npu-99")
        self.assertEqual(report.gpu_id, "custom-arm-npu-99")
        self.assertEqual(report.device_info.vendor, "CustomVendor")
        self.assertEqual(report.device_info.model, "Experimental Neural Core v4")
        self.assertEqual(report.overall_status, HealthStatus.HEALTHY)

    async def test_unsupported_metrics_not_penalized(self):
        """Unsupported metrics must not be treated as failures or zero values."""
        # mock-gpu-minimal lacks thermal, utilization, and ECC sensors
        report = await self.engine.run_all_checks("mock-gpu-minimal")
        self.assertEqual(report.overall_status, HealthStatus.HEALTHY)
        self.assertIn("thermal", report.unsupported_metrics)
        self.assertIn("utilization", report.unsupported_metrics)
        self.assertIn("error", report.unsupported_metrics)

        # Health score must still be computed from supported metrics (e.g. accessibility, memory)
        self.assertIsNotNone(report.health_score)
        self.assertGreaterEqual(report.health_score, 80.0)

        # Check that thermal check was reported as UNSUPPORTED, not FAILED
        thermal_res = next(c for c in report.individual_checks if c.check_name == "thermal")
        self.assertEqual(thermal_res.status, CheckResultStatus.UNSUPPORTED)

    async def test_healthy_flagship_gpu(self):
        """Verify healthy GPU passes all checks with high score."""
        report = await self.engine.run_all_checks("mock-gpu-0")
        self.assertEqual(report.overall_status, HealthStatus.HEALTHY)
        self.assertEqual(report.availability_status, AvailabilityStatus.AVAILABLE)
        self.assertTrue(report.is_deployment_ready)
        self.assertGreaterEqual(report.health_score, 90.0)
        self.assertEqual(len(report.errors), 0)

    async def test_warning_state_gpu(self):
        """Verify elevated temperature or memory pressure results in WARNING status."""
        report = await self.engine.run_all_checks("mock-gpu-1")
        self.assertEqual(report.overall_status, HealthStatus.WARNING)
        self.assertLess(report.health_score, 90.0)
        # Recommendations should contain advice on thermal or workload
        self.assertTrue(any("temperature" in r.lower() or "thermal" in r.lower() for r in report.recommendations))

    async def test_critical_state_gpu(self):
        """Verify critical temperature and uncorrectable ECC errors trigger CRITICAL."""
        report = await self.engine.run_all_checks("mock-gpu-critical")
        self.assertEqual(report.overall_status, HealthStatus.CRITICAL)
        self.assertEqual(report.availability_status, AvailabilityStatus.OFFLINE)
        self.assertFalse(report.is_deployment_ready)
        self.assertLessEqual(report.health_score, 20.0)
        self.assertTrue(any("ecc" in err.lower() or "thermal" in err.lower() for err in report.errors))

    async def test_configurable_thresholds(self):
        """Verify thresholds can be customized dynamically."""
        # By default mock-gpu-0 is 42°C, which is healthy under default 78°C warning threshold
        # If we set warning threshold to 40°C, it should become WARNING
        strict_thresholds = HealthThresholds(warning_temp_celsius=40.0, critical_temp_celsius=60.0)
        strict_engine = GpuHealthEngine(collector=self.collector, thresholds=strict_thresholds)

        report = await strict_engine.run_all_checks("mock-gpu-0")
        self.assertEqual(report.overall_status, HealthStatus.WARNING)

    async def test_check_timeout_handling(self):
        """Verify that slow or hung checks trigger timeout safely without deadlocking."""
        slow_info = GpuDeviceInfo(
            gpu_id="mock-gpu-slow",
            device_index=10,
            vendor="Mock",
            model="Lagging Accelerator",
            total_vram_bytes=16 * (1024 ** 3),
            capabilities=[
                MetricCapability.ACCESSIBILITY,
                MetricCapability.MEMORY_INFO,
                MetricCapability.COMPUTE,
            ],
        )
        slow_metrics = GpuMetrics(
            gpu_id="mock-gpu-slow",
            vram_used_bytes=1 * (1024 ** 3),
            vram_free_bytes=15 * (1024 ** 3),
        )
        # Inject 1.0 second delay into mock device
        self.collector.add_mock_device(slow_info, slow_metrics, delay_seconds=1.0)

        # Set check timeout to 0.1s
        fast_engine = GpuHealthEngine(
            collector=self.collector,
            thresholds=HealthThresholds(check_timeout_seconds=0.1),
        )
        report = await fast_engine.run_all_checks("mock-gpu-slow", timeout_seconds=0.1)

        # The check must report failure due to timeout, not an unhandled crash
        failed_checks = [c for c in report.individual_checks if c.status == CheckResultStatus.FAILED]
        self.assertGreaterEqual(len(failed_checks), 1)
        self.assertTrue(any("timed out" in c.message.lower() for c in failed_checks))


if __name__ == "__main__":
    unittest.main()
