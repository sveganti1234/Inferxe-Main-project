"""
Authentication and Authorization Module for Inferxe Backend.
Validates AWS Cognito JWT tokens using Cognito JWKS, enforcing multi-tenant isolation
and strict role-based authorization (admin vs customer).
"""

import os
import sys
import json
import time
import logging
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Dict, Any, List, Tuple
from fastapi import HTTPException, Security, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import jwt
from jwt import PyJWKClient, ExpiredSignatureError, InvalidTokenError
from dotenv import dotenv_values  # public VITE_COGNITO_* keys from frontend/.env only
import sys as _sys
_GUARD_DIR = str(__import__('pathlib').Path(__file__).resolve().parents[1])  # backend/
if _GUARD_DIR not in _sys.path:
    _sys.path.append(_GUARD_DIR)
from isolation_guard import load_dotenv, project_env_values  # noqa: E402  (tests never load the project .env: isolation_guard.py)

ROOT_DIR = Path(__file__).resolve().parents[2]
BACKEND_DIR = ROOT_DIR / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

if (ROOT_DIR / ".env").is_file():
    load_dotenv(ROOT_DIR / ".env", override=False)
if (BACKEND_DIR / ".env").is_file():
    try:
        for _k, _v in (project_env_values(BACKEND_DIR / ".env") or {}).items():
            # "not in os.environ" (as for frontend/.env below and load_dotenv(override=False)): a variable
            # that is already set, even to "", is never replaced. Treating "" as unset re-imported the
            # production credentials that the test guard (backend/conftest.py) had cleared.
            if _k and _v and _k not in os.environ:
                os.environ[_k] = _v
    except Exception:
        load_dotenv(BACKEND_DIR / ".env", override=False)
if (ROOT_DIR / "frontend" / ".env").is_file():
    try:
        for _k, _v in dotenv_values(ROOT_DIR / "frontend" / ".env").items():
            if _k and _k.startswith("VITE_COGNITO_") and _v and _k not in os.environ:
                os.environ[_k] = _v
    except Exception:
        pass

try:
    from backend.inference.supabase_config import SupabaseConfigurationError, get_supabase_settings
except ImportError:
    from inference.supabase_config import SupabaseConfigurationError, get_supabase_settings

_PRIMARY_SUPERADMIN_ID = "d9a494cb-1e8d-4bca-8142-19687fa9138b"
_PRIMARY_SUPERADMIN_EMAIL = "admin@inferxe.com"
_ADMIN_ALLOWED_ROLES = {"admin", "superadmin"}
_SUPABASE_ADMIN_VERIFY_TIMEOUT_SECONDS = 5.0

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


def get_jwks_client() -> PyJWKClient:
    global _jwks_client
    if _jwks_client is None:
        _jwks_client = PyJWKClient(JWKS_URL, cache_keys=True, max_cached_keys=10, timeout=5)
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
        self.is_admin = any(r.lower() in ("admin", "superadmin") for r in roles)

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


def _supabase_rest_get(
    url: str,
    headers: Dict[str, str],
    params: Dict[str, str],
) -> Tuple[int, str]:
    """Perform a GET request against Supabase PostgREST using Python stdlib urllib."""
    query = urllib.parse.urlencode(params)
    full_url = f"{url}?{query}" if query else url
    req = urllib.request.Request(full_url, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=_SUPABASE_ADMIN_VERIFY_TIMEOUT_SECONDS) as resp:
            status_code = int(getattr(resp, "status", 200))
            raw_text = resp.read().decode("utf-8", errors="replace")
            return status_code, raw_text
    except urllib.error.HTTPError as http_err:
        err_text = ""
        try:
            err_text = http_err.read().decode("utf-8", errors="replace")
        except Exception:
            err_text = ""
        return int(http_err.code), err_text


def _is_missing_role_column_response(status_code: int, raw_text: str) -> bool:
    if status_code != 400:
        return False
    try:
        body = json.loads(raw_text) if raw_text else {}
    except Exception:
        body = {}
    if not isinstance(body, dict):
        body = {}
    code = str(body.get("code", "")).strip().upper()
    text = f"{body.get('message', '')} {body.get('details', '')} {raw_text}"
    if code in ("42703", "PGRST204") and "role" in text.lower():
        return True
    lower = text.lower()
    return ("role" in lower and "does not exist" in lower) or (
        "could not find" in lower and "role" in lower and "column" in lower
    )


