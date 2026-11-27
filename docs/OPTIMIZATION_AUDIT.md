# Inferxe optimization audit — 2026-11-26

This is for the Inferxe engineering team: the audit of `development` at `9b789ca`. Every finding was read in the code and confirmed with file and line evidence before it was listed here. Findings marked **Fixed** were changed in the working tree; see `OPTIMIZATION_REPORT.md`. Findings marked **Owner** are in modules owned by other teammates and were left unchanged.

**Severity**:
- **Critical**: exploitable now, or loses data now.
- **High**: a real user-facing bug or security gap.
- **Medium**: wrong at scale, or under abuse.
- **Low**: maintenance or polish.

## Summary

| Area | Found | Fixed | Remaining | Owner |
|---|---:|---:|---:|---:|
| Backend and security | 22 | 5 | 14 | 3 |
| Database | 5 | 1 | 4 | 0 |
| Frontend | 16 | 6 | 9 | 1 |
| Performance (bundle) | 2 | 0 | 2 | 0 |
| Infrastructure | 6 | 0 | 5 | 1 |
| Tests | 2 | 0 | 2 | 0 |
| Teammate modules (extra) | 3 | 0 | 0 | 3 |
| **Total** | **56** | **12** | **36** | **8** |

No Critical findings.

## Backend and security

