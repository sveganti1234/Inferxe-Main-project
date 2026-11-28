"""
FastAPI Application Entry Point for Inferxe Notification Service.
Runs standalone on port 8002 or can be imported into existing services.
"""

import asyncio
import sys
import threading
import os
import logging
from pathlib import Path
import traceback
from typing import Optional, List, Dict, Any
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from typing import Optional

ROOT_DIR = Path(__file__).resolve().parents[2]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from .db import init_db, close_pool, DBConnection, DBNotConfiguredError, PoolTimeoutError, PG_DB, PG_HOST, _env_number, HEALTH_CHECK_POOL_WAIT_SECONDS
from .router import router
from .auth import COGNITO_USER_POOL_ID, COGNITO_CLIENT_ID, _COGNITO_PLACEHOLDERS

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("inferxe.notifications")

RAG_MOUNTED = False
_RAG_MOUNT_ERROR = ""

# Chat requests can hold a threadpool thread for up to ~60s (Ollama + fallbacks). Cap how many run at
# once so wallet/notification requests, which share the same threadpool, always find free threads.
RAG_CHAT_MAX_CONCURRENCY = _env_number("RAG_CHAT_MAX_CONCURRENCY", 8, int, 1, 64)
RAG_CHAT_QUEUE_SECONDS = _env_number("RAG_CHAT_QUEUE_SECONDS", 5.0, float, 0.0, 60)
_chat_slots = threading.BoundedSemaphore(RAG_CHAT_MAX_CONCURRENCY)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Safe database migration on startup
    try:
        init_db()
        logger.info("Database initialized successfully.")
    except Exception as e:
        # Log the actual exception message for local debugging; sanitize any secrets.
        safe_msg = _sanitize_startup_error(str(e))
        logger.error("Failed to initialize database during startup (%s): %s", type(e).__name__, safe_msg)
        logger.debug("Database startup traceback:\n%s", traceback.format_exc())
    _start_vector_store_warmup()
    yield
    close_pool()


def _start_vector_store_warmup():
    """Open the RAG vector store in the background so the first chat request does not pay the cold
    open. A background thread keeps startup fast and lets a missing/broken store fail without
    affecting startup; chat requests arriving meanwhile wait on the store's own lock."""
    if not RAG_MOUNTED:
        return None
    from backend.rag.server import warm_up_vector_store
    thread = threading.Thread(target=warm_up_vector_store, name="vector-store-warmup", daemon=True)
    thread.start()
    return thread


async def pool_timeout_handler(request: Request, exc: PoolTimeoutError) -> JSONResponse:
    """All pooled DB connections are busy: tell the client to retry instead of returning a 500."""
    return JSONResponse(
        status_code=503,
        content={"detail": "Database busy, please retry."},
        headers={"Retry-After": "1"},
    )


async def db_not_configured_handler(request: Request, exc: DBNotConfiguredError) -> JSONResponse:
    return JSONResponse(
        status_code=503,
        content={"detail": "Notifications database is not configured. Set SUPABASE_DATABASE_URL in backend/.env."},
    )


def _sanitize_startup_error(message: str) -> str:
    """Mask any PostgreSQL connection strings or credentials that may appear in an error message."""
    import re
    message = re.sub(r"postgresql://[^\s'\"\)]+", "postgresql://<redacted>", message)
    message = re.sub(r"password=[^\s'\"\)]+", "password=<redacted>", message)
    return message

app = FastAPI(
    title="Inferxe Multi-User Notification Service",
    description="Centralized, database-driven notification service with multi-tenant isolation, Cognito JWT authentication, and outbox reliability.",
    version="1.0.0",
    lifespan=lifespan,
)
app.add_exception_handler(PoolTimeoutError, pool_timeout_handler)
app.add_exception_handler(DBNotConfiguredError, db_not_configured_handler)

# CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount notification router
app.include_router(router)