def _parse_iso_utc(raw_value: Any) -> Optional[datetime]:
    if not isinstance(raw_value, str) or not raw_value.strip():
        return None
    normalized = raw_value.strip()
    if normalized.endswith("Z"):
        normalized = normalized[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(normalized)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except ValueError:
        return None


def _resolve_db_admin_role(admin_row: Dict[str, Any], has_role_column: bool) -> Optional[str]:
    if has_role_column:
        role = str(admin_row.get("role") or "").strip().lower()
        return role if role in _ADMIN_ALLOWED_ROLES else None
    row_id = str(admin_row.get("id") or "").strip().lower()
    row_email = str(admin_row.get("email") or "").strip().lower()
    if row_id == _PRIMARY_SUPERADMIN_ID and row_email == _PRIMARY_SUPERADMIN_EMAIL:
        return "superadmin"
    return "admin"


def _verify_admin_session_in_supabase(
    session_id: str,
    admin_user_id: str,
    token_session_version: int,
) -> Dict[str, Any]:
    """
    Verify an HS256 admin JWT against Supabase `admin_sessions` and `admin_users`.
    Fails closed (HTTP 503) if Supabase configuration is missing/invalid or DB lookup fails.
    """
    try:
        settings = get_supabase_settings()
    except SupabaseConfigurationError as cfg_err:
        logger.error("Supabase admin session verification misconfigured: %s", _sanitize_error(str(cfg_err)))
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Administrator session verification service is not configured on this backend.",
        )

    headers = settings.auth_headers()
    try:
        session_status, session_text = _supabase_rest_get(
            settings.rest_url("admin_sessions"),
            headers=headers,
            params={
                "select": "id,admin_user_id,session_version,expires_at,revoked_at",
                "id": f"eq.{session_id}",
                "limit": "1",
            },
        )
        if session_status != 200:
            logger.error(
                "Supabase admin_sessions lookup failed with HTTP %s",
                session_status,
            )
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Administrator session verification service is temporarily unavailable.",
            )

        has_role_column = True
        admin_status, admin_text = _supabase_rest_get(
            settings.rest_url("admin_users"),
            headers=headers,
            params={
                "select": "id,email,role,is_active,session_version",
                "id": f"eq.{admin_user_id}",
                "limit": "1",
            },
        )
        if _is_missing_role_column_response(admin_status, admin_text):
            has_role_column = False
            admin_status, admin_text = _supabase_rest_get(
                settings.rest_url("admin_users"),
                headers=headers,
                params={
                    "select": "id,email,is_active,session_version",
                    "id": f"eq.{admin_user_id}",
                    "limit": "1",
                },
            )

        if admin_status != 200:
            logger.error(
                "Supabase admin_users lookup failed with HTTP %s",
                admin_status,
            )
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Administrator session verification service is temporarily unavailable.",
            )

        session_rows = json.loads(session_text)
        admin_rows = json.loads(admin_text)
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(
            "Supabase admin session verification error (%s): %s",
            type(exc).__name__,
            _sanitize_error(str(exc)),
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Administrator session verification service is temporarily unavailable.",
        )

    if not isinstance(session_rows, list) or not isinstance(admin_rows, list):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Administrator session verification service returned an unexpected response.",
        )

    if not session_rows:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Administrator session not found.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    session = session_rows[0]
    if str(session.get("admin_user_id") or "") != str(admin_user_id):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Administrator session ownership mismatch.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if session.get("revoked_at") is not None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Administrator session has been revoked.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    expires_at = _parse_iso_utc(session.get("expires_at"))
    if expires_at is None or expires_at <= datetime.now(timezone.utc):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Administrator session has expired.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not admin_rows:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Administrator account no longer exists.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    admin = admin_rows[0]
    if admin.get("is_active") is not True:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Your administrator account has been deactivated.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    db_role = _resolve_db_admin_role(admin, has_role_column=has_role_column)
    if db_role not in _ADMIN_ALLOWED_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid administrator role configuration.",
        )

    try:
        db_admin_sv = int(admin.get("session_version"))
        db_session_sv = int(session.get("session_version"))
    except (TypeError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid administrator session version.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if db_session_sv != db_admin_sv or int(token_session_version) != db_admin_sv:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Administrator session has been invalidated. Please sign in again.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return {
        "id": str(admin.get("id")),
        "email": str(admin.get("email") or "").strip().lower(),
        "role": db_role,
        "session_version": db_admin_sv,
    }


def verify_cognito_jwt(token: str) -> AuthenticatedUser:
    """
    Verify a bearer token and return the authenticated identity.

    Administrator session tokens (HS256) from the Node admin auth server: signature checked with
    ADMIN_SESSION_SECRET, then the session is verified against Supabase admin_sessions/admin_users
    (revocation, expiry, active account, session version). Roles come from the database.

    Cognito ID tokens (RS256):
    - Signature verified against the user pool's JWKS (or a key registered by the test suite).
    - Required claims: exp, iss, aud, sub, token_use; issuer and audience must match this pool/client.
    - token_use must be 'id' (access tokens are rejected).
    - Never grants administrator rights: neither Cognito groups nor user-editable attributes (such as the
      custom role attribute) are trusted for authorization; admins use the HS256 admin-session path.
    """
    if not token or not token.strip():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing authentication token.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if token.startswith("ix-") or token == "admin-dev-token":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        # Unverified header is used only to route between the two token types and find 'kid'.
        unverified_header = jwt.get_unverified_header(token)
    except Exception as e:
        logger.warning("Malformed token header: %s", type(e).__name__)
        raise _unauthorized("Invalid token structure.")
    kid = unverified_header.get("kid")
    alg = unverified_header.get("alg")

    if alg == "HS256":
        if unverified_header.get("typ") != "JWT":
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Unsupported admin token type.",
                headers={"WWW-Authenticate": "Bearer"},
            )

        effective_secret = os.environ.get("ADMIN_SESSION_SECRET", "").strip()
        if len(effective_secret) < 32:
            logger.error("ADMIN_SESSION_SECRET is not configured for HS256 admin verification.")
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Administrator authentication is not configured on this backend.",
            )
        try:
            payload = jwt.decode(
                token,
                effective_secret,
                algorithms=["HS256"],
                leeway=5,
                options={"require": ["exp", "sub", "role", "sid", "sv"]},
            )
            token_role = str(payload.get("role", "")).strip().lower()
            if token_role not in _ADMIN_ALLOWED_ROLES:
                raise InvalidTokenError("Unauthorized role in HS256 token.")
            user_id = str(payload.get("sub") or "").strip()
            session_id = str(payload.get("sid") or "").strip()
            raw_sv = payload.get("sv")
            if not user_id or not session_id:
                raise InvalidTokenError("Missing required subject or session ID claim in HS256 token.")
            if isinstance(raw_sv, bool) or not isinstance(raw_sv, int):
                raise InvalidTokenError("Invalid session version claim in HS256 token.")
            raw_iat = payload.get("iat")
            if raw_iat is not None:
                if isinstance(raw_iat, bool) or not isinstance(raw_iat, (int, float)):
                    raise InvalidTokenError("Invalid issue time claim in HS256 token.")
                if float(raw_iat) > time.time() + 5:
                    raise InvalidTokenError("Token issue time is in the future.")
        except HTTPException:
            raise
        except Exception as hs_err:
            logger.warning(f"Invalid HS256 admin token: {hs_err}")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or expired admin token.",
                headers={"WWW-Authenticate": "Bearer"},
            )

        db_admin = _verify_admin_session_in_supabase(
            session_id=session_id,
            admin_user_id=user_id,
            token_session_version=raw_sv,
        )
        authoritative_role = db_admin["role"]
        authoritative_email = db_admin["email"] or str(payload.get("email") or "").strip()
        roles = ["superadmin", "admin"] if authoritative_role == "superadmin" else ["admin"]
        merged_claims = {
            **payload,
            "role": authoritative_role,
            "email": authoritative_email,
        }
        return AuthenticatedUser(
            user_id=db_admin["id"],
            email=authoritative_email,
            roles=roles,
            claims=merged_claims,
        )

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
            # Retry once (covers transient fetch errors). Reuse the client: PyJWKClient already
            # refetches on an unknown kid with a cooldown, so rebuilding it would let every
            # forged token force fresh JWKS fetches.
            try:
                client = get_jwks_client()
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

    # Cognito users are always ordinary customers (P0 #2). No token claim confers admin rights: `custom:role`
    # / `role` can be customer-writable Cognito attributes, and Cognito groups would bypass the database admin
    # system (no session revocation, audit, or admin/superadmin separation). Admin and superadmin access is
    # granted only by the HS256 admin-session path, verified against admin_sessions / admin_users. The claims
    # stay available in `claims` for non-authorisation use.
    return AuthenticatedUser(
        user_id=str(user_id),
        email=str(email),
        roles=[],
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
        from .db import DBConnection, _resolve_notifications_dsn

        dsn = _resolve_notifications_dsn()
        if dsn:
            with DBConnection(autocommit=True) as conn:
                cur = conn.cursor()
                cur.execute("SELECT status FROM profiles WHERE user_id = %s LIMIT 1;", (user.user_id,))
                row = cur.fetchone()
        else:
            row = None
            try:
                from backend.database.supabase_client import get_supabase_client
                sb = get_supabase_client()
                if sb:
                    p_res = sb.table("profiles").select("status").eq("user_id", user.user_id).limit(1).execute()
                    rows = p_res.data if hasattr(p_res, "data") else []
                    if rows:
                        row = rows[0]
            except Exception:
                pass
    except Exception as db_err:
        if (
            os.getenv("INFERXE_LOCAL_MOCK_SUPABASE", "").strip() == "1"
            or os.getenv("ADMIN_DEV_FALLBACK", "").strip().lower() in ("1", "true", "yes")
        ):
            logger.warning("Profile status lookup fallback in notifications: %s", db_err)
            _ACTIVE_PROFILE_CACHE[user.user_id] = now + _ACTIVE_PROFILE_TTL_SECONDS
            return
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

def get_current_user(
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

def require_admin_user(
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

def get_optional_user(
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

