# Inferxe production readiness — 2026-11-26

This is for the Inferxe team and whoever signs off a production release. It reflects `development` at `9b789ca` plus the uncommitted fixes in `OPTIMIZATION_REPORT.md`. Details are in `OPTIMIZATION_AUDIT.md` and `SECURITY_REVIEW.md`.

**Verdict: not production-ready for paying customers yet.** The core platform builds, and its security model is sound: Cognito verification, database-backed admin sessions, RLS, and per-customer isolation. The blockers are a few specific gaps, listed below, not the architecture.

## Build status

| Check | Result |
|---|---|
| `tsc --noEmit` (frontend) | pass |
| `vite build` (production) | pass. Entry chunk 535 KB raw / 170 KB gzip; CSS 483 KB / 80 KB gzip. |
| Docker image | not built in this pass. The Dockerfile has reproducibility issues (audit I2). |

## Test status (after the changes)

| Suite | Pass | Fail | Skip |
|---|---:|---:|---:|
| Node backend and admin auth | 163 | 0 | 13 |
| Inference, provider and GPU health | 316 | 0 | 1 |
| Notifications | 240 | 0 | 17 |
| RAG | 27 | 0 | 0 |
| Frontend Vitest | 468 | 0 | 0 |

There are two known flaky tests, unrelated to these changes:
- **T1:** a 50 ms timing assertion in `chartUtils.test.ts`.
- **T2:** a one-off SQLite "database is locked" right after the dev services were stopped.

Each passed on re-run.

## Blockers before taking real customers

1. **Checkout is simulated.** It records an order labelled "Paid & Settled" with a placeholder card number, charges nothing, falls back to a wallet balance of ₹10,000 when there's no wallet, and lets the customer set the order cost (audit D2, F3). Either integrate real payment and server-side pricing, or hide checkout.
2. **The chat endpoint creates active profiles** for any verified Cognito token (R1 / S1). Chatbot owner.
3. **GPU health endpoints are open to every signed-in customer** (R14), and its history isn't persisted on Render (audit I1). GPU health owner.
4. **No security headers, and the admin token is returned in the login JSON** (R3).
5. **The admin login rate limit is keyed on the proxy IP** (R2), so one attacker can lock out every admin.

## Should fix soon after

- **Credentialed CORS for `*.vercel.app` in production** (R4).
- **Upload type and size limits** on storage buckets (R6).
- **Guest chat rate limit** (R5).
- **Inference prompt size limit** (R8).
- **Admin views read whole tables** (S9). Statistics silently go wrong past 1,000 rows.
- **Demo data still shown to real users:**
  - invented SSH keys for new customers (F4);
  - the JWT inspector's mock token (R9);
  - legacy demo alerts in `DashboardLayout`.
- **Reproducible builds:** copy the lockfile and run `npm ci` in the Dockerfile, and pin the Python requirements (I2).
- **Gateway `/healthz`** returns 200 when the Python workers are down (I3).

## Deployment readiness

| Item | State |
|---|---|
| Database migrations 009–012 | Applied to the shared project on 2026-11-26 (see `MIGRATION_EXECUTION_CHECKLIST.md`). 012 section D (dropping redundant indexes) was not run and needs approval. |
| Supabase storage | `profile-avatars` is private. Bucket size and type limits are not set. |
| Render (`render.yaml`) | Declares the required Supabase, Cognito, admin and NVIDIA variables, but not `DATABASE_URL` (GPU health history). `ALLOW_VERCEL_PREVIEW_ORIGINS` is `"true"`. |
| Vercel | `/api/*` rewrites to the Render backend in both `vercel.json` files (keep one). No security headers. |
| Container | Runs as root, and `.dockerignore` misses `backend/ml/` (29 MB). |
| Secrets | `.env` files are excluded from Git and Docker, and none are baked into the image. |

No deployment or infrastructure change was made in this pass.

## Manual testing still required

Use `docs/MANUAL_TEST_CHECKLIST.md`, and add these checks for the changes in this pass:

- **Admin sign-in:** a correct and a wrong password both still work as before, and the rate limit message still appears after 20 failures.
- **SSH Keys page:**
  - Add a valid key: it appears with the server's fingerprint.
  - Paste an invalid key: an error appears and the key isn't listed.
  - Delete a key.
