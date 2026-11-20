-- 005: indexes for Supabase-managed tables, matched to the exact filters the backend sends.
--
-- STATUS: PROPOSED, NOT APPLIED. Review with the TL / database owner first.
-- PRODUCTION CHECK 2026-11-18 (read-only, no writes): only B1 is missing in the configured Supabase
-- project. B2-B9 are already covered there by existing indexes/constraints (noted per statement) and are
-- commented out so this file cannot create duplicates. 0 duplicate secret_hash values were found.
-- These tables are owned by the Supabase project; their DDL is NOT in this repository, so some of
-- these indexes (or equivalent primary keys / unique constraints) may already exist there.
--
-- HOW TO APPLY (on a non-production copy first):
--   1. Run section A (read-only). Drop from section B any index whose columns are already covered
--      by an existing index, primary key or unique constraint (left-most columns matching).
--   2. Run each CREATE INDEX CONCURRENTLY statement on its own (not inside a transaction block).
--   3. After each one, confirm it is valid (section C). A failed/cancelled CONCURRENTLY build leaves
--      an INVALID index and re-running "IF NOT EXISTS" silently skips it: DROP INDEX CONCURRENTLY
--      IF EXISTS <name>; then re-run (same procedure as migration 004).
--
-- Not included on purpose: gpu_providers/gpu_listings by status (small catalogue tables: write cost
-- without read benefit), and lookups by primary key id (already indexed).

-- ── A. Read-only checks ─────────────────────────────────────────────────────────────────────────
SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('api_keys', 'ssh_public_keys', 'notebook_sessions', 'inference_requests',
                    'organization_members', 'user_access_policies', 'saved_gpu_listings',
                    'deployments', 'orders', 'order_reviews', 'usage_records')
ORDER BY tablename, indexname;
-- deployments / orders / order_reviews / usage_records: the Node customer workspace fetches them by
-- user_id on every load (backend/api/supabaseApi.js getWorkspace). No index is proposed because their
-- schema and size are unknown here; if this check shows no index leading with user_id, consider one.

-- Columns these indexes rely on must exist (any missing row here = do not run that statement).
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (table_name, column_name) IN (
      ('api_keys', 'secret_hash'), ('api_keys', 'user_id'), ('api_keys', 'created_at'),
      ('ssh_public_keys', 'user_id'), ('ssh_public_keys', 'fingerprint'), ('ssh_public_keys', 'created_at'),
      ('notebook_sessions', 'user_id'), ('notebook_sessions', 'created_at'),
      ('inference_requests', 'user_id'), ('inference_requests', 'created_at'),
      ('organization_members', 'user_id'), ('organization_members', 'status'),
      ('user_access_policies', 'user_id'), ('saved_gpu_listings', 'user_id'))
ORDER BY table_name, column_name;

-- Before making secret_hash UNIQUE (B1), there must be no duplicates:
SELECT secret_hash, COUNT(*) FROM api_keys GROUP BY secret_hash HAVING COUNT(*) > 1;

-- ── B. Proposed indexes ─────────────────────────────────────────────────────────────────────────

-- B1. api_keys(secret_hash) UNIQUE
--     Query: GET api_keys?secret_hash=eq.<hash>  (backend/inference/supabase_api_keys.py, get_by_secret_hash)
--     Why:   runs on EVERY authenticated inference request; without an index it scans all keys.
--            UNIQUE also guarantees one key per hash.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_api_keys_secret_hash
    ON api_keys (secret_hash);

-- B2. api_keys(user_id, created_at DESC)
--     Query: GET api_keys?user_id=eq.<sub>&order=created_at.desc  (list_user_api_keys; Node workspace)
-- PRODUCTION CHECK 2026-11-18 (read-only inspection): covered by existing idx_api_keys_user (user_id); a user has few keys, so the sort is trivial. SKIP.
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_api_keys_user_created
--     ON api_keys (user_id, created_at DESC);

