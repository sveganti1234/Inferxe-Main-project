"""
Configuration and Thresholds for GPU Health Engine
==================================================
Configurable thresholds for thermal, memory, utilization, and execution timeouts.
Allows fine-tuning without hardcoding values or assuming all GPUs share identical limits.
"""

from typing import Optional, Dict, Any
from pydantic import BaseModel, Field, ConfigDict


class HealthThresholds(BaseModel):
    """Configurable boundaries and thresholds for health scoring and evaluation."""
    model_config = ConfigDict(extra="ignore")

    # Thermal thresholds (°C)
    warning_temp_celsius: float = Field(
        default=78.0,
        description="Temperature above which status becomes WARNING (if no hardware throttle)"
    )
    critical_temp_celsius: float = Field(
        default=88.0,
        description="Temperature above which status becomes CRITICAL"
    )

    # Memory utilization thresholds (%)
    warning_vram_pct: float = Field(
        default=85.0,
        description="VRAM utilization percentage triggering a WARNING state"
    )
    critical_vram_pct: float = Field(
        default=95.0,
        description="VRAM utilization percentage triggering a CRITICAL or saturated state"
    )

    # Compute utilization thresholds (%)
    warning_utilization_pct: float = Field(
        default=92.0,
        description="Sustained GPU compute core utilization triggering a WARNING"
    )

    # Timeout limits (seconds)
    check_timeout_seconds: float = Field(
        default=5.0,
        description="Maximum execution timeout for any single micro-check"
    )
    overall_timeout_seconds: float = Field(
        default=15.0,
        description="Maximum execution timeout for the entire health evaluation cycle"
    )

    # Safe bounded tests
    safe_alloc_test_bytes: int = Field(
        default=16 * 1024 * 1024,  # 16 MB
        description="Safe bounded memory allocation size for memory functional check"
    )
    min_acceptable_score: float = Field(
        default=70.0,
        description="Minimum score threshold for considering a GPU healthy"
    )

    def to_dict(self) -> Dict[str, Any]:
        """Serialize thresholds to dictionary."""
        return self.model_dump()

    @classmethod
    def default(cls) -> "HealthThresholds":
        """Factory method returning default threshold settings."""
        return cls()
