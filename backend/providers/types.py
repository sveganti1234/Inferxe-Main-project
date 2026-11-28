"""
Data Models for GPU Provider Adapter Framework
==============================================
Standardized data contracts for hardware listings, provisioning intents,
instance handles, and live hardware status across cloud providers.
"""

import re
from datetime import datetime, timezone
from enum import Enum
from typing import Dict, Literal, Optional, List
from pydantic import BaseModel, ConfigDict, Field, field_validator

# Model-serving image used when a deployment does not ask for its own container (normal GPU deployments).
DEFAULT_SERVING_IMAGE = "vllm/vllm-openai:latest"

# [registry[:port]/]path[:tag][@sha256:digest], lowercase path as Docker requires.
_IMAGE_RE = re.compile(
    r"^(?:[a-z0-9.-]+(?::[0-9]{1,5})?/)?"
    r"[a-z0-9]+(?:[._-][a-z0-9]+)*(?:/[a-z0-9]+(?:[._-][a-z0-9]+)*)*"
    r"(?::[A-Za-z0-9_][A-Za-z0-9_.-]{0,127})?(?:@sha256:[a-f0-9]{64})?$"
)
_ENV_KEY_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,127}$")
MAX_ENV_VARS = 32
MAX_ENV_VALUE_LENGTH = 4096
MAX_SERVICE_PORTS = 8
RESERVED_CONTAINER_PORTS = frozenset({22})  # SSH access is delivered by the provider, not a service port


def validate_container_image(image: str) -> str:
    if not isinstance(image, str) or len(image) > 255 or not _IMAGE_RE.fullmatch(image):
        raise ValueError("container image must be a valid image reference, e.g. 'registry.example.com/team/image:tag'")
    return image


def validate_env_vars(env: Dict[str, str]) -> Dict[str, str]:
    if len(env) > MAX_ENV_VARS:
        raise ValueError(f"at most {MAX_ENV_VARS} environment variables are allowed")
    for key, value in env.items():
        if not _ENV_KEY_RE.fullmatch(key):
            raise ValueError("environment variable names must match [A-Za-z_][A-Za-z0-9_]*")
        # Messages never echo values: they may hold secrets.
        if len(value) > MAX_ENV_VALUE_LENGTH or "\x00" in value:
            raise ValueError(f"environment variable '{key}' has an invalid value")
    return env


class ServicePort(BaseModel):
    """A container port the workload serves on; the provider maps it to a public port."""
    name: str = Field(..., pattern=r"^[a-z][a-z0-9-]{0,30}$", description="Service label, e.g. 'notebook'")
    container_port: int = Field(..., ge=1, le=65535)
    protocol: Literal["http", "tcp"] = "http"

    @field_validator("container_port")
    @classmethod
    def not_reserved(cls, v: int) -> int:
        if v in RESERVED_CONTAINER_PORTS:
            raise ValueError(f"container port {v} is reserved")
        return v


def validate_service_ports(ports: List[ServicePort]) -> List[ServicePort]:
    if len(ports) > MAX_SERVICE_PORTS:
        raise ValueError(f"at most {MAX_SERVICE_PORTS} service ports are allowed")
    if len({p.container_port for p in ports}) != len(ports) or len({p.name for p in ports}) != len(ports):
        raise ValueError("service port names and container ports must be unique")
    return ports


class ContainerConfig(BaseModel):
    """Workload-specific container settings chosen by the server (e.g. notebooks), never by the client."""
    model_config = ConfigDict(hide_input_in_errors=True)  # validation errors must not echo env values

    image: str
    env_vars: Dict[str, str] = Field(default_factory=dict, repr=False)
    service_ports: List[ServicePort] = Field(default_factory=list)

    @field_validator("image")
    @classmethod
    def check_image(cls, v: str) -> str:
        return validate_container_image(v)

    @field_validator("env_vars")
    @classmethod
    def check_env(cls, v: Dict[str, str]) -> Dict[str, str]:
        return validate_env_vars(v)

    @field_validator("service_ports")
    @classmethod
    def check_ports(cls, v: List[ServicePort]) -> List[ServicePort]:
        return validate_service_ports(v)


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
    model_config = ConfigDict(hide_input_in_errors=True)  # validation errors must not echo env values

    deployment_id: str = Field(..., description="Inferxe deployment identifier (UUID)")
    customer_id: str = Field(..., description="Authenticated customer identifier")
    gpu_id: str = Field(..., description="Requested GPU type key, e.g. 'l40s', 'h100-sxm5'")
    provider_id: str = Field(default="jarvislabs", description="Target cloud provider")
    model_name: str = Field(..., description="Model identifier to serve, e.g. 'meta-llama/Llama-3.1-8B-Instruct'")
    container_image: str = Field(default=DEFAULT_SERVING_IMAGE, description="Docker image for the workload")
    container_disk_gb: int = Field(default=50, description="Allocated fast storage in GB")
    env_vars: Dict[str, str] = Field(default_factory=dict, repr=False, description="Environment variables for the container")
    service_ports: List[ServicePort] = Field(default_factory=list, description="Container ports to expose publicly")
    pricing_type: PricingTypeEnum = Field(default=PricingTypeEnum.ON_DEMAND)
    region_preference: Optional[str] = Field(default=None, description="Preferred datacenter region")
    auto_stop_minutes: Optional[int] = Field(default=60, description="Inactivity timeout before auto-stop")
    ssh_public_keys: List[str] = Field(default_factory=list, description="Validated OpenSSH public keys to authorize on the instance")

    @field_validator("container_image")
    @classmethod
    def check_image(cls, v: str) -> str:
        return validate_container_image(v)

    @field_validator("env_vars")
    @classmethod
    def check_env(cls, v: Dict[str, str]) -> Dict[str, str]:
        return validate_env_vars(v)

    @field_validator("service_ports")
    @classmethod
    def check_ports(cls, v: List[ServicePort]) -> List[ServicePort]:
        return validate_service_ports(v)


class InstanceHandle(BaseModel):
    """Unified descriptor representing an allocated GPU instance."""
    instance_id: str = Field(..., description="Inferxe internal instance ID")
    provider_instance_id: str = Field(..., description="External instance ID from provider API")
    provider_id: str = Field(..., description="Provider identifier ('jarvislabs', 'mock')")
    gpu_id: str = Field(..., description="Allocated GPU model")
    status: InstanceStatusEnum = Field(..., description="Current lifecycle state")
    host_ip: Optional[str] = Field(default=None, description="Public IP address of instance")
    ssh_port: Optional[int] = Field(default=None, description="Public SSH port for direct access")
    ssh_username: Optional[str] = Field(default=None, description="Login user for SSH access")
    service_url: Optional[str] = Field(default=None, description="Base HTTP URL for model inference")
    port_mappings: Dict[int, int] = Field(default_factory=dict, description="Container port -> public port on host_ip")
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
    host_ip: Optional[str] = Field(default=None, description="Public IP, when the provider reports it (often only once running)")
    ssh_port: Optional[int] = Field(default=None, description="Public SSH port, when reported")
    port_mappings: Dict[int, int] = Field(default_factory=dict, description="Container port -> public port, when reported")
    error_message: Optional[str] = Field(default=None)
