"""
FastAPI route definitions for the Inferxe Inference API.
Endpoints:
  - POST /api/v1/inference: Authenticated model execution
  - GET  /api/v1/health: Service and database status
  - POST /api/v1/api-keys: Issue customer API keys
"""

import logging
import os
import threading
import uuid
import asyncio
import httpx2
from typing import Optional, Tuple
from fastapi import APIRouter, Depends, HTTPException, Request, status
from starlette.concurrency import run_in_threadpool

from inference.database import check_database_connection, engine
from inference.supabase_config import SupabaseConfigurationError, get_supabase_settings
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
from inference.supabase_ssh_keys import (
    SupabaseSSHKeyError,
    SupabaseSSHKeyRepository,
    SupabaseSSHKeyServiceUnavailableError,
    SupabaseSSHKeyValidationError,
    get_ssh_key_repository,
)
from inference.supabase_notebooks import (
    SupabaseNotebookError,
    SupabaseNotebookRepository,
    SupabaseNotebookServiceUnavailableError,
    SupabaseNotebookValidationError,
    get_notebook_repository,
)
from inference.supabase_telemetry import (
    SupabaseTelemetryError,
    SupabaseTelemetryRepository,
    SupabaseTelemetryServiceUnavailableError,
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
    RoutingRecommendRequest,
    RoutingRecommendResponse,
    NotebookLogsResponse,
    NotebookTelemetryResponse,
    RecommendRequest,
    PricingEstimateRequest,
)
from inference.catalog import load_catalog
from inference.routing import recommend, estimate_price, summarize_usage
from inference.ssh_key_service import (
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
    get_notebook_logs,
    get_notebook_telemetry,
    serialize_notebook,
    NotebookNotFoundError,
    NotebookValidationError,
    InvalidStateTransitionError,
)
from inference.routing_engine import (
    evaluate_placement,
    REFERENCE_MODELS,
    REFERENCE_HARDWARE,
)
from inference.auth import (
    test_mode_enabled,
    verify_customer_api_key,
    generate_api_key,
    require_cognito_user,
    is_cognito_configured,
    is_test_mode_enabled,
)
from inference.service import InferenceService, demo_inference_enabled, nvidia_key_configured

router = APIRouter(prefix="/api/v1", tags=["Inference & Management"])
logger = logging.getLogger("inferxe.routes")

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
    http_request: Request,
    request: InferenceRequest,
    api_key: SupabaseAPIKeyRecord = Depends(verify_customer_api_key),
    telemetry_repo: SupabaseTelemetryRepository = Depends(get_telemetry_repository),
):
    """
    Execute prompt inference using NVIDIA Nemotron.
    Requires Bearer token authentication with a valid Inferxe customer API key.

    Concurrency is limited by INFERENCE_MAX_CONCURRENCY (default 8).
    Requests waiting beyond INFERENCE_QUEUE_SECONDS (default 2) receive HTTP 503.
    Authentication (the dependencies above) runs before a slot is requested, so rejected keys never
    occupy one; waiting happens on the event loop and holds no worker thread.
    """
    semaphore = getattr(http_request.app.state, "inference_slots", None)
    if semaphore is None:
        # Fail closed: running unlimited would silently remove the thread-pool protection.
        raise RuntimeError("Inference limiter is not initialised: the application lifespan did not run.")

    queue_seconds = http_request.app.state.inference_queue_seconds
    if not semaphore.locked():
        # A slot is free: acquire() returns without suspending. Not via wait_for, which with
        # timeout=0 cancels the acquire before it runs and would reject every request.
        await semaphore.acquire()
    else:
        try:
            await asyncio.wait_for(semaphore.acquire(), timeout=queue_seconds)
        except TimeoutError:
            # Rejected before execute_inference: no provider call, no telemetry row, nothing billed.
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Inference service at capacity. Please retry shortly.",
                headers={"Retry-After": str(max(1, queue_seconds))},
            )

    try:
        # Execute the synchronous inference service in a threadpool
        # so the event loop is not blocked during provider calls.
        return await run_in_threadpool(
            inference_service.execute_inference,
            request=request,
            api_key=api_key,
            telemetry_repo=telemetry_repo,
        )
    finally:
        semaphore.release()


