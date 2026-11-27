# Inferxe optimization report — 2026-11-26

This is for the Inferxe engineering team. It covers what was changed in this pass, what was measured before and after, and what is still slow. The findings referenced (S2, D1, F1, …) are in `OPTIMIZATION_AUDIT.md`.

The approach was conservative. Each change fixes a verified bug or a measured bottleneck, keeps API contracts, and comes with a test. Teammate-owned modules (GPU health, RAG and chatbot) were not modified.

## Changes implemented

| # | Finding | Change | Files | Test |
|---|---|---|---|---|
| 1 | S4 | Admin login verifies the password with async `crypto.argon2` on the thread pool instead of `argon2Sync` on the event loop. The sync function stays, unchanged, for scripts and existing tests. | `backend/auth/adminPassword.js`, `backend/auth/adminAuth.js` | Async and sync results match for valid, wrong, malformed and empty input, and timers keep running during a verify (`auth/tests/admin-phase-a1.test.mjs`). |
| 2 | S2 | The profile-status check fails closed (503) when there is no DSN and the Supabase client is missing or errors. Before, the request was allowed. | `backend/notifications/auth.py` | `test_profile_status_check_fails_closed_without_dsn` (2 cases) |
| 3 | S7 | The Cognito signing-key cache refetches at most once a minute on an unknown `kid`. | `backend/auth/cognitoIdToken.js` | 5 forged-`kid` tokens cause no extra fetch (`tests/supabaseProfileSync.test.mjs`). |
| 4 | S6 | Hourly cleanup of expired customer sessions, with at most 20 tracked sessions per customer (least recently seen evicted). | `backend/database/supabaseCustomerService.js` | `tests/customerActivityStatusFix.test.mjs` |
| 5 | S10 | Workspace history (`deployments`, `orders`, `wallet_transactions`, `notifications`, `notebook_sessions`) is read newest first with an explicit 1,000-row cap. Results are identical below 1,000 rows; above that, the newest rows are returned instead of an arbitrary subset. | `backend/api/supabaseApi.js` | `tests/workspaceQueryOptimization.test.mjs` |
| 6 | D1 | Order numbers are 8 random hex characters (about 4.3 billion values) in checkout and in the server default. Before, there were 900 and 9,000 values against a UNIQUE column. | `CheckoutPage.tsx`, `backend/api/supabaseApi.js` | — (generation only) |
| 7 | F3 | Checkout shows the error and **no receipt** when the order isn't created, and the Pay button stays disabled after a confirmed order. | `frontend/src/features/customer/pages/CheckoutPage.tsx` | `checkoutRestoration.test.tsx`: new failure test |
| 8 | F1 | SSH key add and delete follow the backend result. A rejected key is not listed, a failed delete keeps the key and shows the error, and the fingerprint comes from the server. | `frontend/src/features/customer/pages/SshKeysPage.tsx` | `sshKeysRestoration.test.tsx`: the add and delete tests now mock the backend (every original assertion kept), plus 2 failure tests |
| 9 | F2 | API key "Copy" no longer copies an invented token; for keys whose secret was only shown at creation, it says so. | `frontend/src/features/customer/pages/ApiKeysPage.tsx` | the existing copy test still passes |
| 10 | F5 | A failed display-name save shows an error, and the personal name and email fallbacks are now empty. | `frontend/src/features/customer/pages/ProfilePage.tsx` | `profileRestoration.test.tsx`: new failure test |
| 11 | F8 | Removed the dead wallet-balance fetch, state and listeners from `DashboardLayout` (72 lines). The values were never displayed, so every admin page sent a wasted `/api/wallet/balance` request. | `frontend/src/components/dashboard/DashboardLayout.tsx` | typecheck, plus the existing layout tests |
| 12 | F13 | The admin header starts with no notifications instead of invented telemetry. | `frontend/src/components/dashboard/AdminShell.tsx`, `DashboardLayout.tsx` | none specific; the existing "No notifications yet." empty state renders (not checked in a browser) |

New dependencies: none. Database migrations: none. Production configuration: unchanged.

## Measurements

**Test conditions:**
- Windows 11, local machine, Node v24.22.3, Python 3.12.
- No other load, except that the test runner itself runs in parallel.
- Each measurement repeated as stated.

### Admin login under concurrency (change 1)

