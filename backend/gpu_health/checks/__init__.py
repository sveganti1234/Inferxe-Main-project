"""
Modular Health Check Implementations
====================================
Factory functions and registration helpers for the standard health check suite.
"""

from typing import List
try:
    from gpu_health.core.checks import BaseHealthCheck
except ImportError:
    from ..core.checks import BaseHealthCheck  # type: ignore
from .accessibility_check import AccessibilityCheck
from .driver_check import DriverCheck
from .memory_check import MemoryCheck
from .compute_check import ComputeCheck
from .thermal_check import ThermalCheck
from .utilization_check import UtilizationCheck
from .error_check import ErrorCheck


def get_standard_checks() -> List[BaseHealthCheck]:
    """Instantiate and return the standard battery of health checks."""
    return [
        AccessibilityCheck(),
        DriverCheck(),
        MemoryCheck(),
        ComputeCheck(),
        ThermalCheck(),
        UtilizationCheck(),
        ErrorCheck(),
    ]


__all__ = [
    "AccessibilityCheck",
    "DriverCheck",
    "MemoryCheck",
    "ComputeCheck",
    "ThermalCheck",
    "UtilizationCheck",
    "ErrorCheck",
    "get_standard_checks",
]
