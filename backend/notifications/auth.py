"""
Authentication and Authorization Module for Inferxe Backend.
Validates AWS Cognito JWT tokens using Cognito JWKS, enforcing multi-tenant isolation
and strict role-based authorization (admin vs customer).
"""

import os
import json
import time
import logging
from pathlib import Path
from typing import Optional, Dict, Any, List
from fastapi import HTTPException, Security, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import jwt
from jwt import PyJWKClient, ExpiredSignatureError, InvalidTokenError
from dotenv import load_dotenv, dotenv_values

ROOT_DIR = Path(__file__).resolve().parents[2]
if (ROOT_DIR / ".env").is_file():
    load_dotenv(ROOT_DIR / ".env", override=False)
if (ROOT_DIR / "backend" / ".env").is_file():
    load_dotenv(ROOT_DIR / "backend" / ".env", override=False)
if (ROOT_DIR / "frontend" / ".env").is_file():
    try:
        for _k, _v in dotenv_values(ROOT_DIR / "frontend" / ".env").items():
            if _k and _k.startswith("VITE_COGNITO_") and _v and _k not in os.environ:
                os.environ[_k] = _v
    except Exception:
        pass

logger = logging.getLogger("inferxe.notifications.auth")

_COGNITO_PLACEHOLDERS = {"", "ap-south-1_xxxxxxxxx", "your-cognito-client-id", "your-user-pool-id"}

COGNITO_REGION = (
    os.environ.get("AWS_REGION")
    or os.environ.get("VITE_COGNITO_REGION")
    or os.environ.get("COGNITO_REGION")
    or "ap-south-1"
).strip() or "ap-south-1"
COGNITO_USER_POOL_ID = (
    os.environ.get("AWS_COGNITO_USER_POOL_ID")
    or os.environ.get("COGNITO_USER_POOL_ID")
    or os.environ.get("VITE_COGNITO_USER_POOL_ID")
    or ""
).strip()
COGNITO_CLIENT_ID = (
    os.environ.get("AWS_COGNITO_CLIENT_ID")
    or os.environ.get("COGNITO_CLIENT_ID")
    or os.environ.get("VITE_COGNITO_CLIENT_ID")
    or ""
).strip()
_EFFECTIVE_ISSUER_POOL = COGNITO_USER_POOL_ID or "unconfigured-pool"
COGNITO_ISSUER = f"https://cognito-idp.{COGNITO_REGION}.amazonaws.com/{_EFFECTIVE_ISSUER_POOL}"
JWKS_URL = f"{COGNITO_ISSUER}/.well-known/jwks.json"
# Shared with the Node admin auth server. No default: without a configured secret (>= 32 chars)
# administrator HS256 session tokens are rejected.
ADMIN_SESSION_SECRET = (os.environ.get("ADMIN_SESSION_SECRET") or "").strip()
_MIN_ADMIN_SECRET_LENGTH = 32

# In-memory JWK client cache
_jwks_client: Optional[PyJWKClient] = None

# Test mode public keys fixture for isolated multi-user automated testing
_test_public_keys: Dict[str, Any] = {}

def reset_jwks_client() -> None:
    """Invalidate the cached JWKS client so the next request fetches fresh keys.

    Used when Cognito rotates signing keys and the cached JWKS no longer
    contains the token's kid.
    """
    global _jwks_client
    _jwks_client = None


def _sanitize_error(message: Optional[str]) -> str:
    """Sanitize error messages to avoid leaking secrets in logs."""
    if not message:
        return ""
    import re
    # Mask URLs that may contain credentials
    message = re.sub(r"https?://[^\s'\"\)]+", "<url-redacted>", message)
    # Mask key-like values
    message = re.sub(r"[A-Za-z0-9+/]{40,}={0,2}", "<key-redacted>", message)
    return message


def get_jwks_client(force_refresh: bool = False) -> PyJWKClient:
    global _jwks_client
    if force_refresh or _jwks_client is None:
        _jwks_client = PyJWKClient(JWKS_URL, cache_keys=True, max_cached_keys=10)
    return _jwks_client

def register_test_key(kid: str, public_key_pem: str):
    """Registers an RSA public key for test suite verification without remote network dependency."""
    _test_public_keys[kid] = public_key_pem

security_bearer = HTTPBearer(auto_error=False)

