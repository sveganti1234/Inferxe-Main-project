# Database optimization report — 2026-11-27

> **Migration 013 is a proposal: NOT APPLIED to any database, and not committed.** It is kept in the integration working tree until its plan is approved.

This is for the Inferxe team and whoever approves production database changes. All production checks were **read-only**: the session ran with `default_transaction_read_only = on`, and only catalog queries, statistics and `EXPLAIN ANALYZE` of `SELECT` statements were executed. No production change was made. The scripts are in the session scratchpad: `prod/db_readonly_audit.py`, plus the migration test `migtest/test_013.sh`.

PostgreSQL 17.11 on Supabase. Statistics have accumulated since 2026-10-29.

## Data volume (live rows)

| Table | Rows |
|---|---:|
| `wallet_transactions` | 250 |
| `users` | 192 |
| `profiles` | 186 |
| `notification_outbox` | 163 |
| `notifications` | 149 |
| `wallets` | 131 |
| `audit_logs` | 113 |
| `admin_sessions` | 90 |
| `chat_history` | 59 |

Every other table has fewer than 15 rows. Sequential scans on tiny tables (`admin_users` 21,584, `admin_sessions` 13,699) are the planner's correct choice at this size, not a problem.

## Query analysis (`EXPLAIN (ANALYZE, BUFFERS)`)

| Pattern | Plan | Execution |
|---|---|---|
| Workspace orders, newest first, one customer | Index Scan `idx_orders_user_date` | 2.7 ms |
| Workspace wallet transactions, newest first | Index Scan `idx_wallet_tx_user_id`, then sort | 2.6 ms |
| Workspace notifications, newest first | Bitmap Index Scan `idx_notifications_is_read` | 1.9 ms |
| Deployments for one customer | Seq Scan (5 rows) | 0.1 ms |
| Admin audit log, whole table | Seq Scan (113 rows) | 0.1 ms |
| Admin overview profiles | Seq Scan (184 rows) | 2.2 ms |
| Inference requests, last 90 days, one customer | Index Scan `idx_inference_requests_user_date` | 0.04 ms |

Every pattern runs in **under 3 ms**; there are no slow queries today.
- **`pg_stat_statements`:** the slowest entries are one-off migration statements (≤ 41 ms). Reading further failed on a text-encoding error in a stored statement, so the list is partial.
- **N+1 patterns:** the earlier audit found them in the code (S13, provider sync per deployment), not in the database.

## Index analysis: the eight candidates

Fresh statistics overturn the 2026-11-18 view: most candidates are **actively used**, because the planner prefers the narrower index.

| Index | Table, columns | Scans now | Covered by (scans) | Re-created at startup? | Owner | Recommendation |
|---|---|---:|---|---|---|---|
| `idx_profiles_email` | profiles (email) | 147 | `profiles_email_key` UNIQUE (0) | no | you | **Remove**: exact duplicate of the unique index, which then serves the same lookups |
| `idx_doc_metadata_doc_id` | document_metadata (document_id) | 0 | `document_metadata_document_id_key` UNIQUE (10) | no | **RAG** | **Remove after RAG sign-off**: exact duplicate, unused |
| `idx_chat_history_user_id` | chat_history (user_id) | 0 | `idx_chat_history_user_session` (210) | no | **RAG** | **Remove after RAG sign-off**: prefix, unused |
| `idx_wallet_tx_user_id` | wallet_transactions (user_id) | 1,530 | `idx_wallet_tx_user_date` (143) | **yes**, `notifications/db.py:906` | **Notifications** | Retain for now; removable only with the `db.py` line |
| `idx_notifications_user_id` | notifications (user_id) | 1,125 | `idx_notifications_user_created` (2) | **yes**, `db.py:901` | **Notifications** | Retain for now |
| `idx_notifications_is_read` | notifications (user_id, is_read) | 1,277 | `idx_notifications_user_read` (2) | **yes**, `db.py:902` | **Notifications** | Retain for now |
| `idx_deployments_user` | deployments (user_id) | 565 | `deployments_user_created_idx` (0) | no | you | Retain for now: logically redundant, but serving queries; drop once 012's index is in use |
| `idx_deployments_status` | deployments (status) | **16** (was 0) | none | no | you | **Retain**: it is not redundant and is now used |

The write overhead of all eight is negligible at these sizes (16 kB each). The benefit of removing them is small, so only the clear duplicates are proposed.

**Proposed SQL** (needs approval; each statement on its own, outside a transaction):

```sql
-- pre-check: scans must still be as above and the covering indexes valid
SELECT indexrelname, idx_scan FROM pg_stat_user_indexes
WHERE indexrelname IN ('idx_profiles_email','idx_doc_metadata_doc_id','idx_chat_history_user_id');
DROP INDEX CONCURRENTLY IF EXISTS public.idx_profiles_email;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_doc_metadata_doc_id;    -- after RAG owner approval
DROP INDEX CONCURRENTLY IF EXISTS public.idx_chat_history_user_id;   -- after RAG owner approval
```

**Rollback:**

```sql
CREATE INDEX CONCURRENTLY idx_profiles_email ON public.profiles (email);
CREATE INDEX CONCURRENTLY idx_doc_metadata_doc_id ON public.document_metadata (document_id);
CREATE INDEX CONCURRENTLY idx_chat_history_user_id ON public.chat_history (user_id);
```

**Other unused indexes (0 scans):** 27 in total, mostly on empty or new tables (`gpu_health_history`, `notebook_instances`, `ssh_keys`, `inferxe_notifications`). They are not worth touching until those features carry data.

