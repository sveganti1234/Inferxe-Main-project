"""
Phase 1 notebook integration: a notebook created with gpu_id launches a real GPU deployment through
GpuDeploymentService (mock provider here) and stores its deployment_id, provider id and status.

Covers successful provisioning, idempotency (including retries after gateway timeouts), provider
incompatibility, invalid SSH keys, provider failures, notebook database failures and lifecycle operations.
No real provider or database is touched.
"""

import dataclasses
import hashlib
import json
import os
import sys
import unittest
import uuid
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import AsyncMock, patch

os.environ["INFERXE_TEST_MODE"] = "1"
os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
BACKEND_DIR = Path(__file__).resolve().parents[2]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from fastapi.testclient import TestClient  # noqa: E402

from inference.main import app  # noqa: E402
from inference.notebook_service import (  # noqa: E402
    NOTEBOOK_IDEMPOTENCY_PREFIX,
    NotebookError,
    create_notebook,
    notebook_id_for_deployment,
)
from inference.routes import get_gpu_deployment_service, get_notebook_repository  # noqa: E402
from inference.supabase_config import SupabaseSettings  # noqa: E402
from inference.supabase_notebooks import (  # noqa: E402
    InvalidStateTransitionError,
    NotebookNotFoundError,
    NotebookValidationError,
    SupabaseNotebookConflictError,
    SupabaseNotebookRecord,
    SupabaseNotebookRepository,
    SupabaseNotebookServiceUnavailableError,
)
from inference.tests.test_gpu_deployments import _jwt, make_service  # noqa: E402
from providers.base import ProviderError, ProviderTimeoutError  # noqa: E402
from providers.types import InstanceStatusEnum  # noqa: E402


class InMemoryNotebookRepo:
    """Same contract as SupabaseNotebookRepository for the calls notebook_service makes, backed by a dict."""

    def __init__(self, ssh):
        self.ssh = ssh
        self.rows = {}
        self.token_hashes = {}
        self.fail_create = None      # exception raised by create_notebook_session
        self.lose_race = False       # simulate a concurrent request saving the same notebook first

    def validate_owned_ssh_key(self, user_id, selected_ssh_key_id):
        record = self.ssh.get_ssh_key_by_id(user_id, uuid.UUID(str(selected_ssh_key_id)))
        if record is None:
            raise NotebookValidationError("Selected SSH key does not exist or does not belong to your account.")
        return record

    def create_notebook_session(self, *, instance_id, user_id, name, gpu_profile, token_hash, status,
                                runtime_type, runtime_reference=None, selected_ssh_key_id=None,
                                deployment_id=None, **_):
        if self.fail_create is not None:
            raise self.fail_create
        now = datetime.now(timezone.utc)
        record = SupabaseNotebookRecord(
            id=uuid.UUID(str(instance_id)), user_id=user_id, name=name, gpu_profile=gpu_profile, status=status,
            runtime_type=runtime_type, runtime_reference=runtime_reference,
            selected_ssh_key_id=selected_ssh_key_id,
            deployment_id=uuid.UUID(str(deployment_id)) if deployment_id else None,
            created_at=now, updated_at=now,
        )
        if self.lose_race:
            self.rows[str(record.id)] = record
            raise SupabaseNotebookConflictError("Notebook record conflict detected.")
        if str(record.id) in self.rows:
            raise SupabaseNotebookConflictError("Notebook record conflict detected.")
        self.rows[str(record.id)] = record
        self.token_hashes[str(record.id)] = token_hash
        return dataclasses.replace(record)

    def get_notebook_by_id(self, user_id, notebook_id, resolve_ssh_key=True):
        record = self.rows.get(str(notebook_id))
        return dataclasses.replace(record) if record and record.user_id == user_id else None

    def get_notebook(self, user_id, notebook_id, resolve_ssh_key=True):
        record = self.get_notebook_by_id(user_id, notebook_id)
        if record is None:
            raise NotebookNotFoundError("not found")
        return record

    def get_notebook_with_token_hash(self, notebook_id):
        record = self.rows.get(str(notebook_id))
        return (dataclasses.replace(record), self.token_hashes[str(record.id)]) if record else None

    def update_token_hash(self, *, user_id, notebook_id, token_hash):
        record = self.rows.get(str(notebook_id))
        if record is None or record.user_id != user_id:
            raise NotebookNotFoundError("not found")
        if record.status == "terminated":
            raise InvalidStateTransitionError("terminated")
        self.token_hashes[str(record.id)] = token_hash
        return dataclasses.replace(record)

    def transition_notebook_status(self, *, user_id, notebook_id, action, expected_status, new_status, **_):
        record = self.rows.get(str(notebook_id))
        if record is None or record.user_id != user_id:
            raise NotebookNotFoundError("not found")
        if action != "terminate" and record.status != expected_status:
            raise InvalidStateTransitionError("concurrent change")
        record.status = new_status
        return dataclasses.replace(record)


