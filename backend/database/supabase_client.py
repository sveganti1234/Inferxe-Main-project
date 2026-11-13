"""
supabase_client.py
==================
Reusable Supabase PostgreSQL client module for the Inferxe platform.
Provides secure database connectivity for:
  1. Document metadata tracking and ingestion deduplication (`document_metadata` table)
  2. Chat history storage and multi-turn session retrieval (`chat_history` table)

Features:
  - Uses the backend SUPABASE_SERVICE_ROLE_KEY exclusively on the server.
  - Never exposes secret keys or credentials to the frontend client.
  - Automatically loads configuration from the repository root `.env` using python-dotenv.
  - Resilient local fallback: if remote Supabase tables are pending migration or offline,
    automatically ensures zero data loss using local persistent storage.
"""

import os
import json
import uuid
import sqlite3
import logging
from pathlib import Path
from typing import Dict, Any, List, Optional
from datetime import datetime, timezone
from dotenv import load_dotenv

logger = logging.getLogger("inferxe.supabase")

# Load environment variables from the repository root .env
ROOT_DIR = Path(__file__).resolve().parents[2]
DOTENV_PATH = ROOT_DIR / ".env"
load_dotenv(DOTENV_PATH, override=False)

# Local fallback cache DB path
CACHE_DB_PATH = ROOT_DIR / "database" / "inferxe_rag_cache.db"

# Cached client instance
_supabase_client = None

