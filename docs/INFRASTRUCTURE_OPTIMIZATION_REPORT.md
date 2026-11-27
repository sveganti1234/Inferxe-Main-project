# Infrastructure optimization report — 2026-11-27

This is for the Inferxe team and whoever approves deployment changes. Nothing was deployed. Docker isn't installed on this machine, so **no image was built**. Each Dockerfile change below was checked as far as it can be without one, and is marked accordingly.

## Changes implemented (in the repo, not deployed)

| # | Change | Files | How it was verified |
|---|---|---|---|
| I-1 | **Reproducible Node install (Node only; Python stays unpinned until `requirements.lock` is wired in, P-2).** The image copies `backend/package-lock.json` and runs `npm ci --omit=dev` instead of `npm install --omit=dev`, which could resolve newer versions on every build. | `Dockerfile` | `npm ci --omit=dev` run against a copy of `backend/package.json` and `package-lock.json`: 36 packages installed, lockfile byte-identical afterwards. The lockfile also contains the Linux argon2 binaries (`@node-rs/argon2-linux-x64-gnu`/`-musl`), although Node 24 uses its built-in Argon2. |
| I-2 | **Smaller build context and image.** `.dockerignore` now excludes `backend/ml/`, the `backend/**/tests/` folders, `docs/`, `.claude/`, `.agents/` and `skills-lock.json`. | `.dockerignore` | `backend/ml` is not read at runtime (grep; RAG calls the model through Ollama by name). No runtime code imports from a test folder; `isolation_guard.py` sits outside them. About **39 MB** removed from the context: `backend/` goes from about 35 MB (excluding `node_modules`, already ignored) to under 5 MB. |
| I-3 | **Real health check.** `/healthz` returns 200 only when both Python workers accept TCP connections, and 503 with per-worker `reachable` otherwise. | `backend/scripts/render-gateway.mjs`, new `workerProbe.mjs` | Unit tests for the probe (listening port reachable; closed port unreachable within 2 s). The gateway itself was not started: it loads the real `.env`, and the notifications worker runs startup migrations against production. |
| I-4 | **Security headers (report-only CSP),** merged on top of teammate commit `48d3f1b`. That commit added three of the same headers, so this pass took the teammate's version of both `vercel.json` files and appended only `Permissions-Policy` and `Content-Security-Policy-Report-Only`. | `vercel.json`, `frontend/vercel.json` | Headless Chrome against the built app served with these headers: 14 routes, 0 CSP reports, 0 console errors (2026-11-26). The CSP comes from evidence: the live production bundle calls only same-origin `/api`, Cognito `cognito-idp.ap-south-1.amazonaws.com` and Google Fonts. HSTS is already sent by Vercel. |

**Effect of I-3 on deploys:** Render now waits until both workers actually listen before marking a deploy healthy. If one worker crash-loops, the deploy fails instead of serving degraded. That is intended, but watch the first deploy's logs.

## Prepared, not applied (needs approval or a container build)

| # | Change | Why it isn't applied | Exact change |
|---|---|---|---|
| P-1 | **Run as non-root** | It can't be verified without building the image. The runtime writes the SQLite customer database, its backups and the Chroma store under `/app/database` (`customerDatabase.js:10-19`, `rag/server.py:98-100`), so that folder must be writable. | Before `CMD`: `RUN mkdir -p /app/database && chown -R node:node /app/database`, then `USER node`. Verify with a Render preview deploy: admin login, a customer page, a chat message. |
| P-2 | **Pin Python dependencies** | Every line of `backend/requirements.txt` is `>=` (including `httpx2>=2.16.0`), so each deploy can pull new major versions. Pinning from this Windows machine's environment would not match Linux. | Generate pins inside the image (`pip freeze` in a Render shell, or `pip-compile` on Linux), commit `requirements.lock`, and install with `--require-hashes`. |
| P-3 | **Production GPU and demo settings** (`render.yaml`) | Production configuration change | Set `INFERXE_ENV: "production"`, so the production guards in `inference/auth.py` and `providers/registry.py` activate. Set `GPU_PROVIDERS: ""` (no real provider is configured; JarvisLabs credentials are absent) instead of `"mock"`, and `INFERENCE_DEMO_MODE: "false"`. Also change the gateway default `INFERENCE_DEMO_MODE: process.env.INFERENCE_DEMO_MODE \|\| 'true'` (`render-gateway.mjs:152`) to `'false'`. Effect: GPU launches fail honestly until a real provider exists, instead of creating simulated GPUs. |
| P-4 | **One Vercel config** | Which file Vercel uses depends on the project's Root Directory setting, which the repo doesn't show | Check the setting in Vercel, then delete the unused file. Both carry identical headers until then. |
| P-5 | **`ALLOW_VERCEL_PREVIEW_ORIGINS=false`** | Deferred by you, pending a list of preview deployments that call Render cross-origin | `render.yaml:29` |
| P-6 | **GPU health persistence** | GPU Health owner plus infrastructure | Declare `DATABASE_URL` (`sync: false`) on Render, or make `inference/database.py` fall back to `SUPABASE_DATABASE_URL` |