| ID | Severity | Finding | Evidence | Status / recommendation |
|---|---|---|---|---|
| S1 | High | The chat endpoint creates an **active** profile for any verified Cognito token that has no profile row. This bypasses Node's `syncProfile` checks (verified email, conflict 409) and undoes the "no invented profiles" rule. | `backend/notifications/main.py:208-233` | **Owner** (chatbot). Remove the auto-insert and return 403 "profile not synchronized", as Node does. |
| S2 | Medium-High | The account-status check failed open: with no DSN set, a Supabase error or a missing client allowed the request, so suspended customers could still debit wallets and chat. | `backend/notifications/auth.py:621-634` | **Fixed**. It now returns 503 (fail closed), and a test was added. |
| S3 | Medium | The admin login rate limit is keyed on `req.socket.remoteAddress`, which is the proxy's address behind Vercel and Render. Twenty bad attempts from anyone lock out every admin for 15 minutes. | `backend/auth/adminAuth.js:702, 1884` | Remaining. Key on the client IP from the trusted proxy header, plus the email. This needs the real proxy chain confirmed: Vercel overwrites `X-Forwarded-For`, and Render appends to it. |
| S4 | High (availability) | Admin password verification ran synchronous Argon2id (64 MiB, t=3), blocking the gateway's Node process for **about 168 ms per attempt (measured)**. | `backend/auth/adminPassword.js:212`, `adminAuth.js:1923` | **Fixed**. Login now uses async `crypto.argon2`; see the report for measurements. |
| S5 | Low | Admin login returns `ADMIN_INACTIVE` before checking the password. Since `isAdmin: true/false` already reveals whether an admin email exists, only the deactivated flag leaks. | `adminAuth.js:1893-1921` | Remaining. Check the password first. |
| S6 | Medium | The in-memory customer session registry was never cleaned, except by a test, and `session_id` is chosen by the client. A heartbeat loop with fresh ids grows it without limit. | `backend/database/supabaseCustomerService.js:29-46, 109` | **Fixed**. Hourly cleanup, and a cap of 20 sessions per customer; a test was added. |
| S7 | Medium | Every token with an unknown `kid` forced a fresh fetch of Cognito's signing keys. Issuer and audience are public, so forged tokens reach that lookup. | `backend/auth/cognitoIdToken.js:77-99` | **Fixed**. Refetch at most once a minute; a test was added. |
| S8 | Medium | The inference prompt has no size limit at the schema, the gateway or uvicorn. | `backend/inference/schemas.py:17-21` | Remaining. This is an API-contract decision: add `max_length` (for example 32,000 characters) once agreed. |
| S9 | Medium | Admin views read whole tables: `getAdminUsers` (every profile plus all `inference_requests`), the superadmin overview (all `admin_sessions`, `audit_logs` and `profiles`), and key governance. PostgREST silently caps results at 1,000 rows, so counts become wrong past that. `listAdminAuditLogs` computes `safeLimit`/`safeOffset` but never applies them. | `backend/api/supabaseApi.js:307-362`, `backend/auth/adminSessionStore.js:1497-1500, 1876-1932`, `keyGovernanceService.js:123-131` | Remaining. Use `count: 'exact', head: true` for counts and `.range()` for lists. Audit-log filtering on derived severity happens in JavaScript, so it must move to SQL first. |
| S10 | Medium-Low | The customer workspace read `deployments`, `orders`, `wallet_transactions`, `notifications` and `notebook_sessions` with no order and no limit. Past 1,000 rows it returned an arbitrary subset. | `backend/api/supabaseApi.js:124, 187-199` | **Fixed**. These are now read newest first with an explicit 1,000-row cap. Results are identical below 1,000 rows. |
| S11 | Medium | The gateway gives any `https://*.vercel.app` origin, and any localhost origin, credentialed CORS in production (`ALLOW_VERCEL_PREVIEW_ORIGINS: "true"`). The impact is limited today because of Bearer tokens and the SameSite=Lax cookie. | `backend/scripts/render-gateway.mjs:39-71`, `render.yaml:29` | Remaining, **needs approval** (production configuration). Set the flag to false and allow localhost only outside production. |
| S12 | Low | A new `httpx2.Client` (a new TLS connection) is created for each uncached profile-status check. | `backend/inference/auth.py:139-148` | Remaining. Reuse the pooled client. |
| S13 | Low | The deployment list makes one sequential provider call and PATCH per provisioning row, and creates a new event loop each time. | `backend/inference/gpu_deployment_service.py:93-100, 211-214` | Remaining. Cap the rows synced per call, or run them concurrently. |
| S14 | Low | Internal error text reaches clients: `'...: ' + err.message` in admin routes, and `detail: err.message` in the gateway proxy. | `adminAuth.js:1647-1794`, `render-gateway.mjs:226` | Remaining. Log the detail and return a generic message. |
| S15 | Low | Chat history and session `limit` have no upper bound. | `backend/notifications/main.py:292, 350` → `supabase_client.py:548, 576` | **Owner** (chatbot, RAG). Use `Query(50, ge=1, le=200)`. |
| S16 | Low | The unauthenticated database-status endpoint reveals the Postgres host. | `backend/notifications/router.py:87-100` | Remaining. Drop `host`. |
| S17 | Low | Admin permissions are loaded twice per admin request, making three sequential DB round trips. | `adminSessionStore.js:85-91, 785` | Remaining. Pass the loaded permissions through. |
| S18 | Medium | There are no security headers (CSP, X-Frame-Options, HSTS, nosniff) in `vercel.json` or the gateway. The admin login response returns the session `token` in JSON as well as in the HttpOnly cookie, and the customer ID token lives in localStorage. | `vercel.json`, `frontend/vercel.json`, `adminAuth.js:2014-2018`, `frontend/src/lib/authStore.ts:280` | Remaining, **needs approval** (deployment configuration, plus a frontend change to stop reading the token). |
| S19 | Medium | Guest `/api/chat` has no rate limit and spends paid LLM calls. | `backend/notifications/main.py:174-178` | **Owner** (chatbot). Add a per-IP token bucket for guests. |
| S20 | Medium | Signed upload URLs carry no content-type or size limit; no bucket `file_size_limit` or `allowed_mime_types` is set. | `backend/api/supabaseApi.js:645-660` | **Resolved in production (checked 2026-11-26).** All four buckets are private, with a size limit and a type allowlist. `profile-avatars` allows 2 MiB of PNG, JPEG or WebP (set 2026-11-05). The finding came from the repo alone; the settings snapshot is in `inferxe-backups/bucket-settings-20261126.json`. |
| S21 | Low | `httpx2>=2.16.0` is unpinned. It is published under the pydantic GitHub organisation by httpx's author, so it is legitimate, but a new release installs automatically on deploy. | `backend/requirements.txt:7` | Remaining. Pin it, along with the rest of the requirements (see I2). |
| S22 | Low | Swagger `/docs` and `/redoc` are publicly proxied. | `render-gateway.mjs:236-242` | Remaining. Disable them when `NODE_ENV=production`. |