TEST_PROXY_SECRET = "test-notebook-proxy-secret-0123456789abcdef"
TEST_PROXY_BASE_URL = "https://notebooks.test.invalid"


class NotebookGpuTestCase(unittest.TestCase):
    enabled = ("mock",)
    proxy_env = {"NOTEBOOK_PROXY_SECRET": TEST_PROXY_SECRET, "NOTEBOOK_PROXY_BASE_URL": TEST_PROXY_BASE_URL}

    def setUp(self):
        # GPU notebooks need the proxy secret (Phase 4); the base URL is a reserved .invalid name, never contacted.
        env = patch.dict(os.environ, self.proxy_env)
        env.start()
        self.addCleanup(env.stop)
        self.service, self.deployments, self.ssh, self.registry = make_service(enabled=self.enabled)
        self.mock_provider = self.registry.get("mock")
        self.notebooks = InMemoryNotebookRepo(self.ssh)
        app.dependency_overrides[get_gpu_deployment_service] = lambda: self.service
        app.dependency_overrides[get_notebook_repository] = lambda: self.notebooks
        self.client = TestClient(app)
        self.alice = {"Authorization": f"Bearer {_jwt('alice')}"}
        self.bob = {"Authorization": f"Bearer {_jwt('bob')}"}

    def tearDown(self):
        app.dependency_overrides.clear()

    def create(self, key="nb-key-0001", headers=None, **body):
        payload = {"name": "research", "gpu_id": "l4", "idempotency_key": key, **body}
        return self.client.post("/api/v1/notebooks", headers=headers or self.alice, json=payload)

    def spy_provision(self, provider, side_effect=None):
        spy = AsyncMock(side_effect=side_effect, wraps=None if side_effect else provider.provision_instance)
        provider.provision_instance = spy
        return spy


class TestSuccessfulProvisioning(NotebookGpuTestCase):
    def test_creates_deployment_and_links_it(self):
        key_id = self.ssh.add("alice")
        resp = self.create(selected_ssh_key_id=str(key_id))
        self.assertEqual(resp.status_code, 201, resp.text)
        body = resp.json()

        self.assertEqual(len(self.deployments.rows), 1)
        deployment = next(iter(self.deployments.rows.values()))
        self.assertEqual(body["deployment_id"], deployment["id"])
        self.assertEqual(body["id"], str(notebook_id_for_deployment(deployment["id"])))
        self.assertEqual(deployment["metadata"]["workload"], "notebook")
        self.assertEqual(deployment["idempotency_key"], NOTEBOOK_IDEMPOTENCY_PREFIX + "nb-key-0001")

        stored = self.notebooks.rows[body["id"]]
        # Phase 3: the GPU instance runs, but the notebook is 'starting' until JupyterLab answers a readiness probe.
        self.assertEqual(deployment["status"], "running")
        self.assertEqual((stored.status, stored.runtime_type), ("starting", "mock"))
        self.assertEqual(stored.runtime_reference, deployment["provider_instance_id"])
        self.assertEqual(str(stored.deployment_id), deployment["id"])

        self.assertEqual(body["status"], "starting")
        self.assertEqual(body["runtime_type"], "mock")
        self.assertTrue(body["is_simulated"])  # the mock provider is still not real hardware
        self.assertIsNone(body["jupyter_url"])
        self.assertIsNone(body["ssh_command"])
        # Only the SHA-256 of the one-time token is stored.
        self.assertEqual(self.notebooks.token_hashes[body["id"]], hashlib.sha256(body["access_token"].encode()).hexdigest())
        # The selected key was delivered to the instance.
        self.assertIn(self.ssh.keys[("alice", key_id)].public_key,
                      self.mock_provider.authorized_keys[deployment["provider_instance_id"]])

    def test_without_gpu_id_the_simulated_path_is_unchanged(self):
        resp = self.client.post("/api/v1/notebooks", headers=self.alice, json={"name": "legacy"})
        self.assertEqual(resp.status_code, 201, resp.text)
        self.assertEqual(resp.json()["runtime_type"], "simulated")
        self.assertIsNone(resp.json()["deployment_id"])
        self.assertEqual(self.deployments.rows, {})

    def test_gpu_id_requires_an_idempotency_key(self):
        resp = self.client.post("/api/v1/notebooks", headers=self.alice, json={"name": "x", "gpu_id": "l4"})
        self.assertEqual(resp.status_code, 422)
        self.assertEqual(self.deployments.rows, {})

    def test_unknown_gpu_is_rejected_before_any_deployment(self):
        self.assertEqual(self.create(gpu_id="tpu-v5").status_code, 409)
        self.assertEqual(self.deployments.rows, {})

    def test_never_falls_back_to_simulation_without_the_deployment_service(self):
        with self.assertRaises(NotebookError):
            create_notebook(self.notebooks, user_id="alice", name="x", gpu_id="l4",
                            idempotency_key="nb-key-0001", deployments=None)
        self.assertEqual(self.notebooks.rows, {})


