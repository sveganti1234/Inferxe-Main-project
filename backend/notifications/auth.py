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
    os.environ.get("COGNITO_REGION")
    or os.environ.get("VITE_COGNITO_REGION")
    or "ap-south-1"
).strip() or "ap-south-1"
COGNITO_USER_POOL_ID = (
    os.environ.get("COGNITO_USER_POOL_ID")
    or os.environ.get("VITE_COGNITO_USER_POOL_ID")
    or ""
).strip()
COGNITO_CLIENT_ID = (
    os.environ.get("COGNITO_CLIENT_ID")
    or os.environ.get("VITE_COGNITO_CLIENT_ID")
    or ""
).strip()
_EFFECTIVE_ISSUER_POOL = COGNITO_USER_POOL_ID or "unconfigured-pool"
COGNITO_ISSUER = f"https://cognito-idp.{COGNITO_REGION}.amazonaws.com/{_EFFECTIVE_ISSUER_POOL}"
JWKS_URL = f"{COGNITO_ISSUER}/.well-known/jwks.json"

# In-memory JWK client cache
_jwks_client: Optional[PyJWKClient] = None

# Test mode public keys fixture for isolated multi-user automated testing
_test_public_keys: Dict[str, Any] = {}

def get_jwks_client() -> PyJWKClient:
    global _jwks_client
    if _jwks_client is None:
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

def verify_cognito_jwt(token: str) -> AuthenticatedUser:
    """
    Cryptographically verifies the Cognito JWT signature and claims:
    - Signature validated against Cognito JWKS (or verified test key fixture).
    - Expiration (exp) check.
    - Issuer (iss) check.
    - Token use ('id' or 'access') and client_id/aud check.
    """
    if not token or not token.strip():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing authentication token.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        # Extract unverified header to get the key ID ('kid') and algorithm
        unverified_header = jwt.get_unverified_header(token)
        kid = unverified_header.get("kid")
        alg = unverified_header.get("alg", "RS256")
    except Exception as e:
        logger.warning(f"Malformed token header: {e}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token structure.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Resolve signing key
    signing_key = None
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
        try:
            client = get_jwks_client()
            signing_key = client.get_signing_key_from_jwt(token).key
        except Exception as e:
            logger.error(f"Failed to fetch Cognito signing key for kid '{kid}': {e}")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Unable to verify token signature against Cognito JWKS.",
                headers={"WWW-Authenticate": "Bearer"},
            )

    # Decode and verify signature & claims
    try:
        # Validate issuer, expiration, and algorithm
        decode_kwargs: Dict[str, Any] = {
            "algorithms": [alg],
            "issuer": COGNITO_ISSUER,
            "options": {
                "verify_signature": True,
                "verify_exp": True,
                "verify_iss": True,
                # Aud check: Cognito ID token has 'aud', access token has 'client_id'
                "verify_aud": False,
            },
        }

        payload = jwt.decode(token, signing_key, **decode_kwargs)

        # Validate token_use
        token_use = payload.get("token_use")
        if token_use not in ("id", "access"):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=f"Invalid token_use: {token_use}",
            )

        # Validate audience if client ID is configured and present in token
        if COGNITO_CLIENT_ID:
            aud = payload.get("aud") or payload.get("client_id")
            if aud and aud != COGNITO_CLIENT_ID:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Token audience does not match configured Client ID.",
                )

        # Extract user identity (sub)
        user_id = payload.get("sub") or payload.get("username")
        if not user_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token is missing required user identifier ('sub').",
            )

        email = payload.get("email") or payload.get("cognito:username") or f"{user_id}@inferxe.internal"
        groups = payload.get("cognito:groups", [])
        if isinstance(groups, str):
            groups = [groups]
        role = payload.get("custom:role") or payload.get("role")
        if role and role not in groups:
            groups.append(role)

        return AuthenticatedUser(
            user_id=str(user_id),
            email=str(email),
            roles=groups,
            claims=payload,
        )

    except ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication token has expired.",
            headers={"WWW-Authenticate": "Bearer error=\"invalid_token\", error_description=\"The access token expired\""},
        )
    except InvalidTokenError as e:
        logger.warning(f"Invalid token: {e}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid token: {str(e)}",
            headers={"WWW-Authenticate": "Bearer"},
        )

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
    return verify_cognito_jwt(credentials.credentials)

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