- **API Keys page:** Copy on an existing key shows "only shown once"; Copy right after creating a key copies the real secret.
- **Checkout:** with the backend stopped, Pay shows an error and no receipt. With the backend running, the receipt appears and Pay stays disabled.
- **Profile:** the name save succeeds with the backend running, and shows an error with it stopped.
- **Admin header:** the notification bell shows "No notifications yet." and no unread dot.
- **Customer dashboard:** orders, transactions and notifications appear newest first.
- **Both themes:** spot-check the pages above in light and dark.

---

# Verification pass — 2026-11-26 (after teammate commit 81a9fc1)

## 1. Implemented fixes, re-checked against code and tests

| # | Fix | Code re-read | Test | Result |
|---|---|---|---|---|
| 1 | Async Argon2 on admin login | yes | sync and async results match; timers run during a verify | verified |
| 2 | Status check fails closed (503) | yes | 2 cases | verified. Deploy check: production must have a DSN or a Supabase client configured; `render.yaml` declares both. |
| 3 | Cognito key refetch cooldown | yes | 5 forged `kid`s, 1 fetch | verified |
| 4 | Session cap of 20 per customer, hourly cleanup | yes | cap test | verified |
| 5 | Workspace history newest first, 1,000-row cap | yes | order and limit asserted per table | verified |
| 6 | Collision-free order numbers | yes | none (generator only) | verified, with a new edge case (**V2**) |
| 7 | Checkout: no receipt on failure, no double submit | yes | failure test | verified in tests, **not in a browser** |
| 8 | SSH add and delete follow the backend | yes | 2 failure tests | verified in tests, with a **regression found (V1)** |
| 9 | No fake API key copy | yes | existing copy test | verified in tests, **not in a browser** |
| 10 | Profile save error and no personal fallback | yes | failure test | verified in tests, **not in a browser** |
| 11 | Dead admin wallet fetch removed | yes | typecheck and layout tests | verified |
| 12 | No invented admin notifications | yes | none | verified in code, **not in a browser** |

Full suites with `81a9fc1` included:

| Suite | Pass | Fail | Skip |
|---|---:|---:|---:|
| Node | 163 | 0 | 13 |
| Inference, provider and GPU health | 318 | 0 | 1 |
| Notifications | 240 | 0 | 17 |
| RAG | 27 | 0 | 0 |
| Frontend | 470 | 0 | 0 |

Typecheck passes and the production build passes.

## 2. Browser verification actually performed

This was a real headless Chrome run (the installed Chrome, driven over the DevTools protocol) against `vite preview` of the production build, signed out:

- **Public pages render with no console errors and no horizontal overflow at 1366 px:** `/`, `/pricing`, `/gpus`, `/security`, `/developers`, `/login`, `/signup` and the 404 page. The screenshots were checked by eye.
- **Guards redirect to `/login`:** `/dashboard/app/ssh-keys`, `/dashboard/app/api-keys`, `/dashboard/app/checkout`, `/dashboard/app/profile`, `/dashboard/super-admin` and `/dashboard/customers`.

**Not browser-verified.** These need a real Cognito customer and a real admin account, which this session does not have and must not create:
- SSH keys, API keys, checkout, profile and the admin notification bell;
- dark and light themes, which exist only inside the signed-in dashboards (`inferxe_dash_theme`);
- signed-in customer and admin navigation.

They are listed for manual testing in "Manual testing still required" above. For the SSH page, also check V1: a new customer's demo keys cannot be removed.

## 3. Production blockers, by owner

