
-- ==============================================================================
-- INFERXE CENTRALIZED CUSTOMER MANAGEMENT
-- Migration: 004_extend_profiles_customer_management.sql
-- Project: inferxe_Project
-- Supabase Project ID: griymmcatsfwnfmqwgdd
--
-- Canonical customer identity table: public.profiles
-- Authentication provider: AWS Cognito
-- Central database: Supabase PostgreSQL
-- ==============================================================================


-- ==============================================================================
-- 1. EXTEND EXISTING PROFILES TABLE
-- ==============================================================================

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ DEFAULT now(),
    ADD COLUMN IF NOT EXISTS login_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS phone_number TEXT,
    ADD COLUMN IF NOT EXISTS organization TEXT;


-- ==============================================================================
-- 2. BACKFILL EXISTING CUSTOMER ACTIVITY
-- Preserve existing customer records.
-- Do not invent historical login counts or login timestamps.
-- ==============================================================================

UPDATE public.profiles
SET last_seen_at = COALESCE(
    last_active_at,
    updated_at,
    created_at,
    now()
)
WHERE last_seen_at IS NULL;


-- ==============================================================================
-- 3. CREATE INDEXES FOR CUSTOMER MANAGEMENT
-- ==============================================================================

CREATE INDEX IF NOT EXISTS idx_profiles_email
    ON public.profiles(email);

CREATE INDEX IF NOT EXISTS idx_profiles_last_seen_at
    ON public.profiles(last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_profiles_last_login_at
    ON public.profiles(last_login_at DESC);

CREATE INDEX IF NOT EXISTS idx_profiles_role_status
    ON public.profiles(role, status);

CREATE INDEX IF NOT EXISTS idx_profiles_created_at
    ON public.profiles(created_at DESC);


-- ==============================================================================
-- 4. ENABLE ROW LEVEL SECURITY
-- ==============================================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;


-- ==============================================================================
-- 5. CREATE SERVICE ROLE POLICY IF IT DOES NOT ALREADY EXIST
-- Service role is intended for trusted backend operations only.
-- ==============================================================================

DO $$
BEGIN

    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'profiles'
          AND policyname = 'Service role full access on profiles'
    ) THEN

        CREATE POLICY "Service role full access on profiles"
            ON public.profiles
            FOR ALL
            TO service_role
            USING (true)
            WITH CHECK (true);

    END IF;

END
$$;


-- ==============================================================================
-- 6. VERIFY MIGRATION RESULTS
-- ==============================================================================

SELECT
    column_name,
    data_type,
    column_default,
    is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'profiles'
ORDER BY ordinal_position;


-- ==============================================================================
-- 7. VERIFY CUSTOMER RECORD COUNT
-- ==============================================================================

SELECT
    COUNT(*) AS total_customer_profiles
FROM public.profiles;


-- ==============================================================================
-- 8. VERIFY INDEXES
-- ==============================================================================

SELECT
    indexname,
    indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'profiles'
ORDER BY indexname;


-- ==============================================================================
-- 9. VERIFY RLS STATUS
-- ==============================================================================

SELECT
    relname,
    relrowsecurity,
    relforcerowsecurity
FROM pg_class
WHERE oid = 'public.profiles'::regclass;


-- ==============================================================================
-- 10. VERIFY EXISTING POLICIES
-- ==============================================================================

SELECT
    schemaname,
    tablename,
    policyname,
    roles,
    cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'profiles';


-- ==============================================================================
-- MIGRATION 004 COMPLETE
-- ==============================================================================
