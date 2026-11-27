"""
End-to-end GPU deployment flow on the mock provider: catalogue, provider selection, SSH key delivery,
provisioning, lifecycle, failure handling and cleanup. No real provider or database is touched.
"""

import asyncio
import base64
import json
import os
import sys
import time
import unittest
import uuid
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

os.environ["INFERXE_TEST_MODE"] = "1"
os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
BACKEND_DIR = Path(__file__).resolve().parents[2]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from fastapi.testclient import TestClient  # noqa: E402

from inference.gpu_deployment_service import (  # noqa: E402
    DeploymentNotFoundError,
    DeploymentProvisioningError,
    DeploymentRequestError,
    DeploymentStateError,
    GpuDeploymentService,
)
from inference.main import app  # noqa: E402
from inference.routes import get_gpu_deployment_service  # noqa: E402
from inference.supabase_config import SupabaseSettings  # noqa: E402
from inference.supabase_deployments import (  # noqa: E402
    DeploymentConflictError,
    DeploymentStoreError,
    DeploymentStoreUnavailableError,
    SupabaseDeploymentRepository,
)
from providers.base import ProviderCapacityUnavailableError, ProviderError, ProviderTimeoutError  # noqa: E402
from providers.registry import ProviderRegistry  # noqa: E402
from providers.types import InstanceStatusEnum  # noqa: E402

PUBKEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBhR9sGt4h2bNnS7m1y5xq3TQ9c3gJ0wq3c0k8l6vL2s alice@laptop"


class InMemoryDeploymentRepo:
    """Same contract as SupabaseDeploymentRepository, backed by a dict."""

    def __init__(self):
        self.rows = {}
        self.fail_updates = False

    def create(self, row):
        key = row.get("idempotency_key")
        if key and any(r["user_id"] == row["user_id"] and r.get("idempotency_key") == key for r in self.rows.values()):
            raise DeploymentConflictError("duplicate")
        stored = {"created_at": "2026-11-25T00:00:00+00:00", "updated_at": None, "provider_instance_id": None,
                  "ssh_host": None, "ssh_port": None, "ssh_username": None, "endpoint_url": None,
                  "error_message": None, **row}
        self.rows[row["id"]] = stored
        return dict(stored)

    def get(self, user_id, deployment_id):
        row = self.rows.get(str(deployment_id))
        return dict(row) if row and row["user_id"] == user_id else None

    def get_by_idempotency_key(self, user_id, key):
        return next((dict(r) for r in self.rows.values()
                     if r["user_id"] == user_id and r.get("idempotency_key") == key), None)

    def list(self, user_id):
        return [dict(r) for r in self.rows.values() if r["user_id"] == user_id and r.get("provider_id")]

    def update(self, user_id, deployment_id, fields):
        if self.fail_updates:
            raise DeploymentStoreUnavailableError("db down")
        row = self.rows.get(str(deployment_id))
        if not row or row["user_id"] != user_id:
            return None
        row.update(fields)
        return dict(row)


class FakeSshRepo:
    def __init__(self):
        self.keys = {}

    def add(self, user_id, public_key=PUBKEY):
        key_id = uuid.uuid4()
        self.keys[(user_id, key_id)] = SimpleNamespace(id=key_id, public_key=public_key, fingerprint="SHA256:test" + str(key_id)[:6])
        return key_id

    def get_ssh_key_by_id(self, user_id, key_id):
        return self.keys.get((user_id, key_id))


def make_service(enabled=("mock",), timeout=5.0):
    registry = ProviderRegistry(enabled=list(enabled))
    repo, ssh = InMemoryDeploymentRepo(), FakeSshRepo()
    return GpuDeploymentService(repo=repo, ssh_repo=ssh, registry=registry, provider_timeout=timeout), repo, ssh, registry