| Blocker | Owner | State |
|---|---|---|
| Simulated checkout and payment ("Paid & Settled", placeholder card, ₹10,000 fallback, client-set cost) | **Inferxe integration (you)** | Open. Needs real payment and server-side pricing, or hide checkout. |
| SSH demo keys cannot be removed (V1); demo keys shown (F4) | **Inferxe integration (you)** | Open. Fix proposed, awaiting approval. |
| Admin lockout behind the proxy (S3) | **Inferxe integration (you)**, with an infrastructure input on which header to trust | Open. |
| Admin session token in the login JSON (S18 / V5) | **Inferxe integration (you)**, a design change | Open. The Python services must accept the cookie first. |
| Chat endpoint creates active profiles (S1) | **Chatbot owner** | Open. |
| Guest chat rate limit (S19); unbounded chat limits (S15) | **Chatbot owner** | Open. |
| GPU health open to every customer (`backend/inference/main.py:157`, uncommitted) | **GPU health owner** | Open. |
| GPU health history in memory on Render (I1) | **GPU health owner** plus infrastructure (`DATABASE_URL`) | Open. |
| Simulated GPUs in production (V3); demo inference flag (V4) | **Infrastructure** | Open, needs approval. |
| Security headers (S18) | **Infrastructure** | Pending approval (below). |
| Credentialed CORS for `*.vercel.app` (S11) | **Infrastructure** | Pending approval (below). |
| Bucket limits (S20) | **Infrastructure** | Pending approval (below). |

## 4. Pending approvals: exact changes (not implemented)

### A. Eight redundant database indexes

- **Impact:**
  - Less write overhead and storage as tables grow.
  - No read benefit today: the largest table had about 242 rows on 2026-11-18.
  - Low value, low risk.
- **Compatibility risks:**
  - The scan counts are 8 days old.
  - `idx_deployments_status` is not covered by another index, so drop it only if it is still unused.
  - The notifications service re-creates `idx_notifications_user_id`, `idx_notifications_is_read` and `idx_wallet_tx_user_id` at startup (`backend/notifications/db.py:901, 902, 906`). Those three lines must be removed in the same change, or the drop is undone at the next restart.
  - `chat_history` and `document_metadata` belong to the RAG owner, so get their sign-off.
- **Pre-check (read-only):**

```sql
SELECT indexrelname, idx_scan FROM pg_stat_user_indexes
WHERE indexrelname IN ('idx_doc_metadata_doc_id','idx_profiles_email','idx_chat_history_user_id','idx_notifications_user_id',
                       'idx_notifications_is_read','idx_wallet_tx_user_id','idx_deployments_user','idx_deployments_status');
SELECT indexname, indexdef FROM pg_indexes
WHERE indexname IN ('document_metadata_document_id_key','profiles_email_key','idx_chat_history_user_session',
                    'idx_notifications_user_created','idx_notifications_user_read','idx_wallet_tx_user_date','deployments_user_created_idx');
```

  Every covering index must exist (and be valid) before its redundant one is dropped.

- **Change:** run each statement on its own, outside a transaction. Also remove the three `CREATE INDEX` lines in `backend/notifications/db.py`.

```sql
DROP INDEX CONCURRENTLY IF EXISTS public.idx_doc_metadata_doc_id;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_profiles_email;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_chat_history_user_id;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_notifications_user_id;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_notifications_is_read;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_wallet_tx_user_id;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_deployments_user;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_deployments_status;   -- only if idx_scan is still 0
```

- **Rollback:** recreate the indexes, then restore the three `db.py` lines.

```sql
CREATE INDEX CONCURRENTLY idx_doc_metadata_doc_id ON public.document_metadata (document_id);
CREATE INDEX CONCURRENTLY idx_profiles_email ON public.profiles (email);
CREATE INDEX CONCURRENTLY idx_chat_history_user_id ON public.chat_history (user_id);
CREATE INDEX CONCURRENTLY idx_notifications_user_id ON public.notifications (user_id);
CREATE INDEX CONCURRENTLY idx_notifications_is_read ON public.notifications (user_id, is_read);
CREATE INDEX CONCURRENTLY idx_wallet_tx_user_id ON public.wallet_transactions (user_id);
CREATE INDEX CONCURRENTLY idx_deployments_user ON public.deployments (user_id);
CREATE INDEX CONCURRENTLY idx_deployments_status ON public.deployments (status);
```

### B. Vercel security headers

- **Impact:**
  - Blocks clickjacking of the admin console and MIME sniffing.
  - Enforces HTTPS.
  - The CSP limits the damage of any XSS, which matters because tokens live in localStorage.
