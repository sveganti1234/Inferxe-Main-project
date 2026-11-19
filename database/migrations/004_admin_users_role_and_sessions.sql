-- ==============================================================================
-- Inferxe Phase A1: Secure Admin Authentication Role & Session Hardening
-- Migration File: database/migrations/004_admin_users_role_and_sessions.sql
--
-- Purpose:
--   1. Add `role` column (`admin` | `superadmin`, default `admin`) to `public.admin_users`.
--   2. Enforce role domain integrity via CHECK constraint `admin_users_role_check`.
--   3. Promote ONLY the existing Super Admin account:
--        id    = 'd9a494cb-1e8d-4bca-8142-19687fa9138b'
--        email = 'admin@inferxe.com'
--      to `role = 'superadmin'`, strictly preserving `password_hash`,
--      `session_version`, `is_active`, and all other existing columns.
--   4. Drop legacy single-active-account index `admin_users_one_active_shared_account`
--      and enforce at most one active Super Admin (`admin_users_one_active_superadmin`)
--      while allowing multiple active standard Admin accounts.
--   5. Add supporting indexes on `public.admin_users` and `public.admin_sessions`.
--   6. Enforce Row Level Security (RLS) so only the trusted backend `service_role`
--      can read/write `public.admin_users` and `public.admin_sessions`.
--
-- Safety:
--   - Fully transactional and idempotent (safe to re-run).
--   - Does NOT delete, recreate, or reset any admin account or password hash.
--   - Does NOT create additional superadmin accounts.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. Add `role` column to `public.admin_users` (defaulting all accounts to 'admin')
-- ------------------------------------------------------------------------------
ALTER TABLE public.admin_users
    ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'admin';

-- Backfill any unexpected NULL values defensively before enforcing CHECK constraint
UPDATE public.admin_users
SET role = 'admin'
WHERE role IS NULL;

-- Ensure role default and NOT NULL constraint are explicitly enforced
ALTER TABLE public.admin_users
    ALTER COLUMN role SET DEFAULT 'admin',
    ALTER COLUMN role SET NOT NULL;

-- Add CHECK constraint idempotently (allows strictly 'admin' or 'superadmin')
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'admin_users_role_check'
          AND conrelid = 'public.admin_users'::regclass
    ) THEN
        ALTER TABLE public.admin_users
            ADD CONSTRAINT admin_users_role_check
            CHECK (role IN ('admin', 'superadmin'));
    END IF;
END
$$;

-- ------------------------------------------------------------------------------
-- 2. Promote ONLY the confirmed existing Super Admin account
--    Preserves password_hash, session_version, is_active, created_at, last_login
-- ------------------------------------------------------------------------------
DO $$
DECLARE
    v_updated_count INTEGER;
BEGIN
    UPDATE public.admin_users
    SET role = 'superadmin',
        updated_at = timezone('utc'::text, now())
    WHERE id = 'd9a494cb-1e8d-4bca-8142-19687fa9138b'::uuid
      AND lower(email) = 'admin@inferxe.com';

    GET DIAGNOSTICS v_updated_count = ROW_COUNT;

    IF v_updated_count <> 1 THEN
        RAISE EXCEPTION
            'Expected exactly 1 existing admin_users row for id=d9a494cb-1e8d-4bca-8142-19687fa9138b (admin@inferxe.com), found %.',
            v_updated_count;
    END IF;
END
$$;

-- ------------------------------------------------------------------------------
-- 3. Replace legacy single-active-account index with single-active-superadmin
--    guard and supporting indexes for admin auth & DB-backed sessions
-- ------------------------------------------------------------------------------
DROP INDEX IF EXISTS public.admin_users_one_active_shared_account;

CREATE UNIQUE INDEX IF NOT EXISTS admin_users_one_active_superadmin
    ON public.admin_users (role)
    WHERE role = 'superadmin' AND is_active;

CREATE INDEX IF NOT EXISTS idx_admin_users_role
    ON public.admin_users(role);

CREATE INDEX IF NOT EXISTS idx_admin_users_email_lower
    ON public.admin_users(lower(email));

CREATE INDEX IF NOT EXISTS idx_admin_sessions_admin_user_id
    ON public.admin_sessions(admin_user_id);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_active_lookup
    ON public.admin_sessions(admin_user_id, revoked_at)
    WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires_at
    ON public.admin_sessions(expires_at);

-- ------------------------------------------------------------------------------
-- 4. Table Privileges & Row Level Security (RLS)
--    Default Deny for anon/authenticated, Service Role only
-- ------------------------------------------------------------------------------
REVOKE ALL ON TABLE public.admin_users FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.admin_users TO service_role;

ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role access on admin_users" ON public.admin_users;
CREATE POLICY "Service role access on admin_users"
    ON public.admin_users
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

REVOKE ALL ON TABLE public.admin_sessions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.admin_sessions TO service_role;

ALTER TABLE public.admin_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role access on admin_sessions" ON public.admin_sessions;
CREATE POLICY "Service role access on admin_sessions"
    ON public.admin_sessions
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

COMMIT;

-- ------------------------------------------------------------------------------
-- Post-migration verification query (run manually in Supabase SQL Editor):
--   SELECT id, email, role, is_active, session_version, last_login, updated_at
--   FROM public.admin_users
--   ORDER BY created_at ASC;
-- Expected: admin@inferxe.com (d9a494cb-1e8d-4bca-8142-19687fa9138b) has role='superadmin',
--           is_active=true, session_version=2, and unchanged password_hash.
-- ------------------------------------------------------------------------------
