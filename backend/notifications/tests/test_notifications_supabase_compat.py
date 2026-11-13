"""
test_notifications_supabase_compat.py
====================================
Offline unit tests verifying that `backend/notifications` cleanly supports:
1. Shared Supabase PostgreSQL DSN resolution (`SUPABASE_DATABASE_URL`, `DATABASE_URL` schemes).
2. Schema-adaptive `notifications` operations (`uuid` PK, `detail` column vs `message`, `timestamptz`).
3. Schema-adaptive `wallet_transactions` inserts (`uuid` PK, `transaction_type`, `direction`, positive `amount`).
4. Graceful 404 (`KeyError`) when marking/deleting invalid non-UUID IDs against a UUID-backed table.
"""

import os
import sys
import uuid
import unittest
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

ROOT_DIR = Path(__file__).resolve().parents[3]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from backend.notifications import db as notif_db
from backend.notifications import service as notif_service


class _FakeConn:
    autocommit = True


class _SchemaAwareFakeCursor:
    """Minimal cursor double simulating information_schema.columns + captured SQL calls."""

    def __init__(self, table_columns, fetchone_results=None, fetchall_results=None):
        self.table_columns = table_columns
        self.fetchone_results = list(fetchone_results or [])
        self.fetchall_results = list(fetchall_results or [])
        self.executed = []
        self.rowcount = 1
        self.connection = _FakeConn()
        self._last_mode = None

    def execute(self, sql, params=None):
        norm = " ".join(str(sql).split())
        self.executed.append((norm, params))
        if "FROM information_schema.columns" in norm:
            tbl = params[0] if params else ""
            cols = self.table_columns.get(tbl, {})
            self._last_mode = "schema"
            self._schema_rows = [(k, v) for k, v in cols.items()]
        else:
            self._last_mode = "query"

    def fetchall(self):
        if self._last_mode == "schema":
            return list(self._schema_rows)
        if self.fetchall_results:
            return self.fetchall_results.pop(0)
        return []

    def fetchone(self):
        if self.fetchone_results:
            return self.fetchone_results.pop(0)
        return None


class TestNotificationsDatabaseResolution(unittest.TestCase):
    def test_prefers_supabase_database_url_over_localhost_legacy_url(self):
        env = {
            "NOTIFICATIONS_DATABASE_URL": "",
            "DATABASE_URL": "postgresql+psycopg2://postgres:localpass@localhost:5432/inferxe_inference_db",
            "SUPABASE_DATABASE_URL": "postgresql://postgres.proj:secret@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres",
        }
        with patch.dict(os.environ, env, clear=False):
            resolved = notif_db._resolve_notifications_dsn()
        self.assertEqual(
            resolved,
            "postgresql://postgres.proj:secret@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres",
        )

    def test_normalizes_sqlalchemy_and_postgres_schemes(self):
        self.assertEqual(
            notif_db._normalize_psycopg2_dsn("postgresql+psycopg2://u:p@host:5432/db"),
            "postgresql://u:p@host:5432/db",
        )
        self.assertEqual(
            notif_db._normalize_psycopg2_dsn("postgres://u:p@host:5432/db"),
            "postgresql://u:p@host:5432/db",
        )

    def test_uses_non_local_database_url_when_configured(self):
        env = {
            "NOTIFICATIONS_DATABASE_URL": "",
            "DATABASE_URL": "postgres://postgres:pw@db.shared.supabase.co:5432/postgres",
            "SUPABASE_DATABASE_URL": "postgresql://fallback@aws-0.pooler.supabase.com:5432/postgres",
        }
        with patch.dict(os.environ, env, clear=False):
            resolved = notif_db._resolve_notifications_dsn()
        self.assertEqual(resolved, "postgresql://postgres:pw@db.shared.supabase.co:5432/postgres")