- **Compatibility risks:**
  - A wrong CSP breaks sign-in or API calls. The production API endpoints come from Vercel environment variables that this session cannot see.
  - The CSP therefore ships first as **`Content-Security-Policy-Report-Only`**: the browser reports violations without blocking anything.
  - The inline script in `index.html` is allowed by its hash. That hash is for the LF build Vercel produces, and it changes if that script changes.
  - `X-Frame-Options: DENY` breaks any embedding of the site in an iframe; none was found.
- **Change:** add a `headers` key to the Vercel config the project actually uses (check the Vercel "Root Directory" setting; keep one file, see I6):

```json
"headers": [{
  "source": "/(.*)",
  "headers": [
    { "key": "X-Content-Type-Options", "value": "nosniff" },
    { "key": "X-Frame-Options", "value": "DENY" },
    { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
    { "key": "Strict-Transport-Security", "value": "max-age=31536000" },
    { "key": "Permissions-Policy", "value": "camera=(), microphone=(), geolocation=()" },
    { "key": "Content-Security-Policy-Report-Only", "value": "default-src 'self'; script-src 'self' 'sha256-lkbUNg/yxDedwYOLcWMuINCWYjp7PSLEDT1NhgnwLkc='; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https://cognito-idp.ap-south-1.amazonaws.com https://cognito-identity.ap-south-1.amazonaws.com https://*.amazoncognito.com https://*.supabase.co https://*.onrender.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://*.amazoncognito.com" }
  ]
}]
```

  After a clean week of reports with a full sign-in, console and admin pass, rename the CSP header to `Content-Security-Policy`.

- **Rollback:** remove the `headers` key and redeploy. Vercel also allows instant rollback to the previous deployment.

### C. `ALLOW_VERCEL_PREVIEW_ORIGINS`

- **Impact:** stops the gateway from giving credentialed CORS to every `https://*.vercel.app` origin, including any attacker's.
- **Compatibility risks:**
  - The production frontend is unaffected: its origin is listed in `CORS_ALLOWED_ORIGINS`, and it calls `/api` through Vercel's same-origin rewrite.
  - Only Vercel **preview** deployments that call the Render URL directly, cross-origin, would lose API access.
  - Localhost origins stay allowed regardless, because `LOCAL_ORIGIN_RE` is unconditional. Restricting that to non-production is a separate code change.
- **Change:** in `render.yaml`, set `ALLOW_VERCEL_PREVIEW_ORIGINS: "false"`, and make the same change in the Render dashboard if the variables aren't synced from the blueprint. Optionally add the preview URLs you need to `CORS_ALLOWED_ORIGINS`.
- **Rollback:** set it back to `"true"` and redeploy.

### D. Storage bucket size and type limits

- **Impact:** blocks oversized uploads and HTML/SVG served from the storage domain.
- **Compatibility risks:**
  - No frontend screen currently uploads through signed URLs: `getCustomerStorageUrl` has no callers. So nothing visible changes.
  - The allowed list applies only to new uploads; existing objects stay.
  - It is unknown whether `notebook-files`, `inference-outputs` and `model-artifacts` exist in production.
- **Pre-check (read-only):**

```sql
SELECT id, public, file_size_limit, allowed_mime_types FROM storage.buckets;
```

- **Change:** `profile-avatars` now; the others once their features define what they store.

```sql
UPDATE storage.buckets
   SET file_size_limit = 2097152,                                   -- 2 MiB
       allowed_mime_types = ARRAY['image/png','image/jpeg','image/webp']
 WHERE id = 'profile-avatars';
```

  Suggested later, if the buckets exist:
  - `notebook-files`: 50 MiB, with `application/x-ipynb+json`, `application/json`, `text/plain` and `text/csv`.
  - `inference-outputs`: 10 MiB, with `application/json` and `text/plain`.
  - `model-artifacts`: a size limit only, since model files have no reliable MIME type.

- **Rollback:** reset the limits, or restore the values from the pre-check.

```sql
UPDATE storage.buckets SET file_size_limit = NULL, allowed_mime_types = NULL WHERE id = 'profile-avatars';
```

## 5. Prioritized action plan

