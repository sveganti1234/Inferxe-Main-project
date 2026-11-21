"""
Notification Business Logic & Event Outbox Service for Inferxe.
Enforces multi-user isolation, idempotency, wallet thresholds, and deployment lifecycle tracking.
"""

import json
import uuid
import logging
import threading
from typing import Dict, Any, List, Optional, Tuple
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
import psycopg2
from psycopg2.extras import RealDictCursor, execute_values
from .db import DBConnection, protect_service_tables

logger = logging.getLogger("inferxe.notifications.service")

_SCHEMA_CACHE: Dict[str, Dict[str, str]] = {}
_SCHEMA_LOCK = threading.Lock()


def clear_schema_cache() -> None:
    """Clear cached PostgreSQL table column metadata (useful in unit tests)."""
    with _SCHEMA_LOCK:
        _SCHEMA_CACHE.clear()


def _get_table_columns(cur, table_name: str) -> Dict[str, str]:
    """
    Return {column_name: data_type} for public.<table_name>, cached per process.
    Allows runtime queries to adapt cleanly between Supabase and legacy schemas.
    """
    with _SCHEMA_LOCK:
        cached = _SCHEMA_CACHE.get(table_name)
    if cached is not None:
        return cached

    try:
        cur.execute(
            """
            SELECT column_name, data_type
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = %s;
            """,
            (table_name,),
        )
        rows = cur.fetchall() or []
    except Exception:
        return {}

    cols: Dict[str, str] = {}
    for row in rows:
        if isinstance(row, dict):
            col_name = row.get("column_name")
            col_type = row.get("data_type")
        else:
            col_name = row[0] if len(row) > 0 else None
            col_type = row[1] if len(row) > 1 else None
        if col_name:
            cols[str(col_name)] = str(col_type or "")

    if cols:
        with _SCHEMA_LOCK:
            _SCHEMA_CACHE[table_name] = cols
    return cols


def _coerce_uuid_or_not_found(raw_id: str, id_data_type: Optional[str]) -> str:
    """Validate UUID strings before querying Postgres UUID columns."""
    cleaned = str(raw_id or "").strip()
    if not cleaned:
        raise KeyError("Notification not found")
    if id_data_type == "uuid":
        try:
            return str(uuid.UUID(cleaned))
        except ValueError:
            raise KeyError("Notification not found")
    return cleaned


def _serialize_notification_row(row: Dict[str, Any]) -> Dict[str, Any]:
    """Normalize Postgres notification row fields into frontend-compatible JSON primitives."""
    item = dict(row)
    for key, val in list(item.items()):
        if isinstance(val, uuid.UUID):
            item[key] = str(val)
        elif isinstance(val, datetime):
            item[key] = val.isoformat()

    if item.get("message") is None:
        item["message"] = item.get("detail") or ""

    if isinstance(item.get("metadata"), str):
        try:
            item["metadata"] = json.loads(item["metadata"])
        except Exception:
            item["metadata"] = {}
    elif item.get("metadata") is None:
        item["metadata"] = {}

    item["is_read"] = bool(item.get("is_read", False))
    return item


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


_CENT = Decimal("0.01")


def _to_money(amount) -> Decimal:
    """Positive, finite amount as Decimal(…, 2 dp), matching the NUMERIC(14,2) wallet columns."""
    try:
        value = Decimal(str(amount))
    except Exception:
        raise ValueError("Amount must be a number")
    if not value.is_finite():
        raise ValueError("Amount must be a finite number")
    value = value.quantize(_CENT, rounding=ROUND_HALF_UP)  # Postgres NUMERIC rounds half away from zero
    if value <= 0:
        raise ValueError("Amount must be greater than zero")
    return value


def _notification_row(cols, user_id, title, message, notification_type, metadata, related_entity_id):
    """(insert_cols, values) for one notification, adapted to the live notifications schema
    (`detail` in Supabase vs `message` in legacy, uuid vs text ids, optional columns).
    `is_read` is in insert_cols but has no value: callers render it as the literal FALSE."""
    notif_id = str(uuid.uuid4()) if cols.get("id") == "uuid" else f"notif_{uuid.uuid4().hex[:12]}"
    text_cols: List[str] = []
    if "message" in cols or not cols:
        text_cols.append("message")
    if "detail" in cols:
        text_cols.append("detail")
    insert_cols = ["id", "user_id", "title", *text_cols, "notification_type", "is_read"]
    values: List[Any] = [notif_id, user_id, title, *([message] * len(text_cols)), notification_type]
    for col_name, col_val in (
        ("metadata", json.dumps(metadata or {})),
        ("related_entity_id", related_entity_id),
        ("created_at", now_iso()),
    ):
        if not cols or col_name in cols:
            insert_cols.append(col_name)
            values.append(col_val)
    return insert_cols, tuple(values)


DEPLOYMENT_STATUSES = frozenset({"Provisioning", "Running", "Stopped", "Failed", "Terminated"})
# Customers may create (Provisioning), stop or terminate their own deployments; Running/Failed are
# reported by the system/admins. shortcut: there is no real provisioner yet; revisit when one exists.
CUSTOMER_SETTABLE_DEPLOYMENT_STATUSES = frozenset({"Provisioning", "Stopped", "Terminated"})



def _find_deployment(cur, deployment_id: str):
    """Deployment by id, case-insensitively (existing behaviour). The exact match uses the primary-key
    index; UPPER(id) = UPPER(%s) cannot and scans the whole table, so it only runs on a miss."""
    cur.execute("SELECT * FROM gpu_deployments WHERE id = %s;", (deployment_id,))
    row = cur.fetchone()
    if row is None:
        cur.execute("SELECT * FROM gpu_deployments WHERE UPPER(id) = UPPER(%s);", (deployment_id,))
        row = cur.fetchone()
    return row

_WORKSPACE_SETTINGS_DDL = """
    CREATE TABLE IF NOT EXISTS workspace_settings (
        user_id VARCHAR(128) PRIMARY KEY,
        monthly_budget NUMERIC(14,2) NOT NULL DEFAULT 10000.0,
        spending_alerts_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        weekly_report_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        cors_origins TEXT NOT NULL DEFAULT 'https://app.novatech.ai, http://localhost:3000',
        updated_at TEXT NOT NULL
    );
"""
_workspace_table_ready = False
_workspace_table_lock = threading.Lock()


def _ensure_workspace_settings_table(cur) -> None:
    """Run the workspace_settings DDL once per process instead of on every request."""
    global _workspace_table_ready
    if _workspace_table_ready:
        return
    with _workspace_table_lock:
        if not _workspace_table_ready:
            cur.execute(_WORKSPACE_SETTINGS_DDL)
            # `budget_configured` is TRUE only once the customer saved a budget; reading never stores a default.
            # Backfill: a budget other than the old 10000 default can only have come from a save.
            cur.execute("ALTER TABLE workspace_settings ADD COLUMN IF NOT EXISTS budget_configured BOOLEAN NOT NULL DEFAULT FALSE;")
            cur.execute("UPDATE workspace_settings SET budget_configured = TRUE WHERE budget_configured = FALSE AND monthly_budget <> 10000.0;")
            protect_service_tables(cur, ("workspace_settings",))  # service-only, like the init_db tables
            _workspace_table_ready = True


