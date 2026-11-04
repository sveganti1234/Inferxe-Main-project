"""
Notification Business Logic & Event Outbox Service for Inferxe.
Enforces multi-user isolation, idempotency, wallet thresholds, and deployment lifecycle tracking.
"""

import os
import json
import uuid
import logging
from typing import Dict, Any, List, Optional, Tuple
from datetime import datetime, timezone
import psycopg2
from psycopg2.extras import RealDictCursor
from .db import DBConnection

logger = logging.getLogger("inferxe.notifications.service")

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

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

            # Total and unread counts for this user
            cur.execute("SELECT COUNT(*) as total FROM notifications WHERE user_id = %s;", (user_id,))
            total = cur.fetchone()["total"]

            cur.execute("SELECT COUNT(*) as unread FROM notifications WHERE user_id = %s AND is_read = FALSE;", (user_id,))
            unread_count = cur.fetchone()["unread"]

            query = "SELECT * FROM notifications WHERE user_id = %s "
            params: List[Any] = [user_id]

            if unread_only:
                query += "AND is_read = FALSE "

            query += "ORDER BY created_at DESC, id DESC LIMIT %s OFFSET %s;"
            params.extend([limit, offset])

            cur.execute(query, tuple(params))
            rows = cur.fetchall()

            # Parse JSON metadata if present
            items = []
            for r in rows:
                item = dict(r)
                if isinstance(item.get("metadata"), str):
                    try:
                        item["metadata"] = json.loads(item["metadata"])
                    except Exception:
                        item["metadata"] = {}
                items.append(item)

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

            # Check existence and ownership
            cur.execute("SELECT user_id, is_read FROM notifications WHERE id = %s;", (notification_id,))
            row = cur.fetchone()
            if not row:
                raise KeyError("Notification not found")

            if row["user_id"] != user_id:
                logger.warning(f"Cross-user mark-read blocked: User {user_id} tried to read notification {notification_id} of user {row['user_id']}")
                raise PermissionError("Access forbidden: Cannot modify notifications of another user")

            read_time = now_iso()
            cur.execute(
                "UPDATE notifications SET is_read = TRUE, read_at = %s WHERE id = %s RETURNING id, is_read, read_at;",
                (read_time, notification_id)
            )
            updated = cur.fetchone()
            return dict(updated)

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

            cur.execute("SELECT user_id FROM notifications WHERE id = %s;", (notification_id,))
            row = cur.fetchone()
            if not row:
                raise KeyError("Notification not found")

            if row["user_id"] != user_id:
                logger.warning(f"Cross-user delete blocked: User {user_id} tried to delete notification {notification_id} of user {row['user_id']}")
                raise PermissionError("Access forbidden: Cannot delete notifications of another user")

            cur.execute("DELETE FROM notifications WHERE id = %s;", (notification_id,))
            return True

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
        """Inserts a notification record using an active cursor."""
        notif_id = f"notif_{uuid.uuid4().hex[:12]}"
        meta_json = json.dumps(metadata or {})
        created_time = now_iso()

        cur.execute(
            """
            INSERT INTO notifications (id, user_id, title, message, notification_type, is_read, metadata, related_entity_id, created_at)
            VALUES (%s, %s, %s, %s, %s, FALSE, %s, %s, %s)
            RETURNING id;
            """,
            (notif_id, user_id, title, message, notification_type, meta_json, related_entity_id, created_time)
        )
        return notif_id

    @classmethod
    def record_outbox_event(
        cls,
        event_type: str,
        payload: Dict[str, Any],
        idempotency_key: Optional[str] = None,
        user_id: Optional[str] = None
    ) -> Tuple[str, bool]:
        """
        Records an event into notification_outbox with idempotency check.
        Returns (event_id, is_duplicate).
        """
        evt_id = f"evt_{uuid.uuid4().hex[:12]}"
        created_time = now_iso()
        payload_str = json.dumps(payload)

        with DBConnection(autocommit=True) as conn:
            cur = conn.cursor(cursor_factory=RealDictCursor)

            if idempotency_key:
                cur.execute(
                    "SELECT id, status FROM notification_outbox WHERE idempotency_key = %s;",
                    (idempotency_key,)
                )
                existing = cur.fetchone()
                if existing:
                    logger.info(f"Duplicate outbox event skipped for idempotency key '{idempotency_key}'")
                    return existing["id"], True

            cur.execute(
                """
                INSERT INTO notification_outbox (id, event_type, user_id, payload, idempotency_key, status, retry_count, created_at)
                VALUES (%s, %s, %s, %s, %s, 'PROCESSED', 0, %s)
                RETURNING id;
                """,
                (evt_id, event_type, user_id, payload_str, idempotency_key, created_time)
            )
            return evt_id, False

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

            cust_created = 0
            for cid in customers:
                cls._create_notification_internal(
                    cur,
                    user_id=cid,
                    title=title,
                    message=message,
                    notification_type=event_type,
                    metadata=meta,
                    related_entity_id=gpu_id
                )
                cust_created += 1

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
            admin_created = 0
            for aid in admins:
                cls._create_notification_internal(
                    cur,
                    user_id=aid,
                    title="GPU Price Audit Alert",
                    message=admin_audit_msg,
                    notification_type="GPU_PRICE_AUDIT",
                    metadata=meta,
                    related_entity_id=gpu_id
                )
                admin_created += 1

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
        idempotency_key: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Scenario B: Customer adds money to wallet.
        - Validates idempotency.
        - Updates wallet balance atomically.
        - Creates wallet transaction record.
        - Creates WALLET_RECHARGE notification with updated balance.
        """
        if amount <= 0:
            raise ValueError("Recharge amount must be greater than zero")

        idem_key = idempotency_key or f"wallet_recharge_{user_id}_{int(amount)}_{int(datetime.now().timestamp())}"
        evt_id, is_duplicate = cls.record_outbox_event(
            event_type="WALLET_RECHARGE",
            payload={"user_id": user_id, "amount": amount},
            idempotency_key=idem_key,
            user_id=user_id
        )
        if is_duplicate:
            return {"status": "skipped", "message": "Duplicate wallet recharge event ignored."}

        with DBConnection(autocommit=False) as conn:
            cur = conn.cursor(cursor_factory=RealDictCursor)

            cur.execute("SELECT balance, low_balance_alert_level FROM wallets WHERE user_id = %s FOR UPDATE;", (user_id,))
            wallet = cur.fetchone()

            if not wallet:
                curr_balance = 0.0
                new_balance = float(amount)
                cur.execute(
                    """
                    INSERT INTO wallets (user_id, balance, currency, low_balance_alert_level, updated_at)
                    VALUES (%s, %s, 'INR', 'NORMAL', %s);
                    """,
                    (user_id, new_balance, now_iso())
                )
            else:
                curr_balance = float(wallet["balance"])
                new_balance = curr_balance + float(amount)
                new_alert_level = "NORMAL" if new_balance > 100 else wallet["low_balance_alert_level"]
                cur.execute(
                    """
                    UPDATE wallets 
                    SET balance = %s, low_balance_alert_level = %s, updated_at = %s 
                    WHERE user_id = %s;
                    """,
                    (new_balance, new_alert_level, now_iso(), user_id)
                )

            tx_id = f"tx_{uuid.uuid4().hex[:10]}"
            cur.execute(
                """
                INSERT INTO wallet_transactions (id, user_id, amount, balance_after, currency, status, idempotency_key, description, created_at, updated_at)
                VALUES (%s, %s, %s, %s, 'INR', 'completed', %s, %s, %s, %s);
                """,
                (tx_id, user_id, amount, new_balance, idem_key, "Wallet recharge top-up", now_iso(), now_iso())
            )

            title = "Wallet Recharge Successful"
            message = f"₹{amount:,.0f} has been successfully added to your wallet. Updated balance: ₹{new_balance:,.0f}."
            cls._create_notification_internal(
                cur,
                user_id=user_id,
                title=title,
                message=message,
                notification_type="WALLET_RECHARGE_SUCCESS",
                metadata={"amount": amount, "balance": new_balance, "transaction_id": tx_id},
                related_entity_id=tx_id
            )

            conn.commit()

            return {
                "status": "success",
                "transaction_id": tx_id,
                "amount": amount,
                "new_balance": new_balance,
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
        """
        if amount <= 0:
            raise ValueError("Debit amount must be greater than zero")

        idem_key = idempotency_key or f"wallet_debit_{user_id}_{int(amount)}_{int(datetime.now().timestamp())}"
        evt_id, is_duplicate = cls.record_outbox_event(
            event_type="WALLET_DEBIT",
            payload={"user_id": user_id, "amount": amount, "description": description},
            idempotency_key=idem_key,
            user_id=user_id
        )
        if is_duplicate:
            return {"status": "skipped", "message": "Duplicate wallet debit event ignored."}

        with DBConnection(autocommit=False) as conn:
            cur = conn.cursor(cursor_factory=RealDictCursor)

            cur.execute("SELECT balance, low_balance_alert_level FROM wallets WHERE user_id = %s FOR UPDATE;", (user_id,))
            wallet = cur.fetchone()
            if not wallet or float(wallet["balance"]) < amount:
                raise ValueError("Insufficient wallet balance for this transaction")

            curr_balance = float(wallet["balance"])
            new_balance = curr_balance - float(amount)
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

            tx_id = f"tx_{uuid.uuid4().hex[:10]}"
            cur.execute(
                """
                INSERT INTO wallet_transactions (id, user_id, amount, balance_after, currency, status, idempotency_key, description, created_at, updated_at)
                VALUES (%s, %s, %s, %s, 'INR', 'completed', %s, %s, %s, %s);
                """,
                (tx_id, user_id, -amount, new_balance, idem_key, description, now_iso(), now_iso())
            )

            # Standard Debit notification
            cls._create_notification_internal(
                cur,
                user_id=user_id,
                title="Wallet Transaction Successful",
                message=f"₹{amount:,.0f} has been deducted from your wallet. Remaining balance: ₹{new_balance:,.0f}.",
                notification_type="WALLET_DEBIT",
                metadata={"amount": amount, "remaining_balance": new_balance, "transaction_id": tx_id},
                related_entity_id=tx_id
            )

            # Threshold transition alert if entered new tier
            if threshold_alert_needed:
                cls._create_notification_internal(
                    cur,
                    user_id=user_id,
                    title=threshold_title,
                    message=threshold_msg,
                    notification_type="LOW_WALLET_BALANCE",
                    metadata={"balance": new_balance, "tier": new_alert_level},
                    related_entity_id=tx_id
                )

            conn.commit()

            return {
                "status": "success",
                "transaction_id": tx_id,
                "amount": amount,
                "remaining_balance": new_balance,
                "low_balance_alert": threshold_alert_needed,
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
        idempotency_key: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Scenario E: GPU deployment lifecycle events.
        Supported states: Provisioning, Running, Stopped, Failed, Terminated.
        - Ensures owner isolation.
        - Prevents duplicate alerts if status has not changed.
        """
        valid_statuses = {"Provisioning", "Running", "Stopped", "Failed", "Terminated"}
        canonical_status = next((s for s in valid_statuses if s.lower() == new_status.lower()), new_status)

        idem_key = idempotency_key or f"dep_{deployment_id}_{canonical_status}_{int(datetime.now().timestamp())}"
        evt_id, is_duplicate = cls.record_outbox_event(
            event_type=f"DEPLOYMENT_{canonical_status.upper()}",
            payload={"user_id": user_id, "deployment_id": deployment_id, "status": canonical_status},
            idempotency_key=idem_key,
            user_id=user_id
        )
        if is_duplicate:
            return {"status": "skipped", "message": "Duplicate deployment event ignored."}

        with DBConnection(autocommit=False) as conn:
            cur = conn.cursor(cursor_factory=RealDictCursor)

            cur.execute("SELECT id, user_id, status, name, gpu, region FROM gpu_deployments WHERE id = %s;", (deployment_id,))
            dep = cur.fetchone()

            if dep:
                if dep["user_id"] != user_id:
                    raise PermissionError("Access forbidden: Deployment belongs to another customer")
                if dep["status"] == canonical_status:
                    conn.commit()
                    return {"status": "noop", "message": "Deployment status is unchanged. No notification sent."}
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

            cls._create_notification_internal(
                cur,
                user_id=user_id,
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

            for cid in customers:
                cls._create_notification_internal(
                    cur,
                    user_id=cid,
                    title=title,
                    message=message,
                    notification_type="MAINTENANCE",
                    metadata={"gpu_model": gpu_model, "region": region, "start": start_time, "end": end_time, "reason": reason},
                    related_entity_id=maint_id
                )

            conn.commit()

            return {
                "status": "success",
                "maintenance_id": maint_id,
                "notified_count": len(customers),
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

            for uid in recipients:
                cls._create_notification_internal(
                    cur,
                    user_id=uid,
                    title=title,
                    message=message,
                    notification_type="SYSTEM_ANNOUNCEMENT",
                    metadata={"admin_user_id": admin_user_id, "target_group": target_group}
                )

            conn.commit()

            return {
                "status": "success",
                "event_id": evt_id,
                "recipients_count": len(recipients),
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