# Mount RAG AI Chatbot and Supabase PostgreSQL Endpoints with Cognito Identity & Org Validation
try:
    from fastapi import Depends, HTTPException, status, Request
    from backend.notifications.auth import get_optional_user, AuthenticatedUser
    from backend.rag.server import (
        chat_endpoint,
        ChatRequest,
        get_chat_history_endpoint,
        get_chat_sessions_endpoint,
        upload_document_endpoint,
        delete_document_endpoint,
        list_documents_endpoint,
        supabase_status_endpoint,
        DocumentUploadRequest,
        DocumentUploadResponse
    )

    from backend.database.supabase_client import get_supabase_client

    def _call_rag(handler, *args, **kwargs):
        """Run a RAG handler from a sync route.

        The rag/server.py handlers are declared async but only do blocking I/O (Supabase,
        ChromaDB, Ollama). Awaiting them on the event loop froze every other request on this
        port, so the wrappers are sync routes (FastAPI runs them in its threadpool) and the
        coroutine runs here, in that worker thread, on its own short-lived loop.
        """
        return asyncio.run(handler(*args, **kwargs))

    def _trusted_organization(client, user_id: str, profile: Optional[dict] = None) -> Optional[str]:
        """The caller's organization from server-side data only: profiles.organization_id, then
        organization_members. Never the request body and never Cognito claims (custom:organization can be
        customer-writable). None when there is no client or no membership."""
        if profile is not None and profile.get("organization_id"):
            return profile["organization_id"]
        if not client or not user_id:
            return None
        if profile is None:
            try:
                p_res = client.table("profiles").select("organization_id").eq("user_id", user_id).limit(1).execute()
                if p_res.data and p_res.data[0].get("organization_id"):
                    return p_res.data[0]["organization_id"]
            except Exception as e:
                logger.warning("Could not read the caller's profile organization (%s).", type(e).__name__)
        try:
            m_res = client.table("organization_members").select("organization_id").eq("user_id", user_id).limit(1).execute()
            m_data = m_res.data if hasattr(m_res, "data") else []
            if m_data and m_data[0].get("organization_id"):
                return m_data[0]["organization_id"]
        except Exception as e:
            logger.warning("Could not read organization membership (%s).", type(e).__name__)
        return None

    @app.post("/api/chat", tags=["AI Chatbot"], summary="Inferxe Grounded RAG Chat Endpoint")
    def chat_handler(
        payload: ChatRequest,
        request: Request,
        auth_user: Optional[AuthenticatedUser] = Depends(get_optional_user)
    ):
        raw_auth = request.headers.get("authorization", "").strip()
        has_token = bool(raw_auth)
        auth_scheme = raw_auth.split()[0] if has_token else None
        token_len = len(raw_auth.split()[1]) if has_token and len(raw_auth.split()) > 1 else (len(raw_auth) if has_token else 0)
        logger.info(f"[DIAGNOSTIC] 1. Token received: {has_token} (scheme={auth_scheme}, length={token_len})")

        client = get_supabase_client()
        is_dashboard_route = bool(payload.current_path and payload.current_path.startswith("/dashboard"))
        is_auth_role = payload.user_role in ("customer", "admin")

        # Task 13: Ensure authenticated users' messages are never silently saved with NULL user_id.
        if (is_dashboard_route or is_auth_role) and not auth_user:
            logger.error(f"[DIAGNOSTIC] Authentication missing for dashboard conversation (path={payload.current_path}, role={payload.user_role}). Rejecting.")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Authentication required: Cannot save customer or admin conversations without a valid authenticated session."
            )

        retrieval_org = None  # guests (and users without a verified organization) retrieve public documents only
        if auth_user:
            logger.info("[DIAGNOSTIC] 2. Identity verified (admin=%s).", auth_user.is_admin)

            if not client:
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="Database service unavailable for user identity resolution."
                )

            # Task 8: Check profiles table and map Cognito sub to profiles.user_id
            profile_rows = []
            try:
                p_res = client.table("profiles").select("*").eq("user_id", auth_user.user_id).limit(1).execute()
                profile_rows = p_res.data if hasattr(p_res, "data") else []
            except Exception as e:
                logger.error("Failed to query the caller's profile (%s).", type(e).__name__)
            # No email fallback: the verified `sub` is the only identity. Matching a profile by the token's email
            # (never checked for email_verified) let one account write into another user's profile and org.

            # Auto-sync profile if not exists
            if not profile_rows:
                new_profile = {
                    "user_id": auth_user.user_id,
                    "email": auth_user.email,
                    "full_name": auth_user.claims.get("name") or auth_user.email.split("@")[0],
                    "username": auth_user.claims.get("cognito:username") or auth_user.email.split("@")[0],
                    "role": "admin" if auth_user.is_admin else "customer",
                    "status": "active",
                    "auth_provider": "cognito" if not auth_user.is_admin else "local_admin",
                }
                try:
                    ins_res = client.table("profiles").insert(new_profile).execute()
                    profile_rows = ins_res.data if hasattr(ins_res, "data") else [new_profile]
                    logger.info("[DIAGNOSTIC] Created a profile for a new verified user.")
                except Exception as ins_err:
                    logger.warning(f"[DIAGNOSTIC] Could not auto-insert profile: {ins_err}")

            if not profile_rows:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Authenticated user identity could not be resolved in user profiles."
                )

            profile = profile_rows[0]
            payload.user_id = profile["user_id"]
            logger.info("[DIAGNOSTIC] 3. Profile resolved (role=%s).", profile.get("role"))

            # Organization from server-side data only (profile, then membership); never from Cognito claims.
            resolved_org = _trusted_organization(client, profile["user_id"], profile)

            if payload.organization_id and payload.organization_id != resolved_org and not auth_user.is_admin:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Forbidden: Cannot specify an organization you do not belong to."
                )
            payload.organization_id = resolved_org
            retrieval_org = resolved_org
            logger.info("[DIAGNOSTIC] 4. Organization resolved: %s", "yes" if resolved_org else "none")

            if auth_user.is_admin:
                payload.user_role = "admin"
            else:
                payload.user_role = profile.get("role") or "customer"
        else:
            # Unauthenticated visitor:
            if payload.user_id or payload.organization_id:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Unauthorized: Supplying user_id or organization_id requires authenticated Cognito session."
                )
            payload.user_id = None
            payload.organization_id = None
            if payload.user_role not in ("guest", "anonymous"):
                payload.user_role = "guest"
            logger.info("[DIAGNOSTIC] Unauthenticated guest visitor session.")

        logger.info("[DIAGNOSTIC] 5. Chat request ready (role=%s).", payload.user_role)
        if not _chat_slots.acquire(timeout=RAG_CHAT_QUEUE_SECONDS):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="The assistant is busy right now. Please retry in a few seconds.",
                headers={"Retry-After": "5"},
            )
        try:
            return _call_rag(chat_endpoint, payload, retrieval_organization_id=retrieval_org)
        finally:
            _chat_slots.release()

    @app.get("/api/chat/history", tags=["Supabase and RAG"], summary="Get Chat History by Session or User ID")
    def chat_history_handler(
        session_id: str = None,
        user_id: str = None,
        organization_id: str = None,
        limit: int = 50,
        auth_user: Optional[AuthenticatedUser] = Depends(get_optional_user)
    ):
        # Enforce multi-tenant user and organization isolation
        effective_user_id = user_id
        effective_org_id = organization_id
        if auth_user:
            if not auth_user.is_admin:
                if user_id and user_id != auth_user.user_id:
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail="Forbidden: Cannot access another user's chat history."
                    )
                effective_user_id = auth_user.user_id
                user_org = _trusted_organization(get_supabase_client(), auth_user.user_id)
                if organization_id and organization_id != user_org:
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail="Forbidden: Cannot access conversations outside your organization."
                    )
                if not effective_org_id and user_org:
                    effective_org_id = user_org
        else:
            # Unauthenticated callers cannot query by user_id or organization_id
            if user_id or organization_id:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Unauthorized: Accessing user or organization chat history requires authentication."
                )
            if not session_id:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="session_id is required for unauthenticated chat history retrieval."
                )

        history_resp = _call_rag(get_chat_history_endpoint,
            session_id=session_id,
            user_id=effective_user_id,
            organization_id=effective_org_id,
            limit=limit
        )

        # Multi-tenant isolation guard:
        # If unauthenticated, ensure none of the returned turns belong to an authenticated user
        if not auth_user and isinstance(history_resp, dict) and "history" in history_resp:
            for item in history_resp["history"]:
                if item.get("user_id"):
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail="Forbidden: This session belongs to an authenticated user."
                    )

        return history_resp

    @app.get("/api/chat/sessions", tags=["Supabase and RAG"], summary="Get User Chat Sessions")
    def chat_sessions_handler(
        user_id: str = None,
        organization_id: str = None,
        limit: int = 20,
        auth_user: Optional[AuthenticatedUser] = Depends(get_optional_user)
    ):
        if not auth_user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Unauthorized: Listing chat sessions requires authentication."
            )
        effective_user_id = user_id
        effective_org_id = organization_id
        if not auth_user.is_admin:
            if user_id and user_id != auth_user.user_id:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Forbidden: Cannot list sessions for another user."
                )
            effective_user_id = auth_user.user_id
            user_org = _trusted_organization(get_supabase_client(), auth_user.user_id)
            if organization_id and organization_id != user_org:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Forbidden: Cannot list sessions outside your organization."
                )
            effective_org_id = None
            if user_org:
                effective_org_id = user_org

        return _call_rag(get_chat_sessions_endpoint,
            user_id=effective_user_id,
            organization_id=effective_org_id,
            limit=limit
        )

    @app.get("/api/documents/metadata", tags=["Supabase and Documents"], summary="List Uploaded Document Metadata")
    def documents_metadata_handler(
        limit: int = 50,
        uploaded_by: str = None,
        organization_id: str = None,
        auth_user: Optional[AuthenticatedUser] = Depends(get_optional_user)
    ):
        if not auth_user:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                                detail="Unauthorized: Listing documents requires authentication.")
        if auth_user.is_admin:  # DB-backed admin session only (Cognito claims never grant admin)
            return _call_rag(list_documents_endpoint, limit=limit, uploaded_by=uploaded_by, organization_id=organization_id)
        # Customers: only their own organization's documents, whatever filters they send.
        user_org = _trusted_organization(get_supabase_client(), auth_user.user_id)
        if organization_id and organization_id != user_org:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                                detail="Forbidden: Cannot list documents outside your organization.")
        return _call_rag(list_documents_endpoint, limit=limit, restrict_to_organization=user_org, restricted=True)

    def _require_db_admin(auth_user: Optional[AuthenticatedUser], action: str) -> AuthenticatedUser:
        if not auth_user:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                                detail=f"Unauthorized: {action} requires an administrator session.")
        if not auth_user.is_admin:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                                detail=f"Forbidden: {action} is restricted to administrators.")
        return auth_user

    @app.post("/api/documents/upload", response_model=DocumentUploadResponse, tags=["Supabase and Documents"], summary="Upload Document Metadata and Index Vector")
    def documents_upload_handler(
        payload: DocumentUploadRequest,
        auth_user: Optional[AuthenticatedUser] = Depends(get_optional_user)
    ):
        # Knowledge-base writes are admin-only: public documents reach every user (and guests), so customers
        # must not be able to write to it. Admin status comes only from the DB-backed admin session.
        admin = _require_db_admin(auth_user, "Uploading documents")
        target_org = None
        if payload.visibility == "organization":
            if not payload.organization_id:
                raise HTTPException(status_code=422, detail="organization_id is required for organization documents.")
            client = get_supabase_client()
            if not client:
                raise HTTPException(status_code=503, detail="Organization directory unavailable; cannot verify the target organization.")
            try:
                found = client.table("organizations").select("id").eq("id", payload.organization_id).limit(1).execute()
            except Exception:
                raise HTTPException(status_code=503, detail="Organization directory unavailable; cannot verify the target organization.")
            if not (found.data if hasattr(found, "data") else None):
                raise HTTPException(status_code=422, detail="Unknown organization_id.")
            target_org = payload.organization_id
        return _call_rag(upload_document_endpoint, payload, uploaded_by_admin_id=admin.user_id, organization_id=target_org)

    @app.delete("/api/documents/{document_id}", tags=["Supabase and Documents"], summary="Delete a Document (vectors and metadata)")
    def documents_delete_handler(
        document_id: str,
        auth_user: Optional[AuthenticatedUser] = Depends(get_optional_user)
    ):
        _require_db_admin(auth_user, "Deleting documents")
        return _call_rag(delete_document_endpoint, document_id)

    @app.get("/api/supabase/status", tags=["Supabase Diagnostics"], summary="Supabase PostgreSQL Connection and Table Health Check")
    def supabase_status_handler(auth_user: Optional[AuthenticatedUser] = Depends(get_optional_user)):
        _require_db_admin(auth_user, "Database diagnostics")  # returns connection details: admins only
        return _call_rag(supabase_status_endpoint)

    RAG_MOUNTED = True
    logger.info("RAG chat and Supabase endpoints mounted successfully with Cognito authorization.")
