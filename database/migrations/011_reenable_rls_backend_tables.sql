-- 011: close the public-role exposure of backend data (RLS, a SECURITY DEFINER function, default privileges).
--
-- STATUS: PROPOSED, NOT APPLIED. Review with the database owner. Run section A (read-only) first and keep
-- its output: section D restores exactly that state.
--
-- Findings (read-only catalog audit, 2026-11-25):
--   1. 21 public tables have RLS disabled and grant every privilege to `anon` and `authenticated`, so
--      anyone holding the project's anon key can read or change them through PostgREST, bypassing the
--      backend. They include admin_users (password hashes), admin_sessions, profiles, wallet_accounts,
--      orders and ssh_public_keys. pg_stat_statements records explicit
--      `ALTER TABLE ... DISABLE ROW LEVEL SECURITY` statements run as `postgres` since 2026-11-05.
--   2. public.sync_customer_profile(text, text, text, text) is SECURITY DEFINER (runs as its owner,
--      `postgres`, so RLS does not apply) and EXECUTE is granted to anon and authenticated. Through
--      /rest/v1/rpc/sync_customer_profile it overwrites full_name/email/username of ANY user_id and can
--      create profiles and organizations. No code in this repository calls it.
--   3. Default privileges for role `postgres` in schema `public` grant ALL on every new table to anon and
--      authenticated, so each table created later starts out exposed.
--
-- Who uses these objects (source inspection): the Node API and the inference REST repositories use the
-- service-role key; the notifications service connects as `postgres`; the RAG client uses the
-- service-role key. Both roles have BYPASSRLS, `postgres` owns every table, and RLS is not FORCED, so
-- they keep working unchanged. No frontend code talks to Supabase directly (no client, no anon key).
--
-- What this migration changes (and nothing else):
--   * the 21 tables below: RLS ENABLED (not FORCED); ALL privileges revoked from anon and authenticated.
--     service_role and postgres privileges, table owners and existing policies are untouched.
--   * sync_customer_profile(text, text, text, text): EXECUTE revoked from PUBLIC, anon and authenticated.
--     postgres and service_role keep EXECUTE. Skipped with a NOTICE if the function does not exist.
--   * default privileges FOR ROLE postgres IN SCHEMA public: ALL ON TABLES revoked from PUBLIC, anon and
--     authenticated. Per-schema defaults add to global ones and cannot revoke them, so a GLOBAL default
--     table grant of postgres to those roles is revoked too, but only if one exists (none on 2026-11-25;
--     a WARNING is raised when it happens). Default privileges of other roles (e.g. supabase_admin), other
--     schemas (e.g. storage) and other object types are untouched; so are the postgres/service_role entries.
-- Design notes (same as 006): no policies are added; customers are Cognito identities, so auth.uid()
-- policies would never match. Locks: brief ACCESS EXCLUSIVE per table; lock_timeout makes the whole
-- transaction fail (and change nothing) instead of queueing behind long-running queries. Then retry.

