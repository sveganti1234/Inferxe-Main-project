# Performance testing plan — Lighthouse and backend load tests

This is for the Inferxe team. It explains how to measure performance **without touching production data or running startup migrations against production**, and what was measured on 2026-11-27.

## 1. Frontend: Lighthouse-equivalent measurement

### Done now (no new dependencies)

`scratchpad/opt/vitals.mjs` drives the installed Chrome over the DevTools protocol against `vite preview` of the production build. It uses Lighthouse's mobile throttling (150 ms RTT, 1.6 Mbps down, 0.75 Mbps up, 4× CPU), a cold cache, and takes the median of 3 runs. **These are not Lighthouse scores**; they are the same Core Web Vitals, measured directly.

| Page | FCP | LCP | TBT | CLS | Transfer |
|---|---|---|---|---|---|
| `/` | 2.06 s | 4.29 s | 1,192 ms | **0.369** | 1,048 KB / 54 requests |
| `/pricing` | 2.05 s | 3.45 s | 584 ms | **0.368** | 812 KB / 44 requests |
| `/login` | 2.39 s | 2.70 s | 89 ms | 0.001 | 623 KB / 28 requests |

Timings vary with machine load (TBT especially); CLS and transfer are stable across runs.

**Diagnosis of CLS:** a single 0.367 shift of `FOOTER.footer` when the lazy page mounts, because the Suspense placeholder is `60vh` (`styles/layout.css:78-82`). The same build with `min-height: 100vh`, served by the same local server, gave **CLS 0.000** on both pages with the other metrics unchanged. The fix is handed to UI/UX (`TEAMMATE_REVIEW_SUMMARY.md`).

### Real Lighthouse, safely

- **Option A (manual, no install):** Chrome DevTools, then the Lighthouse panel, against a **Vercel preview deployment** (or `npm run preview` locally), in mobile mode, in an incognito window. Record Performance, LCP, TBT and CLS. Repeat 3 times and use the median.
- **Option B (CI):** run `npx lighthouse@<pinned version> <preview-url> --preset=perf --form-factor=mobile --output=json` in a CI job against the **preview** URL, and fail the job on budgets such as LCP > 4 s, CLS > 0.1 or TBT > 600 ms. This downloads Lighthouse at run time, so it isn't a project dependency.
- **Never against production during peak hours,** and never with a signed-in production account. Public pages are enough for the main bundle.

## 2. Backend: load tests on a non-production database

### The constraint

- **The notifications service** runs `init_db()` at **every startup** (`backend/notifications/main.py:44`): table creation, index creation and RLS hardening. It runs against the database it resolves in this order (`notifications/db.py:62-76`): `NOTIFICATIONS_DATABASE_URL`, then a non-local `DATABASE_URL`, then `SUPABASE_DATABASE_URL`.
- **Both Python services and the Node gateway** also call Supabase REST through `SUPABASE_URL` and the service-role key.

**So a load-test environment must override all of these:**

| Variable | Point at |
|---|---|
| `NOTIFICATIONS_DATABASE_URL`, `DATABASE_URL`, `SUPABASE_DATABASE_URL` | a staging or local Postgres |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` | a **staging Supabase project** (a Supabase branch, a separate free project, or a local Supabase stack via the Supabase CLI) |
| `INFERENCE_DEMO_MODE` | `true`, with no `NVIDIA_API_KEY`, so load tests never spend provider credits |
| `GPU_PROVIDERS` | `mock` (staging only) |

Run with a `.env.loadtest` file loaded explicitly. **Never** start the services from the normal `backend/.env` or root `.env` for load testing: those point at production. Before the first request, check the startup logs show the staging host.

### Tool

`backend/scripts/loadtest.mjs`, with tests in `backend/tests/loadtest.test.mjs`:
- No dependencies.
- Refuses any host that isn't localhost, unless it is listed in `LOADTEST_ALLOWED_HOSTS`.
- Prints requests per second, p50, p95, p99, max and the status mix.

Examples against a locally started gateway (`PORT=10000`, staging env):

```bash
node backend/scripts/loadtest.mjs --url http://127.0.0.1:10000/healthz --concurrency 20 --duration 30
node backend/scripts/loadtest.mjs --url http://127.0.0.1:10000/api/customer/workspace --concurrency 10 --duration 30 \
  --header "Authorization: Bearer <staging customer ID token>"
node backend/scripts/loadtest.mjs --url http://127.0.0.1:10000/api/admin/login --method POST --concurrency 10 --duration 20 \
  --header "Content-Type: application/json" --body '{"email":"<staging admin>","password":"wrong"}'
```

The last one checks that async Argon2 keeps the event loop free, and that the address-plus-email lockout responds 429 after the limit.

**Scenarios to record (before and after each change):**
1. `/healthz`, as a gateway overhead baseline.
2. Customer workspace load (Supabase-heavy).
3. Wallet history (notifications service with Postgres pool).
4. 10 concurrent wrong admin logins, while measuring `/healthz` latency at the same time.
5. Inference with demo mode (semaphore and threadpool behaviour).

**Resource usage:** run each service under `node --cpu-prof` or `py-spy record`, or watch `Get-Process node, python | Select CPU, WorkingSet` every second. Record peak memory and CPU per scenario.

### Not measured yet

Backend throughput, latency under load, CPU and memory. No staging Supabase project or local Supabase stack (which needs Docker) is available on this machine. Starting the services with the existing env files would run startup migrations against production, so it was not done.
