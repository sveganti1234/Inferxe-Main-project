"""
test_routing_routes.py
======================
Integration unit tests for DPR Routing and Hardware Telemetry API routes.
"""

import sys
import uuid
from pathlib import Path
import unittest
from unittest.mock import MagicMock, patch
from fastapi.testclient import TestClient

BACKEND_DIR = Path(__file__).resolve().parents[2]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from inference.main import app
from inference.auth import require_cognito_user
from inference.supabase_notebooks import SupabaseNotebookRecord


class TestRoutingAndTelemetryRoutes(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def tearDown(self):
        app.dependency_overrides.clear()

    def test_routing_recommendation_endpoint(self):
        payload = {
            "model_id": "llama-3.1-8b",
            "quantization": "fp16",
            "context_tokens": 4096,
            "concurrency": 2,
            "priority": "cost",
            "budget_inr_hr": 350.0,
            "min_tokens_per_sec": 0.0,
        }
        res = self.client.post("/api/v1/routing/recommend", json=payload)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(data["success"])
        self.assertIn("memory_breakdown", data)
        self.assertGreater(data["memory_breakdown"]["weights_gb"], 15.0)
        self.assertIn("recommended_placement", data)
        self.assertIsNotNone(data["recommended_placement"])
        self.assertIn("candidates", data)
        self.assertGreaterEqual(len(data["candidates"]), 5)

    def test_routing_catalogue_endpoint(self):
        res = self.client.get("/api/v1/routing/catalogue")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(data["success"])
        self.assertGreaterEqual(len(data["models"]), 5)
        self.assertGreaterEqual(len(data["hardware"]), 4)

    def test_live_hardware_telemetry_endpoint(self):
        res = self.client.get("/api/v1/telemetry/hardware")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(data["success"])
        self.assertTrue(data["is_simulated"])
        self.assertIn("clusters", data)
        self.assertGreaterEqual(len(data["clusters"]), 2)
        h100 = data["clusters"][0]["gpus"][0]
        self.assertGreater(h100["avg_temp_c"], 40.0)
        self.assertGreater(h100["power_w"], 200.0)

    @patch("inference.routes.get_notebook_logs")
    def test_notebook_runtime_logs_endpoint(self, mock_get_logs):
        test_id = str(uuid.uuid4())
        mock_get_logs.return_value = {
            "notebook_id": test_id,
            "name": "Dev Notebook",
            "status": "running",
            "logs": [
                {"timestamp": "2026-11-23 09:40:01", "level": "INFO", "message": "Container initialized"}
            ],
            "is_simulated": True,
        }
        app.dependency_overrides[require_cognito_user] = lambda: "test-user-uuid"
        res = self.client.get(
            f"/api/v1/notebooks/{test_id}/logs",
            headers={"Authorization": "Bearer mock-cognito-token"},
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(data["success"])
        self.assertEqual(data["notebook_id"], test_id)
        self.assertEqual(len(data["logs"]), 1)


if __name__ == "__main__":
    unittest.main()
