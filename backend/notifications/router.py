"""
FastAPI Router for Inferxe Centralized Multi-User Notification System.
Provides endpoints for customers and administrators with full authentication,
role-based authorization, and real-time polling support.
"""

import os
import logging
from typing import Optional
from decimal import Decimal
from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, HTTPException, Query, status

from .auth import AuthenticatedUser, get_current_user, require_admin_user, require_superadmin_user
from .service import NotificationService
from .db import PG_DB, PG_HOST, DBConnection, PoolTimeoutError, HEALTH_CHECK_POOL_WAIT_SECONDS

logger = logging.getLogger("inferxe.notifications.router")

router = APIRouter(prefix="/api", tags=["notifications"])

# ── Pydantic Request Models ──

class BroadcastRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    message: str = Field(..., min_length=1)
    target_group: Optional[str] = "all"
    idempotency_key: Optional[str] = None

class SuperAdminAdminCreatedRequest(BaseModel):
    created_admin_id: Optional[str] = Field(default=None, max_length=128)
    created_email: Optional[str] = Field(default=None, max_length=255)
    idempotency_key: Optional[str] = None

class SuperAdminAdminDeletedRequest(BaseModel):
    deleted_admin_id: Optional[str] = Field(default=None, max_length=128)
    deleted_email: Optional[str] = Field(default=None, max_length=255)
    idempotency_key: Optional[str] = None

class PriceUpdateRequest(BaseModel):
    gpu_id: str = Field(..., min_length=1)
    new_price: float = Field(..., gt=0)
    idempotency_key: Optional[str] = None

class GpuListingCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)
    gpu_model: Optional[str] = Field(default=None, max_length=128)
    vram: Optional[str] = Field(default="24 GB", max_length=64)
    region: Optional[str] = Field(default="Mumbai, IN", max_length=128)
    price: float = Field(..., gt=0)
    listing_id: Optional[str] = Field(default=None, max_length=64)
    quantity: Optional[int] = Field(default=1, ge=1)
    currency: Optional[str] = Field(default="INR", max_length=16)
    billing_unit: Optional[str] = Field(default="hr", max_length=32)
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
    # Administrators only: the customer whose wallet is credited (defaults to the caller).
    target_user_id: Optional[str] = Field(default=None, min_length=1, max_length=128)
    # Required for administrator credits; recorded in the transaction and the audit history.
    reason: Optional[str] = Field(default=None, max_length=500)

# Single administrator credit ceiling (INR) to catch typing mistakes; larger credits need several entries.
MAX_ADMIN_CREDIT = 1_000_000
# Demo top-up ceiling (INR) per transaction, when WALLET_SELF_RECHARGE_ENABLED is on.
MAX_DEMO_TOPUP = 100_000

