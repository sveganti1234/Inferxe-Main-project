"""
routes.py
=========
FastAPI route definitions for the Inferxe Inference API.
Endpoints:
  - POST /api/v1/inference: Authenticated model execution
  - GET  /api/v1/health: Service and database status
  - POST /api/v1/api-keys: Issue customer API keys
"""

import os
import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

from inference.database import get_db, check_database_connection
from inference.models import APIKey
from inference.schemas import (
    InferenceRequest,
    InferenceResponse,
    HealthResponse,
    APIKeyCreateRequest,
    APIKeyCreateResponse,
    APIKeyItem,
    APIKeyListResponse,
    APIKeyRevokeResponse,
)
from inference.auth import (
    verify_customer_api_key,
    generate_api_key,
    extract_cognito_sub,
    require_cognito_user,
)
from inference.service import InferenceService

router = APIRouter(prefix="/api/v1", tags=["Inference & Management"])

# Global inference service instance
inference_service = InferenceService()


@router.post(
    "/inference",
    response_model=InferenceResponse,
    status_code=status.HTTP_200_OK,
    summary="Execute Model Inference",
    description="Submits a prompt to NVIDIA Nemotron, returning generated text and exact token telemetry."
)
async def run_inference(
    request: InferenceRequest,
    api_key: APIKey = Depends(verify_customer_api_key),
    db: Session = Depends(get_db)
):
    """
    Execute prompt inference using NVIDIA Nemotron.
    Requires Bearer token authentication with a valid Inferxe customer API key.
    """
    return inference_service.execute_inference(
        request=request,
        api_key=api_key,
        db=db
    )


@router.get(
    "/health",
    response_model=HealthResponse,
    summary="Health & Dependency Check",
    description="Returns connectivity status of the service, PostgreSQL database, and NVIDIA provider."
)
async def health_check(db: Session = Depends(get_db)):
    """Health status check."""
    db_ok = check_database_connection(db.get_bind())
    nvidia_configured = bool(os.getenv("NVIDIA_API_KEY"))

    db_status = "connected" if db_ok else "unreachable"
    nvidia_status = "configured" if nvidia_configured else "missing_api_key"
    overall_status = "ok" if (db_ok and nvidia_configured) else "degraded"

    return HealthResponse(
        status=overall_status,
        service="inferxe-inference-api",
        database=db_status,
        nvidia_provider=nvidia_status,
        version="1.0.0"
    )


@router.post(
    "/api-keys",
    response_model=APIKeyCreateResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create Customer API Key",
    description="Generates a new secure customer API key for an authenticated Cognito user. Rejects anonymous requests."
)
async def create_api_key(
    req: APIKeyCreateRequest,
    user_id: str = Depends(require_cognito_user),
    db: Session = Depends(get_db)
):
    """
    Issue a new customer API key.
    Requires verified Cognito JWT authentication. Rejects anonymous calls.
    """
    raw_key, key_prefix, key_hash = generate_api_key(environment=req.environment or "live")

    new_key = APIKey(
        id=uuid.uuid4(),
        user_id=user_id,
        name=req.name or "Default Key",
        key_prefix=key_prefix,
        key_hash=key_hash,
        environment=req.environment or "live",
        is_active=True,
        created_at=datetime.now(timezone.utc)
    )

    try:
        db.add(new_key)
        db.commit()
        db.refresh(new_key)
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to persist API key in database: {e}"
        )

    return APIKeyCreateResponse(
        id=str(new_key.id),
        name=new_key.name,
        key_prefix=new_key.key_prefix,
        api_key=raw_key,  # Customer must copy this now!
        environment=new_key.environment,
        created_at=new_key.created_at.isoformat()
    )


@router.get(
    "/api-keys",
    response_model=APIKeyListResponse,
    summary="List Customer API Keys",
    description="Returns all API keys owned by the authenticated Cognito user without exposing secret hashes."
)
async def list_api_keys(
    user_id: str = Depends(require_cognito_user),
    db: Session = Depends(get_db)
):
    """
    List API keys for authenticated Cognito user.
    Enforces user isolation: customers only receive their own keys.
    """
    keys = (
        db.query(APIKey)
        .filter(APIKey.user_id == user_id)
        .order_by(APIKey.created_at.desc())
        .all()
    )

    return APIKeyListResponse(
        success=True,
        keys=[
            APIKeyItem(
                id=str(k.id),
                user_id=k.user_id,
                name=k.name,
                key_prefix=k.key_prefix,
                environment=k.environment,
                is_active=bool(k.is_active and k.revoked_at is None),
                created_at=k.created_at.isoformat() if k.created_at else "",
                last_used_at=k.last_used_at.isoformat() if k.last_used_at else None,
                revoked_at=k.revoked_at.isoformat() if k.revoked_at else None,
            )
            for k in keys
        ]
    )


@router.delete(
    "/api-keys/{key_id}",
    response_model=APIKeyRevokeResponse,
    summary="Revoke Customer API Key",
    description="Revokes an API key owned by the authenticated user. Sets is_active=False and revoked_at."
)
async def revoke_api_key(
    key_id: str,
    user_id: str = Depends(require_cognito_user),
    db: Session = Depends(get_db)
):
    """
    Revoke a customer API key.
    Enforces tenant ownership: a customer cannot revoke another customer's key.
    """
    try:
        key_uuid = uuid.UUID(key_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid key ID format. Expected UUID."
        )

    key = db.query(APIKey).filter(APIKey.id == key_uuid).first()
    if not key:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="API key not found."
        )

    # Enforce ownership
    if key.user_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: You cannot revoke an API key belonging to another user."
        )

    if not key.is_active or key.revoked_at is not None:
        return APIKeyRevokeResponse(
            success=True,
            message="API key is already revoked.",
            id=str(key.id)
        )

    key.is_active = False
    key.revoked_at = datetime.now(timezone.utc)

    try:
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to update key status in database: {e}"
        )

    return APIKeyRevokeResponse(
        success=True,
        message="API key revoked successfully.",
        id=str(key.id)
    )
