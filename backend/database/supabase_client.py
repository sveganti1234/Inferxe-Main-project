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
import re
import json
import uuid
import sqlite3
import logging
import threading
import time
from pathlib import Path
from typing import Dict, Any, List, Optional
from datetime import datetime, timezone
import sys as _sys
_GUARD_DIR = str(__import__('pathlib').Path(__file__).resolve().parents[1])  # backend/
if _GUARD_DIR not in _sys.path:
    _sys.path.append(_GUARD_DIR)
from isolation_guard import load_dotenv  # noqa: E402  (tests never load the project .env: isolation_guard.py)

logger = logging.getLogger("inferxe.supabase")

# Load environment variables from the repository root .env
ROOT_DIR = Path(__file__).resolve().parents[2]
DOTENV_PATH = ROOT_DIR / ".env"
load_dotenv(DOTENV_PATH, override=False)

# Local fallback cache DB path
CACHE_DB_PATH = ROOT_DIR / "database" / "inferxe_rag_cache.db"

# Cached client instance (one per process, created under a lock: chat handlers run in worker threads)
_supabase_client = None
_client_lock = threading.Lock()
# After a failed/unconfigured initialisation, wait before retrying so each request does not
# re-attempt (and re-log) the same failure.
_CLIENT_RETRY_SECONDS = 60.0
_client_retry_after = 0.0
# supabase-py's default PostgREST timeout is long (minutes); chat requests hold a limited slot.
SUPABASE_CLIENT_TIMEOUT_SECONDS = float(os.environ.get("SUPABASE_CLIENT_TIMEOUT_SECONDS", "10") or 10)
_local_cache_ready = False


def reset_supabase_client() -> None:
    """Forget the cached client and any remembered failure (e.g. after credentials change; tests)."""
    global _supabase_client, _client_retry_after
    with _client_lock:
        _supabase_client = None
        _client_retry_after = 0.0


def _init_local_cache_db():
    """Ensure local resilient storage tables exist (once per process)."""
    global _local_cache_ready
    if _local_cache_ready:
        return
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
            existing_cols = {r[1] for r in conn.execute("PRAGMA table_info(document_metadata)")}
            for col_name, col_def in (("organization_id", "TEXT"),
                                      ("visibility", "TEXT NOT NULL DEFAULT 'quarantined'"),
                                      ("uploaded_by_admin_id", "TEXT")):
                if col_name not in existing_cols:
                    conn.execute(f"ALTER TABLE document_metadata ADD COLUMN {col_name} {col_def}")
        conn.close()
        _local_cache_ready = True
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

def _create_client(url: str, key: str):
    """create_client with an explicit request timeout, falling back to library defaults if this
    supabase-py version names the option differently."""
    from supabase import create_client
    try:
        try:
            from supabase import ClientOptions  # supabase-py >= 2.x
        except ImportError:
            from supabase.lib.client_options import ClientOptions  # older 2.x layout
        options = ClientOptions(
            postgrest_client_timeout=SUPABASE_CLIENT_TIMEOUT_SECONDS,
            storage_client_timeout=SUPABASE_CLIENT_TIMEOUT_SECONDS,
        )
        return create_client(url, key, options=options)
    except (ImportError, TypeError) as opt_err:
        logger.warning("Supabase client options unavailable (%s); using library default timeouts.", type(opt_err).__name__)
        return create_client(url, key)


def get_supabase_client():
    """
    Get or initialize the cached Supabase client instance.
    Returns None if credentials are missing or the client fails to initialize; that outcome is
    remembered for a short period instead of being retried (and logged) on every request.
    """
    global _supabase_client, _client_retry_after
    if _supabase_client is not None:
        return _supabase_client
    if time.monotonic() < _client_retry_after:
        return None

    with _client_lock:
        if _supabase_client is not None:
            return _supabase_client
        if time.monotonic() < _client_retry_after:
            return None

        url, key = get_supabase_credentials()
        if not url or not key:
            logger.warning(
                "Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in root .env."
            )
            _client_retry_after = time.monotonic() + _CLIENT_RETRY_SECONDS
            return None

        try:
            _supabase_client = _create_client(url, key)
            logger.info("Supabase client initialized successfully.")
            return _supabase_client
        except Exception as e:
            logger.error(f"Failed to initialize Supabase client: {type(e).__name__}: {e}")
            _client_retry_after = time.monotonic() + _CLIENT_RETRY_SECONDS
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

_UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
DOCUMENT_VISIBILITIES = ("public", "organization", "quarantined")