class TestIdempotency(NotebookGpuTestCase):
    def test_repeated_request_returns_same_notebook_and_one_gpu(self):
        spy = self.spy_provision(self.mock_provider)
        first = self.create()
        second = self.create()
        self.assertEqual((first.status_code, second.status_code), (201, 201), second.text)
        self.assertEqual(first.json()["id"], second.json()["id"])
        self.assertEqual(spy.await_count, 1)
        self.assertEqual(len(self.deployments.rows), 1)
        self.assertIsNotNone(first.json()["access_token"])
        self.assertIsNone(second.json()["access_token"])  # never re-issued; only its hash exists

    def test_retry_after_gateway_timeout_attaches_notebook_without_new_gpu(self):
        # The first request launched the GPU, then died (or the gateway timed out) before saving the notebook.
        spy = self.spy_provision(self.mock_provider)
        self.service.create(user_id="alice", name="research", model_name="notebook", gpu_id="l4",
                            idempotency_key=NOTEBOOK_IDEMPOTENCY_PREFIX + "nb-key-0001", notebook=True)
        resp = self.create()
        self.assertEqual(resp.status_code, 201, resp.text)
        self.assertEqual(spy.await_count, 1)
        self.assertEqual(len(self.deployments.rows), 1)
        self.assertEqual(resp.json()["deployment_id"], next(iter(self.deployments.rows)))

    def test_concurrent_duplicate_save_returns_existing_and_keeps_gpu(self):
        self.notebooks.lose_race = True
        resp = self.create()
        self.assertEqual(resp.status_code, 201, resp.text)
        self.assertIsNone(resp.json()["access_token"])
        deployment = next(iter(self.deployments.rows.values()))
        self.assertEqual(deployment["status"], "running")  # a conflict never triggers cleanup

    def test_keys_are_scoped_per_customer(self):
        self.assertEqual(self.create().status_code, 201)
        self.assertEqual(self.create(headers=self.bob).status_code, 201)
        self.assertEqual(len(self.deployments.rows), 2)

    def test_key_used_by_a_non_notebook_deployment_is_refused(self):
        self.service.create(user_id="alice", name="llm", model_name="m", gpu_id="l4",
                            idempotency_key=NOTEBOOK_IDEMPOTENCY_PREFIX + "nb-key-0001")
        self.assertEqual(self.create().status_code, 400)
        self.assertEqual(self.notebooks.rows, {})


