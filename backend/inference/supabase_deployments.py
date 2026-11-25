"""
supabase_deployments.py
=======================
PostgREST repository for `public.deployments` used by the GPU deployment API.

- Service-role access only (bypasses RLS); every query is filtered by the caller's `user_id`.
- Rows are returned as plain dicts with the columns in DEPLOYMENT_COLUMNS.
- Requires migration 009_deployment_provider_instances.sql (provider/SSH/idempotency columns).
"""

import json
import logging
import urllib.parse
import uuid
from typing import Any, Callable, Dict, List, Optional, Tuple

from inference.supabase_config import SupabaseConfigurationError, SupabaseSettings, get_supabase_settings
from inference.supabase_ssh_keys import _default_pooled_http_transport, _extract_sanitized_supabase_error

logger = logging.getLogger("inferxe.supabase_deployments")

TransportCallable = Callable[[str, str, Dict[str, str], Optional[bytes], float], Tuple[int, Dict[str, str], bytes]]

DEPLOYMENT_COLUMNS = (
    "id,user_id,organization_id,listing_id,name,model_name,gpu_model,region,status,hourly_rate,currency,"
    "provider_id,provider_instance_id,endpoint_url,ssh_host,ssh_port,ssh_username,error_message,"
    "idempotency_key,last_status_sync_at,started_at,stopped_at,metadata,created_at,updated_at"
)


class DeploymentStoreError(RuntimeError):
    """The deployment database rejected the request."""


class DeploymentStoreUnavailableError(DeploymentStoreError):
    """The deployment database is unreachable, misconfigured or returned an unexpected response."""


class DeploymentConflictError(DeploymentStoreError):
    """A unique constraint (idempotency key or provider instance) was violated."""


def _clean_user_id(user_id: Any) -> str:
    if not isinstance(user_id, str) or not user_id.strip() or any(c in user_id for c in "\r\n\x00"):
        raise DeploymentStoreError("User ID is required for tenant isolation.")
    return user_id.strip()


class SupabaseDeploymentRepository:
    def __init__(self, settings: Optional[SupabaseSettings] = None, timeout: float = 10.0,
                 transport: Optional[TransportCallable] = None) -> None:
        self._settings = settings
        self.timeout = timeout
        self._transport = transport or _default_pooled_http_transport

    def _request(self, method: str, params: Dict[str, str], payload: Optional[Dict[str, Any]] = None,
                 prefer: Optional[str] = None) -> Any:
        try:
            settings = self._settings or get_supabase_settings()
        except SupabaseConfigurationError as err:
            raise DeploymentStoreUnavailableError("Deployment database is not configured.") from err
        url = f"{settings.rest_url('deployments')}?{urllib.parse.urlencode(params, safe='.,()')}"
        headers = settings.auth_headers(extra_headers={"Prefer": prefer} if prefer else None)
        body = json.dumps(payload).encode("utf-8") if payload is not None else None
        try:
            status_code, _headers, resp_body = self._transport(method, url, headers, body, self.timeout)
        except Exception as err:  # timeouts, connection and protocol errors
            logger.error("Supabase deployments %s failed (%s).", method, type(err).__name__)
            raise DeploymentStoreUnavailableError("Deployment database is temporarily unavailable.") from err

        if status_code >= 400:
            pg_code, _msg, _details = _extract_sanitized_supabase_error(status_code, resp_body)
            logger.warning("Supabase deployments %s rejected (status=%s, code=%s).", method, status_code, pg_code)
            if pg_code == "23505" or status_code == 409:
                raise DeploymentConflictError("A deployment with this idempotency key or instance already exists.")
            if status_code >= 500 or status_code in (401, 403):
                raise DeploymentStoreUnavailableError("Deployment database returned an upstream error.")
            raise DeploymentStoreError("Deployment database rejected the request.")
        if not resp_body:
            return None
        try:
            return json.loads(resp_body.decode("utf-8"))
        except Exception as err:
            raise DeploymentStoreUnavailableError("Received invalid response from deployment database.") from err

    def _rows(self, data: Any) -> List[Dict[str, Any]]:
        if not isinstance(data, list):
            raise DeploymentStoreUnavailableError("Unexpected response from deployment database.")
        return data

    def create(self, row: Dict[str, Any]) -> Dict[str, Any]:
        rows = self._rows(self._request("POST", {"select": DEPLOYMENT_COLUMNS}, payload=row,
                                        prefer="return=representation"))
        if len(rows) != 1:
            raise DeploymentStoreUnavailableError("Unexpected response creating deployment.")
        return rows[0]

    def get(self, user_id: str, deployment_id: str) -> Optional[Dict[str, Any]]:
        try:
            clean_id = str(uuid.UUID(str(deployment_id)))
        except ValueError:
            return None
        rows = self._rows(self._request("GET", {
            "select": DEPLOYMENT_COLUMNS, "id": f"eq.{clean_id}",
            "user_id": f"eq.{_clean_user_id(user_id)}", "limit": "1",
        }))
        return rows[0] if rows else None

    def get_by_idempotency_key(self, user_id: str, key: str) -> Optional[Dict[str, Any]]:
        rows = self._rows(self._request("GET", {
            "select": DEPLOYMENT_COLUMNS, "user_id": f"eq.{_clean_user_id(user_id)}",
            "idempotency_key": f"eq.{key}", "limit": "1",
        }))
        return rows[0] if rows else None

    def list(self, user_id: str) -> List[Dict[str, Any]]:
        # Only deployments created through the provider API (provider_id set); Node-created rows stay out.
        return self._rows(self._request("GET", {
            "select": DEPLOYMENT_COLUMNS, "user_id": f"eq.{_clean_user_id(user_id)}",
            "provider_id": "not.is.null", "order": "created_at.desc",
        }))

    def update(self, user_id: str, deployment_id: str, fields: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        rows = self._rows(self._request("PATCH", {
            "select": DEPLOYMENT_COLUMNS, "id": f"eq.{deployment_id}",
            "user_id": f"eq.{_clean_user_id(user_id)}",
        }, payload=fields, prefer="return=representation"))
        return rows[0] if rows else None


def get_deployment_repository() -> SupabaseDeploymentRepository:
    """FastAPI dependency returning a configured Supabase deployment repository."""
    return SupabaseDeploymentRepository()
