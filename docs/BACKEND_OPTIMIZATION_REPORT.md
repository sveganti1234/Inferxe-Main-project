# Backend optimization report — 2026-11-27

> **Commit status:** B6, B6b (`backend/database/customerDatabase.js`) and the session-registry cap from the earlier pass (`backend/database/supabaseCustomerService.js`), with their tests, are implemented in the working tree but **held out of the commits** until Jyotirmayee confirms ownership and approves them.

This is for the Inferxe team. It covers the Node and FastAPI backend code in your ownership. Teammate-owned modules (`backend/notifications/`, `backend/gpu_health/`, `backend/rag/`, SSH and notebooks) were inspected only; see the handoffs at the end.

## Changes implemented

| # | Problem | Fix | Files | Test |
|---|---|---|---|---|
| B1 | **Admin lockout behind the proxy.** Failed logins were keyed on `req.socket.remoteAddress`, which behind Render's proxy is the same for everyone, so 20 wrong guesses at any admin account locked **every** admin out for 15 minutes. | The key is now client address plus email. Guessing at one account is still limited exactly as before; other admins can still sign in. | `backend/auth/adminAuth.js` | `admin-login-hardening.test.mjs`: new test with a shared proxy address |
| B2 | **Orders could link another customer's deployment.** `deployment_id` came from the request body; the foreign key only proves the deployment exists. An unparseable `order_date` made the insert fail with 503. | The deployment must belong to the caller (404 otherwise), and an invalid `order_date` falls back to now. | `backend/api/supabaseApi.js` | new `tests/customerOrders.test.mjs` (3) |
| B3 | **Permissions loaded twice per admin request.** The session check loads the role's permissions, then the permission check loaded them again. | The already-loaded permissions are passed through. | `backend/auth/adminSessionStore.js`, `adminAuth.js` | new `tests/adminPermissionReuse.test.mjs` |
| B4 | **Each permission lookup was a failed round trip.** The production database has **no `admin_role_permissions` table** (PostgREST `PGRST205`), so every lookup failed before falling back to the in-code registry. | Per-process, per-client cache of each role's permissions for 60 s. Sessions, revocation, active flag and role are still checked against the database on every request. | `backend/auth/adminSessionStore.js` | same file: cache, copy, TTL expiry, per-client isolation |
| B5 | **New HTTP connection per profile-status check** in the inference service. | One pooled client, following the pattern already used in `inference/routes.py`. | `backend/inference/auth.py` | new `inference/tests/test_profile_status_client.py` (reuse, suspended gives 403, lookup failure gives 503) |
| B6 | **Intermittent "database is locked"**, seen 3 times in full test runs. `PRAGMA busy_timeout` was set *after* `PRAGMA journal_mode = WAL`; the WAL switch takes a lock, so a second process opening the file at the same moment failed immediately. This affects parallel test files, and dev servers sharing the file. | `busy_timeout` is set first. | `backend/database/customerDatabase.js` | new `tests/sqliteConcurrentOpen.test.mjs`: 8 processes × 3 rounds. **It fails 3 of 3 times with the old order and passes with the fix.** |
| B7 | **`/healthz` always answered 200**, even with both Python workers down; its `running` flag only meant the process was spawned. | `/healthz` now connects to both worker ports, answering 200 only when both accept, otherwise 503 with per-worker `reachable`. | `backend/scripts/render-gateway.mjs`, new `backend/scripts/workerProbe.mjs` | new `tests/workerProbe.test.mjs` |

API contracts are unchanged, apart from B2 rejecting a foreign `deployment_id` (404) and B7 answering 503 when workers are down. No new dependencies.

## Measurements

Taken from this machine to the production Supabase project, 10 runs each, read-only requests about a user ID that doesn't exist. Latency from Render will differ.

| Measurement | Before | After |
|---|---|---|
| Profile-status check (B5) | median **412 ms** (min 307, max 944), new client each time | median **215 ms** (min 197, max 453), shared client |
| Failed `admin_role_permissions` lookup (B3, B4) | median **302 ms** (min 207, max 515), made **twice** per admin-role request | made once per role per 60 s per process |
| Parallel SQLite opens (B6), 80 opens as 10 rounds × 8 processes | **5 failures** ("database is locked") | **0 failures** |
| Admin login under 10 concurrent attempts (2026-11-26, async Argon2) | event loop stalled 1.7–1.8 s | 11–12 ms |