## Configuration findings (production GPU)

| Setting | Current (`render.yaml`) | Effect |
|---|---|---|
| `GPU_PROVIDERS` | `"mock"` | Production offers **simulated GPUs** |
| `INFERENCE_DEMO_MODE` | `"true"` (and the gateway defaults to `'true'`) | If the NVIDIA key is ever missing, customers silently get simulated answers |
| `INFERXE_ENV` / `APP_ENV` / `ENVIRONMENT` | not set (only `NODE_ENV=production`) | The production guards added in `81a9fc1` (registry) and those in `inference/auth.py` don't activate |
| JarvisLabs credentials | not declared | No real GPU provider can run; real provider integration is deferred |

## Remaining infrastructure risks

- **No image build was verified here:** the first build after I-1 and I-2 should be watched on Render.
- **`/healthz` probes TCP only:** a worker that listens but errors on every request still counts as healthy. An HTTP probe of each worker's own health route would be stricter.
- **The container runs as root** until P-1 lands.
- **Python dependencies are unpinned** (P-2).
- **Simulated GPUs and demo inference on production** (P-3).

---

## Update — follow-up review (2026-11-27, later)

There is still no Docker, Podman or WSL on this machine, so no image could be built.

| Item | State | Artifact |
|---|---|---|
| Production GPU and demo settings | **Prepared, not applied.** Adds `INFERXE_ENV=production`, sets `GPU_PROVIDERS: ""` and `INFERENCE_DEMO_MODE: "false"`, and changes the gateway default to `'false'`. Development is unaffected: it runs through `backend/scripts/dev-backend.mjs`, which has its own defaults and never reads `render.yaml`. `git apply --check` passes. | `docs/proposals/render-production-gpu.patch` |
| Non-root container | **Prepared, not applied.** `mkdir -p /app/database/backups /app/database/chroma_db && chown -R node:node /app/database`, `ENV HOME=/home/node`, `USER node`. Write locations were checked: only `/app/database` (SQLite customer database and backups, Chroma store). No local model cache (embeddings and generation are in Ollama). Bytecode writing is off. Port 10000 needs no root. `git apply --check` passes. | `docs/proposals/dockerfile-nonroot.patch` |
| Python pins | **Generated, not wired in.** 105 exact versions for CPython 3.11 manylinux x86_64, resolved with pip's cross-platform dry run. The 48 versions installed in the environment the Python suites pass on were held fixed (e.g. `fastapi` 0.141.1, `sqlalchemy` 2.0.52). An unpinned build today would install `fastapi` 0.165 and `sqlalchemy` 2.1.9. The lock resolves to exactly itself. No hashes yet: regenerate them inside a real image build. | `backend/requirements.lock` |

**Deployment impact of the render patch:**
- GPU launch requests fail with "no provider" until a real provider is configured.
- Inference without `NVIDIA_API_KEY` returns an error instead of simulated text.
- Test mode stays refused.
- Customers no longer receive simulated GPUs.

**Separately**, the frontend shows `SAMPLE_GPU_LISTINGS` on the GPU marketplace in production builds while `gpu_listings` is empty. That's a GPU-marketplace UI fix, handed to Diya.

**To use the lock:** in the Dockerfile, `COPY backend/requirements.lock` and run `pip install -r backend/requirements.lock`. This needs a Render preview build first.
