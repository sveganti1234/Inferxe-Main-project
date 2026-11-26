"""
Collector Registry
==================
Central discovery and instantiation registry for GPU telemetry collectors.
"""

from typing import Dict, List, Optional
try:
    from gpu_health.core.collector import BaseGpuCollector
except ImportError:
    from ..core.collector import BaseGpuCollector  # type: ignore
from .mock_collector import MockGpuCollector
from .nvidia_collector import NvidiaGpuCollector


class CollectorRegistry:
    """Registry maintaining active GPU telemetry collectors."""

    def __init__(self):
        self._collectors: Dict[str, BaseGpuCollector] = {}
        # Pre-register core collectors
        self.register(MockGpuCollector())
        self.register(NvidiaGpuCollector())

    def register(self, collector: BaseGpuCollector) -> None:
        """Register a new collector adapter."""
        self._collectors[collector.collector_id.lower()] = collector

    def get(self, collector_id: str) -> BaseGpuCollector:
        """Fetch collector by id."""
        key = collector_id.lower()
        if key not in self._collectors:
            raise KeyError(f"Collector '{collector_id}' is not registered. Available: {list(self._collectors.keys())}")
        return self._collectors[key]

    def list_collectors(self) -> List[str]:
        """List registered collector keys."""
        return list(self._collectors.keys())

    def get_preferred_collector(self) -> BaseGpuCollector:
        """
        Return live hardware collector if available (e.g. nvidia),
        otherwise fall back to mock collector for local test/dev environments.
        """
        nvidia = self._collectors.get("nvidia")
        if nvidia and nvidia.is_available():
            return nvidia
        return self._collectors.get("mock", MockGpuCollector())


# Global singleton registry
_GLOBAL_REGISTRY = CollectorRegistry()


def get_default_collector() -> BaseGpuCollector:
    """Convenience accessor for preferred collector."""
    return _GLOBAL_REGISTRY.get_preferred_collector()


def get_collector(collector_id: str) -> BaseGpuCollector:
    """Fetch specific collector by ID."""
    return _GLOBAL_REGISTRY.get(collector_id)