**Must fix before production:**
1. Real payment and server-side order pricing, or hide checkout (you).
2. V1 and F4: the SSH demo keys (you; fix ready on approval).
3. V3 and V4: `INFERXE_ENV=production`, a real `GPU_PROVIDERS`, and `INFERENCE_DEMO_MODE=false` on Render (infrastructure).
4. S1: chat must not create profiles (chatbot owner).
5. GPU health authorization (GPU health owner).
6. S3: admin lockout keyed on the real client IP (you, with infrastructure).
7. Security headers in report-only mode (approval B), then enforced.

**Must verify before production:**
1. The manual signed-in checks above, in both themes.
2. The pre-checks for approvals A and D against production.
3. That production has a DSN or a Supabase client for the fail-closed status check (fix 2).
4. Vercel's Root Directory, to know which `vercel.json` applies.
5. A real admin login after deploy (async Argon2).

**Safe to do later:**
1. Approvals A (indexes), C (CORS flag) and D (buckets).
2. V2, the checkout edge case on plain HTTP.
3. Bundle work (P1, P2).
4. Admin views with SQL pagination (S9).
5. Dead code (F7, F9), the duplicate superadmin pages (F10), and the Dockerfile hardening (I2–I5).
6. The admin cookie-only session redesign (V5).

---

# Approved changes and blocker proposals — 2026-11-26 (round 3)

## Implemented (approved)

| Approval | Change | Files | Tests |
|---|---|---|---|
| A. SSH demo-key regression | The demo keys and the shared browser key list are removed. The list always comes from the backend, with separate loading, error-with-Retry and empty states. A key appears only after the backend confirms it, using the backend's id, fingerprint and date. The old browser entry (`inferxe_demo_ssh_keys_v1`) is cleared on load; real keys live on the server and are untouched. The "demo"/"stored locally" wording is corrected. | `frontend/src/features/customer/pages/SshKeysPage.tsx` | `sshKeysRestoration.test.tsx`, 13 tests: every earlier check kept, plus loading, empty with no demo keys, cleared legacy storage, load error with Retry, already-deleted key |
| B. Plain-HTTP checkout | Order numbers use `crypto.getRandomValues`, which exists on plain-HTTP pages too, instead of `crypto.randomUUID`, which only exists on HTTPS and localhost. The format is unchanged (`ORD-` plus 8 hex characters from the CSPRNG), with no `Math.random` fallback. A browser without a CSPRNG gets an error and no order. | new `frontend/src/features/customer/data/orderNumber.ts`; `CheckoutPage.tsx` | `orderNumber.test.ts` (6: HTTPS, localhost, plain HTTP, bytes from the CSPRNG, 2,000 unique draws, no-CSPRNG refusal); `checkoutRestoration.test.tsx` (+2: plain-HTTP order created, no-CSPRNG error) |
| C. Security headers (report-only) | Added to **both** `vercel.json` and `frontend/vercel.json`, identically: `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy` and `Content-Security-Policy-Report-Only`. No blocking CSP. HSTS was not added because Vercel already sends `max-age=63072000; includeSubDomains; preload` (seen on the live site). | `vercel.json`, `frontend/vercel.json` | Headless Chrome against the built app served with these exact headers: 14 routes, **0 CSP reports and 0 console errors** (see below) |
| D. Avatar bucket limits | **Nothing changed: production already has them.** A read-only check found `profile-avatars` private, with `file_size_limit` 2,097,152 and PNG, JPEG and WebP allowed (set 2026-11-05), and holding 0 files. The other three buckets are private with their own limits, and were not touched. | none | read-only settings snapshot: `C:\Users\anjana\inferxe-backups\bucket-settings-20261126.json` |

**Which Vercel config applies.** The repo can't tell: there is no `.vercel/` folder, and both files came from the same commits. The root file has `buildCommand`/`outputDirectory: frontend/dist`, which fits a project whose Root Directory is the repo root; `frontend/vercel.json` would apply if it were `frontend`. Both carry identical headers, so either way is covered. Confirm the Root Directory in Vercel's project settings, then delete the unused file (audit I6).

