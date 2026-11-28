"""
notebook_service.py
===================
Orchestration and service layer for customer GPU Notebook Instances backed by Supabase.
Provides:
  - Driver abstraction for container / pod / simulated runtimes.
  - SimulatedNotebookDriver reporting transparent simulation status.
  - User-scoped notebook lifecycle management (create, list, get, start, stop, terminate)
    backed by `SupabaseNotebookRepository` and `SupabaseSSHKeyRepository`.
  - Secure session token generation and SHA-256 hashing (no raw tokens persisted).
  - Multi-tenant isolation and SSH key binding validation.
"""

import hashlib
import ipaddress
import logging
import secrets
import uuid

import httpx2
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple, Union

from inference.gpu_deployment_service import DeploymentRequestError, DeploymentStateError, GpuDeploymentService
from inference.notebook_access import (
    AccessConfig,
    NotebookAccessNotConfiguredError,
    internal_jupyter_token,
    load_access_config,
    new_ticket,
    notebook_path,
    public_notebook_url,
    require_access_config,
    ticket_url,
)
from inference.schemas import NotebookResponse
from providers.types import ContainerConfig, ServicePort
from inference.supabase_notebooks import (
    ALLOWED_START_SOURCE_STATUSES,
    ALLOWED_STOP_SOURCE_STATUSES,
    VALID_NOTEBOOK_STATUSES,
    InvalidStateTransitionError,
    NotebookError,
    NotebookNotFoundError,
    NotebookValidationError,
    SupabaseNotebookConflictError,
    SupabaseNotebookError,
    SupabaseNotebookRecord,
    SupabaseNotebookRepository,
    SupabaseNotebookServiceUnavailableError,
    SupabaseNotebookValidationError,
    _validate_user_id,
    get_notebook_repository,
    parse_supabase_timestamp,
)
from inference.supabase_ssh_keys import SupabaseSSHKeyRecord

logger = logging.getLogger("inferxe.notebook_service")

SIMULATION_NOTICE = "Simulated notebook runtime: no physical GPU or JupyterLab container is running."
MOCK_PROVIDER_NOTICE = "Mock GPU provider: no physical GPU is allocated and JupyterLab is not running."

# GPU-backed notebooks: one deployment per (user, idempotency key) via the deployments unique index, and one notebook
# per deployment because the notebook's primary key is derived from the deployment id.
NOTEBOOK_ID_NAMESPACE = uuid.UUID("6f1d2c4e-8b7a-4f3e-9c1d-5a2b7e9f0c13")
NOTEBOOK_IDEMPOTENCY_PREFIX = "notebook:"
NOTEBOOK_MODEL_NAME = "notebook"  # deployments.model_name is required; a notebook serves no model
ENDED_DEPLOYMENT_STATUSES = frozenset({"failed", "terminated"})

# Container every GPU notebook runs. Server-side only: customers cannot choose the image, env, command or ports.
#
# Image: Jupyter Docker Stacks pytorch-notebook, CUDA 12 variant, pinned by tag AND multi-arch manifest digest
# (verified on quay.io 2026-11-27; the same build is tagged cuda12-pytorch-2.11.0, cuda12-lab-4.6.6,
# cuda12-python-3.13.18, git commit 899bb1616a1a). PyTorch comes from the cu128 wheel index, so GPU hosts need
# an NVIDIA driver that supports CUDA 12.8.
#
# Startup is the image's own: ENTRYPOINT `tini -g -- start.sh` (tini as PID 1 forwards SIGTERM, start.sh execs) and
# CMD `start-notebook.py`, which runs `jupyter $DOCKER_STACKS_JUPYTER_CMD $NOTEBOOK_ARGS` as the non-root jovyan
# user. start-notebook.py PRINTS the full command, so NOTEBOOK_ARGS must never carry a credential. JupyterLab's
# token is delivered separately as JUPYTER_TOKEN, which jupyter_server reads from the environment and masks
# ("...") in logs. Since Phase 4 that token is internal (notebook_access.internal_jupyter_token): only the Inferxe
# proxy uses it, customers authenticate to the proxy instead, and JupyterLab is served under /nb/<notebook id>/.
NOTEBOOK_SERVICE_PORT = 8888
NOTEBOOK_WORKDIR = "/home/jovyan/work"  # created by the image; customer notebooks live here
NOTEBOOK_IMAGE = (
    "quay.io/jupyter/pytorch-notebook:cuda12-2026-11-23"
    "@sha256:60273c9593b14a1337dfbc70bc6866030822ded5a1553ed2df6df3e3b5282cd6"
)
NOTEBOOK_ARGS = " ".join([
    "--ServerApp.ip=0.0.0.0",
    f"--ServerApp.port={NOTEBOOK_SERVICE_PORT}",
    f"--ServerApp.root_dir={NOTEBOOK_WORKDIR}",
    "--ServerApp.open_browser=False",
])
NOTEBOOK_CONTAINER = ContainerConfig(
    image=NOTEBOOK_IMAGE,
    env_vars={
        "INFERXE_WORKLOAD": "notebook",
        "DOCKER_STACKS_JUPYTER_CMD": "lab",
        "NOTEBOOK_ARGS": NOTEBOOK_ARGS,
    },
    service_ports=[ServicePort(name="notebook", container_port=NOTEBOOK_SERVICE_PORT, protocol="http")],
)
NOTEBOOK_TOKEN_ENV = "JUPYTER_TOKEN"

