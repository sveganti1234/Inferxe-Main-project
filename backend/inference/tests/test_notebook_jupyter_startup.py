"""
Phase 3 notebook integration: JupyterLab startup configuration, readiness checks and startup failure handling.

These tests check what Inferxe sends to providers and how it reacts to provider state and readiness probes.
The mock provider runs no container, so nothing here proves that JupyterLab really starts: probes are injected,
and the mock's private-range host is (correctly) never probed.
"""

import hashlib
import logging
import os
import shlex
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

os.environ["INFERXE_TEST_MODE"] = "1"
os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
BACKEND_DIR = Path(__file__).resolve().parents[2]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from inference import notebook_service  # noqa: E402
from inference.notebook_service import (  # noqa: E402
    NOTEBOOK_ARGS,
    NOTEBOOK_CONTAINER,
    NOTEBOOK_IDEMPOTENCY_PREFIX,
    NOTEBOOK_IMAGE,
    NOTEBOOK_SERVICE_PORT,
    NOTEBOOK_STARTUP_TIMEOUT_SECONDS,
    NOTEBOOK_WORKDIR,
    generate_notebook_token,
    jupyter_base_url,
    notebook_container_for,
    notebook_status_from_deployment,
    probe_jupyter,
)
from inference.notebook_access import internal_jupyter_token, load_access_config  # noqa: E402
from inference.supabase_notebooks import SupabaseNotebookServiceUnavailableError  # noqa: E402
from inference.tests.test_notebook_gpu_provisioning import NotebookGpuTestCase  # noqa: E402
from providers.base import ProviderError  # noqa: E402
from providers.types import InstanceStatusEnum  # noqa: E402

PUBLIC_IPV4 = "8.8.8.8"  # a global address; never contacted, probes are injected


def ready(_url):
    return True


def not_ready(_url):
    return False


class TestImageAndStartupConfig(unittest.TestCase):
    def test_image_is_pinned_by_tag_and_digest(self):
        self.assertEqual(NOTEBOOK_CONTAINER.image, NOTEBOOK_IMAGE)
        self.assertIn(":cuda12-2026-11-23@sha256:", NOTEBOOK_IMAGE)
        self.assertNotIn("latest", NOTEBOOK_IMAGE)

    def test_jupyterlab_starts_on_8888_bound_to_all_interfaces_in_workdir(self):
        env = NOTEBOOK_CONTAINER.env_vars
        self.assertEqual(env["DOCKER_STACKS_JUPYTER_CMD"], "lab")
        self.assertEqual(env["NOTEBOOK_ARGS"], NOTEBOOK_ARGS)
        args = shlex.split(NOTEBOOK_ARGS)
        self.assertIn("--ServerApp.ip=0.0.0.0", args)
        self.assertIn(f"--ServerApp.port={NOTEBOOK_SERVICE_PORT}", args)
        self.assertIn(f"--ServerApp.root_dir={NOTEBOOK_WORKDIR}", args)
        self.assertEqual(NOTEBOOK_WORKDIR, "/home/jovyan/work")
        self.assertEqual([(p.name, p.container_port) for p in NOTEBOOK_CONTAINER.service_ports],
                         [("notebook", NOTEBOOK_SERVICE_PORT)])

    def test_startup_args_never_carry_credentials(self):
        # start-notebook.py prints the full command line, NOTEBOOK_ARGS included.
        lowered = NOTEBOOK_ARGS.lower()
        for word in ("token", "password", "secret"):
            self.assertNotIn(word, lowered)
        self.assertNotIn("JUPYTER_TOKEN", NOTEBOOK_CONTAINER.env_vars)

    def test_no_privilege_or_identity_overrides_in_env(self):
        # docker-stacks start.sh honours these (as root) to change users, grant sudo or alter the environment.
        privileged = {"GRANT_SUDO", "NB_USER", "NB_UID", "NB_GID", "NB_GROUP", "CHOWN_HOME", "CHOWN_EXTRA",
                      "NB_UMASK", "JUPYTER_ENV_VARS_TO_UNSET", "JUPYTERHUB_API_TOKEN", "GEN_CERT"}
        self.assertFalse(privileged & set(NOTEBOOK_CONTAINER.env_vars))

    def test_per_notebook_container_adds_base_url_and_internal_token(self):
        notebook_id = "6f1d2c4e-8b7a-4f3e-9c1d-5a2b7e9f0c13"
        internal = "f" * 64
        container = notebook_container_for(notebook_id, internal)
        self.assertEqual(container.env_vars, {
            **NOTEBOOK_CONTAINER.env_vars,
            "NOTEBOOK_ARGS": f"{NOTEBOOK_ARGS} --ServerApp.base_url=/nb/{notebook_id}/",
            "JUPYTER_TOKEN": internal,
        })
        self.assertEqual(container.image, NOTEBOOK_IMAGE)
        self.assertNotIn("JUPYTER_TOKEN", NOTEBOOK_CONTAINER.env_vars)  # the shared config is not mutated
        self.assertNotIn(internal, repr(container))
        self.assertNotIn(internal, container.env_vars["NOTEBOOK_ARGS"])


