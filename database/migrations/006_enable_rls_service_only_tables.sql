-- 006: enable Row-Level Security on the 9 tables exposed to Supabase's public roles.
--
-- STATUS: PROPOSED, NOT APPLIED. Review with the TL / database owner. Run section A first (read-only); apply
-- section B on a non-production copy (Supabase branch / staging) before production.
--
-- Finding (read-only catalog audit, 2026-11-18, INFERXE_SUPABASE_DATABASE_AUDIT.md): these tables have RLS
-- disabled and grant SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER to `anon` and `authenticated`,
-- so anyone holding the project's anon key can read/modify/delete them through PostgREST.
--
-- Access map (source inspection):
--   table                      owner column       accessed by                                    rows (est.)
--   users                      id (+ email)       notifications service, psycopg2 as `postgres`   ~192
--   wallets                    user_id (PK)       notifications service, psycopg2 as `postgres`   ~128
--   gpu_deployments            user_id            notifications service, psycopg2 as `postgres`   0
--   notification_outbox        user_id            notifications service, psycopg2 as `postgres`   ~155
--   workspace_settings         user_id (PK)       notifications service, psycopg2 as `postgres`   ~3
--   gpu_inventory              (platform data)    notifications service, psycopg2 as `postgres`   0
--   gpu_maintenance_schedules  (platform data)    notifications service, psycopg2 as `postgres`   0
--   ssh_keys                   user_id            legacy inference SQLAlchemy models (create only) 0
--   notebook_instances         user_id            legacy inference SQLAlchemy models (create only) 0
--   No frontend code uses Supabase directly (no client, no anon key in frontend/); the Node API and the
--   inference REST repositories use the service-role key and do not touch these tables.
--
-- Design: "service-only" tables.
--   * RLS ENABLED, not FORCED: the owning role (`postgres`, used by the notifications service) and
--     `service_role` (BYPASSRLS) keep working unchanged; RLS without a policy denies everyone else.
--   * All privileges REVOKED from `anon` and `authenticated` (defence in depth: no grant, no access even if a
--     permissive policy were added by mistake).
--   * No policies for anon/authenticated. Owner-scoped policies are deliberately NOT added: customers are
--     identified by Cognito, not Supabase Auth, so `auth.uid()` never equals these `user_id` values (Cognito
--     subs) and such a policy would be dead or misleading. If direct client access is ever needed, configure
--     Cognito as a Supabase third-party auth provider first and add per-table policies on
--     `(auth.jwt() ->> 'sub') = user_id`, reviewed separately.
--   * gpu_inventory is public catalogue data, but nothing reads it from a client today (the marketplace is
--     served by the backend), so it is service-only too. Optional public read is in section D.
--   * This matches the project's existing pattern: 21 other public tables already have RLS on and no policies.
--
-- Lock impact: ALTER TABLE ... ENABLE ROW LEVEL SECURITY takes a brief ACCESS EXCLUSIVE lock; the tables are
-- tiny (largest ~192 rows), so the transaction is near-instant. Run outside peak traffic anyway.

-- ── A. Read-only pre-checks (run first; every check must pass before section B) ───────────────────────

-- A1. Owners and RLS state. Expected: every table owned by the role the notifications service connects as
--     (`postgres`); otherwise that role needs BYPASSRLS (A2) or it will lose access once RLS is enabled.
SELECT c.relname AS table_name, pg_get_userbyid(c.relowner) AS owner, c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS rls_forced
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('users', 'wallets', 'ssh_keys', 'gpu_deployments', 'notification_outbox',
                    'workspace_settings', 'gpu_inventory', 'gpu_maintenance_schedules', 'notebook_instances')
ORDER BY 1;

-- A2. Which roles bypass RLS. Expected: service_role = true; postgres = true or owner of all 9 tables (A1).
SELECT rolname, rolbypassrls FROM pg_roles WHERE rolname IN ('postgres', 'service_role', 'anon', 'authenticated');

-- A3. Existing policies on these tables. Expected: none (2026-11-18). Review any row before continuing.
SELECT tablename, policyname, roles, cmd FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('users', 'wallets', 'ssh_keys', 'gpu_deployments', 'notification_outbox',
                    'workspace_settings', 'gpu_inventory', 'gpu_maintenance_schedules', 'notebook_instances');

