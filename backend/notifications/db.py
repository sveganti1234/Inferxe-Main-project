"""
Database Connection & Safe Migration Module for Inferxe PostgreSQL
Handles connection pooling, queries with RealDictCursor, and idempotent migrations.
"""

import os
import logging
import math
import threading
import traceback
import weakref
from pathlib import Path
from typing import Dict, Any, List, Optional
from urllib.parse import parse_qs, unquote, urlsplit
import psycopg2
from psycopg2.extensions import TRANSACTION_STATUS_IDLE, TRANSACTION_STATUS_UNKNOWN
from psycopg2 import sql
from psycopg2.pool import PoolError
import sys as _sys
_GUARD_DIR = str(__import__('pathlib').Path(__file__).resolve().parents[1])  # backend/
if _GUARD_DIR not in _sys.path:
    _sys.path.append(_GUARD_DIR)
from isolation_guard import load_dotenv, is_test_process  # noqa: E402  (tests never load the project .env: isolation_guard.py)

ROOT_DIR = Path(__file__).resolve().parents[2]
BACKEND_DIR = ROOT_DIR / "backend"
if (ROOT_DIR / ".env").is_file():
    load_dotenv(ROOT_DIR / ".env", override=False)
if (BACKEND_DIR / ".env").is_file():
    load_dotenv(BACKEND_DIR / ".env", override=False)
logger = logging.getLogger("inferxe.notifications.db")


def _normalize_psycopg2_dsn(raw_url: str) -> str:
    cleaned = (raw_url or "").strip()
    if not cleaned:
        return ""
    if cleaned.startswith("postgresql+psycopg2://"):
        return "postgresql://" + cleaned[len("postgresql+psycopg2://"):]
    if cleaned.startswith("postgres://"):
        return "postgresql://" + cleaned[len("postgres://"):]
    return cleaned


def _is_placeholder_or_empty(dsn: str) -> bool:
    cleaned = (dsn or "").strip()
    return (
        not cleaned
        or "YOUR_PASSWORD" in cleaned
        or "your-project" in cleaned
    )


def _is_local_host_dsn(dsn: str) -> bool:
    try:
        host = (urlsplit(dsn).hostname or "").lower()
        return host in {"localhost", "127.0.0.1", "::1"}
    except ValueError:
        return False


def _resolve_notifications_dsn() -> str:
    """
    Resolve PostgreSQL DSN for notifications/wallet/GPU service in priority order:
      1. Explicit NOTIFICATIONS_DATABASE_URL
      2. Non-local DATABASE_URL (e.g., Supabase Postgres URL in root .env)
      3. Shared SUPABASE_DATABASE_URL (from backend/.env or env)
      4. Fallback DATABASE_URL (e.g., local Postgres if intentionally configured)
    """
    explicit = _normalize_psycopg2_dsn(os.environ.get("NOTIFICATIONS_DATABASE_URL", ""))
    if not _is_placeholder_or_empty(explicit):
        return explicit

    primary_db = _normalize_psycopg2_dsn(os.environ.get("DATABASE_URL", ""))
    if not _is_placeholder_or_empty(primary_db) and not _is_local_host_dsn(primary_db):
        return primary_db

    supabase_db = _normalize_psycopg2_dsn(os.environ.get("SUPABASE_DATABASE_URL", ""))
    if not _is_placeholder_or_empty(supabase_db):
        return supabase_db

    if not _is_placeholder_or_empty(primary_db):
        return primary_db

    return ""


DATABASE_URL = _resolve_notifications_dsn()

try:
    _database_url = urlsplit(DATABASE_URL)
    PG_HOST = _database_url.hostname or "not configured"
    PG_PORT = _database_url.port or 5432
    PG_DB = unquote(_database_url.path.lstrip("/")) or "not configured"
except ValueError:
    PG_HOST = "not configured"
    PG_PORT = 5432
    PG_DB = "not configured"

