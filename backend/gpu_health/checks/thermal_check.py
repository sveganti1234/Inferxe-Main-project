"""
Thermal Health Check
====================
Inspects operating temperature and thermal throttling against configured thresholds.
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


class ThermalCheck(BaseHealthCheck):
    """Verifies operating temperature and checks for thermal throttling."""

    @property
    def name(self) -> str:
        return "thermal"

    @property
    def required_capability(self) -> Optional[MetricCapability]:
        return MetricCapability.THERMAL

    async def run(
        self,
        device_info: GpuDeviceInfo,
        metrics: GpuMetrics,
        collector: BaseGpuCollector,
        thresholds: HealthThresholds,
    ) -> CheckResult:
        temp = metrics.temperature_celsius
        mem_temp = metrics.memory_temperature_celsius
        throttles = metrics.throttle_reasons

        if temp is None:
            return CheckResult(
                check_name=self.name,
                status=CheckResultStatus.UNSUPPORTED,
                message="Thermal sensor not reporting temperature.",
                metrics={},
            )

        metric_dict = {
            "temperature_celsius": temp,
            "memory_temperature_celsius": mem_temp,
            "fan_speed_pct": metrics.fan_speed_pct,
            "throttle_reasons": throttles,
        }

        # Check for critical thermal state
        if temp >= thresholds.critical_temp_celsius:
            return CheckResult(
                check_name=self.name,
                status=CheckResultStatus.FAILED,
                message=f"CRITICAL OVERHEAT: GPU core temperature is {temp:.1f}°C (critical limit {thresholds.critical_temp_celsius:.1f}°C).",
                metrics=metric_dict,
                threshold_applied={"critical_temp_celsius": thresholds.critical_temp_celsius},
                error="ThermalCriticalException: Core temperature exceeds shutdown threshold",
            )

        # Check for warning thermal state or throttling
        is_warning = False
        reasons = []

        if temp >= thresholds.warning_temp_celsius:
            is_warning = True
            reasons.append(f"Temperature {temp:.1f}°C exceeds warning threshold {thresholds.warning_temp_celsius:.1f}°C")

        for th in throttles:
            if "THERMAL" in th.upper():
                is_warning = True
                reasons.append(f"Hardware thermal throttle flag active: {th}")

        if is_warning:
            return CheckResult(
                check_name=self.name,
                status=CheckResultStatus.WARNING,
                message="; ".join(reasons),
                metrics=metric_dict,
                threshold_applied={"warning_temp_celsius": thresholds.warning_temp_celsius},
            )

        return CheckResult(
            check_name=self.name,
            status=CheckResultStatus.PASSED,
            message=f"Core temperature normal at {temp:.1f}°C (warning threshold {thresholds.warning_temp_celsius:.1f}°C).",
            metrics=metric_dict,
            threshold_applied={"warning_temp_celsius": thresholds.warning_temp_celsius},
        )