class TestReadinessProbe(unittest.TestCase):
    def fake_get(self, status=200, body=None, exc=None):
        calls = []

        def get(url, **kwargs):
            calls.append((url, kwargs))
            if exc:
                raise exc
            resp = MagicMock(status_code=status)
            if isinstance(body, Exception):
                resp.json.side_effect = body
            else:
                resp.json.return_value = body
            return resp
        return get, calls

    def test_ready_only_on_200_with_version(self):
        get, calls = self.fake_get(200, {"version": "2.17.0"})
        self.assertTrue(probe_jupyter("http://8.8.8.8:40000", http_get=get))
        url, kwargs = calls[0]
        self.assertEqual(url, "http://8.8.8.8:40000/api")
        self.assertFalse(kwargs["follow_redirects"])
        self.assertNotIn("headers", kwargs)  # no credentials are sent
        self.assertLessEqual(kwargs["timeout"], 5)

    def test_not_ready_cases(self):
        cases = [self.fake_get(401, {"message": "Forbidden"}), self.fake_get(500, {}),
                 self.fake_get(200, ValueError("not json")), self.fake_get(200, {"status": "ok"}),
                 self.fake_get(200, ["version"]), self.fake_get(exc=ConnectionError("refused")),
                 self.fake_get(exc=TimeoutError("slow"))]
        for get, _calls in cases:
            self.assertFalse(probe_jupyter("http://8.8.8.8:40000", http_get=get))

    def test_base_url_requires_host_and_mapped_port(self):
        meta = {"port_mappings": {str(NOTEBOOK_SERVICE_PORT): 40000}}
        self.assertEqual(jupyter_base_url({"ssh_host": PUBLIC_IPV4, "metadata": meta}), "http://8.8.8.8:40000")
        self.assertEqual(jupyter_base_url({"ssh_host": "2001:4860:4860::8888", "metadata": meta}),
                         "http://[2001:4860:4860::8888]:40000")
        self.assertIsNone(jupyter_base_url({"ssh_host": PUBLIC_IPV4, "metadata": {}}))
        self.assertIsNone(jupyter_base_url({"ssh_host": None, "metadata": meta}))
        self.assertIsNone(jupyter_base_url({"ssh_host": PUBLIC_IPV4, "metadata": {"port_mappings": {"8888": 0}}}))

    def test_private_and_local_hosts_are_never_probed(self):
        meta = {"port_mappings": {str(NOTEBOOK_SERVICE_PORT): 40000}}
        for host in ("10.244.1.42", "127.0.0.1", "169.254.169.254", "192.168.1.5", "::1", "fd00::1"):
            self.assertIsNone(jupyter_base_url({"ssh_host": host, "metadata": meta}), host)


