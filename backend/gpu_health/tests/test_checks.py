"""
Tests for Modular Health Checks
================================
Tests individual check modules: Accessibility, Driver, Memory, Compute, Thermal, Utilization, Error.
Verifies failure conditions (memory allocation failure, missing driver, compute error).
"""

import unittest
from gpu_health.checks.accessibility_check import AccessibilityCheck
from gpu_health.checks.driver_check import DriverCheck
from gpu_health.checks.memory_check import MemoryCheck
from gpu_health.checks.compute_check import ComputeCheck
from gpu_health.checks.thermal_check import ThermalCheck
from gpu_health.checks.utilization_check import UtilizationCheck
from gpu_health.checks.error_check import ErrorCheck

from gpu_health.core.types import (
    CheckResultStatus,
    MetricCapability,
    GpuDeviceInfo,
    GpuMetrics,
)
from gpu_health.core.config import HealthThresholds
from gpu_health.collectors.mock_collector import MockGpuCollector


class TestModularChecks(unittest.IsolatedAsyncioTestCase):

    def setUp(self):
        self.collector = MockGpuCollector()
        self.thresholds = HealthThresholds.default()
        self.device_info = GpuDeviceInfo(
            gpu_id="test-gpu-0",
            device_index=0,
            vendor="NVIDIA",
            model="RTX 4090",
            total_vram_bytes=24 * (1024 ** 3),
            driver_version="550.54.14",
            runtime_version="CUDA 12.4",
            capabilities=[
                MetricCapability.ACCESSIBILITY,
                MetricCapability.DRIVER,
                MetricCapability.MEMORY_INFO,
                MetricCapability.MEMORY_ALLOCATION,
                MetricCapability.COMPUTE,
                MetricCapability.THERMAL,
                MetricCapability.UTILIZATION,
                MetricCapability.ECC_ERRORS,
            ],
        )
        self.metrics = GpuMetrics(
            gpu_id="test-gpu-0",
            vram_used_bytes=4 * (1024 ** 3),
            vram_free_bytes=20 * (1024 ** 3),
            temperature_celsius=52.0,
            gpu_utilization_pct=15.0,
            memory_utilization_pct=10.0,
            ecc_uncorrectable_errors=0,
        )

    async def test_accessibility_check_passed(self):
        check = AccessibilityCheck()
        res = await check.run(self.device_info, self.metrics, self.collector, self.thresholds)
        self.assertEqual(res.status, CheckResultStatus.PASSED)
        self.assertIn("RTX 4090", res.message)

    async def test_driver_check_missing_driver(self):
        check = DriverCheck()
        dev_no_driver = self.device_info.model_copy()
        dev_no_driver.driver_version = None
        res = await check.run(dev_no_driver, self.metrics, self.collector, self.thresholds)
        self.assertEqual(res.status, CheckResultStatus.FAILED)
        self.assertIn("driver version is missing", res.message.lower())

    async def test_memory_allocation_failure(self):
        check = MemoryCheck()
        # Add mock device configured to fail allocation
        self.collector.add_mock_device(self.device_info, self.metrics, fail_allocation=True)
        res = await check.run(self.device_info, self.metrics, self.collector, self.thresholds)
        self.assertEqual(res.status, CheckResultStatus.FAILED)
        self.assertIn("allocation test failed", res.message.lower())

    async def test_compute_failure(self):
        check = ComputeCheck()
        self.collector.add_mock_device(self.device_info, self.metrics, fail_compute=True)
        res = await check.run(self.device_info, self.metrics, self.collector, self.thresholds)
        self.assertEqual(res.status, CheckResultStatus.FAILED)
        self.assertIn("failed", res.message.lower())

    async def test_thermal_check_overheat(self):
        check = ThermalCheck()
        hot_metrics = self.metrics.model_copy()
        hot_metrics.temperature_celsius = 92.0  # Critical
        res = await check.run(self.device_info, hot_metrics, self.collector, self.thresholds)
        self.assertEqual(res.status, CheckResultStatus.FAILED)
        self.assertIn("critical overheat", res.message.lower())

    async def test_error_check_uncorrectable_ecc(self):
        check = ErrorCheck()
        ecc_metrics = self.metrics.model_copy()
        ecc_metrics.ecc_uncorrectable_errors = 5
        res = await check.run(self.device_info, ecc_metrics, self.collector, self.thresholds)
        self.assertEqual(res.status, CheckResultStatus.FAILED)
        self.assertIn("uncorrectable", res.message.lower())


if __name__ == "__main__":
    unittest.main()