# Readiness: JupyterLab counts as ready only when its unauthenticated version endpoint answers. GET /api needs no
# token, returns {"version": ...} and does not count as user activity.
NOTEBOOK_STARTUP_TIMEOUT_SECONDS = 900.0  # image pull (several GB) + JupyterLab start
READINESS_PROBE_TIMEOUT_SECONDS = 3.0


def notebook_container_for(notebook_id: Union[str, uuid.UUID], internal_token: str) -> ContainerConfig:
    """The fixed notebook container, served under this notebook's proxy path, with its internal JupyterLab token."""
    return ContainerConfig(
        image=NOTEBOOK_CONTAINER.image,
        env_vars={
            **NOTEBOOK_CONTAINER.env_vars,
            "NOTEBOOK_ARGS": f"{NOTEBOOK_ARGS} --ServerApp.base_url={notebook_path(notebook_id)}",
            NOTEBOOK_TOKEN_ENV: internal_token,
        },
        service_ports=list(NOTEBOOK_CONTAINER.service_ports),
    )


def jupyter_base_url(deployment: Dict[str, Any]) -> Optional[str]:
    """http://host:public-port for the notebook service, or None when it cannot (or must not) be probed."""
    host = deployment.get("ssh_host")
    port = ((deployment.get("metadata") or {}).get("port_mappings") or {}).get(str(NOTEBOOK_SERVICE_PORT))
    if not host or not isinstance(port, int) or not 1 <= port <= 65535:
        return None
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        # shortcut: provider hostnames are probed as given; resolving and re-checking them would stop DNS-based
        # redirection to internal hosts. Add that if a provider ever reports hostnames.
        return f"http://{host}:{port}"
    if not address.is_global:  # never send probes into private/loopback/link-local networks (SSRF)
        return None
    return f"http://[{host}]:{port}" if address.version == 6 else f"http://{host}:{port}"


def probe_jupyter(base_url: str, timeout: float = READINESS_PROBE_TIMEOUT_SECONDS, http_get=None) -> bool:
    """True only when JupyterLab answers GET /api with 200 and a version. Sends no credentials."""
    get = http_get or httpx2.get
    try:
        resp = get(f"{base_url}/api", timeout=timeout, follow_redirects=False)
    except Exception as err:  # connection refused, timeouts, DNS: not ready yet
        logger.debug("JupyterLab readiness probe failed (%s).", type(err).__name__)
        return False
    if resp.status_code != 200:
        return False
    try:
        body = resp.json()
    except ValueError:
        return False
    return isinstance(body, dict) and "version" in body


def notebook_status_from_deployment(
    deployment: Dict[str, Any],
    current_status: str,
    probe,
    now: datetime,
    startup_timeout: float = NOTEBOOK_STARTUP_TIMEOUT_SECONDS,
) -> Tuple[str, bool]:
    """Notebook status for a GPU deployment, and whether the deployment must be terminated (startup timed out).

    provisioning: the GPU instance is being created.  starting: the instance runs but JupyterLab has not answered.
    running: JupyterLab answered.  failed: the provider reported failure, or JupyterLab missed the startup timeout.
    """
    dep_status = deployment.get("status")
    if dep_status != "running":
        if current_status == "failed" and dep_status == "terminated":
            return "failed", False  # we ended it because startup failed; keep saying why
        return dep_status, False

    url = jupyter_base_url(deployment)
    if url is not None and probe(url):
        return "running", False
    if current_status == "running":
        # shortcut: a probe miss on a notebook that already answered is not a startup failure, so it stays running;
        # ongoing health monitoring of ready notebooks is a later phase.
        return "running", False
    started_at = parse_supabase_timestamp(deployment.get("started_at"))
    if started_at is not None and (now - started_at).total_seconds() > startup_timeout:
        return "failed", True
    return "starting", False


def notebook_status_after_launch(deployment_status: str) -> str:
    """A freshly launched or resumed instance is 'starting' until JupyterLab answers a readiness probe."""
    return "starting" if deployment_status == "running" else deployment_status


def notebook_id_for_deployment(deployment_id: Union[str, uuid.UUID]) -> uuid.UUID:
    return uuid.uuid5(NOTEBOOK_ID_NAMESPACE, str(uuid.UUID(str(deployment_id))))


# --- Security: Token Hashing Helpers ---

def generate_notebook_token() -> Tuple[str, str]:
    """
    Generate a cryptographically secure access token and its SHA-256 hash.
    Returns:
      (raw_token, token_hash)
    The raw token is returned to the user only once upon session creation.
    Only the 64-character SHA-256 hex digest is persisted in the database.
    """
    raw_token = f"ixnb_{secrets.token_hex(24)}"
    token_hash = hashlib.sha256(raw_token.encode("utf-8")).hexdigest()
    return raw_token, token_hash


