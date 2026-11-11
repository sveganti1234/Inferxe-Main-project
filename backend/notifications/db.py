"""
Database Connection & Safe Migration Module for Inferxe PostgreSQL
Handles connection pooling, queries with RealDictCursor, and idempotent migrations.
"""

import os
import json
import logging
import traceback
from pathlib import Path
from typing import Dict, Any, List, Optional
from datetime import datetime, timezone
from urllib.parse import parse_qs, unquote, urlsplit, urlunsplit
import psycopg2
from psycopg2.extras import RealDictCursor
from psycopg2.pool import ThreadedConnectionPool
from dotenv import load_dotenv

ROOT_DIR = Path(__file__).resolve().parents[2]
load_dotenv(ROOT_DIR / ".env", override=False)

logger = logging.getLogger("inferxe.notifications.db")

DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()

try:
    _database_url = urlsplit(DATABASE_URL)
    PG_HOST = _database_url.hostname or "not configured"
    PG_PORT = _database_url.port or 5432
    PG_DB = unquote(_database_url.path.lstrip("/")) or "not configured"
except ValueError:
    PG_HOST = "not configured"
    PG_PORT = 5432
    PG_DB = "not configured"

_pool: Optional[ThreadedConnectionPool] = None

def _mask_connection_params(params: Dict[str, Any]) -> Dict[str, Any]:
    """Return a copy of params with credential fields masked so secrets are never logged."""
    masked = dict(params)
    sensitive_keys = {"user", "password", "host", "dbname"}
    for key in sensitive_keys:
        if key in masked:
            masked[key] = "<redacted>"
    return masked


def _sanitize_error_message(message: str) -> str:
    """Mask any PostgreSQL connection strings or credentials that may appear in an error message."""
    import re
    # Mask postgresql:// URLs that may appear in psycopg2 error messages
    message = re.sub(r"postgresql://[^\s'\"\)]+", "postgresql://<redacted>", message)
    # Mask password= parameters
    message = re.sub(r"password=[^\s'\"\)]+", "password=<redacted>", message)
    # Mask host= parameters (hostnames may appear in error messages)
    message = re.sub(r"host=[^\s'\"\)]+", "host=<redacted>", message)
    # Mask user= parameters
    message = re.sub(r"user=[^\s'\"\)]+", "user=<redacted>", message)
    # Mask dbname= parameters
    message = re.sub(r"dbname=[^\s'\"\)]+", "dbname=<redacted>", message)
    # Mask quoted hostname values that psycopg2 may include in error text
    message = re.sub(r"'[^']*\.[^']*'", "'<redacted-host>'", message)
    # Mask single-quoted values containing '@' (credentials/emails in error text)
    message = re.sub(r"'[^']*@[^']*'", "'<redacted-cred>'", message)
    return message


def _extract_url_components(parsed_url) -> Dict[str, Any]:
    """Extract connection components from a parsed URL, URL-decoding credentials.

    urlsplit already decodes percent-encoded characters, but we apply unquote()
    explicitly for defense-in-depth against double-encoded or unusual formats.
    """
    import re

    # Extract hostname safely; some Python versions may validate IP addresses
    # when accessing hostname on certain URL formats.
    hostname = None
    try:
        hostname = parsed_url.hostname
    except Exception:
        # Fallback: manually extract from netloc
        netloc = parsed_url.netloc or ""
        # Strip userinfo (everything before last @)
        if "@" in netloc:
            netloc = netloc.rsplit("@", 1)[-1]
        # Strip port
        if ":" in netloc:
            netloc = netloc.rsplit(":", 1)[0]
        # Strip IPv6 brackets
        hostname = netloc.strip("[]") or None

    # Extract port
    port = None
    try:
        port = parsed_url.port
    except Exception:
        netloc = parsed_url.netloc or ""
        if "@" in netloc:
            netloc = netloc.rsplit("@", 1)[-1]
        if ":" in netloc:
            try:
                port = int(netloc.rsplit(":", 1)[-1])
            except ValueError:
                port = None
    if port is None:
        port = 5432

    # Extract path (dbname)
    dbname = ""
    try:
        dbname = (parsed_url.path or "").lstrip("/")
    except Exception:
        dbname = ""

    # Extract username and password with explicit URL decoding
    username = None
    user_password = None
    try:
        username = parsed_url.username
        if username:
            username = unquote(username)
    except Exception:
        username = None

    try:
        user_password = parsed_url.password
        if user_password:
            user_password = unquote(user_password)
    except Exception:
        user_password = None

    return {
        "host": hostname,
        "port": port,
        "dbname": dbname,
        "user": username,
        "password": user_password,
    }