## Database

| ID | Severity | Finding | Evidence | Status / recommendation |
|---|---|---|---|---|
| D1 | High | Order numbers collide. Checkout generated `ORD-8500…9399` (**900 values**) and the server default `ORD-1000…9999` (9,000), against a UNIQUE `order_number`. A collision becomes likely after about 35 orders and returns a generic 503. | `frontend/src/features/customer/pages/CheckoutPage.tsx:124`, `backend/api/supabaseApi.js:459-461` | **Fixed**. Both now use 8 random hex characters (about 4.3 billion values). |
| D2 | Medium | Customers set their own order `total_cost`, `status` and `order_date`, and a `deployment_id` that is not checked for ownership. | `supabaseApi.js:471-492` | Remaining. Check the deployment belongs to the caller and set the cost on the server. This is tied to checkout being a simulated payment (see `PRODUCTION_READINESS.md`). |
| D3 | Low | Indexes that are probably no longer needed are still in production. Seven are covered by a longer or unique index, per the 2026-11-18 database audit: `idx_doc_metadata_doc_id`, `idx_profiles_email`, `idx_chat_history_user_id`, `idx_notifications_user_id`, `idx_notifications_is_read`, `idx_wallet_tx_user_id` and `idx_deployments_user`. The eighth, `idx_deployments_status`, is not covered by another index; it is only unused (0 scans). The notifications service **re-creates three of them at startup** (`backend/notifications/db.py:901, 902, 906`). | `INFERXE_SUPABASE_DATABASE_AUDIT.md:1092-1114`, 012 section D | Remaining, **needs approval**. The exact change, pre-checks and rollback are in `PRODUCTION_READINESS.md`, "Pending approvals". |
| D4 | Low | The admin customer lookup uses `user_id.like.<sub>*` and takes `rows[0]` with no order. This is intentional, because customer ids are `cst_` plus 16 characters of the user id, but a short id could match another profile. | `backend/database/supabaseCustomerService.js:901` | Remaining. Add `role=eq.customer` and an order. |
| D5 | Low | `ssh_keys` and `notebook_instances` are not in 011's lockdown or the runtime service-only list; 006 is "proposed, not applied". | `database/migrations/006_*`, `backend/notifications/db.py:523-526` | Remaining, **needs approval**. Verify with 011's checks A2 and A3, then apply 006. |

Also proposed, **needs approval**: an index `audit_logs(created_at DESC)` for S9, once the audit-log list is paginated in SQL. Query plans were not run against production; this audit did not connect to the database.

## Frontend