**Foreign keys without a supporting index:** 21. They only matter for deletes and updates of parent rows, and every parent table here is tiny. Revisit when `orders`, `usage_records` and `inference_requests` grow.

## RLS and permission review

| Check | Result |
|---|---|
| RLS enabled | **35 of 35** public tables |
| `anon` table grants (SELECT/INSERT) | **none** |
| `authenticated` table grants | **none** |
| SECURITY DEFINER functions | 1 (`sync_customer_profile`): `search_path` set, executable only by `service_role` and `postgres` ✓ |
| Functions executable by `anon`/`authenticated` | **3:** `admin_set_customer_plan`, `bump_admin_session_version`, `set_updated_at` |
| Default privileges (`postgres`, schema `public`) | new **functions** are granted EXECUTE, and new **sequences** USAGE/SELECT/UPDATE, to `anon` and `authenticated` |
| Policies | 6 tables have one policy each (all for `service_role`, which bypasses RLS anyway: harmless) |
| Triggers | `set_updated_at` on 11 tables; `admin_users_update_session_version` |

**Finding DB-1 (Medium, defense in depth).** Migration 005 revoked `admin_set_customer_plan` from `anon`/`authenticated`, but production still grants it (ACL `anon=X, authenticated=X`). Exploitability is low: the function runs with the caller's own privileges (SECURITY INVOKER), and `anon` has no table access, so a PostgREST `/rpc` call cannot write. The default privileges would also expose every future function.

**Proposed migration: `database/migrations/013_revoke_public_function_execute.sql`** (written, **not applied**):
- revokes EXECUTE on the three functions from `PUBLIC`, `anon` and `authenticated`, and keeps it for `service_role`;
- removes the per-schema default grants on functions and sequences for `anon`/`authenticated`;
- includes pre-checks, verification queries and an exact rollback.

**Local test** (PostgreSQL 18 scratch cluster, with production's ACLs reproduced): **21 of 21 checks pass**:
- `anon` and `authenticated` lose EXECUTE; `service_role` keeps it;
- an `anon` RPC call is refused, while a `service_role` call works;
- both triggers still fire;
- new functions and sequences are no longer granted;
- running it twice is safe, and the rollback restores production's exact ACLs.

Anonymous REST access was not tested from outside: no anon key is configured locally. The catalog check (no table grants for `anon`) is the evidence.

## Storage review

Checked read-only on 2026-11-26; snapshot in `C:\Users\anjana\inferxe-backups\bucket-settings-20261126.json`.

| Bucket | Public | Size limit | Allowed types |
|---|---|---|---|
| `profile-avatars` | no | 2 MiB | PNG, JPEG, WebP ✓ (already as proposed; 0 files) |
| `notebook-files` | no | 50 MiB | text, csv, json, pdf, zip |
| `inference-outputs` | no | 100 MiB | text, csv, json, pdf, octet-stream |
| `model-artifacts` | no | 1 GiB | octet-stream, zip, json |

No change is needed; the other three buckets were not touched.

## Connection usage

- **Python:** the notifications service uses a bounded psycopg2 pool; the inference service now reuses one HTTP client for profile checks (backend B5).
- **Node:** uses one Supabase admin client.
- **Pagination:** the workspace history is capped and ordered newest first (2026-11-26). The admin audit log and overview still read whole tables, which is fine below 1,000 rows (backend report).

## Approvals needed

1. Migration 013 (function grants): ready, tested locally.
2. Dropping `idx_profiles_email`.
3. The RAG owner's sign-off for `idx_doc_metadata_doc_id` and `idx_chat_history_user_id`.
4. The notifications owner, if the three re-created indexes should ever go (with the `db.py` lines).

---

## Update — follow-up review (2026-11-27, later)

**Migration 013, final plan (not applied):**
- **Fresh read-only check:**
  - The three functions still grant EXECUTE to `anon`/`authenticated` (`set_updated_at` also to `PUBLIC`).
  - The only application caller is `backend/api/adminCustomersApi.js:234` (`supabase.rpc('admin_set_customer_plan', …)` with the **service-role** client), which keeps EXECUTE.
  - Dependents: 12 triggers (11 × `set_updated_at`, 1 × `admin_users_update_session_version`), and no views or functions.
- **Added:** `ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC` (global). This closes PostgreSQL's built-in "PUBLIC may execute new functions" for functions `postgres` creates in any schema; the earlier note copied from 011 said it couldn't be done, which was wrong. Rollback line added.
- **Deliberately not changed:** the `storage` schema defaults (Supabase Storage relies on them) and functions created by other roles.
- **Local test, now 25 of 25 checks:** new functions in `public` and in another schema are closed to `PUBLIC`, and the rollback restores the global default.
- **Pre-check, change, verification and rollback** are all inside `database/migrations/013_revoke_public_function_execute.sql` (sections A–E).

**`idx_profiles_email`, final evidence:**
- It backs no constraint (`pg_constraint.conindid`), and nothing depends on it.
- Its 147 scans come from equality lookups (`supabaseApi.js:737 .eq('email', …)`, and the `email.eq.` term in `supabaseCustomerService.js:910`).
- **Local planner test** (5,000 rows, same two indexes): after dropping it, `WHERE email = …` uses `profiles_email_key`, the OR-filter uses a BitmapOr over `profiles_pkey` and `profiles_email_key`, and the UNIQUE constraint still rejects duplicates.
- **Recommendation:** drop it after approval, with `DROP INDEX CONCURRENTLY IF EXISTS public.idx_profiles_email;`, outside a transaction. Rollback: `CREATE INDEX CONCURRENTLY idx_profiles_email ON public.profiles (email);`.
- **The RAG indexes stay untouched** pending Jyothi; no other index is proposed.
