-- 008: public.routing_decisions — one row per POST /api/v1/recommend (DPR §14.1 "Routing Decisions").
--
-- STATUS: PROPOSED, NOT APPLIED. Apply on a non-production copy first.
-- Safe to re-run (idempotent). Additive only.
--
-- Written by backend/inference/supabase_telemetry.py (record_routing_decision) with the service role.
-- Tenant columns come from the authenticated API key, mirroring public.inference_requests.
-- workload  = the validated request (model, quant, context, concurrency, mode, policy constraints).
-- candidates = the top ranked eligible offers with their scores (the decision's rationale).

BEGIN;

CREATE TABLE IF NOT EXISTS public.routing_decisions (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           TEXT NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
    organization_id   UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
    api_key_id        UUID REFERENCES public.api_keys(id) ON DELETE SET NULL,
    workload          JSONB NOT NULL,
    mode              TEXT NOT NULL CHECK (mode IN ('cost', 'speed', 'balanced')),
    selected_offer_id TEXT,
    candidates        JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_routing_decisions_user_created
    ON public.routing_decisions (user_id, created_at DESC);

REVOKE ALL ON TABLE public.routing_decisions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.routing_decisions TO service_role;
ALTER TABLE public.routing_decisions ENABLE ROW LEVEL SECURITY;

DO $migration$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'routing_decisions'
          AND policyname = 'Service role access on routing_decisions'
    ) THEN
        CREATE POLICY "Service role access on routing_decisions"
            ON public.routing_decisions FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
END
$migration$;

COMMIT;