-- B3. ssh_public_keys(user_id, fingerprint)
--     Query: GET ssh_public_keys?user_id=eq.<sub>&fingerprint=eq.<fp>  (check_duplicate_ssh_key, on every key upload)
--     Note:  non-unique on purpose; making it UNIQUE is a separate data decision (existing duplicates).
-- PRODUCTION CHECK 2026-11-18 (read-only inspection): existing UNIQUE constraint ssh_public_keys_user_id_fingerprint_key (user_id, fingerprint) already provides this index. SKIP.
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ssh_public_keys_user_fingerprint
--     ON ssh_public_keys (user_id, fingerprint);

-- B4. ssh_public_keys(user_id, created_at DESC)  -- NOT RECOMMENDED (left commented out, review 2026-11-18)
--     Query: GET ssh_public_keys?user_id=eq.<sub>&order=created_at.desc  (list_user_ssh_keys; Node workspace)
--     Why skipped: B3 already serves "user_id = ?" (same leading column) and a user has only a handful of
--     SSH keys, so sorting them costs ~nothing; a second index would only add write overhead.
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ssh_public_keys_user_created
--     ON ssh_public_keys (user_id, created_at DESC);

-- B5. notebook_sessions(user_id, created_at DESC)
--     Query: GET notebook_sessions?user_id=eq.<sub>&order=created_at.desc[&status=neq.terminated]
--            (supabase_notebooks.list_user_notebooks; the list has no LIMIT, so this matters as rows grow)
-- PRODUCTION CHECK 2026-11-18 (read-only inspection): already exists in production with this exact definition. SKIP.
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notebook_sessions_user_created
--     ON notebook_sessions (user_id, created_at DESC);

-- B6. inference_requests(user_id, created_at DESC)
--     Query: GET inference_requests?user_id=eq.<sub>&order=created_at.desc  (telemetry listing; Node workspace)
--     Note:  this table gains one row per inference (write-heavy); a single composite index is the minimum.
-- PRODUCTION CHECK 2026-11-18 (read-only inspection): exists as idx_inference_requests_user_date (user_id, created_at DESC); creating this would duplicate it. SKIP.
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_inference_requests_user_created
--     ON inference_requests (user_id, created_at DESC);

-- B7. organization_members(user_id, status)
--     Query: organization_members.eq('user_id', sub).eq('status', 'active')
--            (backend/api/supabaseApi.js getCustomerContext: EVERY /api/customer/* request)
-- PRODUCTION CHECK 2026-11-18 (read-only inspection): covered by existing idx_org_members_user (user_id); a user has very few memberships. SKIP.
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_organization_members_user_status
--     ON organization_members (user_id, status);

-- B8. user_access_policies(user_id)
--     Query: user_access_policies.in('user_id', [...]) and .eq('user_id', id)  (admin user list / updates)
-- PRODUCTION CHECK 2026-11-18 (read-only inspection): exists as idx_access_policies_user (user_id). SKIP.
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_access_policies_user
--     ON user_access_policies (user_id);

-- B9. saved_gpu_listings(user_id)  -- REDUNDANT (confirmed in production: UNIQUE saved_gpu_listings_user_id_listing_id_key)
--     Query: saved_gpu_listings.eq('user_id', sub)  (customer workspace)
--     Why skipped: supabaseApi.js upserts with onConflict 'user_id,listing_id', which PostgREST only
--     accepts when a UNIQUE (user_id, listing_id) constraint exists; its index already leads with user_id.
--     Section A should show that constraint; add B9 only if it does not exist.
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_saved_gpu_listings_user
--     ON saved_gpu_listings (user_id);

-- ── C. Validity check after each statement (every row must show indisvalid = t) ────────────────
SELECT c.relname AS index_name, i.indisvalid, i.indisready
FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
WHERE c.relname IN ('uq_api_keys_secret_hash', 'idx_api_keys_user_created',
                    'idx_ssh_public_keys_user_fingerprint',
                    'idx_notebook_sessions_user_created', 'idx_inference_requests_user_created',
                    'idx_organization_members_user_status', 'idx_user_access_policies_user');