# Shared HTTP client for health checks to avoid creating a new TCP/TLS
# connection on every probe. Created lazily on first use and closed in
# the FastAPI lifespan shutdown.
_health_http_client: Optional[httpx2.Client] = None
_health_client_lock = threading.Lock()


def _get_health_http_client() -> httpx2.Client:
    """Return a shared, keep-alive HTTP client for health-check probes.

    Uses double-checked locking to ensure only one client is created even
    under concurrent first-request access. Checks `is_closed()` before
    reuse so a previously closed client is recreated.
    """
    global _health_http_client
    with _health_client_lock:
        if _health_http_client is None or _health_http_client.is_closed:
            _health_http_client = httpx2.Client(timeout=3.0)
        return _health_http_client


def _close_health_http_client() -> None:
    """Close the shared health-check HTTP client (called from lifespan shutdown)."""
    global _health_http_client
    with _health_client_lock:
        client = _health_http_client
        _health_http_client = None
    if client is not None and not client.is_closed:
        try:
            client.close()
        except Exception:
            pass


@router.get(
    "/health",
    response_model=HealthResponse,
    summary="Health & Dependency Check",
    description="Returns connectivity status of the service, Supabase REST, optional PostgreSQL database, and NVIDIA provider."
)
def health_check():
    """Health status check covering Supabase REST, optional legacy PostgreSQL, NVIDIA, and Cognito."""
    db_ok = check_database_connection(engine)
    nvidia_configured = nvidia_key_configured()
    demo_mode = demo_inference_enabled()
    cognito_ok = is_cognito_configured()

    supabase_ok = False
    supabase_status = "unconfigured"
    try:
        sb_settings = get_supabase_settings(auto_load=False)
        if test_mode_enabled():  # combined safeguard (see inference.auth.test_mode_enabled)
            supabase_ok = True
            supabase_status = "configured"
        else:
            probe = _get_health_http_client().get(
                sb_settings.rest_url("api_keys"),
                params={"select": "id", "limit": "1"},
                headers=sb_settings.auth_headers(),
            )
            status_code = probe.status_code
            if 200 <= status_code < 300:
                supabase_ok = True
                supabase_status = "connected"
            elif status_code in (401, 403):
                supabase_ok = False
                supabase_status = "auth_error"
            else:
                supabase_ok = False
                supabase_status = "upstream_error"
    except SupabaseConfigurationError:
        supabase_ok = False
        supabase_status = "unconfigured"
    except Exception:
        supabase_ok = False
        supabase_status = "unreachable"

    db_status = "connected" if db_ok else ("supabase_rest" if supabase_ok else "unreachable")
    nvidia_status = "configured" if nvidia_configured else ("demo" if demo_mode else "missing_api_key")
    storage_ok = supabase_ok or db_ok
    overall_status = "ok" if (storage_ok and (nvidia_configured or demo_mode)) else "degraded"

    return HealthResponse(
        status=overall_status,
        service="inferxe-inference-api",
        database=db_status,
        nvidia_provider=nvidia_status,
        supabase_rest=supabase_status,
        cognito_configured=cognito_ok,
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
def register_ssh_key(
    req: SSHKeyCreateRequest,
    user_id: str = Depends(require_cognito_user),
    repo: SupabaseSSHKeyRepository = Depends(get_ssh_key_repository),
):
    """
    Register a new OpenSSH public key for the authenticated customer in Supabase.
    Validates algorithm, RSA >= 2048-bit, computes OpenSSH SHA-256 fingerprint,
    and strictly rejects private keys.
    """
    try:
        new_key = repo.create_ssh_key(
            user_id=user_id,
            name=req.name or "Default SSH Key",
            raw_public_key=req.public_key,
        )
    except (SSHKeyValidationError, SupabaseSSHKeyValidationError) as ve:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(ve),
        )
    except DuplicateSSHKeyError as de:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(de),
        )
    except SupabaseSSHKeyServiceUnavailableError as sue:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(sue),
        )
    except SupabaseSSHKeyError:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Upstream SSH key database rejected the request.",
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Unexpected error registering SSH key (%s).", type(e).__name__)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to register SSH key in database.",
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
def get_customer_ssh_keys(
    user_id: str = Depends(require_cognito_user),
    repo: SupabaseSSHKeyRepository = Depends(get_ssh_key_repository),
):
    """
    List all SSH keys belonging exclusively to the authenticated customer in Supabase.
    """
    try:
        keys = repo.list_user_ssh_keys(user_id=user_id)
    except (SSHKeyValidationError, SupabaseSSHKeyValidationError) as ve:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(ve),
        )
    except SupabaseSSHKeyServiceUnavailableError as sue:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(sue),
        )
    except SupabaseSSHKeyError:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Upstream SSH key database rejected the request.",
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Unexpected error listing SSH keys (%s).", type(e).__name__)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve SSH keys from database.",
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
    description="Permanently deletes a registered SSH key owned by the authenticated customer. Returns 404 if not found or unauthorized."
)
def remove_ssh_key(
    key_id: str,
    user_id: str = Depends(require_cognito_user),
    repo: SupabaseSSHKeyRepository = Depends(get_ssh_key_repository),
):
    """
    Permanently delete a customer SSH key from Supabase.
    Enforces tenant isolation: returns HTTP 404 if the key does not exist
    or belongs to another customer to prevent customer enumeration.
    """
    try:
        key_uuid = uuid.UUID(key_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid key ID format. Expected UUID.",
        )

    try:
        deleted = repo.delete_ssh_key(user_id=user_id, key_id=key_uuid)
    except (SSHKeyValidationError, SupabaseSSHKeyValidationError) as ve:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(ve),
        )
    except SupabaseSSHKeyServiceUnavailableError as sue:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(sue),
        )
    except SupabaseSSHKeyError:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Upstream SSH key database rejected the request.",
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Unexpected error deleting SSH key (%s).", type(e).__name__)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to delete SSH key from database.",
        )

    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="SSH key not found.",
        )

    return SSHKeyDeleteResponse(
        success=True,
        message="SSH key deleted successfully.",
        id=str(key_uuid),
    )

