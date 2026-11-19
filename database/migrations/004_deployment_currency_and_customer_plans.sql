-- ==============================================================================
-- Inferxe Migration 004: deployment rate currency + customer plans (trial / tier)
-- Migration File: database/migrations/004_deployment_currency_and_customer_plans.sql
-- Additive and idempotent. Access stays backend-mediated (service role); RLS on, no client policies.
-- ==============================================================================

BEGIN;

-- 1. deployments.currency — the currency of hourly_rate, so the console can show ₹/hr burn and
--    hours-left honestly. Inferxe prices in INR; existing rows (none at time of writing) get INR.
ALTER TABLE public.deployments
    ADD COLUMN IF NOT EXISTS currency CHAR(3) NOT NULL DEFAULT 'INR';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'deployments_currency_iso') THEN
        ALTER TABLE public.deployments
            ADD CONSTRAINT deployments_currency_iso CHECK (currency ~ '^[A-Z]{3}$');
    END IF;
END $$;

-- 2. customer_plans — one row per customer, set by administrators (no trial starts automatically).
--    Trial state is derived from the dates: no dates = no trial; now < trial_ends_at = active;
--    otherwise expired.
CREATE TABLE IF NOT EXISTS public.customer_plans (
    user_id          TEXT PRIMARY KEY REFERENCES public.profiles(user_id) ON DELETE CASCADE,
    tier             TEXT CHECK (tier IS NULL OR length(btrim(tier)) BETWEEN 1 AND 64),
    trial_started_at TIMESTAMPTZ,
    trial_ends_at    TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT customer_plans_trial_window CHECK (
        trial_ends_at IS NULL OR trial_started_at IS NULL OR trial_ends_at > trial_started_at
    )
);

ALTER TABLE public.customer_plans ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON public.customer_plans;
CREATE TRIGGER set_updated_at
    BEFORE UPDATE ON public.customer_plans
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMIT;

-- Rollback (manual):
--   DROP TABLE IF EXISTS public.customer_plans;
--   ALTER TABLE public.deployments DROP CONSTRAINT IF EXISTS deployments_currency_iso;
--   ALTER TABLE public.deployments DROP COLUMN IF EXISTS currency;