def verify_notebook_token(raw_token: str, token_hash: str) -> bool:
    """Verify a raw token against a stored SHA-256 digest using constant-time comparison."""
    computed = hashlib.sha256(raw_token.encode("utf-8")).hexdigest()
    return secrets.compare_digest(computed, token_hash)


# --- Runtime Abstraction: Driver Interface & Simulated Driver ---

class NotebookDriver(ABC):
    """Abstract runtime driver interface for provisioning and managing notebook environments."""

    @abstractmethod
    def provision(self, instance_id: str, gpu_profile: str, **kwargs) -> Dict[str, Any]:
        """Provision container / instance resources for a notebook."""
        pass

    @abstractmethod
    def start(self, runtime_reference: str) -> Dict[str, Any]:
        """Start a paused notebook environment."""
        pass

    @abstractmethod
    def stop(self, runtime_reference: str) -> Dict[str, Any]:
        """Stop a running notebook environment."""
        pass

    @abstractmethod
    def status(self, runtime_reference: str) -> Dict[str, Any]:
        """Query current runtime status."""
        pass

    @abstractmethod
    def terminate(self, runtime_reference: str) -> Dict[str, Any]:
        """Permanently terminate and clean up container resources."""
        pass


class SimulatedNotebookDriver(NotebookDriver):
    """
    Simulated notebook runtime driver for development, staging, and API contract testing.
    Strictly reports that no real GPU or JupyterLab container is currently provisioned.
    """

    def __init__(self, notice: str = SIMULATION_NOTICE):
        self.notice = notice

    def provision(self, instance_id: str, gpu_profile: str, **kwargs) -> Dict[str, Any]:
        short_id = instance_id.replace("-", "")[:8]
        ref = f"sim-worker-{short_id}"
        host = f"{short_id}.simulated.nodes.inferxe.com"
        logger.info("[SIMULATED DRIVER] Provisioning notebook %s -> %s", instance_id, ref)
        return {
            "status": "running",
            "runtime_reference": ref,
            "host": host,
            "port": 8888,
            "ssh_port": 2222,
            "is_simulated": True,
            "notice": self.notice,
        }

    def start(self, runtime_reference: str) -> Dict[str, Any]:
        logger.info("[SIMULATED DRIVER] Starting notebook with reference: %s", runtime_reference)
        return {
            "status": "running",
            "runtime_reference": runtime_reference,
            "is_simulated": True,
            "notice": self.notice,
        }

    def stop(self, runtime_reference: str) -> Dict[str, Any]:
        logger.info("[SIMULATED DRIVER] Stopping notebook with reference: %s", runtime_reference)
        return {
            "status": "stopped",
            "runtime_reference": runtime_reference,
            "is_simulated": True,
            "notice": self.notice,
        }

    def status(self, runtime_reference: str) -> Dict[str, Any]:
        return {
            "status": "running",
            "runtime_reference": runtime_reference,
            "is_simulated": True,
            "notice": self.notice,
        }

    def terminate(self, runtime_reference: str) -> Dict[str, Any]:
        logger.info("[SIMULATED DRIVER] Terminating notebook with reference: %s", runtime_reference)
        return {
            "status": "terminated",
            "runtime_reference": runtime_reference,
            "is_simulated": True,
            "notice": self.notice,
        }

    def get_logs(self, runtime_reference: str, gpu_profile: str = "NVIDIA L4") -> List[Dict[str, str]]:
        now = datetime.now(timezone.utc)
        iso = now.strftime("%Y-%m-%d %H:%M:%S")
        return [
            {"timestamp": f"{iso}.102", "level": "INFO", "source": "kernel", "message": f"NVIDIA Container Toolkit v1.15.0 initialized for {gpu_profile}"},
            {"timestamp": f"{iso}.214", "level": "INFO", "source": "cuda", "message": "CUDA driver version 550.54.15 (CUDA 12.4 runtime active)"},
            {"timestamp": f"{iso}.340", "level": "INFO", "source": "container", "message": f"Mounting persistent home directory /workspace on {runtime_reference}"},
            {"timestamp": f"{iso}.452", "level": "INFO", "source": "jupyter", "message": "JupyterLab server starting at http://0.0.0.0:8888/lab"},
            {"timestamp": f"{iso}.520", "level": "INFO", "source": "jupyter", "message": "Authentication token verified; secure session established"},
            {"timestamp": f"{iso}.610", "level": "INFO", "source": "vllm", "message": "vLLM runtime ready. Tensor Core acceleration enabled."},
            {"timestamp": f"{iso}.700", "level": "INFO", "source": "health", "message": "Instance health check passed: status=HEALTHY, exit_code=0"},
        ]

    def get_telemetry(self, runtime_reference: str, gpu_profile: str = "NVIDIA L4") -> Dict[str, Any]:
        import time, math
        t = time.time()
        phase = (t % 3600) / 10.0
        temp_c = round(52.0 + 6.0 * math.sin(phase), 1)
        power_w = round(68.0 + 8.0 * math.cos(phase * 1.3), 1) if "L4" in gpu_profile else round(280.0 + 35.0 * math.cos(phase), 1)
        util_pct = round(64.0 + 18.0 * math.sin(phase * 0.7), 1)
        vram_total_gb = 24.0 if "L4" in gpu_profile else (48.0 if "L40S" in gpu_profile else 80.0)
        vram_used_gb = round(vram_total_gb * (0.65 + 0.12 * math.sin(phase * 0.5)), 2)
        fan_speed_pct = round(45.0 + 12.0 * math.sin(phase), 0)

        return {
            "runtime_reference": runtime_reference,
            "gpu_profile": gpu_profile,
            "temperature_c": temp_c,
            "power_draw_w": power_w,
            "gpu_utilization_pct": util_pct,
            "vram_used_gb": vram_used_gb,
            "vram_total_gb": vram_total_gb,
            "fan_speed_pct": fan_speed_pct,
            "pcie_bandwidth_gbps": round(28.4 + 2.0 * math.cos(phase), 1),
            "clock_speed_mhz": round(2100.0 + 120.0 * math.sin(phase), 0),
            "status": "healthy",
            "is_simulated": True,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }


# Default driver instance
default_driver = SimulatedNotebookDriver()


# --- SSH Command & Response Formatting Helpers ---

def get_suggested_key_path(key_type: Optional[str]) -> str:
    """Return default private key file path suggestion based on key algorithm."""
    if not key_type:
        return "~/.ssh/id_ed25519"
    kt = key_type.lower()
    if "rsa" in kt:
        return "~/.ssh/id_rsa"
    if "ecdsa" in kt:
        return "~/.ssh/id_ecdsa"
    return "~/.ssh/id_ed25519"


def format_notebook_ssh_command(notebook: Any, host: str, port: int = 2222) -> str:
    """Format the copyable SSH command for the notebook instance."""
    ssh_key_type = getattr(notebook, "ssh_key_type", None)
    if not ssh_key_type:
        legacy_ssh_key = getattr(notebook, "ssh_key", None)
        if legacy_ssh_key is not None:
            ssh_key_type = getattr(legacy_ssh_key, "key_type", None)

    if ssh_key_type:
        key_path = get_suggested_key_path(ssh_key_type)
        return f"ssh -i {key_path} -p {port} ubuntu@{host}"
    return f"ssh -p {port} ubuntu@{host}"


def serialize_notebook(
    notebook: Any,
    raw_token: Optional[str] = None,
    driver: Optional[NotebookDriver] = None,
) -> NotebookResponse:
    """Convert a Supabase notebook record into a standardized Pydantic NotebookResponse."""
    _ = driver
    deployment_id = getattr(notebook, "deployment_id", None)
    simulated = deployment_id is None
    is_mock = not simulated and notebook.runtime_type == "mock"

    ssh_cmd = None
    jupyter_url = None
    if simulated:
        short_id = str(notebook.id).replace("-", "")[:8]
        host = f"{short_id}.simulated.nodes.inferxe.com"
        ssh_cmd = format_notebook_ssh_command(notebook, host, 2222)
        # If running, provide simulated Jupyter URL (token returned only at creation time)
        if notebook.status == "running":
            token_param = raw_token if raw_token else "active_session"
            jupyter_url = f"https://{host}/lab?token={token_param}"
    elif notebook.status == "running":
        # GPU-backed: the public proxy URL, only once JupyterLab answered readiness and a public base URL is
        # configured. Never a provider address, never a token; opening it still requires a proxy session.
        base = public_notebook_url(load_access_config(), notebook.id)
        jupyter_url = f"{base}lab" if base else None

    return NotebookResponse(
        id=str(notebook.id),
        user_id=notebook.user_id,
        name=notebook.name,
        gpu_profile=notebook.gpu_profile,
        status=notebook.status,
        runtime_type=notebook.runtime_type,
        runtime_reference=notebook.runtime_reference,
        selected_ssh_key_id=str(notebook.selected_ssh_key_id) if notebook.selected_ssh_key_id else None,
        deployment_id=str(deployment_id) if deployment_id is not None else None,
        ssh_command=ssh_cmd,
        jupyter_url=jupyter_url,
        access_token=raw_token,
        is_simulated=simulated or is_mock,
        simulation_notice=SIMULATION_NOTICE if simulated else (MOCK_PROVIDER_NOTICE if is_mock else ""),
        created_at=notebook.created_at.isoformat() if notebook.created_at else "",
        updated_at=notebook.updated_at.isoformat() if notebook.updated_at else "",
        last_active_at=notebook.last_active_at.isoformat() if notebook.last_active_at else None,
    )


# --- Core Service Functions ---

