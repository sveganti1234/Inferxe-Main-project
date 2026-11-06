"""
ssh_key_service.py
==================
Enterprise SSH Public Key Management Service for Inferxe.
Provides cryptographic validation for OpenSSH public keys (RSA >= 2048-bit,
Ed25519, ECDSA), standard OpenSSH SHA-256 fingerprint calculation, strict
private-key rejection, and tenant-scoped duplicate detection.

Never logs full public keys or stores private keys.
"""

import re
import uuid
import base64
import hashlib
import logging
from typing import Dict, Any, List, Optional
from datetime import datetime, timezone

from cryptography.hazmat.primitives.asymmetric import rsa, ed25519, ec
from cryptography.hazmat.primitives.serialization import load_ssh_public_key
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from inference.models import SSHKey

logger = logging.getLogger("inferxe.ssh_keys")

# Standard allowed OpenSSH public key algorithm identifiers
ALLOWED_KEY_TYPES = {
    "ssh-ed25519",
    "ssh-rsa",
    "ecdsa-sha2-nistp256",
    "ecdsa-sha2-nistp384",
    "ecdsa-sha2-nistp521",
}

# Minimum bit length for RSA keys (NIST / OpenSSH enterprise standard)
MIN_RSA_BIT_LENGTH = 2048

# Patterns identifying private key blocks that must be strictly rejected
PRIVATE_KEY_PATTERNS = [
    r"-----BEGIN [A-Z0-9\s]+PRIVATE KEY-----",
    r"PRIVATE\s+KEY",
]


class SSHKeyValidationError(Exception):
    """Raised when an uploaded SSH key fails format, algorithm, or security validation."""
    pass


class DuplicateSSHKeyError(Exception):
    """Raised when an SSH key with identical fingerprint already exists for the tenant."""
    pass


def mask_public_key(public_key_str: str) -> str:
    """
    Safely format a public key for audit logs and diagnostic messages.
    Never outputs the complete public key text.
    """
    parts = public_key_str.strip().split()
    if not parts:
        return "<empty>"
    key_type = parts[0]
    if len(parts) >= 2:
        blob = parts[1]
        snippet = f"{blob[:10]}...{blob[-6:]}" if len(blob) > 20 else blob
        comment = f" ({parts[2]})" if len(parts) >= 3 else ""
        return f"{key_type} {snippet}{comment}"
    return f"{key_type} <truncated>"


def compute_openssh_fingerprint(raw_blob_base64: str) -> str:
    """
    Calculate the standard OpenSSH SHA-256 base64 fingerprint without padding.
    Matches the exact output of: `ssh-keygen -lf <key_file.pub>`
    Format: 'SHA256:<32_byte_sha256_base64_without_trailing_equals>'
    """
    try:
        raw_key_bytes = base64.b64decode(raw_blob_base64)
    except Exception as e:
        raise SSHKeyValidationError(f"Invalid base64 payload in public key blob: {e}")

    digest = hashlib.sha256(raw_key_bytes).digest()
    b64_digest = base64.b64encode(digest).decode("ascii").rstrip("=")
    return f"SHA256:{b64_digest}"