def upsert_document_metadata(
    document_id: str,
    filename: str,
    file_type: str,
    uploaded_by: Optional[str] = None,
    organization_id: Optional[str] = None,
    file_size_bytes: Optional[int] = None,
    file_hash: Optional[str] = None,
    status: str = "processed",
    chunk_count: int = 0,
    metadata: Optional[Dict[str, Any]] = None,
    visibility: str = "quarantined",
    uploaded_by_admin_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Store document metadata in Supabase `document_metadata` (or the local fallback cache).

    `document_id` is unique per upload (rag/server.py), so this never overwrites another document; the conflict
    target only lets the same upload update its own row. `uploaded_by` references profiles (customers) and is
    left NULL for admin uploads, whose id goes to `uploaded_by_admin_id`. `visibility` is 'public',
    'organization' or 'quarantined' (legacy rows; never shown to customers).
    """
    if visibility not in DOCUMENT_VISIBILITIES:
        raise ValueError("invalid document visibility")
    client = get_supabase_client()
    now_iso = datetime.now(timezone.utc).isoformat()
    record = {
        "document_id": document_id,
        "filename": filename,
        "file_type": file_type.lower().lstrip("."),
        "uploaded_by": uploaded_by,
        "uploaded_by_admin_id": uploaded_by_admin_id,
        "organization_id": organization_id,
        "visibility": visibility,
        "status": status,
        "chunk_count": chunk_count,
        "metadata": metadata or {},
        "updated_at": now_iso,
    }
    if file_size_bytes is not None:
        record["file_size_bytes"] = file_size_bytes
    if file_hash:
        record["file_hash"] = file_hash

    if client:
        try:
            res = client.table("document_metadata").upsert(record, on_conflict="document_id").execute()
            data = res.data if hasattr(res, "data") else []
            return {"ok": True, "document_id": document_id, "data": data, "action": "upserted", "backend": "supabase"}
        except Exception as e:
            err_msg = str(e)
            if "PGRST205" not in err_msg and "schema cache" not in err_msg:
                logger.warning("Could not upsert document metadata to Supabase (%s).", type(e).__name__)

    try:
        _init_local_cache_db()
        conn = sqlite3.connect(str(CACHE_DB_PATH))
        with conn:
            conn.execute("""
                INSERT INTO document_metadata (
                    id, document_id, filename, file_type, file_size_bytes, file_hash,
                    uploaded_by, upload_date, status, chunk_count, metadata, created_at, updated_at,
                    organization_id, visibility, uploaded_by_admin_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(document_id) DO UPDATE SET
                    status=excluded.status,
                    chunk_count=excluded.chunk_count,
                    metadata=excluded.metadata,
                    updated_at=excluded.updated_at
            """, (
                str(uuid.uuid4()), record["document_id"], record["filename"], record["file_type"],
                record.get("file_size_bytes"), record.get("file_hash"), record["uploaded_by"],
                now_iso, record["status"], record["chunk_count"], json.dumps(record.get("metadata", {})),
                now_iso, now_iso, record["organization_id"], record["visibility"], record["uploaded_by_admin_id"],
            ))
        conn.close()
        return {"ok": True, "document_id": document_id, "data": [record], "action": "upserted",
                "backend": "local_fallback", "missing_remote_table": True}
    except Exception as fallback_err:
        logger.error("Local document metadata fallback error (%s).", type(fallback_err).__name__)
        return {"ok": False, "error": type(fallback_err).__name__, "document_id": document_id}


def list_document_metadata(
    limit: int = 50,
    uploaded_by: Optional[str] = None,
    organization_id: Optional[str] = None,
    restrict_to_organization: Optional[str] = None,
    restricted: bool = False,
) -> List[Dict[str, Any]]:
    """
    Document metadata from Supabase (or the local fallback).

    restricted=True (non-admin callers): only `visibility = 'organization'` rows of `restrict_to_organization`
    (a server-verified organization id) are returned; `uploaded_by` / `organization_id` filters cannot widen it,
    and no organization means no rows. Admin callers (restricted=False) may filter freely.
    """
    limit = max(1, min(int(limit), 100))
    if restricted:
        if not restrict_to_organization or not _UUID_RE.match(str(restrict_to_organization)):
            return []
        organization_id = str(restrict_to_organization)

    client = get_supabase_client()
    if client:
        try:
            query = client.table("document_metadata").select("*")
            if restricted:
                query = query.eq("visibility", "organization").eq("organization_id", organization_id)
            else:
                if uploaded_by:
                    query = query.eq("uploaded_by", uploaded_by)
                if organization_id:
                    query = query.eq("organization_id", organization_id)
            res = query.order("created_at", desc=True).limit(limit).execute()
            return list(res.data or []) if hasattr(res, "data") else []
        except Exception:
            pass

    try:
        _init_local_cache_db()
        conn = sqlite3.connect(str(CACHE_DB_PATH))
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        if restricted:
            cursor.execute(
                "SELECT * FROM document_metadata WHERE visibility = 'organization' AND organization_id = ? "
                "ORDER BY upload_date DESC LIMIT ?", (organization_id, limit))
        else:
            clauses, params = [], []
            if uploaded_by:
                clauses.append("uploaded_by = ?")
                params.append(uploaded_by)
            if organization_id:
                clauses.append("organization_id = ?")
                params.append(organization_id)
            where = f"WHERE {' AND '.join(clauses)} " if clauses else ""
            cursor.execute(f"SELECT * FROM document_metadata {where}ORDER BY upload_date DESC LIMIT ?", (*params, limit))
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
        logger.warning("Failed to list document metadata from cache (%s).", type(e).__name__)
        return []


def delete_document_metadata(document_id: str) -> Dict[str, Any]:
    """Delete a document's metadata row (Supabase and the local fallback). Returns {"deleted": bool}."""
    deleted = False
    client = get_supabase_client()
    if client:
        try:
            res = client.table("document_metadata").delete().eq("document_id", document_id).execute()
            deleted = bool(getattr(res, "data", None))
        except Exception as e:
            logger.warning("Could not delete document metadata in Supabase (%s).", type(e).__name__)
    try:
        _init_local_cache_db()
        conn = sqlite3.connect(str(CACHE_DB_PATH))
        with conn:
            cur = conn.execute("DELETE FROM document_metadata WHERE document_id = ?", (document_id,))
            deleted = deleted or cur.rowcount > 0
        conn.close()
    except Exception as e:
        logger.warning("Could not delete document metadata in the local cache (%s).", type(e).__name__)
    return {"deleted": deleted, "document_id": document_id}

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
    Filters by session_id, user_id, or organization_id and returns the most recent `limit` turns in
    chronological order (previously ascending + limit returned the oldest turns).
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

        res = query.order("created_at", desc=True).limit(limit).execute()
        rows = list(reversed(res.data)) if hasattr(res, "data") and res.data else []
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