-- A4. Current public-role grants (keep this output: it is what the rollback in section E restores).
SELECT table_name, grantee, string_agg(privilege_type, ',' ORDER BY privilege_type) AS privileges
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated')
  AND table_name IN ('users', 'wallets', 'ssh_keys', 'gpu_deployments', 'notification_outbox',
                     'workspace_settings', 'gpu_inventory', 'gpu_maintenance_schedules', 'notebook_instances')
GROUP BY table_name, grantee ORDER BY 1, 2;

-- ── B. Apply (one transaction; idempotent: safe to re-run) ─────────────────────────────────────────
-- Tables that do not exist are skipped (e.g. the legacy ssh_keys / notebook_instances on a fresh project),
-- and so are roles that do not exist. It never grants anything, never creates a policy, and never FORCEs RLS.
-- notifications and wallet_transactions already have RLS in the audited environment; they are included so
-- that this migration and the services' table-creation code (protect_service_tables) apply the same rules.

BEGIN;

DO $migration$
DECLARE
    service_only_tables CONSTANT text[] := ARRAY[
        'users', 'wallets', 'gpu_deployments', 'notification_outbox', 'workspace_settings',  -- customer data
        'gpu_inventory', 'gpu_maintenance_schedules',                                          -- platform data
        'ssh_keys', 'notebook_instances',                                                      -- legacy, empty
        'notifications', 'wallet_transactions'                                                 -- already RLS
    ];
    public_roles text[];
    t text;
BEGIN
    SELECT coalesce(array_agg(rolname ORDER BY rolname), '{}') INTO public_roles
    FROM pg_roles WHERE rolname IN ('anon', 'authenticated');

    FOREACH t IN ARRAY service_only_tables LOOP
        IF to_regclass(format('public.%I', t)) IS NULL THEN
            RAISE NOTICE 'skipping %: table does not exist', t;
            CONTINUE;
        END IF;
        IF (SELECT relforcerowsecurity FROM pg_class WHERE oid = to_regclass(format('public.%I', t))) THEN
            RAISE EXCEPTION 'public.% has FORCE ROW LEVEL SECURITY; review before applying 006', t;
        END IF;
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
        IF cardinality(public_roles) > 0 THEN
            EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %s', t,
                           (SELECT string_agg(quote_ident(r), ', ') FROM unnest(public_roles) AS r));
        END IF;
    END LOOP;
END
$migration$;

COMMIT;

-- ── C. Post-apply validation (read-only) ───────────────────────────────────────────────────────────

-- C1. Every row must show rls_enabled = true, rls_forced = false.
--     (re-run A1)
-- C2. Must return no rows.
SELECT table_name, grantee, privilege_type FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated')
  AND table_name IN ('users', 'wallets', 'ssh_keys', 'gpu_deployments', 'notification_outbox',
                     'workspace_settings', 'gpu_inventory', 'gpu_maintenance_schedules', 'notebook_instances',
                     'notifications', 'wallet_transactions');
-- C3. As the anon role, access must fail ("permission denied"), e.g. inside a transaction that is rolled back:
--     BEGIN; SET LOCAL ROLE anon; SELECT count(*) FROM public.wallets; ROLLBACK;
-- C4. Application checks: notifications service health, wallet balance/history, notifications list and
--     deployment status for a test user still work (they run as the owning role).

-- ── D. Optional, NOT part of this migration: public read of the GPU catalogue ──────────────────────
-- Only if a client must read gpu_inventory directly through PostgREST (nothing does today):
-- GRANT SELECT ON public.gpu_inventory TO anon, authenticated;
-- CREATE POLICY gpu_inventory_public_read ON public.gpu_inventory FOR SELECT TO anon, authenticated USING (true);

-- ── E. Rollback (restores the 2026-11-18 state of the 9 exposed tables; compare with the A4 output) ──
-- Do NOT roll back notifications / wallet_transactions: they had RLS before this migration.
-- BEGIN;
-- DO $rollback$
-- DECLARE t text;
-- BEGIN
--     FOREACH t IN ARRAY ARRAY['users', 'wallets', 'gpu_deployments', 'notification_outbox', 'workspace_settings',
--                              'gpu_inventory', 'gpu_maintenance_schedules', 'ssh_keys', 'notebook_instances'] LOOP
--         CONTINUE WHEN to_regclass(format('public.%I', t)) IS NULL;  -- e.g. legacy tables absent
--         EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', t);
--         EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.%I '
--                        'TO anon, authenticated', t);
--     END LOOP;
-- END
-- $rollback$;
-- COMMIT;
-- (Rolling back re-opens the exposure; prefer fixing forward.)
