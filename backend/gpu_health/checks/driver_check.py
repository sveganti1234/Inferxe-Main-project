"""
Driver and Runtime Health Check
===============================
Verifies that driver and runtime environments are installed and responding.
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


class DriverCheck(BaseHealthCheck):
    """Verifies driver installation and runtime version reporting."""

    @property
    def name(self) -> str:
        return "driver"

    @property
    def required_capability(self) -> Optional[MetricCapability]:
        return MetricCapability.DRIVER

    async def run(
        self,
        device_info: GpuDeviceInfo,
        metrics: GpuMetrics,
        collector: BaseGpuCollector,
        thresholds: HealthThresholds,
    ) -> CheckResult:
        driver = device_info.driver_version
        runtime = device_info.runtime_version

        if not driver:
            return CheckResult(
                check_name=self.name,
                status=CheckResultStatus.FAILED,
                message="System driver version is missing or driver is not functioning.",
                metrics={},
            )

        msg = f"Driver version: {driver}"
        if runtime:
            msg += f", Compute runtime: {runtime}"

        return CheckResult(
            check_name=self.name,
            status=CheckResultStatus.PASSED,
            message=msg,
            metrics={
                "driver_version": driver,
                "runtime_version": runtime,
            },
        )