class DBConfigError(ValueError):
    """A DB_* environment variable is invalid. Raised at import so startup fails clearly."""


def _env_number(name: str, default, cast, minimum, maximum):
    """Read a numeric env var; unset or empty means default, anything invalid raises DBConfigError."""
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        return default
    expected = f"{'an integer' if cast is int else 'a number'} between {minimum} and {maximum}"
    try:
        value = cast(raw.strip())
    except ValueError:
        raise DBConfigError(f"Invalid {name}={raw!r}: expected {expected}.") from None
    if not math.isfinite(value) or not minimum <= value <= maximum:
        raise DBConfigError(f"Invalid {name}={raw!r}: expected {expected}.")
    return value


POOL_SIZE = _env_number("DB_POOL_SIZE", 5, int, 1, 100)
POOL_WAIT_SECONDS = _env_number("DB_POOL_TIMEOUT", 5.0, float, 0.1, 60)
# 0 disables; the maximum is Postgres' limit for statement_timeout.
STATEMENT_TIMEOUT_MS = _env_number("DB_STATEMENT_TIMEOUT_MS", 30000, int, 0, 2147483647)
HEALTH_CHECK_POOL_WAIT_SECONDS = 1.0  # health probes must stay fast even when the pool is saturated
SUPAVISOR_TRANSACTION_PORT = 6543  # session-level SET is unsafe in transaction pooling mode

_pool: Optional["_ConnectionPool"] = None
_pool_lock = threading.Lock()
_timeout_configured: "weakref.WeakSet" = weakref.WeakSet()  # physical connections that already ran SET
_timeout_lock = threading.Lock()  # guards _timeout_configured (WeakSet is not documented thread-safe)

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


def _assert_test_database_allowed(host: Optional[str]) -> None:
    """In test processes (any runner), refuse non-local databases before connecting: libpq opens its own
    sockets, so the Python socket guard (backend/isolation_guard.py) cannot see these connections. The only
    exception is a dedicated remote test database opted into with INFERXE_TEST_DATABASE_ALLOW_REMOTE=1, which
    notifications/tests/live_db_guard.py checks is not a production DSN. Live Supabase mode does not lift it."""
    if not is_test_process():
        return
    if os.environ.get("INFERXE_TEST_DATABASE_ALLOW_REMOTE") == "1":
        return
    if (host or "").strip("[]").lower() in ("localhost", "127.0.0.1", "::1"):
        return
    raise RuntimeError(
        "[test-safety] refusing to connect to a non-local database during tests. Use an isolated local "
        "test database (INFERXE_TEST_DATABASE_URL)."
    )


def get_connection_params() -> Dict[str, Any]:
    dsn = _resolve_notifications_dsn() or DATABASE_URL
    if not dsn:
        raise RuntimeError(
            "SUPABASE_DATABASE_URL (or DATABASE_URL) is required in backend/.env or root .env "
            "pointing to the shared Supabase PostgreSQL connection string."
        )

    # ── STAGE 1: URL parsing ──────────────────────────────────────────
    try:
        parsed_url = urlsplit(dsn)
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
        "connect_timeout": 8,
        # TCP keepalives so idle pooled connections dropped by the network are detected.
        "keepalives": 1,
        "keepalives_idle": 30,
        "keepalives_interval": 10,
        "keepalives_count": 3,
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

class PoolTimeoutError(PoolError):
    """No pooled connection became free within DB_POOL_TIMEOUT seconds (mapped to HTTP 503)."""


def _close_quietly(conn) -> None:
    try:
        conn.close()
    except Exception:
        pass