class WalletRefundRequest(BaseModel):
    original_transaction_id: str = Field(..., min_length=1, description="ID of the original debit transaction to refund")
    amount: Decimal = Field(..., gt=0, description="Refund amount (max 2 decimal places)")
    description: Optional[str] = "Wallet refund"
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
        # Short wait so the probe stays fast when the pool is saturated.
        with DBConnection(autocommit=True, timeout=HEALTH_CHECK_POOL_WAIT_SECONDS) as conn:
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
    except PoolTimeoutError:
        logger.warning("PostgreSQL health check: connection pool saturated.")
        return {
            "status": "degraded",
            "database_engine": "PostgreSQL",
            "database_name": PG_DB,
            "connected": False,
            "pool_saturated": True,
            "error": "PostgreSQL connection pool is saturated.",
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
@router.put("/notifications/price-update")
@router.patch("/notifications/price-update")
@router.post("/gpu/update-price")
@router.put("/gpu/update-price")
@router.patch("/gpu/update-price")
def update_gpu_price(
    req: PriceUpdateRequest,
    admin: AuthenticatedUser = Depends(require_admin_user),
):
    """
    Admin-only: Updates GPU hourly price and broadcasts notifications to customers.
    Also creates an admin audit alert for tracking.
    """
    try:
        result = NotificationService.process_gpu_price_update(
            admin_user_id=admin.user_id,
            gpu_id=req.gpu_id,
            new_price=req.new_price,
            idempotency_key=req.idempotency_key,
        )
        return result
    except Exception as exc:
        logger.error(f"Failed to update GPU price for {req.gpu_id}: {exc}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Price update failed: {str(exc)}",
        )

@router.post("/notifications/gpu-listing")
@router.put("/notifications/gpu-listing")
@router.patch("/notifications/gpu-listing")
def create_gpu_listing(
    req: GpuListingCreateRequest,
    admin: AuthenticatedUser = Depends(require_admin_user),
):
    """
    Admin-only: Creates a new GPU listing in inventory and records an audit notification
    for administrators in an atomic transaction.
    """
    gpu_model = req.gpu_model or req.name.replace("NVIDIA ", "").strip()
    result = NotificationService.process_gpu_listing_create(
        admin_user_id=admin.user_id,
        name=req.name,
        gpu_model=gpu_model,
        vram=req.vram or "24 GB",
        region=req.region or "Mumbai, IN",
        price=req.price,
        listing_id=req.listing_id,
        quantity=req.quantity or 1,
        currency=req.currency or "INR",
        billing_unit=req.billing_unit or "hr",
        idempotency_key=req.idempotency_key,
    )
    return result

@router.post("/notifications/superadmin/admin-created")
def notify_superadmin_admin_created(
    req: SuperAdminAdminCreatedRequest,
    user: AuthenticatedUser = Depends(require_superadmin_user),
):
    """
    Governance notification endpoint triggered when an Admin account is created.
    Restricted to authenticated Super Admin users only.
    """
    return NotificationService.process_superadmin_admin_created(
        actor_admin_id=user.user_id,
        created_admin_id=req.created_admin_id,
        created_email=req.created_email,
        idempotency_key=req.idempotency_key,
    )

@router.post("/notifications/superadmin/admin-deleted")
def notify_superadmin_admin_deleted(
    req: SuperAdminAdminDeletedRequest,
    user: AuthenticatedUser = Depends(require_superadmin_user),
):
    """
    Governance notification endpoint triggered when an Admin account is deleted.
    Restricted to authenticated Super Admin users only.
    """
    return NotificationService.process_superadmin_admin_deleted(
        actor_admin_id=user.user_id,
        deleted_admin_id=req.deleted_admin_id,
        deleted_email=req.deleted_email,
        idempotency_key=req.idempotency_key,
    )

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

def _self_recharge_enabled() -> bool:
    """Demo "Add money": customers credit their own wallet with no payment taken (off unless set)."""
    return os.environ.get("WALLET_SELF_RECHARGE_ENABLED", "").strip().lower() in ("1", "true", "yes")


@router.post("/wallet/transactions")
def process_wallet_transaction(
    req: WalletTransactionRequest,
    user: AuthenticatedUser = Depends(get_current_user),
):
    """
    Integrated wallet endpoint:
    - Amount > 0: Recharges a wallet and generates WALLET_RECHARGE notification. Administrators credit a
      customer with an audit reason; customers can credit only their own wallet, and only as a labelled demo
      top-up when WALLET_SELF_RECHARGE_ENABLED is on (there is no payment gateway).
    - Amount < 0: Debits the caller's own wallet and generates WALLET_DEBIT and threshold notifications.
    """
    demo_topup = req.amount >= 0 and not user.is_admin
    if demo_topup and not _self_recharge_enabled():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Wallet top-ups are not self-service yet. Please contact Inferxe support to add funds.",
        )
    if req.target_user_id and not user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only administrators can act on another wallet.")
    if req.target_user_id and req.amount < 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="target_user_id is only supported for credits.")
    admin_credit = None
    if demo_topup:
        if not (0 < req.amount <= MAX_DEMO_TOPUP):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Enter an amount greater than 0 and at most {MAX_DEMO_TOPUP:,}.")
    elif req.amount >= 0:
        reason = (req.reason or "").strip()
        if not req.target_user_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Choose the customer whose wallet should be credited (target_user_id).")
        if len(reason) < 3:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Please give a reason (at least 3 characters) for the audit history.")
        if not (0 < req.amount <= MAX_ADMIN_CREDIT):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Credit must be greater than 0 and at most {MAX_ADMIN_CREDIT:,}.")
        admin_credit = {"administrator_email": user.email or user.user_id, "reason": reason}
    try:
        if req.amount >= 0:
            result = NotificationService.process_wallet_recharge(
                user_id=req.target_user_id or user.user_id,
                amount=req.amount,
                idempotency_key=req.idempotency_key,
                admin_credit=admin_credit,
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

@router.post("/wallet/refund")
def process_wallet_refund_endpoint(
    req: WalletRefundRequest,
    user: AuthenticatedUser = Depends(get_current_user),
):
    """
    Customer-initiated wallet refund.
    - Derives user_id strictly from Cognito JWT sub claim.
    - Links refund to an existing eligible debit transaction.
    - Prevents over-refunding via refunded_amount tracking.
    - Idempotent via idempotency_key.
    - All operations atomic in a single database transaction.
    """
    try:
        result = NotificationService.process_wallet_refund(
            user_id=user.user_id,
            original_transaction_id=req.original_transaction_id,
            amount=req.amount,
            idempotency_key=req.idempotency_key,
            description=req.description,
        )
        return result
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))

@router.get("/wallet/balance")
def get_wallet_balance(
    user: AuthenticatedUser = Depends(get_current_user),
):
    """Returns the wallet balance for the authenticated user."""
    return NotificationService.get_wallet_balance(user_id=user.user_id)

@router.get("/wallet/transactions/history")
def get_wallet_transaction_history(
    limit: int = Query(50, ge=1, le=200, description="Page limit"),
    offset: int = Query(0, ge=0, description="Page offset"),
    user: AuthenticatedUser = Depends(get_current_user),
):
    """
    Returns the wallet transaction history for the authenticated user.
    Customer A can NEVER view Customer B's transactions.
    Supports pagination (limit/offset) and newest-first sorting.
    """
    return NotificationService.fetch_wallet_transaction_history(
        user_id=user.user_id,
        limit=limit,
        offset=offset,
    )

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
            is_admin=user.is_admin,
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
        return NotificationService.get_gpu_metrics(user.user_id, instance_id, is_admin=user.is_admin)
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
        return NotificationService.get_gpu_recommendations(user.user_id, req.instance_id, req.bot_permission, is_admin=user.is_admin)
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