class TestCatalogueAndSelection(unittest.TestCase):
    def test_offerings_come_only_from_enabled_providers(self):
        service, *_ = make_service(enabled=("mock",))
        offerings = service.list_offerings()
        self.assertTrue(offerings)
        self.assertEqual({o.provider_id for o in offerings}, {"mock"})

    def test_cheapest_enabled_provider_wins_unless_one_is_requested(self):
        registry = ProviderRegistry(enabled=["mock", "jarvislabs"])
        provider, offer = asyncio.run(registry.select_offering("a100-80gb"))
        self.assertEqual((provider.provider_id, offer.hourly_price_inr), ("mock", 220.0))  # jarvislabs lists 235
        provider, offer = asyncio.run(registry.select_offering("a100-80gb", provider_id="jarvislabs"))
        self.assertEqual((provider.provider_id, offer.hourly_price_inr), ("jarvislabs", 235.0))

    def test_unknown_gpu_and_disabled_provider_are_rejected(self):
        registry = ProviderRegistry(enabled=["mock"])
        with self.assertRaises(ProviderCapacityUnavailableError):
            asyncio.run(registry.select_offering("tpu-v5"))
        with self.assertRaises(ProviderError):
            asyncio.run(registry.select_offering("l4", provider_id="jarvislabs"))


class TestProvisioning(unittest.TestCase):
    def test_launch_delivers_ssh_key_and_stores_instance_details(self):
        service, repo, ssh, registry = make_service()
        key_id = ssh.add("alice")
        row = service.create("alice", name="llm", model_name="Qwen/Qwen2.5-7B-Instruct", gpu_id="l40s", ssh_key_ids=[key_id])

        self.assertEqual(row["status"], "running")
        self.assertEqual(row["provider_id"], "mock")
        self.assertEqual(row["hourly_rate"], 118.0)  # server-side price from the offering
        self.assertTrue(row["provider_instance_id"].startswith("mock-inst-"))
        self.assertEqual((row["ssh_port"], row["ssh_username"]), (2222, "ubuntu"))
        self.assertTrue(row["ssh_host"])
        self.assertEqual(row["metadata"]["ssh_keys"][0]["id"], str(key_id))
        mock = registry.get("mock")
        self.assertEqual(mock.authorized_keys[row["provider_instance_id"]], [PUBKEY])

    def test_ssh_key_of_another_customer_is_rejected_before_anything_is_created(self):
        service, repo, ssh, registry = make_service()
        bobs_key = ssh.add("bob")
        with self.assertRaises(DeploymentRequestError):
            service.create("alice", name="x", model_name="m", gpu_id="l4", ssh_key_ids=[bobs_key])
        self.assertEqual(repo.rows, {})
        self.assertEqual(registry.get("mock")._instances, {})

    def test_ssh_keys_refused_for_provider_without_support(self):
        service, repo, ssh, _ = make_service(enabled=("jarvislabs",))
        key_id = ssh.add("alice")
        with self.assertRaises(DeploymentRequestError):
            service.create("alice", name="x", model_name="m", gpu_id="l4", ssh_key_ids=[key_id])
        self.assertEqual(repo.rows, {})

    def test_idempotency_key_returns_same_deployment_without_second_instance(self):
        service, repo, _, registry = make_service()
        first = service.create("alice", name="x", model_name="m", gpu_id="l4", idempotency_key="retry-key-123")
        second = service.create("alice", name="x", model_name="m", gpu_id="l4", idempotency_key="retry-key-123")
        self.assertEqual(first["id"], second["id"])
        self.assertEqual(len(registry.get("mock")._instances), 1)

    def test_provider_failure_marks_deployment_failed(self):
        service, repo, _, registry = make_service()
        registry.get("mock").provision_instance = AsyncMock(side_effect=ProviderError("boom", provider_id="mock"))
        with self.assertRaises(DeploymentProvisioningError) as ctx:
            service.create("alice", name="x", model_name="m", gpu_id="l4")
        stored = repo.rows[ctx.exception.deployment["id"]]
        self.assertEqual(stored["status"], "failed")
        self.assertEqual(stored["error_message"], "boom")

    def test_provider_timeout_marks_failed_and_flags_manual_check(self):
        service, repo, _, registry = make_service(timeout=0.05)

        async def slow(_request):
            await asyncio.sleep(1)

        registry.get("mock").provision_instance = slow
        with self.assertRaises(DeploymentProvisioningError) as ctx:
            service.create("alice", name="x", model_name="m", gpu_id="l4")
        self.assertIsInstance(ctx.exception.cause, ProviderTimeoutError)
        stored = repo.rows[ctx.exception.deployment["id"]]
        self.assertEqual(stored["status"], "failed")
        self.assertIn("manual check", stored["error_message"])

    def test_instance_is_released_when_it_cannot_be_recorded(self):
        service, repo, _, registry = make_service()
        mock = registry.get("mock")
        repo.fail_updates = True
        with self.assertRaises(DeploymentStoreError):
            service.create("alice", name="x", model_name="m", gpu_id="l4")
        (instance,) = mock._instances.values()
        self.assertEqual(instance.status, InstanceStatusEnum.TERMINATED)