class _ConnectionPool:
    """Bounded pool: opens connections on demand and keeps returned ones for reuse.

    The semaphore is the capacity, so slots and connections cannot drift apart.
    A connection is handed out only under the lock while the pool is open.
    """

    def __init__(self, size: int, **params):
        self._params = params
        self._idle: List[Any] = []  # LIFO: reuse the most recently used (warmest) connection
        self._in_use: set = set()  # checked-out connections; guards against double/foreign putconn
        self._lock = threading.Lock()
        self._slots = threading.BoundedSemaphore(size)
        self.maxconn = size
        self.closed = False
        self.transaction_mode = str(params.get("port")) == str(SUPAVISOR_TRANSACTION_PORT)

    def getconn(self, timeout: Optional[float] = None):
        wait = POOL_WAIT_SECONDS if timeout is None else timeout
        if not self._slots.acquire(timeout=wait):
            raise PoolTimeoutError("No database connection available.")
        try:
            with self._lock:
                if self.closed:
                    raise PoolError("connection pool is closed")
                while self._idle:
                    conn = self._idle.pop()
                    if not conn.closed:
                        self._in_use.add(conn)
                        return conn
            _assert_test_database_allowed(self._params.get("host"))
            conn = psycopg2.connect(**self._params)  # slow: no lock held
            with self._lock:
                if not self.closed:
                    self._in_use.add(conn)
                    return conn
            # closeall() ran while connecting: never hand out a connection from a closed pool.
            _close_quietly(conn)
            raise PoolError("connection pool is closed")
        except BaseException:
            self._slots.release()
            raise

    def putconn(self, conn, close: bool = False) -> None:
        with self._lock:
            if conn not in self._in_use:
                # Double or foreign putconn: re-pooling would let two requests share one connection.
                raise PoolError("connection is not checked out from this pool")
            self._in_use.discard(conn)
        try:
            keep = not close and not conn.closed
            if keep:
                # Same cleanup psycopg2's pool performs before re-pooling a connection.
                status = conn.info.transaction_status
                if status == TRANSACTION_STATUS_UNKNOWN:
                    keep = False
                elif status != TRANSACTION_STATUS_IDLE:
                    try:
                        conn.rollback()
                    except Exception:
                        keep = False
            with self._lock:
                if keep and not self.closed:
                    self._idle.append(conn)
                    return
            _close_quietly(conn)
        finally:
            self._slots.release()

    def closeall(self) -> None:
        """Close idle connections; in-use ones are closed when their holders return them."""
        with self._lock:
            self.closed = True
            idle, self._idle = self._idle, []
        for conn in idle:
            _close_quietly(conn)


def get_pool() -> "_ConnectionPool":
    global _pool
    with _pool_lock:
        if _pool is None or _pool.closed:
            _pool = None
            # ── STAGE 4: Connection parameter resolution ──────────────────
            try:
                params = get_connection_params()
            except Exception:
                # get_connection_params already logged stage-specific diagnostics
                raise

            # ── STAGE 5: Pool creation (opens no connections) ─────────────
            try:
                pool = _ConnectionPool(POOL_SIZE, **params)
            except Exception as e:
                logger.error(
                    "Failed to initialize PostgreSQL pool: %s",
                    _sanitize_error_message(str(e)),
                )
                logger.debug("Pool creation traceback:\n%s", traceback.format_exc())
                logger.debug("Connection params (masked): %s", _mask_connection_params(params))
                raise
            if pool.transaction_mode and STATEMENT_TIMEOUT_MS:
                logger.warning(
                    "Transaction-mode pooler port detected; skipping session statement_timeout. "
                    "Set it with ALTER ROLE instead."
                )
            _pool = pool
        return _pool


def close_pool() -> None:
    """Close the pool (app shutdown). Requests still in flight finish and close their connection on exit."""
    global _pool
    with _pool_lock:
        if _pool is not None:
            _pool.closeall()
            _pool = None


