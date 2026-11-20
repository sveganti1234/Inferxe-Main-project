"""
SQLAlchemy engine, session management, and PostgreSQL database initialization
for the Inferxe Inference API.
"""

import os
import re
import logging
from pathlib import Path
from typing import Generator
from urllib.parse import urlsplit, unquote, parse_qs
import sys as _sys
_GUARD_DIR = str(__import__('pathlib').Path(__file__).resolve().parents[1])  # backend/
if _GUARD_DIR not in _sys.path:
    _sys.path.append(_GUARD_DIR)
from isolation_guard import load_dotenv  # noqa: E402  (tests never load the project .env: isolation_guard.py)
from sqlalchemy import create_engine, text
from sqlalchemy.orm import declarative_base, sessionmaker, Session
from sqlalchemy.engine import make_url, URL

# Configure logger
logger = logging.getLogger("inferxe.database")

def _parse_database_url_safe(db_url: str):
    """Parse DATABASE_URL safely, handling special characters in credentials.

    Uses Python's urlsplit (lenient about credential encoding) combined with
    SQLAlchemy's URL.create() to properly percent-encode all components when
    rendering. This handles passwords containing $, !, @, :, /, ?, #, %, and
    other reserved URL characters without SQLAlchemy URL parsing errors.

    Passwords already percent-encoded (e.g. %21 for !) are URL-decoded first,
    then URL.create() re-encodes them consistently. This is idempotent.
    """
    if not db_url:
        return make_url("sqlite:///:memory:")

    # urlsplit is lenient about credential encoding and splits on the last @,
    # preserving @ characters in passwords. make_url() is stricter and can fail
    # or misparse URLs with unencoded special characters in credentials.
    parsed = urlsplit(db_url)

    # Split userinfo from hostport (splits on last @, preserving @ in passwords)
    netloc = parsed.netloc
    if "@" in netloc:
        userinfo, hostport = netloc.rsplit("@", 1)
    else:
        userinfo = ""
        hostport = netloc

    # Split username:password
    if ":" in userinfo:
        username, password = userinfo.split(":", 1)
    else:
        username = userinfo or None
        password = None

    # URL-decode components (handles already-encoded credentials idempotently)
    username = unquote(username) if username else None
    password = unquote(password) if password else None

    # Split host:port (handle IPv6 addresses in brackets)
    if hostport.startswith("["):
        end = hostport.index("]")
        host = hostport[1:end]
        rest = hostport[end + 1:]
        port = int(rest.lstrip(":")) if rest.startswith(":") else None
    elif ":" in hostport:
        host, port_str = hostport.rsplit(":", 1)
        try:
            port = int(port_str)
        except ValueError:
            host = hostport
            port = None
    else:
        host = hostport
        port = None

    database = unquote(parsed.path.lstrip("/")) if parsed.path else None

    query = None
    if parsed.query:
        query = {k: v[0] if len(v) == 1 else v for k, v in parse_qs(parsed.query).items()}

    return URL.create(
        drivername=parsed.scheme,
        username=username,
        password=password,
        host=host,
        port=port,
        database=database,
        query=query,
    )

# Load environment configuration from backend/.env and root .env without overriding existing test env vars
BACKEND_DIR = Path(__file__).resolve().parents[1]
load_dotenv(BACKEND_DIR / ".env", override=False)
ROOT_DIR = BACKEND_DIR.parent
if (ROOT_DIR / ".env").is_file():
    load_dotenv(ROOT_DIR / ".env", override=False)


def _normalize_optional_database_url(raw_url: str):
    """
    Normalize optional legacy SQLAlchemy DATABASE_URL.
    Returns (effective_url, is_legacy_sql_configured).
    Falls back to an isolated in-memory SQLite URL when blank or placeholder
    so teams using shared Supabase never crash on module import without pgAdmin 4.
    """
    cleaned = (raw_url or "").strip()
    if not cleaned or "YOUR_PASSWORD" in cleaned:
        return "sqlite:///:memory:", False
    if cleaned.startswith("postgres://"):
        cleaned = "postgresql+psycopg2://" + cleaned[len("postgres://"):]
    return cleaned, True


RAW_DATABASE_URL = os.getenv("DATABASE_URL", "")
DATABASE_URL, LEGACY_SQL_CONFIGURED = _normalize_optional_database_url(RAW_DATABASE_URL)

Base = declarative_base()


def get_masked_url(url_str: str) -> str:
    """Mask password in connection URL for safe logging."""
    try:
        url = _parse_database_url_safe(url_str)
        return url.render_as_string(hide_password=True)
    except Exception:
        # Fallback regex masking
        return re.sub(r":([^:@]+)@", ":****@", url_str)


# Initialize SQLAlchemy engine
def create_app_engine(db_url: str = DATABASE_URL):
    effective_url, _ = _normalize_optional_database_url(db_url)
    connect_args = {}
    engine_kwargs = {"pool_pre_ping": True}

    db_url_parsed = _parse_database_url_safe(effective_url)

    if db_url_parsed.drivername.startswith("sqlite"):
        connect_args["check_same_thread"] = False
        engine_url = db_url_parsed
    elif db_url_parsed.get_backend_name() == "postgresql":
        # Covers postgresql://, postgresql+psycopg2:// and postgresql+psycopg:// (plain postgresql:// is psycopg2).
        if db_url_parsed.get_driver_name() in ("psycopg2", "psycopg"):
            connect_args["connect_timeout"] = 5  # libpq option; other drivers name it differently
        # Legacy path only serves startup checks and /health, and shares the Supavisor
        # session-mode pool with the notifications service: hold at most one connection.
        engine_kwargs["pool_size"] = 1
        engine_kwargs["max_overflow"] = 0
        engine_kwargs["pool_timeout"] = 5
        engine_url = db_url_parsed
    else:
        engine_url = db_url_parsed

    return create_engine(
        engine_url,
        connect_args=connect_args,
        **engine_kwargs
    )


