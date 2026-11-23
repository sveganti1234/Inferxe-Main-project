"""
Unit & Contract Test Suite for GPU Provider Adapters
====================================================
Tests adherence to BaseGpuProvider contract, lifecycle state machine,
pricing normalization, and typed error handling.
"""

import sys
from pathlib import Path
import unittest
from unittest.mock import AsyncMock, MagicMock
import httpx

# Ensure backend root is on sys.path
BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from providers.types import (
    GpuOffering,
    ProvisionRequest,
    InstanceStatusEnum,
    PricingTypeEnum,
)
from providers.base import (
    BaseGpuProvider,
    ProviderAuthenticationError,
    ProviderCapacityUnavailableError,
    ProviderInstanceNotFoundError,
    ProviderQuotaExceededError,
    ProviderError,
)
from providers.mock_adapter import MockGpuProvider
from providers.jarvislabs.adapter import JarvisLabsGpuProvider
from providers.jarvislabs.client import JarvisLabsClient
from providers.registry import ProviderRegistry, get_provider, list_available_providers


class TestMockGpuProviderContract(unittest.IsolatedAsyncioTestCase):
    """Verifies that MockGpuProvider fulfills the BaseGpuProvider contract completely."""

    async def asyncSetUp(self):
        self.provider = MockGpuProvider()

    async def test_implements_interface(self):
        self.assertIsInstance(self.provider, BaseGpuProvider)
        self.assertEqual(self.provider.provider_id, "mock")
        self.assertEqual(self.provider.display_name, "Inferxe Mock Provider")

    async def test_list_offerings(self):
        offerings = await self.provider.list_offerings()
        self.assertIsInstance(offerings, list)
        self.assertGreaterEqual(len(offerings), 5)
        
        gpu_ids = {o.gpu_id for o in offerings}
        self.assertIn("l4", gpu_ids)
        self.assertIn("l40s", gpu_ids)
        self.assertIn("h100-sxm5", gpu_ids)

        h100 = next(o for o in offerings if o.gpu_id == "h100-sxm5")
        self.assertEqual(h100.vram_gb, 80)
        self.assertEqual(h100.architecture, "Hopper")
        self.assertEqual(h100.hourly_price_inr, 330.0)

    async def test_check_availability(self):
        avail = await self.provider.check_availability("h100-sxm5")
        self.assertTrue(avail)
        unavail = await self.provider.check_availability("non-existent-gpu-xyz")
        self.assertFalse(unavail)

    async def test_complete_instance_lifecycle(self):
        req = ProvisionRequest(
            deployment_id="dep-test-1234",
            customer_id="cust-test-5678",
            gpu_id="l40s",
            model_name="meta-llama/Llama-3.1-8B-Instruct",
            container_image="vllm/vllm-openai:latest",
            container_disk_gb=50,
        )

        # 1. Provision
        handle = await self.provider.provision_instance(req)
        self.assertIsNotNone(handle.instance_id)
        self.assertIsNotNone(handle.provider_instance_id)
        self.assertEqual(handle.status, InstanceStatusEnum.RUNNING)
        self.assertEqual(handle.hourly_price_inr, 118.0)
        self.assertTrue(handle.service_url.startswith("http://10.244."))

        # 2. Status
        status = await self.provider.get_instance_status(handle.provider_instance_id)
        self.assertEqual(status.status, InstanceStatusEnum.RUNNING)
        self.assertTrue(status.service_healthy)
        self.assertGreater(status.temperature_celsius, 0)

        # 3. Pause
        paused = await self.provider.pause_instance(handle.provider_instance_id)
        self.assertTrue(paused)
        paused_status = await self.provider.get_instance_status(handle.provider_instance_id)
        self.assertEqual(paused_status.status, InstanceStatusEnum.STOPPED)

        # 4. Resume
        resumed = await self.provider.resume_instance(handle.provider_instance_id)
        self.assertTrue(resumed)
        resumed_status = await self.provider.get_instance_status(handle.provider_instance_id)
        self.assertEqual(resumed_status.status, InstanceStatusEnum.RUNNING)

        # 5. Terminate
        terminated = await self.provider.terminate_instance(handle.provider_instance_id)
        self.assertTrue(terminated)
        term_status = await self.provider.get_instance_status(handle.provider_instance_id)
        self.assertEqual(term_status.status, InstanceStatusEnum.TERMINATED)

    async def test_provision_unavailable_raises_capacity_error(self):
        req = ProvisionRequest(
            deployment_id="dep-test-fail",
            customer_id="cust-test",
            gpu_id="b200-nvl72-unreleased",
            model_name="deepseek-ai/DeepSeek-R1",
        )
        with self.assertRaises(ProviderCapacityUnavailableError):
            await self.provider.provision_instance(req)