# --- Notebook Management Endpoints ---

@router.post(
    "/notebooks",
    response_model=NotebookResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create & Provision Notebook Instance",
    description="Provisions a new notebook session in Supabase for the authenticated customer. Derives user_id exclusively from Cognito token.",
)
def create_notebook_instance(
    req: NotebookCreateRequest,
    user_id: str = Depends(require_cognito_user),
    repo: SupabaseNotebookRepository = Depends(get_notebook_repository),
):
    """
    Create a new notebook session in Supabase.
    Validates selected SSH key ownership via Supabase SSH Keys repository
    and returns the one-time raw Jupyter session token in access_token.
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
            repo=repo,
            user_id=user_id,
            name=req.name or "Untitled Notebook",
            gpu_profile=req.gpu_profile or "NVIDIA L4",
            selected_ssh_key_id=ssh_key_uuid,
        )
    except (NotebookValidationError, SupabaseNotebookValidationError) as ve:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(ve),
        )
    except SupabaseNotebookServiceUnavailableError as sue:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(sue),
        )
    except SupabaseNotebookError:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Upstream notebook database rejected the request.",
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Unexpected error creating notebook instance (%s).", type(e).__name__)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create notebook instance.",
        )

    return serialize_notebook(notebook, raw_token=raw_token)


@router.get(
    "/notebooks",
    response_model=NotebookListResponse,
    summary="List Customer Notebooks",
    description="Returns all non-terminated notebook sessions in Supabase belonging to the authenticated customer.",
)
def list_notebooks(
    user_id: str = Depends(require_cognito_user),
    repo: SupabaseNotebookRepository = Depends(get_notebook_repository),
):
    """
    List customer notebooks from Supabase with tenant isolation.
    """
    try:
        notebooks = list_user_notebooks(repo=repo, user_id=user_id)
    except (NotebookValidationError, SupabaseNotebookValidationError) as ve:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(ve),
        )
    except SupabaseNotebookServiceUnavailableError as sue:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(sue),
        )
    except SupabaseNotebookError:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Upstream notebook database rejected the request.",
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Unexpected error listing notebooks (%s).", type(e).__name__)
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
    description="Retrieves notebook instance details from Supabase. Returns 404 if not found or unauthorized.",
)
def get_notebook_instance(
    id: str,
    user_id: str = Depends(require_cognito_user),
    repo: SupabaseNotebookRepository = Depends(get_notebook_repository),
):
    """
    Get single notebook instance by ID from Supabase.
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
        notebook = get_notebook(repo=repo, user_id=user_id, notebook_id=nb_uuid)
    except NotebookNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Notebook not found.",
        )
    except (NotebookValidationError, SupabaseNotebookValidationError) as ve:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(ve),
        )
    except SupabaseNotebookServiceUnavailableError as sue:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(sue),
        )
    except SupabaseNotebookError:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Upstream notebook database rejected the request.",
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Unexpected error retrieving notebook (%s).", type(e).__name__)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve notebook.",
        )

    return serialize_notebook(notebook)


