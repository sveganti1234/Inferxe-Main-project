"""
Abstract Base Provider Adapter
==============================
Defines the contract that every GPU infrastructure cloud adapter must implement.
Adheres to DPR Section 10: Provider Adapter Framework.
"""

from abc import ABC, abstractmethod
from typing import List, Optional

from .types import (
    DEFAULT_SERVING_IMAGE,
    ContainerConfig,
    GpuOffering,
    ProvisionRequest,
    InstanceHandle,
    InstanceStatus,
)


class ProviderError(Exception):
    """Base exception for GPU cloud provider operations."""
    def __init__(self, message: str, provider_id: str = "", status_code: int = 500):
        super().__init__(message)
        self.message = message
        self.provider_id = provider_id
        self.status_code = status_code


class ProviderAuthenticationError(ProviderError):
    """Raised when provider API credentials are invalid or missing."""
    def __init__(self, message: str, provider_id: str = ""):
        super().__init__(message, provider_id=provider_id, status_code=401)


class ProviderQuotaExceededError(ProviderError):
    """Raised when account budget or GPU instance quota is exceeded."""
    def __init__(self, message: str, provider_id: str = ""):
        super().__init__(message, provider_id=provider_id, status_code=429)


class ProviderCapacityUnavailableError(ProviderError):
    """Raised when the requested GPU type is out of stock in the chosen region."""
    def __init__(self, message: str, provider_id: str = ""):
        super().__init__(message, provider_id=provider_id, status_code=503)


class ProviderInstanceNotFoundError(ProviderError):
    """Raised when querying an instance that does not exist at the provider."""
    def __init__(self, message: str, provider_id: str = ""):
        super().__init__(message, provider_id=provider_id, status_code=404)


class ProviderTimeoutError(ProviderError):
    """Raised when a provider call does not finish within the allowed time."""
    def __init__(self, message: str, provider_id: str = ""):
        super().__init__(message, provider_id=provider_id, status_code=504)


class BaseGpuProvider(ABC):
    """Abstract interface defining required operations for GPU cloud providers."""

    # True when provision_instance() installs ProvisionRequest.ssh_public_keys on the instance.
    # Providers that cannot must leave this False so callers refuse keys instead of silently dropping them.
    supports_ssh_keys: bool = False

    # True only when provision_instance() can host a notebook workload instead of a model-serving container.
    # Notebook launches also require supports_ssh_keys; providers left False are never picked for notebooks.
    supports_notebooks: bool = False

    # True only when provision_instance() runs ProvisionRequest.container_image instead of the provider's default
    # serving stack, and when it publishes ProvisionRequest.service_ports (returning InstanceHandle.port_mappings).
    supports_custom_images: bool = False
    supports_exposed_ports: bool = False

    def unsupported_features(self, *, notebook: bool = False, container: Optional[ContainerConfig] = None) -> List[str]:
        """Features a workload needs that this provider cannot deliver; empty when it can run the workload."""
        missing = []
        if notebook and not self.supports_notebooks:
            missing.append("notebook workloads")
        if notebook and not self.supports_ssh_keys:
            missing.append("SSH key delivery")
        if container is not None and container.image != DEFAULT_SERVING_IMAGE and not self.supports_custom_images:
            missing.append("custom container images")
        if container is not None and container.service_ports and not self.supports_exposed_ports:
            missing.append("exposed service ports")
        return missing

    def reject_unsupported_container(self, request: ProvisionRequest) -> None:
        """Adapters call this so a container setting they cannot honour fails loudly instead of being dropped."""
        missing = self.unsupported_features(container=ContainerConfig(
            image=request.container_image, service_ports=request.service_ports))
        if missing:
            raise ProviderError(f"{self.display_name} does not support {', '.join(missing)}",
                                provider_id=self.provider_id, status_code=400)

    @property
    @abstractmethod
    def provider_id(self) -> str:
        """Unique provider slug, e.g. 'jarvislabs', 'mock'."""
        pass

    @property
    @abstractmethod
    def display_name(self) -> str:
        """Human-readable provider name, e.g. 'JarvisLabs.ai'."""
        pass

    @abstractmethod
    async def list_offerings(self) -> List[GpuOffering]:
        """Fetch normalized GPU catalog entries with current pricing and availability."""
        pass

    @abstractmethod
    async def check_availability(self, gpu_id: str, region: Optional[str] = None) -> bool:
        """Check whether a specific GPU type can currently be provisioned."""
        pass

    @abstractmethod
    async def provision_instance(self, request: ProvisionRequest) -> InstanceHandle:
        """Provision a GPU instance and configure the serving runtime container."""
        pass

    @abstractmethod
    async def get_instance_status(self, provider_instance_id: str) -> InstanceStatus:
        """Retrieve real-time health, lifecycle state, and hardware telemetry."""
        pass

    @abstractmethod
    async def pause_instance(self, provider_instance_id: str) -> bool:
        """Pause/stop an active GPU instance to preserve volume state while halting compute charges."""
        pass

    @abstractmethod
    async def resume_instance(self, provider_instance_id: str) -> bool:
        """Resume a paused GPU instance."""
        pass

    @abstractmethod
    async def terminate_instance(self, provider_instance_id: str) -> bool:
        """Permanently destroy a GPU instance and release provider compute resources."""
        pass