def create_notebook(
    repo: Optional[SupabaseNotebookRepository],
    user_id: str,
    name: str = "Untitled Notebook",
    gpu_profile: str = "NVIDIA L4",
    selected_ssh_key_id: Optional[Union[str, uuid.UUID]] = None,
    driver: Optional[NotebookDriver] = None,
    gpu_id: Optional[str] = None,
    provider_id: Optional[str] = None,
    region: Optional[str] = None,
    idempotency_key: Optional[str] = None,
    deployments: Optional[GpuDeploymentService] = None,
    access_config: Optional[AccessConfig] = None,
) -> Tuple[SupabaseNotebookRecord, Optional[str]]:
    """
    Create and provision a new notebook session in Supabase for the authenticated customer.
    Validates SSH key tenant ownership via `SupabaseSSHKeyRepository`, hashes access
    tokens with SHA-256 before DB persistence, and invokes the runtime driver.

    With `gpu_id`, a real GPU deployment is launched through `GpuDeploymentService` instead of the
    simulated driver (never falling back to simulation). Without it, the simulated path is unchanged.

    Returns:
      (notebook_record, raw_token). raw_token is None when an idempotent retry returns an existing notebook.
    """
    active_repo = repo or get_notebook_repository()
    active_driver = driver or default_driver
    clean_user_id = _validate_user_id(user_id)

    # 1. Validate SSH Key ownership via Supabase SSH keys repository if provided
    validated_ssh_key: Optional[SupabaseSSHKeyRecord] = None
    if selected_ssh_key_id is not None:
        validated_ssh_key = active_repo.validate_owned_ssh_key(
            user_id=clean_user_id,
            selected_ssh_key_id=selected_ssh_key_id,
        )

    clean_name = name.strip() if isinstance(name, str) and name.strip() else "Untitled Notebook"
    if gpu_id is not None:
        return _create_gpu_notebook(
            active_repo, deployments, clean_user_id, clean_name, gpu_id, provider_id, region,
            idempotency_key, validated_ssh_key, access_config,
        )

    # 2. Generate secure session token and SHA-256 hash
    raw_token, token_hash = generate_notebook_token()

    # 3. Provision simulated runtime reference
    instance_id = uuid.uuid4()
    now = datetime.now(timezone.utc)
    clean_profile = (
        gpu_profile.strip()
        if isinstance(gpu_profile, str) and gpu_profile.strip()
        else "NVIDIA L4"
    )
    driver_res = active_driver.provision(str(instance_id), gpu_profile=clean_profile)

    # 4. Persist metadata + token_hash (never raw_token) to Supabase. If that fails, release the runtime
    #    we just provisioned; otherwise a real provider would keep an untracked (billed) GPU running.
    try:
        notebook = active_repo.create_notebook_session(
            instance_id=instance_id,
            user_id=clean_user_id,
            name=clean_name,
            gpu_profile=clean_profile,
            status=driver_res.get("status", "running"),
            runtime_type="simulated",
            runtime_reference=driver_res.get("runtime_reference"),
            selected_ssh_key_id=validated_ssh_key.id if validated_ssh_key is not None else None,
            validated_ssh_key=validated_ssh_key,
            token_hash=token_hash,
            now=now,
        )
    except Exception:
        runtime_reference = driver_res.get("runtime_reference") or str(instance_id)
        try:
            active_driver.terminate(runtime_reference)
            logger.warning("Notebook save failed; released provisioned runtime %s.", runtime_reference)
        except Exception as cleanup_err:  # never mask the original failure
            logger.error("Notebook save failed and runtime %s could not be released (%s).",
                         runtime_reference, type(cleanup_err).__name__)
        raise
    return notebook, raw_token


def _require_deployments(deployments: Optional[GpuDeploymentService]) -> GpuDeploymentService:
    if deployments is None:  # never fall back to the simulated driver for a GPU-backed notebook
        raise NotebookError("GPU-backed notebooks require the GPU deployment service.")
    return deployments