def get_connection_params() -> Dict[str, Any]:
    if not DATABASE_URL:
        raise RuntimeError(
            "DATABASE_URL is required. Set it in the repository root .env to the "
            "Supabase PostgreSQL connection string."
        )

    # ── STAGE 1: URL parsing ──────────────────────────────────────────
    try:
        parsed_url = urlsplit(DATABASE_URL)
    except Exception as e:
        logger.error(
            "URL parsing failed at stage 'urlsplit': %s",
            _sanitize_error_message(str(e)),
        )
        logger.debug("URL parsing traceback:\n%s", traceback.format_exc())
        raise

    # ── STAGE 2: URL validation ───────────────────────────────────────
    try:
        scheme = parsed_url.scheme
        scheme_valid = scheme in {"postgres", "postgresql"}
        # Validate hostname presence without triggering IP validation
        netloc = parsed_url.netloc or ""
        hostname_present = bool(netloc)
        path_present = bool((parsed_url.path or "").strip("/"))
        if not scheme_valid or not hostname_present or not path_present:
            logger.error(
                "URL validation failed: scheme=%s hostname_present=%s path_present=%s",
                scheme, hostname_present, path_present,
            )
            raise RuntimeError(
                "DATABASE_URL must be a PostgreSQL connection string for the existing Supabase database."
            )
    except Exception as e:
        logger.error("URL validation failed: %s", _sanitize_error_message(str(e)))
        raise

    # ── STAGE 3: Component extraction ─────────────────────────────────
    try:
        components = _extract_url_components(parsed_url)
    except Exception as e:
        logger.error(
            "Component extraction failed at stage 'parsed_url properties': %s",
            _sanitize_error_message(str(e)),
        )
        logger.debug("Component extraction traceback:\n%s", traceback.format_exc())
        raise

    params: Dict[str, Any] = {
        "host": components["host"],
        "port": components["port"],
        "dbname": components["dbname"],
        "connect_timeout": 3,
    }

    if components["user"]:
        params["user"] = components["user"]
    if components["password"]:
        params["password"] = components["password"]

    # Supabase requires SSL. Add sslmode=require unless already present in the URL query string.
    try:
        query_params = parse_qs(parsed_url.query)
    except Exception:
        query_params = {}
    if "sslmode" not in query_params:
        params["sslmode"] = "require"

    return params

def get_pool() -> ThreadedConnectionPool:
    global _pool
    if _pool is None or _pool.closed:
        # ── STAGE 4: Connection parameter resolution ──────────────────
        try:
            params = get_connection_params()
        except Exception:
            # get_connection_params already logged stage-specific diagnostics
            raise

        # ── STAGE 5: ThreadedConnectionPool creation ──────────────────
        try:
            _pool = ThreadedConnectionPool(minconn=1, maxconn=10, **params)
        except Exception as e:
            logger.error(
                "Failed to initialize PostgreSQL pool at stage 'ThreadedConnectionPool': %s",
                _sanitize_error_message(str(e)),
            )
            logger.debug(
                "Pool creation traceback:\n%s",
                traceback.format_exc(),
            )
            logger.debug("Connection params (masked): %s", _mask_connection_params(params))
            raise
    return _pool