@router.post(
    "/notebooks/{id}/start",
    response_model=NotebookActionResponse,
    summary="Start Notebook Session",
    description="Starts a paused, starting, provisioning, or failed notebook session in Supabase.",
)
def start_notebook_instance(
    id: str,
    user_id: str = Depends(require_cognito_user),
    repo: SupabaseNotebookRepository = Depends(get_notebook_repository),
):
    """
    Start notebook session in Supabase.
    """
    try:
        nb_uuid = uuid.UUID(id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid notebook ID format. Expected UUID.",
        )

    try:
        notebook = start_notebook(repo=repo, user_id=user_id, notebook_id=nb_uuid)
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
    except (NotebookValidationError, SupabaseNotebookValidationError) as ve:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(ve),
        )
    except SupabaseNotebookServiceUnavailableError as sue:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(sue),
        )
    except SupabaseNotebookError:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Upstream notebook database rejected the request.",
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Unexpected error starting notebook (%s).", type(e).__name__)
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
    description="Stops a running, starting, or provisioning notebook session in Supabase.",
)
def stop_notebook_instance(
    id: str,
    user_id: str = Depends(require_cognito_user),
    repo: SupabaseNotebookRepository = Depends(get_notebook_repository),
):
    """
    Stop notebook session in Supabase.
    """
    try:
        nb_uuid = uuid.UUID(id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid notebook ID format. Expected UUID.",
        )

    try:
        notebook = stop_notebook(repo=repo, user_id=user_id, notebook_id=nb_uuid)
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
    except (NotebookValidationError, SupabaseNotebookValidationError) as ve:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(ve),
        )
    except SupabaseNotebookServiceUnavailableError as sue:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(sue),
        )
    except SupabaseNotebookError:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Upstream notebook database rejected the request.",
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Unexpected error stopping notebook (%s).", type(e).__name__)
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
    description="Permanently terminates a notebook session in Supabase.",
)
def delete_notebook_instance(
    id: str,
    user_id: str = Depends(require_cognito_user),
    repo: SupabaseNotebookRepository = Depends(get_notebook_repository),
):
    """
    Terminate notebook session in Supabase.
    """
    try:
        nb_uuid = uuid.UUID(id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid notebook ID format. Expected UUID.",
        )

    try:
        notebook = terminate_notebook(repo=repo, user_id=user_id, notebook_id=nb_uuid)
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
    except (NotebookValidationError, SupabaseNotebookValidationError) as ve:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(ve),
        )
    except SupabaseNotebookServiceUnavailableError as sue:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(sue),
        )
    except SupabaseNotebookError:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Upstream notebook database rejected the request.",
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Unexpected error terminating notebook (%s).", type(e).__name__)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to terminate notebook.",
        )

    return NotebookActionResponse(
        success=True,
        message="Notebook terminated successfully.",
        notebook=serialize_notebook(notebook),
    )