class TestStatusTransitions(unittest.TestCase):
    now = datetime(2026, 11, 27, 12, 0, tzinfo=timezone.utc)

    def deployment(self, status="running", started_seconds_ago=60, host=PUBLIC_IPV4):
        return {"id": "d1", "status": status, "ssh_host": host,
                "started_at": (self.now - timedelta(seconds=started_seconds_ago)).isoformat(),
                "metadata": {"port_mappings": {str(NOTEBOOK_SERVICE_PORT): 40000}}}

    def status(self, deployment, current="starting", probe=not_ready):
        return notebook_status_from_deployment(deployment, current, probe, self.now)

    def test_provisioning_starting_running(self):
        self.assertEqual(self.status(self.deployment("provisioning")), ("provisioning", False))
        self.assertEqual(self.status(self.deployment()), ("starting", False))
        self.assertEqual(self.status(self.deployment(), probe=ready), ("running", False))

    def test_startup_timeout_fails_and_requests_termination(self):
        late = self.deployment(started_seconds_ago=NOTEBOOK_STARTUP_TIMEOUT_SECONDS + 1)
        self.assertEqual(self.status(late), ("failed", True))
        self.assertEqual(self.status(late, probe=ready), ("running", False))  # answering late still counts

    def test_ready_notebook_is_not_killed_by_a_probe_miss(self):
        late = self.deployment(started_seconds_ago=NOTEBOOK_STARTUP_TIMEOUT_SECONDS * 10)
        self.assertEqual(self.status(late, current="running"), ("running", False))

    def test_provider_states_pass_through(self):
        self.assertEqual(self.status(self.deployment("failed")), ("failed", False))
        self.assertEqual(self.status(self.deployment("stopped"), current="running"), ("stopped", False))
        self.assertEqual(self.status(self.deployment("terminated"), current="running"), ("terminated", False))

    def test_failed_startup_stays_failed_after_its_instance_is_terminated(self):
        self.assertEqual(self.status(self.deployment("terminated"), current="failed"), ("failed", False))

    def test_unprobeable_host_is_not_probed(self):
        probe = MagicMock(return_value=True)
        self.assertEqual(self.status(self.deployment(host="10.244.0.1"), probe=probe), ("starting", False))
        probe.assert_not_called()


class JupyterTestCase(NotebookGpuTestCase):
    """Notebook on the mock provider, with the instance's host moved to a global address so it can be probed."""

    def setUp(self):
        super().setUp()
        resp = self.create()
        self.assertEqual(resp.status_code, 201, resp.text)
        self.body = resp.json()
        self.deployment_id = self.body["deployment_id"]
        self.instance_id = self.deployments.rows[self.deployment_id]["provider_instance_id"]
        self.set_instance(host_ip=PUBLIC_IPV4)

    def set_instance(self, **update):
        handle = self.mock_provider._instances[self.instance_id]
        self.mock_provider._instances[self.instance_id] = handle.model_copy(update=update)

    def get(self, probe=not_ready, seconds_after_start=60):
        started = notebook_service.parse_supabase_timestamp(self.deployments.rows[self.deployment_id]["started_at"])
        return notebook_service.get_notebook(
            self.notebooks, "alice", self.body["id"], deployments=self.service, probe=probe,
            now=started + timedelta(seconds=seconds_after_start))

    def instance_status(self):
        return self.mock_provider._instances[self.instance_id].status


