# Inferxe final optimization report — 2026-11-27

> **Commit status (2026-11-27):** a few items in this report are implemented in the integration working tree but **held out of the commits**:
> - migration 013 is a proposal, **NOT APPLIED** and not committed;
> - the customer SQLite fixes (fixed items 6 and B6b) and the session-registry cap in `customerDatabase.js` and `supabaseCustomerService.js` wait for Jyotirmayee's ownership confirmation;
> - the files in `TEAMMATE_REVIEW_SUMMARY.md` wait for their owners.

This is for the Inferxe team and whoever approves production changes. It summarises the 2026-11-27 optimization pass. Details are in the four area reports (`FRONTEND_`, `BACKEND_`, `DATABASE_` and `INFRASTRUCTURE_OPTIMIZATION_REPORT.md`); earlier passes are in `OPTIMIZATION_AUDIT.md`, `OPTIMIZATION_REPORT.md`, `SECURITY_REVIEW.md` and `PRODUCTION_READINESS.md`.

## Overall health

**The core is sound:**
- Every public table has RLS, and anonymous and signed-in roles have no table grants.
- Admin sessions are checked against the database on every request.
- Customer queries are scoped to the verified user.
- Every main query runs in under 3 ms at today's data volume.
- All test suites pass.

**Inferxe is not production-ready**, for the specific reasons in "Production readiness" below, not because of the architecture.

## Findings this pass

| Category | Count |
|---|---:|
| Fixed and tested (code or config in your ownership) | **10** |
| Prepared and verified, awaiting approval | **5** |
| Remaining in your scope, documented with a plan | **10** |
| Handed off to module owners | **17** |

**Fixed:**
1. Admin lockout keyed on client address plus email, so one attacker can no longer lock out every admin.
2. Orders can link only the caller's own deployment, and a bad `order_date` no longer fails the insert.
3. The admin permission check reuses the permissions already loaded with the session.
4. A 60-second per-process permission cache: the production table is missing, so every lookup was a failed round trip.
5. One pooled HTTP client for profile-status checks.
6. The root cause of the intermittent "database is locked" (`busy_timeout` set before the WAL switch).
7. `/healthz` probes the Python workers.
8. Docker installs the **Node** dependencies with `npm ci` from `backend/package-lock.json`. The Python dependencies are still installed from the unpinned `requirements.txt`; `backend/requirements.lock` exists but the Dockerfile doesn't use it yet (that needs approval).
9. `.dockerignore` removes about 39 MB of non-runtime files.
10. The report-only CSP and Permissions-Policy merged onto the teammate's header commit `48d3f1b`.

**Prepared, not applied:**
1. Migration 013, revoking function EXECUTE from `anon`/`authenticated` (21 of 21 local checks pass).
2. Dropping duplicate index `idx_profiles_email` (two more need RAG sign-off).
3. Running the container as non-root.
4. Pinning Python dependencies.
5. Production GPU and demo settings in `render.yaml`.

**Remaining in scope:**
1. Keep Amplify out of the entry chunk.
2. `LazyMotion`.
3. Split the dashboard CSS out of public pages.
4. Delete the dead `MarketplaceWorkspace` branches.
5. Remove the admin token from the login JSON (once the Python services accept the cookie).
6. Real client IP behind the proxy.
7. Move the admin audit-log filters into SQL.
8. Count queries for the admin overview.
9. Indexes for 21 foreign keys (when tables grow).
10. A single Vercel config.

## Before and after measurements

| Measurement | Before | After | How measured |
|---|---|---|---|
| Profile-status check latency | median 412 ms | median **215 ms** | 10 read-only calls to production Supabase from this machine |
| Failed permission lookup per admin-role request | 2 × median 302 ms | once per role per 60 s per process | 10 calls; the table returns `PGRST205` |
| Parallel SQLite opens failing "database is locked" | 5 of 80 | **0 of 80** | 10 rounds × 8 processes |
| Node test suite intermittent failures | 2 failing files in the first run of this pass (same lock error) | 0 failures in 3 full runs | full suite |
| Docker build context (`backend/`, excluding `node_modules`) | about 35 MB | under 5 MB | `du` of the excluded paths (about 39 MB) |
| Admin login, 10 concurrent attempts: event-loop stall (2026-11-26) | 1.7–1.8 s | 11–12 ms | timer-lag benchmark |
| Main query patterns | — | 0.04–2.7 ms | `EXPLAIN ANALYZE` (read-only) |
| Frontend first load | 249,904 B gzip | 249,904 B gzip (unchanged) | production build |
| Frontend all JS | 2,240,735 B | 2,240,735 B (unchanged) | production build |

**Unavailable:**
- Lighthouse (not installed).
- Backend throughput, CPU and memory under load: needs a staging environment, because local services would run startup migrations against production.

## Test results

| Suite | Start of pass | End of pass | Change |
|---|---|---|---|
| Node backend | 158 pass, **2 fail** (SQLite lock flake), 13 skip | **175 pass, 0 fail, 13 skip** (3 runs) | +12 new tests, flake fixed |
| Inference, provider and GPU Health | 318 pass, 1 skip | **321 pass, 1 skip** | +3 new tests |
| Notifications | 240 pass, 17 skip | 240 pass, 17 skip | — |
| RAG | 27 pass | 27 pass | — |
| Frontend | 483 pass | 483 pass | — |
| TypeScript | pass | pass | |
| Production build | pass | pass | |
| Migration 013 (local PostgreSQL 18) | — | 21 of 21 | new |

