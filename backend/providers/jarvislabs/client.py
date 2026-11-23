"""
JarvisLabs.ai HTTP API Client
=============================
Handles raw authenticated REST communication with JarvisLabs Cloud API.
"""

import os
from typing import Any, Dict, Optional
import httpx


class JarvisLabsClient:
    """Async client for the JarvisLabs Cloud REST API."""

    def __init__(
        self,
        api_key: Optional[str] = None,
        user_id: Optional[str] = None,
        base_url: Optional[str] = None,
        timeout: float = 30.0,
    ):
        self.api_key = api_key or os.getenv("JARVISLABS_API_KEY", "")
        self.user_id = user_id or os.getenv("JARVISLABS_USER_ID", "")
        self.base_url = (base_url or os.getenv("JARVISLABS_API_BASE_URL", "https://api.jarvislabs.ai/v1")).rstrip("/")
        self.timeout = timeout

    @property
    def is_configured(self) -> bool:
        return bool(self.api_key)

    def _get_headers(self) -> Dict[str, str]:
        if not self.api_key:
            raise ValueError("JARVISLABS_API_KEY is not configured")
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "User-Agent": "Inferxe-ControlPlane/2.0",
        }

    async def get_templates(self) -> Dict[str, Any]:
        """Fetch available container templates and base images."""
        url = f"{self.base_url}/templates"
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.get(url, headers=self._get_headers())
            resp.raise_for_status()
            return resp.json()

    async def get_gpu_types(self) -> Dict[str, Any]:
        """Fetch available machine configurations, GPU architectures, and live pricing."""
        url = f"{self.base_url}/gpu_types"
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.get(url, headers=self._get_headers())
            resp.raise_for_status()
            return resp.json()

    async def create_instance(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Request new GPU compute instance allocation."""
        url = f"{self.base_url}/instances"
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.post(url, headers=self._get_headers(), json=payload)
            resp.raise_for_status()
            return resp.json()

    async def get_instance(self, instance_id: str) -> Dict[str, Any]:
        """Fetch real-time state, host IP, and endpoints for an instance."""
        url = f"{self.base_url}/instances/{instance_id}"
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.get(url, headers=self._get_headers())
            resp.raise_for_status()
            return resp.json()

    async def pause_instance(self, instance_id: str) -> Dict[str, Any]:
        """Pause execution to halt GPU compute charges while preserving disk."""
        url = f"{self.base_url}/instances/{instance_id}/pause"
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.post(url, headers=self._get_headers())
            resp.raise_for_status()
            return resp.json()

    async def resume_instance(self, instance_id: str) -> Dict[str, Any]:
        """Resume a paused GPU instance."""
        url = f"{self.base_url}/instances/{instance_id}/resume"
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.post(url, headers=self._get_headers())
            resp.raise_for_status()
            return resp.json()

    async def destroy_instance(self, instance_id: str) -> Dict[str, Any]:
        """Permanently tear down and release GPU resources."""
        url = f"{self.base_url}/instances/{instance_id}"
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.delete(url, headers=self._get_headers())
            resp.raise_for_status()
            return resp.json()
