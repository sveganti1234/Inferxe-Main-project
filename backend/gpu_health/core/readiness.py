"""
Deployment Readiness Evaluator
==============================
Evaluates whether a specific GPU is suitable and ready to accept a requested workload deployment.
Considers current physical health, free VRAM, allocation state, and runtime environment.
"""

from typing import List, Optional
from .types import (
    HealthStatus,
    AvailabilityStatus,
    HealthReport,
    DeploymentRequirement,
    ReadinessResult,
)


class DeploymentReadinessChecker:
    """Evaluates GPU readiness for target inference or fine-tuning workloads."""

    def evaluate_readiness(
        self,
        report: HealthReport,
        requirement: DeploymentRequirement,
    ) -> ReadinessResult:
        """
        Compare current GPU state from HealthReport against DeploymentRequirement.
        """
        gpu_id = report.gpu_id
        reasons: List[str] = []
        missing_requirements: List[str] = []

        # 1. Health Status Check
        if report.overall_status in (HealthStatus.CRITICAL, HealthStatus.UNAVAILABLE):
            missing_requirements.append("hardware_health")
            reasons.append(
                f"GPU health is {report.overall_status.value}. Unhealthy hardware cannot accept workloads."
            )
        elif report.health_score is not None and report.health_score < requirement.min_health_score:
            missing_requirements.append("health_score")
            reasons.append(
                f"GPU health score ({report.health_score:.1f}) is below minimum requirement ({requirement.min_health_score:.1f})."
            )

        # 2. Availability Check
        if not requirement.allow_shared:
            if report.availability_status in (AvailabilityStatus.ALLOCATED, AvailabilityStatus.BUSY):
                missing_requirements.append("availability")
                reasons.append(
                    f"GPU is currently {report.availability_status.value} and shared workload allocation is not enabled."
                )

        # 3. VRAM Capacity Check
        # Derive available free VRAM from metrics in checks or device total
        free_vram: Optional[int] = None
        current_temp: Optional[float] = None

        for check in report.individual_checks:
            if "vram_free_bytes" in check.metrics:
                free_vram = check.metrics["vram_free_bytes"]
            if "temperature_celsius" in check.metrics:
                current_temp = check.metrics["temperature_celsius"]

        if free_vram is None:
            # Fallback if no workload was running: total vram
            free_vram = report.device_info.total_vram_bytes

        if free_vram < requirement.required_vram_bytes:
            missing_requirements.append("vram_capacity")
            req_gb = requirement.required_vram_bytes / (1024 ** 3)
            avail_gb = free_vram / (1024 ** 3)
            reasons.append(
                f"Insufficient free VRAM: requested {req_gb:.1f} GB, but only {avail_gb:.1f} GB available."
            )

        # 4. Temperature Check
        if current_temp is not None:
            if current_temp > requirement.max_acceptable_temp_celsius:
                missing_requirements.append("temperature")
                reasons.append(
                    f"Current GPU temperature ({current_temp:.1f}°C) exceeds workload threshold ({requirement.max_acceptable_temp_celsius:.1f}°C)."
                )

        # 5. Runtime Environment Check
        if requirement.required_runtime:
            req_rt = requirement.required_runtime.lower()
            device_rt = (report.device_info.runtime_version or "").lower()
            if req_rt not in device_rt and req_rt not in (report.device_info.vendor or "").lower():
                missing_requirements.append("runtime_compatibility")
                reasons.append(
                    f"Required runtime '{requirement.required_runtime}' not matched by device runtime '{report.device_info.runtime_version}'."
                )

        # 6. Conclusion
        is_ready = len(missing_requirements) == 0

        if is_ready:
            reasons.append(
                f"GPU {gpu_id} is healthy and satisfies all resource requirements "
                f"({free_vram / (1024 ** 3):.1f} GB free VRAM available)."
            )

        return ReadinessResult(
            gpu_id=gpu_id,
            is_ready=is_ready,
            overall_status=report.overall_status,
            availability_status=report.availability_status,
            reasons=reasons,
            missing_requirements=missing_requirements,
            current_vram_available_bytes=free_vram,
            current_temp_celsius=current_temp,
        )