class TestNotificationsSupabaseSchemaCompat(unittest.TestCase):
    def setUp(self):
        notif_service.clear_schema_cache()

    def tearDown(self):
        notif_service.clear_schema_cache()

    def test_create_notification_adapts_to_supabase_uuid_and_detail_column(self):
        cur = _SchemaAwareFakeCursor(
            {
                "notifications": {
                    "id": "uuid",
                    "user_id": "text",
                    "title": "text",
                    "detail": "text",
                    "notification_type": "text",
                    "is_read": "boolean",
                    "created_at": "timestamp with time zone",
                    "read_at": "timestamp with time zone",
                    "metadata": "text",
                    "related_entity_id": "character varying",
                }
            }
        )
        nid = notif_service.NotificationService._create_notification_internal(
            cur,
            user_id="cognito-sub-1",
            title="GPU Ready",
            message="Node started",
            notification_type="GPU_DEPLOYMENT",
            metadata={"gpu": "H100"},
            related_entity_id="dep-1",
        )
        # Generated ID must be a valid UUID string
        parsed = uuid.UUID(nid)
        self.assertEqual(str(parsed), nid)

        insert_sql, insert_params = cur.executed[-1]
        self.assertIn("INSERT INTO notifications", insert_sql)
        self.assertIn("detail", insert_sql)
        self.assertNotIn(" message,", insert_sql)
        self.assertIn("Node started", insert_params)

    def test_get_notifications_maps_detail_and_serializes_uuid_and_datetime(self):
        sample_uuid = uuid.uuid4()
        now_dt = datetime(2026, 11, 11, 12, 0, tzinfo=timezone.utc)
        cur = _SchemaAwareFakeCursor(
            {},
            fetchone_results=[{"total": 1}, {"unread": 1}],
            fetchall_results=[
                [
                    {
                        "id": sample_uuid,
                        "user_id": "cognito-sub-1",
                        "title": "Top Up",
                        "detail": "Wallet credited INR 2000",
                        "notification_type": "WALLET_RECHARGE",
                        "is_read": False,
                        "metadata": '{"amount": 2000}',
                        "related_entity_id": "tx-1",
                        "created_at": now_dt,
                        "read_at": None,
                    }
                ]
            ],
        )

        class FakeConnMgr:
            def __init__(self, autocommit=True):
                self._cursor = cur

            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

            def cursor(self, **kwargs):
                return self._cursor

        with patch.object(notif_service, "DBConnection", FakeConnMgr):
            res = notif_service.NotificationService.get_notifications("cognito-sub-1")

        self.assertEqual(res["total"], 1)
        self.assertEqual(res["unread_count"], 1)
        item = res["items"][0]
        self.assertEqual(item["id"], str(sample_uuid))
        self.assertEqual(item["message"], "Wallet credited INR 2000")
        self.assertEqual(item["created_at"], now_dt.isoformat())
        self.assertEqual(item["metadata"], {"amount": 2000})

    def test_mark_as_read_invalid_uuid_raises_key_error_on_uuid_table(self):
        cur = _SchemaAwareFakeCursor({"notifications": {"id": "uuid", "detail": "text"}})

        class FakeConnMgr:
            def __init__(self, autocommit=True):
                self._cursor = cur

            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

            def cursor(self, **kwargs):
                return self._cursor

        with patch.object(notif_service, "DBConnection", FakeConnMgr):
            with self.assertRaises(KeyError):
                notif_service.NotificationService.mark_as_read("notif_not_a_uuid", "user-1")

    def test_wallet_debit_inserts_positive_amount_and_debit_direction_on_supabase(self):
        cur = _SchemaAwareFakeCursor(
            {
                "wallet_transactions": {
                    "id": "uuid",
                    "user_id": "text",
                    "transaction_type": "text",
                    "direction": "text",
                    "amount": "numeric",
                    "balance_after": "numeric",
                    "currency": "character",
                    "status": "text",
                    "idempotency_key": "character varying",
                    "description": "text",
                    "created_at": "timestamp with time zone",
                    "updated_at": "text",
                },
                "notifications": {
                    "id": "uuid",
                    "user_id": "text",
                    "title": "text",
                    "detail": "text",
                    "notification_type": "text",
                    "is_read": "boolean",
                    "created_at": "timestamp with time zone",
                },
            },
            fetchone_results=[{"balance": 500.0, "low_balance_alert_level": "NORMAL"}],
        )

        class FakeConnMgr:
            def __init__(self, autocommit=True):
                self._cursor = cur

            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

            def cursor(self, **kwargs):
                return self._cursor

            def commit(self):
                pass

        with (
            patch.object(notif_service, "DBConnection", FakeConnMgr),
            patch.object(notif_service.NotificationService, "record_outbox_event", return_value=("evt_1", False)),
        ):
            res = notif_service.NotificationService.process_wallet_debit(
                user_id="cognito-sub-1",
                amount=120.0,
                description="GPU compute",
            )

        self.assertEqual(res["status"], "success")
        self.assertEqual(res["remaining_balance"], 380.0)
        uuid.UUID(res["transaction_id"])

        tx_inserts = [
            entry for entry in cur.executed if "INSERT INTO wallet_transactions" in entry[0]
        ]
        self.assertEqual(len(tx_inserts), 1)
        tx_sql, tx_params = tx_inserts[0]
        self.assertIn("'usage_charge', 'debit'", tx_sql)
        # Positive amount required by CHECK (amount > 0)
        self.assertEqual(tx_params[2], 120.0)


if __name__ == "__main__":
    unittest.main()
