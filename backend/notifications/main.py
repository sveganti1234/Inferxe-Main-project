"""
FastAPI Application Entry Point for Inferxe Notification Service.
Runs standalone on port 8000 or can be imported into existing services.
"""

import sys
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .db import init_db
from .router import router

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("inferxe.notifications")

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Safe database migration on startup
    try:
        init_db()
        logger.info("Database initialized successfully.")
    except Exception as e:
        logger.error("Failed to initialize database during startup (%s).", type(e).__name__)
    yield

app = FastAPI(
    title="Inferxe Multi-User Notification Service",
    description="Centralized, database-driven notification service with multi-tenant isolation, Cognito JWT authentication, and outbox reliability.",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "*"
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
        list_documents_endpoint,
        supabase_status_endpoint,
        DocumentUploadRequest,
        DocumentUploadResponse
    )

    from backend.database.supabase_client import get_supabase_client

    @app.post("/api/chat", tags=["AI Chatbot"], summary="Inferxe Grounded RAG Chat Endpoint")
    async def chat_handler(
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

        if auth_user:
            logger.info(f"[DIAGNOSTIC] 2. Cognito identity resolved: sub={auth_user.user_id}, email={auth_user.email}, roles={auth_user.roles}")

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
                logger.error(f"Failed to query profiles by user_id {auth_user.user_id}: {e}")

            # Fallback check by email if sub not found
            if not profile_rows and auth_user.email:
                try:
                    p_email_res = client.table("profiles").select("*").eq("email", auth_user.email.strip().lower()).limit(1).execute()
                    profile_rows = p_email_res.data if hasattr(p_email_res, "data") else []
                except Exception as e:
                    logger.error(f"Failed to query profiles by email {auth_user.email}: {e}")

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
                    logger.info(f"[DIAGNOSTIC] Created profile in public.profiles for {auth_user.user_id}")
                except Exception as ins_err:
                    logger.warning(f"[DIAGNOSTIC] Could not auto-insert profile: {ins_err}")

            if not profile_rows:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail=f"Authenticated Cognito user identity '{auth_user.user_id}' could not be resolved in user profiles."
                )

            profile = profile_rows[0]
            payload.user_id = profile["user_id"]
            logger.info(f"[DIAGNOSTIC] 3. Profile mapping result: user_id={payload.user_id}, email={profile.get('email')}, role={profile.get('role')}")

            # Task 9: Resolve organization_id from user's actual organization membership
            resolved_org = profile.get("organization_id")
            if not resolved_org:
                try:
                    m_res = client.table("organization_members").select("organization_id").eq("user_id", profile["user_id"]).limit(1).execute()
                    m_data = m_res.data if hasattr(m_res, "data") else []
                    if m_data and m_data[0].get("organization_id"):
                        resolved_org = m_data[0]["organization_id"]
                except Exception as e:
                    logger.warning(f"Error checking organization_members: {e}")

            if not resolved_org:
                jwt_org = auth_user.claims.get("custom:organization") or auth_user.claims.get("organization_id")
                if jwt_org:
                    try:
                        o_chk = client.table("organizations").select("id").eq("id", jwt_org).limit(1).execute()
                        if o_chk.data if hasattr(o_chk, "data") else []:
                            resolved_org = jwt_org
                    except Exception:
                        pass

            if payload.organization_id and payload.organization_id != resolved_org and not auth_user.is_admin:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Forbidden: Cannot specify an organization you do not belong to."
                )
            payload.organization_id = resolved_org
            logger.info(f"[DIAGNOSTIC] 4. Organization mapping result: organization_id={resolved_org}")

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

        logger.info(f"[DIAGNOSTIC] 5. Final chat_history insert payload: user_id={payload.user_id}, org_id={payload.organization_id}, role={payload.user_role}")
        return await chat_endpoint(payload)

    @app.get("/api/chat/history", tags=["Supabase and RAG"], summary="Get Chat History by Session or User ID")
    async def chat_history_handler(
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
                client = get_supabase_client()
                user_org = None
                if client:
                    try:
                        p_res = client.table("profiles").select("organization_id").eq("user_id", auth_user.user_id).limit(1).execute()
                        if p_res.data:
                            user_org = p_res.data[0].get("organization_id")
                    except Exception:
                        pass
                if not user_org:
                    user_org = auth_user.claims.get("custom:organization") or auth_user.claims.get("organization_id")
                if organization_id and user_org and organization_id != user_org:
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

        history_resp = await get_chat_history_endpoint(
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
    async def chat_sessions_handler(
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
            client = get_supabase_client()
            user_org = None
            if client:
                try:
                    p_res = client.table("profiles").select("organization_id").eq("user_id", auth_user.user_id).limit(1).execute()
                    if p_res.data:
                        user_org = p_res.data[0].get("organization_id")
                except Exception:
                    pass
            if not user_org:
                user_org = auth_user.claims.get("custom:organization") or auth_user.claims.get("organization_id")
            if not effective_org_id and user_org:
                effective_org_id = user_org

        return await get_chat_sessions_endpoint(
            user_id=effective_user_id,
            organization_id=effective_org_id,
            limit=limit
        )

    @app.get("/api/documents/metadata", tags=["Supabase and Documents"], summary="List Uploaded Document Metadata")
    async def documents_metadata_handler(
        limit: int = 50,
        uploaded_by: str = None,
        organization_id: str = None,
        auth_user: Optional[AuthenticatedUser] = Depends(get_optional_user)
    ):
        effective_uploader = uploaded_by
        effective_org = organization_id
        if auth_user and not auth_user.is_admin:
            user_org = auth_user.claims.get("custom:organization") or auth_user.claims.get("organization_id")
            if not effective_org and user_org:
                effective_org = user_org
        return await list_documents_endpoint(
            limit=limit,
            uploaded_by=effective_uploader,
            organization_id=effective_org
        )

    @app.post("/api/documents/upload", response_model=DocumentUploadResponse, tags=["Supabase and Documents"], summary="Upload Document Metadata and Index Vector")
    async def documents_upload_handler(
        payload: DocumentUploadRequest,
        auth_user: Optional[AuthenticatedUser] = Depends(get_optional_user)
    ):
        if auth_user:
            payload.uploaded_by = auth_user.user_id
            if not payload.organization_id:
                payload.organization_id = auth_user.claims.get("custom:organization") or auth_user.claims.get("organization_id")
        return await upload_document_endpoint(payload)

    @app.get("/api/supabase/status", tags=["Supabase Diagnostics"], summary="Supabase PostgreSQL Connection and Table Health Check")
    async def supabase_status_handler():
        return await supabase_status_endpoint()

    logger.info("RAG chat and Supabase endpoints mounted successfully with Cognito authorization.")
except Exception as _rag_err:
    logger.warning(f"Could not mount RAG chat endpoint: {_rag_err}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.notifications.main:app", host="127.0.0.1", port=8000, reload=True)
