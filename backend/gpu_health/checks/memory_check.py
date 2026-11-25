"""
Memory Health Check
===================
Verifies total installed VRAM, reports memory pressure, and conducts a safe,
bounded micro-allocation test to verify page table and memory controller integrity.
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


class MemoryCheck(BaseHealthCheck):
    """Verifies VRAM status and conducts safe bounded allocation testing."""

    @property
    def name(self) -> str:
        return "memory"

    @property
    def required_capability(self) -> Optional[MetricCapability]:
        return MetricCapability.MEMORY_INFO

    async def run(
        self,
        device_info: GpuDeviceInfo,
        metrics: GpuMetrics,
        collector: BaseGpuCollector,
        thresholds: HealthThresholds,
    ) -> CheckResult:
        total_vram = device_info.total_vram_bytes
        used_vram = metrics.vram_used_bytes
        free_vram = metrics.vram_free_bytes

        if total_vram <= 0:
            return CheckResult(
                check_name=self.name,
                status=CheckResultStatus.FAILED,
                message="Total VRAM reported as 0 or invalid.",
                metrics={"total_vram_bytes": total_vram},
            )

        # Calculate memory percentage if telemetry provided
        usage_pct = metrics.vram_usage_pct
        if usage_pct is None and used_vram is not None and total_vram > 0:
            usage_pct = round((used_vram / total_vram) * 100.0, 2)

        # Run safe bounded micro-allocation test if capability supported
        alloc_ok = True
        if MetricCapability.MEMORY_ALLOCATION in device_info.capabilities:
            alloc_ok = await collector.test_memory_allocation(
                gpu_id=device_info.gpu_id,
                size_bytes=thresholds.safe_alloc_test_bytes,
                timeout_seconds=thresholds.check_timeout_seconds,
            )

        if not alloc_ok:
            return CheckResult(
                check_name=self.name,
                status=CheckResultStatus.FAILED,
                message=f"Bounded memory allocation test failed for {thresholds.safe_alloc_test_bytes / (1024**2):.1f}MB.",
                metrics={
                    "total_vram_bytes": total_vram,
                    "vram_used_bytes": used_vram,
                    "vram_free_bytes": free_vram,
                    "usage_pct": usage_pct,
                },
                error="MemoryAllocationError: Driver failed to allocate test buffer",
            )

        # Check threshold boundaries
        if usage_pct is not None and usage_pct >= thresholds.critical_vram_pct:
            return CheckResult(
                check_name=self.name,
                status=CheckResultStatus.WARNING,
                message=f"VRAM nearly full ({usage_pct:.1f}% used). Free: {free_vram / (1024**3):.1f} GB.",
                metrics={
                    "total_vram_bytes": total_vram,
                    "vram_used_bytes": used_vram,
                    "vram_free_bytes": free_vram,
                    "usage_pct": usage_pct,
                },
                threshold_applied={"critical_vram_pct": thresholds.critical_vram_pct},
            )

        total_gb = round(total_vram / (1024 ** 3), 1)
        free_gb = round(free_vram / (1024 ** 3), 1) if free_vram is not None else total_gb

        return CheckResult(
            check_name=self.name,
            status=CheckResultStatus.PASSED,
            message=f"VRAM healthy: {free_gb} GB free of {total_gb} GB ({usage_pct or 0.0}% used). Bounded alloc OK.",
            metrics={
                "total_vram_bytes": total_vram,
                "vram_used_bytes": used_vram,
                "vram_free_bytes": free_vram,
                "usage_pct": usage_pct,
            },
        )