| ID | Severity | Finding | Evidence | Status / recommendation |
|---|---|---|---|---|
| F1 | High | SSH key **add** ignored a server rejection and listed the key with a random fingerprint. **Delete** ignored the server result and said "Removed", so a compromised key could stay authorised. | `frontend/src/features/customer/pages/SshKeysPage.tsx:174-233` | **Fixed**. Both follow the backend result. Tests now mock the backend, and 2 failure tests were added. |
| F2 | High | API key "Copy" put an invented `…demo_active_token_<id>` string on the clipboard for every backend key, because secrets are only returned at creation. | `ApiKeysPage.tsx:145` | **Fixed**. It now explains that the secret is shown once and copies nothing. |
| F3 | High | Checkout showed a "Confirmed" receipt even when the order was not created, and the button re-enabled for duplicate orders. | `CheckoutPage.tsx:159-176, 428` | **Fixed** (error and no receipt, button disabled after confirmation; a test was added). Still open: the simulated payment, the `10000` wallet fallback and the sample listings. |
| F4 | Medium | New customers see two invented "demo" SSH keys, and the list is in a localStorage key shared by every account on the browser. | `SshKeysPage.tsx:59-75, 105` | Remaining. Always use the backend list, even when empty, and drop the demo defaults. The tests are built on the demo keys and need reworking. |
| F5 | Medium | The Profile page reported a failed name save as success, fell back to a real-looking personal name and email (used by the password change), and "Copy Bearer" copies a hard-coded mock JWT containing that email. | `ProfilePage.tsx:32-34, 103-118, 193` | **Fixed**: the save error is shown, and the personal fallbacks are now empty. Still open: the JWT inspector's mock token, which is a product decision. |
| F6 | Medium | Customer presence stops after back/forward navigation: `pagehide` sets `hasLoggedOutRef` and nothing resets it on `pageshow`. | `frontend/src/components/dashboard/CustomerHeartbeat.tsx:31, 101-106` | Remaining. Add a `pageshow` handler for `e.persisted`. |
| F7 | Medium | About 2,700 lines in `MarketplaceWorkspace.tsx`, plus `ExtraSections.tsx` and `InteractivePriceHistoryChart.tsx`, can never render: those routes redirect elsewhere. They still ship in the 278 KB chunk loaded for `/dashboard/provider/*`. | `frontend/src/pages/dashboard/MarketplaceWorkspace.tsx:1406-4150`, `App.tsx:162-172` | Remaining. Delete those branches after confirming with the provider-dashboard owner. |
| F8 | Medium | Every admin page fetched the wallet balance and discarded it: the values were only `void`ed. | `frontend/src/components/dashboard/DashboardLayout.tsx:546-616` (before) | **Fixed**. 72 dead lines removed, so one less request per admin navigation. |
| F9 | Low | Files with no importers: `GpuHourlyRateEditor.tsx`, `GpuNodeHealthCard.tsx`, `gpuInfrastructureService.ts`, `widgets/Timeline.tsx`, `AreaTrendChart.tsx`, `GpuVisual.tsx`, `routingService.ts`, `theme.tsx` (about 1,670 lines). They don't reach the bundle. | grep, including `import.meta.glob` | Remaining. All are recent teammate work (11-04 to 11-23); the authors should decide. |
| F10 | Low | Two copies of the superadmin overview, audit and admin-management pages, both routed. | `pages/dashboard/SuperAdminOverview.tsx` and `superadmin/SuperadminOverview.tsx`, etc. | Remaining. Redirect one tree to the other. |
| F11 | Low | Playground fetches the health endpoint again on entry, although the shell already loaded it. | `features/customer/pages/PlaygroundPage.tsx:46` | Remaining. |
| F12 | Low | The chat assistant listens for `inferxe-auth-change`, but the app dispatches `inferxe_auth_change`. | `frontend/src/components/bot/GlobalBotCompanion.tsx:748` | **Owner** (chatbot). Rename the event. |
| F13 | Low | Every admin saw two unread, invented notifications ("qwen-chat-staging … 118 tok/s"). | `AdminShell.tsx:188`, `DashboardLayout.tsx:258` | **Fixed**. They start empty; the existing "No notifications yet." state shows. |
| F14 | Low | About 4.2 MB of unreferenced files in `frontend/public` (`Green Data Cloud Logo.png`, `favicon2.svg`, `transperent Logo.png`, …) are copied into every build. | grep of the repo | Remaining. Confirm nothing outside the repo links to them, then delete. |
| F15 | Low | The admin header search imports `SovereignNodesMap`, which pulls 73 KB of SVG paths into the admin shell chunk. | `AdminHeaderSearch.tsx:25` | Remaining. Move the data array to its own file. |
| F16 | Low | `any` at API boundaries (`logs?: any[]`, `activities?: any[]`, …). | `lib/authStore.ts:1039-1054, 1266, 1351`, others | Remaining. |

Also seen, not counted separately: more legacy demo data in `DashboardLayout.tsx` (`customerAlerts`: "Marlow Market … ₹84.36").

