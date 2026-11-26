"""
Hardware Telemetry Collectors
==============================
Pluggable adapters for querying GPU metrics and running bounded functional tests.
"""

from .mock_collector import MockGpuCollector
from .nvidia_collector import NvidiaGpuCollector
from .registry import CollectorRegistry, get_default_collector

__all__ = [
    "MockGpuCollector",
    "NvidiaGpuCollector",
    "CollectorRegistry",
    "get_default_collector",
]