class TestLifecycle(unittest.TestCase):
    def setUp(self):
        self.service, self.repo, _, self.registry = make_service()
        self.dep = self.service.create("alice", name="x", model_name="m", gpu_id="l4")

    def test_stop_resume_terminate(self):
        dep_id = self.dep["id"]
        self.assertEqual(self.service.stop("alice", dep_id)["status"], "stopped")
        with self.assertRaises(DeploymentStateError):
            self.service.stop("alice", dep_id)
        self.assertEqual(self.service.resume("alice", dep_id)["status"], "running")
        terminated = self.service.terminate("alice", dep_id)
        self.assertEqual(terminated["status"], "terminated")
        self.assertIsNotNone(terminated["stopped_at"])
        self.assertEqual(self.service.terminate("alice", dep_id)["status"], "terminated")  # idempotent
        instance = self.registry.get("mock")._instances[self.dep["provider_instance_id"]]
        self.assertEqual(instance.status, InstanceStatusEnum.TERMINATED)

    def test_get_marks_vanished_instance_terminated(self):
        self.registry.get("mock")._instances.clear()
        row = self.service.get("alice", self.dep["id"])
        self.assertEqual(row["status"], "terminated")

    def test_other_customers_cannot_see_or_act(self):
        for action in (self.service.get, self.service.stop, self.service.terminate):
            with self.assertRaises(DeploymentNotFoundError):
                action("bob", self.dep["id"])

    def test_list_refreshes_only_provisioning_rows(self):
        self.repo.rows[self.dep["id"]]["status"] = "provisioning"  # as a real provider reports right after create
        status_calls = AsyncMock(wraps=self.registry.get("mock").get_instance_status)
        self.registry.get("mock").get_instance_status = status_calls
        self.assertEqual(self.service.list("alice")[0]["status"], "running")
        self.service.list("alice")  # now running: no further provider call
        self.assertEqual(status_calls.await_count, 1)

    def test_status_sync_failure_keeps_stored_state(self):
        self.registry.get("mock").get_instance_status = AsyncMock(side_effect=ProviderError("down"))
        self.assertEqual(self.service.get("alice", self.dep["id"])["status"], "running")

    def test_unregistered_provider_row_does_not_break_the_list(self):
        self.repo.rows[self.dep["id"]].update(status="provisioning", provider_id="retired-provider")
        self.assertEqual(self.service.list("alice")[0]["status"], "provisioning")


class TestMockDisabledInProduction(unittest.TestCase):
    def test_mock_is_never_offered_in_production(self):
        from unittest.mock import patch
        with patch.dict(os.environ, {"GPU_PROVIDERS": "mock,jarvislabs", "INFERXE_ENV": "production"}):
            self.assertEqual([p.provider_id for p in ProviderRegistry().enabled_providers()], ["jarvislabs"])
        with patch.dict(os.environ, {"GPU_PROVIDERS": "mock", "INFERXE_ENV": "development"}):
            self.assertEqual([p.provider_id for p in ProviderRegistry().enabled_providers()], ["mock"])


def _jwt(sub):
    enc = lambda d: base64.urlsafe_b64encode(json.dumps(d).encode()).decode().rstrip("=")  # noqa: E731
    return f"{enc({'alg': 'RS256', 'typ': 'JWT'})}.{enc({'sub': sub, 'token_use': 'id', 'exp': int(time.time()) + 3600})}.sig"