def validate_and_parse_ssh_public_key(raw_key: str) -> Dict[str, Any]:
    """
    Cryptographically parse and validate an OpenSSH public key string.

    Validation rules:
    1. Rejects empty or whitespace-only inputs.
    2. Strictly rejects private key files (e.g. id_rsa, id_ed25519).
    3. Enforces OpenSSH format: `<algorithm> <base64_blob> [optional_comment]`.
    4. Enforces algorithm whitelist: ssh-ed25519, ssh-rsa, ecdsa-sha2-nistp*.
    5. Cryptographically parses key using cryptography library.
    6. Enforces minimum 2048-bit length for RSA keys (rejects 1024-bit or 512-bit).
    7. Computes standard OpenSSH SHA-256 fingerprint.

    Returns:
        dict: {
            "key_type": str,
            "public_key": str,
            "fingerprint": str,
            "comment": Optional[str],
            "key_size": Optional[int],
        }
    """
    if not raw_key or not raw_key.strip():
        raise SSHKeyValidationError("Public key string cannot be empty.")

    clean_key = raw_key.strip()

    # Rule 1: Strict rejection of private key material
    for pattern in PRIVATE_KEY_PATTERNS:
        if re.search(pattern, clean_key, re.IGNORECASE):
            logger.warning("Submission rejected: Private key detected in public key field.")
            raise SSHKeyValidationError(
                "Private keys are strictly prohibited. "
                "Never share your private key (e.g. id_ed25519). "
                "Please provide your public key (.pub file, e.g. id_ed25519.pub)."
            )

    # Rule 2: OpenSSH single-line structure validation
    lines = [line.strip() for line in clean_key.splitlines() if line.strip()]
    if len(lines) > 1:
        raise SSHKeyValidationError(
            "Expected a single-line OpenSSH public key. Multiple lines or block certificates are not supported."
        )

    single_line = lines[0]
    parts = single_line.split()
    if len(parts) < 2:
        raise SSHKeyValidationError(
            "Malformed OpenSSH public key. Expected format: '<algorithm> <base64_blob> [comment]'."
        )

    key_type = parts[0].strip().lower()
    raw_blob_b64 = parts[1].strip()
    comment = " ".join(parts[2:]).strip() if len(parts) >= 3 else None

    # Rule 3: Whitelisted algorithm validation
    if key_type not in ALLOWED_KEY_TYPES:
        allowed_list = ", ".join(sorted(ALLOWED_KEY_TYPES))
        raise SSHKeyValidationError(
            f"Unsupported key algorithm '{key_type}'. "
            f"Supported algorithms: {allowed_list}"
        )

    # Rule 4: Cryptographic validation using OpenSSL / cryptography library
    try:
        parsed_key = load_ssh_public_key(single_line.encode("utf-8"))
    except Exception as parse_err:
        raise SSHKeyValidationError(
            f"Failed to cryptographically decode OpenSSH public key: {parse_err}"
        )

    # Rule 5: Algorithm-specific checks
    key_size: Optional[int] = None

    if isinstance(parsed_key, rsa.RSAPublicKey):
        key_size = parsed_key.key_size
        if key_size < MIN_RSA_BIT_LENGTH:
            raise SSHKeyValidationError(
                f"Insecure RSA key length ({key_size} bits). "
                f"RSA keys must be at least {MIN_RSA_BIT_LENGTH} bits for enterprise GPU cluster security."
            )
    elif isinstance(parsed_key, ed25519.Ed25519PublicKey):
        key_size = 256
    elif isinstance(parsed_key, ec.EllipticCurvePublicKey):
        key_size = parsed_key.curve.key_size
    else:
        # Unexpected public key type
        raise SSHKeyValidationError(f"Unrecognized asymmetric key structure: {type(parsed_key)}")

    # Rule 6: Standard OpenSSH SHA-256 fingerprint
    fingerprint = compute_openssh_fingerprint(raw_blob_b64)

    # Reconstruct standardized clean public key string
    normalized_public_key = f"{key_type} {raw_blob_b64}"
    if comment:
        normalized_public_key += f" {comment}"

    return {
        "key_type": key_type,
        "public_key": normalized_public_key,
        "fingerprint": fingerprint,
        "comment": comment,
        "key_size": key_size,
    }


def check_duplicate_ssh_key(db: Session, user_id: str, fingerprint: str) -> None:
    """
    Check if an SSH key with identical fingerprint already exists for this tenant.
    Raises DuplicateSSHKeyError if duplicate is found.
    """
    existing = (
        db.query(SSHKey)
        .filter(SSHKey.user_id == user_id, SSHKey.fingerprint == fingerprint)
        .first()
    )
    if existing:
        logger.info(
            f"Duplicate SSH key rejected for user_id={user_id}: "
            f"fingerprint={fingerprint} matches existing key id={existing.id} (name='{existing.name}')"
        )
        raise DuplicateSSHKeyError(
            f"An SSH public key with fingerprint '{fingerprint}' already exists in your account (labeled '{existing.name}')."
        )


