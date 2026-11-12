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
from dotenv import load_dotenv
from sqlalchemy import create_engine, text
from sqlalchemy.orm import declarative_base, sessionmaker, Session
from sqlalchemy.engine import make_url, URL
from sqlalchemy.exc import ArgumentError

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

# Load environment configuration from backend/.env without overriding existing test env vars
BACKEND_DIR = Path(__file__).resolve().parents[1]
load_dotenv(BACKEND_DIR / ".env", override=False)

DATABASE_URL = os.getenv("DATABASE_URL", "")

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
    connect_args = {}
    engine_kwargs = {"pool_pre_ping": True}

    db_url_parsed = _parse_database_url_safe(db_url)

    if db_url_parsed.drivername.startswith("sqlite"):
        connect_args["check_same_thread"] = False
        engine_url = db_url_parsed
    elif "psycopg" in db_url_parsed.drivername:
        connect_args["connect_timeout"] = 5
        engine_kwargs["pool_size"] = 10
        engine_kwargs["max_overflow"] = 20
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
        maint_engine.dispose()
        return True
    except Exception as e:
        logger.error(f"Could not verify/create database: {e}")
        return False


def init_db(target_engine=None):
    """Create all registered tables in the target database."""
    eng = target_engine or engine
    Base.metadata.create_all(bind=eng)