@router.post(
    "/routing/recommend",
    response_model=RoutingRecommendResponse,
    summary="Recommend GPU Placement",
    description="Automated DPR Placement & Routing decision engine evaluating VRAM footprint, KV cache, and provider hardware catalogue.",
)
def recommend_gpu_placement(request: RoutingRecommendRequest):
    result = evaluate_placement(
        model_id=request.model_id,
        quantization=request.quantization,
        context_tokens=request.context_tokens,
        concurrency=request.concurrency,
        priority=request.priority,
        budget_inr_hr=request.budget_inr_hr,
        min_tokens_per_sec=request.min_tokens_per_sec,
    )
    return RoutingRecommendResponse(
        success=True,
        workload=result["workload"],
        memory_breakdown=result["memory_breakdown"],
        recommended_placement=result["recommended_placement"],
        candidates=result["candidates"],
        note=result["note"],
    )


@router.get(
    "/routing/catalogue",
    summary="List GPU Routing Catalogue",
    description="Lists all reference hardware offerings with memory bandwidth, VRAM, and planning rates.",
)
def get_routing_catalogue():
    return {
        "success": True,
        "models": [
            {
                "id": m.id,
                "family": m.family,
                "name": m.name,
                "params_billion": m.params_billion,
                "architecture": m.architecture,
            }
            for m in REFERENCE_MODELS.values()
        ],
        "hardware": [
            {
                "gpu_id": h.gpu_id,
                "name": h.name,
                "vram_gb": h.vram_gb,
                "memory_bandwidth_gbps": h.memory_bandwidth_gbps,
                "hourly_rate_inr": h.hourly_rate_inr,
                "hourly_rate_usd": h.hourly_rate_usd,
                "architecture": h.architecture,
                "is_available": True,
            }
            for h in REFERENCE_HARDWARE.values()
        ],
    }


@router.get(
    "/notebooks/{id}/logs",
    response_model=NotebookLogsResponse,
    summary="Get Notebook Runtime Logs",
    description="Returns container initialization, CUDA boot, and runtime logs for a notebook instance.",
)
def get_notebook_runtime_logs(
    id: str,
    user_id: str = Depends(require_cognito_user),
    repo: SupabaseNotebookRepository = Depends(get_notebook_repository),
):
    try:
        nb_uuid = uuid.UUID(id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid notebook ID format. Expected UUID.",
        )
    try:
        res = get_notebook_logs(repo=repo, notebook_id=nb_uuid, user_id=user_id)
        return NotebookLogsResponse(
            success=True,
            notebook_id=res["notebook_id"],
            name=res["name"],
            status=res["status"],
            logs=res["logs"],
            is_simulated=True,
        )
    except NotebookNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Notebook not found.",
        )
    except Exception as e:
        logger.error("Error retrieving notebook logs: %s", str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to load notebook logs.",
        )


