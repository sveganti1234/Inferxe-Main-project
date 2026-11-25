"""
Base Health Check Interface & Runner
====================================
Standard contracts for modular health checks, with built-in timeout protection,
safe error boundary handling, and execution duration measurement.
"""

import asyncio
import time
from abc import ABC, abstractmethod
from typing import Optional, Dict, Any, List

from .types import (
    CheckResult,
    CheckResultStatus,
    GpuDeviceInfo,
    GpuMetrics,
    MetricCapability,
)
from .config import HealthThresholds
from .collector import BaseGpuCollector


class BaseHealthCheck(ABC):
    """Abstract interface for an individual GPU health check."""

    @property
    @abstractmethod
    def name(self) -> str:
        """Unique identifier for this check, e.g. 'thermal', 'memory', 'driver'."""
        pass

    @property
    @abstractmethod
    def required_capability(self) -> Optional[MetricCapability]:
        """The hardware capability required to run this check, or None if universal."""
        pass

    @abstractmethod
    async def run(
        self,
        device_info: GpuDeviceInfo,
        metrics: GpuMetrics,
        collector: BaseGpuCollector,
        thresholds: HealthThresholds,
    ) -> CheckResult:
        """Execute the check logic and return a structured CheckResult."""
        pass

    async def execute_safe(
        self,
        device_info: GpuDeviceInfo,
        metrics: GpuMetrics,
        collector: BaseGpuCollector,
        thresholds: HealthThresholds,
        timeout_seconds: Optional[float] = None,
    ) -> CheckResult:
        """
        Execute the check wrapped in capability validation and timeout safeguards.
        Guarantees that no check ever hangs or raises unhandled exceptions.
        """
        # 1. Capability Verification
        if self.required_capability is not None:
            if self.required_capability not in device_info.capabilities:
                return CheckResult(
                    check_name=self.name,
                    status=CheckResultStatus.UNSUPPORTED,
                    message=f"Metric capability '{self.required_capability.value}' is not supported by {device_info.vendor} device.",
                    metrics={},
                    duration_ms=0.0,
                    threshold_applied=None,
                    error=None,
                )

        # 2. Bounded Execution with Timeout
        timeout = timeout_seconds or thresholds.check_timeout_seconds
        start_time = time.perf_counter()

        try:
            result = await asyncio.wait_for(
                self.run(device_info, metrics, collector, thresholds),
                timeout=timeout,
            )
            elapsed_ms = (time.perf_counter() - start_time) * 1000.0
            if result.duration_ms == 0.0:
                result.duration_ms = round(elapsed_ms, 2)
            return result

        except asyncio.TimeoutError:
            elapsed_ms = (time.perf_counter() - start_time) * 1000.0
            return CheckResult(
                check_name=self.name,
                status=CheckResultStatus.FAILED,
                message=f"Check timed out after {timeout:.1f} seconds.",
                metrics={},
                duration_ms=round(elapsed_ms, 2),
                threshold_applied={"timeout_seconds": timeout},
                error=f"TimeoutError: Exceeded {timeout}s",
            )
        except Exception as exc:
            elapsed_ms = (time.perf_counter() - start_time) * 1000.0
            return CheckResult(
                check_name=self.name,
                status=CheckResultStatus.FAILED,
                message=f"Check failed due to unexpected internal error: {str(exc)}",
                metrics={},
                duration_ms=round(elapsed_ms, 2),
                threshold_applied=None,
                error=f"{type(exc).__name__}: {str(exc)}",
            )