class AuthenticatedUser:
    """Represents a securely validated Cognito user identity."""
    def __init__(self, user_id: str, email: str, roles: List[str], claims: Dict[str, Any]):
        self.user_id = user_id
        self.email = email
        self.roles = roles
        self.claims = claims
        self.is_admin = "admin" in [r.lower() for r in roles]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "user_id": self.user_id,
            "email": self.email,
            "roles": self.roles,
            "is_admin": self.is_admin,
        }

def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


def _verify_admin_session_token(token: str) -> AuthenticatedUser:
    """
    Verify an administrator session token issued by the Node admin auth server
    (HS256, shared ADMIN_SESSION_SECRET). Requires role='admin', exp and sub.
    """
    if len(ADMIN_SESSION_SECRET) < _MIN_ADMIN_SECRET_LENGTH:
        logger.error("Administrator session tokens rejected: ADMIN_SESSION_SECRET is not configured.")
        raise _unauthorized("Administrator sessions are not accepted by this service.")
    try:
        payload = jwt.decode(
            token,
            ADMIN_SESSION_SECRET,
            algorithms=["HS256"],
            options={"require": ["exp", "sub", "role"], "verify_aud": False},
        )
    except ExpiredSignatureError:
        raise _unauthorized("Administrator session has expired.")
    except InvalidTokenError as hs_err:
        logger.warning("Invalid administrator session token: %s", type(hs_err).__name__)
        raise _unauthorized("Invalid administrator session token.")
    if payload.get("role") != "admin":
        raise _unauthorized("Invalid administrator session token.")
    return AuthenticatedUser(
        user_id=str(payload["sub"]),
        email=str(payload.get("email") or ""),
        roles=["admin"],
        claims=payload,
    )


def verify_cognito_jwt(token: str) -> AuthenticatedUser:
    """
    Verify a bearer token and return the authenticated identity.

    Cognito ID tokens (RS256):
    - Signature verified against the user pool's JWKS (or a key registered by the test suite).
    - Required claims: exp, iss, aud, sub, token_use.
    - Issuer must be the configured user pool; audience must be the configured app client ID.
    - token_use must be 'id' (access tokens are rejected).
    - Administrator rights only from the 'admin' Cognito group (managed by AWS administrators);
      user-editable attributes such as custom:role are never trusted for authorization.

    Administrator session tokens (HS256) from the Node admin auth server are also accepted
    when correctly signed with ADMIN_SESSION_SECRET and carrying role='admin'.
    """
    if not token or not token.strip():
        raise _unauthorized("Missing authentication token.")
    token = token.strip()

    try:
        # Unverified header is used only to route between the two token types and find 'kid'.
        unverified_header = jwt.get_unverified_header(token)
    except Exception as e:
        logger.warning("Malformed token header: %s", type(e).__name__)
        raise _unauthorized("Invalid token structure.")
    kid = unverified_header.get("kid")
    alg = unverified_header.get("alg")

    if alg == "HS256":
        return _verify_admin_session_token(token)
    if alg != "RS256":
        raise _unauthorized("Unsupported token algorithm.")

    # Resolve signing key
    signing_key = None
    last_key_error: Optional[Exception] = None
    if kid and kid in _test_public_keys:
        signing_key = _test_public_keys[kid]
    else:
        if (
            COGNITO_USER_POOL_ID in _COGNITO_PLACEHOLDERS
            or COGNITO_CLIENT_ID in _COGNITO_PLACEHOLDERS
        ):
            logger.error("Cognito User Pool ID / Client ID not configured for notifications service.")
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Cognito authentication service is not configured on this backend.",
            )
        # First attempt: use cached JWKS client
        try:
            client = get_jwks_client()
            signing_key = client.get_signing_key_from_jwt(token).key
        except Exception as e:
            last_key_error = e
            # Cognito may have rotated signing keys; invalidate cache and retry once
            reset_jwks_client()
            try:
                client = get_jwks_client(force_refresh=True)
                signing_key = client.get_signing_key_from_jwt(token).key
                last_key_error = None
            except Exception as e2:
                last_key_error = e2

    if signing_key is None:
        logger.error(
            "Failed to resolve Cognito signing key (kid=%s): %s",
            kid or "<missing>",
            _sanitize_error(str(last_key_error)) if last_key_error else "unknown error",
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unable to verify token signature against Cognito JWKS.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if COGNITO_CLIENT_ID in _COGNITO_PLACEHOLDERS:
        logger.error("Cognito app client ID not configured for notifications service.")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Cognito authentication service is not configured on this backend.",
        )

    # Decode and verify signature & claims
    try:
        payload = jwt.decode(
            token,
            signing_key,
            algorithms=["RS256"],
            issuer=COGNITO_ISSUER,
            audience=COGNITO_CLIENT_ID,
            options={
                "verify_signature": True,
                "verify_exp": True,
                "verify_iss": True,
                "verify_aud": True,
                "require": ["exp", "iss", "aud", "sub", "token_use"],
            },
        )
    except ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication token has expired.",
            headers={"WWW-Authenticate": "Bearer error=\"invalid_token\", error_description=\"The token expired\""},
        )
    except InvalidTokenError as e:
        # Log only the error class; never echo token contents or verifier details to clients.
        logger.warning("Rejected Cognito token: %s", type(e).__name__)
        raise _unauthorized("Invalid authentication token.")

    if payload.get("token_use") != "id":
        raise _unauthorized("A Cognito ID token is required.")

    user_id = payload.get("sub")
    if not user_id:
        raise _unauthorized("Token is missing required user identifier ('sub').")

    email = payload.get("email") or payload.get("cognito:username") or ""
    groups = payload.get("cognito:groups") or []
    if isinstance(groups, str):
        groups = [groups]
    roles = [str(g) for g in groups if isinstance(g, str)]

    return AuthenticatedUser(
        user_id=str(user_id),
        email=str(email),
        roles=roles,
        claims=payload,
    )