@router.get(
    "/notebooks/{id}/telemetry",
    response_model=NotebookTelemetryResponse,
    summary="Get Notebook Runtime Telemetry",
    description="Returns live hardware metrics (power, temp, VRAM, fan speed) for an active instance.",
)
def get_notebook_instance_telemetry(
    id: str,
    user_id: str = Depends(require_cognito_user),
    repo: SupabaseNotebookRepository = Depends(get_notebook_repository),
):
    try:
        nb_uuid = uuid.UUID(id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid notebook ID format. Expected UUID.",
        )
    try:
        res = get_notebook_telemetry(repo=repo, notebook_id=nb_uuid, user_id=user_id)
        return NotebookTelemetryResponse(
            success=True,
            notebook_id=res["notebook_id"],
            name=res["name"],
            status=res["status"],
            telemetry=res["telemetry"],
            is_simulated=True,
        )
    except NotebookNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Notebook not found.",
        )
    except Exception as e:
        logger.error("Error retrieving notebook telemetry: %s", str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to load notebook telemetry.",
        )


@router.get(
    "/telemetry/hardware",
    summary="Get Live Sovereign GPU Telemetry",
    description="Returns real-time cluster telemetry across Indian sovereign nodes with realistic dynamic variance.",
)
def get_live_hardware_telemetry():
    import time, math
    from datetime import datetime, timezone
    t = time.time()
    phase = (t % 3600) / 15.0

    return {
        "success": True,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "is_simulated": True,
        "clusters": [
            {
                "id": "cl-jarvis-in-01",
                "name": "JarvisLabs Bangalore (IN-South)",
                "provider": "JarvisLabs",
                "region": "India (Bangalore)",
                "status": "healthy",
                "uptime": "99.98%",
                "total_nodes": 16,
                "active_nodes": 16,
                "gpus": [
                    {
                        "type": "NVIDIA H100 80GB SXM5",
                        "total": 32,
                        "allocated": 28,
                        "avg_temp_c": round(56.0 + 4.0 * math.sin(phase), 1),
                        "power_w": round(480.0 + 20.0 * math.cos(phase), 1),
                        "vram_used_gb": round(2120.0 + 45.0 * math.sin(phase * 0.5), 1),
                        "vram_total_gb": 2560.0,
                    },
                    {
                        "type": "NVIDIA A100 80GB PCIe",
                        "total": 64,
                        "allocated": 58,
                        "avg_temp_c": round(62.0 + 3.0 * math.sin(phase + 1), 1),
                        "power_w": round(340.0 + 15.0 * math.cos(phase), 1),
                        "vram_used_gb": round(4480.0 + 60.0 * math.cos(phase * 0.4), 1),
                        "vram_total_gb": 5120.0,
                    },
                ],
            },
            {
                "id": "cl-e2e-in-02",
                "name": "E2E Cloud Mumbai (IN-West)",
                "provider": "E2E Cloud",
                "region": "India (Mumbai)",
                "status": "healthy",
                "uptime": "99.95%",
                "total_nodes": 24,
                "active_nodes": 23,
                "gpus": [
                    {
                        "type": "NVIDIA L40S 48GB",
                        "total": 48,
                        "allocated": 41,
                        "avg_temp_c": round(58.0 + 4.0 * math.sin(phase * 1.2), 1),
                        "power_w": round(310.0 + 18.0 * math.sin(phase), 1),
                        "vram_used_gb": round(1880.0 + 35.0 * math.sin(phase), 1),
                        "vram_total_gb": 2304.0,
                    },
                    {
                        "type": "NVIDIA L4 24GB",
                        "total": 32,
                        "allocated": 26,
                        "avg_temp_c": round(51.0 + 2.5 * math.cos(phase), 1),
                        "power_w": round(72.0 + 4.0 * math.cos(phase * 0.8), 1),
                        "vram_used_gb": round(610.0 + 20.0 * math.cos(phase), 1),
                        "vram_total_gb": 768.0,
                    },
                ],
            },
        ],
    }

# --- Catalogue, Routing, Pricing & Usage (DPR §11, §9, §24.3, §13) ---
# Catalogue and pricing are public reference data (also shown on the website); routing and usage are
# tenant-scoped and use the developer API key, like /inference.