class TestJarvisLabsProviderAdapter(unittest.IsolatedAsyncioTestCase):
    """Verifies that JarvisLabsGpuProvider correctly maps payloads and handles errors."""

    async def asyncSetUp(self):
        self.mock_client = MagicMock(spec=JarvisLabsClient)
        self.mock_client.is_configured = True
        self.provider = JarvisLabsGpuProvider(client=self.mock_client)

    async def test_implements_interface(self):
        self.assertIsInstance(self.provider, BaseGpuProvider)
        self.assertEqual(self.provider.provider_id, "jarvislabs")
        self.assertEqual(self.provider.display_name, "JarvisLabs.ai")

    async def test_list_offerings_includes_both_on_demand_and_spot(self):
        offerings = await self.provider.list_offerings()
        self.assertGreaterEqual(len(offerings), 10)

        h100_ondemand = next(o for o in offerings if o.gpu_id == "h100-sxm5")
        self.assertEqual(h100_ondemand.hourly_price_inr, 330.0)
        self.assertEqual(h100_ondemand.pricing_type, PricingTypeEnum.ON_DEMAND)

        h100_spot = next(o for o in offerings if o.gpu_id == "h100-sxm5-spot")
        self.assertEqual(h100_spot.hourly_price_inr, 146.0)
        self.assertEqual(h100_spot.pricing_type, PricingTypeEnum.SPOT)

    async def test_unconfigured_client_fails_with_auth_error(self):
        unconfigured_client = MagicMock(spec=JarvisLabsClient)
        unconfigured_client.is_configured = False
        unconfigured_provider = JarvisLabsGpuProvider(client=unconfigured_client)

        req = ProvisionRequest(
            deployment_id="dep-1",
            customer_id="c-1",
            gpu_id="l4",
            model_name="test-model",
        )
        with self.assertRaises(ProviderAuthenticationError):
            await unconfigured_provider.provision_instance(req)

    async def test_provision_success_mapping(self):
        self.mock_client.create_instance = AsyncMock(return_value={
            "instance_id": "jl-inst-987654",
            "ip": "20.198.54.12",
            "ssh_port": 22022,
            "status": "creating",
        })

        req = ProvisionRequest(
            deployment_id="dep-real-001",
            customer_id="cust-100",
            gpu_id="l40s",
            model_name="Qwen/Qwen2.5-7B-Instruct",
            container_disk_gb=100,
        )

        handle = await self.provider.provision_instance(req)
        self.assertEqual(handle.provider_instance_id, "jl-inst-987654")
        self.assertEqual(handle.provider_id, "jarvislabs")
        self.assertEqual(handle.status, InstanceStatusEnum.INITIALIZING)
        self.assertEqual(handle.host_ip, "20.198.54.12")
        self.assertEqual(handle.service_url, "http://20.198.54.12:8000/v1")
        self.assertEqual(handle.hourly_price_inr, 118.0)

    async def test_status_mapping(self):
        self.mock_client.get_instance = AsyncMock(return_value={
            "instance_id": "jl-inst-987654",
            "status": "running",
            "duration": 3600,
            "gpu_utilization": 88.5,
            "memory_used": 42.0,
            "temperature": 72.0,
            "power_draw": 310.0,
        })

        status = await self.provider.get_instance_status("jl-inst-987654")
        self.assertEqual(status.status, InstanceStatusEnum.RUNNING)
        self.assertEqual(status.uptime_seconds, 3600)
        self.assertEqual(status.gpu_utilization_pct, 88.5)
        self.assertEqual(status.memory_used_gb, 42.0)
        self.assertTrue(status.service_healthy)

    async def test_http_error_mapping(self):
        req_mock = MagicMock()
        
        # 401 Unauthorized
        resp_401 = httpx.Response(401, json={"error": "Invalid API token"}, request=req_mock)
        self.mock_client.get_instance = AsyncMock(side_effect=httpx.HTTPStatusError("Auth error", request=req_mock, response=resp_401))
        with self.assertRaises(ProviderAuthenticationError):
            await self.provider.get_instance_status("inst-1")

        # 404 Not Found
        resp_404 = httpx.Response(404, json={"error": "Instance not found"}, request=req_mock)
        self.mock_client.get_instance = AsyncMock(side_effect=httpx.HTTPStatusError("Not found", request=req_mock, response=resp_404))
        with self.assertRaises(ProviderInstanceNotFoundError):
            await self.provider.get_instance_status("inst-unknown")

        # 429 Quota Exceeded
        resp_429 = httpx.Response(429, json={"error": "GPU quota reached"}, request=req_mock)
        self.mock_client.get_instance = AsyncMock(side_effect=httpx.HTTPStatusError("Quota", request=req_mock, response=resp_429))
        with self.assertRaises(ProviderQuotaExceededError):
            await self.provider.get_instance_status("inst-1")

        # 503 Capacity Unavailable
        resp_503 = httpx.Response(503, json={"error": "No GPUs available in region"}, request=req_mock)
        self.mock_client.create_instance = AsyncMock(side_effect=httpx.HTTPStatusError("Capacity", request=req_mock, response=resp_503))
        req = ProvisionRequest(deployment_id="d1", customer_id="c1", gpu_id="h100-sxm5", model_name="m1")
        with self.assertRaises(ProviderCapacityUnavailableError):
            await self.provider.provision_instance(req)


class TestProviderRegistry(unittest.TestCase):
    """Verifies provider lookup and registration."""

    def test_default_providers_registered(self):
        registry = ProviderRegistry()
        providers = registry.list_providers()
        self.assertIn("mock", providers)
        self.assertIn("jarvislabs", providers)

    def test_get_provider_success(self):
        mock_p = get_provider("mock")
        self.assertEqual(mock_p.provider_id, "mock")

        jl_p = get_provider("jarvislabs")
        self.assertEqual(jl_p.provider_id, "jarvislabs")

    def test_get_unknown_provider_raises_error(self):
        with self.assertRaises(ProviderError) as ctx:
            get_provider("aws-non-existent")
        self.assertEqual(ctx.exception.status_code, 400)


if __name__ == "__main__":
    unittest.main()
