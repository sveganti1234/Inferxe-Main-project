"""
notebook_service.py
===================
Orchestration and service layer for customer GPU Notebook Instances.
Provides:
  - Driver abstraction for container / pod / simulated runtimes.
  - SimulatedNotebookDriver reporting transparent simulation status.
  - User-scoped notebook lifecycle management (create, list, get, start, stop, terminate).
  - Secure session token generation and SHA-256 hashing (no raw tokens persisted).
  - Multi-tenant isolation and SSH key binding validation.
"""

import uuid
import secrets
import hashlib
import logging
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from typing import Dict, Any, Optional, List, Tuple

from sqlalchemy.orm import Session

from inference.models import NotebookInstance
from inference.schemas import NotebookResponse
from inference.ssh_key_service import get_ssh_key_by_id, get_user_authorized_keys

logger = logging.getLogger("inferxe.notebook_service")

SIMULATION_NOTICE = "Simulated notebook runtime: no physical GPU or JupyterLab container is running."


# --- Exceptions ---

class NotebookError(Exception):
    """Base exception for notebook operations."""
    pass


class NotebookNotFoundError(NotebookError):
    """Raised when a notebook is not found or user lacks access."""
    pass


class NotebookValidationError(NotebookError):
    """Raised when notebook parameters or SSH key bindings are invalid."""
    pass


class InvalidStateTransitionError(NotebookError):
    """Raised when a requested lifecycle state transition is disallowed."""
    pass


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
        logger.info(f"[SIMULATED DRIVER] Provisioning notebook {instance_id} with profile '{gpu_profile}' -> {ref}")
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
        logger.info(f"[SIMULATED DRIVER] Starting notebook with reference: {runtime_reference}")
        return {
            "status": "running",
            "runtime_reference": runtime_reference,
            "is_simulated": True,
            "notice": self.notice,
        }

    def stop(self, runtime_reference: str) -> Dict[str, Any]:
        logger.info(f"[SIMULATED DRIVER] Stopping notebook with reference: {runtime_reference}")
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
        logger.info(f"[SIMULATED DRIVER] Terminating notebook with reference: {runtime_reference}")
        return {
            "status": "terminated",
            "runtime_reference": runtime_reference,
            "is_simulated": True,
            "notice": self.notice,
        }


# Default driver instance for Stage 2A
default_driver = SimulatedNotebookDriver()


# --- SSH Command & Path Helpers ---

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


def format_notebook_ssh_command(notebook: NotebookInstance, host: str, port: int = 2222) -> str:
    """Format the copyable SSH command for the notebook instance."""
    if notebook.ssh_key:
        key_path = get_suggested_key_path(notebook.ssh_key.key_type)
        return f"ssh -i {key_path} -p {port} ubuntu@{host}"
    return f"ssh -p {port} ubuntu@{host}"


def serialize_notebook(
    notebook: NotebookInstance,
    raw_token: Optional[str] = None,
    driver: Optional[NotebookDriver] = None,
) -> NotebookResponse:
    """Convert a NotebookInstance ORM model into a standardized Pydantic NotebookResponse."""
    short_id = str(notebook.id).replace("-", "")[:8]
    host = f"{short_id}.simulated.nodes.inferxe.com"
    ssh_port = 2222

    # Construct URLs and commands
    ssh_cmd = format_notebook_ssh_command(notebook, host, ssh_port)

    # If running, provide simulated Jupyter URL with token
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
    db: Session,
    user_id: str,
    name: str = "Untitled Notebook",
    gpu_profile: str = "NVIDIA L4",
    selected_ssh_key_id: Optional[uuid.UUID] = None,
    driver: Optional[NotebookDriver] = None,
) -> Tuple[NotebookInstance, str]:
    """
    Create and provision a new notebook instance for the authenticated customer.
    Validates SSH key tenant ownership, hashes access tokens before DB storage,
    and invokes the runtime driver.

    Returns:
      (notebook_instance, raw_token)
    """
    active_driver = driver or default_driver
    clean_user_id = user_id.strip()

    # 1. Validate SSH Key ownership if provided
    if selected_ssh_key_id:
        ssh_key = get_ssh_key_by_id(db, clean_user_id, selected_ssh_key_id)
        if not ssh_key:
            raise NotebookValidationError(
                "Selected SSH key does not exist or does not belong to your account."
            )

    # 2. Generate secure session token and SHA-256 hash
    raw_token, token_hash = generate_notebook_token()

    # 3. Create ORM instance
    instance_id = uuid.uuid4()
    now = datetime.now(timezone.utc)

    # 4. Invoke runtime driver
    driver_res = active_driver.provision(str(instance_id), gpu_profile=gpu_profile)

    notebook = NotebookInstance(
        id=instance_id,
        user_id=clean_user_id,
        name=name.strip() or "Untitled Notebook",
        gpu_profile=gpu_profile.strip() or "NVIDIA L4",
        status=driver_res.get("status", "running"),
        runtime_type="simulated",
        runtime_reference=driver_res.get("runtime_reference"),
        selected_ssh_key_id=selected_ssh_key_id,
        token_hash=token_hash,
        created_at=now,
        updated_at=now,
        last_active_at=now,
    )

    try:
        db.add(notebook)
        db.commit()
        db.refresh(notebook)
        logger.info(
            f"Notebook created: id={notebook.id} user_id={clean_user_id} "
            f"name='{notebook.name}' profile='{notebook.gpu_profile}' status='{notebook.status}'"
        )
        return notebook, raw_token
    except Exception as e:
        db.rollback()
        logger.error(f"Failed to persist notebook instance in database: {e}")
        raise


