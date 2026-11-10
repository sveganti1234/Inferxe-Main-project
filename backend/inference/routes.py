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
from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

from inference.database import get_db, check_database_connection
from inference.supabase_api_keys import (
    APIKeyForbiddenError,
    APIKeyNotFoundError,
    SupabaseAPIKeyError,
    SupabaseAPIKeyRecord,
    SupabaseAPIKeyRepository,
    SupabaseAPIKeyServiceUnavailableError,
    SupabaseAPIKeyValidationError,
    get_api_key_repository,
)
from inference.supabase_telemetry import (
    SupabaseTelemetryRepository,
    get_telemetry_repository,
)
from inference.schemas import (
    InferenceRequest,
    InferenceResponse,
    HealthResponse,
    APIKeyCreateRequest,
    APIKeyCreateResponse,
    APIKeyItem,
    APIKeyListResponse,
    APIKeyRevokeResponse,
    SSHKeyCreateRequest,
    SSHKeyResponse,
    SSHKeyItem,
    SSHKeyListResponse,
    SSHKeyDeleteResponse,
    NotebookCreateRequest,
    NotebookResponse,
    NotebookListResponse,
    NotebookActionResponse,
)
from inference.ssh_key_service import (
    create_ssh_key,
    list_user_ssh_keys,
    delete_ssh_key,
    SSHKeyValidationError,
    DuplicateSSHKeyError,
)
from inference.notebook_service import (
    create_notebook,
    list_user_notebooks,
    get_notebook,
    start_notebook,
    stop_notebook,
    terminate_notebook,
    serialize_notebook,
    NotebookNotFoundError,
    NotebookValidationError,
    InvalidStateTransitionError,
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
def run_inference(
    request: InferenceRequest,
    api_key: SupabaseAPIKeyRecord = Depends(verify_customer_api_key),
    telemetry_repo: SupabaseTelemetryRepository = Depends(get_telemetry_repository),
):
    """
    Execute prompt inference using NVIDIA Nemotron.
    Requires Bearer token authentication with a valid Inferxe customer API key.
    """
    return inference_service.execute_inference(
        request=request,
        api_key=api_key,
        telemetry_repo=telemetry_repo,
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
def create_api_key(
    req: APIKeyCreateRequest,
    user_id: str = Depends(require_cognito_user),
    repo: SupabaseAPIKeyRepository = Depends(get_api_key_repository),
):
    """
    Issue a new customer API key in Supabase.
    Requires verified Cognito JWT authentication. Rejects anonymous calls.
    """
    raw_key, key_prefix, key_hash = generate_api_key(environment=req.environment or "live")

    try:
        new_key = repo.create_api_key(
            user_id=user_id,
            name=req.name or "Default Key",
            key_prefix=key_prefix,
            secret_hash=key_hash,
        )
    except SupabaseAPIKeyValidationError as ve:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(ve),
        )
    except SupabaseAPIKeyServiceUnavailableError as sue:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(sue),
        )
    except SupabaseAPIKeyError:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Upstream API key database rejected the request.",
        )

    return APIKeyCreateResponse(
        id=str(new_key.id),
        name=new_key.name,
        key_prefix=new_key.key_prefix,
        api_key=raw_key,  # Customer must copy this now!
        environment=new_key.environment,
        created_at=new_key.created_at.isoformat() if new_key.created_at else "",
    )


@router.get(
    "/api-keys",
    response_model=APIKeyListResponse,
    summary="List Customer API Keys",
    description="Returns all API keys owned by the authenticated Cognito user without exposing secret hashes."
)
def list_api_keys(
    user_id: str = Depends(require_cognito_user),
    repo: SupabaseAPIKeyRepository = Depends(get_api_key_repository),
):
    """
    List API keys for authenticated Cognito user from Supabase.
    Enforces user isolation: customers only receive their own keys.
    """
    try:
        keys = repo.list_user_api_keys(user_id=user_id)
    except SupabaseAPIKeyValidationError as ve:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(ve),
        )
    except SupabaseAPIKeyServiceUnavailableError as sue:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(sue),
        )
    except SupabaseAPIKeyError:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Upstream API key database rejected the request.",
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
                is_active=k.is_active,
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
    description="Revokes an API key owned by the authenticated user. Sets status='revoked' and revoked_at."
)
def revoke_api_key(
    key_id: str,
    user_id: str = Depends(require_cognito_user),
    repo: SupabaseAPIKeyRepository = Depends(get_api_key_repository),
):
    """
    Revoke a customer API key in Supabase.
    Enforces tenant ownership: a customer cannot revoke another customer's key.
    """
    try:
        key_uuid = uuid.UUID(key_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid key ID format. Expected UUID."
        )

    try:
        key, already_revoked = repo.revoke_api_key(key_id=str(key_uuid), user_id=user_id)
    except APIKeyNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="API key not found."
        )
    except APIKeyForbiddenError:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: You cannot revoke an API key belonging to another user."
        )
    except SupabaseAPIKeyServiceUnavailableError as sue:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(sue),
        )
    except SupabaseAPIKeyError:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Upstream API key database rejected the request.",
        )

    if already_revoked:
        return APIKeyRevokeResponse(
            success=True,
            message="API key is already revoked.",
            id=str(key.id)
        )

    return APIKeyRevokeResponse(
        success=True,
        message="API key revoked successfully.",
        id=str(key.id)
    )