class DBConnection:
    """Context manager for pooled PostgreSQL connections."""
    def __init__(self, autocommit: bool = True, timeout: Optional[float] = None):
        self.autocommit = autocommit
        self.timeout = timeout  # seconds to wait for a free pooled connection; None = DB_POOL_TIMEOUT
        self.conn = None
        self._pool: Optional[_ConnectionPool] = None

    def __enter__(self):
        self._pool = get_pool()
        conn = self._pool.getconn(timeout=self.timeout)
        self.conn = conn
        try:
            # SET is transactional: run it in autocommit so a later rollback cannot undo it.
            conn.autocommit = True
            if STATEMENT_TIMEOUT_MS and not self._pool.transaction_mode:
                with _timeout_lock:
                    needs_timeout = conn not in _timeout_configured
                if needs_timeout:  # only this request holds conn, so no check-then-set race on it
                    with conn.cursor() as cur:
                        cur.execute("SET statement_timeout = %s", (STATEMENT_TIMEOUT_MS,))
                    with _timeout_lock:
                        _timeout_configured.add(conn)
            conn.autocommit = self.autocommit
            return conn
        except BaseException:
            self._release(close=True)
            raise

    def __exit__(self, exc_type, exc_val, exc_tb):
        if self.conn is None:
            return
        if not self.autocommit and exc_type is not None:
            try:
                self.conn.rollback()
            except Exception:
                pass
        self._release(close=isinstance(exc_val, (psycopg2.OperationalError, psycopg2.InterfaceError)))

    def _release(self, close: bool) -> None:
        conn, self.conn = self.conn, None
        if conn is not None and self._pool is not None:
            self._pool.putconn(conn, close=close)

_UUID_REGEX = r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"


def _column_type(cur, table: str, column: str) -> Optional[str]:
    """information_schema data_type of public.<table>.<column>, or None if the column is missing."""
    cur.execute(
        """
        SELECT data_type FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = %s AND column_name = %s
        """,
        (table, column),
    )
    row = cur.fetchone()
    return row[0] if row else None


# Tables this service creates. All are service-only: Supabase grants new public tables to its PostgREST roles
# (anon, authenticated) by default, so each gets RLS with no policies and loses every privilege of those roles.
# The role this service connects as owns the tables and is exempt (RLS is not FORCED); service_role bypasses RLS.
# Same rules as database/migrations/006_enable_rls_service_only_tables.sql.
SERVICE_ONLY_TABLES = (
    "users", "notifications", "notification_outbox", "wallets", "wallet_transactions",
    "gpu_inventory", "gpu_deployments", "gpu_maintenance_schedules", "workspace_settings",
)
PUBLIC_API_ROLES = ("anon", "authenticated")
_TABLE_PRIVILEGES = "SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER"


def protect_service_tables(cur, tables=SERVICE_ONLY_TABLES) -> List[str]:
    """Enable RLS and revoke anon/authenticated privileges on existing `tables`. Idempotent: only tables that
    need a change are altered (no ALTER TABLE lock on an already protected table). Failures are logged, never
    raised, and are isolated with a savepoint when the cursor is inside a transaction. Returns tables changed."""
    cur.execute(
        "SELECT c.relname, c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
        "WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relname = ANY(%s);",
        (list(tables),),
    )
    rls_state = dict(cur.fetchall())
    cur.execute("SELECT rolname FROM pg_roles WHERE rolname = ANY(%s);", (list(PUBLIC_API_ROLES),))
    roles = [r[0] for r in cur.fetchall()]  # absent on plain PostgreSQL (local/test): nothing to revoke
    in_transaction = not cur.connection.autocommit
    changed = []
    for table, rls_enabled in sorted(rls_state.items()):
        exposed = []
        for role in roles:
            cur.execute("SELECT has_table_privilege(%s, %s, %s);", (role, f"public.{table}", _TABLE_PRIVILEGES))
            if cur.fetchone()[0]:
                exposed.append(role)
        if rls_enabled and not exposed:
            continue
        try:
            if in_transaction:
                cur.execute("SAVEPOINT protect_service_table;")
            if not rls_enabled:
                cur.execute(sql.SQL("ALTER TABLE public.{} ENABLE ROW LEVEL SECURITY;").format(sql.Identifier(table)))
            if exposed:
                cur.execute(sql.SQL("REVOKE ALL ON TABLE public.{} FROM {};").format(
                    sql.Identifier(table), sql.SQL(", ").join(sql.Identifier(r) for r in exposed)))
            if in_transaction:
                cur.execute("RELEASE SAVEPOINT protect_service_table;")
            changed.append(table)
        except psycopg2.Error as e:
            if in_transaction:
                cur.execute("ROLLBACK TO SAVEPOINT protect_service_table;")
            logger.error("Could not enable RLS / revoke public access on %s (%s); apply migration 006.",
                         table, type(e).__name__)
    if changed:
        logger.info("Row-level security enabled / public access revoked on: %s", ", ".join(changed))
    return changed