class TestApi(unittest.TestCase):
    def setUp(self):
        self.service, self.repo, self.ssh, self.registry = make_service()
        app.dependency_overrides[get_gpu_deployment_service] = lambda: self.service
        self.client = TestClient(app)
        self.auth = {"Authorization": f"Bearer {_jwt('alice')}"}

    def tearDown(self):
        app.dependency_overrides.clear()

    def test_full_flow_over_http(self):
        offerings = self.client.get("/api/v1/gpu/offerings").json()["offerings"]
        self.assertIn("l40s", {o["gpu_id"] for o in offerings})

        key_id = self.ssh.add("alice")
        resp = self.client.post("/api/v1/gpu/deployments", headers=self.auth, json={
            "name": "llm", "model_name": "m", "gpu_id": "l40s", "ssh_key_ids": [str(key_id)],
        })
        self.assertEqual(resp.status_code, 201, resp.text)
        body = resp.json()
        self.assertEqual(body["status"], "running")
        self.assertEqual(body["ssh"]["command"], f"ssh -p 2222 ubuntu@{body['ssh']['host']}")
        self.assertEqual(body["ssh_key_ids"], [str(key_id)])

        dep_url = f"/api/v1/gpu/deployments/{body['id']}"
        self.assertEqual(self.client.get("/api/v1/gpu/deployments", headers=self.auth).json()["deployments"][0]["id"], body["id"])
        self.assertEqual(self.client.post(dep_url + "/stop", headers=self.auth).json()["status"], "stopped")
        self.assertIsNone(self.client.get(dep_url, headers=self.auth).json()["ssh"])  # no SSH details while stopped
        self.assertEqual(self.client.post(dep_url + "/resume", headers=self.auth).json()["status"], "running")
        self.assertEqual(self.client.delete(dep_url, headers=self.auth).json()["status"], "terminated")
        other = {"Authorization": f"Bearer {_jwt('bob')}"}
        self.assertEqual(self.client.get(dep_url, headers=other).status_code, 404)

    def test_requires_login_and_valid_input(self):
        self.assertEqual(self.client.post("/api/v1/gpu/deployments", json={"name": "x", "model_name": "m", "gpu_id": "l4"}).status_code, 401)
        bad = self.client.post("/api/v1/gpu/deployments", headers=self.auth,
                               json={"name": "x", "model_name": "m", "gpu_id": "l4", "ssh_key_ids": ["not-a-uuid"]})
        self.assertEqual(bad.status_code, 422)
        self.assertEqual(self.client.post("/api/v1/gpu/deployments", headers=self.auth,
                                          json={"name": "x", "model_name": "m", "gpu_id": "tpu"}).status_code, 409)

    def test_provider_failure_returns_failed_deployment_without_leaking_provider_text(self):
        self.registry.get("mock").provision_instance = AsyncMock(side_effect=ProviderError("secret upstream detail"))
        resp = self.client.post("/api/v1/gpu/deployments", headers=self.auth, json={"name": "x", "model_name": "m", "gpu_id": "l4"})
        self.assertEqual(resp.status_code, 502)
        detail = resp.json()["detail"]
        self.assertEqual(detail["deployment"]["status"], "failed")
        self.assertNotIn("secret upstream detail", detail["message"])


class TestSupabaseRepository(unittest.TestCase):
    def setUp(self):
        self.calls = []
        self.response = (200, {}, b"[]")
        settings = SupabaseSettings(url="https://deploy-test.supabase.co", service_role_key="sb_secret_" + "deploy_test")

        def transport(method, url, headers, body, timeout):
            self.calls.append((method, url, body))
            if isinstance(self.response, Exception):
                raise self.response
            return self.response

        self.repo = SupabaseDeploymentRepository(settings=settings, transport=transport)

    def test_reads_and_writes_are_scoped_to_the_user(self):
        dep_id = str(uuid.uuid4())
        self.repo.get("alice", dep_id)
        self.repo.update("alice", dep_id, {"status": "running"})
        for method, url, _ in self.calls:
            self.assertIn("user_id=eq.alice", url)
            self.assertIn(f"id=eq.{dep_id}", url)
        self.assertEqual(self.calls[1][0], "PATCH")

    def test_errors_are_classified(self):
        self.response = (409, {}, json.dumps({"code": "23505", "message": "duplicate"}).encode())
        with self.assertRaises(DeploymentConflictError):
            self.repo.create({"id": "x"})
        self.response = TimeoutError()
        with self.assertRaises(DeploymentStoreUnavailableError):
            self.repo.list("alice")
        self.assertIsNone(self.repo.get("alice", "not-a-uuid"))


if __name__ == "__main__":
    unittest.main()