@router.post(
    "/ssh-keys",
    response_model=SSHKeyResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Register Customer SSH Public Key",
    description="Registers and cryptographically validates an OpenSSH public key for compute pairing. Never accepts private keys."
)
async def register_ssh_key(
    req: SSHKeyCreateRequest,
    user_id: str = Depends(require_cognito_user),
    db: Session = Depends(get_db)
):
    """
    Register a new OpenSSH public key for the authenticated customer.
    Validates algorithm, RSA >= 2048-bit, computes OpenSSH SHA-256 fingerprint,
    and strictly rejects private keys.
    """
    try:
        new_key = create_ssh_key(
            db=db,
            user_id=user_id,
            name=req.name or "Default SSH Key",
            raw_public_key=req.public_key,
        )
    except SSHKeyValidationError as ve:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(ve)
        )
    except DuplicateSSHKeyError as de:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(de)
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to register SSH key in database."
        )

    return SSHKeyResponse(
        id=str(new_key.id),
        name=new_key.name,
        public_key=new_key.public_key,
        fingerprint=new_key.fingerprint,
        key_type=new_key.key_type,
        created_at=new_key.created_at.isoformat() if new_key.created_at else "",
    )


@router.get(
    "/ssh-keys",
    response_model=SSHKeyListResponse,
    summary="List Customer SSH Public Keys",
    description="Returns all OpenSSH public keys registered by the authenticated customer. Enforces tenant isolation."
)
async def get_customer_ssh_keys(
    user_id: str = Depends(require_cognito_user),
    db: Session = Depends(get_db)
):
    """
    List all SSH keys belonging exclusively to the authenticated customer.
    """
    try:
        keys = list_user_ssh_keys(db=db, user_id=user_id)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve SSH keys from database."
        )

    return SSHKeyListResponse(
        success=True,
        keys=[
            SSHKeyItem(
                id=str(k.id),
                name=k.name,
                public_key=k.public_key,
                fingerprint=k.fingerprint,
                key_type=k.key_type,
                created_at=k.created_at.isoformat() if k.created_at else "",
            )
            for k in keys
        ]
    )


@router.delete(
    "/ssh-keys/{key_id}",
    response_model=SSHKeyDeleteResponse,
    summary="Delete Customer SSH Key",
    description="Deletes a registered SSH key owned by the authenticated customer. Returns 404 if not found or unauthorized."
)
async def remove_ssh_key(
    key_id: str,
    user_id: str = Depends(require_cognito_user),
    db: Session = Depends(get_db)
):
    """
    Delete a customer SSH key.
    Enforces tenant isolation: returns HTTP 404 if the key does not exist
    or belongs to another customer to prevent customer enumeration.
    """
    try:
        key_uuid = uuid.UUID(key_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid key ID format. Expected UUID."
        )

    try:
        deleted = delete_ssh_key(db=db, user_id=user_id, key_id=key_uuid)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to delete SSH key from database."
        )

    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="SSH key not found."
        )

    return SSHKeyDeleteResponse(
        success=True,
        message="SSH key deleted successfully.",
        id=str(key_uuid)
    )

# --- Notebook Management Endpoints ---

