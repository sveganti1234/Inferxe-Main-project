"""
gpu_deployment_service.py
=========================
Provider-independent GPU deployment orchestration:
catalogue -> provider selection -> SSH key validation -> provisioning -> lifecycle (status, stop, resume, terminate).

Prices come from the provider offering on the server, never from the client. The deployment row is written
*before* the provider call so a crash can never leave an instance nobody knows about.
"""

import asyncio
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from inference.supabase_deployments import (
    DeploymentConflictError,
    DeploymentStoreError,
    SupabaseDeploymentRepository,
)
from providers.base import BaseGpuProvider, ProviderError, ProviderInstanceNotFoundError, ProviderTimeoutError
from providers.registry import ProviderRegistry, get_registry
from providers.types import GpuOffering, InstanceStatusEnum, ProvisionRequest

logger = logging.getLogger("inferxe.gpu_deployments")

DEFAULT_PROVIDER_TIMEOUT_SECONDS = 60.0
ERROR_MESSAGE_MAX = 500

STATUS_FROM_PROVIDER = {
    InstanceStatusEnum.PENDING: "provisioning",
    InstanceStatusEnum.INITIALIZING: "provisioning",
    InstanceStatusEnum.RUNNING: "running",
    InstanceStatusEnum.STOPPING: "stopped",
    InstanceStatusEnum.STOPPED: "stopped",
    InstanceStatusEnum.TERMINATING: "terminated",
    InstanceStatusEnum.TERMINATED: "terminated",
    InstanceStatusEnum.FAILED: "failed",
}
ACTIVE_STATUSES = {"provisioning", "running", "stopped"}


class DeploymentNotFoundError(Exception):
    pass


class DeploymentRequestError(Exception):
    """The request is invalid for this customer or provider (HTTP 400)."""


class DeploymentStateError(Exception):
    """The action is not allowed in the deployment's current state (HTTP 409)."""


class DeploymentProvisioningError(Exception):
    """The provider failed; the deployment row was kept and marked failed."""

    def __init__(self, deployment: Dict[str, Any], cause: ProviderError):
        super().__init__(cause.message)
        self.deployment = deployment
        self.cause = cause


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _status_fields(new_status: str, row: Dict[str, Any]) -> Dict[str, Any]:
    fields: Dict[str, Any] = {"status": new_status, "last_status_sync_at": _now()}
    if new_status == "running" and row.get("status") != "running":
        fields["started_at"] = _now()
    if new_status in ("stopped", "terminated", "failed") and row.get("status") not in ("stopped", "terminated", "failed"):
        fields["stopped_at"] = _now()
    return fields


