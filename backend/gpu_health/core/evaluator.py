"""
Health Evaluator & Scoring Engine
=================================
Synthesizes individual check results and raw telemetry into a unified HealthReport.
Computes a normalized health score (0-100) strictly from supported metrics.
Enforces the orthogonal status rules: health, availability, and readiness are distinct.
"""

from typing import List, Dict, Any, Optional
from datetime import datetime, timezone

from .types import (
    HealthStatus,
    CheckResultStatus,
    AvailabilityStatus,
    CheckResult,
    GpuDeviceInfo,
    GpuMetrics,
    HealthReport,
)
from .config import HealthThresholds


class HealthEvaluator:
    """Evaluates checks and telemetry to generate consistent health ratings and scores."""

    def __init__(self, thresholds: Optional[HealthThresholds] = None):
        self.thresholds = thresholds or HealthThresholds.default()

    def evaluate(
        self,
        device_info: GpuDeviceInfo,
        metrics: GpuMetrics,
        check_results: List[CheckResult],
        execution_duration_ms: float = 0.0,
    ) -> HealthReport:
        """
        Process individual check outcomes and telemetry to formulate the HealthReport.
        """
        supported_metrics: List[str] = []
        unsupported_metrics: List[str] = []
        errors: List[str] = []
        recommendations: List[str] = []

        has_failed = False
        has_warning = False
        has_critical_failure = False

        # 1. Categorize check outcomes and metrics
        for res in check_results:
            if res.status == CheckResultStatus.UNSUPPORTED:
                unsupported_metrics.append(res.check_name)
            elif res.status == CheckResultStatus.UNAVAILABLE:
                unsupported_metrics.append(res.check_name)
                errors.append(f"{res.check_name}: {res.message}")
            else:
                supported_metrics.append(res.check_name)

            if res.status == CheckResultStatus.FAILED:
                has_failed = True
                errors.append(f"{res.check_name} check failed: {res.message}")
                # Critical checks that immediately indicate hardware or driver death
                if res.check_name in ("accessibility", "driver", "thermal", "error"):
                    has_critical_failure = True
            elif res.status == CheckResultStatus.WARNING:
                has_warning = True

            if res.error:
                errors.append(f"{res.check_name} error: {res.error}")

        # 2. Check telemetry metrics directly against thresholds
        if metrics.temperature_celsius is not None:
            if metrics.temperature_celsius >= self.thresholds.critical_temp_celsius:
                has_critical_failure = True
                errors.append(
                    f"Thermal critical: core temperature {metrics.temperature_celsius:.1f}°C "
                    f"exceeds critical threshold {self.thresholds.critical_temp_celsius:.1f}°C."
                )
                recommendations.append("Inspect chassis airflow, fans, or coolant pumps immediately.")
            elif metrics.temperature_celsius >= self.thresholds.warning_temp_celsius:
                has_warning = True
                recommendations.append(
                    f"Operating temperature elevated ({metrics.temperature_celsius:.1f}°C). Monitor thermal trend."
                )

        if metrics.vram_usage_pct is not None:
            if metrics.vram_usage_pct >= self.thresholds.critical_vram_pct:
                has_warning = True
                recommendations.append(f"VRAM nearly exhausted ({metrics.vram_usage_pct:.1f}% used). Consider memory eviction.")

        if metrics.ecc_uncorrectable_errors is not None and metrics.ecc_uncorrectable_errors > 0:
            has_critical_failure = True
            errors.append(f"Hardware ECC Alert: {metrics.ecc_uncorrectable_errors} uncorrectable memory errors detected.")
            recommendations.append("Schedule hardware diagnostics; uncorrectable memory errors may lead to kernel panics.")

        if metrics.throttle_reasons:
            has_warning = True
            recs = ", ".join(metrics.throttle_reasons)
            recommendations.append(f"Hardware throttling active ({recs}). Workload performance may degrade.")

        # 3. Determine Overall Health Status
        if has_critical_failure:
            overall_status = HealthStatus.CRITICAL
        elif has_failed:
            # Non-critical failure (e.g. bounded micro-compute failed while driver is OK)
            overall_status = HealthStatus.CRITICAL
        elif has_warning:
            overall_status = HealthStatus.WARNING
        elif not supported_metrics:
            overall_status = HealthStatus.UNKNOWN
        else:
            overall_status = HealthStatus.HEALTHY

        # 4. Compute Health Score (0.0 to 100.0) strictly from supported metrics
        health_score = self._compute_score(
            supported_metrics=supported_metrics,
            check_results=check_results,
            metrics=metrics,
            overall_status=overall_status,
        )

        # 5. Determine Availability Status
        # Availability is orthogonal to physical health!
        availability = AvailabilityStatus.AVAILABLE
        if overall_status in (HealthStatus.CRITICAL, HealthStatus.UNAVAILABLE):
            availability = AvailabilityStatus.OFFLINE
        elif metrics.vram_usage_pct is not None and metrics.vram_usage_pct >= self.thresholds.critical_vram_pct:
            availability = AvailabilityStatus.BUSY
        elif metrics.gpu_utilization_pct is not None and metrics.gpu_utilization_pct >= self.thresholds.warning_utilization_pct:
            availability = AvailabilityStatus.BUSY

        # 6. Default recommendations if healthy
        if not recommendations and overall_status == HealthStatus.HEALTHY:
            recommendations.append("GPU is operating within all optimal nominal parameters.")

        # 7. Generic deployment readiness flag
        is_ready = (
            overall_status in (HealthStatus.HEALTHY, HealthStatus.WARNING)
            and availability == AvailabilityStatus.AVAILABLE
            and (health_score is None or health_score >= self.thresholds.min_acceptable_score)
        )

        return HealthReport(
            gpu_id=device_info.gpu_id,
            device_info=device_info,
            overall_status=overall_status,
            health_score=health_score,
            availability_status=availability,
            is_deployment_ready=is_ready,
            individual_checks=check_results,
            supported_metrics=supported_metrics,
            unsupported_metrics=unsupported_metrics,
            errors=errors,
            recommendations=recommendations,
            timestamp=datetime.now(timezone.utc),
            execution_duration_ms=round(execution_duration_ms, 2),
        )

    def _compute_score(
        self,
        supported_metrics: List[str],
        check_results: List[CheckResult],
        metrics: GpuMetrics,
        overall_status: HealthStatus,
    ) -> Optional[float]:
        """
        Calculate health score proportionally based on supported checks and telemetry.
        Never penalizes for unsupported metrics.
        """
        if not supported_metrics:
            return None

        if overall_status == HealthStatus.CRITICAL:
            return 10.0

        score = 100.0

        # Deduct for failed supported checks
        for res in check_results:
            if res.status == CheckResultStatus.FAILED:
                score -= 30.0
            elif res.status == CheckResultStatus.WARNING:
                score -= 10.0

        # Thermal impact: temperature scaling
        if metrics.temperature_celsius is not None:
            if metrics.temperature_celsius > self.thresholds.warning_temp_celsius:
                over = metrics.temperature_celsius - self.thresholds.warning_temp_celsius
                span = max(self.thresholds.critical_temp_celsius - self.thresholds.warning_temp_celsius, 1.0)
                deduction = min((over / span) * 20.0, 20.0)
                score -= deduction

        # Correctable ECC error penalty
        if metrics.ecc_correctable_errors is not None and metrics.ecc_correctable_errors > 0:
            score -= min(metrics.ecc_correctable_errors * 2.0, 15.0)

        # Throttling penalty
        if metrics.throttle_reasons:
            score -= 10.0

        return round(max(min(score, 100.0), 0.0), 1)