@router.post(
    "/notebooks",
    response_model=NotebookResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create & Provision Notebook Instance",
    description="Provisions a new notebook session for the authenticated customer. Derives user_id exclusively from Cognito token.",
)
async def create_notebook_instance(
    req: NotebookCreateRequest,
    user_id: str = Depends(require_cognito_user),
    db: Session = Depends(get_db),
):
    """
    Create a new notebook session.
    Returns the one-time raw Jupyter session token in access_token.
    """
    ssh_key_uuid = None
    if req.selected_ssh_key_id:
        try:
            ssh_key_uuid = uuid.UUID(req.selected_ssh_key_id)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid selected_ssh_key_id format. Expected UUID.",
            )

    try:
        notebook, raw_token = create_notebook(
            db=db,
            user_id=user_id,
            name=req.name or "Untitled Notebook",
            gpu_profile=req.gpu_profile or "NVIDIA L4",
            selected_ssh_key_id=ssh_key_uuid,
        )
    except NotebookValidationError as ve:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(ve),
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create notebook instance.",
        )

    return serialize_notebook(notebook, raw_token=raw_token)


@router.get(
    "/notebooks",
    response_model=NotebookListResponse,
    summary="List Customer Notebooks",
    description="Returns all active or stopped notebook sessions belonging to the authenticated customer.",
)
async def list_notebooks(
    user_id: str = Depends(require_cognito_user),
    db: Session = Depends(get_db),
):
    """
    List customer notebooks with tenant isolation.
    """
    try:
        notebooks = list_user_notebooks(db=db, user_id=user_id)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve notebooks from database.",
        )

    return NotebookListResponse(
        success=True,
        notebooks=[serialize_notebook(nb) for nb in notebooks],
    )


@router.get(
    "/notebooks/{id}",
    response_model=NotebookResponse,
    summary="Get Notebook Details",
    description="Retrieves notebook instance details. Returns 404 if not found or unauthorized.",
)
async def get_notebook_instance(
    id: str,
    user_id: str = Depends(require_cognito_user),
    db: Session = Depends(get_db),
):
    """
    Get single notebook instance by ID.
    Enforces tenant ownership.
    """
    try:
        nb_uuid = uuid.UUID(id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid notebook ID format. Expected UUID.",
        )

    try:
        notebook = get_notebook(db=db, user_id=user_id, notebook_id=nb_uuid)
    except NotebookNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Notebook not found.",
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve notebook.",
        )

    return serialize_notebook(notebook)


@router.post(
    "/notebooks/{id}/start",
    response_model=NotebookActionResponse,
    summary="Start Notebook Session",
    description="Starts a paused or provisioning notebook session.",
)
async def start_notebook_instance(
    id: str,
    user_id: str = Depends(require_cognito_user),
    db: Session = Depends(get_db),
):
    """
    Start notebook session.
    """
    try:
        nb_uuid = uuid.UUID(id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid notebook ID format. Expected UUID.",
        )

    try:
        notebook = start_notebook(db=db, user_id=user_id, notebook_id=nb_uuid)
    except NotebookNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Notebook not found.",
        )
    except InvalidStateTransitionError as se:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(se),
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to start notebook.",
        )

    return NotebookActionResponse(
        success=True,
        message="Notebook started successfully.",
        notebook=serialize_notebook(notebook),
    )


@router.post(
    "/notebooks/{id}/stop",
    response_model=NotebookActionResponse,
    summary="Stop Notebook Session",
    description="Stops a running notebook session.",
)
async def stop_notebook_instance(
    id: str,
    user_id: str = Depends(require_cognito_user),
    db: Session = Depends(get_db),
):
    """
    Stop notebook session.
    """
    try:
        nb_uuid = uuid.UUID(id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid notebook ID format. Expected UUID.",
        )

    try:
        notebook = stop_notebook(db=db, user_id=user_id, notebook_id=nb_uuid)
    except NotebookNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Notebook not found.",
        )
    except InvalidStateTransitionError as se:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(se),
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to stop notebook.",
        )

    return NotebookActionResponse(
        success=True,
        message="Notebook stopped successfully.",
        notebook=serialize_notebook(notebook),
    )


@router.delete(
    "/notebooks/{id}",
    response_model=NotebookActionResponse,
    summary="Terminate Notebook Instance",
    description="Permanently terminates a notebook session.",
)
async def delete_notebook_instance(
    id: str,
    user_id: str = Depends(require_cognito_user),
    db: Session = Depends(get_db),
):
    """
    Terminate notebook session.
    """
    try:
        nb_uuid = uuid.UUID(id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid notebook ID format. Expected UUID.",
        )

    try:
        notebook = terminate_notebook(db=db, user_id=user_id, notebook_id=nb_uuid)
    except NotebookNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Notebook not found.",
        )
    except InvalidStateTransitionError as se:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(se),
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to terminate notebook.",
        )

    return NotebookActionResponse(
        success=True,
        message="Notebook terminated successfully.",
        notebook=serialize_notebook(notebook),
    )