-- ── A. Read-only checks: run before (keep the output) and again after section B ─────────────────────
-- A1. Expected: rolbypassrls = true for postgres and service_role, false for anon and authenticated.
--   SELECT rolname, rolbypassrls FROM pg_roles WHERE rolname IN ('postgres', 'service_role', 'anon', 'authenticated');
-- A2. RLS and policies of the 21 tables. Before: rls = false on all 21. After: rls = true, force = false.
--     The policy list must be identical before and after (before 2026-11-25: one service_role policy each
--     on admin_users, admin_sessions, profiles, chat_history, document_metadata).
--   SELECT c.relname, c.relrowsecurity AS rls, c.relforcerowsecurity AS force, pg_get_userbyid(c.relowner) AS owner,
--          (SELECT string_agg(p.policyname, '; ') FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policies
--   FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--   WHERE n.nspname = 'public' AND c.relname = ANY (ARRAY['admin_users','admin_sessions','audit_logs','profiles',
--     'organizations','organization_members','user_access_policies','customer_plans','wallet_accounts','orders',
--     'order_reviews','usage_records','deployments','notebook_sessions','saved_gpu_listings','ssh_public_keys',
--     'chat_history','document_metadata','inferxe_notifications','gpu_listings','gpu_providers'])
--   ORDER BY 1;
-- A3. Table privileges of the public roles and service_role (exact, including MAINTAIN on PostgreSQL 17).
--     Before: anon and authenticated hold every privilege on all 21. After: no anon/authenticated rows;
--     service_role rows unchanged.
--   SELECT c.relname, a.grantee::regrole AS grantee, string_agg(a.privilege_type, ',' ORDER BY a.privilege_type) AS privileges
--   FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace, aclexplode(c.relacl) a
--   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND a.grantee IN (SELECT oid FROM pg_roles
--     WHERE rolname IN ('anon', 'authenticated', 'service_role'))
--   GROUP BY 1, 2 ORDER BY 1, 2;
-- A4. The function. Before: exactly one row, prosecdef = true, owner postgres,
--     proacl = {postgres=X/postgres,service_role=X/postgres,anon=X/postgres,authenticated=X/postgres}
--     (no PUBLIC entry). After: anon_exec = false, authenticated_exec = false, service_role_exec = true.
--   SELECT p.oid::regprocedure AS signature, p.prosecdef, pg_get_userbyid(p.proowner) AS owner, p.proacl,
--          has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_exec,
--          has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_exec
--   FROM pg_proc p WHERE p.oid = to_regprocedure('public.sync_customer_profile(text, text, text, text)');
-- A5. Default privileges (all roles, schemas and object types; schema '-' = global). Before (tables, 2026-11-25):
--     (postgres, public, r) grants postgres, anon, authenticated, service_role; no global postgres row.
--     After: only the (postgres, public, r) row changes, to {postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres},
--     plus the global (postgres, -, r) row losing PUBLIC/anon/authenticated if it existed; every other row is identical.
--   SELECT pg_get_userbyid(defaclrole) AS role, defaclnamespace::regnamespace AS schema, defaclobjtype AS type,
--          defaclacl::text AS acl
--   FROM pg_default_acl ORDER BY 1, 2, 3;
-- A5b. Effective result for the next table postgres creates in public (global + public defaults combined).
--     After: no PUBLIC, anon or authenticated rows.
--   SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee,
--          CASE WHEN d.defaclnamespace = 0 THEN 'global' ELSE 'public' END AS scope, a.privilege_type
--   FROM pg_default_acl d, aclexplode(d.defaclacl) a
--   WHERE d.defaclrole = 'postgres'::regrole AND d.defaclobjtype = 'r'
--     AND d.defaclnamespace IN (0, 'public'::regnamespace)
--     AND (a.grantee = 0 OR a.grantee IN (SELECT oid FROM pg_roles WHERE rolname IN ('anon', 'authenticated')))
--   ORDER BY 1, 2, 3;
-- A6. (Report only; this migration does not change them.) Other SECURITY DEFINER functions the public
--     roles can execute, outside system schemas:
--   SELECT p.oid::regprocedure, pg_get_userbyid(p.proowner) AS owner,
--          has_function_privilege('anon', p.oid, 'EXECUTE') AS anon, has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE p.prosecdef AND n.nspname NOT IN ('pg_catalog', 'information_schema')
--     AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))
--   ORDER BY 1;

-- ── B. Apply (one transaction; idempotent; skips missing tables, roles and the function; never grants) ──
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $migration$
DECLARE
    backend_tables CONSTANT text[] := ARRAY[
        'admin_users', 'admin_sessions', 'audit_logs',                                       -- admin
        'profiles', 'organizations', 'organization_members', 'user_access_policies',         -- identity
        'customer_plans', 'wallet_accounts', 'orders', 'order_reviews', 'usage_records',     -- billing
        'deployments', 'notebook_sessions', 'saved_gpu_listings', 'ssh_public_keys',         -- customer
        'chat_history', 'document_metadata', 'inferxe_notifications',                        -- chat / RAG
        'gpu_listings', 'gpu_providers'                                                      -- catalogue
    ];
    profile_sync CONSTANT regprocedure := to_regprocedure('public.sync_customer_profile(text, text, text, text)');
    role_list text;  -- quoted, comma-separated existing public roles, or NULL
    t text;
