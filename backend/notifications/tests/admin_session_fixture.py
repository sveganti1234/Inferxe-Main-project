"""
Database-backed admin identities for tests.

Admin rights on port 8000 come only from the HS256 admin-session path (Cognito claims never grant them). This helper
mints real HS256 admin session tokens in the format backend/auth/adminAuth.js issues (sub, sid, sv, role, iat, exp)
and stands in for the Supabase lookup of admin_sessions / admin_users only. Signature, expiry and claim validation
are the production code in backend/notifications/auth.py; the real Supabase lookup is covered by
test_admin_auth_hardening.py. The stand-in mirrors that lookup: revoked, expired, unknown, mismatched, deactivated
and version-bumped sessions are rejected with 401.

    with db_backed_admins() as admins:
        token = admins.issue(admins.add_admin("adm-1", "ops@example.test"))
        client.post(..., headers={"Authorization": f"Bearer {token}"})
"""

import contextlib
import os
import time
import uuid
from dataclasses import dataclass
from typing import Dict, Optional
from unittest import mock

import jwt
from fastapi import HTTPException, status

from backend.notifications import auth

TEST_ADMIN_SESSION_SECRET = "test-only-admin-session-secret-of-adequate-length"


@dataclass
class _Admin:
    admin_id: str
    email: str
    role: str
    active: bool = True
    session_version: int = 1


@dataclass
class _Session:
    admin_id: str
    session_version: int
    expires_at: float
    revoked: bool = False


class AdminSessionStore:
    def __init__(self) -> None:
        self.admins: Dict[str, _Admin] = {}
        self.sessions: Dict[str, _Session] = {}

    def add_admin(self, admin_id: str, email: str, role: str = "admin") -> str:
        self.admins[admin_id] = _Admin(admin_id, email, role)
        return admin_id

    def issue(self, admin_id: str, *, expires_in: int = 3600, db_session_expires_in: Optional[int] = None,
              token_role: Optional[str] = None, secret: str = TEST_ADMIN_SESSION_SECRET) -> str:
        admin = self.admins[admin_id]
        sid = f"sess-{uuid.uuid4().hex[:12]}"
        now = int(time.time())
        db_ttl = expires_in if db_session_expires_in is None else db_session_expires_in
        self.sessions[sid] = _Session(admin_id, admin.session_version, now + db_ttl)
        return jwt.encode(
            {"sub": admin_id, "sid": sid, "sv": admin.session_version, "role": token_role or admin.role,
             "email": admin.email, "iat": now, "exp": now + expires_in},
            secret, algorithm="HS256",
        )

    def revoke_all(self, admin_id: str) -> None:
        for session in self.sessions.values():
            if session.admin_id == admin_id:
                session.revoked = True

    def deactivate(self, admin_id: str) -> None:
        self.admins[admin_id].active = False

    def bump_session_version(self, admin_id: str) -> None:
        self.admins[admin_id].session_version += 1

    def verify(self, session_id: str, admin_user_id: str, token_session_version: int) -> dict:
        """Same contract as auth._verify_admin_session_in_supabase."""
        def reject(detail: str):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=detail)

        session = self.sessions.get(session_id)
        if session is None:
            reject("Administrator session not found.")
        if session.admin_id != admin_user_id:
            reject("Administrator session ownership mismatch.")
        if session.revoked:
            reject("Administrator session has been revoked.")
        if session.expires_at <= time.time():
            reject("Administrator session has expired.")
        admin = self.admins.get(admin_user_id)
        if admin is None or not admin.active:
            reject("Administrator account is inactive.")
        if admin.session_version != token_session_version or session.session_version != token_session_version:
            reject("Administrator session version mismatch.")
        if admin.role not in ("admin", "superadmin"):
            reject("Unauthorized administrator role.")
        return {"id": admin.admin_id, "email": admin.email, "role": admin.role, "session_version": admin.session_version}


@contextlib.contextmanager
def db_backed_admins():
    """Activate the HS256 admin path with a test secret and the in-memory admin_sessions/admin_users stand-in."""
    store = AdminSessionStore()
    with mock.patch.dict(os.environ, {"ADMIN_SESSION_SECRET": TEST_ADMIN_SESSION_SECRET}), \
            mock.patch.object(auth, "_verify_admin_session_in_supabase", store.verify):
        yield store