Ten concurrent wrong-password verifications at the production Argon2id cost (m=64 MiB, t=3, p=1). The stall is how late a 10 ms timer fires, which is what every other gateway request experiences. Two runs each:

| | Time for the 10 checks | Worst event-loop stall |
|---|---:|---:|
| Before (sync) | 1,805 ms / 1,725 ms | **1,796 ms / 1,715 ms** |
| After (async) | 782 ms / 784 ms | **11 ms / 12 ms** |

A single verification takes a median of 167.8 ms (min 151.5, max 187.7, 10 runs). Before this change, the whole gateway (customer, admin and proxied API traffic) was frozen for that long on every admin login attempt. Now it isn't, and concurrent attempts also finish faster because they run in parallel on the thread pool.

### Frontend bundle (production `vite build`)

| | Before | After |
|---|---:|---:|
| Entry chunk (`index-*.js`) | 534,957 B raw / 169,836 B gzip | 534,957 B raw / 169,839 B gzip |
| CSS (single file) | 482,871 B raw / 80,055 B gzip | unchanged |
| Initial load (entry + CSS) | 1,017,828 B raw / 249,891 B gzip | 1,017,828 B raw / 249,894 B gzip |
| All JS | 2,243,114 B in 140 files | 2,241,009 B in 140 files |
| `DashboardLayout` chunk | 46,540 B | 41,810 B (−10%) |
| Build time | 22 s | 27–30 s (varies run to run; no build configuration changed) |

The initial load is unchanged. None of these changes targeted it; the bundle work is in "Remaining bottlenecks" below.

### Network requests

- **Admin dashboard:** one less `/api/wallet/balance` request per admin page navigation (change 11). Counted from the code path, not measured in a browser.
- **Forged Cognito tokens:** before, every one with a random `kid` caused 1–2 outbound requests to AWS; now at most one per minute (change 3, tested).

### Not measured

- Lighthouse.
- Backend API latency or throughput under load.
- Production database query latency.

These would need a running deployment or production database access, which this pass didn't have.

## Test results

| Suite | Before (pass / fail / skip) | After (pass / fail / skip) |
|---|---|---|
| Node backend and admin auth | 159 / 0 / 13 | **163 / 0 / 13** (+4 new tests) |
| Inference, provider and GPU health | 316 / 0 / 1 | 316 / 0 / 1 |
| Notifications | 238 / 0 / 17 | **240 / 0 / 17** (+2 new tests) |
| RAG | 27 / 0 / 0 | 27 / 0 / 0 |
| Frontend Vitest | 464 / 0 / 0 | **468 / 0 / 0** (+4 new tests) |
| TypeScript (`tsc --noEmit`) | pass | pass |
| Production build | pass | pass |

One full Vitest run had a single failure in `chartUtils.test.ts`, a 50 ms wall-clock assertion that took 55 ms. That file and its code are untouched, and the next 2 full runs passed 468/468 (T1). No test was deleted or weakened. The SSH key tests were changed only to mock the backend that the page now requires, and all their assertions were kept.

## Remaining bottlenecks

The order is by expected impact.

1. **Entry chunk (P1):** 170 KB gzip, including framer-motion (about 510K characters of source) and Amplify auth (about 233K). Load animation features lazily (`LazyMotion`) and keep Amplify off marketing pages. Needs visual and authentication regression checks.
2. **One CSS file for everything (P2):** 80 KB gzip, including the dashboard and super-admin styles on marketing pages. Split per route, after visual QA in both themes.
3. **Admin views read whole tables (S9):** these become wrong, not just slow, past 1,000 rows. Use count queries and SQL pagination; an audit-log index needs approval.
4. **Provider dashboard chunk (F7):** 278 KB, of which about 2,700 lines can never render.
5. **Sequential provider sync on the deployment list (S13),** and a new HTTP client per profile check (S12).
6. **GPU health handlers (owner):** synchronous DB work on the event loop shared with inference.

## Known limitations

- **No browser check:** the frontend changes are covered by unit tests and typecheck, but weren't checked in a browser. The manual checklist is in `docs/MANUAL_TEST_CHECKLIST.md`.
- **Order-number test:** the new format has no dedicated test; it's a one-line generator.
- **Sync Argon2 remains elsewhere:** the sync verifier is still used by `verifyPassword` (tests and the password-reset script, which this pass intentionally didn't touch).