@router.get(
    "/gpus",
    summary="Unified GPU Catalogue",
    description="Normalized GPU models with their provider offers and measured benchmarks. All filters are optional.",
)
def list_gpus(
    min_vram_gb: Optional[float] = None,
    provider: Optional[str] = None,
    region: Optional[str] = None,
    sovereign_only: bool = False,
):
    catalog = load_catalog()
    offers = [
        o for o in catalog["offers"]
        if (provider is None or o["provider_id"] == provider)
        and (region is None or region.lower() in o["region"].lower())
        and (not sovereign_only or o["sovereign_india_hosted"])
    ]
    gpus = []
    for gpu in catalog["gpus"].values():
        if min_vram_gb is not None and (gpu["vram_gb"] or 0) < min_vram_gb:
            continue
        gpu_offers = [o for o in offers if o["gpu_id"] == gpu["id"]]
        # With an offer filter set, a GPU nobody offers under that filter is not a match.
        if (provider or region or sovereign_only) and not gpu_offers:
            continue
        gpus.append({**gpu, "offers": gpu_offers})
    return {"success": True, "count": len(gpus), "gpus": gpus}


@router.get(
    "/providers",
    summary="GPU Providers",
    description="Providers in the catalogue with regions, offered GPUs and integration status.",
)
def list_providers():
    providers = list(load_catalog()["providers"].values())
    return {"success": True, "count": len(providers), "providers": providers}


@router.post(
    "/recommend",
    summary="Recommend GPU Placement",
    description="Filters provider/GPU offers by memory, policy, budget and speed, then ranks them by routing mode. "
                "The decision is recorded for the authenticated tenant.",
)
def recommend_placement(
    req: RecommendRequest,
    api_key: SupabaseAPIKeyRecord = Depends(verify_customer_api_key),
    telemetry_repo: SupabaseTelemetryRepository = Depends(get_telemetry_repository),
):
    result = recommend(req.model_dump())
    decision_id = None
    try:
        decision_id = telemetry_repo.record_routing_decision(
            user_id=api_key.user_id,
            organization_id=api_key.organization_id,
            api_key_id=api_key.id,
            workload=req.model_dump(),
            mode=result["mode"],
            selected_offer_id=result["selected"]["offer_id"] if result["selected"] else None,
            candidates=result["candidates"][:5],
        )
    except Exception as e:
        # Like inference telemetry: a recording failure must not fail the customer's request.
        logger.error("Failed to record routing decision (%s).", type(e).__name__)
    return {"success": True, "decision_id": decision_id, **result}


@router.post(
    "/pricing/estimate",
    summary="Estimate Infrastructure Cost",
    description="Estimated runtime cost for a catalogue offer from the reference rate card.",
)
def pricing_estimate(req: PricingEstimateRequest):
    estimate = estimate_price(req.offer_id, req.gpu_count, req.hours, req.storage_gb, req.spot)
    if estimate is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown offer_id. See GET /api/v1/gpus.")
    return {"success": True, **estimate}


@router.get(
    "/usage",
    summary="Inference Usage Summary",
    description="Requests, tokens, cost and latency for the authenticated customer's most recent inference requests.",
)
def usage_summary(
    limit: int = 1000,
    api_key: SupabaseAPIKeyRecord = Depends(verify_customer_api_key),
    telemetry_repo: SupabaseTelemetryRepository = Depends(get_telemetry_repository),
):
    if limit < 1 or limit > 1000:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="limit must be between 1 and 1000.")
    try:
        records = telemetry_repo.list_user_inference_requests(api_key.user_id, limit=limit)
    except SupabaseTelemetryServiceUnavailableError:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Usage database is unavailable.")
    except SupabaseTelemetryError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Upstream usage database rejected the request.")
    return {"success": True, **summarize_usage(records)}