class TestStartupLifecycle(JupyterTestCase):
    def test_created_notebook_is_starting_until_jupyterlab_answers(self):
        self.assertEqual(self.body["status"], "starting")
        self.assertEqual(self.get().status, "starting")
        probed = []
        self.assertEqual(self.get(probe=lambda url: probed.append(url) or True).status, "running")
        self.assertEqual(probed, [f"http://{PUBLIC_IPV4}:40000"])
        self.assertEqual(self.notebooks.rows[self.body["id"]].status, "running")

    def test_startup_timeout_marks_failed_and_terminates_the_gpu(self):
        nb = self.get(seconds_after_start=NOTEBOOK_STARTUP_TIMEOUT_SECONDS + 5)
        self.assertEqual(nb.status, "failed")
        self.assertEqual(self.deployments.rows[self.deployment_id]["status"], "terminated")
        self.assertEqual(self.instance_status(), InstanceStatusEnum.TERMINATED)
        self.assertEqual(self.get().status, "failed")  # stays failed, not 'terminated'

    def test_failed_termination_is_retried_on_the_next_check(self):
        real_terminate = self.mock_provider.terminate_instance
        self.mock_provider.terminate_instance = AsyncMock(side_effect=ProviderError("unreachable", provider_id="mock"))
        late = NOTEBOOK_STARTUP_TIMEOUT_SECONDS + 5
        self.assertEqual(self.get(seconds_after_start=late).status, "failed")
        self.assertEqual(self.deployments.rows[self.deployment_id]["status"], "running")  # still tracked

        self.mock_provider.terminate_instance = real_terminate
        self.assertEqual(self.get(seconds_after_start=late).status, "failed")
        self.assertEqual(self.instance_status(), InstanceStatusEnum.TERMINATED)

    def test_provider_failure_such_as_image_pull_marks_failed(self):
        self.set_instance(status=InstanceStatusEnum.FAILED)
        self.assertEqual(self.get().status, "failed")
        self.assertEqual(self.deployments.rows[self.deployment_id]["status"], "failed")

    def test_container_exit_is_reported_as_stopped(self):
        self.get(probe=ready)
        self.set_instance(status=InstanceStatusEnum.STOPPED)
        self.assertEqual(self.get(probe=ready).status, "stopped")

    def test_restart_goes_through_starting_again(self):
        self.get(probe=ready)
        stop = self.client.post(f"/api/v1/notebooks/{self.body['id']}/stop", headers=self.alice)
        self.assertEqual(stop.json()["notebook"]["status"], "stopped")
        start = self.client.post(f"/api/v1/notebooks/{self.body['id']}/start", headers=self.alice)
        self.assertEqual(start.json()["notebook"]["status"], "starting")
        self.assertEqual(self.get(probe=ready).status, "running")

    def test_http_get_never_probes_the_mock_private_host(self):
        self.set_instance(host_ip="10.244.7.42")  # what the mock really reports
        resp = self.client.get(f"/api/v1/notebooks/{self.body['id']}", headers=self.alice)
        self.assertEqual(resp.status_code, 200, resp.text)
        self.assertEqual(resp.json()["status"], "starting")  # the mock runs no JupyterLab; never 'running'
        self.assertIsNone(resp.json()["jupyter_url"])