**How the CSP was derived, from evidence and with no invented domains.** The live production bundle (`index-B571kjC4.js`, the same build as the repo) and all 38 of its lazy chunks were scanned:
- **API calls:** every one is same-origin `/api/*` (the Vercel rewrite). `VITE_*_ENDPOINT` is unset in production.
- **Cognito:** user-pool sign-in only (`loginWith: { email }`), with no OAuth domain and no identity pool. The only external call is `https://cognito-idp.ap-south-1.amazonaws.com`.
- **Fonts:** Google Fonts (Urbanist), from `frontend/index.html:16`. The first local run reported these, so `https://fonts.googleapis.com` (styles) and `https://fonts.gstatic.com` (fonts) were added.
- **Inline script:** the one inline script in `index.html` is allowed by its SHA-256 hash, for the LF build Vercel produces.
- **Not allowed:** `api.inferxe.com`, `novatech.ai` and `localhost:3000` appear only as display text (code samples, placeholders), so they are not allowed.
- **Expected report:** the chatbot's fallback to `http://127.0.0.1:11434` will be reported if it is ever used. That is intended; it's for the chatbot owner.

**The policy (report-only):**

```
default-src 'self'; script-src 'self' 'sha256-lkbUNg/yxDedwYOLcWMuINCWYjp7PSLEDT1NhgnwLkc='; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob:; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self' https://cognito-idp.ap-south-1.amazonaws.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
```

**Monitoring CSP violations.** Report-only blocks nothing; violations appear only where they are looked for:
1. **Browser console:** after deploy, open DevTools → Console on the live site and run the signed-in customer and admin passes from "Manual testing still required". Every violation prints as a red `[Report Only] Refused to …` line naming the blocked URL and directive. A violation that is part of normal use needs its host added (with evidence); anything unexpected is worth investigating.
2. **Central reporting (optional, not built):** add `report-uri <endpoint>` (or `report-to`) to the policy, pointing at a collector, either a reporting service or a small gateway route that logs reports. That needs a new endpoint, so it isn't included.
3. **Switch to enforcing** (rename the header to `Content-Security-Policy`) only after a clean signed-in pass in both themes, plus some days of live use without unexpected reports.
4. **Keep the hash current:** if the inline script in `frontend/index.html` changes, recompute its hash from the LF file (`git show HEAD:frontend/index.html`).

**Rollback for C:** remove the `headers` key from both `vercel.json` files and redeploy, or use Vercel's instant rollback to the previous deployment.
**Rollback for D:** not applicable, nothing changed. If the limits ever need removing: `UPDATE storage.buckets SET file_size_limit = NULL, allowed_mime_types = NULL WHERE id = 'profile-avatars';`. Existing files are never affected by these settings.

## Deferred (as instructed)

- **Indexes (approval A):** nothing removed. Still needed: fresh `pg_stat_user_indexes` numbers, RAG owner sign-off for `idx_doc_metadata_doc_id` and `idx_chat_history_user_id`, and removal of the three re-creating lines in `backend/notifications/db.py:901, 902, 906` in the same change.
- **`ALLOW_VERCEL_PREVIEW_ORIGINS` (approval C):** unchanged. Still needed: list the preview deployments that call the Render URL directly, cross-origin, and test them.

## Additional production blockers: investigation and proposed fixes (not implemented)

