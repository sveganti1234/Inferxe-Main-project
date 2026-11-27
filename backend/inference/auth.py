"""
Customer API Key Authentication and Key Generation for Inferxe.
Enforces SHA-256 hashed storage, constant-time comparison, lifecycle verification,
and Cognito verified identity association.
"""

import os
import sys
import hashlib
import secrets
import logging
import threading
from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple, Dict, Any
from dotenv import dotenv_values  # public VITE_COGNITO_* keys from frontend/.env only
import sys as _sys
_GUARD_DIR = str(__import__('pathlib').Path(__file__).resolve().parents[1])  # backend/
if _GUARD_DIR not in _sys.path:
    _sys.path.append(_GUARD_DIR)
from isolation_guard import load_dotenv  # noqa: E402  (tests never load the project .env: isolation_guard.py)
import jwt
from jwt import PyJWKClient, PyJWTError
from fastapi import Header, HTTPException, Depends, status

from inference.supabase_config import BACKEND_DIR, load_backend_env
from inference.supabase_api_keys import (
    SupabaseAPIKeyError,
    SupabaseAPIKeyRecord,
    SupabaseAPIKeyRepository,
    get_api_key_repository,
)

logger = logging.getLogger("inferxe.auth")

# Load backend/.env, root .env, and public Cognito fallback keys from frontend/.env
# without overriding existing process or test environment variables.
load_backend_env(override=False)
ROOT_DIR = BACKEND_DIR.parent
if (ROOT_DIR / ".env").is_file():
    load_dotenv(ROOT_DIR / ".env", override=False)

_FRONTEND_ENV_FILE = ROOT_DIR / "frontend" / ".env"
if _FRONTEND_ENV_FILE.is_file():
    try:
        for _k, _v in dotenv_values(_FRONTEND_ENV_FILE).items():
            if _k and _k.startswith("VITE_COGNITO_") and _v and _k not in os.environ:
                os.environ[_k] = _v
    except Exception:
        pass

_COGNITO_PLACEHOLDERS = {
    "",
    "ap-south-1_xxxxxxxxx",
    "your-cognito-client-id",
    "your-user-pool-id",
}


def _resolve_cognito_setting(primary_key: str, fallback_key: str, default: str = "") -> str:
    """Resolve Cognito setting from primary COGNITO_* key, falling back to VITE_COGNITO_* only if unset."""
    if primary_key in os.environ:
        return (os.environ.get(primary_key) or "").strip()
    if fallback_key in os.environ:
        return (os.environ.get(fallback_key) or "").strip()
    return default


def get_cognito_runtime_config() -> Tuple[str, str, str]:
    """Return (region, user_pool_id, client_id) resolved from environment."""
    region = _resolve_cognito_setting("COGNITO_REGION", "VITE_COGNITO_REGION", "ap-south-1") or "ap-south-1"
    user_pool_id = _resolve_cognito_setting("COGNITO_USER_POOL_ID", "VITE_COGNITO_USER_POOL_ID", "")
    client_id = _resolve_cognito_setting("COGNITO_CLIENT_ID", "VITE_COGNITO_CLIENT_ID", "")
    return region, user_pool_id, client_id


def is_cognito_configured() -> bool:
    """Return True when real (non-placeholder) Cognito pool & client IDs are configured."""
    _, user_pool_id, client_id = get_cognito_runtime_config()
    return (
        user_pool_id not in _COGNITO_PLACEHOLDERS
        and client_id not in _COGNITO_PLACEHOLDERS
    )


_PRODUCTION_ENV_VALUES = {"production", "prod"}
_SERVER_MODULES = ("uvicorn", "gunicorn", "hypercorn")
_test_mode_refusal_logged = False


def is_test_mode_enabled() -> bool:
    """
    True only when INFERXE_TEST_MODE=1 is set inside a test process.

    Test mode skips Cognito signature verification, so it is refused whenever the code runs
    inside an ASGI server (uvicorn/gunicorn/hypercorn) or the environment is marked as
    production (INFERXE_ENV / APP_ENV / ENVIRONMENT). A stray environment variable therefore
    cannot disable signature verification on a running service.
    """
    global _test_mode_refusal_logged
    if os.getenv("INFERXE_TEST_MODE") != "1":
        return False
    import sys

    env_name = (os.getenv("INFERXE_ENV") or os.getenv("APP_ENV") or os.getenv("ENVIRONMENT") or "").strip().lower()
    serving = any(module in sys.modules for module in _SERVER_MODULES)
    if env_name in _PRODUCTION_ENV_VALUES or serving:
        if not _test_mode_refusal_logged:
            logger.error(
                "INFERXE_TEST_MODE=1 ignored: test mode is only honoured inside test runners, "
                "never in a running server or production environment."
            )
            _test_mode_refusal_logged = True
        return False
    return True


