"""
Phase 2 notebook integration: notebook-specific container configuration (image, env vars, service ports)
flows through GpuDeploymentService and the provider interface, while normal GPU deployments keep the
vLLM/model-serving defaults. Providers that cannot honour a setting reject it instead of dropping it.
No real provider or database is touched.
"""

import logging
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

os.environ["INFERXE_TEST_MODE"] = "1"
os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
BACKEND_DIR = Path(__file__).resolve().parents[2]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from pydantic import ValidationError  # noqa: E402

from inference.gpu_deployment_service import DeploymentRequestError  # noqa: E402
from inference.notebook_service import NOTEBOOK_CONTAINER, NOTEBOOK_SERVICE_PORT  # noqa: E402
from inference.tests.test_notebook_gpu_provisioning import NotebookGpuTestCase  # noqa: E402
from providers.base import ProviderError  # noqa: E402
from providers.jarvislabs.adapter import JarvisLabsGpuProvider  # noqa: E402
from providers.jarvislabs.client import JarvisLabsClient  # noqa: E402
from providers.types import (  # noqa: E402
    DEFAULT_SERVING_IMAGE,
    ContainerConfig,
    ProvisionRequest,
    ServicePort,
)

SECRET = "s3cr3t-value-never-logged"


def only_deployment(test):
    return next(iter(test.deployments.rows.values()))


class TestContainerValidation(unittest.TestCase):
    def test_valid_references_are_accepted(self):
        for image in ("vllm/vllm-openai:latest", "quay.io/jupyter/pytorch-notebook:cuda12-latest",
                      "registry.example.com:5000/team/img@sha256:" + "a" * 64, "ubuntu"):
            self.assertEqual(ContainerConfig(image=image).image, image)

    def test_invalid_images_are_rejected(self):
        for image in ("", "Ubuntu", "img;rm -rf /", "img with space", "-img", "a" * 300, "img:"):
            with self.assertRaises(ValidationError, msg=image):
                ContainerConfig(image=image)

    def test_invalid_env_vars_are_rejected(self):
        bad = [{"1BAD": "x"}, {"BAD-NAME": "x"}, {"OK": "nul\x00byte"}, {"OK": "x" * 5000},
               {f"K{i}": "v" for i in range(33)}]
        for env in bad:
            with self.assertRaises(ValidationError):
                ContainerConfig(image="ubuntu", env_vars=env)

    def test_env_errors_and_repr_never_echo_values(self):
        with self.assertRaises(ValidationError) as ctx:
            ContainerConfig(image="ubuntu", env_vars={"TOKEN": SECRET + "\x00"})
        self.assertNotIn(SECRET, str(ctx.exception))
        self.assertNotIn(SECRET, repr(ContainerConfig(image="ubuntu", env_vars={"TOKEN": SECRET})))
        req = ProvisionRequest(deployment_id="d", customer_id="c", gpu_id="l4", model_name="m", env_vars={"TOKEN": SECRET})
        self.assertNotIn(SECRET, repr(req))

    def test_invalid_ports_are_rejected(self):
        for port in (0, 65536, 22):
            with self.assertRaises(ValidationError):
                ServicePort(name="svc", container_port=port)
        with self.assertRaises(ValidationError):
            ServicePort(name="Bad Name", container_port=8000)
        dup_port = [ServicePort(name="a", container_port=8000), ServicePort(name="b", container_port=8000)]
        dup_name = [ServicePort(name="a", container_port=8000), ServicePort(name="a", container_port=8001)]
        for ports in (dup_port, dup_name, [ServicePort(name=f"p{i}", container_port=9000 + i) for i in range(9)]):
            with self.assertRaises(ValidationError):
                ContainerConfig(image="ubuntu", service_ports=ports)

    def test_provision_request_defaults_are_unchanged(self):
        req = ProvisionRequest(deployment_id="d", customer_id="c", gpu_id="l4", model_name="m")
        self.assertEqual((req.container_image, req.env_vars, req.service_ports), (DEFAULT_SERVING_IMAGE, {}, []))


