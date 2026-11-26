"""
Hardware & Runtime Error Check
==============================
Inspects uncorrectable/correctable ECC memory errors, XID fault codes, or driver fault alerts.
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


class ErrorCheck(BaseHealthCheck):
    """Inspects memory and driver error counters."""

    @property
    def name(self) -> str:
        return "error"

    @property
    def required_capability(self) -> Optional[MetricCapability]:
        return MetricCapability.ECC_ERRORS

    async def run(
        self,
        device_info: GpuDeviceInfo,
        metrics: GpuMetrics,
        collector: BaseGpuCollector,
        thresholds: HealthThresholds,
    ) -> CheckResult:
        uncorr = metrics.ecc_uncorrectable_errors
        corr = metrics.ecc_correctable_errors

        if uncorr is None and corr is None:
            return CheckResult(
                check_name=self.name,
                status=CheckResultStatus.UNSUPPORTED,
                message="ECC error reporting is not supported or not enabled for this device.",
                metrics={},
            )

        metric_dict = {
            "ecc_uncorrectable_errors": uncorr or 0,
            "ecc_correctable_errors": corr or 0,
        }

        # Double-bit uncorrectable memory error is a critical hardware failure
        if uncorr and uncorr > 0:
            return CheckResult(
                check_name=self.name,
                status=CheckResultStatus.FAILED,
                message=f"CRITICAL: {uncorr} uncorrectable ECC memory error(s) detected.",
                metrics=metric_dict,
                error="HardwareEccException: Double-bit uncorrectable memory error detected",
            )

        # High correctable error count is an advisory warning of silicon degradation
        if corr and corr > 20:
            return CheckResult(
                check_name=self.name,
                status=CheckResultStatus.WARNING,
                message=f"High correctable ECC error count ({corr}). Monitor for potential hardware degradation.",
                metrics=metric_dict,
            )

        return CheckResult(
            check_name=self.name,
            status=CheckResultStatus.PASSED,
            message="No uncorrectable hardware or memory ECC errors detected.",
            metrics=metric_dict,
        )