class TestProviderCompatibility(NotebookGpuTestCase):
    enabled = ("mock", "jarvislabs")

    def test_explicit_incompatible_provider_is_refused(self):
        jarvis = self.spy_provision(self.registry.get("jarvislabs"))
        resp = self.create(provider_id="jarvislabs")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("notebook", resp.json()["detail"])
        self.assertEqual(jarvis.await_count, 0)
        self.assertEqual(self.deployments.rows, {})

    def test_gpu_only_offered_by_incompatible_provider_is_unavailable(self):
        jarvis = self.spy_provision(self.registry.get("jarvislabs"))
        self.assertEqual(self.create(gpu_id="rtx-6000-ada").status_code, 409)
        self.assertEqual(jarvis.await_count, 0)
        self.assertEqual(self.deployments.rows, {})

    def test_selection_considers_only_compatible_providers(self):
        self.assertEqual(self.create(gpu_id="l4").json()["runtime_type"], "mock")


class TestInvalidSshKey(NotebookGpuTestCase):
    def test_foreign_ssh_key_is_rejected_before_provisioning(self):
        bobs_key = self.ssh.add("bob")
        spy = self.spy_provision(self.mock_provider)
        resp = self.create(selected_ssh_key_id=str(bobs_key))
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(spy.await_count, 0)
        self.assertEqual(self.deployments.rows, {})

    def test_unknown_and_malformed_keys_are_rejected(self):
        self.assertEqual(self.create(selected_ssh_key_id=str(uuid.uuid4())).status_code, 400)
        self.assertEqual(self.create(selected_ssh_key_id="not-a-uuid").status_code, 400)
        self.assertEqual(self.deployments.rows, {})


class TestProviderFailures(NotebookGpuTestCase):
    def test_provider_error_marks_deployment_failed_and_retry_never_relaunches(self):
        spy = self.spy_provision(self.mock_provider, ProviderError("boom", provider_id="mock"))
        self.assertEqual(self.create().status_code, 502)
        deployment = next(iter(self.deployments.rows.values()))
        self.assertEqual(deployment["status"], "failed")
        self.assertEqual(self.notebooks.rows, {})

        retry = self.create()
        self.assertEqual(retry.status_code, 409)
        self.assertEqual(spy.await_count, 1)
        self.assertEqual(len(self.deployments.rows), 1)

    def test_provider_timeout_retry_with_same_key_does_not_launch_a_second_gpu(self):
        spy = self.spy_provision(self.mock_provider, ProviderTimeoutError("slow", provider_id="mock"))
        self.assertEqual(self.create().status_code, 504)
        self.assertEqual(self.create().status_code, 409)
        self.assertEqual(spy.await_count, 1)

    def test_new_key_after_failure_can_launch(self):
        self.spy_provision(self.mock_provider, ProviderError("boom", provider_id="mock"))
        self.create()
        self.mock_provider.provision_instance = type(self.mock_provider).provision_instance.__get__(self.mock_provider)
        self.assertEqual(self.create(key="nb-key-0002").status_code, 201)


class TestDatabaseFailures(NotebookGpuTestCase):
    def test_notebook_save_failure_terminates_the_deployment(self):
        self.notebooks.fail_create = SupabaseNotebookServiceUnavailableError("down")
        self.assertEqual(self.create().status_code, 503)
        deployment = next(iter(self.deployments.rows.values()))
        self.assertEqual(deployment["status"], "terminated")
        self.assertEqual(self.mock_provider._instances[deployment["provider_instance_id"]].status,
                         InstanceStatusEnum.TERMINATED)
        self.assertEqual(self.notebooks.rows, {})

        # The key is spent: retrying must not launch another GPU.
        self.notebooks.fail_create = None
        self.assertEqual(self.create().status_code, 409)
        self.assertEqual(len(self.deployments.rows), 1)

    def test_original_error_survives_failed_cleanup(self):
        self.notebooks.fail_create = SupabaseNotebookServiceUnavailableError("down")
        self.mock_provider.terminate_instance = AsyncMock(side_effect=ProviderError("unreachable", provider_id="mock"))
        self.assertEqual(self.create().status_code, 503)

    def test_retry_attaching_to_existing_deployment_does_not_terminate_it(self):
        self.service.create(user_id="alice", name="research", model_name="notebook", gpu_id="l4",
                            idempotency_key=NOTEBOOK_IDEMPOTENCY_PREFIX + "nb-key-0001", notebook=True)
        self.notebooks.fail_create = SupabaseNotebookServiceUnavailableError("down")
        self.assertEqual(self.create().status_code, 503)
        self.assertEqual(next(iter(self.deployments.rows.values()))["status"], "running")