class TestNotebookContainerPropagation(NotebookGpuTestCase):
    def test_image_env_and_ports_reach_the_provider(self):
        key_id = self.ssh.add("alice")
        resp = self.create(selected_ssh_key_id=str(key_id))
        self.assertEqual(resp.status_code, 201, resp.text)
        deployment = only_deployment(self)
        instance_id = deployment["provider_instance_id"]

        container = self.mock_provider.containers[instance_id]
        self.assertEqual(container["image"], NOTEBOOK_CONTAINER.image)
        self.assertNotEqual(container["image"], DEFAULT_SERVING_IMAGE)
        # Phase 4: the fixed server-side env plus this notebook's proxy base_url and internal JupyterLab token.
        self.assertEqual(set(container["env_vars"]), {*NOTEBOOK_CONTAINER.env_vars, "JUPYTER_TOKEN"})
        self.assertEqual(container["env_vars"]["INFERXE_WORKLOAD"], "notebook")
        self.assertNotEqual(container["env_vars"]["JUPYTER_TOKEN"], resp.json()["access_token"])
        self.assertEqual([(p.name, p.container_port, p.protocol) for p in container["service_ports"]],
                         [("notebook", NOTEBOOK_SERVICE_PORT, "http")])
        # SSH key delivery is preserved alongside the container config.
        self.assertEqual(self.mock_provider.authorized_keys[instance_id], [self.ssh.keys[("alice", key_id)].public_key])

    def test_deployment_metadata_records_config_and_port_mapping(self):
        self.create()
        metadata = only_deployment(self)["metadata"]
        self.assertEqual(metadata["workload"], "notebook")
        self.assertEqual(metadata["container"]["image"], NOTEBOOK_CONTAINER.image)
        self.assertEqual(metadata["container"]["env_keys"], sorted([*NOTEBOOK_CONTAINER.env_vars, "JUPYTER_TOKEN"]))
        self.assertEqual(metadata["container"]["service_ports"][0]["container_port"], NOTEBOOK_SERVICE_PORT)
        self.assertEqual(metadata["port_mappings"], {str(NOTEBOOK_SERVICE_PORT): 40000})

    def test_notebook_token_is_never_stored_or_logged(self):
        # Phase 3: the token reaches the container (JUPYTER_TOKEN, how JupyterLab authenticates) but never the
        # deployment row or the logs.
        with self.assertLogs(level=logging.DEBUG) as logs:
            logging.getLogger("inferxe").debug("capture start")
            resp = self.create()
        token = resp.json()["access_token"]
        self.assertTrue(token)
        deployment = only_deployment(self)
        self.assertNotIn(token, str(deployment))
        self.assertFalse(any(token in line for line in logs.output))

    def test_env_values_reach_the_provider_but_are_not_stored(self):
        with self.assertLogs(level=logging.DEBUG) as logs:
            logging.getLogger("inferxe").debug("capture start")
            row = self.service.create(user_id="alice", name="x", model_name="notebook", gpu_id="l4", notebook=True,
                                      container=ContainerConfig(image="ubuntu", env_vars={"API_TOKEN": SECRET}))
        self.assertEqual(self.mock_provider.containers[row["provider_instance_id"]]["env_vars"], {"API_TOKEN": SECRET})
        self.assertEqual(row["metadata"]["container"]["env_keys"], ["API_TOKEN"])
        self.assertNotIn(SECRET, str(row))
        self.assertFalse(any(SECRET in line for line in logs.output))

    def test_idempotent_retry_does_not_reprovision_with_config(self):
        spy = self.spy_provision(self.mock_provider)
        self.create()
        self.create()
        self.assertEqual(spy.await_count, 1)
        self.assertEqual(spy.await_args.args[0].container_image, NOTEBOOK_CONTAINER.image)


class TestNormalDeploymentCompatibility(NotebookGpuTestCase):
    def test_normal_deployment_keeps_serving_defaults(self):
        row = self.service.create(user_id="alice", name="llm", model_name="Qwen/Qwen2.5-7B-Instruct", gpu_id="l4")
        container = self.mock_provider.containers[row["provider_instance_id"]]
        self.assertEqual(container, {"image": DEFAULT_SERVING_IMAGE, "env_vars": {}, "service_ports": []})
        self.assertNotIn("container", row["metadata"])
        self.assertNotIn("workload", row["metadata"])
        self.assertNotIn("port_mappings", row["metadata"])

    def test_normal_deployment_over_http_is_unchanged(self):
        resp = self.client.post("/api/v1/gpu/deployments", headers=self.alice,
                                json={"name": "llm", "model_name": "m", "gpu_id": "l4"})
        self.assertEqual(resp.status_code, 201, resp.text)
        instance_id = only_deployment(self)["provider_instance_id"]
        self.assertEqual(self.mock_provider.containers[instance_id]["image"], DEFAULT_SERVING_IMAGE)