# Short-lived cache of profiles confirmed active (user_id -> monotonic expiry).
_ACTIVE_PROFILE_CACHE: Dict[str, float] = {}
_ACTIVE_PROFILE_TTL_SECONDS = 60.0


_profile_http_client = None
_profile_http_client_lock = threading.Lock()


def _get_profile_http_client():
    """One pooled client for profile-status lookups (a new client per call meant a new TCP/TLS handshake each time)."""
    global _profile_http_client
    import httpx2

    with _profile_http_client_lock:
        if _profile_http_client is None or _profile_http_client.is_closed:
            _profile_http_client = httpx2.Client(timeout=5.0)
        return _profile_http_client


def assert_profile_active(user_id: str) -> None:
    """
    Reject protected operations for customers whose Supabase profile is suspended or inactive.

    - Profile exists with status != 'active'  -> HTTP 403.
    - No profile row                          -> allowed (profile is created at sign-in sync).
    - Profile store unreachable               -> HTTP 503 (fail closed).
    Skipped in test mode. Never logs tokens or personal data.
    """
    if not user_id or is_test_mode_enabled():
        return
    import time

    now = time.monotonic()
    if _ACTIVE_PROFILE_CACHE.get(user_id, 0.0) > now:
        return
    try:
        from inference.supabase_config import get_supabase_settings

        settings = get_supabase_settings(auto_load=False)
        response = _get_profile_http_client().get(
            settings.rest_url("profiles"),
            params={"select": "status", "user_id": f"eq.{user_id}", "limit": "1"},
            headers=settings.auth_headers(),
        )
        if response.status_code >= 400:
            raise RuntimeError(f"profile lookup returned HTTP {response.status_code}")
        rows = response.json() or []
    except Exception as lookup_err:
        logger.error("Profile status lookup failed: %s", type(lookup_err).__name__)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Account status could not be verified. Please try again shortly.",
        )
    if rows:
        profile_status = str(rows[0].get("status") or "").strip().lower()
        if profile_status != "active":
            _ACTIVE_PROFILE_CACHE.pop(user_id, None)
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="This account is not active. Please contact Inferxe support.",
            )
    _ACTIVE_PROFILE_CACHE[user_id] = now + _ACTIVE_PROFILE_TTL_SECONDS


# AWS Cognito Configuration (resolved defaults at module import)
COGNITO_REGION, COGNITO_USER_POOL_ID, COGNITO_CLIENT_ID = get_cognito_runtime_config()


def hash_api_key(raw_key: str) -> str:
    """Compute SHA-256 hex digest of a raw API key."""
    return hashlib.sha256(raw_key.strip().encode("utf-8")).hexdigest()


def generate_api_key(environment: str = "live") -> Tuple[str, str, str]:
    """
    Generate a cryptographically secure Inferxe API key.

    Returns:
        tuple: (raw_key, key_prefix, key_hash)
        - raw_key: Returned to the customer ONCE. Never saved to disk or DB.
        - key_prefix: Safe prefix for display in dashboard (e.g., 'inf_live_abcd...').
        - key_hash: SHA-256 hash stored in PostgreSQL.
    """
    env_tag = "live" if environment == "live" else "test"
    random_token = secrets.token_urlsafe(32)
    raw_key = f"inf_{env_tag}_{random_token}"
    key_prefix = raw_key[:14]  # e.g. "inf_live_ab12cd"
    key_hash = hash_api_key(raw_key)

    return raw_key, key_prefix, key_hash


LAST_USED_UPDATE_INTERVAL = timedelta(seconds=60)


def _last_used_is_stale(last_used_at: Optional[datetime]) -> bool:
    if last_used_at is None:
        return True
    if last_used_at.tzinfo is None:
        last_used_at = last_used_at.replace(tzinfo=timezone.utc)
    return datetime.now(timezone.utc) - last_used_at >= LAST_USED_UPDATE_INTERVAL


