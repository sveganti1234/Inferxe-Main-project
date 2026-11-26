"""
Core Data Types & Pydantic Contracts for GPU Health Engine
==========================================================
Defines standardized data contracts for hardware representation, telemetry,
health status, individual check outcomes, and deployment readiness.
"""

from datetime import datetime, timezone
from enum import Enum
from typing import Dict, List, Optional, Any, Set
from pydantic import BaseModel, Field, ConfigDict


class HealthStatus(str, Enum):
    """Overall physical and operational health state of a GPU device."""
    HEALTHY = "healthy"
    WARNING = "warning"
    CRITICAL = "critical"
    UNKNOWN = "unknown"
    UNAVAILABLE = "unavailable"


class CheckResultStatus(str, Enum):
    """Result of an individual health check evaluation."""
    PASSED = "passed"
    FAILED = "failed"
    WARNING = "warning"
    UNSUPPORTED = "unsupported"
    UNAVAILABLE = "unavailable"


class AvailabilityStatus(str, Enum):
    """Current allocation and operational availability of the GPU."""
    AVAILABLE = "available"
    BUSY = "busy"
    ALLOCATED = "allocated"
    DRAINING = "draining"
    OFFLINE = "offline"


class MetricCapability(str, Enum):
    """Hardware telemetry capabilities supported by a device/driver."""
    ACCESSIBILITY = "accessibility"
    DRIVER = "driver"
    MEMORY_INFO = "memory_info"
    MEMORY_ALLOCATION = "memory_allocation"
    COMPUTE = "compute"
    THERMAL = "thermal"
    UTILIZATION = "utilization"
    POWER = "power"
    ECC_ERRORS = "ecc_errors"
    CLOCKS = "clocks"
    PCIE = "pcie"


class GpuDeviceInfo(BaseModel):
    """Static and detected metadata for an individual GPU device."""
    model_config = ConfigDict(extra="ignore")

    gpu_id: str = Field(..., description="Unique logical or assigned identifier, e.g. 'gpu-0', 'cuda:0'")
    device_index: int = Field(default=0, description="Hardware index on the host system")
    vendor: str = Field(..., description="Hardware vendor name, e.g. 'NVIDIA', 'AMD', 'Intel', 'Generic'")
    model: str = Field(..., description="Detected hardware model name, e.g. 'NVIDIA H100 SXM5', 'Generic GPU'")
    total_vram_bytes: int = Field(..., description="Total installed physical VRAM in bytes")
    driver_version: Optional[str] = Field(default=None, description="Kernel or system driver version")
    runtime_version: Optional[str] = Field(default=None, description="Compute runtime version, e.g. 'CUDA 12.4', 'ROCm 6.0'")
    pci_bus_id: Optional[str] = Field(default=None, description="PCIe bus identifier, e.g. '0000:01:00.0'")
    capabilities: List[MetricCapability] = Field(
        default_factory=list,
        description="Declared monitoring capabilities available for this device"
    )

    @property
    def total_vram_gb(self) -> float:
        """Helper to return VRAM in gigabytes."""
        return round(self.total_vram_bytes / (1024 ** 3), 2)


class GpuMetrics(BaseModel):
    """Real-time hardware telemetry captured during a health check cycle."""
    model_config = ConfigDict(extra="ignore")

    gpu_id: str = Field(..., description="Target GPU identifier")
    vram_used_bytes: Optional[int] = Field(default=None, description="Allocated VRAM in bytes")
    vram_free_bytes: Optional[int] = Field(default=None, description="Free VRAM in bytes")
    temperature_celsius: Optional[float] = Field(default=None, description="Core silicon temperature in °C")
    memory_temperature_celsius: Optional[float] = Field(default=None, description="VRAM / HBM temperature in °C")
    gpu_utilization_pct: Optional[float] = Field(default=None, description="Compute core utilization (0-100%)")
    memory_utilization_pct: Optional[float] = Field(default=None, description="Memory controller utilization (0-100%)")
    power_draw_watts: Optional[float] = Field(default=None, description="Current power consumption in Watts")
    power_limit_watts: Optional[float] = Field(default=None, description="Configured power management limit in Watts")
    ecc_uncorrectable_errors: Optional[int] = Field(default=None, description="Count of double-bit uncorrectable ECC errors")
    ecc_correctable_errors: Optional[int] = Field(default=None, description="Count of single-bit correctable ECC errors")
    fan_speed_pct: Optional[float] = Field(default=None, description="Fan speed percentage (0-100%)")
    throttle_reasons: List[str] = Field(default_factory=list, description="Active thermal, power, or clock throttling flags")
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    @property
    def vram_usage_pct(self) -> Optional[float]:
        """Calculates VRAM utilization percentage if total capacity is derivable."""
        if self.vram_used_bytes is not None and self.vram_free_bytes is not None:
            total = self.vram_used_bytes + self.vram_free_bytes
            if total > 0:
                return round((self.vram_used_bytes / total) * 100.0, 2)
        return None