**Not measured:**
- API throughput under load, CPU and memory.
- Running the services locally loads the real `.env`, and the notifications worker runs startup migrations against the production database, so no load test was run. A staging database would be needed.

## Authentication and security review (your scope)

- **Admin session token in the login response:** **kept.** The Python services authenticate only with `Authorization: Bearer` (`backend/notifications/auth.py:649-660`). The cookie (`HttpOnly; Path=/api; SameSite=Lax`) does reach them, because production is same-origin through the Vercel rewrite and the gateway forwards `Cookie` (`render-gateway.mjs:181-183`). But accepting it requires a change in `notifications/auth.py`, which is notifications-owned. The order of work:
  1. The notifications owner adds a cookie fallback that accepts admin HS256 sessions only.
  2. The same fallback is added to `inference/auth.py` if admin routes are added there.
  3. The frontend stops storing and sending the token.
  4. Then the token is removed from the JSON.
- **Customer isolation:** customer queries filter on the verified `sub`. The order fix (B2) closed the one cross-customer link found.
- **Rate limiting:** admin login now uses address plus email (B1). Guest chat rate limiting belongs to the chatbot owner.
- **Real client IP behind the proxy:** still not extracted. Picking the right `X-Forwarded-For` entry needs one diagnostic deploy to see what Vercel and Render actually send. Logging the header's shape is the proposed first step.

## Remaining risks in your scope

| Risk | State |
|---|---|
| Checkout is simulated and the customer sets the cost and status | Deferred: payments are out of scope |
| Admin audit log reads the whole table and filters in JavaScript; PostgREST caps at 1,000 rows | `audit_logs` has **113** rows (production, 2026-11-27), so not urgent. Moving the filters into SQL is the fix. |
| Superadmin overview reads whole tables (`admin_sessions` 90, `profiles` 186 rows) | Fine at the current size; switch to count queries before 1,000 rows |
| Gateway error `detail` echoes `err.code` and `err.message` | Low: internal codes only, no stack traces |
| Swagger `/docs` is public on Render | Low; disabling it could affect teammates who use it, so ask first |

## For module owners (inspected, not changed)

- **Notifications (Manya):**
  - `notifications/main.py:208-233`: the chat handler creates an **active** profile for any verified token. Return 403 instead; this is chatbot functionality hosted in this service.
  - Guest `/api/chat` has no rate limit.
  - `router.py:87-100`: the database-status endpoint shows the Postgres host.
  - `db.py:901, 902, 906`: re-creates three indexes at startup.
  - The admin cookie fallback (above).
  - Also: my **uncommitted** fail-closed fix in `notifications/auth.py`, with its test, needs Manya's review now that notifications is protected.
- **GPU Health (Sathwik):**
  - The router is mounted with a customer-only dependency (the uncommitted `inference/main.py:157`).
  - Synchronous SQLAlchemy in `async def` handlers.
  - History lost on Render (no `DATABASE_URL`).
- **RAG (Jyothi):**
  - `rag/server.py:377-383`: `conversation_history` has no length limit.
  - `GlobalBotCompanion.tsx:748`: listens for the wrong auth event name.
  - The Ollama fallback to `http://127.0.0.1:11434` will appear in CSP reports.

---

## Update — found while verifying the commit set (2026-11-27)

**B6b. Concurrent first start of the customer SQLite database.** Running the new concurrency test in a fresh checkout exposed a second, pre-existing race. `runMigrations` (`seedInitialAdmins`) and `seedInitialCustomersIfEmpty` check, then insert, without a transaction.
- **Failure:** two processes opening a fresh file at once could both insert the seed rows (`UNIQUE constraint failed: admin_users.email`), or fail upgrading a read to a write ("database is locked").
- **Fix:** both now run inside `BEGIN IMMEDIATE … COMMIT` (`withWriteLock` in `backend/database/customerDatabase.js`). The write lock is taken first, so other openers wait through `busy_timeout` and then find the work done.
- **Measured:** 1 of 160 and 1 of 320 parallel first opens failed before; 0 of 320 after, each database seeded exactly once.
- **Test:** `tests/sqliteConcurrentOpen.test.mjs` now runs 6 rounds × 8 processes and also rejects `UNIQUE constraint failed`.
- **Why it matters outside tests:** `npm run dev` starts the admin auth server and the Vite middleware together, and both load this module.
