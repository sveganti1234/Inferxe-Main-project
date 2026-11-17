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
import logging
import secrets
import uuid
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple, Union

from inference.schemas import NotebookResponse
from inference.supabase_notebooks import (
    ALLOWED_START_SOURCE_STATUSES,
    ALLOWED_STOP_SOURCE_STATUSES,
    InvalidStateTransitionError,
    NotebookError,
    NotebookNotFoundError,
    NotebookValidationError,
    SupabaseNotebookError,
    SupabaseNotebookRecord,
    SupabaseNotebookRepository,
    SupabaseNotebookServiceUnavailableError,
    SupabaseNotebookValidationError,
    _validate_user_id,
    get_notebook_repository,
)
from inference.supabase_ssh_keys import SupabaseSSHKeyRecord

logger = logging.getLogger("inferxe.notebook_service")

SIMULATION_NOTICE = "Simulated notebook runtime: no physical GPU or JupyterLab container is running."


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
    short_id = str(notebook.id).replace("-", "")[:8]
    host = f"{short_id}.simulated.nodes.inferxe.com"
    ssh_port = 2222

    ssh_cmd = format_notebook_ssh_command(notebook, host, ssh_port)

    # If running, provide simulated Jupyter URL (token returned only at creation time)
    jupyter_url = None
    if notebook.status == "running":
        token_param = raw_token if raw_token else "active_session"
        jupyter_url = f"https://{host}/lab?token={token_param}"

    return NotebookResponse(
        id=str(notebook.id),
        user_id=notebook.user_id,
        name=notebook.name,
        gpu_profile=notebook.gpu_profile,
        status=notebook.status,
        runtime_type=notebook.runtime_type,
        runtime_reference=notebook.runtime_reference,
        selected_ssh_key_id=str(notebook.selected_ssh_key_id) if notebook.selected_ssh_key_id else None,
        ssh_command=ssh_cmd,
        jupyter_url=jupyter_url,
        access_token=raw_token,
        is_simulated=True,
        simulation_notice=SIMULATION_NOTICE,
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
) -> Tuple[SupabaseNotebookRecord, str]:
    """
    Create and provision a new notebook session in Supabase for the authenticated customer.
    Validates SSH key tenant ownership via `SupabaseSSHKeyRepository`, hashes access
    tokens with SHA-256 before DB persistence, and invokes the runtime driver.

    Returns:
      (notebook_record, raw_token)
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

    # 2. Generate secure session token and SHA-256 hash
    raw_token, token_hash = generate_notebook_token()

    # 3. Provision simulated runtime reference
    instance_id = uuid.uuid4()
    now = datetime.now(timezone.utc)
    clean_name = name.strip() if isinstance(name, str) and name.strip() else "Untitled Notebook"
    clean_profile = (
        gpu_profile.strip()
        if isinstance(gpu_profile, str) and gpu_profile.strip()
        else "NVIDIA L4"
    )
    driver_res = active_driver.provision(str(instance_id), gpu_profile=clean_profile)

    # 4. Persist metadata + token_hash (never raw_token) to Supabase
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
    return notebook, raw_token


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
) -> SupabaseNotebookRecord:
    """
    Retrieve a single notebook session by ID from Supabase, verifying tenant ownership.
    Raises NotebookNotFoundError if the notebook does not exist or belongs to another user.
    """
    active_repo = repo or get_notebook_repository()
    return active_repo.get_notebook(user_id=user_id, notebook_id=notebook_id)


def start_notebook(
    repo: Optional[SupabaseNotebookRepository],
    user_id: str,
    notebook_id: Union[str, uuid.UUID],
    driver: Optional[NotebookDriver] = None,
) -> SupabaseNotebookRecord:
    """
    Start a stopped, starting, provisioning, or failed notebook session.
    Validates ownership and state transitions atomically in Supabase.
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

    driver_res = active_driver.start(notebook.runtime_reference or str(notebook.id))
    return active_repo.transition_notebook_status(
        user_id=user_id,
        notebook_id=notebook.id,
        action="start",
        expected_status=notebook.status,
        new_status=driver_res.get("status", "running"),
    )


def stop_notebook(
    repo: Optional[SupabaseNotebookRepository],
    user_id: str,
    notebook_id: Union[str, uuid.UUID],
    driver: Optional[NotebookDriver] = None,
) -> SupabaseNotebookRecord:
    """
    Stop a running, starting, or provisioning notebook session.
    Validates ownership and state transitions atomically in Supabase.
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

    driver_res = active_driver.stop(notebook.runtime_reference or str(notebook.id))
    return active_repo.transition_notebook_status(
        user_id=user_id,
        notebook_id=notebook.id,
        action="stop",
        expected_status=notebook.status,
        new_status=driver_res.get("status", "stopped"),
    )


def terminate_notebook(
    repo: Optional[SupabaseNotebookRepository],
    user_id: str,
    notebook_id: Union[str, uuid.UUID],
    driver: Optional[NotebookDriver] = None,
) -> SupabaseNotebookRecord:
    """
    Permanently terminate a notebook session in Supabase (`status='terminated'`).
    Validates ownership and state transitions atomically.
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

    active_driver.terminate(notebook.runtime_reference or str(notebook.id))
    return active_repo.transition_notebook_status(
        user_id=user_id,
        notebook_id=notebook.id,
        action="terminate",
        expected_status=notebook.status,
        new_status="terminated",
    )


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
]