class TestLifecycle(NotebookGpuTestCase):
    def setUp(self):
        super().setUp()
        body = self.create().json()
        self.nb_url = f"/api/v1/notebooks/{body['id']}"
        self.deployment_id = body["deployment_id"]

    def deployment(self):
        return self.deployments.rows[self.deployment_id]

    def test_stop_start_terminate_drive_the_deployment(self):
        stopped = self.client.post(self.nb_url + "/stop", headers=self.alice)
        self.assertEqual(stopped.status_code, 200, stopped.text)
        self.assertEqual((stopped.json()["notebook"]["status"], self.deployment()["status"]), ("stopped", "stopped"))

        started = self.client.post(self.nb_url + "/start", headers=self.alice)
        self.assertEqual(started.status_code, 200, started.text)
        # JupyterLab restarts with the instance, so the notebook is 'starting' until it answers again.
        self.assertEqual((started.json()["notebook"]["status"], self.deployment()["status"]), ("starting", "running"))

        terminated = self.client.delete(self.nb_url, headers=self.alice)
        self.assertEqual(terminated.status_code, 200, terminated.text)
        self.assertEqual((terminated.json()["notebook"]["status"], self.deployment()["status"]),
                         ("terminated", "terminated"))
        instance = self.mock_provider._instances[self.deployment()["provider_instance_id"]]
        self.assertEqual(instance.status, InstanceStatusEnum.TERMINATED)

    def test_get_reflects_actual_deployment_status(self):
        self.service.stop("alice", self.deployment_id)  # changed outside the notebook API
        resp = self.client.get(self.nb_url, headers=self.alice)
        self.assertEqual(resp.json()["status"], "stopped")
        self.assertEqual(self.notebooks.rows[resp.json()["id"]].status, "stopped")

    def test_deployment_state_rules_apply(self):
        self.assertEqual(self.client.post(self.nb_url + "/start", headers=self.alice).status_code, 409)

    def test_other_customers_cannot_touch_the_notebook_or_its_gpu(self):
        self.assertEqual(self.client.get(self.nb_url, headers=self.bob).status_code, 404)
        self.assertEqual(self.client.post(self.nb_url + "/stop", headers=self.bob).status_code, 404)
        self.assertEqual(self.client.delete(self.nb_url, headers=self.bob).status_code, 404)
        self.assertEqual(self.deployment()["status"], "running")


class TestRepositoryPersistence(unittest.TestCase):
    """The real Supabase repository writes deployment_id and reports insert conflicts distinctly."""

    def make_repo(self, status=201):
        self.requests = []

        def transport(method, url, headers, body, timeout):
            payload = json.loads(body) if body else None
            self.requests.append((method, payload))
            if status >= 400:
                return status, {}, json.dumps({"code": "23505", "message": "duplicate key"}).encode()
            return status, {}, json.dumps([{**payload, "created_at": payload["created_at"]}]).encode()

        settings = SupabaseSettings(url="https://notebook-test.supabase.co", service_role_key="sb_secret_" + "test")
        return SupabaseNotebookRepository(settings=settings, timeout=5.0, transport=transport)

    def test_deployment_id_is_persisted(self):
        deployment_id = uuid.uuid4()
        record = self.make_repo().create_notebook_session(
            instance_id=notebook_id_for_deployment(deployment_id), user_id="alice", name="nb", gpu_profile="L4",
            token_hash="a" * 64, status="provisioning", runtime_type="mock", deployment_id=deployment_id,
        )
        self.assertEqual(self.requests[0][1]["deployment_id"], str(deployment_id))
        self.assertEqual(record.deployment_id, deployment_id)

    def test_simulated_insert_payload_has_no_deployment_id(self):
        self.make_repo().create_notebook_session(user_id="alice", name="nb", gpu_profile="L4", token_hash="a" * 64)
        self.assertNotIn("deployment_id", self.requests[0][1])

    def test_duplicate_insert_raises_conflict(self):
        with self.assertRaises(SupabaseNotebookConflictError):
            self.make_repo(status=409).create_notebook_session(
                user_id="alice", name="nb", gpu_profile="L4", token_hash="a" * 64)


if __name__ == "__main__":
    unittest.main()
