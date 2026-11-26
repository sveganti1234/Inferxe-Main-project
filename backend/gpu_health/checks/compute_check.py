"""
Compute Health Check
====================
Runs a safe, micro-bounded tensor/matrix operation within strict timeouts
to verify ALU/Tensor core compute functionality without disrupting customer workloads.
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


class ComputeCheck(BaseHealthCheck):
    """Executes a safe micro-compute operation to verify execution pipelines."""

    @property
    def name(self) -> str:
        return "compute"

    @property
    def required_capability(self) -> Optional[MetricCapability]:
        return MetricCapability.COMPUTE

    async def run(
        self,
        device_info: GpuDeviceInfo,
        metrics: GpuMetrics,
        collector: BaseGpuCollector,
        thresholds: HealthThresholds,
    ) -> CheckResult:
        success = await collector.test_compute(
            gpu_id=device_info.gpu_id,
            timeout_seconds=thresholds.check_timeout_seconds,
        )

        if not success:
            return CheckResult(
                check_name=self.name,
                status=CheckResultStatus.FAILED,
                message="Micro-compute operation failed on compute cores.",
                metrics={},
                error="ComputePipelineError: Execution cores failed calculation check",
            )

        return CheckResult(
            check_name=self.name,
            status=CheckResultStatus.PASSED,
            message="Micro-compute test executed and verified successfully.",
            metrics={},
        )