engine = create_app_engine(DATABASE_URL) if DATABASE_URL else create_app_engine("sqlite:///:memory:")
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency for yielding database sessions."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def check_database_connection(test_engine=None) -> bool:
    """Check if the database server is reachable using a fast probe."""
    eng = test_engine or engine
    if (test_engine is None or test_engine is engine) and not LEGACY_SQL_CONFIGURED:
        return False
    if eng.url.drivername.startswith("sqlite"):
        try:
            with eng.connect() as conn:
                conn.execute(text("SELECT 1"))
            return True
        except Exception:
            return False

    if "YOUR_PASSWORD" in str(eng.url):
        logger.info("Database URL contains placeholder 'YOUR_PASSWORD'. Please configure your PostgreSQL password in backend/.env.")
        return False

    # Fast TCP port probe before attempting driver connection
    import socket
    host = eng.url.host or "127.0.0.1"
    port = eng.url.port or 5432
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(0.3)
        sock.connect((host, port))
        sock.close()
    except Exception as sock_err:
        logger.debug(f"Database host {host}:{port} unreachable: {sock_err}")
        return False

    try:
        with eng.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception as e:
        logger.warning(f"Database connection check failed: {e}")
        return False


def create_database_if_not_exists(db_url: str = DATABASE_URL) -> bool:
    """
    Connect to PostgreSQL maintenance database (e.g. 'postgres')
    and create the target database if it does not already exist.
    """
    if not db_url or db_url.startswith("sqlite"):
        return True

    try:
        url = _parse_database_url_safe(db_url)
        target_db = url.database
        if not target_db:
            return False

        # Connect to default 'postgres' database
        maint_url = url.set(database="postgres")
        maint_engine = create_engine(
            maint_url,
            isolation_level="AUTOCOMMIT",
            connect_args={"connect_timeout": 5}
        )

        try:
            with maint_engine.connect() as conn:
                result = conn.execute(
                    text("SELECT 1 FROM pg_database WHERE datname = :dbname"),
                    {"dbname": target_db}
                )
                exists = result.scalar() is not None
                if not exists:
                    logger.info(f"Database '{target_db}' does not exist. Creating...")
                    # Note: database names in PostgreSQL CREATE DATABASE cannot be parameterized via bind params
                    # Sanitize target_db name to prevent SQL injection
                    if not re.match(r"^[a-zA-Z0-9_]+$", target_db):
                        raise ValueError(f"Invalid database name: {target_db}")
                    conn.execute(text(f'CREATE DATABASE "{target_db}"'))
                    logger.info(f"Database '{target_db}' created successfully.")
                else:
                    logger.info(f"Database '{target_db}' already exists.")
        finally:
            maint_engine.dispose()  # also on errors (was skipped when the block raised)
        return True
    except Exception as e:
        logger.error(f"Could not verify/create database: {e}")
        return False


def init_db(target_engine=None):
    """Create all registered tables in the target database."""
    eng = target_engine or engine
    if (target_engine is None or target_engine is engine) and not LEGACY_SQL_CONFIGURED:
        return
    Base.metadata.create_all(bind=eng)
    protect_service_tables(eng, list(Base.metadata.tables))


PUBLIC_API_ROLES = ("anon", "authenticated")


def protect_service_tables(eng, tables) -> list:
    """Enable RLS and revoke anon/authenticated privileges on the legacy tables created above (PostgreSQL only).

    On Supabase, new public tables are granted to the PostgREST roles by default; these legacy tables are
    service-only, so they get RLS with no policies (the owning role is exempt; RLS is not FORCED) and no
    public-role privileges. Idempotent: tables already protected are not altered. Failures are logged, not
    raised. Same rules as database/migrations/006_enable_rls_service_only_tables.sql. Returns tables changed."""
    if eng.dialect.name != "postgresql":
        return []
    quote = eng.dialect.identifier_preparer.quote
    changed = []
    with eng.connect() as conn:
        rls_state = dict(conn.execute(text(
            "SELECT c.relname, c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
            "WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relname = ANY(:tables)"
        ), {"tables": list(tables)}).all())
        roles = [r[0] for r in conn.execute(text("SELECT rolname FROM pg_roles WHERE rolname = ANY(:roles)"),
                                            {"roles": list(PUBLIC_API_ROLES)})]
        plan = []
        for table, rls_enabled in sorted(rls_state.items()):
            exposed = [role for role in roles if conn.execute(
                text("SELECT has_table_privilege(:role, :table, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')"),
                {"role": role, "table": f"public.{table}"}).scalar()]
            if not rls_enabled or exposed:
                plan.append((table, rls_enabled, exposed))
    for table, rls_enabled, exposed in plan:
        try:
            with eng.begin() as conn:
                if not rls_enabled:
                    conn.execute(text(f"ALTER TABLE public.{quote(table)} ENABLE ROW LEVEL SECURITY"))
                if exposed:
                    conn.execute(text(f"REVOKE ALL ON TABLE public.{quote(table)} FROM {', '.join(quote(r) for r in exposed)}"))
            changed.append(table)
        except Exception as e:
            logger.error("Could not enable RLS / revoke public access on %s (%s); apply migration 006.",
                         table, type(e).__name__)
    if changed:
        logger.info("Row-level security enabled / public access revoked on: %s", ", ".join(changed))
    return changed
