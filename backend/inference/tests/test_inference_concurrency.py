"""
Concurrency control tests for the Inferxe Inference API.

Tests the inference request concurrency limiter:
- INFERENCE_MAX_CONCURRENCY and INFERENCE_QUEUE_SECONDS env vars
- Semaphore-based slot limiting
- 503 with Retry-After when at capacity
- Slot release on success, error, and queue timeout

Capacity tests run the real lifespan (`with TestClient(app)`) so the semaphore is created inside the
serving event loop, and hold a slot with a provider that blocks until released: a request that has
already finished frees its slot, so sequential requests can never observe a full limiter.

Run via:
  python -m pytest backend/inference/tests/test_inference_concurrency.py -v --tb=short
"""

import os
import sys
import threading
import time
import unittest
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

# Configure test environment before imports to prevent external connections
os.environ["DATABASE_URL"] = "sqlite:///:memory:"
os.environ["NVIDIA_API_KEY"] = "nvapi-test-dummy-key-for-unit-testing"
os.environ["INFERXE_TEST_MODE"] = "1"

BACKEND_DIR = Path(__file__).resolve().parents[2]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from fastapi.testclient import TestClient
from openai import APITimeoutError, RateLimitError

from inference.auth import generate_api_key
from inference.main import app
from inference.routes import inference_service
from inference.supabase_api_keys import SupabaseAPIKeyRepository, get_api_key_repository
from inference.supabase_config import (
    SupabaseConfigurationError,
    SupabaseSettings,
    get_inference_max_concurrency,
    get_inference_queue_seconds,
)
from inference.supabase_telemetry import SupabaseTelemetryRepository, get_telemetry_repository
from inference.tests.test_supabase_api_keys import MockSupabaseAPIKeysTransport
from inference.tests.test_supabase_telemetry import MockSupabaseTelemetryTransport

MOCK_RESULT = {
    "provider": "nvidia",
    "model": "nvidia/nemotron-3.5-bolt-e4b",
    "content": "Response",
    "finish_reason": "stop",
    "usage": {"prompt_tokens": 5, "completion_tokens": 5, "total_tokens": 10},
}


class _BlockingProvider:
    """`generate` replacement that holds its inference slot until `release` is set."""

    def __init__(self):
        self.started = threading.Event()
        self.release = threading.Event()
        self.calls = 0
        self._lock = threading.Lock()

    def __call__(self, **_kwargs):
        with self._lock:
            self.calls += 1
        self.started.set()
        if not self.release.wait(timeout=15):
            raise AssertionError("blocking provider was never released")
        return MOCK_RESULT