BEGIN
    SELECT string_agg(quote_ident(rolname), ', ' ORDER BY rolname) INTO role_list
    FROM pg_roles WHERE rolname IN ('anon', 'authenticated');

    -- 1. Tables: enable RLS and revoke the public roles' privileges.
    FOREACH t IN ARRAY backend_tables LOOP
        IF to_regclass(format('public.%I', t)) IS NULL THEN
            RAISE NOTICE 'skip table %: does not exist', t;
            CONTINUE;
        END IF;
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
        IF role_list IS NOT NULL THEN
            EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %s', t, role_list);
        END IF;
    END LOOP;

    -- 2. The SECURITY DEFINER profile-sync function: only postgres and service_role may execute it.
    IF profile_sync IS NULL THEN
        RAISE NOTICE 'skip function public.sync_customer_profile(text, text, text, text): does not exist';
    ELSE
        EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM %s', profile_sync,
                       concat_ws(', ', 'PUBLIC', role_list));
    END IF;

    -- 3. Future tables created by postgres in public no longer grant anything to the public roles
    --    (PUBLIC included: anon and authenticated inherit whatever PUBLIC is granted).
    --    Functions are deliberately not covered: PUBLIC's EXECUTE on new functions is a built-in GLOBAL default
    --    that a per-schema REVOKE cannot remove (verified on PostgreSQL 18), and a global REVOKE would also hit
    --    extension functions. Convention instead: every migration creating a function revokes EXECUTE from
    --    PUBLIC, anon, authenticated, as step 2 does for sync_customer_profile.
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM %s',
                   concat_ws(', ', 'PUBLIC', role_list));

    -- 3b. Per-schema defaults are added to the global (all-schema) defaults, and a per-schema REVOKE cannot
    --     remove a global grant. None existed on 2026-11-25; if one exists now, revoke it there too.
    IF EXISTS (
        SELECT 1 FROM pg_default_acl d, aclexplode(d.defaclacl) a
        WHERE d.defaclrole = 'postgres'::regrole AND d.defaclnamespace = 0 AND d.defaclobjtype = 'r'
          AND (a.grantee = 0 OR a.grantee IN (SELECT oid FROM pg_roles WHERE rolname IN ('anon', 'authenticated')))
    ) THEN
        EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE ALL ON TABLES FROM %s',
                       concat_ws(', ', 'PUBLIC', role_list));
        RAISE WARNING 'revoked GLOBAL default table privileges of postgres from PUBLIC/anon/authenticated; restore from the A5 output if needed';
    END IF;
END
$migration$;
COMMIT;

-- ── C. Verify (read-only) ────────────────────────────────────────────────────────────────────────────
-- Re-run A2-A5 and compare with the saved output (expected results are listed with each check). Then:
--   SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity;          -- expect 0
-- Smoke-test: customer workspace, admin sign-in, super-admin overview, deployments list, chat, profile sync
-- on customer sign-in (the backend writes profiles with the service-role key, not this function).
-- If the transaction failed with "canceling statement due to lock timeout", nothing was changed: retry.

-- ── D. Rollback: restores the exposure. Only if a backend breaks, and only to the state saved from A. ─
-- The state observed on 2026-11-25 was: RLS off on the 21 tables; anon and authenticated holding every
-- table privilege on them (GRANT ALL restores that, including MAINTAIN where the A3 output listed it);
-- EXECUTE on the function granted to anon and authenticated (not PUBLIC); and default privileges for
-- postgres in public granting ALL ON TABLES to anon and authenticated. Compare with your A3-A5 output first.
--   BEGIN;
--   SET LOCAL lock_timeout = '5s';
--   DO $rollback$
--   DECLARE t text;
--   BEGIN
--     FOREACH t IN ARRAY ARRAY['admin_users','admin_sessions','audit_logs','profiles','organizations',
--       'organization_members','user_access_policies','customer_plans','wallet_accounts','orders','order_reviews',
--       'usage_records','deployments','notebook_sessions','saved_gpu_listings','ssh_public_keys','chat_history',
--       'document_metadata','inferxe_notifications','gpu_listings','gpu_providers'] LOOP
--       IF to_regclass(format('public.%I', t)) IS NOT NULL THEN
--         EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', t);
--         EXECUTE format('GRANT ALL ON TABLE public.%I TO anon, authenticated', t);
--       END IF;
--     END LOOP;
--   END
--   $rollback$;
--   GRANT EXECUTE ON FUNCTION public.sync_customer_profile(text, text, text, text) TO anon, authenticated;
--   ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
--   COMMIT;
-- Only if the A5 output taken before the migration showed a GLOBAL (postgres, -, r) row granting those roles
-- (none on 2026-11-25), also restore it, with exactly the roles A5 listed:
--   ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT ALL ON TABLES TO <roles from A5>;
