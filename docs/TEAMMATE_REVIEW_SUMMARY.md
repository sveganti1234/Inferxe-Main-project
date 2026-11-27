# Changes waiting for owner review — Manya, Diya, Sahith

This is for Manya (Notifications), Diya (SSH and GPU marketplace) and Sahith (UI/UX). These changes are **uncommitted** in the integration working tree on `development`. They were made during the security and optimization passes of 2026-11-26/27, before your modules were marked as owner-protected, or with explicit approval (SSH). **Nothing has been reverted, committed or pushed.** Please review, then tell the integrator (Anjana) to keep, change or drop each one.

Each section lists what changed, why, how it was tested, and what to check. All Python, Node and frontend suites pass with these changes (exact numbers in `FINAL_OPTIMIZATION_REPORT.md`).

---

## Manya — Notifications

### `backend/notifications/auth.py` (+20/−… lines) and `backend/notifications/tests/test_security_hardening.py` (+22)

- **What:** `assert_profile_active` now **fails closed**. When no Postgres DSN is configured and the Supabase lookup errors or no Supabase client exists, the request gets **503** instead of being allowed.
- **Why:** before this, `except Exception: pass` left `row = None`, so a **suspended** customer could keep using wallet debit, refund, deployment-status and chat endpoints whenever the status lookup failed. The function's own docstring promised 503.
- **Test:** `test_profile_status_check_fails_closed_without_dsn`, with 2 cases (client missing, client raising). It calls the real function captured before the conftest's autouse no-op.
- **Please check:** production always has a DSN or a Supabase client configured (`render.yaml` declares both), so working accounts see no change.

### Open items for you (not changed by anyone)

1. **The chat handler creates active profiles** (`notifications/main.py:208-233`). Any verified Cognito token without a profile gets an `active` row, skipping Node's verified-email and conflict checks. Proposal: return 403 "Customer profile has not been synchronized".
2. **Guest `/api/chat` has no rate limit**, and it spends paid LLM calls.
3. **A cookie fallback for admin sessions in `get_current_user`.** This is Phase 1 of `docs/proposals/admin-session-cookie-migration.md`, and it's needed before the admin token can leave the login response.
4. **`router.py:87-100`:** the unauthenticated database-status endpoint returns the Postgres host.
5. **`db.py:901, 902, 906`:** startup re-creates `idx_notifications_user_id`, `idx_notifications_is_read` and `idx_wallet_tx_user_id`. They are in active use (1,125, 1,277 and 1,530 scans), so keeping them is fine; this only matters if they are ever dropped.

---

## Diya — SSH (and GPU marketplace)

### `frontend/src/features/customer/pages/SshKeysPage.tsx` (199 lines changed) and `frontend/src/tests/customer/sshKeysRestoration.test.tsx` (now 13 tests)

These were approved by Anjana on 2026-11-26.

- **What:**
  - The two **demo keys** and the browser-wide key list (`inferxe_demo_ssh_keys_v1`, shared by every account on the device) are removed. The list always comes from `fetchBackendSshKeys`, with separate loading, error-with-Retry and empty states.
  - A key appears **only after the backend confirms it**, using the backend's id, fingerprint and date. A rejected key shows the backend's error.
  - Delete keeps the key and shows the error if the backend refuses. "Not found" (already removed) drops it.
  - The old browser entry is cleared on load. Real keys live on the server and are untouched.
  - Wording: "Configure demo SSH credentials" and "stored locally in your browser demo session" were replaced with accurate text.
- **Why:**
  - A rejected key used to appear "registered" with a made-up `SHA256:<random>` fingerprint, while deployments read keys from the backend.
  - A failed delete said "Removed" while the key stayed authorised on the server.
  - The demo keys could not be deleted, since their non-UUID ids get a 400 from the backend.
- **Tests:** every original check is kept, plus loading, empty with no demo keys, cleared legacy storage, load error with Retry, a rejected add, a failed delete, and an already-deleted key.

### Open items for you

