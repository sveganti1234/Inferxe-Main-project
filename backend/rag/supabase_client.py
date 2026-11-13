"""
RAG Service Supabase Client Re-export
"""
import sys
from pathlib import Path

# Add backend directory to path if needed
backend_dir = Path(__file__).resolve().parents[1]
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from backend.database.supabase_client import (
    get_supabase_client,
    is_supabase_configured,
    check_table_exists,
    test_connection,
    upsert_document_metadata,
    list_document_metadata,
    save_chat_history,
    get_chat_history,
    get_chat_sessions,
)

__all__ = [
    "get_supabase_client",
    "is_supabase_configured",
    "check_table_exists",
    "test_connection",
    "upsert_document_metadata",
    "list_document_metadata",
    "save_chat_history",
    "get_chat_history",
    "get_chat_sessions",
]
