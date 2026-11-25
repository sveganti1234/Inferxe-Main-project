"""
GPU Health Check Engine Orchestrator
====================================
Central coordinator providing a clean, reusable interface for GPU discovery,
metric scraping, individual check execution, health evaluation, and deployment readiness.
"""

import time
import asyncio
from typing import List, Dict, Optional, Any

from .types import (
    GpuDeviceInfo,
    GpuMetrics,
    CheckResult,
    HealthReport,
    HealthStatus,
    AvailabilityStatus,
    DeploymentRequirement,
    ReadinessResult,
)
from .config import HealthThresholds
from .collector import BaseGpuCollector, DeviceNotFoundError
from .checks import BaseHealthCheck
from .evaluator import HealthEvaluator
from .readiness import DeploymentReadinessChecker


class GpuHealthEngine:
    """Reusable, framework-independent GPU health evaluation engine."""

    def __init__(
        self,
        collector: Optional[BaseGpuCollector] = None,
        checks: Optional[List[BaseHealthCheck]] = None,
        thresholds: Optional[HealthThresholds] = None,
    ):
        self.collector = collector
        self.checks: Dict[str, BaseHealthCheck] = {}
        if checks is not None:
            for chk in checks:
                self.checks[chk.name] = chk
        else:
            try:
                from gpu_health.checks import get_standard_checks
            except ImportError:
                from ..checks import get_standard_checks  # type: ignore
            for chk in get_standard_checks():
                self.checks[chk.name] = chk

        self.thresholds = thresholds or HealthThresholds.default()
        self.evaluator = HealthEvaluator(thresholds=self.thresholds)
        self.readiness_checker = DeploymentReadinessChecker()

    def set_collector(self, collector: BaseGpuCollector) -> None:
        """Assign or update the active hardware telemetry collector."""
        self.collector = collector

    def register_check(self, check: BaseHealthCheck) -> None:
        """Register an individual health check."""
        self.checks[check.name] = check

    def _ensure_collector(self) -> BaseGpuCollector:
        """Ensure a collector is configured."""
        if not self.collector:
            # Lazy load default registry collector if available
            try:
                from gpu_health.collectors.registry import get_default_collector
            except ImportError:
                from ..collectors.registry import get_default_collector  # type: ignore
            self.collector = get_default_collector()
        return self.collector

    async def detect_gpus(self) -> List[GpuDeviceInfo]:
        """Discover all accessible GPUs on the system."""
        collector = self._ensure_collector()
        return await collector.detect_devices()

    async def get_gpu_info(self, gpu_id: str) -> GpuDeviceInfo:
        """Retrieve static hardware info and capabilities for a specific GPU ID."""
        collector = self._ensure_collector()
        return await collector.get_device_info(gpu_id)

    async def collect_metrics(self, gpu_id: str) -> GpuMetrics:
        """Retrieve real-time hardware telemetry for a specific GPU ID."""
        collector = self._ensure_collector()
        return await collector.collect_metrics(gpu_id)

    async def run_check(
        self,
        gpu_id: str,
        check_name: str,
        timeout_seconds: Optional[float] = None,
    ) -> CheckResult:
        """Execute a single specified health check."""
        collector = self._ensure_collector()
        if check_name not in self.checks:
            raise ValueError(f"Health check '{check_name}' is not registered.")

        device_info = await collector.get_device_info(gpu_id)
        metrics = await collector.collect_metrics(gpu_id)
        check = self.checks[check_name]

        return await check.execute_safe(
            device_info=device_info,
            metrics=metrics,
            collector=collector,
            thresholds=self.thresholds,
            timeout_seconds=timeout_seconds,
        )

    async def run_all_checks(
        self,
        gpu_id: str,
        timeout_seconds: Optional[float] = None,
    ) -> HealthReport:
        """
        Execute all registered health checks, evaluate health score,
        and generate a standardized HealthReport.
        """
        start_time = time.perf_counter()
        collector = self._ensure_collector()

        device_info = await collector.get_device_info(gpu_id)
        metrics = await collector.collect_metrics(gpu_id)

        # Run registered checks sequentially or concurrently with timeouts
        check_results: List[CheckResult] = []
        for check in self.checks.values():
            result = await check.execute_safe(
                device_info=device_info,
                metrics=metrics,
                collector=collector,
                thresholds=self.thresholds,
                timeout_seconds=timeout_seconds,
            )
            check_results.append(result)

        elapsed_ms = (time.perf_counter() - start_time) * 1000.0

        return self.evaluator.evaluate(
            device_info=device_info,
            metrics=metrics,
            check_results=check_results,
            execution_duration_ms=elapsed_ms,
        )

    async def check_availability(self, gpu_id: str) -> AvailabilityStatus:
        """Determine whether the GPU is available for scheduling."""
        report = await self.run_all_checks(gpu_id=gpu_id)
        return report.availability_status

    async def check_deployment_readiness(
        self,
        gpu_id: str,
        requirement: DeploymentRequirement,
    ) -> ReadinessResult:
        """Evaluate if the GPU can immediately accept a specific workload deployment."""
        report = await self.run_all_checks(gpu_id=gpu_id)
        return self.readiness_checker.evaluate_readiness(report=report, requirement=requirement)
