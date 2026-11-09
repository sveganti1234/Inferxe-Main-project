"""
FastAPI Router for Inferxe Centralized Multi-User Notification System.
Provides endpoints for customers and administrators with full authentication,
role-based authorization, and real-time polling support.
"""

import os
import logging
from typing import Dict, Any, List, Optional
from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, HTTPException, Query, status

from .auth import AuthenticatedUser, get_current_user, require_admin_user
from .service import NotificationService
from .db import PG_DB, PG_HOST, DBConnection

logger = logging.getLogger("inferxe.notifications.router")

router = APIRouter(prefix="/api", tags=["notifications"])

# ── Pydantic Request Models ──

class BroadcastRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    message: str = Field(..., min_length=1)
    target_group: Optional[str] = "all"
    idempotency_key: Optional[str] = None

class PriceUpdateRequest(BaseModel):
    gpu_id: str = Field(..., min_length=1)
    new_price: float = Field(..., gt=0)
    idempotency_key: Optional[str] = None

class MaintenanceRequest(BaseModel):
    gpu_model: str = Field(..., min_length=1)
    region: str = Field(..., min_length=1)
    start_time: str = Field(..., min_length=1)
    end_time: str = Field(..., min_length=1)
    reason: str = Field(..., min_length=1)
    idempotency_key: Optional[str] = None

class WalletTransactionRequest(BaseModel):
    amount: float = Field(...)
    status: Optional[str] = "completed"
    type: Optional[str] = None
    description: Optional[str] = "Wallet Transaction"
    idempotency_key: Optional[str] = None

class DeploymentStatusRequest(BaseModel):
    deployment_id: str = Field(..., min_length=1)
    new_status: str = Field(..., min_length=1)
    gpu_name: Optional[str] = "NVIDIA H100"
    deployment_name: Optional[str] = None
    region: Optional[str] = "Mumbai, IN"
    error_message: Optional[str] = None
    idempotency_key: Optional[str] = None

class GpuRecommendationRequest(BaseModel):
    instance_id: str = Field(..., min_length=1)
    bot_permission: bool = True

class GpuAlertTriggerRequest(BaseModel):
    instance_id: str = Field(..., min_length=1)
    alert_type: str = Field(..., min_length=1)
    title: str = Field(..., min_length=1)
    message: str = Field(..., min_length=1)
    idempotency_key: Optional[str] = None

# ── Diagnostic & Health Endpoints ──

@router.get("/notifications/db-status")
def get_db_status():
    """Returns database connection status and engine details."""
    try:
        with DBConnection(autocommit=True) as conn:
            cur = conn.cursor()
            cur.execute("SELECT current_database(), version();")
            row = cur.fetchone()
            return {
                "status": "healthy",
                "database_engine": "PostgreSQL",
                "database_name": row[0] if row else PG_DB,
                "host": PG_HOST,
                "connected": True,
            }
    except Exception as e:
        logger.error("PostgreSQL health check failed (%s).", type(e).__name__)
        return {
            "status": "degraded",
            "database_engine": "PostgreSQL",
            "database_name": PG_DB,
            "connected": False,
            "error": "PostgreSQL connection failed.",
        }

# ── Customer Endpoints ──

@router.get("/notifications")
def list_notifications(
    unread_only: bool = Query(False, description="Filter for unread notifications only"),
    limit: int = Query(50, ge=1, le=200, description="Page limit"),
    offset: int = Query(0, ge=0, description="Page offset"),
    user: AuthenticatedUser = Depends(get_current_user),
):
    """
    Returns user-specific notifications for the authenticated user.
    Customer A can NEVER view Customer B's notifications.
    """
    return NotificationService.get_notifications(
        user_id=user.user_id,
        unread_only=unread_only,
        limit=limit,
        offset=offset,
    )

@router.get("/notifications/unread-count")
def get_unread_count(
    user: AuthenticatedUser = Depends(get_current_user),
):
    """Returns real-time unread count badge value for the current user."""
    count = NotificationService.get_unread_count(user.user_id)
    return {"unread_count": count}

@router.patch("/notifications/{notification_id}/read")
def mark_notification_as_read(
    notification_id: str,
    user: AuthenticatedUser = Depends(get_current_user),
):
    """
    Marks a notification as read.
    Enforces user isolation: raises 403 Forbidden if notification belongs to another user.
    """
    try:
        updated = NotificationService.mark_as_read(notification_id, user.user_id)
        return updated
    except KeyError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Notification not found.",
        )
    except PermissionError as pe:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(pe),
        )

@router.patch("/notifications/read-all")
def mark_all_notifications_as_read(
    user: AuthenticatedUser = Depends(get_current_user),
):
    """Marks all unread notifications for the authenticated user as read."""
    count = NotificationService.mark_all_as_read(user.user_id)
    return {"status": "success", "updated_count": count}

@router.delete("/notifications/{notification_id}")
def delete_notification(
    notification_id: str,
    user: AuthenticatedUser = Depends(get_current_user),
):
    """
    Deletes a notification belonging to the authenticated user.
    Enforces user isolation: raises 403 Forbidden if notification belongs to another user.
    """
    try:
        NotificationService.delete_notification(notification_id, user.user_id)
        return {"deleted": True, "id": notification_id}
    except KeyError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Notification not found.",
        )
    except PermissionError as pe:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(pe),
        )

# ── Admin Endpoints ──

@router.post("/notifications/broadcast")
def broadcast_announcement(
    req: BroadcastRequest,
    admin: AuthenticatedUser = Depends(require_admin_user),
):
    """Admin-only: Broadcasts platform announcement to customers."""
    result = NotificationService.process_system_announcement(
        admin_user_id=admin.user_id,
        title=req.title,
        message=req.message,
        target_group=req.target_group or "all",
        idempotency_key=req.idempotency_key,
    )
    return result

