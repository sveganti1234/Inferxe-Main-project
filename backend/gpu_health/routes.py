"""
GPU Health Check API Routes
===========================
FastAPI endpoints providing health monitoring, real-time diagnostic checks,
deployment readiness validation, and historical audits.
Mounted under `/api/v1/gpu/health`.
"""

import logging
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field

from .core.types import (
    HealthReport,
    DeploymentRequirement,
    ReadinessResult,
)
from .core.collector import DeviceNotFoundError
from .service import get_gpu_health_service

logger = logging.getLogger("inferxe.gpu_health.routes")

router = APIRouter(
    prefix="/api/v1/gpu/health",
    tags=["GPU Health"],
)


class GpuHealthSummaryResponse(BaseModel):
    total_gpus: int
    healthy_count: int
    warning_count: int
    critical_count: int
    unavailable_count: int
    items: List[Dict[str, Any]]


class RunCheckRequest(BaseModel):
    timeout_seconds: Optional[float] = Field(default=None, description="Custom check execution timeout")
    persist_history: bool = Field(default=True, description="Whether to persist check record to database")


class ReadinessCheckRequest(BaseModel):
    required_vram_bytes: int = Field(..., description="Minimum free VRAM required in bytes")
    required_runtime: Optional[str] = Field(default=None, description="Compute runtime name, e.g. 'cuda'")
    min_health_score: float = Field(default=75.0, description="Minimum acceptable health score (0-100)")
    max_acceptable_temp_celsius: float = Field(default=82.0, description="Maximum allowable current temperature")
    allow_shared: bool = Field(default=False, description="Allow sharing with other workloads")


class HistoryResponse(BaseModel):
    gpu_id: Optional[str] = None
    total: int
    limit: int
    offset: int
    history: List[Dict[str, Any]]


@router.get("", response_model=GpuHealthSummaryResponse)
async def list_gpus_health():
    """
    Get health and operational summary for all registered and detected GPUs.
    """
    service = get_gpu_health_service()
    items = await service.list_gpus_health()

    healthy = sum(1 for i in items if i.get("overall_status") == "healthy")
    warning = sum(1 for i in items if i.get("overall_status") == "warning")
    critical = sum(1 for i in items if i.get("overall_status") == "critical")
    unavailable = sum(1 for i in items if i.get("overall_status") in ("unavailable", "unknown"))

    return GpuHealthSummaryResponse(
        total_gpus=len(items),
        healthy_count=healthy,
        warning_count=warning,
        critical_count=critical,
        unavailable_count=unavailable,
        items=items,
    )


@router.get("/history", response_model=HistoryResponse)
async def get_fleet_health_history(
    gpu_id: Optional[str] = Query(default=None, description="Filter by specific GPU ID"),
    status: Optional[str] = Query(default=None, description="Filter by status (healthy, warning, critical)"),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
):
    """
    Retrieve fleet-wide historical health audit logs with optional GPU or status filters.
    """
    service = get_gpu_health_service()
    res = await service.get_health_history(gpu_id=gpu_id, status=status, limit=limit, offset=offset)
    return HistoryResponse(
        gpu_id=gpu_id,
        total=res["total"],
        limit=limit,
        offset=offset,
        history=res["history"],
    )


@router.get("/{gpu_id}", response_model=HealthReport)
async def get_gpu_health(gpu_id: str):
    """
    Get the detailed health report and individual check results for a specific GPU.
    """
    service = get_gpu_health_service()
    try:
        return await service.get_gpu_health_report(gpu_id=gpu_id, persist=False)
    except DeviceNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"GPU with ID '{gpu_id}' not found or not registered.",
        )
    except Exception as exc:
        logger.error(f"Failed to generate health report for '{gpu_id}': {exc}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Internal health check error: {str(exc)}",
        )


@router.post("/{gpu_id}/check", response_model=HealthReport)
async def trigger_health_check(gpu_id: str, payload: Optional[RunCheckRequest] = None):
    """
    Run an on-demand, synchronous health check cycle on a specific GPU.
    """
    service = get_gpu_health_service()
    persist = payload.persist_history if payload else True
    try:
        return await service.get_gpu_health_report(gpu_id=gpu_id, persist=persist)
    except DeviceNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"GPU with ID '{gpu_id}' not found.",
        )
    except Exception as exc:
        logger.error(f"Error running health check on '{gpu_id}': {exc}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to execute health check: {str(exc)}",
        )


@router.post("/{gpu_id}/readiness", response_model=ReadinessResult)
async def check_readiness(gpu_id: str, payload: ReadinessCheckRequest):
    """
    Evaluate whether a GPU satisfies specific resource constraints for a requested deployment.
    """
    service = get_gpu_health_service()
    requirement = DeploymentRequirement(
        required_vram_bytes=payload.required_vram_bytes,
        required_runtime=payload.required_runtime,
        min_health_score=payload.min_health_score,
        max_acceptable_temp_celsius=payload.max_acceptable_temp_celsius,
        allow_shared=payload.allow_shared,
    )
    try:
        return await service.check_deployment_readiness(gpu_id=gpu_id, requirement=requirement)
    except DeviceNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"GPU with ID '{gpu_id}' not found.",
        )
    except Exception as exc:
        logger.error(f"Error checking deployment readiness for '{gpu_id}': {exc}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to check deployment readiness: {str(exc)}",
        )


@router.get("/{gpu_id}/history", response_model=HistoryResponse)
async def get_gpu_history(
    gpu_id: str,
    status: Optional[str] = Query(default=None, description="Filter by status (healthy, warning, critical)"),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
):
    """
    Retrieve historical health check evaluations and trends for a specific GPU.
    """
    service = get_gpu_health_service()
    res = await service.get_health_history(gpu_id=gpu_id, status=status, limit=limit, offset=offset)
    return HistoryResponse(
        gpu_id=gpu_id,
        total=res["total"],
        limit=limit,
        offset=offset,
        history=res["history"],
    )