def _create_gpu_notebook(
    repo: SupabaseNotebookRepository,
    deployments: Optional[GpuDeploymentService],
    user_id: str,
    name: str,
    gpu_id: str,
    provider_id: Optional[str],
    region: Optional[str],
    idempotency_key: Optional[str],
    ssh_key: Optional[SupabaseSSHKeyRecord],
    access_config: Optional[AccessConfig] = None,
) -> Tuple[SupabaseNotebookRecord, Optional[str]]:
    service = _require_deployments(deployments)
    if not isinstance(idempotency_key, str) or not idempotency_key.strip():
        raise NotebookValidationError("idempotency_key is required when gpu_id is provided.")
    # Without the proxy secret nobody could ever open the notebook: refuse before a billed GPU is launched.
    config = require_access_config(access_config)
    deployment_key = NOTEBOOK_IDEMPOTENCY_PREFIX + idempotency_key.strip()

    row = service.repo.get_by_idempotency_key(user_id, deployment_key)
    created_here = False
    if row is None:
        # The deployment id is fixed before launch: JupyterLab's base_url (/nb/<notebook id>/) and internal token
        # both derive from it. Provider failures raise DeploymentProvisioningError (deployment kept as failed).
        deployment_id = str(uuid.uuid4())
        row = service.create(
            user_id=user_id,
            name=name[:100],
            model_name=NOTEBOOK_MODEL_NAME,
            gpu_id=gpu_id,
            provider_id=provider_id,
            region=region,
            ssh_key_ids=[ssh_key.id] if ssh_key is not None else None,
            idempotency_key=deployment_key,
            notebook=True,
            container=notebook_container_for(
                notebook_id_for_deployment(deployment_id), internal_jupyter_token(config, deployment_id)),
            deployment_id=deployment_id,
        )
        # A concurrent request with the same key may have launched first; then its row comes back instead.
        created_here = row["id"] == deployment_id
    elif (row.get("metadata") or {}).get("workload") != "notebook":
        raise DeploymentRequestError("This idempotency key is already used by a deployment that is not a notebook.")

    notebook_id = notebook_id_for_deployment(row["id"])
    existing = repo.get_notebook_by_id(user_id=user_id, notebook_id=notebook_id)
    if existing is not None:
        return existing, None  # retry of a completed request; the one-time token was issued to the first response
    if row["status"] in ENDED_DEPLOYMENT_STATUSES:
        # Includes provider timeouts: the instance may still appear, so this key must never launch another GPU.
        raise DeploymentStateError(
            "The GPU launch for this idempotency key failed or has ended. Retry with a new idempotency key."
        )

    # The customer token only unlocks the Inferxe proxy (JupyterLab uses the internal token), so a fresh one works
    # even when attaching to a deployment launched by an earlier request whose response was lost.
    raw_token, token_hash = generate_notebook_token()
    try:
        notebook = repo.create_notebook_session(
            instance_id=notebook_id,
            user_id=user_id,
            name=name,
            gpu_profile=row.get("gpu_model") or gpu_id,
            status=notebook_status_after_launch(row["status"]),
            runtime_type=row["provider_id"],
            runtime_reference=row.get("provider_instance_id"),
            selected_ssh_key_id=ssh_key.id if ssh_key is not None else None,
            validated_ssh_key=ssh_key,
            token_hash=token_hash,
            deployment_id=row["id"],
        )
    except SupabaseNotebookConflictError:
        # A concurrent retry with the same key saved this notebook first.
        return repo.get_notebook(user_id=user_id, notebook_id=notebook_id), None
    except Exception:
        # shortcut: only the request that launched the deployment releases it, so a retry never kills an instance
        # another request is still recording; an active deployment left without a notebook stays visible in
        # /gpu/deployments and a retry with the same key attaches a notebook to it.
        if created_here:
            _release_deployment(service, user_id, row["id"])
        raise
    return notebook, raw_token


def _release_deployment(service: GpuDeploymentService, user_id: str, deployment_id: str,
                        reason: str = "notebook save failed") -> None:
    try:
        service.terminate(user_id, deployment_id)
        logger.warning("Terminated GPU deployment %s: %s.", deployment_id, reason)
    except Exception as cleanup_err:  # never mask the original failure
        logger.error("ORPHANED GPU deployment %s: %s and termination failed (%s).",
                     deployment_id, reason, type(cleanup_err).__name__)


def _deployment_action(
    deployments: Optional[GpuDeploymentService],
    user_id: str,
    notebook: SupabaseNotebookRecord,
    action: str,
) -> str:
    """Run a lifecycle action on the notebook's GPU deployment and return the deployment's resulting status."""
    service = _require_deployments(deployments)
    call = {"start": service.resume, "stop": service.stop, "terminate": service.terminate}[action]
    return call(user_id, str(notebook.deployment_id))["status"]


def list_user_notebooks(
    repo: Optional[SupabaseNotebookRepository],
    user_id: str,
    include_terminated: bool = False,
) -> List[SupabaseNotebookRecord]:
    """
    List notebook sessions in Supabase belonging strictly to the authenticated customer.
    By default excludes `'terminated'` sessions.
    """
    active_repo = repo or get_notebook_repository()
    return active_repo.list_user_notebooks(
        user_id=user_id,
        include_terminated=include_terminated,
    )


def get_notebook(
    repo: Optional[SupabaseNotebookRepository],
    user_id: str,
    notebook_id: Union[str, uuid.UUID],
    deployments: Optional[GpuDeploymentService] = None,
    probe=None,
    now: Optional[datetime] = None,
    startup_timeout: float = NOTEBOOK_STARTUP_TIMEOUT_SECONDS,
) -> SupabaseNotebookRecord:
    """
    Retrieve a single notebook session by ID from Supabase, verifying tenant ownership.
    Raises NotebookNotFoundError if the notebook does not exist or belongs to another user.
    GPU-backed notebooks take their status from the deployment (refreshed from the provider) plus a JupyterLab
    readiness probe, and store it. A notebook whose JupyterLab misses the startup timeout is marked failed and
    its GPU deployment is terminated, so a failed start never leaves a billed instance running.
    """
    active_repo = repo or get_notebook_repository()
    notebook = active_repo.get_notebook(user_id=user_id, notebook_id=notebook_id)
    if notebook.deployment_id is None or notebook.status == "terminated" or deployments is None:
        return notebook

    deployment = deployments.get(user_id, str(notebook.deployment_id))
    status, terminate = notebook_status_from_deployment(
        deployment, notebook.status, probe or probe_jupyter, now or datetime.now(timezone.utc), startup_timeout)
    if terminate:
        _release_deployment(deployments, user_id, deployment["id"],
                            reason=f"JupyterLab did not become ready within {startup_timeout:.0f}s")
    if status == notebook.status or status not in VALID_NOTEBOOK_STATUSES:
        return notebook
    try:
        return active_repo.transition_notebook_status(
            user_id=user_id,
            notebook_id=notebook.id,
            action="sync",
            expected_status=notebook.status,
            new_status=status,
        )
    except InvalidStateTransitionError:  # changed concurrently: return what is stored now
        return active_repo.get_notebook(user_id=user_id, notebook_id=notebook.id)


