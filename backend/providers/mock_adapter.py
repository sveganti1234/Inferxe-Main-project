"""
Mock GPU Provider Adapter
=========================
Deterministic in-memory implementation of BaseGpuProvider for local testing,
offline development, and CI verification without requiring live API keys.
"""

import time
import uuid
from typing import Dict, List, Optional
from datetime import datetime, timezone

from .base import (
    BaseGpuProvider,
    ProviderCapacityUnavailableError,
    ProviderInstanceNotFoundError,
)
from .types import (
    GpuOffering,
    ProvisionRequest,
    InstanceHandle,
    InstanceStatus,
    InstanceStatusEnum,
    PricingTypeEnum,
)


class MockGpuProvider(BaseGpuProvider):
    """Deterministic in-memory GPU provider adapter."""

    supports_ssh_keys = True
    supports_notebooks = True
    supports_custom_images = True
    supports_exposed_ports = True

    MOCK_PUBLIC_PORT_BASE = 40000

    def __init__(self):
        self._instances: Dict[str, InstanceHandle] = {}
        self._start_times: Dict[str, float] = {}
        # What a real host would hold in ~/.ssh/authorized_keys; lets tests assert key delivery.
        self.authorized_keys: Dict[str, List[str]] = {}
        # The container a real host would run (image, env, published ports); lets tests assert propagation.
        self.containers: Dict[str, Dict] = {}

    @property
    def provider_id(self) -> str:
        return "mock"

    @property
    def display_name(self) -> str:
        return "Inferxe Mock Provider"

    async def list_offerings(self) -> List[GpuOffering]:
        """Returns standard DPR reference GPU hardware catalogue."""
        return [
            GpuOffering(
                gpu_id="l4",
                name="NVIDIA L4 Tensor Core",
                provider_id=self.provider_id,
                vram_gb=24,
                memory_bandwidth_gbps=300.0,
                architecture="Ada Lovelace",
                tensor_tflops_fp16=242.0,
                tensor_tflops_fp8=485.0,
                hourly_price_inr=41.0,
                hourly_price_usd=0.44,
                pricing_type=PricingTypeEnum.ON_DEMAND,
                region="in-south-1",
                available_quantity=16,
                is_available=True,
            ),
            GpuOffering(
                gpu_id="l40s",
                name="NVIDIA L40S Tensor Core",
                provider_id=self.provider_id,
                vram_gb=48,
                memory_bandwidth_gbps=864.0,
                architecture="Ada Lovelace",
                tensor_tflops_fp16=733.0,
                tensor_tflops_fp8=1466.0,
                hourly_price_inr=118.0,
                hourly_price_usd=1.25,
                pricing_type=PricingTypeEnum.ON_DEMAND,
                region="in-south-1",
                available_quantity=24,
                is_available=True,
            ),
            GpuOffering(
                gpu_id="h100-sxm5",
                name="NVIDIA H100 SXM5",
                provider_id=self.provider_id,
                vram_gb=80,
                memory_bandwidth_gbps=3350.0,
                architecture="Hopper",
                tensor_tflops_fp16=989.0,
                tensor_tflops_fp8=1979.0,
                hourly_price_inr=330.0,
                hourly_price_usd=3.49,
                pricing_type=PricingTypeEnum.ON_DEMAND,
                region="in-south-1",
                available_quantity=8,
                is_available=True,
            ),
            GpuOffering(
                gpu_id="a100-80gb",
                name="NVIDIA A100 PCIe 80GB",
                provider_id=self.provider_id,
                vram_gb=80,
                memory_bandwidth_gbps=2039.0,
                architecture="Ampere",
                tensor_tflops_fp16=312.0,
                tensor_tflops_fp8=624.0,
                hourly_price_inr=220.0,
                hourly_price_usd=2.60,
                pricing_type=PricingTypeEnum.ON_DEMAND,
                region="in-south-1",
                available_quantity=12,
                is_available=True,
            ),
            GpuOffering(
                gpu_id="rtx-4090",
                name="NVIDIA GeForce RTX 4090",
                provider_id=self.provider_id,
                vram_gb=24,
                memory_bandwidth_gbps=1008.0,
                architecture="Ada Lovelace",
                tensor_tflops_fp16=330.0,
                tensor_tflops_fp8=660.0,
                hourly_price_inr=65.0,
                hourly_price_usd=0.75,
                pricing_type=PricingTypeEnum.ON_DEMAND,
                region="in-south-1",
                available_quantity=32,
                is_available=True,
            ),
        ]

    async def check_availability(self, gpu_id: str, region: Optional[str] = None) -> bool:
        offerings = await self.list_offerings()
        for off in offerings:
            if off.gpu_id == gpu_id:
                if region and off.region != region:
                    continue
                return off.is_available and off.available_quantity > 0
        return False

    async def provision_instance(self, request: ProvisionRequest) -> InstanceHandle:
        offerings = await self.list_offerings()
        offering = next((o for o in offerings if o.gpu_id == request.gpu_id), None)
        if not offering or not offering.is_available:
            raise ProviderCapacityUnavailableError(
                f"GPU type '{request.gpu_id}' is unavailable at {self.display_name}",
                provider_id=self.provider_id
            )

        provider_id_str = f"mock-inst-{uuid.uuid4().hex[:12]}"
        now = datetime.now(timezone.utc)
        mock_ip = f"10.244.{hash(provider_id_str) % 250 + 1}.42"

        handle = InstanceHandle(
            instance_id=f"inst-{uuid.uuid4().hex[:12]}",
            provider_instance_id=provider_id_str,
            provider_id=self.provider_id,
            gpu_id=request.gpu_id,
            status=InstanceStatusEnum.RUNNING,
            host_ip=mock_ip,
            ssh_port=2222,
            ssh_username="ubuntu",
            service_url=f"http://{mock_ip}:8000/v1",
            port_mappings={p.container_port: self.MOCK_PUBLIC_PORT_BASE + i for i, p in enumerate(request.service_ports)},
            created_at=now,
            hourly_price_inr=offering.hourly_price_inr,
            hourly_price_usd=offering.hourly_price_usd,
        )

        self._instances[provider_id_str] = handle
        self._start_times[provider_id_str] = time.time()
        self.authorized_keys[provider_id_str] = list(request.ssh_public_keys)
        self.containers[provider_id_str] = {
            "image": request.container_image,
            "env_vars": dict(request.env_vars),
            "service_ports": [p.model_copy() for p in request.service_ports],
        }
        return handle

    async def get_instance_status(self, provider_instance_id: str) -> InstanceStatus:
        if provider_instance_id not in self._instances:
            raise ProviderInstanceNotFoundError(
                f"Instance '{provider_instance_id}' not found",
                provider_id=self.provider_id
            )

        handle = self._instances[provider_instance_id]
        start_t = self._start_times.get(provider_instance_id, time.time())
        uptime = int(time.time() - start_t)

        return InstanceStatus(
            instance_id=handle.instance_id,
            provider_instance_id=provider_instance_id,
            status=handle.status,
            uptime_seconds=uptime,
            gpu_utilization_pct=42.5 if handle.status == InstanceStatusEnum.RUNNING else 0.0,
            memory_used_gb=14.2 if handle.status == InstanceStatusEnum.RUNNING else 0.0,
            temperature_celsius=65.0 if handle.status == InstanceStatusEnum.RUNNING else 35.0,
            power_draw_watts=185.0 if handle.status == InstanceStatusEnum.RUNNING else 20.0,
            service_healthy=handle.status == InstanceStatusEnum.RUNNING,
            host_ip=handle.host_ip,
            ssh_port=handle.ssh_port,
            port_mappings=dict(handle.port_mappings),
        )

    async def pause_instance(self, provider_instance_id: str) -> bool:
        if provider_instance_id not in self._instances:
            raise ProviderInstanceNotFoundError(f"Instance '{provider_instance_id}' not found", provider_id=self.provider_id)
        handle = self._instances[provider_instance_id]
        self._instances[provider_instance_id] = handle.model_copy(update={"status": InstanceStatusEnum.STOPPED})
        return True

    async def resume_instance(self, provider_instance_id: str) -> bool:
        if provider_instance_id not in self._instances:
            raise ProviderInstanceNotFoundError(f"Instance '{provider_instance_id}' not found", provider_id=self.provider_id)
        handle = self._instances[provider_instance_id]
        self._instances[provider_instance_id] = handle.model_copy(update={"status": InstanceStatusEnum.RUNNING})
        return True

    async def terminate_instance(self, provider_instance_id: str) -> bool:
        if provider_instance_id not in self._instances:
            raise ProviderInstanceNotFoundError(f"Instance '{provider_instance_id}' not found", provider_id=self.provider_id)
        handle = self._instances[provider_instance_id]
        self._instances[provider_instance_id] = handle.model_copy(update={"status": InstanceStatusEnum.TERMINATED})
        return True