## Performance (bundle)

| ID | Severity | Finding | Evidence | Recommendation |
|---|---|---|---|---|
| P1 | Medium | The entry chunk is **535 KB raw / 170 KB gzip** (measured). By source, before minification: react-dom 635K characters, react-router 377K, **framer-motion and motion-dom 510K**, **Amplify auth and core 233K**. framer-motion comes in through the app shell's page transitions, `Navbar`, `CommandPalette` and `Ambient` (34 files use it, 12 with layout animations). | sourcemap breakdown of the production build | Use `LazyMotion` to load animation features after first paint (an estimated 25–30 KB gzip) and keep Amplify out of the marketing path. Both need visual or auth regression checks. |
| P2 | Medium | All 748 KB of source CSS, including `dashboard-extra.css` (270 KB), `dashboard.css` and `super-admin.css`, ships as **one 483 KB file (80 KB gzip)** on every page, marketing pages included. | `frontend/src/main.tsx:9-31` | Move the dashboard stylesheets into the lazy console chunks. Cascade order changes, so this needs visual QA of every page in both themes. |

## Infrastructure

| ID | Severity | Finding | Evidence | Recommendation |
|---|---|---|---|---|
| I1 | Medium | GPU health history is not persisted on Render: without `DATABASE_URL` it falls back to `sqlite:///:memory:`, and `render.yaml` doesn't declare that variable. | `backend/inference/database.py:110-118`, `render.yaml` | **Owner** (GPU health) plus infrastructure approval. |
| I2 | Medium | Builds aren't reproducible: the Dockerfile copies only `backend/package.json` before `npm install`, and every Python requirement is `>=`. | `Dockerfile:29-33`, `backend/requirements.txt` | **Needs approval**. Copy the lockfile, run `npm ci --omit=dev`, and pin Python dependencies. |
| I3 | Low | `/healthz` returns 200 even when both Python workers are down. | `render-gateway.mjs:285-299` | Return 503 when a child isn't running. |
| I4 | Low | The container runs as root. | `Dockerfile` (no `USER`) | Add `USER node`. |
| I5 | Low | `.dockerignore` doesn't exclude `backend/ml/` (29 MB, including a LoRA adapter), `backend/tests/`, `.claude/` or `.agents/`. | `.dockerignore` | Add those entries. |
| I6 | Low | Two Vercel configs (`vercel.json`, `frontend/vercel.json`) duplicate the rewrites and can drift. | both files | Keep one. |

## Tests

| ID | Severity | Finding | Evidence |
|---|---|---|---|
| T1 | Low | `chartUtils.test.ts` asserts that a computation finishes in under 50 ms. It failed once (55 ms) during a full parallel run and passed on 2 re-runs. | `frontend/src/tests/chartUtils.test.ts:80` |
| T2 | Low | Three Node test files failed once with SQLite "database is locked" right after the dev services were stopped abruptly, then passed on 3 re-runs. | `backend/database/customerDatabase.js:50` |

## For module owners (teammate-owned, not modified)

- **GPU health:**
  - `backend/inference/main.py:157` (uncommitted change): any signed-in customer can trigger host GPU checks and read fleet-wide history. Consider an admin or operator check.
  - `backend/gpu_health/service.py:37-51, 100-190`: `async def` handlers run synchronous SQLAlchemy calls, including `create_all` on every call, on the event loop shared with inference. Database errors come back as empty history.
  - I1 above.
- **RAG and chatbot:**
  - S1, S15 and S19 above.
  - `backend/rag/server.py:377-383`: `conversation_history` has no limit on item count or length, and guests can reach it.
  - F12 above.
- **Shared:** `backend/inference/main.py:146-149` uses the same `*.vercel.app` credentialed CORS as S11.
- **Reviewed and correct:** the pending diffs to `gpu_health/routes.py` (stop leaking `str(exc)`) and `rag/server.py` (unverified answers no longer labelled grounded).

