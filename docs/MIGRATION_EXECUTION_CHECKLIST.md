# Migration execution checklist: 009 → 012

This checklist is for whoever approves and applies migrations to the shared Supabase project. Run every step in the Supabase SQL editor (or psql) as `postgres`, one migration at a time, and save the output of each read-only check.

> **Update, 2026-11-26:** applied to the shared project on the user's authorization: 009, 010 (after its `authenticated` grant was removed), 011 and 012, plus `backend/sql/001_make_profile_avatars_private.sql`. Each step was verified before the next. 012 section D was not run. The backup and step-by-step log are in `C:\Users\anjana\inferxe-backups\pre-migrations-20261126\` on the machine that applied them. The rest of this document describes the state before that and stays useful for other environments and for rollback.

## State before applying (read-only checks, 2026-11-26)

| Migration | In the shared database? | How it was checked |
|---|---|---|
| 004 `deployments.currency` | **Applied** | REST select of `currency`: HTTP 200 |
| 009 provider-instance columns | **Not applied** | REST select of `provider_id`, `idempotency_key`: error 42703 (column missing) |
| 010 `gpu_health_history` | **Table exists, migration status unknown** | REST select: HTTP 200. The GPU health service creates this table itself (SQLAlchemy `create_all`) when `DATABASE_URL` points at Supabase, so it may have **no RLS and full `anon` grants**. See P3. |
| 011 RLS on 21 tables | Not applied (per the 2026-11-25 preflight) | — |
| 012 deployments index | Not applied | — |

**Why 009 is urgent:** the deployment API (`/api/v1/gpu/deployments`) already selects 009's columns. Until 009 is applied, the customer Deployments page receives HTTP 502 for every request.

## Order and dependencies

1. **004** is already applied. Skip it.
2. **009** needs 004 (`currency`). Runs in its own transaction.
3. **010** has no dependency. Its `CREATE TABLE IF NOT EXISTS` skips the existing table; its RLS, revoke and index statements still apply. Owned by the GPU health teammate; get their sign-off.
4. **011** has no dependency on 009 or 010 (both also lock down tables; running more than one is harmless). Runs in one transaction with `lock_timeout = 5s`.
5. **012** has no dependency. Must run **on its own, outside a transaction** (`CREATE INDEX CONCURRENTLY`).

All five files are safe to re-run. Locally tested on PostgreSQL 18 (production is 17):
- 009 → 010 → 011 → 012, then the same chain a second time: 23 of 23 checks.
- 011 alone: 43 of 43.
- Deployment lifecycle against the migrated schema: 16 of 16.

## Preflight (read-only; save every output)

**P1. Deployment statuses fit 009's new check.** Every status must be one of `provisioning, running, stopped, completed, failed, cancelled, terminated`:
```sql
SELECT status, count(*) FROM public.deployments GROUP BY status;
```

**P2. No duplicate instance ids** (009 adds unique indexes):
```sql
SELECT provider_instance_id, count(*) FROM public.deployments
WHERE provider_instance_id IS NOT NULL GROUP BY 1 HAVING count(*) > 1;   -- expect 0 rows
```

**P3. `gpu_health_history` exposure and shape:**
```sql
SELECT relrowsecurity, pg_get_userbyid(relowner),
       has_table_privilege('anon', oid, 'SELECT'), has_table_privilege('anon', oid, 'INSERT')
FROM pg_class WHERE oid = 'public.gpu_health_history'::regclass;
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'gpu_health_history' ORDER BY ordinal_position;
```
- If RLS is off and anon has privileges, the table is open to anyone holding the public anon key. Applying 010 closes it.
- The column names must include `gpu_id`, `health_status` and `created_at`; 010's indexes use them.

**P4. Migration 011's checks:** run A1–A6 from the top of `011_reenable_rls_backend_tables.sql`. Expected results are listed beside each check.

**P5. Migration 012's checks:** run section A of `012_deployments_access_indexes.sql`.

## Execute

| Step | Run | Verify immediately |
|---|---|---|
| 1 | `009_deployment_provider_instances.sql` | Its validation block: 7 new columns, status check includes `terminated`, RLS on, `has_table_privilege('anon', 'public.deployments', 'SELECT') = false` |
| 2 | `010_gpu_health_history.sql` | RLS on, anon has no privilege on `gpu_health_history` |
| 3 | `011_reenable_rls_backend_tables.sql` | Section C of the file; A2–A5 again, compared with the preflight output |
| 4 | `012_deployments_access_indexes.sql`, **alone** | Section C: `indisvalid = true`; EXPLAIN uses `deployments_user_created_idx` |
| 5 (optional) | Section D of 012: drop `idx_deployments_user` and `idx_deployments_status` | Only if `pg_stat_user_indexes` still shows `idx_deployments_status` unused |

## After applying: application smoke test

Signed in as a real test customer, then as an admin:
- customer dashboard loads;
- Deployments page loads with no 502 (it shows only deployments created through the new API; the 4 old rows without `provider_id` stay hidden);
- the profile updates;
- admin sign-in and the Super Admin overview work;
- Admin → Customers shows the customer's deployments.

## Rollback (newest first; only if an application breaks)

- **012:** `DROP INDEX CONCURRENTLY IF EXISTS public.deployments_user_created_idx;` If step 5 ran, recreate the two indexes using the lines in section D.
- **011:** section D of the file. It restores the earlier exposure, so use it only to the state saved in P4.
- **010:** **do not drop the table.** It existed before 010 and holds data. Restore only the privileges recorded in P3. Leaving the lockdown in place is the safer choice.
- **009:** the commented rollback at the end of the file. Its old status check **fails if any `terminated` rows exist**; set those rows to `cancelled` first, with approval, because that changes data. The RLS lockdown is intentionally not rolled back.

## Known limitation (011)

PostgreSQL gives PUBLIC the right to execute new functions through a built-in **global** default, which a per-schema revoke cannot remove. Rule for all future migrations: every `CREATE FUNCTION` is followed by `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated`. Migrations 005 and 011 already do this.
