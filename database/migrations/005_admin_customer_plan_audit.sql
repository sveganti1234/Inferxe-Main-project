-- ==============================================================================
-- Inferxe Migration 005: atomic, audited customer plan changes for administrators
-- Migration File: database/migrations/005_admin_customer_plan_audit.sql
-- Adds public.admin_set_customer_plan(): upserts customer_plans and writes an audit_logs row
-- (before/after) in ONE transaction. Callable only by the backend service role.
-- Depends on 004 (customer_plans). Idempotent (CREATE OR REPLACE).
-- ==============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_set_customer_plan(
    p_user_id          TEXT,
    p_tier             TEXT,
    p_trial_started_at TIMESTAMPTZ,
    p_trial_ends_at    TIMESTAMPTZ,
    p_admin_email      TEXT,
    p_reason           TEXT
)
RETURNS public.customer_plans
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    before_row public.customer_plans;
    after_row  public.customer_plans;
BEGIN
    IF p_admin_email IS NULL OR btrim(p_admin_email) = '' THEN
        RAISE EXCEPTION 'administrator identity is required' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = p_user_id AND role = 'customer') THEN
        RAISE EXCEPTION 'customer not found' USING ERRCODE = 'P0002';
    END IF;

    SELECT * INTO before_row FROM public.customer_plans WHERE user_id = p_user_id FOR UPDATE;

    INSERT INTO public.customer_plans (user_id, tier, trial_started_at, trial_ends_at)
    VALUES (p_user_id, NULLIF(btrim(p_tier), ''), p_trial_started_at, p_trial_ends_at)
    ON CONFLICT (user_id) DO UPDATE
        SET tier = EXCLUDED.tier,
            trial_started_at = EXCLUDED.trial_started_at,
            trial_ends_at = EXCLUDED.trial_ends_at
    RETURNING * INTO after_row;

    INSERT INTO public.audit_logs (action, target_type, target_id, details)
    VALUES (
        'admin.plan.updated',
        'customer_plan',
        p_user_id,
        jsonb_build_object(
            'administrator_email', p_admin_email,
            'reason', NULLIF(btrim(COALESCE(p_reason, '')), ''),
            'before', CASE WHEN before_row.user_id IS NULL THEN NULL ELSE to_jsonb(before_row) END,
            'after', to_jsonb(after_row)
        )
    );

    RETURN after_row;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_customer_plan(TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_customer_plan(TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT) TO service_role;

COMMIT;

-- Rollback (manual):
--   DROP FUNCTION IF EXISTS public.admin_set_customer_plan(TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT);