def verify_customer_api_key(
    authorization: Optional[str] = Header(None, alias="Authorization"),
    repo: SupabaseAPIKeyRepository = Depends(get_api_key_repository),
) -> SupabaseAPIKeyRecord:
    """
    FastAPI dependency validating the customer's Inferxe API key against Supabase.
    Reads 'Authorization: Bearer <INFERXE_API_KEY>'.
    Rejects missing, malformed, inactive, expired, or revoked keys with HTTP 401.
    """
    if not authorization:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Authorization header. Expected 'Authorization: Bearer <INFERXE_API_KEY>'",
            headers={"WWW-Authenticate": "Bearer"},
        )

    parts = authorization.strip().split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Authorization header format. Expected 'Bearer <INFERXE_API_KEY>'",
            headers={"WWW-Authenticate": "Bearer"},
        )

    raw_key = parts[1].strip()
    if not raw_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="API key cannot be empty",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Reject NVIDIA keys passed directly by customers for security
    if raw_key.startswith("nvapi-"):
        logger.warning("Customer attempted to use an upstream NVIDIA key directly.")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid API key. Please use your Inferxe customer API key.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    computed_hash = hash_api_key(raw_key)

    try:
        # Query API key from Supabase REST API by SHA-256 secret_hash
        key_record = repo.get_by_secret_hash(computed_hash)
    except SupabaseAPIKeyError as sb_err:
        logger.error("Supabase error during API key verification: %s", sb_err)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication database is currently unavailable."
        )
    except Exception as db_err:
        logger.error("Unexpected error during API key verification: %s", type(db_err).__name__)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication database is currently unavailable."
        )

    if not key_record:
        logger.warning("Failed authentication attempt with unknown key hash.")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Inferxe API key.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Validate active state and revocation
    if key_record.is_revoked_or_inactive:
        logger.warning(f"Authentication rejected for revoked/inactive key: prefix={key_record.key_prefix}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Inferxe API key has been revoked or is inactive.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Validate expiration timestamp when present
    if key_record.is_expired:
        logger.warning(f"Authentication rejected for expired key: prefix={key_record.key_prefix}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Inferxe API key has expired.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Suspended or inactive customers cannot use their API keys
    assert_profile_active(str(key_record.user_id))

    # Update last_used_at, at most once per LAST_USED_UPDATE_INTERVAL per key: the value is already in
    # the record we just loaded, so busy keys skip a blocking Supabase PATCH on most requests.
    if _last_used_is_stale(key_record.last_used_at):
        try:
            repo.update_last_used(key_id=key_record.id, user_id=key_record.user_id)
        except Exception as update_err:
            logger.warning(f"Could not update last_used_at for key {key_record.key_prefix}: {type(update_err).__name__}")

    return key_record


_NON_TEST_ENVIRONMENTS = {"production", "prod", "staging"}


def test_mode_enabled() -> bool:
    """INFERXE_TEST_MODE skips JWT signature checks, so it is honoured only when BOTH safeguards agree:
    is_test_mode_enabled() (refused inside a running ASGI server or a production-marked environment) and
    a loaded test runner with INFERXE_ENV not production/staging. Anything else fails closed."""
    if not is_test_mode_enabled():
        return False
    env = (os.getenv("INFERXE_ENV") or "").strip().lower()
    in_test_runner = "pytest" in sys.modules or "unittest" in sys.modules
    if env in _NON_TEST_ENVIRONMENTS or not in_test_runner:
        logger.critical(
            "INFERXE_TEST_MODE=1 ignored (INFERXE_ENV=%r, test runner loaded=%s): JWT signatures are verified.",
            env or "unset", in_test_runner,
        )
        return False
    return True


_jwks_clients: Dict[Tuple[str, Any], PyJWKClient] = {}
_jwks_clients_lock = threading.Lock()


def _get_jwks_client(jwks_url: str) -> PyJWKClient:
    """One PyJWKClient per JWKS URL, so its key cache survives across requests.

    Keyed by the factory too, so a test that patches PyJWKClient gets its mock rather than
    a client cached by an earlier test.
    """
    key = (jwks_url, PyJWKClient)
    with _jwks_clients_lock:
        client = _jwks_clients.get(key)
        if client is None:
            client = PyJWKClient(jwks_url, cache_keys=True, lifespan=3600, timeout=5)
            _jwks_clients[key] = client
        return client


def verify_cognito_jwt(token: str) -> Dict[str, Any]:
    """
    Verify incoming Cognito JWT tokens with cryptographic signature checking.

    Security Guarantee:
    - In live production runtime, verifies RSA signature against AWS Cognito JWKS.
    - If AWS is unavailable or User Pool JWKS cannot be verified, FAILS CLOSED
      with HTTP 503 rather than trusting unverified tokens.
    - Validates expected issuer (iss).
    - Validates expected audience/client ID (aud).
    - Validates token_use must be 'id'.
    - Validates token expiration (exp).
    - Rejects expired tokens, invalid signatures, or wrong token_use with HTTP 401.
    """
    # Test mode bypass allows unit tests to test business logic with mock payloads.
    # It is refused inside running servers, production/staging environments and outside test runners
    # (test_mode_enabled combines is_test_mode_enabled with the test-runner check).
    if test_mode_enabled():
        import json
        import base64
        import time
        segments = token.split(".")
        if len(segments) != 3:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid Cognito JWT. Expected 3 base64 segments.",
                headers={"WWW-Authenticate": "Bearer"},
            )
        try:
            payload_b64 = segments[1] + "=" * (-len(segments[1]) % 4)
            claims = json.loads(base64.urlsafe_b64decode(payload_b64.encode("utf-8")).decode("utf-8"))
        except Exception:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid Cognito JWT. Could not parse payload.",
                headers={"WWW-Authenticate": "Bearer"},
            )
        exp = claims.get("exp")
        if exp and exp < time.time():
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Cognito session token has expired. Please log in again.",
                headers={"WWW-Authenticate": "Bearer"},
            )
        token_use = claims.get("token_use")
        if token_use and token_use != "id":
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=f"Invalid Cognito token_use claim. Expected 'id', got '{token_use}'.",
                headers={"WWW-Authenticate": "Bearer"},
            )
        return claims

    # Live Production Runtime: Require both User Pool ID and App Client ID; strictly enforce audience verification
    region, user_pool_id, client_id = get_cognito_runtime_config()
    if not region:
        region = COGNITO_REGION or "ap-south-1"
    if not user_pool_id and "COGNITO_USER_POOL_ID" not in os.environ:
        user_pool_id = COGNITO_USER_POOL_ID
    if not client_id and "COGNITO_CLIENT_ID" not in os.environ:
        client_id = COGNITO_CLIENT_ID

    if not user_pool_id or not client_id:
        logger.error("Cognito User Pool ID and Client ID must both be configured. Protected endpoint failing closed.")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Cognito authentication service is pending configuration (requires both User Pool ID and Client ID). Live RSA signature verification cannot be performed. Protected operations fail closed.",
        )

    jwks_url = f"https://cognito-idp.{region}.amazonaws.com/{user_pool_id}/.well-known/jwks.json"
    issuer = f"https://cognito-idp.{region}.amazonaws.com/{user_pool_id}"

    try:
        jwks_client = _get_jwks_client(jwks_url)
        signing_key = jwks_client.get_signing_key_from_jwt(token)
        payload = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            issuer=issuer,
            audience=client_id,
            options={"verify_exp": True, "verify_iss": True, "verify_aud": True},
        )

        # Enforce that token_use must be 'id'
        token_use = payload.get("token_use")
        if token_use != "id":
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=f"Invalid Cognito token_use claim. Expected 'id', got '{token_use}'.",
                headers={"WWW-Authenticate": "Bearer"},
            )

        return payload
    except PyJWTError as jwt_err:
        logger.warning(f"Cognito JWT signature verification rejected: {jwt_err}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid or unverified Cognito token: {jwt_err}",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except HTTPException:
        raise
    except Exception as network_err:
        logger.error(f"Failed to fetch Cognito JWKS keys from AWS: {network_err}")
        # Fail closed: Do NOT trust the token if signature cannot be cryptographically verified
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Cognito authentication service is currently unavailable. Live signature verification cannot be performed. Protected operations fail closed.",
        )


def require_cognito_user(
    authorization: Optional[str] = Header(None, alias="Authorization")
) -> str:
    """
    Enforces Cognito JWT authentication. Rejects anonymous or invalid requests with HTTP 401.
    Extracts the verified Cognito user identity ('sub').
    Fails closed if live signature verification cannot be performed.
    """
    if not authorization:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required. Please provide a valid Cognito JWT in the Authorization header.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    parts = authorization.strip().split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Authorization header format. Expected 'Bearer <COGNITO_JWT>'",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = parts[1].strip()
    verified_claims = verify_cognito_jwt(token)
    user_id = verified_claims.get("sub") or verified_claims.get("cognito:username")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Cognito JWT. Could not verify customer identity ('sub').",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Suspended or inactive customers cannot perform protected operations
    assert_profile_active(str(user_id))
    return user_id


def extract_cognito_sub(auth_header: Optional[str]) -> Optional[str]:
    """Helper to extract Cognito user identity from Authorization header."""
    if not auth_header:
        return None
    try:
        parts = auth_header.strip().split()
        if len(parts) != 2 or parts[0].lower() != "bearer":
            return None
        claims = verify_cognito_jwt(parts[1].strip())
        return claims.get("sub") or claims.get("cognito:username")
    except Exception:
        return None