class GpuDeploymentService:
    def __init__(
        self,
        repo: SupabaseDeploymentRepository,
        ssh_repo: Any,
        registry: Optional[ProviderRegistry] = None,
        provider_timeout: float = DEFAULT_PROVIDER_TIMEOUT_SECONDS,
    ):
        self.repo = repo
        self.ssh_repo = ssh_repo
        self.registry = registry or get_registry()
        self.provider_timeout = provider_timeout

    # Adapters are async; routes are sync (they run in Starlette's threadpool, which has no running event loop),
    # so each provider call gets its own short-lived loop.
    def _run(self, coro, provider_id: str = ""):
        try:
            return asyncio.run(asyncio.wait_for(coro, self.provider_timeout))
        except asyncio.TimeoutError:
            raise ProviderTimeoutError(
                f"Provider did not respond within {self.provider_timeout:.0f}s", provider_id=provider_id
            ) from None

    # ── Catalogue ──────────────────────────────────────────────────────────────────────────────────────
    def list_offerings(self) -> List[GpuOffering]:
        return self._run(self.registry.list_offerings())

    # ── Create ─────────────────────────────────────────────────────────────────────────────────────────
    def create(
        self,
        user_id: str,
        name: str,
        model_name: str,
        gpu_id: str,
        provider_id: Optional[str] = None,
        region: Optional[str] = None,
        ssh_key_ids: Optional[List[uuid.UUID]] = None,
        idempotency_key: Optional[str] = None,
    ) -> Dict[str, Any]:
        if idempotency_key:
            existing = self.repo.get_by_idempotency_key(user_id, idempotency_key)
            if existing:
                return existing

        provider, offer = self._run(self.registry.select_offering(gpu_id, provider_id, region))

        keys = []
        for key_id in dict.fromkeys(ssh_key_ids or []):  # de-duplicate, keep order
            record = self.ssh_repo.get_ssh_key_by_id(user_id=user_id, key_id=key_id)
            if record is None:  # missing or owned by someone else: same answer, no enumeration
                raise DeploymentRequestError(f"SSH key {key_id} was not found.")
            keys.append(record)
        if keys and not provider.supports_ssh_keys:
            raise DeploymentRequestError(f"Provider '{provider.provider_id}' does not support SSH keys yet.")

        deployment_id = str(uuid.uuid4())
        row = {
            "id": deployment_id,
            "user_id": user_id,
            "name": name,
            "model_name": model_name,
            "gpu_model": offer.name,
            "region": offer.region,
            "status": "provisioning",
            "hourly_rate": offer.hourly_price_inr,
            "currency": "INR",
            "provider_id": provider.provider_id,
            "idempotency_key": idempotency_key,
            "metadata": {
                "gpu_id": offer.gpu_id,
                "pricing_type": offer.pricing_type.value,
                "ssh_keys": [{"id": str(k.id), "fingerprint": k.fingerprint} for k in keys],
            },
        }
        try:
            row = self.repo.create(row)
        except DeploymentConflictError:
            existing = self.repo.get_by_idempotency_key(user_id, idempotency_key) if idempotency_key else None
            if existing:  # a concurrent request with the same key won the race
                return existing
            raise

        request = ProvisionRequest(
            deployment_id=deployment_id,
            customer_id=user_id,
            gpu_id=offer.gpu_id,
            provider_id=provider.provider_id,
            model_name=model_name,
            pricing_type=offer.pricing_type,
            region_preference=offer.region,
            ssh_public_keys=[k.public_key for k in keys],
        )
        try:
            handle = self._run(provider.provision_instance(request), provider.provider_id)
        except ProviderError as err:
            logger.warning("Provisioning failed for deployment %s on %s (%s).",
                           deployment_id, provider.provider_id, type(err).__name__)
            message = err.message
            if isinstance(err, ProviderTimeoutError):
                # shortcut: the provider may still create the instance; a reconciler that lists provider instances
                # by name (inferxe-<deployment id>) is needed before real providers go live.
                message += "; the provider may still create the instance, so it needs a manual check"
            failed = self.repo.update(user_id, deployment_id, {
                **_status_fields("failed", row), "error_message": message[:ERROR_MESSAGE_MAX],
            })
            raise DeploymentProvisioningError(failed or row, err) from err

        fields = {
            **_status_fields(STATUS_FROM_PROVIDER[handle.status], row),
            "provider_instance_id": handle.provider_instance_id,
            "ssh_host": handle.host_ip,
            "ssh_port": handle.ssh_port,
            "ssh_username": handle.ssh_username,
            "endpoint_url": handle.service_url,
        }
        try:
            updated = self.repo.update(user_id, deployment_id, fields)
        except DeploymentStoreError:
            # The instance exists but we could not record it: release it rather than leave a billed GPU untracked.
            self._release(provider, handle.provider_instance_id, deployment_id)
            raise
        return updated or {**row, **fields}

    def _release(self, provider: BaseGpuProvider, provider_instance_id: str, deployment_id: str) -> None:
        try:
            self._run(provider.terminate_instance(provider_instance_id), provider.provider_id)
            logger.warning("Released instance %s after failing to record deployment %s.",
                           provider_instance_id, deployment_id)
        except Exception as err:  # noqa: BLE001 - must log, never mask the original failure
            logger.error("ORPHANED instance %s (%s) for deployment %s: cleanup failed (%s).",
                         provider_instance_id, provider.provider_id, deployment_id, type(err).__name__)

    # ── Read ───────────────────────────────────────────────────────────────────────────────────────────
    def list(self, user_id: str) -> List[Dict[str, Any]]:
        # Only rows still provisioning are refreshed, so the list moves on without one provider call per row.
        return [self._sync(r) if r["status"] == "provisioning" and r.get("provider_instance_id") else r
                for r in self.repo.list(user_id)]

    def _get_row(self, user_id: str, deployment_id: str) -> Dict[str, Any]:
        row = self.repo.get(user_id, deployment_id)
        if row is None or not row.get("provider_id"):
            raise DeploymentNotFoundError(deployment_id)
        return row

    def get(self, user_id: str, deployment_id: str) -> Dict[str, Any]:
        row = self._get_row(user_id, deployment_id)
        if row["status"] in ACTIVE_STATUSES and row.get("provider_instance_id"):
            return self._sync(row)
        return row

    def _sync(self, row: Dict[str, Any], fallback_status: Optional[str] = None) -> Dict[str, Any]:
        """Refresh status and connection details from the provider. Provider errors keep the stored state."""
        try:
            provider = self.registry.get(row["provider_id"])  # inside try: an unregistered provider keeps the stored row
            status = self._run(provider.get_instance_status(row["provider_instance_id"]), row["provider_id"])
        except ProviderInstanceNotFoundError:
            fields = {**_status_fields("terminated", row), "error_message": "Instance no longer exists at the provider."}
        except ProviderError as err:
            logger.warning("Status sync failed for deployment %s (%s).", row["id"], type(err).__name__)
            if fallback_status is None:
                return row
            fields = _status_fields(fallback_status, row)
        else:
            fields = _status_fields(STATUS_FROM_PROVIDER[status.status], row)
            if status.host_ip:
                fields["ssh_host"] = status.host_ip
            if status.ssh_port:
                fields["ssh_port"] = status.ssh_port
            if status.error_message:
                fields["error_message"] = status.error_message[:ERROR_MESSAGE_MAX]
        return self.repo.update(row["user_id"], row["id"], fields) or {**row, **fields}

    # ── Lifecycle ──────────────────────────────────────────────────────────────────────────────────────
    def stop(self, user_id: str, deployment_id: str) -> Dict[str, Any]:
        row = self._get_row(user_id, deployment_id)
        if row["status"] != "running":
            raise DeploymentStateError(f"Only running deployments can be stopped (current: {row['status']}).")
        provider = self.registry.get(row["provider_id"])
        self._run(provider.pause_instance(row["provider_instance_id"]), provider.provider_id)
        return self._sync(row, fallback_status="stopped")

    def resume(self, user_id: str, deployment_id: str) -> Dict[str, Any]:
        row = self._get_row(user_id, deployment_id)
        if row["status"] != "stopped":
            raise DeploymentStateError(f"Only stopped deployments can be resumed (current: {row['status']}).")
        provider = self.registry.get(row["provider_id"])
        self._run(provider.resume_instance(row["provider_instance_id"]), provider.provider_id)
        return self._sync(row, fallback_status="provisioning")

    def terminate(self, user_id: str, deployment_id: str) -> Dict[str, Any]:
        row = self._get_row(user_id, deployment_id)
        if row["status"] == "terminated":
            return row  # idempotent
        if row.get("provider_instance_id"):
            provider = self.registry.get(row["provider_id"])
            try:
                self._run(provider.terminate_instance(row["provider_instance_id"]), provider.provider_id)
            except ProviderInstanceNotFoundError:
                pass  # already gone at the provider: record it as terminated
        fields = _status_fields("terminated", row)
        return self.repo.update(user_id, deployment_id, fields) or {**row, **fields}
