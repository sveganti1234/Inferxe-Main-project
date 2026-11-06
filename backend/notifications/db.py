"""
Database Connection & Safe Migration Module for Inferxe PostgreSQL
Handles connection pooling, queries with RealDictCursor, and idempotent migrations.
"""

import os
import json
import logging
from typing import Dict, Any, List, Optional
from datetime import datetime, timezone
import psycopg2
from psycopg2.extras import RealDictCursor
from psycopg2.pool import ThreadedConnectionPool
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger("inferxe.notifications.db")

PG_HOST = os.environ.get("POSTGRES_HOST", os.environ.get("DB_HOST", "localhost"))
PG_PORT = int(os.environ.get("POSTGRES_PORT", os.environ.get("DB_PORT", "5432")))
PG_DB = os.environ.get("POSTGRES_DB", os.environ.get("DB_NAME", "inferxe_local"))
PG_USER = os.environ.get("POSTGRES_USER", os.environ.get("DB_USER", "postgres"))
PG_PASSWORD = os.environ.get("POSTGRES_PASSWORD", os.environ.get("DB_PASSWORD", "Manya@8686"))

_pool: Optional[ThreadedConnectionPool] = None

def get_connection_params() -> Dict[str, Any]:
    return {
        "host": PG_HOST,
        "port": PG_PORT,
        "dbname": PG_DB,
        "user": PG_USER,
        "password": PG_PASSWORD,
        "connect_timeout": 3,
    }

def get_pool() -> ThreadedConnectionPool:
    global _pool
    if _pool is None or _pool.closed:
        params = get_connection_params()
        try:
            _pool = ThreadedConnectionPool(minconn=1, maxconn=10, **params)
        except Exception as e:
            logger.error(f"Failed to initialize PostgreSQL pool: {e}")
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
    logger.info(f"Running safe database migrations on {PG_DB} at {PG_HOST}:{PG_PORT}...")
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