## Found during the verification pass (2026-11-26)

| ID | Severity | Finding | Evidence | Status |
|---|---|---|---|---|
| V1 | Medium | **This is a regression from fix F1.** The demo SSH keys (`ssh-1`, `ssh-2`) and keys saved only in the browser have non-UUID ids. The backend answers 400 for them, so the page now shows an error and cannot remove them. Before F1 they were "removed" locally. Every new customer with no backend keys sees two demo keys they cannot delete. | `SshKeysPage.tsx:225-229`, `backend/inference/routes.py:579-584` | Open. Proposed fix: remove non-UUID (local-only) keys without calling the backend, or, better, finish F4 (drop the demo keys and always show the backend list). **Needs your approval.** |
| V2 | Low | Fix D1 calls `crypto.randomUUID()` before the `try` in checkout. Browsers provide it only on HTTPS or localhost, so on plain HTTP over a LAN address, Pay would throw and stay stuck on "processing". Production on Vercel is HTTPS. | `CheckoutPage.tsx:124` | Open. Proposed fix: use `crypto.getRandomValues`, or move the line inside the `try`. **Needs your approval.** |
| V3 | High | Render runs with `GPU_PROVIDERS: "mock"`, and sets only `NODE_ENV=production`. Teammate commit `81a9fc1` disables the mock provider only when `INFERXE_ENV`, `APP_ENV` or `ENVIRONMENT` is production, so **production still offers simulated GPUs**. | `render.yaml:23-24`, `backend/providers/registry.py` | Infrastructure. Set `INFERXE_ENV=production` and a real `GPU_PROVIDERS` value. **Needs approval.** |
| V4 | Medium | Render sets `INFERENCE_DEMO_MODE: "true"`, so if the NVIDIA key is ever missing, customers silently get simulated answers instead of an error. | `render.yaml:21-22`, `backend/inference/service.py:46-47` | Infrastructure. Set it to `"false"` in production. **Needs approval.** |
| V5 | — | The admin session token cannot simply be removed from the login response (S18). The frontend stores it and sends it as a Bearer token to the Python services, which do not read the cookie. | `frontend/src/lib/authStore.ts:476`, `backend/notifications/auth.py` | This is a design change: the Python services must accept the HttpOnly cookie, or be reached only through the Node gateway, before the token leaves the response body. |

## Checked and found fine

- **Customer token verification:** RS256 only, plus issuer, audience, `token_use`, expiry and issue time, in Node and both Python services.
- **Admin sessions:**
  - HS256 pinned, timing-safe signature comparison, and a database check of session version, revocation, active flag and role on every request.
  - Superadmin routes require the superadmin role.
  - Session-store errors fail closed.
- **Customer data isolation:**
  - Every Node and Python customer query filters on the verified `sub`.
  - Storage paths are confined to `<sub>/`, and `..` is rejected.
  - Signed download URLs expire after 60 s.
- **RLS and grants:**
  - 011 covers 21 tables.
  - The SECURITY DEFINER function sets `search_path` and revokes EXECUTE.
  - Notifications re-applies RLS at startup.
- **Frontend:**
  - No `dangerouslySetInnerHTML`, `innerHTML` or `eval`.
  - Every `setInterval` is cleared on cleanup.
  - `useAsyncResource` aborts on unmount.
  - The workspace context value is memoized.
  - Double-submit protection exists on API-key create, top-up and deploy (idempotency key).
- **Logging and limits:**
  - No secrets or tokens in logs.
  - Request bodies are capped (16 KB customer, 1 MB admin).
  - One uvicorn process per service, so in-memory caches stay consistent.

## Not checked

- **Dependency vulnerabilities:** `npm audit` needs the registry; offline it reports "0" without any advisory data. Run it online in CI.
- **Production database:** query plans and index usage, production RLS state, Supabase bucket settings and live CORS behaviour weren't checked. This audit did not connect to production.
- **Lighthouse and backend load:** neither was run. The backend measurement is the Argon2 benchmark in the report.
