-- 010: public.gpu_health_history — stores historical health evaluations, scores, and telemetry
--
-- STATUS: PROPOSED, NOT APPLIED. Safe to re-run (idempotent). Additive only.
--
-- Written by backend/gpu_health/service.py (GpuHealthService) with service role or local engine.
-- Stores health reports, individual check outputs, scores, and deployment readiness.

BEGIN;

CREATE TABLE IF NOT EXISTS public.gpu_health_history (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    gpu_id                TEXT NOT NULL,
    vendor                TEXT,
    model                 TEXT,
    health_status         TEXT NOT NULL CHECK (health_status IN ('healthy', 'warning', 'critical', 'unknown', 'unavailable')),
    health_score          DOUBLE PRECISION,
    availability_status   TEXT NOT NULL DEFAULT 'available',
    is_deployment_ready   BOOLEAN NOT NULL DEFAULT true,
    summary               TEXT,
    check_results         JSONB NOT NULL DEFAULT '[]'::jsonb,
    metrics               JSONB NOT NULL DEFAULT '{}'::jsonb,
    recommendations       JSONB NOT NULL DEFAULT '[]'::jsonb,
    execution_duration_ms INTEGER,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gpu_health_history_gpu_created
    ON public.gpu_health_history (gpu_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_gpu_health_history_status
    ON public.gpu_health_history (health_status);

-- Backend-only table (written by GpuHealthService with the service role); browsers never query it directly.
REVOKE ALL ON TABLE public.gpu_health_history FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.gpu_health_history TO service_role;
ALTER TABLE public.gpu_health_history ENABLE ROW LEVEL SECURITY;

DO $migration$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'gpu_health_history'
          AND policyname = 'Service role full access on gpu_health_history'
    ) THEN
        CREATE POLICY "Service role full access on gpu_health_history"
            ON public.gpu_health_history FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
END
$migration$;

COMMIT;
