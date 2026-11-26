"""
Abstract Base Collector Interface
=================================
Defines the contract for hardware-specific or simulated telemetry collectors.
"""

from abc import ABC, abstractmethod
from typing import List, Optional, Set
from .types import GpuDeviceInfo, GpuMetrics, MetricCapability


class CollectorError(Exception):
    """Base exception for telemetry collection errors."""
    def __init__(self, message: str, collector_id: str = ""):
        super().__init__(message)
        self.message = message
        self.collector_id = collector_id


class CollectorUnavailableError(CollectorError):
    """Raised when collector driver or runtime libraries cannot be loaded."""
    pass


class DeviceNotFoundError(CollectorError):
    """Raised when querying a GPU device that does not exist on the system."""
    pass


class BaseGpuCollector(ABC):
    """Abstract interface defining operations for GPU telemetry and device discovery."""

    @property
    @abstractmethod
    def collector_id(self) -> str:
        """Unique collector identifier, e.g. 'nvidia_nvml', 'mock', 'rocm_smi'."""
        pass

    @property
    @abstractmethod
    def vendor_name(self) -> str:
        """Vendor handled by this collector, e.g. 'NVIDIA', 'AMD', 'Generic'."""
        pass

    @abstractmethod
    def is_available(self) -> bool:
        """Check whether the necessary driver, tools, or libraries are installed and accessible."""
        pass

    @abstractmethod
    async def detect_devices(self) -> List[GpuDeviceInfo]:
        """Discover and enumerate all GPU devices accessible via this collector."""
        pass

    @abstractmethod
    async def get_device_info(self, gpu_id: str) -> GpuDeviceInfo:
        """Retrieve static hardware specification and capabilities for a specific GPU ID."""
        pass

    @abstractmethod
    async def collect_metrics(self, gpu_id: str) -> GpuMetrics:
        """Scrape current real-time telemetry metrics for the specified GPU."""
        pass

    @abstractmethod
    async def test_memory_allocation(self, gpu_id: str, size_bytes: int, timeout_seconds: float) -> bool:
        """Perform a safe, bounded test memory allocation and immediate release."""
        pass

    @abstractmethod
    async def test_compute(self, gpu_id: str, timeout_seconds: float) -> bool:
        """Perform a safe, bounded micro-compute operation (e.g. matrix multiplication)."""
        pass
