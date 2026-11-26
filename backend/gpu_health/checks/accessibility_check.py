"""
Accessibility Health Check
==========================
Verifies that the GPU is detected and accessible via the driver interface.
"""

from typing import Optional
try:
    from gpu_health.core.checks import BaseHealthCheck
    from gpu_health.core.types import (
        CheckResult,
        CheckResultStatus,
        GpuDeviceInfo,
        GpuMetrics,
        MetricCapability,
    )
    from gpu_health.core.config import HealthThresholds
    from gpu_health.core.collector import BaseGpuCollector
except ImportError:
    from ..core.checks import BaseHealthCheck  # type: ignore
    from ..core.types import (  # type: ignore
        CheckResult,
        CheckResultStatus,
        GpuDeviceInfo,
        GpuMetrics,
        MetricCapability,
    )
    from ..core.config import HealthThresholds  # type: ignore
    from ..core.collector import BaseGpuCollector  # type: ignore


class AccessibilityCheck(BaseHealthCheck):
    """Verifies that the target GPU device can be queried and responds."""

    @property
    def name(self) -> str:
        return "accessibility"

    @property
    def required_capability(self) -> Optional[MetricCapability]:
        return MetricCapability.ACCESSIBILITY

    async def run(
        self,
        device_info: GpuDeviceInfo,
        metrics: GpuMetrics,
        collector: BaseGpuCollector,
        thresholds: HealthThresholds,
    ) -> CheckResult:
        if not device_info.gpu_id:
            return CheckResult(
                check_name=self.name,
                status=CheckResultStatus.FAILED,
                message="Device identifier is missing or invalid.",
                metrics={},
            )

        return CheckResult(
            check_name=self.name,
            status=CheckResultStatus.PASSED,
            message=f"Device '{device_info.gpu_id}' ({device_info.vendor} {device_info.model}) is accessible via {collector.vendor_name} interface.",
            metrics={
                "pci_bus_id": device_info.pci_bus_id,
                "device_index": device_info.device_index,
            },
        )
