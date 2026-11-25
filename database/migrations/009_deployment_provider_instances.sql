-- 009_deployment_provider_instances.sql
-- Store provider-instance details on public.deployments so the GPU deployment API
-- (backend/inference/gpu_deployment_service.py) can track real or mock provider instances.
--
-- One deployment = one provider instance, so the columns live on deployments (already the FK target of
-- orders, usage_records, notebook_sessions and inference_requests) instead of a separate table.
-- Selected SSH keys are snapshotted in deployments.metadata->'ssh_keys' as [{id, fingerprint}].
--
-- Also:
--   * allows status 'terminated' (the API and Node PATCH both use it; the old check rejected it);
--   * locks the table down: live check on 2026-11-25 found RLS OFF and full anon/authenticated grants.
--     Every backend reaches this table with the service role or as owner, which bypass RLS.
--
-- Safe to re-run. Apply in the Supabase SQL editor; run the validation block afterwards.

BEGIN;

ALTER TABLE public.deployments
    ADD COLUMN IF NOT EXISTS provider_id         TEXT,
    ADD COLUMN IF NOT EXISTS ssh_host            TEXT,
    ADD COLUMN IF NOT EXISTS ssh_port            INTEGER,
    ADD COLUMN IF NOT EXISTS ssh_username        TEXT,
    ADD COLUMN IF NOT EXISTS error_message       TEXT,
    ADD COLUMN IF NOT EXISTS idempotency_key     TEXT,
    ADD COLUMN IF NOT EXISTS last_status_sync_at TIMESTAMPTZ;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'deployments_ssh_port_check') THEN
        ALTER TABLE public.deployments
            ADD CONSTRAINT deployments_ssh_port_check CHECK (ssh_port IS NULL OR ssh_port BETWEEN 1 AND 65535);
    END IF;
END $$;

ALTER TABLE public.deployments DROP CONSTRAINT IF EXISTS deployments_status_check;
ALTER TABLE public.deployments
    ADD CONSTRAINT deployments_status_check CHECK (status = ANY (ARRAY[
        'provisioning', 'running', 'stopped', 'completed', 'failed', 'cancelled', 'terminated'
    ]));

-- A retried create with the same key returns the existing deployment instead of a second GPU.
CREATE UNIQUE INDEX IF NOT EXISTS uq_deployments_user_idempotency_key
    ON public.deployments (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_deployments_provider_instance
    ON public.deployments (provider_id, provider_instance_id) WHERE provider_instance_id IS NOT NULL;

ALTER TABLE public.deployments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.deployments FROM anon, authenticated;

COMMIT;

-- ── Validation (read-only) ─────────────────────────────────────────────────────────────────────────
-- SELECT column_name FROM information_schema.columns
--  WHERE table_schema = 'public' AND table_name = 'deployments'
--    AND column_name IN ('provider_id','ssh_host','ssh_port','ssh_username','error_message','idempotency_key','last_status_sync_at');
-- SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'deployments_status_check';   -- includes 'terminated'
-- SELECT relrowsecurity FROM pg_class WHERE oid = 'public.deployments'::regclass;                  -- true
-- SELECT has_table_privilege('anon', 'public.deployments', 'SELECT');                              -- false

-- ── Rollback ───────────────────────────────────────────────────────────────────────────────────────
-- DROP INDEX IF EXISTS public.uq_deployments_provider_instance;
-- DROP INDEX IF EXISTS public.uq_deployments_user_idempotency_key;
-- ALTER TABLE public.deployments DROP CONSTRAINT IF EXISTS deployments_ssh_port_check;
-- ALTER TABLE public.deployments DROP CONSTRAINT IF EXISTS deployments_status_check;
-- ALTER TABLE public.deployments ADD CONSTRAINT deployments_status_check CHECK (status = ANY (ARRAY[
--     'provisioning','running','stopped','completed','failed','cancelled']));   -- fails if 'terminated' rows exist
-- ALTER TABLE public.deployments DROP COLUMN IF EXISTS last_status_sync_at, DROP COLUMN IF EXISTS idempotency_key,
--     DROP COLUMN IF EXISTS error_message, DROP COLUMN IF EXISTS ssh_username, DROP COLUMN IF EXISTS ssh_port,
--     DROP COLUMN IF EXISTS ssh_host, DROP COLUMN IF EXISTS provider_id;
-- (RLS/grant lockdown is intentionally not rolled back.)