class DBConnection:
    """Context manager for pooled PostgreSQL connections."""
    def __init__(self, autocommit: bool = True):
        self.autocommit = autocommit
        self.conn = None

    def __enter__(self):
        pool = get_pool()
        self.conn = pool.getconn()
        self.conn.autocommit = self.autocommit
        return self.conn

    def __exit__(self, exc_type, exc_val, exc_tb):
        if self.conn:
            if not self.autocommit and exc_type is not None:
                try:
                    self.conn.rollback()
                except Exception:
                    pass
            get_pool().putconn(self.conn)

def init_db():
    """
    Idempotent, non-destructive migration ensuring all tables and required columns exist.
    """
    logger.info("Running safe database migrations on the configured PostgreSQL database.")
    with DBConnection(autocommit=True) as conn:
        cur = conn.cursor()

        # 1. users table
        cur.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id VARCHAR(128) PRIMARY KEY,
                email VARCHAR(255) UNIQUE NOT NULL,
                full_name VARCHAR(255) NOT NULL DEFAULT '',
                role VARCHAR(32) NOT NULL DEFAULT 'customer',
                status VARCHAR(32) NOT NULL DEFAULT 'active',
                created_at VARCHAR(64) NOT NULL
            );
        """)

        # 2. notifications table
        cur.execute("""
            CREATE TABLE IF NOT EXISTS notifications (
                id VARCHAR(64) PRIMARY KEY,
                user_id VARCHAR(128) NOT NULL,
                title VARCHAR(255) NOT NULL,
                message TEXT NOT NULL,
                notification_type VARCHAR(64) NOT NULL,
                is_read BOOLEAN NOT NULL DEFAULT FALSE,
                metadata TEXT DEFAULT '{}',
                related_entity_id VARCHAR(128),
                created_at TEXT NOT NULL,
                read_at TEXT
            );
        """)
        # Ensure all columns exist on notifications table
        cur.execute("ALTER TABLE notifications ADD COLUMN IF NOT EXISTS metadata TEXT DEFAULT '{}';")
        cur.execute("ALTER TABLE notifications ADD COLUMN IF NOT EXISTS related_entity_id VARCHAR(128);")
        cur.execute("ALTER TABLE notifications ADD COLUMN IF NOT EXISTS read_at TEXT;")

        # 3. notification_outbox table
        cur.execute("""
            CREATE TABLE IF NOT EXISTS notification_outbox (
                id VARCHAR(64) PRIMARY KEY,
                event_type VARCHAR(64) NOT NULL,
                user_id VARCHAR(128),
                payload TEXT NOT NULL,
                idempotency_key VARCHAR(255) UNIQUE,
                status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
                retry_count INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                processed_at TEXT,
                error TEXT
            );
        """)
        # Ensure all columns exist on notification_outbox
        cur.execute("ALTER TABLE notification_outbox ADD COLUMN IF NOT EXISTS user_id VARCHAR(128);")
        cur.execute("ALTER TABLE notification_outbox ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(255);")
        cur.execute("ALTER TABLE notification_outbox ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0;")
        cur.execute("ALTER TABLE notification_outbox ADD COLUMN IF NOT EXISTS error TEXT;")
        cur.execute("ALTER TABLE notification_outbox ADD COLUMN IF NOT EXISTS processed_at TEXT;")

        # 4. wallets table
        cur.execute("""
            CREATE TABLE IF NOT EXISTS wallets (
                user_id VARCHAR(128) PRIMARY KEY,
                balance NUMERIC(14,2) NOT NULL DEFAULT 0.0,
                currency VARCHAR(16) NOT NULL DEFAULT 'INR',
                low_balance_alert_level VARCHAR(32) NOT NULL DEFAULT 'NORMAL',
                updated_at TEXT NOT NULL
            );
        """)
        cur.execute("ALTER TABLE wallets ADD COLUMN IF NOT EXISTS low_balance_alert_level VARCHAR(32) NOT NULL DEFAULT 'NORMAL';")

        # 5. wallet_transactions table
        cur.execute("""
            CREATE TABLE IF NOT EXISTS wallet_transactions (
                id VARCHAR(64) PRIMARY KEY,
                user_id VARCHAR(128) NOT NULL,
                amount NUMERIC(14,2) NOT NULL,
                balance_after NUMERIC(14,2),
                currency VARCHAR(16) NOT NULL DEFAULT 'INR',
                status VARCHAR(32) NOT NULL DEFAULT 'completed',
                idempotency_key VARCHAR(255),
                description TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
        """)
        cur.execute("ALTER TABLE wallet_transactions ADD COLUMN IF NOT EXISTS balance_after NUMERIC(14,2);")
        cur.execute("ALTER TABLE wallet_transactions ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(255);")
        cur.execute("ALTER TABLE wallet_transactions ADD COLUMN IF NOT EXISTS description TEXT;")
        cur.execute("ALTER TABLE wallet_transactions ADD COLUMN IF NOT EXISTS created_at TEXT NOT NULL DEFAULT '';")
        cur.execute("ALTER TABLE wallet_transactions ADD COLUMN IF NOT EXISTS updated_at TEXT NOT NULL DEFAULT '';")
        cur.execute("ALTER TABLE wallet_transactions ADD COLUMN IF NOT EXISTS transaction_type VARCHAR(32) NOT NULL DEFAULT 'top_up';")
        cur.execute("ALTER TABLE wallet_transactions ADD COLUMN IF NOT EXISTS direction VARCHAR(16) NOT NULL DEFAULT 'credit';")

        # 6. gpu_inventory table
        cur.execute("""
            CREATE TABLE IF NOT EXISTS gpu_inventory (
                id VARCHAR(64) PRIMARY KEY,
                name VARCHAR(128) NOT NULL,
                gpu_model VARCHAR(128) NOT NULL,
                vram VARCHAR(64) NOT NULL,
                region VARCHAR(128) NOT NULL,
                price NUMERIC(10,2) NOT NULL,
                currency VARCHAR(16) NOT NULL DEFAULT 'INR',
                billing_unit VARCHAR(32) NOT NULL DEFAULT 'hr',
                updated_at TEXT NOT NULL
            );
        """)

        # 7. gpu_deployments table
        cur.execute("""
            CREATE TABLE IF NOT EXISTS gpu_deployments (
                id VARCHAR(64) PRIMARY KEY,
                user_id VARCHAR(128) NOT NULL,
                name VARCHAR(128) NOT NULL,
                model VARCHAR(128) NOT NULL,
                gpu VARCHAR(64) NOT NULL,
                vram VARCHAR(64) NOT NULL,
                region VARCHAR(128) NOT NULL,
                hourly_rate NUMERIC(10,2) NOT NULL,
                status VARCHAR(32) NOT NULL DEFAULT 'Provisioning',
                error_message TEXT,
                idempotency_key VARCHAR(255),
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
        """)

        # 8. gpu_maintenance_schedules table
        cur.execute("""
            CREATE TABLE IF NOT EXISTS gpu_maintenance_schedules (
                id VARCHAR(64) PRIMARY KEY,
                cluster_region VARCHAR(128) NOT NULL,
                gpu_model VARCHAR(128),
                window_start TEXT NOT NULL,
                window_end TEXT NOT NULL,
                reason TEXT NOT NULL,
                status VARCHAR(32) NOT NULL DEFAULT 'SCHEDULED',
                scheduled_by VARCHAR(128),
                created_at TEXT NOT NULL
            );
        """)

        # 9. Indexes for performance and isolation
        cur.execute("CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(user_id, is_read);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_outbox_idempotency_key ON notification_outbox(idempotency_key);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_outbox_status ON notification_outbox(status);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_wallet_tx_user_id ON wallet_transactions(user_id);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_gpu_dep_user_id ON gpu_deployments(user_id);")

        logger.info("Safe database migrations completed successfully.")

if __name__ == "__main__":
    init_db()
    print("Database initialization and migration verified successfully!")