1. **GPU marketplace shows sample GPUs in production by default.** `GpusPage.tsx:193-196` sets `showSampleData` to `import.meta.env.MODE !== 'test'`, so production builds show `SAMPLE_GPU_LISTINGS` whenever `gpu_listings` is empty (it has **0 rows** in production). It is labelled "Development Sample Dataset", but it still looks like capacity. Proposal: default to `import.meta.env.DEV`. `CheckoutPage.tsx:44-49` and `WishlistPage.tsx:47` also fall back to the sample listings, without a label.
2. **`backend/providers/registry.py`:** the production guard (from your `81a9fc1`) reads `INFERXE_ENV`/`APP_ENV`/`ENVIRONMENT`, which Render doesn't set. The infrastructure proposal adds `INFERXE_ENV=production` to `render.yaml`. Optionally, also honour `NODE_ENV=production` in the registry as a second safety net.

---

## Sahith — UI/UX (logic-only changes in UI files)

No visual design was changed. Each change is behaviour or data only.

| File | Change | Why | Test |
|---|---|---|---|
| `CheckoutPage.tsx` (+20) | (a) No receipt when order creation fails, with the error shown. (b) Pay is disabled after a confirmed order. (c) Order numbers come from the new `features/customer/data/orderNumber.ts` (`crypto.getRandomValues`, 8 hex characters), with an error if the browser has no secure random source. | (a, b) A failed order showed "Confirmed", and re-clicking created duplicates. (c) The old 900 possible values collided against a UNIQUE column, and `crypto.randomUUID` broke checkout on plain-HTTP LAN addresses. | `checkoutRestoration.test.tsx` (+3) and `orderNumber.test.ts` (6) |
| `ProfilePage.tsx` (+10) | A failed display-name save shows an error. The hard-coded fallback name and email (a real-looking personal Gmail identity) are now empty strings. | A failed save was reported as success, and a real-looking personal email was used as the fallback identity, including for password change. | `profileRestoration.test.tsx` (+1) |
| `ApiKeysPage.tsx` (+7) | "Copy" on a key whose secret isn't available says the secret is shown only once, instead of copying an invented `…demo_active_token_<id>`. | The invented string failed with 401 when pasted into a client. | existing copy test |
| `DashboardLayout.tsx` (−78) | Removed the wallet-balance fetch, state and listeners. Its values were only `void`ed and never displayed. Also starts with no invented notifications. | Every admin page sent a wasted `/api/wallet/balance` request; admins saw two unread made-up alerts. | typecheck, layout tests |
| `AdminShell.tsx` (6) | Starts with no invented notifications ("qwen-chat-staging … 118 tok/s"); the existing "No notifications yet." state shows. | Made-up telemetry in the admin header. | not browser-tested |

**Note:** upstream commits from 2026-11-27 (`640b31b` and others) changed brand colours in `AdminShell.tsx` and `DashboardLayout.tsx`, in different lines from these edits. The working tree hasn't integrated them yet; the integration is waiting for approval.

### Open items for you (measured, not changed)

1. **Layout shift on public pages.** CLS is **0.369** on `/` and `/pricing` (poor; the threshold is 0.25). It's one shift of `FOOTER.footer` when the lazy page chunk mounts, because the Suspense placeholder `.page-loading` (`frontend/src/styles/layout.css:78-82`) is only `60vh` tall. **Measured fix:** `min-height: 100vh` made CLS **0.000** on both pages in the same headless-Chrome test, with FCP, LCP and TBT unchanged. It's a one-line CSS change, and only the loading spinner's position moves.
2. **About 4.2 MB of unreferenced files in `frontend/public`** (`Green Data Cloud Logo.png`, `favicon2.svg`, `transperent Logo.png`, …).
3. **`AdminHeaderSearch.tsx:25`** imports `SovereignNodesMap`, pulling 73 KB of SVG paths into the admin shell. Move `GEO_DISTRIBUTION` to a data file.
4. **The global `html`/`body` background rules in `dashboard-extra.css:5448-5466`** block moving the dashboard CSS off public pages (see `FRONTEND_OPTIMIZATION_REPORT.md`).
5. **Demo data still in `DashboardLayout.tsx`** (`customerAlerts`: "Marlow Market … ₹84.36").