def list_user_notebooks(
    db: Session,
    user_id: str,
    include_terminated: bool = False,
) -> List[NotebookInstance]:
    """
    List notebook instances belonging to the authenticated customer.
    Enforces tenant isolation. By default excludes terminated sessions.
    """
    query = (
        db.query(NotebookInstance)
        .filter(NotebookInstance.user_id == user_id.strip())
    )
    if not include_terminated:
        query = query.filter(NotebookInstance.status != "terminated")

    return query.order_by(NotebookInstance.created_at.desc()).all()


def get_notebook(
    db: Session,
    user_id: str,
    notebook_id: uuid.UUID,
) -> NotebookInstance:
    """
    Retrieve a single notebook instance by ID, verifying tenant ownership.
    Raises NotebookNotFoundError if the notebook does not exist or belongs to another user.
    """
    notebook = (
        db.query(NotebookInstance)
        .filter(
            NotebookInstance.id == notebook_id,
            NotebookInstance.user_id == user_id.strip(),
        )
        .first()
    )
    if not notebook:
        raise NotebookNotFoundError(f"Notebook '{notebook_id}' not found.")
    return notebook


def start_notebook(
    db: Session,
    user_id: str,
    notebook_id: uuid.UUID,
    driver: Optional[NotebookDriver] = None,
) -> NotebookInstance:
    """
    Start a stopped or provisioning notebook instance.
    Validates ownership and state transitions.
    """
    notebook = get_notebook(db, user_id, notebook_id)
    active_driver = driver or default_driver

    if notebook.status == "running":
        raise InvalidStateTransitionError("Notebook is already running.")
    if notebook.status == "terminated":
        raise InvalidStateTransitionError("Cannot start a terminated notebook.")
    if notebook.status not in ("stopped", "provisioning", "failed"):
        raise InvalidStateTransitionError(
            f"Cannot start notebook in '{notebook.status}' state."
        )

    # Invoke runtime driver
    driver_res = active_driver.start(notebook.runtime_reference or str(notebook.id))
    now = datetime.now(timezone.utc)

    notebook.status = driver_res.get("status", "running")
    notebook.updated_at = now
    notebook.last_active_at = now

    try:
        db.commit()
        db.refresh(notebook)
        logger.info(f"Notebook started: id={notebook.id} user_id={user_id}")
        return notebook
    except Exception as e:
        db.rollback()
        logger.error(f"Failed to start notebook {notebook_id}: {e}")
        raise


def stop_notebook(
    db: Session,
    user_id: str,
    notebook_id: uuid.UUID,
    driver: Optional[NotebookDriver] = None,
) -> NotebookInstance:
    """
    Stop a running notebook instance.
    Validates ownership and state transitions.
    """
    notebook = get_notebook(db, user_id, notebook_id)
    active_driver = driver or default_driver

    if notebook.status == "stopped":
        raise InvalidStateTransitionError("Notebook is already stopped.")
    if notebook.status == "terminated":
        raise InvalidStateTransitionError("Cannot stop a terminated notebook.")
    if notebook.status not in ("running", "provisioning"):
        raise InvalidStateTransitionError(
            f"Cannot stop notebook in '{notebook.status}' state."
        )

    # Invoke runtime driver
    driver_res = active_driver.stop(notebook.runtime_reference or str(notebook.id))
    now = datetime.now(timezone.utc)

    notebook.status = driver_res.get("status", "stopped")
    notebook.updated_at = now

    try:
        db.commit()
        db.refresh(notebook)
        logger.info(f"Notebook stopped: id={notebook.id} user_id={user_id}")
        return notebook
    except Exception as e:
        db.rollback()
        logger.error(f"Failed to stop notebook {notebook_id}: {e}")
        raise


def terminate_notebook(
    db: Session,
    user_id: str,
    notebook_id: uuid.UUID,
    driver: Optional[NotebookDriver] = None,
) -> NotebookInstance:
    """
    Permanently terminate a notebook instance.
    Validates ownership and updates status to 'terminated'.
    """
    notebook = get_notebook(db, user_id, notebook_id)
    active_driver = driver or default_driver

    if notebook.status == "terminated":
        raise InvalidStateTransitionError("Notebook is already terminated.")

    # Invoke runtime driver
    active_driver.terminate(notebook.runtime_reference or str(notebook.id))
    now = datetime.now(timezone.utc)

    notebook.status = "terminated"
    notebook.updated_at = now

    try:
        db.commit()
        db.refresh(notebook)
        logger.info(f"Notebook terminated: id={notebook.id} user_id={user_id}")
        return notebook
    except Exception as e:
        db.rollback()
        logger.error(f"Failed to terminate notebook {notebook_id}: {e}")
        raise

