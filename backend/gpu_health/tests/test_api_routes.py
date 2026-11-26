"""
Tests for GPU Health FastAPI Routes
===================================
Tests HTTP responses, payload validation, status codes, and error responses.
"""

import unittest
from fastapi.testclient import TestClient
from inference.main import app
from gpu_health.service import get_gpu_health_service
from gpu_health.collectors.mock_collector import MockGpuCollector
from gpu_health.core.engine import GpuHealthEngine


class TestGpuHealthApiRoutes(unittest.TestCase):

    def setUp(self):
        self.client = TestClient(app)
        # Force service to use deterministic mock collector for testing
        self.collector = MockGpuCollector()
        self.service = get_gpu_health_service()
        self.service.engine = GpuHealthEngine(collector=self.collector)

    def test_list_gpus_health_endpoint(self):
        """GET /api/v1/gpu/health returns list of detected GPUs with summary counts."""
        res = self.client.get("/api/v1/gpu/health")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("total_gpus", data)
        self.assertGreaterEqual(data["total_gpus"], 4)
        self.assertIn("healthy_count", data)
        self.assertIn("items", data)

    def test_get_specific_gpu_health(self):
        """GET /api/v1/gpu/health/{gpu_id} returns detailed HealthReport."""
        res = self.client.get("/api/v1/gpu/health/mock-gpu-0")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["gpu_id"], "mock-gpu-0")
        self.assertEqual(data["overall_status"], "healthy")
        self.assertIn("individual_checks", data)
        self.assertIn("device_info", data)

    def test_get_nonexistent_gpu_health_returns_404(self):
        """GET /api/v1/gpu/health/{unknown_id} returns 404 Not Found."""
        res = self.client.get("/api/v1/gpu/health/unknown-gpu-999")
        self.assertEqual(res.status_code, 404)
        self.assertIn("not found", res.json()["detail"].lower())

    def test_trigger_gpu_health_check(self):
        """POST /api/v1/gpu/health/{gpu_id}/check triggers synchronous health check."""
        res = self.client.post("/api/v1/gpu/health/mock-gpu-0/check", json={"persist_history": False})
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["gpu_id"], "mock-gpu-0")
        self.assertIsNotNone(data["health_score"])

    def test_check_deployment_readiness_endpoint(self):
        """POST /api/v1/gpu/health/{gpu_id}/readiness returns ReadinessResult."""
        payload = {
            "required_vram_bytes": 16 * (1024 ** 3),
            "required_runtime": "cuda",
            "min_health_score": 75.0,
            "max_acceptable_temp_celsius": 80.0,
            "allow_shared": False,
        }
        res = self.client.post("/api/v1/gpu/health/mock-gpu-0/readiness", json=payload)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(data["is_ready"])
        self.assertEqual(data["gpu_id"], "mock-gpu-0")

    def test_get_history_endpoint(self):
        """GET /api/v1/gpu/health/{gpu_id}/history returns history response."""
        res = self.client.get("/api/v1/gpu/health/mock-gpu-0/history")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["gpu_id"], "mock-gpu-0")
        self.assertIn("history", data)

    def test_get_fleet_wide_history_endpoint(self):
        """GET /api/v1/gpu/health/history returns fleet-wide audit history."""
        res = self.client.get("/api/v1/gpu/health/history?limit=10")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("total", data)
        self.assertIn("history", data)
        self.assertEqual(data["limit"], 10)


if __name__ == "__main__":
    unittest.main()
