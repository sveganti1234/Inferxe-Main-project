"""
Utilization Health Check
========================
Inspects GPU compute core and memory bus activity levels.
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


class UtilizationCheck(BaseHealthCheck):
    """Monitors compute utilization and memory bus activity."""

    @property
    def name(self) -> str:
        return "utilization"

    @property
    def required_capability(self) -> Optional[MetricCapability]:
        return MetricCapability.UTILIZATION

    async def run(
        self,
        device_info: GpuDeviceInfo,
        metrics: GpuMetrics,
        collector: BaseGpuCollector,
        thresholds: HealthThresholds,
    ) -> CheckResult:
        gpu_util = metrics.gpu_utilization_pct
        mem_util = metrics.memory_utilization_pct

        if gpu_util is None:
            return CheckResult(
                check_name=self.name,
                status=CheckResultStatus.UNSUPPORTED,
                message="Utilization telemetry not provided by driver.",
                metrics={},
            )

        metric_dict = {
            "gpu_utilization_pct": gpu_util,
            "memory_utilization_pct": mem_util,
            "power_draw_watts": metrics.power_draw_watts,
        }

        # High utilization is a load condition rather than a hardware defect
        if gpu_util >= thresholds.warning_utilization_pct:
            return CheckResult(
                check_name=self.name,
                status=CheckResultStatus.WARNING,
                message=f"High compute utilization ({gpu_util:.1f}%). GPU is heavily loaded.",
                metrics=metric_dict,
                threshold_applied={"warning_utilization_pct": thresholds.warning_utilization_pct},
            )

        return CheckResult(
            check_name=self.name,
            status=CheckResultStatus.PASSED,
            message=f"Utilization nominal: {gpu_util:.1f}% compute, {mem_util or 0.0:.1f}% memory bus.",
            metrics=metric_dict,
        )