def init_db():
    """
    Idempotent, non-destructive migration ensuring all tables and required columns exist.
    Fast-paths cleanly when the shared Supabase database already contains all required
    tables, migrated columns, and indexes to avoid redundant DDL roundtrips on reload.
    """
    logger.info("Verifying PostgreSQL schema for notifications/wallet/GPU service...")
    expected_tables = {
        "users",
        "notifications",
        "notification_outbox",
        "wallets",
        "wallet_transactions",
        "gpu_inventory",
        "gpu_deployments",
        "gpu_maintenance_schedules",
    }
    expected_migrated_cols = {
        ("notifications", "metadata"),
        ("notifications", "related_entity_id"),
        ("notifications", "read_at"),
        ("notification_outbox", "user_id"),
        ("notification_outbox", "idempotency_key"),
        ("notification_outbox", "retry_count"),
        ("notification_outbox", "error"),
        ("notification_outbox", "processed_at"),
        ("wallets", "low_balance_alert_level"),
        ("wallet_transactions", "parent_transaction_id"),
        ("wallet_transactions", "refunded_amount"),
        ("wallet_transactions", "source"),
    }
    expected_indexes = {
        "idx_notifications_user_id",
        "idx_notifications_is_read",
        "idx_notifications_created_at",
        "idx_outbox_idempotency_key",
        "idx_outbox_status",
        "idx_wallet_tx_user_id",
        "idx_gpu_dep_user_id",
    }
    expected_fk_constraints = {
        ("wallet_transactions", "fk_wallet_tx_parent"),
    }

    with DBConnection(autocommit=True) as conn:
        cur = conn.cursor()

        try:
            cur.execute(
                """
                SELECT table_name, column_name, data_type, character_maximum_length
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = ANY(%s);
                """,
                (list(expected_tables),),
            )
            col_rows = cur.fetchall()  # fetch once: a second fetchall() returns nothing
            col_pairs = {(r[0], r[1]) for r in col_rows}
            existing_tables = {t for (t, _) in col_pairs}
            col_types = {(r[0], r[1]): (r[2], r[3]) for r in col_rows}

            cur.execute(
                """
                SELECT indexname
                FROM pg_indexes
                WHERE schemaname = 'public'
                  AND indexname = ANY(%s);
                """,
                (list(expected_indexes),),
            )
            existing_indexes = {r[0] for r in cur.fetchall()}

            cur.execute(
                """
                SELECT conrelid::regclass::text, conname
                FROM pg_constraint
                WHERE contype = 'f'
                  AND conname = ANY(%s);
                """,
                ([name for (_, name) in expected_fk_constraints],),
            )
            existing_fks = {(r[0], r[1]) for r in cur.fetchall()} & expected_fk_constraints

            # Verify column types for critical columns
            expected_col_types = {
                ("wallet_transactions", "id"): ("uuid", None),
                ("wallet_transactions", "parent_transaction_id"): ("uuid", None),
                ("wallet_transactions", "refunded_amount"): ("numeric", None),
                ("wallet_transactions", "source"): ("character varying", 32),
            }
            types_match = all(
                col_types.get(k) == v for k, v in expected_col_types.items()
            )

            if (
                expected_tables.issubset(existing_tables)
                and expected_migrated_cols.issubset(col_pairs)
                and expected_indexes.issubset(existing_indexes)
                and expected_fk_constraints.issubset(existing_fks)
                and types_match
            ):
                logger.info("PostgreSQL schema already verified (%d tables ready).", len(existing_tables))
                protect_service_tables(cur)  # no-op when already protected
                return
        except Exception as e:
            logger.warning(
                "Schema fast-path check failed (%s); running full idempotent migration.",
                type(e).__name__,
            )

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
        # Ensure message column exists (schema source of truth). Backfill from detail
        # for databases created before the detail->message rename.
        cur.execute("ALTER TABLE notifications ADD COLUMN IF NOT EXISTS message TEXT DEFAULT '';")
        # Only legacy databases have `detail`; on a fresh one this UPDATE would fail and abort init.
        if _column_type(cur, "notifications", "detail") is not None:
            cur.execute(
                """
                UPDATE notifications
                SET message = detail
                WHERE (message IS NULL OR message = '')
                  AND detail IS NOT NULL
                  AND detail != '';
                """
            )

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
                id UUID PRIMARY KEY,
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
        cur.execute("ALTER TABLE wallet_transactions ADD COLUMN IF NOT EXISTS parent_transaction_id UUID;")
        cur.execute("ALTER TABLE wallet_transactions ADD COLUMN IF NOT EXISTS refunded_amount NUMERIC(14,2) NOT NULL DEFAULT 0;")
        cur.execute("ALTER TABLE wallet_transactions ADD COLUMN IF NOT EXISTS source VARCHAR(32) NOT NULL DEFAULT 'legacy';")

        # Conditionally convert parent_transaction_id from VARCHAR(64) to UUID if needed.
        # Skip (with a warning) when existing values are not valid UUIDs: the cast would fail
        # and abort the remaining migration steps, including index creation.
        parent_type = _column_type(cur, "wallet_transactions", "parent_transaction_id")
        if parent_type is not None and parent_type != "uuid":
            cur.execute(
                """
                SELECT COUNT(*) FROM wallet_transactions
                WHERE parent_transaction_id IS NOT NULL
                  AND parent_transaction_id::text !~* %s
                """,
                (_UUID_REGEX,),
            )
            if cur.fetchone()[0] == 0:
                cur.execute("""
                    ALTER TABLE wallet_transactions
                        ALTER COLUMN parent_transaction_id TYPE UUID
                        USING parent_transaction_id::UUID
                """)
                parent_type = "uuid"
            else:
                logger.warning(
                    "wallet_transactions.parent_transaction_id has non-UUID values; "
                    "skipping UUID conversion and parent FK. Clean the data, then restart."
                )

        # Idempotent self-referential FK: only when both columns are UUID, otherwise
        # ADD CONSTRAINT fails on the type mismatch (legacy VARCHAR ids) and aborts init.
        cur.execute("""
            SELECT 1 FROM information_schema.table_constraints
            WHERE table_schema = 'public'
              AND table_name = 'wallet_transactions'
              AND constraint_name = 'fk_wallet_tx_parent'
              AND constraint_type = 'FOREIGN KEY'
        """)
        if cur.fetchone() is None:
            id_type = _column_type(cur, "wallet_transactions", "id")
            if id_type == "uuid" and parent_type == "uuid":
                cur.execute("""
                    ALTER TABLE wallet_transactions
                        ADD CONSTRAINT fk_wallet_tx_parent
                        FOREIGN KEY (parent_transaction_id)
                        REFERENCES wallet_transactions(id)
                        ON DELETE RESTRICT
                """)
            else:
                logger.warning(
                    "Skipping fk_wallet_tx_parent: wallet_transactions.id is %s and "
                    "parent_transaction_id is %s (both must be uuid).",
                    id_type, parent_type,
                )

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

        protect_service_tables(cur)
        logger.info("Safe database migrations completed successfully.")

if __name__ == "__main__":
    init_db()
    print("Database initialization and migration verified successfully!")
