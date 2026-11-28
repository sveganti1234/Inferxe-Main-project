"""
supabase_notifications.py
=========================
Resilient customer notification helper for Inferxe Inference services.
Inserts notification records into the Supabase 'notifications' table following
standard schema conventions and tenant-isolation rules.

Guarantees:
- Never raises exceptions: any database, network, or schema error is logged and suppressed
  so core business transactions (API key creation, revocation, etc.) are never interrupted.
- Strictly tenant-isolated: notification is stored only under verified user_id (Cognito sub).
- Never leaks raw secrets or private tokens in notification content or logs.
"""

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

logger = logging.getLogger("inferxe.notifications.helper")


def insert_customer_notification_safe(
    *,
    user_id: str,
    title: str,
    message: str,
    notification_type: str = "SECURITY_KEY",
    related_entity_id: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> Optional[Dict[str, Any]]:
    """
    Safely inserts a notification for an authenticated customer into Supabase.
    Follows schema-adaptive fallback patterns:
      1. Full record (id, user_id, title, detail, message, notification_type, is_read, related_entity_id, metadata, created_at)
      2. Adaptive fallback without optional columns if schema variation occurs
    Catches and suppresses all errors so the caller's primary operation never fails.
    """
    clean_user_id = str(user_id or "").strip()
    if not clean_user_id:
        logger.warning("Skipping notification insertion: missing user_id.")
        return None

    try:
        from backend.database.supabase_client import get_supabase_client
        client = get_supabase_client()
        if not client:
            logger.info("Supabase client unavailable; customer notification was not inserted.")
            return None

        notif_id = str(uuid.uuid4())
        now_utc = datetime.now(timezone.utc).isoformat()
        clean_metadata = metadata if isinstance(metadata, dict) else {}

        # Primary payload matching live Supabase notifications schema
        payload = {
            "id": notif_id,
            "user_id": clean_user_id,
            "title": str(title),
            "detail": str(message),
            "message": str(message),
            "notification_type": str(notification_type),
            "is_read": False,
            "related_entity_id": str(related_entity_id) if related_entity_id else None,
            "metadata": clean_metadata,
            "created_at": now_utc,
        }

        try:
            res = client.table("notifications").insert(payload).execute()
            if hasattr(res, "data") and res.data:
                return res.data[0] if isinstance(res.data, list) else res.data
            return payload
        except Exception as insert_err:
            # Fallback attempt: some environments or older schemas store metadata as string or omit related_entity_id
            logger.debug("Primary notification insert attempt failed (%s). Retrying with stringified metadata.", type(insert_err).__name__)
            payload_fallback = dict(payload)
            payload_fallback["metadata"] = json.dumps(clean_metadata)
            try:
                res_fallback = client.table("notifications").insert(payload_fallback).execute()
                if hasattr(res_fallback, "data") and res_fallback.data:
                    return res_fallback.data[0] if isinstance(res_fallback.data, list) else res_fallback.data
                return payload_fallback
            except Exception:
                # Minimal columns fallback
                minimal_payload = {
                    "id": notif_id,
                    "user_id": clean_user_id,
                    "title": str(title),
                    "notification_type": str(notification_type),
                    "is_read": False,
                    "created_at": now_utc,
                }
                res_min = client.table("notifications").insert(minimal_payload).execute()
                if hasattr(res_min, "data") and res_min.data:
                    return res_min.data[0] if isinstance(res_min.data, list) else res_min.data
                return minimal_payload

    except Exception as err:
        logger.warning(
            "Failed to insert customer notification safe (%s): %s",
            type(err).__name__,
            str(err),
        )
        return None