class TestJarvisLabsPayloadUnchanged(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.client = MagicMock(spec=JarvisLabsClient)
        self.client.is_configured = True
        self.client.create_instance = AsyncMock(return_value={"instance_id": "jl-1", "ip": "20.0.0.1"})
        self.provider = JarvisLabsGpuProvider(client=self.client)

    async def test_default_request_still_sends_vllm_payload(self):
        await self.provider.provision_instance(
            ProvisionRequest(deployment_id="d-1", customer_id="c", gpu_id="l4", model_name="m"))
        payload = self.client.create_instance.await_args.args[0]
        self.assertEqual((payload["framework"], payload["docker_image"]), ("vllm", DEFAULT_SERVING_IMAGE))

    async def test_custom_image_or_ports_are_rejected_before_any_api_call(self):
        for extra in ({"container_image": "ubuntu"},
                      {"service_ports": [ServicePort(name="svc", container_port=8888)]}):
            req = ProvisionRequest(deployment_id="d-1", customer_id="c", gpu_id="l4", model_name="m", **extra)
            with self.assertRaises(ProviderError) as ctx:
                await self.provider.provision_instance(req)
            self.assertEqual(ctx.exception.status_code, 400)
        self.client.create_instance.assert_not_awaited()

    def test_jarvislabs_notebook_support_stays_off(self):
        self.assertEqual(
            (self.provider.supports_notebooks, self.provider.supports_custom_images, self.provider.supports_exposed_ports),
            (False, False, False))


class TestUnsupportedProviderConfiguration(NotebookGpuTestCase):
    enabled = ("mock", "jarvislabs")

    def test_explicit_provider_lacking_container_support_is_refused(self):
        with self.assertRaises(DeploymentRequestError) as ctx:
            self.service.create(user_id="alice", name="x", model_name="m", gpu_id="l4", provider_id="jarvislabs",
                                container=ContainerConfig(image="ubuntu"))
        self.assertIn("custom container images", str(ctx.exception))
        self.assertEqual(self.deployments.rows, {})

    def test_automatic_selection_skips_providers_without_port_support(self):
        self.mock_provider.supports_exposed_ports = False
        jarvis = self.spy_provision(self.registry.get("jarvislabs"))
        resp = self.create()
        self.assertEqual(resp.status_code, 409)  # no enabled provider can run the notebook container
        self.assertEqual(jarvis.await_count, 0)
        self.assertEqual(self.deployments.rows, {})

    def test_explicit_notebook_provider_without_image_support_returns_400(self):
        self.mock_provider.supports_custom_images = False
        resp = self.create(provider_id="mock")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("custom container images", resp.json()["detail"])
        self.assertEqual(self.deployments.rows, {})


class TestProviderFailureHandling(NotebookGpuTestCase):
    def test_provider_rejecting_config_at_launch_marks_deployment_failed(self):
        # A provider whose flags claim support but whose API refuses the container at launch time.
        self.spy_provision(self.mock_provider, ProviderError("image not allowed", provider_id="mock", status_code=400))
        resp = self.create()
        self.assertEqual(resp.status_code, 400)
        deployment = only_deployment(self)
        self.assertEqual(deployment["status"], "failed")
        self.assertEqual(deployment["metadata"]["container"]["image"], NOTEBOOK_CONTAINER.image)
        self.assertEqual(self.notebooks.rows, {})

    def test_provider_error_with_container_keeps_phase1_retry_guard(self):
        spy = self.spy_provision(self.mock_provider, ProviderError("boom", provider_id="mock"))
        self.assertEqual(self.create().status_code, 502)
        self.assertEqual(self.create().status_code, 409)
        self.assertEqual(spy.await_count, 1)


if __name__ == "__main__":
    unittest.main()