class CheckResult(BaseModel):
    """Evaluation result for an individual health check."""
    model_config = ConfigDict(extra="ignore")

    check_name: str = Field(..., description="Identifier of the executed check, e.g. 'thermal', 'memory'")
    status: CheckResultStatus = Field(..., description="Outcome of the check")
    message: str = Field(..., description="Human-readable summary of the check finding")
    metrics: Dict[str, Any] = Field(default_factory=dict, description="Telemetry data captured during this check")
    duration_ms: float = Field(default=0.0, description="Duration in milliseconds to run this check")
    threshold_applied: Optional[Dict[str, Any]] = Field(default=None, description="Configured thresholds used for evaluation")
    error: Optional[str] = Field(default=None, description="Exception or error message if status is FAILED or UNAVAILABLE")


class HealthReport(BaseModel):
    """Standardized composite health report for a GPU device."""
    model_config = ConfigDict(extra="ignore")

    gpu_id: str = Field(..., description="Evaluated GPU identifier")
    device_info: GpuDeviceInfo = Field(..., description="Static device characteristics")
    overall_status: HealthStatus = Field(..., description="Composite health determination")
    health_score: Optional[float] = Field(default=None, description="Normalized health score 0.0-100.0 (None if insufficient metrics)")
    availability_status: AvailabilityStatus = Field(default=AvailabilityStatus.AVAILABLE, description="Workload allocation state")
    is_deployment_ready: bool = Field(default=True, description="Generic readiness flag (healthy and not busy/failing)")
    individual_checks: List[CheckResult] = Field(default_factory=list, description="Detailed outcomes of every executed check")
    supported_metrics: List[str] = Field(default_factory=list, description="Names of metrics supported and inspected")
    unsupported_metrics: List[str] = Field(default_factory=list, description="Names of metrics unsupported by hardware/driver")
    errors: List[str] = Field(default_factory=list, description="Collection of error summaries observed")
    recommendations: List[str] = Field(default_factory=list, description="Actionable maintenance or scheduling recommendations")
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    execution_duration_ms: float = Field(default=0.0, description="Total execution duration of the health check cycle in ms")


class DeploymentRequirement(BaseModel):
    """Requested resource specifications for a model serving or compute deployment."""
    model_config = ConfigDict(extra="ignore")

    required_vram_bytes: int = Field(..., description="Minimum free VRAM required in bytes")
    required_runtime: Optional[str] = Field(default=None, description="Expected compute runtime, e.g. 'cuda', 'rocm'")
    min_health_score: float = Field(default=75.0, description="Minimum allowable health score to accept deployment")
    max_acceptable_temp_celsius: float = Field(default=82.0, description="Max current core temperature acceptable before starting")
    allow_shared: bool = Field(default=False, description="Whether to allow sharing with existing processes")


class ReadinessResult(BaseModel):
    """Result of evaluating a GPU's readiness for a specific deployment request."""
    model_config = ConfigDict(extra="ignore")

    gpu_id: str = Field(..., description="Target GPU identifier")
    is_ready: bool = Field(..., description="True if the GPU is fully capable and ready to accept the workload")
    overall_status: HealthStatus = Field(..., description="Current physical health status of the GPU")
    availability_status: AvailabilityStatus = Field(..., description="Current availability state")
    reasons: List[str] = Field(default_factory=list, description="Explanations supporting the readiness determination")
    missing_requirements: List[str] = Field(default_factory=list, description="Keys of requirements that could not be satisfied")
    current_vram_available_bytes: Optional[int] = Field(default=None, description="Currently unallocated VRAM")
    current_temp_celsius: Optional[float] = Field(default=None, description="Current temperature")
