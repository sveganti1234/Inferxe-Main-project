"""
GPU Provider Registry
=====================
Centralized registry for discovering, instantiating, and caching GPU cloud provider adapters.
"""

import logging
import os
from typing import Dict, Iterable, List, Optional, Tuple

from .base import BaseGpuProvider, ProviderCapacityUnavailableError, ProviderError
from .mock_adapter import MockGpuProvider
from .jarvislabs.adapter import JarvisLabsGpuProvider
from .types import ContainerConfig, GpuOffering

DEFAULT_ENABLED_PROVIDERS = "mock"


PRODUCTION_ENV_VALUES = {"production", "prod"}  # same values as inference.auth

logger = logging.getLogger("inferxe.providers")


def _enabled_from_env() -> List[str]:
    raw = os.getenv("GPU_PROVIDERS", DEFAULT_ENABLED_PROVIDERS)
    enabled = [p.strip().lower() for p in raw.split(",") if p.strip()]
    env_name = (os.getenv("INFERXE_ENV") or os.getenv("APP_ENV") or os.getenv("ENVIRONMENT") or "").strip().lower()
    if env_name in PRODUCTION_ENV_VALUES and "mock" in enabled:
        # The mock provider fabricates instances; customers must never be sold one.
        logger.error("GPU_PROVIDERS includes 'mock' in production; mock is disabled for new deployments.")
        enabled.remove("mock")
    return enabled


class ProviderRegistry:
    """Registry managing GPU provider adapters.

    Every registered provider stays reachable through get() so existing instances can always be stopped or
    terminated; only *enabled* providers (GPU_PROVIDERS, default "mock") are offered for new deployments.
    """

    def __init__(self, enabled: Optional[Iterable[str]] = None):
        self._providers: Dict[str, BaseGpuProvider] = {}
        self._enabled = [p.lower() for p in enabled] if enabled is not None else _enabled_from_env()
        # Pre-register default core adapters
        self.register(MockGpuProvider())
        self.register(JarvisLabsGpuProvider())

    def register(self, provider: BaseGpuProvider) -> None:
        """Register a provider instance."""
        self._providers[provider.provider_id.lower()] = provider

    def get(self, provider_id: str) -> BaseGpuProvider:
        """Retrieve a provider adapter by its slug."""
        clean_id = (provider_id or "").strip().lower()
        if clean_id in self._providers:
            return self._providers[clean_id]
        raise ProviderError(
            f"GPU Provider '{provider_id}' is not registered. Available: {list(self._providers.keys())}",
            provider_id=provider_id,
            status_code=400,
        )

    def list_providers(self) -> List[str]:
        """List registered provider IDs."""
        return list(self._providers.keys())

    def enabled_providers(self) -> List[BaseGpuProvider]:
        """Registered providers that may receive new deployments."""
        return [self._providers[p] for p in self._enabled if p in self._providers]

    async def list_offerings(self) -> List[GpuOffering]:
        """Normalized catalogue across all enabled providers."""
        offerings: List[GpuOffering] = []
        for provider in self.enabled_providers():
            offerings.extend(await provider.list_offerings())
        return offerings

    async def select_offering(
        self,
        gpu_id: str,
        provider_id: Optional[str] = None,
        region: Optional[str] = None,
        notebook: bool = False,
        container: Optional[ContainerConfig] = None,
    ) -> Tuple[BaseGpuProvider, GpuOffering]:
        """Pick the provider for a GPU: the one requested, else the cheapest enabled provider that has it available.
        Notebook workloads and custom containers only consider providers that can run them."""
        candidates = self.enabled_providers()
        if notebook or container is not None:
            candidates = [p for p in candidates if not p.unsupported_features(notebook=notebook, container=container)]
        if provider_id:
            clean = provider_id.strip().lower()
            candidates = [p for p in candidates if p.provider_id == clean]
            if not candidates:
                raise ProviderError(f"GPU Provider '{provider_id}' is not enabled", provider_id=provider_id, status_code=400)

        best: Optional[Tuple[BaseGpuProvider, GpuOffering]] = None
        for provider in candidates:
            for offer in await provider.list_offerings():
                if offer.gpu_id != gpu_id or not offer.is_available or offer.available_quantity <= 0:
                    continue
                if region and offer.region != region:
                    continue
                if best is None or offer.hourly_price_inr < best[1].hourly_price_inr:
                    best = (provider, offer)
        if best is None:
            raise ProviderCapacityUnavailableError(f"No enabled provider currently offers GPU '{gpu_id}'")
        return best


# Global singleton instance
_GLOBAL_REGISTRY = ProviderRegistry()


def get_registry() -> ProviderRegistry:
    return _GLOBAL_REGISTRY


def get_provider(provider_id: str = "jarvislabs") -> BaseGpuProvider:
    """Convenience getter for the global provider registry."""
    return _GLOBAL_REGISTRY.get(provider_id)


def list_available_providers() -> List[str]:
    """Return all currently registered provider slugs."""
    return _GLOBAL_REGISTRY.list_providers()