def start_notebook(
    repo: Optional[SupabaseNotebookRepository],
    user_id: str,
    notebook_id: Union[str, uuid.UUID],
    driver: Optional[NotebookDriver] = None,
    deployments: Optional[GpuDeploymentService] = None,
) -> SupabaseNotebookRecord:
    """
    Start a stopped, starting, provisioning, or failed notebook session.
    Validates ownership and state transitions atomically in Supabase.
    GPU-backed notebooks resume their deployment.
    """
    active_repo = repo or get_notebook_repository()
    active_driver = driver or default_driver

    notebook = active_repo.get_notebook(
        user_id=user_id,
        notebook_id=notebook_id,
        resolve_ssh_key=False,
    )

    if notebook.status == "running":
        raise InvalidStateTransitionError("Notebook is already running.")
    if notebook.status == "terminated":
        raise InvalidStateTransitionError("Cannot start a terminated notebook.")
    if notebook.status not in ALLOWED_START_SOURCE_STATUSES:
        raise InvalidStateTransitionError(
            f"Cannot start notebook in '{notebook.status}' state."
        )

    if notebook.deployment_id is not None:
        new_status = notebook_status_after_launch(_deployment_action(deployments, user_id, notebook, "start"))
    else:
        new_status = active_driver.start(notebook.runtime_reference or str(notebook.id)).get("status", "running")
    return active_repo.transition_notebook_status(
        user_id=user_id,
        notebook_id=notebook.id,
        action="start",
        expected_status=notebook.status,
        new_status=new_status,
    )


def stop_notebook(
    repo: Optional[SupabaseNotebookRepository],
    user_id: str,
    notebook_id: Union[str, uuid.UUID],
    driver: Optional[NotebookDriver] = None,
    deployments: Optional[GpuDeploymentService] = None,
) -> SupabaseNotebookRecord:
    """
    Stop a running, starting, or provisioning notebook session.
    Validates ownership and state transitions atomically in Supabase.
    GPU-backed notebooks stop their deployment.
    """
    active_repo = repo or get_notebook_repository()
    active_driver = driver or default_driver

    notebook = active_repo.get_notebook(
        user_id=user_id,
        notebook_id=notebook_id,
        resolve_ssh_key=False,
    )

    if notebook.status == "stopped":
        raise InvalidStateTransitionError("Notebook is already stopped.")
    if notebook.status == "terminated":
        raise InvalidStateTransitionError("Cannot stop a terminated notebook.")
    if notebook.status not in ALLOWED_STOP_SOURCE_STATUSES:
        raise InvalidStateTransitionError(
            f"Cannot stop notebook in '{notebook.status}' state."
        )

    if notebook.deployment_id is not None:
        new_status = _deployment_action(deployments, user_id, notebook, "stop")
    else:
        new_status = active_driver.stop(notebook.runtime_reference or str(notebook.id)).get("status", "stopped")
    return active_repo.transition_notebook_status(
        user_id=user_id,
        notebook_id=notebook.id,
        action="stop",
        expected_status=notebook.status,
        new_status=new_status,
    )


def terminate_notebook(
    repo: Optional[SupabaseNotebookRepository],
    user_id: str,
    notebook_id: Union[str, uuid.UUID],
    driver: Optional[NotebookDriver] = None,
    deployments: Optional[GpuDeploymentService] = None,
) -> SupabaseNotebookRecord:
    """
    Permanently terminate a notebook session in Supabase (`status='terminated'`).
    Validates ownership and state transitions atomically.
    GPU-backed notebooks terminate their deployment first, so no billed instance outlives the notebook.
    """
    active_repo = repo or get_notebook_repository()
    active_driver = driver or default_driver

    notebook = active_repo.get_notebook(
        user_id=user_id,
        notebook_id=notebook_id,
        resolve_ssh_key=False,
    )

    if notebook.status == "terminated":
        raise InvalidStateTransitionError("Notebook is already terminated.")

    if notebook.deployment_id is not None:
        _deployment_action(deployments, user_id, notebook, "terminate")
    else:
        active_driver.terminate(notebook.runtime_reference or str(notebook.id))
    return active_repo.transition_notebook_status(
        user_id=user_id,
        notebook_id=notebook.id,
        action="terminate",
        expected_status=notebook.status,
        new_status="terminated",
    )


def _require_gpu_notebook(notebook: SupabaseNotebookRecord) -> None:
    if notebook.deployment_id is None:
        raise InvalidStateTransitionError("Simulated notebooks have no JupyterLab to access.")
    if notebook.status == "terminated":
        raise InvalidStateTransitionError("The notebook is terminated.")