except Exception as _rag_err:
    _RAG_MOUNT_ERROR = str(_rag_err)
    logger.warning(f"Could not mount RAG chat endpoint: {_rag_err}")


def _build_notifications_health() -> dict:
    db_connected = False
    pool_saturated = False
    db_name = PG_DB
    try:
        # Short wait: a saturated pool must not make the health probe itself hang for DB_POOL_TIMEOUT.
        with DBConnection(autocommit=True, timeout=HEALTH_CHECK_POOL_WAIT_SECONDS) as conn:
            cur = conn.cursor()
            cur.execute("SELECT current_database();")
            row = cur.fetchone()
            db_connected = True
            if row and row[0]:
                db_name = row[0]
    except PoolTimeoutError:
        pool_saturated = True  # all pooled connections busy; not proof the database is down
    except Exception:
        db_connected = False

    cognito_ok = (
        COGNITO_USER_POOL_ID not in _COGNITO_PLACEHOLDERS
        and COGNITO_CLIENT_ID not in _COGNITO_PLACEHOLDERS
    )
    overall = "ok" if db_connected else "degraded"
    return {
        "status": overall,
        "service": "inferxe-notifications-rag",
        "database_connected": db_connected,
        "database_pool_saturated": pool_saturated,
        "database_name": db_name,
        "database_host": PG_HOST,
        "rag_mounted": RAG_MOUNTED,
        "rag_note": _RAG_MOUNT_ERROR if not RAG_MOUNTED else None,
        "cognito_configured": cognito_ok,
    }


@app.get("/")
def root():
    return {
        "service": "Inferxe Notifications & RAG API",
        "version": "1.0.0",
        "health": "/health",
        "api_health": "/api/health",
    }


@app.get("/health")
@app.get("/api/health")
def health_check():
    return _build_notifications_health()


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("NOTIFICATIONS_PORT", 8002))
    uvicorn.run("backend.notifications.main:app", host="127.0.0.1", port=port, reload=True)
