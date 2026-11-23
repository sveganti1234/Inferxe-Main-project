"""
GPU Provider Registry
=====================
Centralized registry for discovering, instantiating, and caching GPU cloud provider adapters.
"""

from typing import Dict, List, Optional
from .base import BaseGpuProvider, ProviderError
from .mock_adapter import MockGpuProvider
from .jarvislabs.adapter import JarvisLabsGpuProvider


class ProviderRegistry:
    """Singleton registry managing active GPU provider adapters."""

    def __init__(self):
        self._providers: Dict[str, BaseGpuProvider] = {}
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


# Global singleton instance
_GLOBAL_REGISTRY = ProviderRegistry()


def get_provider(provider_id: str = "jarvislabs") -> BaseGpuProvider:
    """Convenience getter for the global provider registry."""
    return _GLOBAL_REGISTRY.get(provider_id)


def list_available_providers() -> List[str]:
    """Return all currently registered provider slugs."""
    return _GLOBAL_REGISTRY.list_providers()