# Short-lived cache of profiles confirmed active (user_id -> monotonic expiry).
_ACTIVE_PROFILE_CACHE: Dict[str, float] = {}
_ACTIVE_PROFILE_TTL_SECONDS = 60.0


def assert_profile_active(user: AuthenticatedUser) -> None:
    """
    Reject protected operations for customers whose profile is suspended or inactive.

    - Administrator session tokens (no customer profile) are not checked here.
    - Profile row exists with status != 'active' -> HTTP 403.
    - No profile row                             -> allowed (profiles are created at sign-in sync).
    - Database unavailable                       -> HTTP 503 (fail closed).
    """
    if user.claims.get("token_use") != "id":
        return
    now = time.monotonic()
    if _ACTIVE_PROFILE_CACHE.get(user.user_id, 0.0) > now:
        return
    try:
        from .db import DBConnection  # local import keeps auth importable without a database

        with DBConnection(autocommit=True) as conn:
            cur = conn.cursor()
            cur.execute("SELECT status FROM profiles WHERE user_id = %s LIMIT 1;", (user.user_id,))
            row = cur.fetchone()
    except Exception as db_err:
        logger.error("Profile status lookup failed: %s", type(db_err).__name__)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Account status could not be verified. Please try again shortly.",
        )
    if row is not None:
        profile_status = row["status"] if isinstance(row, dict) else row[0]
        if str(profile_status or "").strip().lower() != "active":
            _ACTIVE_PROFILE_CACHE.pop(user.user_id, None)
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="This account is not active. Please contact Inferxe support.",
            )
    _ACTIVE_PROFILE_CACHE[user.user_id] = now + _ACTIVE_PROFILE_TTL_SECONDS

async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Security(security_bearer),
) -> AuthenticatedUser:
    """FastAPI dependency for verifying authenticated customer or admin."""
    if not credentials or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Authorization header with Bearer token.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    user = verify_cognito_jwt(credentials.credentials)
    assert_profile_active(user)
    return user

async def require_admin_user(
    user: AuthenticatedUser = Security(get_current_user),
) -> AuthenticatedUser:
    """FastAPI dependency enforcing strict Admin role authorization."""
    if not user.is_admin:
        logger.warning(f"User {user.user_id} ({user.email}) attempted admin operation without admin privileges.")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access forbidden: Admin privileges required.",
        )
    return user

async def get_optional_user(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Security(security_bearer),
) -> Optional[AuthenticatedUser]:
    """FastAPI dependency for resolving an authenticated Cognito user if a Bearer token is provided."""
    token = None
    if credentials and credentials.credentials:
        token = credentials.credentials
    elif request.headers.get("authorization"):
        raw = request.headers.get("authorization", "").strip()
        parts = raw.split()
        if len(parts) == 2 and parts[0].lower() == "bearer":
            token = parts[1]
        elif len(parts) == 1:
            token = parts[0]

    if not token:
        return None

    try:
        user = verify_cognito_jwt(token)
    except HTTPException:
        raise
    except Exception as e:
        logger.warning("Optional token resolution warning: %s", type(e).__name__)
        return None
    assert_profile_active(user)
    return user