def create_ssh_key(
    db: Session,
    user_id: str,
    name: str,
    raw_public_key: str,
) -> SSHKey:
    """
    Validate, parse, duplicate-check, and persist a new customer SSH public key.
    """
    if not user_id or not user_id.strip():
        raise SSHKeyValidationError("User ID is required for tenant isolation.")

    parsed = validate_and_parse_ssh_public_key(raw_public_key)
    fingerprint = parsed["fingerprint"]
    key_type = parsed["key_type"]
    public_key = parsed["public_key"]

    # Check for duplicate key within this user's account
    check_duplicate_ssh_key(db=db, user_id=user_id, fingerprint=fingerprint)

    clean_name = name.strip() if name and name.strip() else (parsed.get("comment") or f"SSH Key ({key_type})")

    new_key = SSHKey(
        id=uuid.uuid4(),
        user_id=user_id.strip(),
        name=clean_name,
        public_key=public_key,
        fingerprint=fingerprint,
        key_type=key_type,
        created_at=datetime.now(timezone.utc),
    )

    try:
        db.add(new_key)
        db.commit()
        db.refresh(new_key)
        logger.info(
            f"SSH key created: id={new_key.id} user_id={user_id} "
            f"name='{new_key.name}' fingerprint={new_key.fingerprint} (masked: {mask_public_key(public_key)})"
        )
        return new_key
    except IntegrityError as ie:
        db.rollback()
        logger.warning(f"Database integrity constraint violated during SSH key creation: {ie}")
        raise DuplicateSSHKeyError(
            f"An SSH key with fingerprint '{fingerprint}' is already registered."
        )
    except Exception as e:
        db.rollback()
        logger.error(f"Failed to persist SSH key in PostgreSQL: {e}")
        raise


def list_user_ssh_keys(db: Session, user_id: str) -> List[SSHKey]:
    """
    List all active SSH keys for the authenticated customer ordered by creation date.
    Strictly isolated by user_id.
    """
    return (
        db.query(SSHKey)
        .filter(SSHKey.user_id == user_id.strip())
        .order_by(SSHKey.created_at.desc())
        .all()
    )


def get_ssh_key_by_id(db: Session, user_id: str, key_id: uuid.UUID) -> Optional[SSHKey]:
    """
    Fetch a single SSH key by ID, verifying tenant ownership.
    """
    return (
        db.query(SSHKey)
        .filter(SSHKey.id == key_id, SSHKey.user_id == user_id.strip())
        .first()
    )


def delete_ssh_key(db: Session, user_id: str, key_id: uuid.UUID) -> bool:
    """
    Delete an SSH key belonging to the authenticated customer.
    Returns True if successfully deleted, False if not found or unauthorized.
    """
    key = get_ssh_key_by_id(db, user_id, key_id)
    if not key:
        return False

    try:
        db.delete(key)
        db.commit()
        logger.info(f"SSH key deleted: id={key_id} user_id={user_id} fingerprint={key.fingerprint}")
        return True
    except Exception as e:
        db.rollback()
        logger.error(f"Failed to delete SSH key {key_id}: {e}")
        raise


def get_user_authorized_keys(db: Session, user_id: str) -> List[str]:
    """
    Integration helper for Divya's Notebooks & SSH Access module.
    Returns the list of raw OpenSSH public key strings for the customer,
    ready to be written directly into container `~/.ssh/authorized_keys`.
    """
    keys = (
        db.query(SSHKey.public_key)
        .filter(SSHKey.user_id == user_id.strip())
        .order_by(SSHKey.created_at.asc())
        .all()
    )
    return [k[0] for k in keys if k[0]]

