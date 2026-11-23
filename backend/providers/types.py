"""
Data Models for GPU Provider Adapter Framework
==============================================
Standardized data contracts for hardware listings, provisioning intents,
instance handles, and live hardware status across cloud providers.
"""

from datetime import datetime, timezone
from enum import Enum
from typing import Dict, Optional, List
from pydantic import BaseModel, Field


class InstanceStatusEnum(str, Enum):
    """Lifecycle state machine for provisioned GPU instances."""
    PENDING = "PENDING"
    INITIALIZING = "INITIALIZING"
    RUNNING = "RUNNING"
    STOPPING = "STOPPING"
    STOPPED = "STOPPED"
    TERMINATING = "TERMINATING"
    TERMINATED = "TERMINATED"
    FAILED = "FAILED"


class PricingTypeEnum(str, Enum):
    """GPU instance pricing tier."""
    ON_DEMAND = "on_demand"
    SPOT = "spot"


class GpuOffering(BaseModel):
    """Normalized hardware offering from a GPU provider."""
    gpu_id: str = Field(..., description="Unique GPU model key, e.g. 'h100-sxm5', 'l40s'")
    name: str = Field(..., description="Human-readable GPU name, e.g. 'NVIDIA H100 SXM5'")
    provider_id: str = Field(..., description="Provider identifier, e.g. 'jarvislabs', 'mock'")
    vram_gb: int = Field(..., description="Total VRAM in Gigabytes")
    memory_bandwidth_gbps: float = Field(..., description="Memory bandwidth in GB/s")
    architecture: str = Field(..., description="Architecture family, e.g. 'Hopper', 'Ada Lovelace'")
    tensor_tflops_fp16: float = Field(..., description="Peak FP16/BF16 Tensor TFLOPS")
    tensor_tflops_fp8: float = Field(..., description="Peak FP8 Tensor TFLOPS")
    hourly_price_inr: float = Field(..., description="Estimated or list rate per hour in INR")
    hourly_price_usd: float = Field(..., description="Rate per hour in USD")
    pricing_type: PricingTypeEnum = Field(default=PricingTypeEnum.ON_DEMAND)
    region: str = Field(..., description="Datacenter region, e.g. 'in-south-1', 'eu-central-1'")
    available_quantity: int = Field(default=0, description="Available instance count")
    is_available: bool = Field(default=True, description="Whether instances can currently be ordered")


class ProvisionRequest(BaseModel):
    """Request payload to provision a GPU instance for model serving."""
    deployment_id: str = Field(..., description="Inferxe deployment identifier (UUID)")
    customer_id: str = Field(..., description="Authenticated customer identifier")
    gpu_id: str = Field(..., description="Requested GPU type key, e.g. 'l40s', 'h100-sxm5'")
    provider_id: str = Field(default="jarvislabs", description="Target cloud provider")
    model_name: str = Field(..., description="Model identifier to serve, e.g. 'meta-llama/Llama-3.1-8B-Instruct'")
    container_image: str = Field(default="vllm/vllm-openai:latest", description="Docker image for model serving")
    container_disk_gb: int = Field(default=50, description="Allocated fast storage in GB")
    env_vars: Dict[str, str] = Field(default_factory=dict, description="Environment variables for the container")
    pricing_type: PricingTypeEnum = Field(default=PricingTypeEnum.ON_DEMAND)
    region_preference: Optional[str] = Field(default=None, description="Preferred datacenter region")
    auto_stop_minutes: Optional[int] = Field(default=60, description="Inactivity timeout before auto-stop")


class InstanceHandle(BaseModel):
    """Unified descriptor representing an allocated GPU instance."""
    instance_id: str = Field(..., description="Inferxe internal instance ID")
    provider_instance_id: str = Field(..., description="External instance ID from provider API")
    provider_id: str = Field(..., description="Provider identifier ('jarvislabs', 'mock')")
    gpu_id: str = Field(..., description="Allocated GPU model")
    status: InstanceStatusEnum = Field(..., description="Current lifecycle state")
    host_ip: Optional[str] = Field(default=None, description="Public IP address of instance")
    ssh_port: Optional[int] = Field(default=None, description="Public SSH port for direct access")
    service_url: Optional[str] = Field(default=None, description="Base HTTP URL for model inference")
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    hourly_price_inr: float = Field(..., description="Agreed hourly rate in INR")
    hourly_price_usd: float = Field(..., description="Agreed hourly rate in USD")
    error_message: Optional[str] = Field(default=None, description="Error reason if state is FAILED")


class InstanceStatus(BaseModel):
    """Real-time telemetry and health status of an active GPU instance."""
    instance_id: str = Field(..., description="Inferxe instance ID")
    provider_instance_id: str = Field(..., description="External provider instance ID")
    status: InstanceStatusEnum = Field(..., description="Current state")
    uptime_seconds: int = Field(default=0, description="Instance execution runtime in seconds")
    gpu_utilization_pct: Optional[float] = Field(default=None, description="Compute utilization percentage (0-100)")
    memory_used_gb: Optional[float] = Field(default=None, description="Allocated VRAM in GB")
    temperature_celsius: Optional[float] = Field(default=None, description="GPU core temperature")
    power_draw_watts: Optional[float] = Field(default=None, description="Current power draw in Watts")
    service_healthy: bool = Field(default=False, description="Whether the inference HTTP port responds ok")
    error_message: Optional[str] = Field(default=None)