class NotificationService:

    @staticmethod
    def get_unread_count(user_id: str) -> int:
        """Returns the number of unread notifications for the authenticated user."""
        with DBConnection(autocommit=True) as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT COUNT(*) FROM notifications WHERE user_id = %s AND is_read = FALSE;",
                (user_id,)
            )
            row = cur.fetchone()
            return int(row[0]) if row else 0

    @staticmethod
    def get_notifications(
        user_id: str,
        unread_only: bool = False,
        limit: int = 50,
        offset: int = 0
    ) -> Dict[str, Any]:
        """
        Fetches notifications strictly for the authenticated user ID.
        Ensures customer A can NEVER view customer B's notifications.
        """
        with DBConnection(autocommit=True) as conn:
            cur = conn.cursor(cursor_factory=RealDictCursor)

            # Total and unread counts for this user, in one round trip
            cur.execute(
                "SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE is_read = FALSE) AS unread "
                "FROM notifications WHERE user_id = %s;",
                (user_id,),
            )
            counts = cur.fetchone()
            total, unread_count = counts["total"], counts["unread"]

            query = "SELECT * FROM notifications WHERE user_id = %s "
            params: List[Any] = [user_id]

            if unread_only:
                query += "AND is_read = FALSE "

            query += "ORDER BY created_at DESC, id DESC LIMIT %s OFFSET %s;"
            params.extend([limit, offset])

            cur.execute(query, tuple(params))
            rows = cur.fetchall()

            # Parse JSON metadata and normalize detail/message + UUID/timestamptz types
            items = [_serialize_notification_row(r) for r in rows]

            return {
                "total": total,
                "unread_count": unread_count,
                "items": items,
            }

    @staticmethod
    def mark_as_read(notification_id: str, user_id: str) -> Dict[str, Any]:
        """
        Marks a notification as read, ensuring it belongs exclusively to the calling user.
        Raises PermissionError if another customer attempts cross-user access.
        """
        with DBConnection(autocommit=True) as conn:
            cur = conn.cursor(cursor_factory=RealDictCursor)
            cols = _get_table_columns(cur, "notifications")
            normalized_id = _coerce_uuid_or_not_found(notification_id, cols.get("id"))

            # One round trip on success: ownership is part of the UPDATE. Only a miss needs the lookup
            # that tells "not found" (404) from "someone else's" (403).
            read_time = now_iso()
            cur.execute(
                "UPDATE notifications SET is_read = TRUE, read_at = %s WHERE id = %s AND user_id = %s RETURNING id, is_read, read_at;",
                (read_time, normalized_id, user_id)
            )
            updated = cur.fetchone()
            if not updated:
                cur.execute("SELECT user_id FROM notifications WHERE id = %s;", (normalized_id,))
                row = cur.fetchone()
                if not row:
                    raise KeyError("Notification not found")
                logger.warning(f"Cross-user mark-read blocked: User {user_id} tried to read notification {normalized_id} of user {row['user_id']}")
                raise PermissionError("Access forbidden: Cannot modify notifications of another user")
            result = dict(updated)
            if isinstance(result.get("id"), uuid.UUID):
                result["id"] = str(result["id"])
            if isinstance(result.get("read_at"), datetime):
                result["read_at"] = result["read_at"].isoformat()
            return result

    @staticmethod
    def mark_all_as_read(user_id: str) -> int:
        """Marks all unread notifications for the authenticated user as read."""
        with DBConnection(autocommit=True) as conn:
            cur = conn.cursor()
            read_time = now_iso()
            cur.execute(
                "UPDATE notifications SET is_read = TRUE, read_at = %s WHERE user_id = %s AND is_read = FALSE;",
                (read_time, user_id)
            )
            return cur.rowcount

    @staticmethod
    def delete_notification(notification_id: str, user_id: str) -> bool:
        """Deletes a notification, ensuring it belongs to the authenticated user."""
        with DBConnection(autocommit=True) as conn:
            cur = conn.cursor(cursor_factory=RealDictCursor)
            cols = _get_table_columns(cur, "notifications")
            normalized_id = _coerce_uuid_or_not_found(notification_id, cols.get("id"))

            # One round trip on success; the lookup runs only to tell 404 from 403 on a miss.
            cur.execute("DELETE FROM notifications WHERE id = %s AND user_id = %s RETURNING id;", (normalized_id, user_id))
            if cur.fetchone():
                return True
            cur.execute("SELECT user_id FROM notifications WHERE id = %s;", (normalized_id,))
            row = cur.fetchone()
            if not row:
                raise KeyError("Notification not found")
            logger.warning(f"Cross-user delete blocked: User {user_id} tried to delete notification {normalized_id} of user {row['user_id']}")
            raise PermissionError("Access forbidden: Cannot delete notifications of another user")

    # ── Notification Outbox & Event Generation ──

    @staticmethod
    def _create_notification_internal(
        cur,
        user_id: str,
        title: str,
        message: str,
        notification_type: str,
        metadata: Optional[Dict[str, Any]] = None,
        related_entity_id: Optional[str] = None
    ) -> str:
        """Inserts a notification record using an active cursor across Supabase or legacy schemas."""
        cols = _get_table_columns(cur, "notifications")
        insert_cols, row = _notification_row(cols, user_id, title, message, notification_type, metadata, related_entity_id)
        placeholders = ["FALSE" if c == "is_read" else "%s" for c in insert_cols]
        sql = (
            f"INSERT INTO notifications ({', '.join(insert_cols)}) "
            f"VALUES ({', '.join(placeholders)}) RETURNING id;"
        )
        cur.execute(sql, row)
        return row[0]

    @classmethod
    def _broadcast_notifications(
        cls,
        cur,
        user_ids: List[str],
        title: str,
        message: str,
        notification_type: str,
        metadata: Optional[Dict[str, Any]] = None,
        related_entity_id: Optional[str] = None,
    ) -> int:
        """Insert one notification per user; returns how many were created.

        Fast path: a single multi-row INSERT (1 round trip instead of 3 per user). If any user has no
        matching profile row (FK violation 23503), the batch is rolled back to its savepoint and the
        per-user path runs, which skips exactly those users, as before. Other errors propagate.
        """
        if not user_ids:
            return 0
        cols = _get_table_columns(cur, "notifications")
        rows = [_notification_row(cols, uid, title, message, notification_type, metadata, related_entity_id)
                for uid in user_ids]
        insert_cols = rows[0][0]
        template = "(" + ", ".join("FALSE" if c == "is_read" else "%s" for c in insert_cols) + ")"
        in_tx = not getattr(cur.connection, "autocommit", True)
        if in_tx:
            cur.execute("SAVEPOINT sp_broadcast_batch;")
        try:
            execute_values(
                cur,
                f"INSERT INTO notifications ({', '.join(insert_cols)}) VALUES %s",
                [values for _, values in rows],
                template=template,
                page_size=500,
            )
        except psycopg2.IntegrityError as exc:
            if in_tx:
                cur.execute("ROLLBACK TO SAVEPOINT sp_broadcast_batch;")
            if getattr(exc, "pgcode", None) != "23503":
                raise
            created = 0
            for uid in user_ids:
                if cls._create_notification_in_broadcast(
                    cur,
                    user_id=uid,
                    title=title,
                    message=message,
                    notification_type=notification_type,
                    metadata=metadata,
                    related_entity_id=related_entity_id,
                ):
                    created += 1
            return created
        except Exception:
            if in_tx:
                cur.execute("ROLLBACK TO SAVEPOINT sp_broadcast_batch;")
            raise
        if in_tx:
            cur.execute("RELEASE SAVEPOINT sp_broadcast_batch;")
        return len(user_ids)

    @classmethod
    def _notify_owner(cls, cur, **kwargs) -> Optional[str]:
        """Notification side effect of a wallet/deployment transaction.

        If notifications.user_id has an FK to profiles (as the Supabase schema may) and the user has no
        profile row, only the notification is skipped (FK error 23503, logged) instead of aborting and
        rolling back the money/deployment change. Any other error still propagates.
        """
        nid = cls._create_notification_in_broadcast(cur, **kwargs)
        if nid is None:
            logger.warning("Notification skipped for user '%s': no matching profile row (FK 23503).", kwargs.get("user_id"))
        return nid

    @classmethod
    def _create_notification_in_broadcast(
        cls,
        cur,
        user_id: str,
        title: str,
        message: str,
        notification_type: str,
        metadata: Optional[Dict[str, Any]] = None,
        related_entity_id: Optional[str] = None,
    ) -> Optional[str]:
        """Insert broadcast notification safely using a SAVEPOINT so stale user IDs do not abort batch transactions."""
        sp_name = f"sp_notif_{uuid.uuid4().hex[:8]}"
        in_tx = not getattr(cur.connection, "autocommit", True)
        if in_tx:
            cur.execute(f"SAVEPOINT {sp_name};")
        try:
            nid = cls._create_notification_internal(
                cur,
                user_id=user_id,
                title=title,
                message=message,
                notification_type=notification_type,
                metadata=metadata,
                related_entity_id=related_entity_id,
            )
            if in_tx:
                cur.execute(f"RELEASE SAVEPOINT {sp_name};")
            return nid
        except Exception as exc:
            if in_tx:
                cur.execute(f"ROLLBACK TO SAVEPOINT {sp_name};")
            pgcode = getattr(exc, "pgcode", None)
            if pgcode == "23503":
                logger.debug("Skipped broadcast notification for user '%s' (no matching profile row).", user_id)
                return None
            raise

    @classmethod
    def record_outbox_event(
        cls,
        event_type: str,
        payload: Dict[str, Any],
        idempotency_key: Optional[str] = None,
        user_id: Optional[str] = None,
        cur=None,
    ) -> Tuple[str, bool]:
        """
        Records an event into notification_outbox with idempotency check.
        Returns (event_id, is_duplicate).

        If `cur` is provided, uses that cursor within the caller's transaction
        (no separate connection opened). Otherwise opens its own autocommit
        connection for backward compatibility with non-wallet callers.
        """
        evt_id = f"evt_{uuid.uuid4().hex[:12]}"
        created_time = now_iso()
        payload_str = json.dumps(payload)

        def _record_with_cursor(c):
            if idempotency_key:
                c.execute(
                    "SELECT id, status FROM notification_outbox WHERE idempotency_key = %s;",
                    (idempotency_key,)
                )
                existing = c.fetchone()
                if existing:
                    logger.info(f"Duplicate outbox event skipped for idempotency key '{idempotency_key}'")
                    return existing["id"], True

            # Inside a caller's transaction, a failed INSERT aborts the whole transaction, so the
            # duplicate lookup below would fail too (500 instead of "skipped"). A savepoint lets us
            # undo just the INSERT. In autocommit mode there is no transaction to protect.
            in_tx = not c.connection.autocommit
            if in_tx:
                c.execute("SAVEPOINT outbox_insert;")
            try:
                c.execute(
                    """
                    INSERT INTO notification_outbox (id, event_type, user_id, payload, idempotency_key, status, retry_count, created_at)
                    VALUES (%s, %s, %s, %s, %s, 'PROCESSED', 0, %s)
                    RETURNING id;
                    """,
                    (evt_id, event_type, user_id, payload_str, idempotency_key, created_time)
                )
            except psycopg2.IntegrityError:
                if in_tx:
                    c.execute("ROLLBACK TO SAVEPOINT outbox_insert;")
                # Concurrent duplicate: another transaction inserted same idempotency_key
                c.execute(
                    "SELECT id, status FROM notification_outbox WHERE idempotency_key = %s;",
                    (idempotency_key,)
                )
                existing = c.fetchone()
                if existing:
                    return existing["id"], True
                raise
            if in_tx:
                c.execute("RELEASE SAVEPOINT outbox_insert;")

            return evt_id, False

        if cur is not None:
            return _record_with_cursor(cur)

        with DBConnection(autocommit=True) as conn:
            cur = conn.cursor(cursor_factory=RealDictCursor)
            return _record_with_cursor(cur)

    # ── Notification Scenarios ──

    @classmethod
    def process_gpu_price_update(
        cls,
        admin_user_id: str,
        gpu_id: str,
        new_price: float,
        idempotency_key: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Scenario A: Admin updates GPU price.
        - Updates GPU price in database.
        - Identifies eligible customers.
        - Generates GPU_PRICE_UPDATE notifications for customers.
        - Generates SYSTEM_ALERT audit notifications for admins.
        """
        idem_key = idempotency_key or f"gpu_price_{gpu_id}_{new_price}_{int(datetime.now().timestamp())}"
        evt_id, is_duplicate = cls.record_outbox_event(
            event_type="GPU_PRICE_UPDATE",
            payload={"admin_user_id": admin_user_id, "gpu_id": gpu_id, "new_price": new_price},
            idempotency_key=idem_key,
            user_id=admin_user_id
        )
        if is_duplicate:
            return {"status": "skipped", "message": "Duplicate price update event ignored.", "event_id": evt_id}

        with DBConnection(autocommit=False) as conn:
            cur = conn.cursor(cursor_factory=RealDictCursor)

            # Get current GPU info
            cur.execute("SELECT id, name, price, region FROM gpu_inventory WHERE id = %s;", (gpu_id,))
            gpu = cur.fetchone()
            if not gpu:
                # If not found in inventory, check if default NVIDIA H100
                gpu = {"id": gpu_id, "name": "NVIDIA H100 SXM5", "price": 250.0, "region": "Mumbai, IN"}
                cur.execute(
                    """
                    INSERT INTO gpu_inventory (id, name, gpu_model, vram, region, price, currency, billing_unit, updated_at)
                    VALUES (%s, %s, %s, %s, %s, %s, 'INR', 'hr', %s)
                    ON CONFLICT (id) DO UPDATE SET price = EXCLUDED.price, updated_at = EXCLUDED.updated_at;
                    """,
                    (gpu_id, gpu["name"], "H100", "80 GB", gpu["region"], new_price, now_iso())
                )
            else:
                old_price = float(gpu["price"])
                if old_price == float(new_price):
                    conn.commit()
                    return {"status": "noop", "message": "Price is identical. No notifications sent.", "old_price": old_price, "new_price": new_price}

                cur.execute(
                    "UPDATE gpu_inventory SET price = %s, updated_at = %s WHERE id = %s;",
                    (new_price, now_iso(), gpu_id)
                )

            old_price = float(gpu["price"])
            gpu_name = gpu["name"]

            # Price increase or decrease
            event_type = "GPU_PRICE_INCREASE" if new_price > old_price else "GPU_PRICE_DECREASE"
            title = "GPU Price Updated"
            message = (
                f"The {gpu_name} hourly price has changed from ₹{old_price:,.0f} to ₹{new_price:,.0f}. "
                f"Check the updated pricing."
            )
            meta = {
                "gpu_id": gpu_id,
                "gpu_name": gpu_name,
                "old_price": old_price,
                "new_price": float(new_price),
                "admin_user_id": admin_user_id,
            }

            # Find all active registered customers
            cur.execute("SELECT id FROM users WHERE role = 'customer' AND status = 'active';")
            customers = [r["id"] for r in cur.fetchall()]
            if not customers:
                # Fallback to demo customer if users table empty
                customers = ["usr_demo_customer"]

            cust_created = cls._broadcast_notifications(
                cur,
                customers,
                title=title,
                message=message,
                notification_type=event_type,
                metadata=meta,
                related_entity_id=gpu_id,
            )

            # Find active admins for audit trail
            cur.execute("SELECT id FROM users WHERE role = 'admin' AND status = 'active';")
            admins = [r["id"] for r in cur.fetchall()]
            if not admins:
                admins = [admin_user_id]
            elif admin_user_id not in admins:
                admins.append(admin_user_id)

            admin_audit_msg = (
                f"Admin {admin_user_id} updated {gpu_name} price from ₹{old_price:,.0f} to ₹{new_price:,.0f}/hr. "
                f"Broadcast delivered to {cust_created} registered customer(s)."
            )
            admin_created = cls._broadcast_notifications(
                cur,
                admins,
                title="GPU Price Audit Alert",
                message=admin_audit_msg,
                notification_type="GPU_PRICE_AUDIT",
                metadata=meta,
                related_entity_id=gpu_id,
            )

            conn.commit()

            return {
                "status": "success",
                "message": f"Updated {gpu_name} price to ₹{new_price:,.0f}",
                "old_price": old_price,
                "new_price": float(new_price),
                "notifications_created": cust_created,
                "admin_notifications_created": admin_created,
            }

    @classmethod
    def process_wallet_recharge(
        cls,
        user_id: str,
        amount: float,
        idempotency_key: Optional[str] = None,
        admin_credit: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Scenario B: Money is added to a wallet (administrator credit).
        `admin_credit` ({administrator_email, reason}) makes this an audited administrator credit:
        the target must be an existing customer profile, the transaction is labelled with the
        reason, and an audit_logs row is written in the same database transaction.
        - Validates idempotency.
        - Updates wallet balance atomically.
        - Creates wallet transaction record.
        - Creates WALLET_RECHARGE notification with updated balance.
        All operations run in a single database transaction; if any step
        fails, the entire transaction (including the outbox event) rolls back.
        """
        try:
            amount = _to_money(amount)  # rejects NaN/inf/<=0; Decimal arithmetic below
        except ValueError:
            raise ValueError("Recharge amount must be greater than zero") from None

        # Fallback key uses the exact amount: int(amount) made different amounts collide.
        idem_key = idempotency_key or f"wallet_recharge_{user_id}_{amount}_{int(datetime.now().timestamp())}"

        with DBConnection(autocommit=False) as conn:
            cur = conn.cursor(cursor_factory=RealDictCursor)

            # Outbox idempotency check + insert in SAME transaction as wallet update
            evt_id, is_duplicate = cls.record_outbox_event(
                event_type="WALLET_RECHARGE",
                payload={"user_id": user_id, "amount": float(amount)},
                idempotency_key=idem_key,
                user_id=user_id,
                cur=cur,
            )
            if is_duplicate:
                conn.rollback()
                return {"status": "skipped", "message": "Duplicate wallet recharge event ignored."}

            if admin_credit is not None:
                cur.execute("SELECT role FROM profiles WHERE user_id = %s;", (user_id,))
                target = cur.fetchone()
                if not target or target.get("role") != "customer":
                    conn.rollback()
                    raise ValueError("Customer profile was not found.")

            cur.execute("SELECT balance, low_balance_alert_level FROM wallets WHERE user_id = %s FOR UPDATE;", (user_id,))
            wallet = cur.fetchone()

            if not wallet:
                curr_balance = Decimal("0")
                new_balance = amount
                cur.execute(
                    """
                    INSERT INTO wallets (user_id, balance, currency, low_balance_alert_level, updated_at)
                    VALUES (%s, %s, 'INR', 'NORMAL', %s);
                    """,
                    (user_id, new_balance, now_iso())
                )
            else:
                curr_balance = Decimal(str(wallet["balance"]))
                new_balance = curr_balance + amount
                new_alert_level = "NORMAL" if new_balance > 100 else wallet["low_balance_alert_level"]
                cur.execute(
                    """
                    UPDATE wallets 
                    SET balance = %s, low_balance_alert_level = %s, updated_at = %s 
                    WHERE user_id = %s;
                    """,
                    (new_balance, new_alert_level, now_iso(), user_id)
                )

            tx_cols = _get_table_columns(cur, "wallet_transactions")
            tx_id = str(uuid.uuid4()) if tx_cols.get("id") == "uuid" else f"tx_{uuid.uuid4().hex[:10]}"
            tx_now = now_iso()
            tx_description = f"Administrator credit: {admin_credit['reason']}"[:500] if admin_credit else "Demo top-up (no payment collected)"
            if "direction" in tx_cols and "transaction_type" in tx_cols:
                cur.execute(
                    """
                    INSERT INTO wallet_transactions (id, user_id, transaction_type, direction, amount, balance_after, currency, status, idempotency_key, description, created_at, updated_at, source)
                    VALUES (%s, %s, 'top_up', 'credit', %s, %s, 'INR', 'completed', %s, %s, %s, %s, 'customer');
                    """,
                    (tx_id, user_id, amount, new_balance, idem_key, tx_description, tx_now, tx_now)
                )
            else:
                cur.execute(
                    """
                    INSERT INTO wallet_transactions (id, user_id, amount, balance_after, currency, status, idempotency_key, description, created_at, updated_at, source)
                    VALUES (%s, %s, %s, %s, 'INR', 'completed', %s, %s, %s, %s, 'customer');
                    """,
                    (tx_id, user_id, amount, new_balance, idem_key, tx_description, tx_now, tx_now)
                )

            if admin_credit is not None:
                cur.execute(
                    """
                    INSERT INTO audit_logs (action, target_type, target_id, details)
                    VALUES ('admin.wallet.credited', 'wallet', %s, %s::jsonb);
                    """,
                    (user_id, json.dumps({
                        "administrator_email": admin_credit["administrator_email"],
                        "reason": admin_credit["reason"],
                        "amount": float(amount),
                        "currency": "INR",
                        "transaction_id": tx_id,
                        "balance_before": float(curr_balance),  # Decimal is not JSON-serialisable
                        "balance_after": float(new_balance),
                        "idempotency_key": idem_key,
                    }))
                )

            title = "Wallet Recharge Successful"
            message = f"₹{amount:,.0f} has been successfully added to your wallet. Updated balance: ₹{new_balance:,.0f}."
            cls._notify_owner(
                cur,
                user_id=user_id,
                title=title,
                message=message,
                notification_type="WALLET_RECHARGE_SUCCESS",
                metadata={"amount": float(amount), "balance": float(new_balance), "transaction_id": tx_id},
                related_entity_id=tx_id
            )

            conn.commit()

            return {
                "status": "success",
                "transaction_id": tx_id,
                "amount": float(amount),
                "new_balance": float(new_balance),
            }

    @classmethod
    def process_wallet_debit(
        cls,
        user_id: str,
        amount: float,
        description: str = "GPU compute usage",
        idempotency_key: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Scenario C & D: Customer spends wallet balance.
        - Deducts wallet balance atomically.
        - Records transaction.
        - Sends WALLET_DEBIT notification.
        - Evaluates Warning (<= 100) and Critical (<= 25) thresholds with state machine:
          only alerts when entering a new alert tier!
        All operations run in a single database transaction; if any step
        fails, the entire transaction (including the outbox event) rolls back.
        """
        try:
            amount = _to_money(amount)  # rejects NaN/inf/<=0; Decimal arithmetic below
        except ValueError:
            raise ValueError("Debit amount must be greater than zero") from None

        # Fallback key uses the exact amount: int(amount) made different amounts collide.
        idem_key = idempotency_key or f"wallet_debit_{user_id}_{amount}_{int(datetime.now().timestamp())}"

        with DBConnection(autocommit=False) as conn:
            cur = conn.cursor(cursor_factory=RealDictCursor)

            # Outbox idempotency check + insert in SAME transaction as wallet update
            evt_id, is_duplicate = cls.record_outbox_event(
                event_type="WALLET_DEBIT",
                payload={"user_id": user_id, "amount": float(amount), "description": description},
                idempotency_key=idem_key,
                user_id=user_id,
                cur=cur,
            )
            if is_duplicate:
                conn.rollback()
                return {"status": "skipped", "message": "Duplicate wallet debit event ignored."}

            cur.execute("SELECT balance, low_balance_alert_level FROM wallets WHERE user_id = %s FOR UPDATE;", (user_id,))
            wallet = cur.fetchone()
            if not wallet or Decimal(str(wallet["balance"])) < amount:
                conn.rollback()
                raise ValueError("Insufficient wallet balance for this transaction")

            curr_balance = Decimal(str(wallet["balance"]))
            new_balance = curr_balance - amount
            curr_alert_level = wallet.get("low_balance_alert_level") or "NORMAL"

            # Determine new alert tier
            new_alert_level = curr_alert_level
            threshold_alert_needed = False
            threshold_title = ""
            threshold_msg = ""

            if new_balance <= 25.0:
                if curr_alert_level != "CRITICAL":
                    new_alert_level = "CRITICAL"
                    threshold_alert_needed = True
                    threshold_title = "Critical Wallet Balance Alert"
                    threshold_msg = f"Your wallet balance is critically low at ₹{new_balance:,.0f}. Active workloads may be suspended soon. Please recharge immediately."
            elif new_balance <= 100.0:
                if curr_alert_level not in ("WARNING", "CRITICAL"):
                    new_alert_level = "WARNING"
                    threshold_alert_needed = True
                    threshold_title = "Low Wallet Balance Warning"
                    threshold_msg = f"Your wallet balance is low at ₹{new_balance:,.0f}. Please top up your wallet to ensure uninterrupted GPU compute."
            else:
                new_alert_level = "NORMAL"

            cur.execute(
                """
                UPDATE wallets 
                SET balance = %s, low_balance_alert_level = %s, updated_at = %s 
                WHERE user_id = %s;
                """,
                (new_balance, new_alert_level, now_iso(), user_id)
            )

            tx_cols = _get_table_columns(cur, "wallet_transactions")
            tx_id = str(uuid.uuid4()) if tx_cols.get("id") == "uuid" else f"tx_{uuid.uuid4().hex[:10]}"
            tx_now = now_iso()
            if "direction" in tx_cols and "transaction_type" in tx_cols:
                cur.execute(
                    """
                    INSERT INTO wallet_transactions (id, user_id, transaction_type, direction, amount, balance_after, currency, status, idempotency_key, description, created_at, updated_at, source)
                    VALUES (%s, %s, 'usage_charge', 'debit', %s, %s, 'INR', 'completed', %s, %s, %s, %s, 'customer');
                    """,
                    (tx_id, user_id, amount, new_balance, idem_key, description, tx_now, tx_now)
                )
            else:
                cur.execute(
                    """
                    INSERT INTO wallet_transactions (id, user_id, amount, balance_after, currency, status, idempotency_key, description, created_at, updated_at, source)
                    VALUES (%s, %s, %s, %s, 'INR', 'completed', %s, %s, %s, %s, 'customer');
                    """,
                    (tx_id, user_id, -amount, new_balance, idem_key, description, tx_now, tx_now)
                )

            # Standard Debit notification
            cls._notify_owner(
                cur,
                user_id=user_id,
                title="Wallet Transaction Successful",
                message=f"₹{amount:,.0f} has been deducted from your wallet. Remaining balance: ₹{new_balance:,.0f}.",
                notification_type="WALLET_DEBIT",
                metadata={"amount": float(amount), "remaining_balance": float(new_balance), "transaction_id": tx_id},
                related_entity_id=tx_id
            )

            # Threshold transition alert if entered new tier
            if threshold_alert_needed:
                cls._notify_owner(
                    cur,
                    user_id=user_id,
                    title=threshold_title,
                    message=threshold_msg,
                    notification_type="LOW_WALLET_BALANCE",
                    metadata={"balance": float(new_balance), "tier": new_alert_level},
                    related_entity_id=tx_id
                )

            conn.commit()

            return {
                "status": "success",
                "transaction_id": tx_id,
                "amount": float(amount),
                "remaining_balance": float(new_balance),
                "low_balance_alert": threshold_alert_needed,
            }

    @classmethod
    def process_wallet_refund(
        cls,
        user_id: str,
        original_transaction_id: str,
        amount: Decimal,
        idempotency_key: Optional[str] = None,
        description: Optional[str] = "Wallet refund",
    ) -> Dict[str, Any]:
        """
        Scenario E: Customer refunds a prior wallet debit.
        - Derives user_id strictly from authenticated Cognito JWT (never from request).
        - Locks wallets row FIRST, then original wallet_transactions row (consistent deadlock-free order).
        - Verifies original transaction belongs to the same user.
        - Verifies original transaction is usage_charge/debit (eligible for refund).
        - Verifies refund does not exceed remaining refundable amount (amount - refunded_amount).
        - Updates wallet balance, increments refunded_amount on original tx, inserts refund transaction.
        - All operations atomic in a single autocommit=False transaction.
        """
        if amount <= 0:
            raise ValueError("Refund amount must be greater than zero")

        # Quantize to 2 decimal places to match NUMERIC(14,2)
        amount = amount.quantize(Decimal("0.01"))

        idem_key = idempotency_key or f"wallet_refund_{user_id}_{original_transaction_id}_{int(datetime.now().timestamp())}"

        with DBConnection(autocommit=False) as conn:
            cur = conn.cursor(cursor_factory=RealDictCursor)

            # Outbox idempotency check + insert in SAME transaction as wallet update
            evt_id, is_duplicate = cls.record_outbox_event(
                event_type="WALLET_REFUND",
                payload={
                    "user_id": user_id,
                    "original_transaction_id": original_transaction_id,
                    "amount": str(amount),
                },
                idempotency_key=idem_key,
                user_id=user_id,
                cur=cur,
            )
            if is_duplicate:
                conn.rollback()
                return {"status": "skipped", "message": "Duplicate wallet refund event ignored."}

            # Lock wallet row FIRST (consistent with recharge/debit lock order)
            cur.execute("SELECT balance, currency FROM wallets WHERE user_id = %s FOR UPDATE;", (user_id,))
            wallet = cur.fetchone()
            if not wallet:
                conn.rollback()
                raise ValueError("Wallet not found for user")

            wallet_currency = str(wallet["currency"])

            # Lock original transaction row SECOND (same order as recharge/debit: wallets first, then tx)
            # A malformed id would raise a psycopg2 DataError (500) against a UUID column; it is a 400.
            if _get_table_columns(cur, "wallet_transactions").get("id") == "uuid":
                try:
                    uuid.UUID(str(original_transaction_id))
                except ValueError:
                    conn.rollback()
                    raise ValueError("Original transaction not found or does not belong to this user") from None

            cur.execute(
                """
                SELECT id, user_id, amount, currency, transaction_type, direction, refunded_amount
                FROM wallet_transactions
                WHERE id = %s AND user_id = %s
                FOR UPDATE;
                """,
                (original_transaction_id, user_id),
            )
            original_tx = cur.fetchone()
            if not original_tx:
                conn.rollback()
                raise ValueError("Original transaction not found or does not belong to this user")

            # Verify original transaction is a debit eligible for refund
            if str(original_tx["transaction_type"]) != "usage_charge" or str(original_tx["direction"]) != "debit":
                conn.rollback()
                raise ValueError("Only usage_charge (debit) transactions are eligible for refund")

            # Verify currency match
            if str(original_tx["currency"]) != wallet_currency:
                conn.rollback()
                raise ValueError("Currency mismatch between wallet and original transaction")

            # Verify refundable amount: original_amount - refunded_amount >= refund_amount
            original_amount = Decimal(str(original_tx["amount"]))
            already_refunded = Decimal(str(original_tx.get("refunded_amount") or 0))
            remaining_refundable = original_amount - already_refunded
            if amount > remaining_refundable:
                conn.rollback()
                raise ValueError(
                    f"Refund amount {amount} exceeds remaining refundable amount {remaining_refundable}"
                )

            # Update wallet balance
            wallet_balance = Decimal(str(wallet["balance"]))
            new_balance = wallet_balance + amount
            cur.execute(
                """
                UPDATE wallets
                SET balance = %s, updated_at = %s
                WHERE user_id = %s;
                """,
                (new_balance, now_iso(), user_id)
            )

            # Increment refunded_amount on original transaction
            new_refunded_amount = already_refunded + amount
            cur.execute(
                """
                UPDATE wallet_transactions
                SET refunded_amount = %s, updated_at = %s
                WHERE id = %s;
                """,
                (new_refunded_amount, now_iso(), original_transaction_id)
            )

            # Insert refund transaction
            tx_cols = _get_table_columns(cur, "wallet_transactions")
            tx_id = str(uuid.uuid4()) if tx_cols.get("id") == "uuid" else f"tx_{uuid.uuid4().hex[:10]}"
            tx_now = now_iso()
            if "direction" in tx_cols and "transaction_type" in tx_cols:
                cur.execute(
                    """
                    INSERT INTO wallet_transactions (id, user_id, transaction_type, direction, amount, balance_after, currency, status, idempotency_key, description, created_at, updated_at, source, parent_transaction_id)
                    VALUES (%s, %s, 'refund', 'credit', %s, %s, %s, 'completed', %s, %s, %s, %s, 'customer', %s);
                    """,
                    (
                        tx_id,
                        user_id,
                        amount,
                        new_balance,
                        wallet_currency,
                        idem_key,
                        description,
                        tx_now,
                        tx_now,
                        original_transaction_id,
                    )
                )
            else:
                cur.execute(
                    """
                    INSERT INTO wallet_transactions (id, user_id, amount, balance_after, currency, status, idempotency_key, description, created_at, updated_at, source, parent_transaction_id)
                    VALUES (%s, %s, %s, %s, %s, 'completed', %s, %s, %s, %s, 'customer', %s);
                    """,
                    (
                        tx_id,
                        user_id,
                        amount,
                        new_balance,
                        wallet_currency,
                        idem_key,
                        description,
                        tx_now,
                        tx_now,
                        original_transaction_id,
                    )
                )

            # Create WALLET_REFUND notification
            cls._notify_owner(
                cur,
                user_id=user_id,
                title="Wallet Refund Successful",
                message=f"₹{amount} has been refunded to your wallet. Updated balance: ₹{new_balance}.",
                notification_type="WALLET_REFUND",
                metadata={
                    "amount": str(amount),
                    "balance": str(new_balance),
                    "transaction_id": tx_id,
                    "original_transaction_id": original_transaction_id,
                },
                related_entity_id=tx_id,
            )

            conn.commit()

            return {
                "status": "success",
                "transaction_id": tx_id,
                "amount": float(amount),
                "new_balance": float(new_balance),
                "original_transaction_id": original_transaction_id,
            }

    @staticmethod
    def get_wallet_balance(user_id: str) -> Dict[str, Any]:
        """Returns the wallet balance for the authenticated user. Zero if no wallet record exists."""
        with DBConnection(autocommit=True) as conn:
            cur = conn.cursor(cursor_factory=RealDictCursor)
            cur.execute(
                "SELECT balance, currency, low_balance_alert_level, updated_at FROM wallets WHERE user_id = %s;",
                (user_id,),
            )
            row = cur.fetchone()
            if not row:
                return {
                    "user_id": user_id,
                    "balance": 0.0,
                    "currency": "INR",
                    "low_balance_alert_level": "NORMAL",
                    "updated_at": None,
                }
            return {
                "user_id": user_id,
                "balance": float(row["balance"]),
                "currency": row["currency"],
                "low_balance_alert_level": row["low_balance_alert_level"],
                "updated_at": row["updated_at"],
            }

    @staticmethod
    def fetch_wallet_transaction_history(
        user_id: str,
        limit: int = 50,
        offset: int = 0,
    ) -> Dict[str, Any]:
        """
        Returns wallet transaction history for the authenticated user.
        Enforces customer tenant isolation: only returns rows where user_id matches.
        Sorted newest-first (created_at DESC).
        Supports pagination via limit/offset.
        """
        limit = max(1, min(limit, 200))
        offset = max(0, offset)

        with DBConnection(autocommit=True) as conn:
            cur = conn.cursor(cursor_factory=RealDictCursor)

            cur.execute(
                """
                SELECT id, user_id, amount, balance_after, currency, status,
                       idempotency_key, description, created_at, updated_at,
                       transaction_type, direction
                FROM wallet_transactions
                WHERE user_id = %s
                ORDER BY created_at DESC
                LIMIT %s OFFSET %s;
                """,
                (user_id, limit, offset),
            )
            rows = cur.fetchall() or []

            transactions = []
            for row in rows:
                transactions.append({
                    "id": row["id"],
                    "type": row["transaction_type"],
                    "direction": row["direction"],
                    "amount": float(row["amount"]) if row["amount"] is not None else 0.0,
                    "currency": row["currency"],
                    "status": row["status"],
                    "description": row["description"] or "",
                    "balance_after": float(row["balance_after"]) if row["balance_after"] is not None else None,
                    "created_at": row["created_at"],
                })

            return {
                "user_id": user_id,
                "transactions": transactions,
                "count": len(transactions),
                "limit": limit,
                "offset": offset,
            }

    @classmethod
    def process_deployment_status(
        cls,
        user_id: str,
        deployment_id: str,
        new_status: str,
        gpu_name: str = "NVIDIA H100",
        deployment_name: Optional[str] = None,
        region: str = "Mumbai, IN",
        error_message: Optional[str] = None,
        idempotency_key: Optional[str] = None,
        is_admin: bool = False,
    ) -> Dict[str, Any]:
        """
        Scenario E: GPU deployment lifecycle events.
        Supported states: Provisioning, Running, Stopped, Failed, Terminated.
        - Ensures owner isolation.
        - Prevents duplicate alerts if status has not changed.
        """
        canonical_status = next((s for s in DEPLOYMENT_STATUSES if s.lower() == new_status.strip().lower()), None)
        if canonical_status is None:
            raise ValueError(f"Unsupported deployment status. Allowed: {', '.join(sorted(DEPLOYMENT_STATUSES))}.")
        # Running/Failed describe what the infrastructure did, so customers cannot claim them.
        if not is_admin and canonical_status not in CUSTOMER_SETTABLE_DEPLOYMENT_STATUSES:
            raise PermissionError(f"Customers cannot set deployment status '{canonical_status}'.")

        idem_key = idempotency_key or f"dep_{deployment_id}_{canonical_status}_{int(datetime.now().timestamp())}"

        with DBConnection(autocommit=False) as conn:
            cur = conn.cursor(cursor_factory=RealDictCursor)

            cur.execute("SELECT id, user_id, status, name, gpu, region FROM gpu_deployments WHERE id = %s FOR UPDATE;", (deployment_id,))
            dep = cur.fetchone()

            if dep:
                if dep["user_id"] != user_id and not is_admin:
                    raise PermissionError("Access forbidden: Deployment belongs to another customer")
                if dep["status"] == canonical_status:
                    conn.commit()
                    return {"status": "noop", "message": "Deployment status is unchanged. No notification sent."}
                if dep["status"] == "Terminated":
                    raise ValueError("Deployment is terminated; its status can no longer change.")
            elif not is_admin and canonical_status != "Provisioning":
                raise ValueError("A new deployment must start in 'Provisioning'.")

            # Record the outbox event only after the checks pass and inside this transaction, so a
            # rejected request does not consume the idempotency key.
            evt_id, is_duplicate = cls.record_outbox_event(
                event_type=f"DEPLOYMENT_{canonical_status.upper()}",
                payload={"user_id": user_id, "deployment_id": deployment_id, "status": canonical_status},
                idempotency_key=idem_key,
                user_id=user_id,
                cur=cur,
            )
            if is_duplicate:
                conn.rollback()
                return {"status": "skipped", "message": "Duplicate deployment event ignored."}

            if dep:
                cur.execute(
                    "UPDATE gpu_deployments SET status = %s, error_message = %s, updated_at = %s WHERE id = %s;",
                    (canonical_status, error_message, now_iso(), deployment_id)
                )
                d_name = dep["name"]
                d_gpu = dep["gpu"]
                d_region = dep["region"]
            else:
                d_name = deployment_name or f"deployment-{deployment_id[-6:]}"
                d_gpu = gpu_name
                d_region = region
                cur.execute(
                    """
                    INSERT INTO gpu_deployments (id, user_id, name, model, gpu, vram, region, hourly_rate, status, error_message, idempotency_key, created_at, updated_at)
                    VALUES (%s, %s, %s, 'Custom LLM', %s, '80 GB', %s, 220.0, %s, %s, %s, %s, %s);
                    """,
                    (deployment_id, user_id, d_name, d_gpu, d_region, canonical_status, error_message, idem_key, now_iso(), now_iso())
                )

            # Determine title & message
            if canonical_status == "Provisioning":
                title = "GPU Deployment Started"
                message = f"Your {d_gpu} GPU deployment has been initiated successfully."
            elif canonical_status == "Running":
                title = "GPU Deployment Running"
                message = f"Your {d_gpu} instance ({d_name}) is now live and serving tokens in {d_region}."
            elif canonical_status == "Stopped":
                title = "GPU Deployment Paused"
                message = f"Your {d_gpu} deployment ({d_name}) has been stopped."
            elif canonical_status == "Failed":
                title = "GPU Deployment Failed"
                message = f"Deployment failed for {d_name}: {error_message or 'Hardware allocation error'}."
            elif canonical_status == "Terminated":
                title = "GPU Deployment Terminated"
                message = f"Your {d_gpu} compute node ({d_name}) has been terminated and resources released."
            else:
                title = f"GPU Deployment {canonical_status}"
                message = f"Deployment {d_name} transitioned to status {canonical_status}."

            cls._notify_owner(
                cur,
                user_id=dep["user_id"] if dep else user_id,  # the owner, also when an admin made the change
                title=title,
                message=message,
                notification_type="GPU_DEPLOYMENT",
                metadata={"deployment_id": deployment_id, "status": canonical_status, "gpu": d_gpu, "region": d_region},
                related_entity_id=deployment_id
            )

            conn.commit()

            return {
                "status": "success",
                "deployment_id": deployment_id,
                "new_status": canonical_status,
            }

    @classmethod
    def process_maintenance_schedule(
        cls,
        admin_user_id: str,
        gpu_model: str,
        region: str,
        start_time: str,
        end_time: str,
        reason: str,
        idempotency_key: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Scenario F: Admin schedules GPU maintenance.
        - Records schedule.
        - Notifies affected customers with schedule details.
        """
        idem_key = idempotency_key or f"maint_{gpu_model}_{region}_{int(datetime.now().timestamp())}"
        evt_id, is_duplicate = cls.record_outbox_event(
            event_type="MAINTENANCE",
            payload={"gpu_model": gpu_model, "region": region, "start": start_time, "end": end_time, "reason": reason},
            idempotency_key=idem_key,
            user_id=admin_user_id
        )
        if is_duplicate:
            return {"status": "skipped", "message": "Duplicate maintenance schedule event ignored."}

        with DBConnection(autocommit=False) as conn:
            cur = conn.cursor(cursor_factory=RealDictCursor)

            maint_id = f"maint_{uuid.uuid4().hex[:8]}"
            cur.execute(
                """
                INSERT INTO gpu_maintenance_schedules (id, cluster_region, gpu_model, window_start, window_end, reason, status, scheduled_by, created_at)
                VALUES (%s, %s, %s, %s, %s, %s, 'SCHEDULED', %s, %s);
                """,
                (maint_id, region, gpu_model, start_time, end_time, reason, admin_user_id, now_iso())
            )

            title = "Scheduled GPU Maintenance"
            message = (
                f"Scheduled maintenance for {gpu_model} in {region} from {start_time} to {end_time}. "
                f"Reason: {reason}. Workloads may experience temporary pause during this maintenance window."
            )

            # Notify all active customers
            cur.execute("SELECT id FROM users WHERE role = 'customer' AND status = 'active';")
            customers = [r["id"] for r in cur.fetchall()] or ["usr_demo_customer"]

            notified_count = cls._broadcast_notifications(
                cur,
                customers,
                title=title,
                message=message,
                notification_type="MAINTENANCE",
                metadata={"gpu_model": gpu_model, "region": region, "start": start_time, "end": end_time, "reason": reason},
                related_entity_id=maint_id,
            )

            conn.commit()

            return {
                "status": "success",
                "maintenance_id": maint_id,
                "notified_count": notified_count,
            }

    @classmethod
    def process_system_announcement(
        cls,
        admin_user_id: str,
        title: str,
        message: str,
        target_group: str = "all",
        idempotency_key: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Scenario G: Admin broadcasts platform announcement.
        """
        idem_key = idempotency_key or f"broadcast_{int(datetime.now().timestamp())}_{uuid.uuid4().hex[:6]}"
        evt_id, is_duplicate = cls.record_outbox_event(
            event_type="SYSTEM_ANNOUNCEMENT",
            payload={"title": title, "message": message, "target": target_group},
            idempotency_key=idem_key,
            user_id=admin_user_id
        )
        if is_duplicate:
            return {"status": "skipped", "message": "Duplicate announcement event ignored."}

        with DBConnection(autocommit=False) as conn:
            cur = conn.cursor(cursor_factory=RealDictCursor)

            cur.execute("SELECT id FROM users WHERE status = 'active';")
            recipients = [r["id"] for r in cur.fetchall()] or ["usr_demo_customer", "usr_demo_admin"]

            recipients_count = cls._broadcast_notifications(
                cur,
                recipients,
                title=title,
                message=message,
                notification_type="SYSTEM_ANNOUNCEMENT",
                metadata={"admin_user_id": admin_user_id, "target_group": target_group},
            )

            conn.commit()

            return {
                "status": "success",
                "event_id": evt_id,
                "recipients_count": recipients_count,
            }

    @classmethod
    def get_gpu_metrics(cls, user_id: str, deployment_id: str, is_admin: bool = False) -> Dict[str, Any]:
        """
        Retrieves real-time GPU runtime metrics and telemetry for an instance.
        Enforces customer isolation: checks that deployment belongs to user_id (or admin).
        """
        with DBConnection(autocommit=True) as conn:
            cur = conn.cursor(cursor_factory=RealDictCursor)
            row = _find_deployment(cur, deployment_id)
            if not row:
                raise KeyError(f"Deployment {deployment_id} not found.")

            # Role-based (was a hardcoded "usr_demo_admin" identity exemption).
            if row["user_id"] != user_id and not is_admin:
                raise PermissionError(f"Customer {user_id} cannot access metrics for deployment {deployment_id}.")

            vram_raw = str(row.get("vram", "24 GB"))
            total_gb = 24.0
            try:
                parts = vram_raw.split()
                total_gb = float(parts[0])
            except Exception:
                total_gb = 24.0

            created_at_str = row.get("created_at") or now_iso()
            uptime_seconds = 0
            try:
                dt_created = datetime.fromisoformat(created_at_str.replace("Z", "+00:00"))
                uptime_seconds = max(0, int((datetime.now(timezone.utc) - dt_created).total_seconds()))
            except Exception:
                uptime_seconds = 3600

            hrs = uptime_seconds // 3600
            mins = (uptime_seconds % 3600) // 60
            uptime_formatted = f"{hrs}h {mins}m"

            status = row.get("status", "Running")
            is_running = status.lower() == "running"

            if not is_running:
                return {
                    "instance_id": row["id"],
                    "name": row["name"],
                    "gpu_model": row["gpu"],
                    "region": row["region"],
                    "status": status,
                    "hourly_rate": float(row["hourly_rate"]),
                    "uptime_seconds": 0,
                    "uptime_formatted": "0h 0m",
                    "timestamp": now_iso(),
                    "metrics_available": False,
                    "telemetry_state": "Offline",
                    "reason": f"Instance is currently {status}. Hardware metrics are offline.",
                    "utilization": {
                        "gpu_utilization_pct": 0,
                        "status": "Unavailable",
                    },
                    "memory": {
                        "total_gb": total_gb,
                        "used_gb": 0.0,
                        "free_gb": total_gb,
                        "utilization_pct": 0.0,
                    },
                    "thermal": {
                        "temperature_c": 0,
                        "power_w": 0,
                        "status": "Power Off",
                    },
                    "history": []
                }

            util_pct = 48
            used_gb = round(total_gb * 0.35, 1)
            free_gb = round(total_gb - used_gb, 1)
            mem_pct = round((used_gb / total_gb) * 100, 1) if total_gb > 0 else 0

            import time
            base_time = int(time.time())
            history = []
            hist_loads = [32, 38, 45, 52, 49, 41, 55, 62, 58, 44, 46, 48]
            hist_mem = [round(used_gb * (0.9 + (i % 3) * 0.05), 1) for i in range(12)]
            for i in range(12):
                t_offset = (12 - 1 - i) * 60
                history.append({
                    "timestamp": datetime.fromtimestamp(base_time - t_offset, timezone.utc).strftime("%H:%M"),
                    "gpu_utilization_pct": hist_loads[i],
                    "memory_used_gb": hist_mem[i],
                    "memory_total_gb": total_gb,
                })

            return {
                "instance_id": row["id"],
                "name": row["name"],
                "gpu_model": row["gpu"],
                "region": row["region"],
                "status": "Running",
                "hourly_rate": float(row["hourly_rate"]),
                "uptime_seconds": uptime_seconds,
                "uptime_formatted": uptime_formatted,
                "timestamp": now_iso(),
                "metrics_available": True,
                # No GPU telemetry agent exists yet: these values are fixed placeholders, labelled as such
                # (was presented as a live "NVIDIA Driver Telemetry Probe").
                "simulated": True,
                "telemetry_state": "Simulated",
                "telemetry_source": "Simulated placeholder (no GPU telemetry agent connected)",
                "utilization": {
                    "gpu_utilization_pct": util_pct,
                    "status": "Optimal Load" if util_pct < 75 else "High Compute",
                },
                "memory": {
                    "total_gb": total_gb,
                    "used_gb": used_gb,
                    "free_gb": free_gb,
                    "utilization_pct": mem_pct,
                },
                "thermal": {
                    "temperature_c": 41,
                    "power_w": 72,
                    "max_power_w": 250 if "H100" not in str(row["gpu"]) else 700,
                    "status": "Optimal Thermal Window",
                },
                "history": history
            }

    @classmethod
    def get_gpu_recommendations(cls, user_id: str, deployment_id: str, bot_permission: bool, is_admin: bool = False) -> Dict[str, Any]:
        """
        Generates intelligent AI recommendations based on GPU instance telemetry,
        pricing, and memory requirements. Strictly respects AI Assistant permissions.
        """
        if not bot_permission:
            return {
                "allowed": False,
                "status": "Permission Revoked",
                "message": "Inferxe AI Assistant telemetry permissions are currently disabled. Enable access to view personalized recommendations.",
                "recommendations": [],
                "alternative_tiers": []
            }

        with DBConnection(autocommit=True) as conn:
            cur = conn.cursor(cursor_factory=RealDictCursor)
            row = _find_deployment(cur, deployment_id)
            if not row:
                raise KeyError(f"Deployment {deployment_id} not found.")

            # Role-based (was a hardcoded "usr_demo_admin" identity exemption).
            if row["user_id"] != user_id and not is_admin:
                raise PermissionError(f"Customer {user_id} cannot access recommendations for deployment {deployment_id}.")

            gpu_model = row.get("gpu", "NVIDIA L4")
            rate = float(row.get("hourly_rate", 60.0))

        recommendations = [
            {
                "id": "rec_suitability",
                "category": "Workload Suitability",
                "status": "Optimal Match",
                "color": "green",
                "title": f"Current {gpu_model} is well-suited for your active model",
                "detail": "Based on the GPU tier only: no telemetry agent is connected, so VRAM headroom and out-of-memory events are not measured yet."
            },
            {
                "id": "rec_cost",
                "category": "Cost Optimization",
                "status": f"Save ₹{int(rate * 0.3)}/hr",
                "color": "cyan",
                "title": "Consider Spot Pricing or Pausing during idle periods",
                "detail": f"Your current compute burn is ₹{int(rate)}/hr. Switching to an on-demand Spot tier could save ~30% (₹{int(rate * 0.7)}/hr) without sacrificing throughput."
            },
            {
                "id": "rec_scaling",
                "category": "High-Memory Scaling",
                "status": "Scale-Up Path",
                "color": "amber",
                "title": "Upgrade to NVIDIA L40S or H100 if scaling context",
                "detail": "If expanding context length beyond 32k tokens or serving concurrent batch sizes > 8, transition to a 48GB (L40S) or 80GB (H100) cluster."
            }
        ]

        alternatives = [
            {"tier": "Current Tier", "gpu": gpu_model, "vram": row.get("vram", "24 GB"), "price": f"₹{int(rate)}/hr", "badge": "Active"},
            {"tier": "Spot Discount", "gpu": f"{gpu_model} Spot", "vram": row.get("vram", "24 GB"), "price": f"₹{int(rate * 0.7)}/hr", "badge": "Save 30%"},
            {"tier": "High Capacity", "gpu": "NVIDIA L40S", "vram": "48 GB", "price": "₹100/hr", "badge": "Upgrade 2x VRAM"},
            {"tier": "Frontier", "gpu": "NVIDIA H100", "vram": "80 GB", "price": "₹270/hr", "badge": "Max Throughput"},
        ]

        return {
            "allowed": True,
            "status": "Active Analysis",
            "simulated": True,  # rule-based templates, not derived from measured telemetry
            "instance_id": row["id"],
            "gpu_model": gpu_model,
            "hourly_rate": rate,
            "recommendations": recommendations,
            "alternative_tiers": alternatives,
            "generated_at": now_iso()
        }

    @classmethod
    def trigger_contextual_gpu_alert(
        cls,
        user_id: str,
        deployment_id: str,
        alert_type: str,
        title: str,
        message: str,
        idempotency_key: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Creates an intelligent contextual notification for the authenticated user,
        preventing duplicate alerts with idempotency.
        """
        idemp = idempotency_key or f"gpu_alert_{deployment_id}_{alert_type}_{datetime.now(timezone.utc).strftime('%Y%m%d%H')}"

        evt_id, is_duplicate = cls.record_outbox_event(
            event_type=f"GPU_ALERT_{alert_type.upper()}",
            payload={"deployment_id": deployment_id, "title": title, "message": message},
            idempotency_key=idemp,
            user_id=user_id,
        )

        if is_duplicate:
            logger.info(f"Duplicate GPU contextual alert skipped for idempotency key '{idemp}'")
            return {
                "status": "skipped",
                "message": "Duplicate contextual alert ignored within deduplication window.",
                "idempotency_key": idemp,
                "is_duplicate": True,
            }

        with DBConnection(autocommit=True) as conn:
            cur = conn.cursor()
            notif_id = cls._create_notification_internal(
                cur,
                user_id=user_id,
                title=title,
                message=message,
                notification_type="GPU Alert",
                metadata={"deployment_id": deployment_id, "alert_type": alert_type},
                related_entity_id=deployment_id,
            )

        return {
            "status": "created",
            "notification_id": notif_id,
            "event_id": evt_id,
            "idempotency_key": idemp,
            "is_duplicate": False,
        }


    # ── Workspace Settings & Quotas Persistence ──

    @staticmethod
    def _ensure_workspace_settings_table(cur) -> None:
        """Create/upgrade workspace_settings (adds `budget_configured`). Delegates to the module-level
        implementation, which runs once per process and applies RLS protection."""
        _ensure_workspace_settings_table(cur)

    @staticmethod
    def _current_month_spend(cur, user_id: str, now_iso_str: str) -> float:
        """Completed wallet debits since the start of the current UTC month (real records only)."""
        cur.execute("""
            SELECT COALESCE(SUM(ABS(amount)), 0) AS total_spent
            FROM wallet_transactions
            WHERE user_id = %s
              AND direction = 'debit'
              AND status = 'completed'
              AND created_at >= %s;
        """, (user_id, now_iso_str[:7] + '-01T00:00:00+00:00'))
        month_row = cur.fetchone()
        return float(month_row["total_spent"]) if month_row else 0.0

    @staticmethod
    def get_workspace_settings(user_id: str) -> Dict[str, Any]:
        """
        Retrieves workspace configuration for the user (tenant-isolated). Read-only: nothing is stored.
        `monthly_budget` is None unless the customer configured one (`budget_configured`).
        `current_month_spend` is computed from the customer's completed wallet debits this month.
        """
        with DBConnection(autocommit=True) as conn:
            cur = conn.cursor(cursor_factory=RealDictCursor)
            _ensure_workspace_settings_table(cur)  # once per process; includes RLS protection (P0 #1)
            now = datetime.now(timezone.utc).isoformat()
            current_month_spend = NotificationService._current_month_spend(cur, user_id, now)
            cur.execute("SELECT * FROM workspace_settings WHERE user_id = %s;", (user_id,))
            row = cur.fetchone()
            if not row:
                return {
                    "user_id": user_id,
                    "monthly_budget": None,
                    "budget_configured": False,
                    "spending_alerts_enabled": True,
                    "weekly_report_enabled": False,
                    "cors_origins": "https://app.novatech.ai, http://localhost:3000",
                    "current_month_spend": current_month_spend,
                    "updated_at": None,
                }
            configured = bool(row["budget_configured"])
            return {
                "user_id": row["user_id"],
                "monthly_budget": float(row["monthly_budget"]) if configured else None,
                "budget_configured": configured,
                "spending_alerts_enabled": bool(row["spending_alerts_enabled"]),
                "weekly_report_enabled": bool(row["weekly_report_enabled"]),
                "cors_origins": str(row["cors_origins"]),
                "current_month_spend": current_month_spend,
                "updated_at": str(row["updated_at"]),
            }

    @staticmethod
    def save_workspace_settings(user_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Updates and persists workspace settings with customer tenant isolation.
        Saving marks the budget as configured by the customer.
        """
        monthly_budget = float(data.get("monthly_budget", 10000.0))
        if monthly_budget < 0:
            raise ValueError("Monthly spending limit cannot be negative.")

        spending_alerts_enabled = bool(data.get("spending_alerts_enabled", True))
        weekly_report_enabled = bool(data.get("weekly_report_enabled", False))
        cors_origins = str(data.get("cors_origins", "https://app.novatech.ai, http://localhost:3000")).strip()
        now = datetime.now(timezone.utc).isoformat()

        with DBConnection(autocommit=True) as conn:
            cur = conn.cursor(cursor_factory=RealDictCursor)
            _ensure_workspace_settings_table(cur)  # once per process; includes RLS protection (P0 #1)
            cur.execute("""
                INSERT INTO workspace_settings (user_id, monthly_budget, budget_configured, spending_alerts_enabled, weekly_report_enabled, cors_origins, updated_at)
                VALUES (%s, %s, TRUE, %s, %s, %s, %s)
                ON CONFLICT (user_id) DO UPDATE SET
                    monthly_budget = EXCLUDED.monthly_budget,
                    budget_configured = TRUE,
                    spending_alerts_enabled = EXCLUDED.spending_alerts_enabled,
                    weekly_report_enabled = EXCLUDED.weekly_report_enabled,
                    cors_origins = EXCLUDED.cors_origins,
                    updated_at = EXCLUDED.updated_at;
            """, (user_id, monthly_budget, spending_alerts_enabled, weekly_report_enabled, cors_origins, now))

            return {
                "status": "success",
                "user_id": user_id,
                "monthly_budget": monthly_budget,
                "budget_configured": True,
                "spending_alerts_enabled": spending_alerts_enabled,
                "weekly_report_enabled": weekly_report_enabled,
                "cors_origins": cors_origins,
                "current_month_spend": NotificationService._current_month_spend(cur, user_id, now),
                "updated_at": now,
            }

if __name__ == "__main__":
    import sys
    sys.stdout.reconfigure(encoding="utf-8")

    print("\n" + "=" * 65)
    print(" INFERXE NOTIFICATION SERVICE - HEALTH CHECK & DIAGNOSTICS ")
    print("=" * 65)

    try:
        from backend.notifications.db import init_db
        print("[1/4] Initializing PostgreSQL connection & verifying migrations...")
        init_db()
        print("      Database connection & schema migrations OK.")

        print("\n[2/4] Testing unread notification count query...")
        test_user = "usr_demo_customer"
        unread = NotificationService.get_unread_count(test_user)
        print(f"      User '{test_user}' unread notifications: {unread}")

        print("\n[3/4] Testing fetch notifications query...")
        feed = NotificationService.get_notifications(test_user, limit=5)
        print(f"      Total notifications in PostgreSQL for '{test_user}': {feed['total']}")
        for idx, item in enumerate(feed["items"][:3], 1):
            read_mark = "[READ]" if item["is_read"] else "[UNREAD]"
            print(f"      {idx}. {read_mark} [{item['notification_type']}] {item['title']}: {item['message'][:50]}...")

        print("\n[4/4] Testing outbox event recording & idempotency check...")
        test_idem = f"cli_test_{int(datetime.now().timestamp())}"
        evt_id, is_dup = NotificationService.record_outbox_event(
            event_type="HEALTH_CHECK",
            payload={"status": "operational", "timestamp": now_iso()},
            idempotency_key=test_idem,
            user_id=test_user,
        )
        print(f"      Outbox event recorded: ID={evt_id}, is_duplicate={is_dup}")

        evt_id_dup, is_dup_2 = NotificationService.record_outbox_event(
            event_type="HEALTH_CHECK",
            payload={"status": "operational"},
            idempotency_key=test_idem,
            user_id=test_user,
        )
        print(f"      Idempotency verification: Duplicate properly detected = {is_dup_2}")

        print("\n" + "=" * 65)
        print(" ALL NOTIFICATION SERVICE CHECKS PASSED SUCCESSFULLY! ")
        print("=" * 65 + "\n")
    except Exception as exc:
        print(f"\n[ERROR] Notification Service Diagnostic Failed: {exc}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