def _init_local_cache_db():
    """Ensure local resilient storage tables exist."""
    try:
        CACHE_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(CACHE_DB_PATH))
        with conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS document_metadata (
                    id TEXT PRIMARY KEY,
                    document_id TEXT UNIQUE NOT NULL,
                    filename TEXT NOT NULL,
                    file_type TEXT NOT NULL,
                    file_size_bytes INTEGER,
                    file_hash TEXT,
                    uploaded_by TEXT DEFAULT 'system',
                    upload_date TEXT NOT NULL,
                    status TEXT DEFAULT 'processed',
                    chunk_count INTEGER DEFAULT 0,
                    metadata TEXT DEFAULT '{}',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS chat_history (
                    id TEXT PRIMARY KEY,
                    session_id TEXT NOT NULL,
                    user_id TEXT,
                    question TEXT NOT NULL,
                    answer TEXT NOT NULL,
                    grounded INTEGER DEFAULT 1,
                    status TEXT DEFAULT 'success',
                    sources TEXT DEFAULT '[]',
                    processing_time_ms INTEGER DEFAULT 0,
                    timestamp TEXT NOT NULL,
                    metadata TEXT DEFAULT '{}',
                    created_at TEXT NOT NULL
                )
            """)
        conn.close()
    except Exception as e:
        logger.warning(f"Could not initialize local RAG cache DB: {e}")

def get_supabase_credentials() -> tuple[Optional[str], Optional[str]]:
    """Retrieve SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from environment."""
    url = os.environ.get("SUPABASE_URL", "").strip()
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    return url or None, key or None

def is_supabase_configured() -> bool:
    """Check if Supabase credentials are configured in the environment."""
    url, key = get_supabase_credentials()
    return bool(url and key)

def get_supabase_client():
    """
    Get or initialize the cached Supabase client instance.
    Returns None if credentials are missing or the client fails to initialize.
    """
    global _supabase_client
    if _supabase_client is not None:
        return _supabase_client

    url, key = get_supabase_credentials()
    if not url or not key:
        logger.warning(
            "Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in root .env."
        )
        return None

    try:
        from supabase import create_client, Client
        _supabase_client = create_client(url, key)
        logger.info(f"Supabase client initialized successfully for {url}")
        return _supabase_client
    except Exception as e:
        logger.error(f"Failed to initialize Supabase client: {e}")
        return None

def check_table_exists(table_name: str) -> bool:
    """
    Verify whether a specified table exists in the Supabase schema cache.
    Returns True if the table is queryable in Supabase, False if missing or on error.
    """
    client = get_supabase_client()
    if not client:
        return False
    try:
        client.table(table_name).select("*").limit(1).execute()
        return True
    except Exception as e:
        err_msg = str(e)
        if "PGRST205" in err_msg or "schema cache" in err_msg:
            return False
        logger.warning(f"Error checking table '{table_name}': {e}")
        return False

def test_connection() -> Dict[str, Any]:
    """
    Diagnose the Supabase connection and report the existence of required tables.
    """
    url, key = get_supabase_credentials()
    if not url or not key:
        return {
            "status": "unconfigured",
            "connected": False,
            "error": "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing in root .env",
            "tables": {}
        }

    client = get_supabase_client()
    if not client:
        return {
            "status": "error",
            "connected": False,
            "error": "Could not create Supabase client instance",
            "tables": {}
        }

    tables_to_check = ["document_metadata", "chat_history", "profiles", "notifications"]
    table_statuses = {}
    for tbl in tables_to_check:
        table_statuses[tbl] = check_table_exists(tbl)

    return {
        "status": "healthy",
        "connected": True,
        "supabase_url": url,
        "tables": table_statuses,
        "missing_required_tables": [
            t for t in ["document_metadata", "chat_history"] if not table_statuses.get(t)
        ]
    }

# ==============================================================================
# Document Metadata Operations
# ==============================================================================

def upsert_document_metadata(
    document_id: str,
    filename: str,
    file_type: str,
    uploaded_by: Optional[str] = "system",
    organization_id: Optional[str] = None,
    file_size_bytes: Optional[int] = None,
    file_hash: Optional[str] = None,
    status: str = "processed",
    chunk_count: int = 0,
    metadata: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Store or update document metadata in Supabase `document_metadata` table.
    Uses `document_id` as the unique conflict target to prevent duplicate records.
    """
    client = get_supabase_client()
    now_iso = datetime.now(timezone.utc).isoformat()
    record = {
        "document_id": document_id,
        "filename": filename,
        "file_type": file_type.lower().lstrip("."),
        "uploaded_by": uploaded_by or "system",
        "status": status,
        "chunk_count": chunk_count,
        "metadata": metadata or {},
        "updated_at": now_iso,
    }

    if organization_id:
        record["organization_id"] = organization_id
    if file_size_bytes is not None:
        record["file_size_bytes"] = file_size_bytes
    if file_hash:
        record["file_hash"] = file_hash

    # Try remote Supabase
    if client:
        try:
            res = client.table("document_metadata").upsert(
                record,
                on_conflict="document_id"
            ).execute()
            data = res.data if hasattr(res, "data") else []
            return {
                "ok": True,
                "document_id": document_id,
                "data": data,
                "action": "upserted",
                "backend": "supabase"
            }
        except Exception as e:
            err_msg = str(e)
            if "PGRST205" not in err_msg and "schema cache" not in err_msg:
                logger.warning(f"Could not upsert document metadata to Supabase: {e}")

    # Resilient local fallback store
    try:
        _init_local_cache_db()
        conn = sqlite3.connect(str(CACHE_DB_PATH))
        with conn:
            conn.execute("""
                INSERT INTO document_metadata (
                    id, document_id, filename, file_type, file_size_bytes, file_hash,
                    uploaded_by, upload_date, status, chunk_count, metadata, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(document_id) DO UPDATE SET
                    filename=excluded.filename,
                    file_type=excluded.file_type,
                    file_size_bytes=excluded.file_size_bytes,
                    file_hash=excluded.file_hash,
                    uploaded_by=excluded.uploaded_by,
                    status=excluded.status,
                    chunk_count=excluded.chunk_count,
                    metadata=excluded.metadata,
                    updated_at=excluded.updated_at
            """, (
                str(uuid.uuid4()), record["document_id"], record["filename"], record["file_type"],
                record.get("file_size_bytes"), record.get("file_hash"), record["uploaded_by"],
                now_iso, record["status"], record["chunk_count"], json.dumps(record.get("metadata", {})),
                now_iso, now_iso
            ))
        conn.close()
        return {
            "ok": True,
            "document_id": document_id,
            "data": [record],
            "action": "upserted",
            "backend": "local_fallback",
            "missing_remote_table": True
        }
    except Exception as fallback_err:
        logger.error(f"Local document metadata fallback error: {fallback_err}")
        return {
            "ok": False,
            "error": str(fallback_err),
            "document_id": document_id
        }

def list_document_metadata(
    limit: int = 50,
    uploaded_by: Optional[str] = None,
    organization_id: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """
    Retrieve document metadata records from Supabase (or local fallback).
    """
    client = get_supabase_client()
    if client:
        try:
            query = client.table("document_metadata").select("*")
            if uploaded_by:
                query = query.eq("uploaded_by", uploaded_by)
            if organization_id:
                query = query.eq("organization_id", organization_id)
            res = query.order("created_at", desc=True).limit(limit).execute()
            if hasattr(res, "data") and res.data:
                return res.data
        except Exception:
            pass

    # Fallback to local cache
    try:
        _init_local_cache_db()
        conn = sqlite3.connect(str(CACHE_DB_PATH))
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        if uploaded_by:
            cursor.execute(
                "SELECT * FROM document_metadata WHERE uploaded_by = ? ORDER BY upload_date DESC LIMIT ?",
                (uploaded_by, limit)
            )
        else:
            cursor.execute("SELECT * FROM document_metadata ORDER BY upload_date DESC LIMIT ?", (limit,))
        rows = [dict(r) for r in cursor.fetchall()]
        conn.close()
        for r in rows:
            if isinstance(r.get("metadata"), str):
                try:
                    r["metadata"] = json.loads(r["metadata"])
                except Exception:
                    pass
        return rows
    except Exception as e:
        logger.warning(f"Failed to list document metadata from cache: {e}")
        return []

# ==============================================================================
# Chat History Operations (Supabase PostgreSQL Persistence)
# ==============================================================================

def save_chat_history(
    session_id: str,
    question: str,
    answer: str,
    user_id: Optional[str] = None,
    organization_id: Optional[str] = None,
    grounded: bool = True,
    status: str = "success",
    sources: Optional[List[Dict[str, Any]]] = None,
    processing_time_ms: int = 0,
    metadata: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Save a user question and chatbot answer directly into the shared Supabase `public.chat_history` table.
    Enforces real remote Supabase persistence with explicit error reporting (no silent local fallbacks).
    Respects foreign-key constraints on public.profiles(user_id) and public.organizations(id).
    """
    client = get_supabase_client()
    if not client:
        err = "Supabase client is not configured; cannot persist chat history."
        logger.error(err)
        return {"ok": False, "saved": False, "error": err, "backend": "supabase"}

    now_iso = datetime.now(timezone.utc).isoformat()
    meta = (metadata or {}).copy()

    # Foreign Key Protection: user_id must exist in profiles, or be None
    valid_user_id = None
    if user_id:
        try:
            p_res = client.table("profiles").select("user_id").eq("user_id", user_id).limit(1).execute()
            if p_res.data:
                valid_user_id = user_id
            else:
                err_msg = f"Foreign key error: user_id '{user_id}' does not exist in public.profiles."
                logger.error(err_msg)
                return {
                    "ok": False,
                    "saved": False,
                    "error": err_msg,
                    "backend": "supabase"
                }
        except Exception as e:
            err_msg = f"Profile check query failed for user_id '{user_id}': {e}"
            logger.error(err_msg)
            return {
                "ok": False,
                "saved": False,
                "error": err_msg,
                "backend": "supabase"
            }

    # Foreign Key Protection: organization_id must exist in organizations, or be None
    valid_org_id = None
    if organization_id:
        try:
            o_res = client.table("organizations").select("id").eq("id", organization_id).limit(1).execute()
            if o_res.data:
                valid_org_id = organization_id
            else:
                logger.warning(f"organization_id '{organization_id}' not found in public.organizations. Storing as None to satisfy foreign key.")
                meta["client_organization_id"] = organization_id
        except Exception as e:
            logger.warning(f"Organization check warning for '{organization_id}': {e}")
            meta["unverified_organization_id"] = organization_id

    # Record strictly matching Supabase public.chat_history columns
    record = {
        "session_id": session_id,
        "user_id": valid_user_id,
        "organization_id": valid_org_id,
        "question": question,
        "answer": answer,
        "grounded": grounded,
        "status": status,
        "sources": sources or [],
        "processing_time_ms": processing_time_ms,
        "metadata": meta,
        "created_at": now_iso,
    }

    logger.info(f"[DIAGNOSTIC] Supabase insert chat_history: session={session_id}, user_id={valid_user_id}, org_id={valid_org_id}")
    try:
        res = client.table("chat_history").insert(record).execute()
        data = res.data if hasattr(res, "data") else []
        logger.info(f"Successfully persisted chat turn in Supabase chat_history for session '{session_id}' (user: {valid_user_id}).")
        return {
            "ok": True,
            "saved": True,
            "data": data,
            "backend": "supabase"
        }
    except Exception as e:
        logger.error(f"Failed to insert chat history record into remote Supabase: {e}", exc_info=True)
        return {
            "ok": False,
            "saved": False,
            "error": str(e),
            "backend": "supabase"
        }

def get_chat_history(
    session_id: Optional[str] = None,
    user_id: Optional[str] = None,
    organization_id: Optional[str] = None,
    limit: int = 50,
) -> List[Dict[str, Any]]:
    """
    Retrieve conversation history directly from remote Supabase `public.chat_history` table.
    Filters by session_id, user_id, or organization_id and orders chronologically (created_at ASC).
    """
    client = get_supabase_client()
    if not client:
        logger.error("Supabase client not configured; cannot retrieve chat history.")
        return []

    try:
        query = client.table("chat_history").select("*")
        if session_id:
            query = query.eq("session_id", session_id)
        if user_id:
            query = query.eq("user_id", user_id)
        if organization_id:
            query = query.eq("organization_id", organization_id)

        res = query.order("created_at", desc=False).limit(limit).execute()
        rows = res.data if hasattr(res, "data") else []
        logger.info(f"Retrieved {len(rows)} chat history records from Supabase (session={session_id}, user={user_id}).")
        return rows
    except Exception as e:
        logger.error(f"Failed to query chat_history from Supabase: {e}", exc_info=True)
        return []

def get_chat_sessions(
    user_id: Optional[str] = None,
    organization_id: Optional[str] = None,
    limit: int = 20,
) -> List[Dict[str, Any]]:
    """
    Retrieve distinct recent chat sessions directly from remote Supabase `public.chat_history` table.
    """
    client = get_supabase_client()
    if not client:
        logger.error("Supabase client not configured; cannot retrieve chat sessions.")
        return []

    try:
        query = client.table("chat_history").select("session_id, question, created_at, user_id, organization_id")
        if user_id:
            query = query.eq("user_id", user_id)
        if organization_id:
            query = query.eq("organization_id", organization_id)

        res = query.order("created_at", desc=True).limit(limit * 5).execute()
        rows = res.data if hasattr(res, "data") else []

        seen_sessions = set()
        sessions = []
        for r in rows:
            sid = r.get("session_id")
            if sid and sid not in seen_sessions:
                seen_sessions.add(sid)
                sessions.append({
                    "session_id": sid,
                    "title": r.get("question", "")[:60],
                    "last_active": r.get("created_at"),
                    "user_id": r.get("user_id"),
                    "organization_id": r.get("organization_id"),
                })
                if len(sessions) >= limit:
                    break
        logger.info(f"Retrieved {len(sessions)} distinct sessions from Supabase for user '{user_id}'.")
        return sessions
    except Exception as e:
        logger.error(f"Failed to query chat sessions from Supabase: {e}", exc_info=True)
        return []
