"""
Mock GPU Telemetry Collector
============================
Deterministic, in-memory collector for automated testing, CI, and local development.
Supports customizable fixtures: healthy, degraded, critical, missing sensors, and timeouts.
Clearly tagged with 'Mock' vendor/source to prevent confusing simulation with real hardware.
"""

import asyncio
from typing import Dict, List, Optional
from datetime import datetime, timezone

try:
    from gpu_health.core.collector import (
        BaseGpuCollector,
        DeviceNotFoundError,
    )
    from gpu_health.core.types import (
        GpuDeviceInfo,
        GpuMetrics,
        MetricCapability,
    )
except ImportError:
    from ..core.collector import (  # type: ignore
        BaseGpuCollector,
        DeviceNotFoundError,
    )
    from ..core.types import (  # type: ignore
        GpuDeviceInfo,
        GpuMetrics,
        MetricCapability,
    )


class MockGpuCollector(BaseGpuCollector):
    """Deterministic in-memory mock collector."""

    def __init__(self):
        self._devices: Dict[str, GpuDeviceInfo] = {}
        self._metrics: Dict[str, GpuMetrics] = {}
        self._allocation_failures: Dict[str, bool] = {}
        self._compute_failures: Dict[str, bool] = {}
        self._delays: Dict[str, float] = {}

        # Pre-seed standard test fixtures
        self._seed_default_fixtures()

    @property
    def collector_id(self) -> str:
        return "mock"

    @property
    def vendor_name(self) -> str:
        return "Mock"

    def is_available(self) -> bool:
        return True

    def _seed_default_fixtures(self) -> None:
        """Populate initial mock devices covering diverse hardware states."""
        # 1. Healthy Flagship GPU
        self.add_mock_device(
            device_info=GpuDeviceInfo(
                gpu_id="mock-gpu-0",
                device_index=0,
                vendor="NVIDIA (Mock)",
                model="NVIDIA H100 SXM5 (Mock)",
                total_vram_bytes=80 * (1024 ** 3),
                driver_version="550.54.15",
                runtime_version="CUDA 12.4",
                pci_bus_id="0000:01:00.0",
                capabilities=[
                    MetricCapability.ACCESSIBILITY,
                    MetricCapability.DRIVER,
                    MetricCapability.MEMORY_INFO,
                    MetricCapability.MEMORY_ALLOCATION,
                    MetricCapability.COMPUTE,
                    MetricCapability.THERMAL,
                    MetricCapability.UTILIZATION,
                    MetricCapability.POWER,
                    MetricCapability.ECC_ERRORS,
                ],
            ),
            metrics=GpuMetrics(
                gpu_id="mock-gpu-0",
                vram_used_bytes=4 * (1024 ** 3),
                vram_free_bytes=76 * (1024 ** 3),
                temperature_celsius=42.0,
                memory_temperature_celsius=48.0,
                gpu_utilization_pct=5.0,
                memory_utilization_pct=3.0,
                power_draw_watts=120.0,
                power_limit_watts=700.0,
                ecc_uncorrectable_errors=0,
                ecc_correctable_errors=0,
                fan_speed_pct=35.0,
                throttle_reasons=[],
            ),
        )

        # 2. Degraded / Warm GPU (Warning State)
        self.add_mock_device(
            device_info=GpuDeviceInfo(
                gpu_id="mock-gpu-1",
                device_index=1,
                vendor="NVIDIA (Mock)",
                model="NVIDIA L40S (Mock)",
                total_vram_bytes=48 * (1024 ** 3),
                driver_version="550.54.15",
                runtime_version="CUDA 12.4",
                pci_bus_id="0000:02:00.0",
                capabilities=[
                    MetricCapability.ACCESSIBILITY,
                    MetricCapability.DRIVER,
                    MetricCapability.MEMORY_INFO,
                    MetricCapability.MEMORY_ALLOCATION,
                    MetricCapability.COMPUTE,
                    MetricCapability.THERMAL,
                    MetricCapability.UTILIZATION,
                    MetricCapability.POWER,
                ],
            ),
            metrics=GpuMetrics(
                gpu_id="mock-gpu-1",
                vram_used_bytes=42 * (1024 ** 3),
                vram_free_bytes=6 * (1024 ** 3),
                temperature_celsius=82.0,  # Exceeds warning threshold 78.0°C
                gpu_utilization_pct=88.0,
                power_draw_watts=310.0,
                power_limit_watts=350.0,
                throttle_reasons=["SW_THERMAL"],
            ),
        )

        # 3. Critical GPU (Thermal Throttle & ECC Errors)
        self.add_mock_device(
            device_info=GpuDeviceInfo(
                gpu_id="mock-gpu-critical",
                device_index=2,
                vendor="NVIDIA (Mock)",
                model="NVIDIA A100-PCIE-80GB (Mock)",
                total_vram_bytes=80 * (1024 ** 3),
                driver_version="535.129.03",
                runtime_version="CUDA 12.2",
                pci_bus_id="0000:03:00.0",
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
            ),
            metrics=GpuMetrics(
                gpu_id="mock-gpu-critical",
                vram_used_bytes=78 * (1024 ** 3),
                vram_free_bytes=2 * (1024 ** 3),
                temperature_celsius=91.0,  # Exceeds critical threshold 88.0°C
                gpu_utilization_pct=99.0,
                ecc_uncorrectable_errors=3,  # Critical hardware error
                ecc_correctable_errors=12,
                throttle_reasons=["HW_THERMAL", "SW_POWER_CAP"],
            ),
        )

        # 4. Unknown / Legacy GPU with Minimal Capabilities (No thermal/power/ECC sensors)
        self.add_mock_device(
            device_info=GpuDeviceInfo(
                gpu_id="mock-gpu-minimal",
                device_index=3,
                vendor="Generic (Mock)",
                model="Generic Compute Accelerator (Mock)",
                total_vram_bytes=16 * (1024 ** 3),
                driver_version="1.0.0",
                runtime_version="OpenCL 3.0",
                capabilities=[
                    MetricCapability.ACCESSIBILITY,
                    MetricCapability.MEMORY_INFO,
                    MetricCapability.COMPUTE,
                ],
            ),
            metrics=GpuMetrics(
                gpu_id="mock-gpu-minimal",
                vram_used_bytes=2 * (1024 ** 3),
                vram_free_bytes=14 * (1024 ** 3),
                # No thermal, power, or ECC metrics (unsupported)
            ),
        )

    def add_mock_device(
        self,
        device_info: GpuDeviceInfo,
        metrics: GpuMetrics,
        fail_allocation: bool = False,
        fail_compute: bool = False,
        delay_seconds: float = 0.0,
    ) -> None:
        """Register or update a mock device fixture."""
        self._devices[device_info.gpu_id] = device_info
        self._metrics[device_info.gpu_id] = metrics
        self._allocation_failures[device_info.gpu_id] = fail_allocation
        self._compute_failures[device_info.gpu_id] = fail_compute
        self._delays[device_info.gpu_id] = delay_seconds

    async def detect_devices(self) -> List[GpuDeviceInfo]:
        """Return list of all registered mock devices."""
        return list(self._devices.values())

    async def get_device_info(self, gpu_id: str) -> GpuDeviceInfo:
        if gpu_id not in self._devices:
            raise DeviceNotFoundError(f"Mock GPU '{gpu_id}' not found.", collector_id=self.collector_id)
        delay = self._delays.get(gpu_id, 0.0)
        if delay > 0:
            await asyncio.sleep(delay)
        return self._devices[gpu_id]

    async def collect_metrics(self, gpu_id: str) -> GpuMetrics:
        if gpu_id not in self._metrics:
            raise DeviceNotFoundError(f"Mock metrics for '{gpu_id}' not found.", collector_id=self.collector_id)
        delay = self._delays.get(gpu_id, 0.0)
        if delay > 0:
            await asyncio.sleep(delay)
        # Return fresh timestamped copy
        m = self._metrics[gpu_id].model_copy()
        m.timestamp = datetime.now(timezone.utc)
        return m

    async def test_memory_allocation(self, gpu_id: str, size_bytes: int, timeout_seconds: float) -> bool:
        if gpu_id not in self._devices:
            raise DeviceNotFoundError(f"Mock GPU '{gpu_id}' not found.", collector_id=self.collector_id)
        delay = self._delays.get(gpu_id, 0.0)
        if delay > 0:
            await asyncio.sleep(delay)
        return not self._allocation_failures.get(gpu_id, False)

    async def test_compute(self, gpu_id: str, timeout_seconds: float) -> bool:
        if gpu_id not in self._devices:
            raise DeviceNotFoundError(f"Mock GPU '{gpu_id}' not found.", collector_id=self.collector_id)
        delay = self._delays.get(gpu_id, 0.0)
        if delay > 0:
            await asyncio.sleep(delay)
        return not self._compute_failures.get(gpu_id, False)