class TestTokenProtection(NotebookGpuTestCase):
    def test_container_gets_the_internal_token_and_only_the_customer_token_hash_is_stored(self):
        # Phase 4: JupyterLab's token is internal (derived from the deployment id); the customer token only unlocks
        # the Inferxe proxy and never reaches the container.
        with self.assertLogs(level=logging.DEBUG) as logs:
            logging.getLogger("inferxe").debug("capture start")
            body = self.create().json()
        token = body["access_token"]
        deployment = self.deployments.rows[body["deployment_id"]]
        container = self.mock_provider.containers[deployment["provider_instance_id"]]
        internal = internal_jupyter_token(load_access_config(), deployment["id"])

        self.assertEqual(container["env_vars"]["JUPYTER_TOKEN"], internal)
        self.assertNotIn(token, str(container))
        self.assertNotIn(internal, container["env_vars"]["NOTEBOOK_ARGS"])
        self.assertIn(f"--ServerApp.base_url=/nb/{body['id']}/", container["env_vars"]["NOTEBOOK_ARGS"])
        self.assertEqual(self.notebooks.token_hashes[body["id"]], hashlib.sha256(token.encode()).hexdigest())
        self.assertNotIn(internal, str(body))  # the internal token is never returned to anyone
        for secret in (token, internal):
            self.assertNotIn(secret, str(deployment))
            self.assertFalse(any(secret in line for line in logs.output))

    def test_token_hash_is_not_returned_by_the_deployments_api(self):
        body = self.create().json()
        token_hash = self.notebooks.token_hashes[body["id"]]
        listed = self.client.get("/api/v1/gpu/deployments", headers=self.alice).text
        single = self.client.get(f"/api/v1/gpu/deployments/{body['deployment_id']}", headers=self.alice).text
        self.assertNotIn(token_hash, listed + single)
        self.assertNotIn(body["access_token"], listed + single)

    def launch_as_earlier_request(self):
        deployment_id = "11111111-2222-4333-8444-555555555555"
        self.service.create(user_id="alice", name="research", model_name="notebook", gpu_id="l4",
                            idempotency_key=NOTEBOOK_IDEMPOTENCY_PREFIX + "nb-key-0001", notebook=True,
                            container=notebook_container_for(
                                notebook_service.notebook_id_for_deployment(deployment_id),
                                internal_jupyter_token(load_access_config(), deployment_id)),
                            deployment_id=deployment_id)
        return deployment_id

    def test_retry_after_lost_response_issues_a_working_token(self):
        # Phase 4 closes the Phase 3 gap: JupyterLab uses the internal token, so a fresh customer token works.
        deployment_id = self.launch_as_earlier_request()
        body = self.create().json()
        self.assertEqual(body["deployment_id"], deployment_id)
        self.assertTrue(body["access_token"])
        self.assertEqual(self.notebooks.token_hashes[body["id"]], hashlib.sha256(body["access_token"].encode()).hexdigest())

    def test_losing_a_concurrent_launch_never_cleans_up_the_winners_gpu(self):
        self.launch_as_earlier_request()
        real_lookup = self.deployments.get_by_idempotency_key
        calls = {"n": 0}

        def lookup_misses_once(user_id, key):  # this request's first lookup ran before the winner's insert
            calls["n"] += 1
            return None if calls["n"] == 1 else real_lookup(user_id, key)

        self.deployments.get_by_idempotency_key = lookup_misses_once
        self.notebooks.fail_create = SupabaseNotebookServiceUnavailableError("down")
        self.assertEqual(self.create().status_code, 503)
        self.assertEqual(next(iter(self.deployments.rows.values()))["status"], "running")  # winner's GPU kept

        self.notebooks.fail_create = None
        calls["n"] = 0
        body = self.create().json()
        self.assertEqual(len(self.deployments.rows), 1)
        self.assertEqual(self.notebooks.token_hashes[body["id"]], hashlib.sha256(body["access_token"].encode()).hexdigest())

    def test_customer_cannot_override_image_command_env_or_privileges(self):
        resp = self.create(container_image="evil/image:1", image="evil/image:1", command=["sh", "-c", "id"],
                           env_vars={"GRANT_SUDO": "yes"}, privileged=True, user="root")
        self.assertEqual(resp.status_code, 201, resp.text)
        container = self.mock_provider.containers[
            self.deployments.rows[resp.json()["deployment_id"]]["provider_instance_id"]]
        self.assertEqual(container["image"], NOTEBOOK_IMAGE)
        self.assertEqual(set(container["env_vars"]), {*NOTEBOOK_CONTAINER.env_vars, "JUPYTER_TOKEN"})


class TestNormalDeploymentCompatibility(NotebookGpuTestCase):
    def test_normal_deployment_gets_no_notebook_startup_or_token(self):
        row = self.service.create(user_id="alice", name="llm", model_name="m", gpu_id="l4")
        container = self.mock_provider.containers[row["provider_instance_id"]]
        self.assertEqual(container["env_vars"], {})
        self.assertNotIn("workload", row["metadata"])
        self.assertEqual(self.service.get("alice", row["id"])["status"], "running")


if __name__ == "__main__":
    unittest.main()