No test was deleted or weakened. No teammate-owned test was modified in this pass.

## Files modified this pass

- **Backend code:**
  - `backend/auth/adminAuth.js`
  - `backend/auth/adminSessionStore.js`
  - `backend/api/supabaseApi.js`
  - `backend/inference/auth.py`
  - `backend/database/customerDatabase.js`
  - `backend/scripts/render-gateway.mjs`
  - new `backend/scripts/workerProbe.mjs`
- **Infrastructure:** `Dockerfile`, `.dockerignore`, `vercel.json`, `frontend/vercel.json`.
- **Database:** new `database/migrations/013_revoke_public_function_execute.sql` (not applied).
- **Tests:**
  - `backend/auth/tests/admin-login-hardening.test.mjs`
  - new `backend/tests/customerOrders.test.mjs`
  - new `backend/tests/adminPermissionReuse.test.mjs`
  - new `backend/tests/sqliteConcurrentOpen.test.mjs`
  - new `backend/tests/workerProbe.test.mjs`
  - new `backend/inference/tests/test_profile_status_client.py`
- **Docs:** the five new reports.

Uncommitted work from earlier passes is also still in the working tree (see `PRODUCTION_READINESS.md`), including changes now inside protected modules. These are listed for owner review under "Teammate handoffs".

## Teammate handoffs

| Owner | Items |
|---|---|
| **Notifications (Manya)** | (1) Chat handler creates active profiles (`notifications/main.py:208-233`). (2) No guest chat rate limit. (3) A cookie fallback for admin HS256 sessions in `auth.py`, needed before the admin token leaves the login JSON. (4) The DB-status endpoint shows the Postgres host. (5) `db.py:901, 902, 906` re-create indexes. (6) **Review my uncommitted fail-closed fix** in `notifications/auth.py` and its test (made before notifications was listed as protected). |
| **GPU Health (Sathwik)** | (7) The router is customer-only (uncommitted `inference/main.py:157`); add an admin or operator check. (8) History is lost on Render (`DATABASE_URL`). (9) Synchronous DB calls in async handlers. |
| **RAG (Jyothi)** | (10) Sign off on dropping `idx_doc_metadata_doc_id` and `idx_chat_history_user_id`. (11) `conversation_history` has no limit. (12) The chat assistant listens for the wrong auth event. (13) The Ollama fallback to `127.0.0.1` will appear in CSP reports. |
| **UI/UX (Sahith)** | (14) About 4.2 MB of unused files in `frontend/public`. (15) The admin header search pulls 73 KB of map SVG. (16) The global `html`/`body` rules in `dashboard-extra.css` block the CSS split. Also: back/forward presence (`CustomerHeartbeat.tsx`, authored by Jyothi), the Playground double fetch, and **review of my earlier logic-only edits** to `CheckoutPage`, `ProfilePage`, `ApiKeysPage`, `DashboardLayout` and `AdminShell`. |
| **SSH (Diya)** | (17) **Review my earlier, approved changes** to `SshKeysPage.tsx` and its test (no demo keys; backend-confirmed add and delete). |
| **Jupyter (Shivraj)** | Nothing found that needs action. |

## Outstanding approvals

1. **Migration 013** (function grants): run on production.
2. **Drop `idx_profiles_email`**, plus the two RAG indexes after RAG sign-off.
3. **`render.yaml`:** `INFERXE_ENV=production`, `GPU_PROVIDERS=""` (instead of `mock`), `INFERENCE_DEMO_MODE=false`, and the gateway default `'false'`.
4. **Non-root container,** after a Render preview build.
5. **Pinned Python requirements,** generated on Linux.
6. **Deferred by you:** `ALLOW_VERCEL_PREVIEW_ORIGINS`, real payments, real GPU providers.
7. **The earlier uncommitted changes inside now-protected modules:** keep them for owner review, or hand them over.

## Production readiness

**Not ready.** The blockers:
1. Checkout simulates payment, and the customer sets the cost (payments deferred).
2. Production offers simulated GPUs (`GPU_PROVIDERS=mock`) with demo inference enabled (approval 3).
3. The chat handler creates active customer profiles (Notifications/chatbot).
4. GPU Health is open to every signed-in customer and loses history on restart (GPU Health).
5. The admin session token is still in the login response (multi-step; the notifications owner goes first).

**Still required before release:**
- Signed-in browser testing in both themes, watching the console for CSP `[Report Only]` lines.
- Watching the first Render build after the Docker changes.
- Confirming which Vercel config is active.

## Git

- `development` is synced with `origin/development` (0 ahead, 0 behind) after a safe fast-forward over `48d3f1b`.
- 5 stashes intact; nothing staged, committed or pushed; nothing deployed.
- All 17 original teammate and local files are byte-identical to the backup.
- No protected module was changed in this pass, and no secrets were added.