@router.post("/notifications/price-update")
@router.post("/gpu/update-price")
def update_gpu_price(
    req: PriceUpdateRequest,
    admin: AuthenticatedUser = Depends(require_admin_user),
):
    """
    Admin-only: Updates GPU hourly price and broadcasts notifications to customers.
    Also creates an admin audit alert for tracking.
    """
    result = NotificationService.process_gpu_price_update(
        admin_user_id=admin.user_id,
        gpu_id=req.gpu_id,
        new_price=req.new_price,
        idempotency_key=req.idempotency_key,
    )
    return result

@router.post("/notifications/maintenance")
def schedule_maintenance(
    req: MaintenanceRequest,
    admin: AuthenticatedUser = Depends(require_admin_user),
):
    """Admin-only: Schedules GPU maintenance and notifies affected customers."""
    result = NotificationService.process_maintenance_schedule(
        admin_user_id=admin.user_id,
        gpu_model=req.gpu_model,
        region=req.region,
        start_time=req.start_time,
        end_time=req.end_time,
        reason=req.reason,
        idempotency_key=req.idempotency_key,
    )
    return result

# ── Integrated Workflow Triggers (Wallet & Deployments) ──

@router.post("/wallet/transactions")
def process_wallet_transaction(
    req: WalletTransactionRequest,
    user: AuthenticatedUser = Depends(get_current_user),
):
    """
    Integrated wallet endpoint:
    - Amount > 0: Recharges wallet and generates WALLET_RECHARGE notification.
    - Amount < 0: Debits wallet and generates WALLET_DEBIT and threshold notifications.
    """
    try:
        if req.amount >= 0:
            result = NotificationService.process_wallet_recharge(
                user_id=user.user_id,
                amount=req.amount,
                idempotency_key=req.idempotency_key,
            )
        else:
            result = NotificationService.process_wallet_debit(
                user_id=user.user_id,
                amount=abs(req.amount),
                description=req.description or "GPU Compute Usage",
                idempotency_key=req.idempotency_key,
            )
        return result
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))

@router.post("/deployments/status")
def update_deployment_status(
    req: DeploymentStatusRequest,
    user: AuthenticatedUser = Depends(get_current_user),
):
    """
    Integrated GPU deployment status endpoint:
    - Updates deployment state.
    - Notifies the deployment owner only.
    - Prevents duplicate alerts if status has not changed.
    """
    try:
        result = NotificationService.process_deployment_status(
            user_id=user.user_id,
            deployment_id=req.deployment_id,
            new_status=req.new_status,
            gpu_name=req.gpu_name or "NVIDIA H100",
            deployment_name=req.deployment_name,
            region=req.region or "Mumbai, IN",
            error_message=req.error_message,
            idempotency_key=req.idempotency_key,
        )
        return result
    except PermissionError as pe:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(pe))
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))



# ── Stage 2: GPU Runtime Monitoring & AI Intelligence Endpoints ──

@router.get("/gpu/metrics")
def get_gpu_runtime_metrics(
    instance_id: str = Query(..., description="GPU deployment instance ID"),
    user: AuthenticatedUser = Depends(get_current_user),
):
    """
    Retrieves real-time GPU runtime metrics and telemetry for an instance.
    Enforces customer isolation: checks that deployment belongs to user.user_id.
    """
    try:
        return NotificationService.get_gpu_metrics(user.user_id, instance_id)
    except KeyError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Deployment instance '{instance_id}' not found.")
    except PermissionError as pe:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(pe))

@router.post("/gpu/recommendations")
def get_gpu_recommendations(
    req: GpuRecommendationRequest,
    user: AuthenticatedUser = Depends(get_current_user),
):
    """
    Generates intelligent AI recommendations based on GPU instance telemetry,
    pricing, and memory requirements. Strictly respects AI Assistant permissions.
    """
    try:
        return NotificationService.get_gpu_recommendations(user.user_id, req.instance_id, req.bot_permission)
    except KeyError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Deployment instance '{req.instance_id}' not found.")
    except PermissionError as pe:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(pe))

@router.post("/gpu/alerts/trigger")
def trigger_contextual_gpu_alert(
    req: GpuAlertTriggerRequest,
    user: AuthenticatedUser = Depends(get_current_user),
):
    """
    Creates an intelligent contextual notification for the authenticated user,
    preventing duplicate alerts with idempotency.
    """
    return NotificationService.trigger_contextual_gpu_alert(
        user_id=user.user_id,
        deployment_id=req.instance_id,
        alert_type=req.alert_type,
        title=req.title,
        message=req.message,
        idempotency_key=req.idempotency_key,
    )


# ── Workspace Settings Endpoints ──

class WorkspaceSettingsUpdateRequest(BaseModel):
    monthly_budget: float = Field(..., ge=0)
    spending_alerts_enabled: Optional[bool] = True
    weekly_report_enabled: Optional[bool] = False
    cors_origins: Optional[str] = "https://app.novatech.ai, http://localhost:3000"

@router.get("/workspace/settings")
def get_workspace_settings(user: AuthenticatedUser = Depends(get_current_user)):
    """
    Returns workspace budget, alert thresholds, and security preferences.
    """
    return NotificationService.get_workspace_settings(user.user_id)

@router.post("/workspace/settings")
def save_workspace_settings(
    req: WorkspaceSettingsUpdateRequest,
    user: AuthenticatedUser = Depends(get_current_user),
):
    """
    Updates workspace configuration with customer tenant isolation.
    """
    try:
        return NotificationService.save_workspace_settings(user.user_id, req.dict())
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))