class TestInferenceConcurrency(unittest.TestCase):
    """Test concurrency limiting for inference requests."""

    def setUp(self):
        supabase_settings = SupabaseSettings(
            url="https://mock-inference-test.supabase.co",
            service_role_key="sb_secret_mock_inference_suite_key",
        )
        self.mock_supabase = MockSupabaseAPIKeysTransport()
        self.supabase_repo = SupabaseAPIKeyRepository(
            settings=supabase_settings,
            transport=self.mock_supabase,
        )
        self.mock_telemetry = MockSupabaseTelemetryTransport()
        self.telemetry_repo = SupabaseTelemetryRepository(
            settings=supabase_settings,
            transport=self.mock_telemetry,
        )
        app.dependency_overrides[get_api_key_repository] = lambda: self.supabase_repo
        app.dependency_overrides[get_telemetry_repository] = lambda: self.telemetry_repo

        self.valid_raw_key, self.valid_prefix, self.valid_hash = generate_api_key("live")
        self.mock_supabase.seed_row({
            "id": str(uuid.uuid4()),
            "user_id": "cognito_user_123",
            "name": "Valid Test Key",
            "key_prefix": self.valid_prefix,
            "secret_hash": self.valid_hash,
            "status": "active",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })

    def tearDown(self):
        app.dependency_overrides.clear()

    def _auth_headers(self):
        return {"Authorization": f"Bearer {self.valid_raw_key}"}

    @contextmanager
    def _limited_client(self, max_concurrency="1", queue_seconds="1"):
        """TestClient with the lifespan running, so app.state.inference_slots exists."""
        env = {"INFERENCE_MAX_CONCURRENCY": max_concurrency, "INFERENCE_QUEUE_SECONDS": queue_seconds}
        with patch.dict(os.environ, env):
            with TestClient(app, raise_server_exceptions=False) as client:
                yield client

    def _post_in_background(self, client, prompt, results):
        def run():
            results.append(client.post(
                "/api/v1/inference", json={"prompt": prompt}, headers=self._auth_headers()
            ))
        thread = threading.Thread(target=run, daemon=True)
        thread.start()
        return thread

    @contextmanager
    def _slot_held(self, client):
        """Occupy one slot with an in-flight request until the block exits; yields the provider."""
        provider = _BlockingProvider()
        holder_results = []
        with patch.object(inference_service.provider, "generate", side_effect=provider):
            holder = self._post_in_background(client, "Hold slot", holder_results)
            self.assertTrue(provider.started.wait(timeout=5), "holder request never reached the provider")
            try:
                yield provider
            finally:
                provider.release.set()
                holder.join(timeout=10)
        self.assertEqual([r.status_code for r in holder_results], [200])

    def test_normal_inference_still_works(self):
        """Inference succeeds on the limited path (lifespan created the semaphore)."""
        with self._limited_client(max_concurrency="8") as client:
            self.assertIsNotNone(app.state.inference_slots)
            with patch.object(inference_service.provider, "generate", return_value=MOCK_RESULT):
                resp = client.post(
                    "/api/v1/inference",
                    json={"prompt": "Hello", "max_tokens": 50, "temperature": 0.7},
                    headers=self._auth_headers(),
                )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertTrue(data["success"])
        self.assertEqual(data["response"], "Response")

    def test_concurrent_requests_respect_cap(self):
        """With the cap reached, another request gets 503 without calling the provider or writing telemetry."""
        with self._limited_client(max_concurrency="1", queue_seconds="1") as client:
            with self._slot_held(client) as provider:
                started = time.monotonic()
                resp = client.post(
                    "/api/v1/inference", json={"prompt": "Second"}, headers=self._auth_headers()
                )
                waited = time.monotonic() - started
                self.assertEqual(resp.status_code, 503)
                self.assertEqual(resp.headers.get("Retry-After"), "1")
                self.assertGreaterEqual(waited, 0.9)  # it queued for INFERENCE_QUEUE_SECONDS first
                self.assertEqual(provider.calls, 1)
                self.assertEqual(len(self.mock_telemetry.rows), 0)
            # Holder finished: exactly one telemetry row (the holder's), none for the rejected request.
            self.assertEqual(len(self.mock_telemetry.rows), 1)

            # The timed-out waiter did not leak a slot: the next request is admitted.
            with patch.object(inference_service.provider, "generate", return_value=MOCK_RESULT):
                resp = client.post(
                    "/api/v1/inference", json={"prompt": "After"}, headers=self._auth_headers()
                )
            self.assertEqual(resp.status_code, 200)

    def test_retry_after_header(self):
        """Retry-After carries INFERENCE_QUEUE_SECONDS."""
        with self._limited_client(max_concurrency="1", queue_seconds="2") as client:
            with self._slot_held(client):
                resp = client.post(
                    "/api/v1/inference", json={"prompt": "Second"}, headers=self._auth_headers()
                )
        self.assertEqual(resp.status_code, 503)
        self.assertEqual(resp.headers.get("Retry-After"), "2")

    def test_zero_queue_rejects_immediately_with_retry_after_one(self):
        """INFERENCE_QUEUE_SECONDS=0 rejects at once; Retry-After never advertises 0."""
        with self._limited_client(max_concurrency="1", queue_seconds="0") as client:
            with self._slot_held(client):
                started = time.monotonic()
                resp = client.post(
                    "/api/v1/inference", json={"prompt": "Second"}, headers=self._auth_headers()
                )
                waited = time.monotonic() - started
        self.assertEqual(resp.status_code, 503)
        self.assertEqual(resp.headers.get("Retry-After"), "1")
        self.assertLess(waited, 0.9)

    def test_queued_request_admitted_when_slot_frees(self):
        """A request waiting within the queue timeout runs once the slot is released."""
        with self._limited_client(max_concurrency="1", queue_seconds="5") as client:
            provider = _BlockingProvider()
            holder_results, waiter_results = [], []
            with patch.object(inference_service.provider, "generate", side_effect=provider):
                holder = self._post_in_background(client, "Hold slot", holder_results)
                self.assertTrue(provider.started.wait(timeout=5))
                waiter = self._post_in_background(client, "Waiter", waiter_results)
                time.sleep(0.3)  # waiter is now queued on the semaphore
                self.assertEqual(provider.calls, 1)
                provider.release.set()
                holder.join(timeout=10)
                waiter.join(timeout=10)
        self.assertEqual([r.status_code for r in holder_results], [200])
        self.assertEqual([r.status_code for r in waiter_results], [200])
        self.assertEqual(provider.calls, 2)

    def test_slot_released_after_provider_errors(self):
        """Provider failures (504, 429) release their slot: with cap=1 later requests still run."""
        timeout_err = APITimeoutError(request=MagicMock())
        rate_err = RateLimitError("Rate limit exceeded", response=MagicMock(status_code=429, headers={}), body=None)
        with self._limited_client(max_concurrency="1", queue_seconds="0") as client:
            for err, expected in ((timeout_err, 504), (rate_err, 429), (timeout_err, 504)):
                with patch.object(inference_service.provider, "generate", side_effect=err):
                    resp = client.post(
                        "/api/v1/inference", json={"prompt": "Fails"}, headers=self._auth_headers()
                    )
                self.assertEqual(resp.status_code, expected)
            with patch.object(inference_service.provider, "generate", return_value=MOCK_RESULT):
                resp = client.post(
                    "/api/v1/inference", json={"prompt": "Works"}, headers=self._auth_headers()
                )
            self.assertEqual(resp.status_code, 200)

    def test_slot_released_after_validation_rejection(self):
        """An unsupported model (422 raised inside execute_inference) releases its slot."""
        with self._limited_client(max_concurrency="1", queue_seconds="0") as client:
            resp = client.post(
                "/api/v1/inference",
                json={"prompt": "Hi", "model": "not/allowed-model"},
                headers=self._auth_headers(),
            )
            self.assertEqual(resp.status_code, 422)
            with patch.object(inference_service.provider, "generate", return_value=MOCK_RESULT):
                resp = client.post(
                    "/api/v1/inference", json={"prompt": "Works"}, headers=self._auth_headers()
                )
            self.assertEqual(resp.status_code, 200)

    def test_invalid_api_key_rejected_when_capacity_full(self):
        """Authentication runs before the slot wait: a bad key gets 401, not 503, while full."""
        with self._limited_client(max_concurrency="1", queue_seconds="1") as client:
            with self._slot_held(client):
                resp = client.post(
                    "/api/v1/inference",
                    json={"prompt": "Bad key"},
                    headers={"Authorization": "Bearer bad_key"},
                )
        self.assertEqual(resp.status_code, 401)

    def test_health_endpoint_responsive_when_slots_full(self):
        """Health answers while every inference slot is occupied."""
        with self._limited_client(max_concurrency="1", queue_seconds="1") as client:
            with self._slot_held(client):
                started = time.monotonic()
                resp = client.get("/api/v1/health")
                elapsed = time.monotonic() - started
        self.assertEqual(resp.status_code, 200)
        self.assertIn("status", resp.json())
        self.assertLess(elapsed, 2.0)

    def test_cap_bounds_simultaneous_provider_calls(self):
        """With cap=3 and 6 concurrent requests, at most 3 provider calls are ever in flight; all succeed."""
        state = {"now": 0, "peak": 0}
        lock = threading.Lock()

        def generate(**_kwargs):
            with lock:
                state["now"] += 1
                state["peak"] = max(state["peak"], state["now"])
            time.sleep(0.3)
            with lock:
                state["now"] -= 1
            return MOCK_RESULT

        results = []
        with self._limited_client(max_concurrency="3", queue_seconds="5") as client:
            with patch.object(inference_service.provider, "generate", side_effect=generate):
                threads = [self._post_in_background(client, f"req {i}", results) for i in range(6)]
                for t in threads:
                    t.join(timeout=15)
        self.assertEqual(sorted(r.status_code for r in results), [200] * 6)
        self.assertEqual(state["peak"], 3)
        self.assertEqual(len(self.mock_telemetry.rows), 6)

    def test_missing_limiter_fails_closed(self):
        """Without the lifespan there is no limiter: the route refuses instead of running unlimited."""
        client = TestClient(app, raise_server_exceptions=False)  # deliberately no `with`: lifespan not run
        with patch.object(inference_service.provider, "generate", return_value=MOCK_RESULT) as gen:
            resp = client.post("/api/v1/inference", json={"prompt": "x"}, headers=self._auth_headers())
        self.assertEqual(resp.status_code, 500)
        gen.assert_not_called()

    def test_lifespan_shutdown_clears_slots(self):
        """Shutdown drops the semaphore so no later client reuses one bound to a finished loop."""
        with self._limited_client():
            self.assertIsNotNone(app.state.inference_slots)
        self.assertIsNone(app.state.inference_slots)

    def test_invalid_concurrency_config_fails(self):
        """Invalid INFERENCE_MAX_CONCURRENCY values fail startup."""
        for bad in ("0", "33", "abc"):
            with patch.dict(os.environ, {"INFERENCE_MAX_CONCURRENCY": bad}):
                with self.assertRaises(SupabaseConfigurationError):
                    get_inference_max_concurrency()
        with patch.dict(os.environ, {"INFERENCE_MAX_CONCURRENCY": "0"}):
            with self.assertRaises(SupabaseConfigurationError):
                with TestClient(app):
                    pass

    def test_invalid_queue_seconds_config_fails(self):
        """Invalid INFERENCE_QUEUE_SECONDS values fail startup."""
        for bad in ("-1", "11", "xyz"):
            with patch.dict(os.environ, {"INFERENCE_QUEUE_SECONDS": bad}):
                with self.assertRaises(SupabaseConfigurationError):
                    get_inference_queue_seconds()


if __name__ == "__main__":
    unittest.main()