def rotate_notebook_token(
    repo: Optional[SupabaseNotebookRepository],
    user_id: str,
    notebook_id: Union[str, uuid.UUID],
) -> Tuple[SupabaseNotebookRecord, str]:
    """Issue a new customer notebook token for the owner. The old token, its proxy sessions and any unused access
    tickets stop working immediately (they are bound to the stored hash). The raw token is returned once."""
    active_repo = repo or get_notebook_repository()
    notebook = active_repo.get_notebook(user_id=user_id, notebook_id=notebook_id, resolve_ssh_key=False)
    _require_gpu_notebook(notebook)
    raw_token, token_hash = generate_notebook_token()
    record = active_repo.update_token_hash(user_id=user_id, notebook_id=notebook.id, token_hash=token_hash)
    logger.info("Notebook token rotated: id=%s", record.id)
    return record, raw_token


def create_notebook_access(
    repo: Optional[SupabaseNotebookRepository],
    user_id: str,
    notebook_id: Union[str, uuid.UUID],
    deployments: Optional[GpuDeploymentService] = None,
    access_config: Optional[AccessConfig] = None,
    probe=None,
) -> Tuple[str, SupabaseNotebookRecord]:
    """One-time proxy URL for the owner's running notebook (the console's Open button).

    Refreshes status and readiness first; refuses unless JupyterLab answered. The URL carries a 60-second,
    single-use ticket bound to this user, this notebook and the current token hash."""
    config = require_access_config(access_config)
    if not config.base_url:
        raise NotebookAccessNotConfiguredError(
            "Notebook access has no public URL configured on this server (NOTEBOOK_PROXY_BASE_URL).")
    active_repo = repo or get_notebook_repository()
    notebook = get_notebook(active_repo, user_id, notebook_id, deployments=_require_deployments(deployments),
                            probe=probe)
    _require_gpu_notebook(notebook)
    if notebook.status != "running":
        raise InvalidStateTransitionError(f"The notebook is not ready yet (status: {notebook.status}).")
    found = active_repo.get_notebook_with_token_hash(notebook.id)
    if found is None or found[0].user_id != notebook.user_id:
        raise NotebookNotFoundError("Notebook not found.")
    ticket = new_ticket(config, str(notebook.id), notebook.user_id, found[1])
    return ticket_url(config, str(notebook.id), ticket), notebook


def get_notebook_logs(
    repo: Optional[SupabaseNotebookRepository],
    notebook_id: Union[str, uuid.UUID],
    user_id: str,
    driver: Optional[NotebookDriver] = None,
) -> Dict[str, Any]:
    active_repo = repo or get_notebook_repository()
    active_driver = driver or default_driver
    clean_user_id = _validate_user_id(user_id)
    rec = active_repo.get_by_id(notebook_id=notebook_id, user_id=clean_user_id)
    if not rec:
        raise NotebookNotFoundError(f"Notebook session '{notebook_id}' not found for user.")
    
    logs = []
    if hasattr(active_driver, "get_logs"):
        logs = active_driver.get_logs(rec.runtime_reference or f"sim-{rec.id}", rec.gpu_profile)
    return {
        "notebook_id": str(rec.id),
        "name": rec.name,
        "status": rec.status,
        "logs": logs,
        "is_simulated": True,
    }


def get_notebook_telemetry(
    repo: Optional[SupabaseNotebookRepository],
    notebook_id: Union[str, uuid.UUID],
    user_id: str,
    driver: Optional[NotebookDriver] = None,
) -> Dict[str, Any]:
    active_repo = repo or get_notebook_repository()
    active_driver = driver or default_driver
    clean_user_id = _validate_user_id(user_id)
    rec = active_repo.get_by_id(notebook_id=notebook_id, user_id=clean_user_id)
    if not rec:
        raise NotebookNotFoundError(f"Notebook session '{notebook_id}' not found for user.")
    
    telemetry = {}
    if hasattr(active_driver, "get_telemetry"):
        telemetry = active_driver.get_telemetry(rec.runtime_reference or f"sim-{rec.id}", rec.gpu_profile)
    return {
        "notebook_id": str(rec.id),
        "name": rec.name,
        "status": rec.status,
        "telemetry": telemetry,
        "is_simulated": True,
    }


__all__ = [
    "SIMULATION_NOTICE",
    "NotebookError",
    "NotebookNotFoundError",
    "NotebookValidationError",
    "InvalidStateTransitionError",
    "SupabaseNotebookError",
    "SupabaseNotebookServiceUnavailableError",
    "SupabaseNotebookValidationError",
    "NotebookDriver",
    "SimulatedNotebookDriver",
    "default_driver",
    "MOCK_PROVIDER_NOTICE",
    "rotate_notebook_token",
    "create_notebook_access",
    "NotebookAccessNotConfiguredError",
    "notebook_id_for_deployment",
    "NOTEBOOK_CONTAINER",
    "NOTEBOOK_IMAGE",
    "notebook_container_for",
    "jupyter_base_url",
    "probe_jupyter",
    "notebook_status_from_deployment",
    "generate_notebook_token",
    "verify_notebook_token",
    "get_suggested_key_path",
    "format_notebook_ssh_command",
    "serialize_notebook",
    "create_notebook",
    "list_user_notebooks",
    "get_notebook",
    "start_notebook",
    "stop_notebook",
    "terminate_notebook",
    "get_notebook_logs",
    "get_notebook_telemetry",
]