| # | Blocker | What the code does | Proposed fix | Owner / approval |
|---|---|---|---|---|
| 1 | `GPU_PROVIDERS=mock` on Render | `render.yaml:23-24` sets `mock`. Render declares **no** `JARVISLABS_API_KEY` or `JARVISLABS_USER_ID`, so no real provider is configured. | Add the JarvisLabs credentials as `sync: false` secrets and set `GPU_PROVIDERS: "jarvislabs"`. Until a real provider exists, set `GPU_PROVIDERS: ""`: launches then fail honestly instead of creating simulated GPUs. | Infrastructure; your approval for `render.yaml` |
| 2 | `INFERENCE_DEMO_MODE=true` | Simulated answers are used only when no NVIDIA key is set (`backend/inference/service.py:46-47`). The gateway also **defaults it to `'true'`** when unset (`backend/scripts/render-gateway.mjs:152`). | Set `INFERENCE_DEMO_MODE: "false"` in `render.yaml`, and change the gateway default to `'false'` so a missing variable doesn't silently enable it. | Infrastructure (`render.yaml`) plus a one-line gateway change; your approval |
| 3 | The production guard needs `INFERXE_ENV` | `backend/providers/registry.py` and `backend/inference/auth.py:104` read `INFERXE_ENV`, `APP_ENV` or `ENVIRONMENT`; Render sets only `NODE_ENV=production`. | Add `INFERXE_ENV: "production"` to `render.yaml`; it also enables the other production checks in `inference/auth.py`. Optionally make the registry also honour `NODE_ENV=production` as a second safety net (teammate diyal05's file). | Infrastructure; optionally the provider-registry author |
| 4 | Simulated checkout, customer-set costs | No payment provider exists in the code. `POST /api/customer/orders` stores the browser's `total_cost`, `status`, `order_date` and an unchecked `deployment_id` (`backend/api/supabaseApi.js:456-495`), and debits nothing. GPU deployments, by contrast, are priced on the server (`gpu_deployment_service.py:142`). | **Short term (recommended):** hide the checkout route in production, or relabel it "Request reservation", with no "Paid & Settled". **Proper fix:** the server computes the price from `gpu_listings.hourly_price × duration`, ignores client cost, status and date, checks deployment ownership, and debits the wallet in the same transaction (or takes payment through a real gateway). This is a business decision. | You (Inferxe integration); business decision on payments |
| 5 | Chat creates active profiles | `backend/notifications/main.py:208-233` inserts `status: active` for any verified token without a profile. | Remove the insert and return `403 "Customer profile has not been synchronized"`, matching Node `syncProfile`, which checks a verified email and conflicts. Profiles are created at sign-in by `/api/customer/profile/sync`. | **Chatbot owner** approval (`notifications/main.py` chat handler) |
| 6 | GPU health open to every customer | `backend/inference/main.py:157` (uncommitted teammate edit) mounts the router with `Depends(require_cognito_user)`. The inference service has **no admin dependency** today; the notifications service has `require_admin_user`. | Add a `require_admin_user` to `backend/inference/auth.py` that accepts only HS256 admin session tokens, verified against `admin_sessions` and `admin_users` as notifications does. Then mount the GPU health router with it, or split read-only fleet status (operators) from `POST /{gpu_id}/check` (admins). | **GPU health owner** approval (their `main.py` edit) |
| 7 | GPU health history lost on restart | `backend/inference/database.py:110-118` falls back to `sqlite:///:memory:` without `DATABASE_URL`; `render.yaml` declares only `SUPABASE_DATABASE_URL`. | Either declare `DATABASE_URL` (`sync: false`) in Render, using the Supabase pooler connection string, or make `database.py` fall back to `SUPABASE_DATABASE_URL`. `gpu_health_history` already exists with service-only access (010). Also stop `create_all` on every call (audit, owner notes). | **GPU health owner** plus infrastructure |
| 8 | Admin lockout behind the proxy | `backend/auth/adminAuth.js:702` keys the limiter on `req.socket.remoteAddress`, which is the Render proxy. Traffic comes client → Vercel rewrite → Render → gateway. | Don't guess the header chain. **Step 1:** log the shape (not the values) of `x-forwarded-for` and `x-real-ip` for one login through Vercel and one sent directly to `onrender.com`, to see which entry the client cannot forge. **Step 2:** key on that entry plus the email, with a per-email limit that delays rather than locks, so one attacker cannot lock every admin out. | You; needs one diagnostic deploy (infrastructure approval) |
| 9 | Admin token in the login response | **Compatibility investigated.** The Python services authenticate only with `Authorization: Bearer` (`notifications/auth.py:649-660`). The frontend stores the admin token and sends it there. The admin cookie is `HttpOnly; Path=/api; SameSite=Lax`, all Python routes are under `/api`, production is same-origin through the Vercel rewrite, and the gateway forwards all headers including `Cookie` (`render-gateway.mjs:181-183`). **So the cookie already reaches both Python services.** | (1) In both Python `auth.py` files, when no Bearer header is present, read `inferxe_admin_session` from the cookie and accept it **only** as an HS256 admin session (never as a Cognito token), through the existing database checks. (2) The frontend stops storing and sending the admin token, and uses `credentials: 'include'` with a non-secret session marker for the UI. (3) Only then remove `token` from the login JSON. SameSite=Lax already blocks cross-site POSTs; keep every state-changing route non-GET. | You; a multi-file change across the frontend and both services |
