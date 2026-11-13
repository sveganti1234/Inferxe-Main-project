# Architecture Overview & Project Structure

The codebase is organized into three clean tiers:

```
Sahith project/
├── frontend/             # React 19 + TypeScript + Vite Web Application
│   ├── public/           # Static assets, logos, and images
│   ├── src/              # Components, pages, styles, hooks, and client state
│   ├── index.html        # Web page template
│   ├── vite.config.ts    # Vite bundler configuration
│   ├── tsconfig.json     # Frontend TypeScript configuration
│   └── package.json      # Frontend dependencies & scripts
│
├── backend/              # Node.js & Python Services
│   ├── auth/             # Admin Authentication service & JWT crypto
│   ├── rag/              # Python FastAPI RAG Service & tests
│   ├── search/           # Web search grounding service
│   ├── ml/               # LoRA fine-tuning & model evaluation
│   ├── requirements.txt  # Python backend requirements
│   └── package.json      # Backend service scripts
│
├── database/             # Vector Database & Data Assets
│   ├── chroma_db/        # ChromaDB vector database
│   ├── datasets/         # Curated datasets (hardware, pricing, models, knowledge, training)
│   ├── scripts/          # Ingestion, scraping, and vector indexing scripts
│   └── config/           # Guardrails & dataset metadata
│
├── docs/                 # Documentation & reference specifications
├── package.json          # Root workspace runner
└── start-website.bat     # Windows launcher script
```

---

# Inferxe Website — Engineering & Concept Reference

> **Inferxe — "One API, many GPU providers."** A product of **Automatrix** · www.inferxe.com
>
> This document explains **every feature and every module** of this codebase — how it works technically, and the theory
> behind it (the product ideas, the GPU/LLM maths, the cost model, the risk model, and the design-system principles).

**Contents**

- [Part 0 — Run commands](#part-0--run-commands)
- [Part I — Overview](#part-i--overview) · [Features](#3-feature-index) · [Source mapping](#4-source-material--site-mapping)
- [Part II — Theory](#part-ii--theory-the-ideas-behind-the-site) (product · placement · LLM memory · throughput · cost · risk · design · motion)
- [Part III — Architecture](#part-iii--architecture)
- [Part IV — Module reference](#part-iv--module-reference) (lib · data · styles · app shell · UI · visuals · widgets · pages)
- [Part V — Cross-cutting concerns](#part-v--cross-cutting-concerns)
- [Part VI — Operating & extending](#part-vi--operating--extending) (config · deploy · recipes · checklist · glossary)

---

# Part 0 — Run commands

Everything below is run **from the repository root folder** — the one that contains `package.json`.

**Prerequisites:**
- Node.js 20+ (`node --version`)
- Python 3.11+ (`python --version`) with dependencies from `backend/requirements.txt` (in `.venv311`, `.venv`, or system Python — no manual venv activation required by `npm run dev:backend`)

## 0.1 Team setup (one-time per laptop)

```bash
# 1. Install JS dependencies (root + frontend)
npm install

# 2. Install Python backend dependencies (recommended: .venv311 or .venv)
python -m pip install -r backend/requirements.txt

# 3. Configure environment files (do not commit .env files)
#    - Copy backend/.env.example -> backend/.env and fill shared Supabase, Cognito, and NVIDIA keys
#    - Copy frontend/.env.example -> frontend/.env and fill public VITE_COGNITO_* keys
```

## 0.2 Two-command local workflow

Open two terminals from the repository root:

**Terminal 1 — Unified Python Backends (Ports `8000` & `8001`):**
```bash
npm run dev:backend
```
Starts both `backend.notifications.main:app` (`http://127.0.0.1:8000`, shared Supabase PostgreSQL + RAG `/api/chat`) and `inference.main:app` (`http://127.0.0.1:8001`, API keys, SSH keys, notebooks, NVIDIA inference via Supabase REST) automatically using the first valid workspace `.venv311` / `.venv` or system Python.

**Terminal 2 — Frontend & Auth Middleware (Port `5173`):**
```bash
npm run dev
```

Open **http://127.0.0.1:5173** (or `http://localhost:5173`). Vite proxies `/api/v1/*` → `8001`, `/api/notifications`, `/api/wallet`, `/api/deployments`, `/api/gpu`, `/api/workspace`, `/api/chat`, `/api/health` → `8000`, and serves `/api/auth/*` + `/api/admin/*` directly.

**Windows one-click:** double-click **`start-website.bat`**. It starts `npm run dev:backend` (ports `8000` & `8001`), opens your browser, and starts `npm run dev`.

## 0.3 Every command

| Command | What it does | When to use it |
| --- | --- | --- |
| `npm install` | Installs root and workspace dependencies from `package.json` / `package-lock.json`. | First run, or after pulling changes that touch `package.json`. |
| `npm run dev:backend` | Validates env & Python runtime, then launches Notifications+RAG (`8000`) and Inference (`8001`). Pass `-- --with-search` to also start web search (`8765`), or `-- --check` to validate setup. | Whenever running the app locally. |
| `npm run dev` | Starts Vite's dev server on `127.0.0.1:5173` with hot reload, API proxies, and SSO/Admin auth middleware. | Day-to-day development and demos. |
| `npm run typecheck` | Runs `tsc --noEmit` — strict TypeScript type-check, no output files. | Before committing; fast sanity check. |
| `npm run build` | `tsc --noEmit && vite build` → optimised production bundle in `dist/`. | Before deploying; fails on any type error. |
| `npm run preview` | Serves the built `dist/` on `127.0.0.1:4173` with backend proxies & auth middleware. | Verify the production build locally (run `npm run build` first). |
| `start-website.bat` | Windows launcher: starts backend (`8000` & `8001`), opens browser, runs `npm run dev`. | Non-developers / demos. |

## 0.4 Useful variations

```bash
# Run from the PARENT folder (…/website inferxe) without cd-ing in
npm --prefix inferxe-website run dev

# Use a different port (Vite flags go after --)
npm run dev -- --port 3000
npm run dev -- --port 3000 --open            # also opens the browser

# Expose on your local network (phone / other laptop on the same Wi-Fi)
npm run dev -- --host 0.0.0.0                # then browse to http://<your-LAN-IP>:5173

# Production build, then serve it
npm run build
npm run preview                              # http://127.0.0.1:4173
npm run preview -- --port 8080               # custom port

# Serve dist/ with any static server (SPA fallback needed — see Deployment)
npx serve dist -s -l 5000                    # -s = single-page-app fallback

# Pass the contact-form endpoint for one run (bash / Git Bash)
VITE_FORM_ENDPOINT=https://formspree.io/f/xxxx npm run dev

# PowerShell equivalent
$env:VITE_FORM_ENDPOINT = "https://formspree.io/f/xxxx"; npm run dev

# Type-check only (what CI should run)
npm run typecheck

# Clean reinstall if something is corrupted
rm -rf node_modules package-lock.json && npm install      # bash
# PowerShell: Remove-Item -Recurse -Force node_modules, package-lock.json; npm install
```

## 0.4 Stopping the server & troubleshooting

| Situation | Fix |
| --- | --- |
| Stop the dev server | Press **Ctrl + C** in the terminal that is running it. |
| `Port 5173 is already in use` | Another instance is running. Stop it, or use `npm run dev -- --port 5174`. Find the process: PowerShell `Get-NetTCPConnection -LocalPort 5173 \| Select OwningProcess`, then `Stop-Process -Id <pid>`. |
| Page is blank for several seconds on first load | Normal on a cold start — Vite is compiling the lazy route chunk. A pulsing green LED means a route is loading. |
| `'vite' is not recognized` | Dependencies are not installed — run `npm install`. |
| Typecheck errors after editing | Run `npm run typecheck`; strict mode also flags unused variables/imports. |
| White/unstyled flash or stale CSS | Hard refresh (**Ctrl + Shift + R**); if it persists, restart the dev server. |
| Contact form says "nothing was sent" | Expected until `VITE_FORM_ENDPOINT` is set (see [Configuration](#30-configuration)). |
| `npm run build` fails on types but `dev` works | `dev` does not type-check; `build` does. Fix the reported TS errors. |
| Production URL 404s on refresh (e.g. `/pricing`) | The host needs an SPA fallback (all routes → `index.html`) — see [Deployment](#31-deployment). |

---

# Part I — Overview

## 1. What this project is

A **marketing + product website** for Inferxe, built from two source documents supplied in the parent folder:

- **`GPU Infrastructure Marketplace — NVIDIA Credits Pitch Deck.pptx`** (10 slides) — problem, solution, how it works, architecture, NVIDIA fit, market, business model, plan, credit request.
- **`Final_DPR_LLM_Inference_Marketplace 2.docx`** (Detailed Project Report, 16 chapters) — scope, architecture, GPU provider strategy, database, API, tech stack, risk register, timeline, future scope, pricing, references.

It is not just brochure copy. It contains **working interactive models** of the product's core ideas — a VRAM-fit GPU recommender, a routing simulator, a model-to-GPU matrix, a
cost estimator, a token-price calculator, an API explorer and a risk matrix — so a visitor can *experience* the decision layer rather than read about it.

## 2. Stack at a glance

| Layer | Choice | Why |
| --- | --- | --- |
| Build tool | **Vite 7** | Instant dev server (native ESM), fast production builds, trivial config. |
| UI | **React 19** + **TypeScript 5.9 (strict)** | Matches the DPR's frontend choice (React + TypeScript); strict mode catches data-shape errors early. |
| Routing | **React Router 7** (`react-router-dom`) | Client-side routes, `Routes location` keyed for animated transitions. |
| Motion | **Framer Motion 12** | Declarative springs, scroll-linked values, `AnimatePresence` exit animations, reduced-motion support. |
| Icons | **lucide-react** | Tree-shaken SVG icons, consistent stroke style. |
| Fonts | **@fontsource** (Rubik, IBM Plex Sans, JetBrains Mono) | The pitch deck's exact typefaces, self-hosted (no third-party font requests). |
| Styling | **Hand-written CSS** (no framework) | Full control of glass / skeuomorphic effects; design tokens as CSS variables. |
| Imagery | 19 Unsplash photos → WebP | Optimised, self-hosted, lazy-loaded. |

No backend, no database, no runtime API calls (except the optional contact-form POST). Everything is static and deployable to any static host.

## 3. Feature index

| # | Feature | Where it lives | What it demonstrates |
| --- | --- | --- | --- |
| 1 | **Animated hero with 3D GPU card** | `pages/Home.tsx` (`Hero`), `visuals/GpuCardArt.tsx`, `ui/Tilt.tsx` | Brand promise; skeuomorphic hand-built SVG GPU with spinning fans; mouse-driven 3D parallax; floating glass chips computed from the real engine. |
| 2 | **GPU Placement Console** | `widgets/GpuStudio.tsx`, `widgets/Dial.tsx`, `lib/calc.ts` | Compatibility-then-score recommender with real memory maths; faders, rotary dial, live results. |
| 3 | **Routing Simulator** | `widgets/Simulator.tsx` | Step-by-step "placement trace" incl. a clean rejection for impossible workloads. |
| 4 | **Model-to-GPU Compatibility Matrix** | `widgets/CompatMatrix.tsx` | 7 models × 4 GPUs; precision/context/concurrency sliders; marks the smallest fitting GPU. |
| 5 | **Cost Estimator** | `widgets/PricingTools.tsx` (`CostEstimator`) | Monthly cost from the DPR's planning rates, with presets. |
| 6 | **Token-equivalent Price Calculator** | `widgets/PricingTools.tsx` (`TokenCostCalc`) | GPU-hour → effective ₹ per 1M tokens (the DPR's normalization idea). |
| 7 | **Rate-range visual** | `widgets/PricingTools.tsx` (`RateRanges`) | Provider on-demand range vs suggested list rate on one axis. |
| 8 | **API Explorer** | `widgets/ApiExplorer.tsx`, `data/api.ts`, `ui/CodeBlock.tsx` | 13 endpoints; auto-generated cURL / Python / TypeScript; sample responses computed by the engine. |
| 9 | **Risk Matrix** | `widgets/RiskMatrix.tsx` | The DPR's 15-risk register on a 5×5 likelihood × impact grid. |
| 10 | **Architecture "rack"** | `widgets/RackStack.tsx` | The 4-layer architecture as rack-mounted hardware units with LEDs. |
| 11 | **Console preview** | `widgets/ConsolePreview.tsx` | Mock dashboard: KPIs, sparklines, area chart, typed LLM reply, deployments table. |
| 12 | **5-stage pipeline** | `widgets/PipelineSteps.tsx` | Auto-advancing steps with sample payloads. |
| 13 | **Routing diagram** | `visuals/RoutingDiagram.tsx` | Animated one-API → control plane → adapters → many providers. |
| 14 | **12-week Gantt** | `widgets/Gantt.tsx` | MVP tracks and the 9 delivery phases. |
| 15 | **Scroll timeline** | `widgets/Timeline.tsx` | 11-step workflow whose rail fills as you scroll. |
| 16 | **Adapter-contract panel** | `widgets/AdapterContract.tsx` | The provider-adapter contract (catalogue, capacity, lifecycle, errors). |
| 17 | **Bar charts** | `widgets/BarChart.tsx` | Memory capacity and bandwidth per GPU. |
| 18 | **Contact form** | `widgets/ContactForm.tsx`, `lib/api.ts` | Validated form, graceful success/error states, pluggable endpoint. |
| 19 | **Command palette (Ctrl/⌘ + K)** | `layout/CommandPalette.tsx`, `data/site.ts` (`PAGE_INDEX`) | Keyboard-first site navigation. |
| 20 | **Mega-menu navbar + mobile drawer** | `layout/Navbar.tsx` | Hover-intent dropdowns, focus management, responsive drawer. |
| 21 | **Animated page transitions** | `App.tsx` | Fade/slide between routes via `AnimatePresence`. |
| 22 | **Scroll progress bar & ambient background** | `layout/Ambient.tsx` | Aurora blobs, masked grid, film grain, spring-smoothed progress. |
| 23 | **Design system** | `styles/*.css` | Tokens, glassmorphism, skeuomorphic plates/wells/LEDs/faders/knobs, "paper" neumorphic sections. |
| 24 | **Draft legal pages & 404** | `pages/Legal.tsx`, `pages/NotFound.tsx` | Privacy/Terms (draft) grounded in the DPR; themed 404. |
| 25 | **SEO + social sharing** | `index.html`, `public/*`, `lib/hooks.ts` | Per-route titles/descriptions, Open Graph image, sitemap, robots. |
| 26 | **Authentication System** | `pages/Login.tsx`, `lib/authStore.ts`, `styles/auth.css` | Sign in, Sign up, and Forgot password with form validation, session persistence, demo auto-logins, and direct dashboard transition. |
| 27 | **Control Plane Dashboard & Add User** | `pages/dashboard/AddUser.tsx`, `pages/dashboard/UsersList.tsx`, `components/dashboard/DashboardLayout.tsx` | Full enterprise control plane layout, RBAC permission assignment, temporary password generator, monthly spend caps, and users directory. |

## 4. Source material → site mapping

| Pitch-deck slide | Used on |
| --- | --- |
| 1 Title — "One API, many GPU providers" | Home hero, `index.html`, OG image |
| 2 Problem — fragmented GPU access | Home › *Problem* (`PROBLEMS`) |
| 3 Solution — Cost / Speed / Policy | Home › *Solution* (`INTENTS`), the console's dial |
| 4 How it works — 5 stages | Home › *How it works*, `/how-it-works` (`STEPS`, `PipelineSteps`) |
| 5 Architecture — 4 layers | Home › *Architecture* rack (`LAYERS`, `RackStack`) |
| 6 NVIDIA fit — L4…GB200 | Home › *NVIDIA fit*, `/gpus` (`GPUS`) |
| 7 Market & moat | `/company` (`MARKET`, `MOAT`) |
| 8 Business model — 5 streams | `/pricing` (`STREAMS`), Home pricing teaser |
| 9 Plan — MVP & roadmap | `/roadmap`, Home roadmap teaser (`MVP_TRACKS`, `PHASES`) |
| 10 The ask — benchmarks | `/gpus` › *Benchmark programme* (`BENCH_METRICS`, pillars) — the credit request itself is **not** published |

| DPR chapter | Used on |
| --- | --- |
| §2 Executive summary, §4 Product definition | `/company` vision, `/solutions` |
| §3 Market landscape | `/company` market, `/roadmap` India providers (`INDIA_PROVIDERS`) |
| §5 Architecture & workflow | `/how-it-works` (`E2E_STEPS`, `ARCH_LAYERS`, `FLOW_NODES`, `LIFECYCLE`) |
| §6 Local LLM / vLLM | `/platform` vLLM section, `/how-it-works` natural-language search |
| §7 GPU strategy, pricing | `/gpus`, `/pricing`, `CRITERIA`, `PRICING_MODELS` |
| §8 Database | `/platform` data foundation (`DATA_ENTITIES`) |
| §9 API design | `/developers` (`ENDPOINTS`, `ERRORS`, `RELIABILITY_PRACTICES`) |
| §10 Technology stack | `/company` stack table (`STACK`) |
| §11 Risk management | `/security` (`RISKS`, `KRIS`, `RISK_OWNERS`) |
| §12 Timeline | `/roadmap` (`DELIVERY_PHASES`) |
| §13 Future scope | `/roadmap` (`FUTURE_SCOPE`) |
| §14 Pricing & financials | `/pricing` (rates, estimator) |
| §16 References | `/company` research foundations (`REFERENCES`) |

---

# Part II — Theory: the ideas behind the site

## 5. The product idea in one page

**Problem.** Running an LLM on a GPU means answering a chain of infrastructure questions: *which GPU model, how much VRAM, which provider, what price model, is there capacity, how do
I deploy and serve it?* Each provider has its own SKUs, APIs and billing units, and there is little comparable performance data. The customer is forced to become an infrastructure
planner before generating a single token.

**Idea — a decision layer.** Existing marketplaces *rent or aggregate capacity*. Inferxe sits **above** them as a *control plane*: the customer states **what the workload needs**
(model, memory, latency, budget, region, policy) and the platform decides **where it runs**. Three archetypal intents:

| Intent | Statement | Mechanism |
| --- | --- | --- |
| **Cost** | "Give me the cheapest GPU that can run this workload." | Filter by hard constraints → choose the minimum price. |
| **Speed** | "Give me the fastest available GPU within my budget." | Filter → apply budget cap → choose maximum throughput. |
| **Policy** | "Run this model in India with a specified latency target." | Region/latency become **constraints** that shrink the candidate set. |

**The five-stage pipeline** (deck slide 4): *Describe workload → Filter by compatibility → Score and select → Provision through adapter → Run, observe, learn.*

**Honest positioning.** In the MVP the platform has **one** provider (JarvisLabs) behind a **mock adapter** and contract tests; more providers arrive in Phase 2. The site says so everywhere
("Live in MVP · JarvisLabs", "Phase 2" chips). "Many providers" is the architecture and roadmap, not a claim of current supply.

## 6. Placement theory: constraints, scores, adapters, state

### 6.1 Hard constraints vs soft preferences

A placement problem has two kinds of requirements and they must **not** be mixed in one formula:

- **Hard constraints** — binary, non-negotiable: *does the model fit in memory? is the region allowed? does the provider meet security/compliance requirements?* A GPU that
  fails one is **removed**; no amount of "cheapness" compensates for an out-of-memory crash.
- **Soft preferences** — continuous, trade-off-able: price, throughput, latency, availability, reliability, integration quality (DPR §7.5 lists nine criteria with weights
  *Mandatory / High / Medium*).

This is the classical **filter-then-rank** (a.k.a. *satisficing then optimising*) structure. It is why the platform describes itself as "compatibility is deterministic,
routing is scored" — the first step is a pure predicate (auditable, testable, explainable); only the survivors enter the weighted scoring. The `Platform` page's criteria list
renders the weights as 3-/2-/1-segment meters to make this visible.

### 6.2 Provider abstraction (ports & adapters)

Each provider exposes different APIs. Inferxe defines **one contract** — *catalogue, capacity, lifecycle, errors* — and writes one **adapter** per provider that translates
to it (the *Adapter* / *hexagonal architecture* pattern). Consequences the site highlights:

- Adding a provider = adding an adapter; the public API, console and customer workflows don't change.
- A **mock adapter** + **contract tests** let the whole platform be tested without spending GPU money.
- Provider errors are mapped to platform-standard errors (400/401/403/404/409/429/500/502/503/504), so clients never parse provider-specific messages.

### 6.3 Explicit lifecycle states

Provisioning is a distributed, failure-prone operation. Modelling each deployment as an explicit **state machine** (Requested → Validating → Provisioning → Deploying → Running →
Stopping → Terminated, plus a Failed branch that cleans up) gives: idempotency (a retry in `Provisioning` doesn't double-provision), no orphaned GPUs (every non-terminal state has an owner
and a timeout), and an audit trail. The `/how-it-works` page renders this as a simplified diagram (labelled *illustrative*).

### 6.4 Two-stage natural-language search

DPR §6.9: an open-weight LLM (served by vLLM) *interprets* free text into **structured requirements**; a **deterministic** engine then does eligibility filtering and ranking. The
division of labour is deliberate — *the LLM understands the user; the platform decides which GPUs match; the provider supplies the GPU* — so a hallucinating model can never
provision hardware or pick a wrong-sized GPU on its own.

## 7. LLM memory theory (what "does it fit?" means)

A model served for inference needs GPU memory for three things:

```
need = weights + KV cache + runtime overhead
```

**Weights.** `parameters × bytes-per-parameter`. Precision sets bytes: FP16/BF16 = 2, FP8/INT8 = 1, INT4 (AWQ/GPTQ, including quantization scales) ≈ 0.56.
Llama 3.1 8B at FP16 → 8.03 B × 2 = **16.06 GB**.

**KV cache.** During generation each transformer layer stores a **Key** and a **Value** vector for every token already seen, so attention doesn't recompute them. Per token:

```
kvBytesPerToken = 2 (K and V) × layers × kvHeads × headDim × bytesPerElement(2 for FP16)
```

For Llama 3.1 8B: `2 × 32 × 8 × 128 × 2 = 131,072 B` (128 KiB) per token. **Grouped-Query Attention (GQA)** shares each K/V head among several query heads — Llama 3.1 has
32 query heads but only 8 KV heads — which cuts the cache 4×. That is why `kvBytesPerToken` differs per model in `data/gpus.ts` (Qwen2.5-7B has only 4 KV heads → 57,344 B;
Llama 3.1 70B → 327,680 B).

Total cache = `context × concurrency × kvBytesPerToken`. The site uses the **worst case** — *every concurrent request at full context length* — because under-provisioning
causes out-of-memory failures while over-provisioning only costs money. (Real servers use **PagedAttention** and **continuous batching** in vLLM to pack sequences efficiently;
the worst case is a safe upper bound.)

**Runtime overhead.** CUDA context, activation buffers, fragmentation. Modelled as `2 GB + 4 % of weights` — a conservative planning constant, not a measurement.

**Usable memory.** vLLM's `gpu_memory_utilization` defaults to **0.9** — it deliberately leaves ~10 % free. So a configuration *fits* iff `need ≤ 0.9 × (VRAM × GPU-count)`.

**Multi-GPU.** Models too large for one GPU are sharded with **tensor parallelism**. The site only considers 1, 2, 4 and 8 GPUs (powers of two) because tensor-parallel degree must
evenly divide the attention-head count.

**Worked example** (the default console state — Llama 3.1 8B, FP16, 8K context, 8 concurrent):

| Term | Calculation | Result |
| --- | --- | --- |
| Weights | 8.03 × 2 | 16.06 GB |
| KV cache | 8,192 × 8 × 131,072 B | 8.59 GB |
| Overhead | 2 + 0.04 × 16.06 | 2.64 GB |
| **Need** | sum | **27.29 GB** |
| L4 (24 GB) | usable 21.6 GB | ✗ does not fit |
| L40S (48 GB) | usable 43.2 GB → headroom 1 − 27.29/43.2 | ✓ **37 %** |

A 70B model at FP16 with 8K × 8 needs ≈ 170 GB → no single GPU, and 2×H100 (144 GB usable) is still too small, so the engine proposes 4×H100.

## 8. Throughput theory: why bandwidth, not just VRAM

LLM inference has two phases: **prefill** (process the prompt in parallel — compute-bound) and **decode** (generate one token at a time — **memory-bandwidth-bound**).
Each decoded token must stream *all the weights* from GPU memory through the compute units once. By the **roofline model**, per-stream decode speed is bounded by:

```
tokens/sec  ≲  memory bandwidth ÷ bytes of weights
```

For Llama 3.1 8B FP16 (16.06 GB) on an L40S (864 GB/s): 864 ÷ 16.06 ≈ **54 tok/s**; on an H100 (≈ 3.35 TB/s) ≈ 209; on an H200 (≈ 4.8 TB/s) ≈ 299. The site calls this the
**decode ceiling** and labels it an *upper bound, not a benchmark* — real throughput is lower (kernel efficiency, KV reads, batching effects) and is exactly what the
benchmark programme will **measure**. Multi-GPU configurations apply an efficiency factor of 0.8 for interconnect overhead.

Why it matters for routing: **Speed** mode ranks by this ceiling, and **Policy** mode uses it as a stand-in for a latency target ("≥ N tokens/sec per stream"). It is also why the
catalogue page charts **bandwidth** next to **capacity**.

## 9. Cost theory

**Infrastructure cost.** `GPU-hours × hourly rate (+ storage / network / platform charges)`. The estimator multiplies *hours/day × days/month × GPU count × rate*.

**Customer price.** `Customer price = provider cost + service fee` (deck slide 8) — a platform fee on GPU consumption, with later streams (managed inference fee, enterprise
subscription, reserved-capacity margin, provider revenue share) introduced in phases.

**Normalization.** Providers bill per token, per GPU-hour/minute, per request or per reserved block. To compare them, the DPR defines a common metric — *normalized cost per 1M
tokens* — and notes that GPU-time pricing must be converted using **measured** throughput:

```
effective ₹ per 1M tokens  =  hourly rate ÷ (tokens per second × 3600 × utilization) × 1,000,000
```

Example (calculator defaults): ₹100/hr, 900 tok/s aggregate, 70 % utilized → 900 × 3600 × 0.7 = 2.268 M tokens/hr → **≈ ₹44 per 1M tokens**.

**Concurrency amortization.** A dedicated GPU costs the same per hour whether it serves 1 or 64 requests. At low concurrency the per-token price is high (near-exclusive
allocation); at high concurrency the hourly rate is spread across many requests, making dedicated GPU time competitive with per-token APIs.

**Estimated vs actual.** *Estimated = expected usage × normalized price* (before running). *Actual = recorded usage × applicable price* (after), including minimum billing
increments, and reconciled against provider data. Surfacing both prevents "billing surprise" (risk R-08).

## 10. Risk theory

The DPR scores each risk **Likelihood (1–5) × Impact (1–5) = Score (1–25)** and bands it: **Low 1–4 · Medium 5–9 · High 10–16 · Critical 17–25**. The lifecycle is
*identify → assess → prioritise → mitigate → monitor*, with **Key Risk Indicators** (provider error rate, vLLM error rate, P95/P99 latency, queue/resource utilization, auth
failures, unusual volume, usage-cost variance, deployment failure rate) turning drift into action, and **named owners** per area. The 15 risks cluster as: (L3, I5) ×3 · (L4, I4) ×1 ·
(L3, I4) ×6 · (L2, I5) ×4 · (L3, I3) ×1 — which is exactly what the matrix on `/security` shows.

## 11. Design theory: glassmorphism, skeuomorphism, motion

### 11.1 Colour & type
The palette comes straight from the deck: graphite-green neutrals (`#0F1511`, `#18211B`) with signal green `#76B900`. Secondary hues (cyan, amber, violet, red) are reserved for **data
encoding** (status, series, severity) so green always means "brand / OK". **Rubik** (headings) gives a friendly-technical voice; **IBM Plex Sans** is the neutral reading face;
**JetBrains Mono** carries labels, numbers and code — signalling "instrument readout".

### 11.2 Glassmorphism
A *glass* surface = **translucent fill** (a diagonal white gradient at 2–8 % alpha) + **backdrop blur & saturation** (`backdrop-filter: blur(22px) saturate(150%)`) + **a thin
edge light** (a 1 px gradient border masked in with `mask-composite`) + **soft shadow**. The blur separates the surface from the busy photo/gradient beneath it so text stays legible;
the edge light implies a thick pane catching light. A **cursor spotlight** (CSS variables `--mx/--my` updated on `mousemove`, no React re-render) adds tactile depth.

### 11.3 Skeuomorphism
Skeuomorphic UI borrows from physical objects so controls announce *how they work*. The system uses a consistent **top-lit lighting model**: raised things get a light top edge
(`inset 0 1px 0 rgba(255,255,255,…)`) and dark bottom edge; recessed things (inputs, readouts) invert it with deep inset shadows. Components:
**plate** (brushed metal with screws), **well** (recessed LCD-style readout), **LED** (glowing status), **fader** (slider with a metal cap), **dial** (rotary selector),
**seg** (rocker switch), **rack unit** (server chassis), and the **bevelled primary button**. A light **"paper" / neumorphic** variant (`.neo`) is used for money-related sections for rhythm.

### 11.4 Motion principles
- **Purposeful** — motion explains structure (stagger = sibling groups; scroll-linked rails = progress; springs = physical controls).
- **One easing curve** — `cubic-bezier(0.22, 1, 0.36, 1)` ("ease-out-expo-like") everywhere for cohesion.
- **Springs for physical objects** (dial, tilt, risk-cell dots); **tweens** for reveals.
- **Reveal once** — scroll reveals fire once (`viewport.once`) to avoid distracting re-animation.
- **Respect the user** — `MotionConfig reducedMotion="user"` plus a global CSS `prefers-reduced-motion` rule disable transforms and loops.

---

# Part III — Architecture

## 12. Repository layout

```
website inferxe/                     ← parent folder (source documents + editor config)
├─ GPU Infrastructure Marketplace — NVIDIA Credits Pitch Deck.pptx
├─ Final_DPR_LLM_Inference_Marketplace 2.docx
├─ .claude/launch.json               ← dev-server preset for the Claude desktop preview
└─ inferxe-website/                  ← THIS PROJECT
   ├─ index.html                     ← shell: meta, OG tags, root div
   ├─ package.json · package-lock.json · tsconfig.json · vite.config.ts
   ├─ start-website.bat              ← Windows one-click launcher
   ├─ README.md                      ← this file
   ├─ public/                        ← copied verbatim to the site root
   │  ├─ favicon.svg · og-image.png · robots.txt · sitemap.xml
   │  └─ images/*.webp               ← 19 optimised photos
   └─ src/
      ├─ main.tsx                    ← entry: fonts, CSS order, Router
      ├─ App.tsx                     ← shell, routes, transitions, scroll manager
      ├─ lib/        calc.ts · hooks.ts · api.ts
      ├─ data/       site.ts · gpus.ts · content.ts · api.ts
      ├─ components/
      │  ├─ layout/    Navbar · Footer · Ambient (+ScrollProgress) · CommandPalette
      │  ├─ ui/        Glass(+Plate) · Reveal(+Stagger,SplitHeading) · Button · Counter · Tilt · CodeBlock · SectionHead · Accordion
      │  ├─ visuals/   GpuCardArt · RoutingDiagram
      │  ├─ widgets/   GpuStudio · Dial · Simulator · CompatMatrix · PricingTools · ApiExplorer · RiskMatrix · RackStack · PipelineSteps …
      │  └─ Logo · PageHero · CtaBand
      ├─ pages/      Home · Platform · HowItWorks · Gpus · Solutions · Pricing · Developers · Security · Roadmap · Company · Contact · Legal · NotFound
      └─ styles/     tokens · base · surfaces · layout · widgets · pages · inner · how · gpus · pricing · dev · security · company · contact
```

~13,000 lines of TS/TSX/CSS across 68 source files.

## 13. Runtime architecture

```
index.html
  └─ /src/main.tsx
       ├─ imports fonts + 14 CSS files (order = cascade order)
       └─ <StrictMode><BrowserRouter><App/></BrowserRouter></StrictMode>

App.tsx  (MotionConfig reducedMotion="user")
  ├─ <Ambient/>            fixed background layers
  ├─ <ScrollProgress/>     2 px spring-smoothed progress bar
  ├─ <Navbar/>             fixed header, mega-menus, mobile drawer
  ├─ <CommandPalette/>     Ctrl/⌘+K modal (listens for window events)
  ├─ <ScrollManager/>      scroll-to-top or to #hash on navigation
  ├─ <AnimatePresence mode="wait">
  │    └─ <motion.main key={pathname}>          ← remounts per route ⇒ exit/enter animation
  │         └─ <Suspense fallback=<LED/>>
  │              └─ <Routes location={location}> ← lazy page chunks
  └─ <Footer/>

Data flow (one-way, no global store):
  data/*.ts (static typed constants)  ─┐
  lib/calc.ts (pure functions)  ───────┼─►  widgets (local useState)  ─►  pages  ─►  DOM
  lib/hooks.ts (usePageMeta, useCopy) ─┘
```

**Why no global state library?** The site has no shared mutable state: each widget owns its own small `useState`, and everything else is static data. Adding Redux/Zustand would add
weight and indirection for nothing.

**Code splitting.** Every page is `React.lazy`-imported, so a visitor downloads only the shell plus the route they open. Shared chunks (`content`, `calc`, `Reveal`, `GpuStudio`…) are
split automatically by Rollup. Production sizes (gzipped): shell+vendor **≈ 136 kB**, Home **≈ 11 kB**, content data **≈ 15 kB**, CSS **≈ 24 kB**.

**Animated route transitions.** `AnimatePresence mode="wait"` waits for the old page's exit animation (≈ 0.3 s) before mounting the new one; `Routes` receives the captured
`location` so the exiting page keeps rendering its own route during exit.

## 14. Build & tooling

- **`vite.config.ts`** — React plugin, dev server pinned to `127.0.0.1:5173`, preview to `4173`, ES2022 target, no source maps in production.
- **`tsconfig.json`** — `strict`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, `isolatedModules`, `moduleResolution: "bundler"`, `jsx: "react-jsx"`, `noEmit`
  (Vite does the transpiling; `tsc` is only a checker). Unused imports are **compile errors**, which keeps the tree tidy.
- **No linter/formatter is configured** — add ESLint + Prettier if the team grows.

---

# Part IV — Module reference

## 15. `src/lib/` — logic

### `lib/calc.ts` — the placement engine (pure functions, no React)
The single most important file; the console, matrix, simulator, hero chips and API sample responses all call it, so every number on the site is **consistent**.

| Export | Signature / value | Explanation |
| --- | --- | --- |
| `Priority` | `'cost' \| 'speed' \| 'policy'` | The three intents. |
| `Workload` | `{ modelId, quant, context, concurrency, priority, budget, minTps }` | A workload request. `budget` is ₹/hr; `BUDGET_MAX` (1200) means **no cap**. `minTps` is the policy-mode throughput target. |
| `BUDGET_MAX` | `1200` | Slider upper bound and "no cap" sentinel. |
| `UTIL` | `0.9` | vLLM's default `gpu_memory_utilization`. |
| `estimateMemory(w)` | `→ { weights, kv, overhead, need }` (GB) | Implements §7. |
| `recommend(w)` | `→ { memory, candidates, pick, note }` | Evaluates 7 configurations (L4, L40S, H100, H200, 2×/4×/8× H100), assigns each a `CandidateState`, picks one, or explains why none. |
| `CandidateState` | `'recommended' \| 'fits' \| 'too-small' \| 'over-budget' \| 'too-slow' \| 'no-price'` | See below. |
| `fmtGB`, `inr` | formatters | `inr` uses Indian digit grouping (`toLocaleString('en-IN')`). |
| `defaultWorkload` | Llama 3.1 8B · FP16 · 8K · ×8 · cost · ₹150 · 60 tok/s | Initial state of the console; also seeds the hero chips and API samples. |

**`recommend` algorithm**
1. `memory = estimateMemory(w)`; `cap = budget ≥ 1200 ? ∞ : budget`.
2. For each config: `total = vram × count`, `usable = 0.9 × total`, `rate = planningRate × count` (or `null` if the GPU has no published price), `ceiling = bandwidth × count × eff ÷ weights` (`eff = 0.8` if `count > 1`).
3. State: `too-small` if `need > usable`; else `over-budget` if `rate > cap`; else `no-price` if `rate` is null **and** a finite cap is set (an unverifiable price can't be shown to satisfy a budget); else `too-slow` if policy mode and `ceiling < minTps`; else `fits`.
4. Among `fits`: **speed** → max `ceiling`; **cost/policy** → min `rate` (null last, then smaller total memory). The winner becomes `recommended`.
5. If none: `note` distinguishes *nothing fits* / *over budget or unverifiable price* / *below throughput target*.

**Limitations (documented honestly):** planning constants, not benchmarks; ignores prefill cost, quantized-KV, prefix caching, speculative decoding, MoE and multimodal memory; H200 has no price so it's never auto-picked under a finite cap.

### `lib/hooks.ts`
- `usePageMeta(title, description?)` — sets `document.title` (`Home` → "Inferxe — One API, many GPU providers", otherwise "Title — Inferxe") and creates/updates `<meta name="description">`. Called by every page.
- `useCopy(timeout = 1600)` — clipboard write with a transient `copied` flag (used by `CodeBlock`).
- `useMediaQuery(query)` — `matchMedia` subscription; exported utility, currently unused.

### `lib/api.ts`
`submitContact(payload)` → `{ ok: true, delivered: boolean } | { ok: false, error }`. With `VITE_FORM_ENDPOINT` set it `POST`s JSON (`Accept: application/json`) and treats a non-2xx as
an error; without it, it simulates a 900 ms send and returns `delivered: false` so the UI can say **nothing was sent** (and logs the payload in dev only).

## 16. `src/data/` — typed content & reference data

All page copy lives here rather than in JSX, so wording can be edited without touching components.

### `data/site.ts`
- `SITE` — `name`, `parent` (Automatrix), `domain`, `url`, `tagline`, `stage`, `updated`, **`contactEmail`** (empty ⇒ hidden everywhere), **`formEndpoint`** (from `import.meta.env.VITE_FORM_ENDPOINT`).
- `NAV` — union type `{label,to} | {label,items[]}`: *Product* (4 leaves), *Solutions*, *Pricing*, *Security*, *Company* (3 leaves); each leaf has `title`, `desc`, `icon`.
- `FOOTER_COLS` — three link columns (Product / Company / Resources, the last deep-linking to tools via `#hash`).
- `PAGE_INDEX` — 13 entries `{to,title,kw}` powering the command palette's search (`kw` holds hidden keywords such as "vram", "h100").

### `data/gpus.ts`
- `Gpu` — `id, name, vram, vramLabel, arch, tier, status, bandwidth, bandwidthLabel, role, uses[], providerRange?, listRange?, rate`.
- `GPUS` (6): **L4** 24 GB Ada · **L40S** 48 GB Ada · **H100** 80 GB Hopper · **H200** 141 GB Hopper (*Benchmarking*) · **B200 class** 180 GB+ Blackwell (*Roadmap*) · **GB200/GB300** multi-GPU Grace Blackwell (*Roadmap*).
  `providerRange` = the DPR's indicative on-demand range; `listRange` = suggested marketplace rate; `rate` = the midpoint used in calculations (L4 ₹60 · L40S ₹100 · H100 ₹275; others `null`).
- `QUANTS` — `fp16` (2 B), `fp8` (1 B), `int4` (0.56 B incl. scales).
- `MODELS` (7) — Qwen2.5 7B/14B/32B, Llama 3.1 8B/70B, Mistral 7B v0.3, Mistral Small 24B, each with parameter count and `kvBytesPerToken`.
- `gpuById`, `modelById` — lookups (non-null asserted; ids are controlled).

> ⚠ **Not from the DPR:** bandwidth figures, architecture names and each model's layer/KV-head counts are public vendor/model specs added so the calculators can work. Verify them before treating the maths as authoritative.

### `data/content.ts` (≈ 650 lines)
Typed constants; each is consumed as noted:

| Constant(s) | Content | Consumed by |
| --- | --- | --- |
| `PROBLEMS`, `INTENTS`, `STEPS`, `LAYERS`, `MOAT`, `MARKET` | Deck slides 2–7 | Home, Company |
| `STREAMS`, `PRICING_MODELS`, `PRICING_FAQ` | Business model, pricing basis, 6 FAQs | Pricing, Platform |
| `MVP_TRACKS`, `PHASES`, `DELIVERY_PHASES`, `FUTURE_SCOPE` | Roadmap data (4 tracks, 3 phases, 9 delivery phases, 10 capabilities) | Home, Roadmap |
| `CAPABILITIES`, `CRITERIA`, `ADAPTER_DUTIES`, `VLLM_POINTS`, `BENCH_METRICS` | Platform detail | Platform, Gpus |
| `E2E_STEPS`, `ARCH_LAYERS`, `FLOW_NODES`, `LIFECYCLE`, `DATA_ENTITIES` | Workflow, architecture, data model | HowItWorks, Platform, Developers |
| `ENDPOINTS` (13), `ERRORS` (8), `RELIABILITY_PRACTICES`, `STACK` (13) | API & stack | Developers, Company |
| `SECURITY_CONTROLS`, `PRIVACY_POINTS`, `RISKS` (15), `KRIS` (8), `RISK_OWNERS`, `TESTS` | Security & risk | Security |
| `PERSONAS`, `USE_CASES`, `SCENARIOS`, `JOURNEY` | Audience | Solutions |
| `INDIA_PROVIDERS`, `PRINCIPLES`, `REFERENCES`, `STACK_MARQUEE` | Context | Roadmap, Company, Home |

Icons are stored as `LucideIcon` component references inside the data (so `content.ts` imports from `lucide-react`).

### `data/api.ts`
- `DOCS: Record<endpointId, Doc>` — `{ status, req?, query?, res }` for each of the 13 endpoints. The `recommend` request/response **is generated by `recommend(defaultWorkload)`**, so it always matches the console.
- `toCurl`, `toPython`, `toTs` — turn an endpoint + `Doc` into runnable-looking snippets (env-var base URL & key; Python JSON `true/false/null` → `True/False/None`).
- `GROUPS` — endpoints grouped for the explorer's sidebar.
- Marked **illustrative**: the OpenAPI spec is the source of truth. A placeholder host (`$INFERXE_BASE_URL`) is used on purpose — no real API host has been announced.

## 17. `src/styles/` — the design system

CSS is loaded in this order in `main.tsx` (later files can override earlier ones):

| File | Responsibility |
| --- | --- |
| `tokens.css` | **Design tokens** as CSS variables: surfaces `--bg-0…5`, ink `--ink…-4`, lines, brand (`--brand #76b900`, `--brand-hi`, `--brand-lo`, glow), signal hues, paper (light) colours, radii `--r-xs…xl`, `--gutter`, `--container` (1240 px), `--nav-h` (72 px), font stacks, easing, shadows. |
| `base.css` | Reset, focus ring, scrollbar, skip link, `.sr-only`; **layout primitives** (`.container`, `.section`, `.grid`/`-2/-3/-4`, `.split`, `.stack`); **type helpers** (`.display`, `.h1–.h3`, `.lead`, `.eyebrow`, `.grad-text`); `.paper` light theme; reduced-motion rule. |
| `surfaces.css` | **Glass** (`.glass` + `--lift/--deep/--lime`, edge-light `::after`, spotlight `::before`); **plate/screw/well/readout/engrave**; **neo** (neumorphic); **LED** variants; **buttons** (`--primary` bevelled with shine sweep, `--glass`, `--ghost`, sizes); `.chip`, `.tag`, `.icon-tile`; **`.seg`** rocker; **`.fader`** (cross-browser range styling); **form fields** (`.input/.select/.textarea`); **tables**; **code block** + token colours; **marquee**; HTTP **method badges**; `.equation`. |
| `layout.css` | Ambient background, scroll progress, logo, navbar + mega panel + mobile drawer, command palette, footer (incl. outlined wordmark), page hero, breadcrumbs, CTA band, accordion. |
| `widgets.css` | GPU art & fan spin, routing diagram, dial, **studio** (control panel, memory bar, candidate rows, verdict), rack stack, pipeline, console preview. |
| `pages.css` | Home sections (hero 3D stage, chips, strip, problem, intents, NVIDIA cards, stats, India, pricing teaser/neo, **Gantt**). |
| `inner.css` | Platform page (adapter panel, **bento grid**, criteria meters, vLLM, duties, formulas, entities). |
| `how.css` | Simulator, scroll timeline, request-flow chain, NL-search stages, lifecycle states. |
| `gpus.css` | Catalogue cards, bar charts, compatibility matrix cells, benchmark table. |
| `pricing.css` | Equation plate, rate ranges, estimator panels, streams grid. |
| `dev.css` | API explorer layout, dev cards, entity chips. |
| `security.css` | Posture panel, control cards, privacy section, risk matrix. |
| `company.css` | Roadmap (deliverables, milestone path), Company (about plate, moat, market), Solutions (personas, scenarios, journey). |
| `contact.css` | Contact layout, form + custom checkbox, legal pages, 404, small shared fixes. |

**Naming:** BEM-ish (`block__element--modifier`) and component-scoped prefixes (`.studio__*`, `.cand__*`, `.risk__*`). **Responsive:** mobile-first breakpoints at 560 / 640 / 760 / 860 / 960 / 1024 px.
**Modern CSS used:** CSS variables, `backdrop-filter`, `mask-composite`, `color-mix()`, `:has()`, individual transform properties (`translate`, `rotate`, `scale`), `clamp()`, `text-wrap: balance`, `aspect-ratio`, container-free grid/flex.

## 18. App shell

### `main.tsx`
Imports the three font families (Rubik & JetBrains Mono as **variable** fonts, IBM Plex Sans 400/500/600), the 14 stylesheets, then mounts `<StrictMode><BrowserRouter><App/></BrowserRouter></StrictMode>`.

### `App.tsx`
- **Lazy routes** for all 13 page modules (`React.lazy`), wrapped in `Suspense` with a pulsing-LED fallback.
- **`ScrollManager`** — on pathname/hash change: with a hash, waits 380 ms (so the exit transition finishes) then retries `getElementById` every 80 ms (≤ 20 tries, because the target page is lazy) and `scrollIntoView({behavior:'smooth'})`; without one, scrolls to top instantly.
- **Routes:** `/`, `/platform`, `/how-it-works`, `/gpus`, `/solutions`, `/pricing`, `/developers`, `/security`, `/roadmap`, `/company`, `/contact`, `/privacy`, `/terms`, `*` (404).
- `MotionConfig reducedMotion="user"` + a **skip link** (`#main`).

### `components/layout/`
- **`Navbar.tsx`** — fixed header; gains a blurred background after 24 px of scroll. Dropdown groups open on **hover with a 120 ms close delay** (hover-intent, avoids flicker), on **focus**, or by **click**; closed by `Esc`, route change, or blur. At ≤ 980 px it becomes a hamburger → full-screen glass drawer with staggered items and **body scroll lock**. The search button dispatches the `inferxe:palette` window event.
- **`CommandPalette.tsx`** — opens on `Ctrl/⌘ + K` or the `inferxe:palette` event; filters `PAGE_INDEX` by title or hidden keywords; ↑/↓ moves, `Enter` navigates, `Esc` closes; autofocuses the input; modal ARIA (`role="dialog"`, `aria-modal`).
- **`Footer.tsx`** — brand blurb, status chips, three link columns from `FOOTER_COLS`, dynamic © year, legal links, Unsplash credit, and an oversized outlined **wordmark** rendered in-flow below the content (cropped to 0.6em).
- **`Ambient.tsx`** — `Ambient`: fixed layer with three blurred, slowly drifting **aurora blobs**, a radially-masked **grid**, and an SVG-noise **film grain** (`mix-blend-mode: overlay`). `ScrollProgress`: `useScroll` → `useSpring` → `scaleX` on a 2 px bar.

### Shared composition components
- **`PageHero.tsx`** — inner-page hero: parallax photo (`useScroll` on the section → `y` 0→22 %, `scale` 1.05→1.18, fading), green-black wash, masked grid, breadcrumb, eyebrow, word-by-word `SplitHeading`, lead, actions, optional `aside` (widget on the right). Props: `eyebrow, title[], lead, image, crumb, actions?, aside?, focus?`.
- **`CtaBand.tsx`** — closing call-to-action card with photo and overridable `title / lead / image`.
- **`Logo.tsx`** — `LogoMark` (SVG: one input line splitting into three outputs = "one API → many providers") and `Logo` (mark + "Infer**xe**" wordmark). Gradient ids come from `useId` sanitised to alphanumerics so multiple instances never collide.

## 19. UI primitives (`components/ui/`)

| Component | Technical behaviour | Notes |
| --- | --- | --- |
| **`Glass`** | Polymorphic (`as`) glass surface; `onMouseMove` writes `--mx/--my` via `style.setProperty` (no re-render). Props `lift`, `variant: default\|deep\|lime`, `radius: s\|m\|l`. | Spotlight shows on hover. |
| **`Plate`** | Brushed-metal panel + four decorative screws (`aria-hidden`). `dark`, `screws` props. | Used for skeuomorphic panels. |
| **`Reveal`** | `whileInView` fade + rise (`y`, optional `x`, `scale`), 0.8 s, shared easing, fires once (`amount 0.2`, bottom margin −60 px). | |
| **`Stagger` / `StaggerItem`** | Parent variant staggers children (default 0.09 s); items rise 30 px over 0.75 s. Variants propagate through nested motion children. | Used for all card grids. |
| **`SplitHeading`** | Splits lines into words, each in an `overflow:hidden` mask sliding up from 110 % with a 3° rotation, 0.07 s per word; `aria-label` carries the full text while visual spans are `aria-hidden`. | `accentLast` applies the green gradient to the last line. |
| **`Button` / `LinkButton`** | Variants `primary` (bevelled lime with shine sweep), `glass`, `ghost`; sizes `sm/md/lg`; optional arrow/icon. `LinkButton` renders a router `<Link>` (`to`) or `<a>` (`href`). | |
| **`Counter`** | `useInView` → `animate(from,to)` over 1.8 s; respects reduced motion (jumps to the end value). | Stats band. |
| **`Tilt`** | Pointer position → normalised −0.5…0.5 → `useTransform` → `useSpring` (stiffness 140, damping 18, mass 0.6) → `rotateX/Y` (±`max`°, default 8) with `transformPerspective`. Ignores touch. | Hero card, console. |
| **`CodeBlock`** | Window chrome, optional **tabs**, copy button (`useCopy`), and a small **regex highlighter** (`highlight()`): comments, strings (a string followed by `:` is styled as a JSON **key**), numbers, language keywords, CLI flags — for `bash`, `python`, `ts`, `json`. | Dependency-free; adequate for short API samples, not a general highlighter. |
| **`SectionHead`** | Eyebrow + `h2` + lead, each in a `Reveal` with increasing delay; `center` option. | |
| **`Accordion`** | Single-open FAQ with animated height; `aria-expanded`; plus icon rotates 135°. | |

## 20. Visuals (`components/visuals/`)

- **`GpuCardArt.tsx`** — a front-on SVG illustration of a data-centre GPU, hand-built: carbon-weave shroud, ~78 heat-sink fin slits along the top edge, a glowing lime accent blade (SVG blur filter), two **fans** (9 blades each via `rotate()` copies, hub with the brand mark) that **spin via CSS** (`.gpu-fan`, 2.4 s / 3 s, counter-rotating), gold **PCIe contacts**, a power connector, a pulsing LED badge (SMIL `<animate>`), and a floor glow. Gradient ids are `useId`-scoped. No NVIDIA logo is used.
- **`RoutingDiagram.tsx`** — SVG schematic: *Your app → Inferxe control plane (hexagon with pulsing rings) → three adapters (ADP) → JarvisLabs (live) + two dashed "Phase 2" providers*. Packets are circles moved with **SMIL `<animateMotion>` + `<mpath>`** along the paths (zero JavaScript per frame); dashed lines use a CSS `stroke-dashoffset` animation.

## 21. Widgets (`components/widgets/`) — the interactive pieces

### `GpuStudio.tsx` — "Placement console" (Home + `/gpus`)
- **State:** one `Workload` object (`useState`), seeded from `defaultWorkload`; `useMemo(() => recommend(w), [w])`.
- **Controls (left, skeuomorphic `Plate`):** model `<select>` grouped by family; precision `seg` (FP16/FP8/INT4); **context** fader (2K→128K, 7 stops) and **concurrency** fader (1→64, 7 stops); **budget** fader (₹40→₹1200, step 10; max = *No cap*); **`Dial`** for Cost / Speed / Policy; in Policy mode an animated-height **latency target** fader (10→300 tok/s) appears.
- **Results (right, glass):** *Memory required* readout with a 3-segment stacked bar (weights / KV / runtime, animated widths) and legend; **7 candidate rows** (`motion.li layout`) each showing VRAM, a fill bar (need ÷ usable, capped at 100 %), rate, and a state label (*Recommended / Compatible / Not enough VRAM / Over budget / Below target / Price unverified*); a **verdict card** (GPU, headroom %, cost, decode ceiling, rationale sentence per mode) or a **"No placement"** card with the `note`.
- Footer states the assumptions (illustrative; ceiling is an upper bound).

### `Dial.tsx`
Accessible rotary selector: the labels are real `role="radio"` buttons in a `radiogroup` (←/→/↑/↓ keys); the knob is a clickable (cycle-next) decorative control that rotates with a spring (stiffness 220, damping 16, mass 0.7) across a 120° arc; labels are positioned on a 96 px radius with trigonometry.

### `Simulator.tsx` — routing simulator (`/how-it-works`)
Four presets (*Chat assistant*, *Long-context 14B*, *Latency target*, *Too large*). Pressing **Run** advances **7 stages** (`intake → filter → score → select → adapter → deploy → observe`) every 720 ms; each stage's log line is derived from the real `recommend()` result (e.g. "memory need 27.3 GB · 3 of 7 configurations pass hard constraints"). Row states: `pending / active / done / failed / skipped`. For *Too large* the **select** stage fails, later stages show *skipped*, and the result says the request was *rejected cleanly with no orphaned resources* — demonstrating safe failure. A progress bar and a result banner complete it.

### `PipelineSteps.tsx`
Five-node pipeline with a filling rail; **auto-advances every 2.8 s**, pauses on hover/focus, and is click-selectable. A recessed "well" shows a **sample payload** per stage.

### `CompatMatrix.tsx`
7 models × 4 GPUs (L4, L40S, H100, H200). Controls: precision, context length, concurrency (1/4/16). Each cell shows ✓ with remaining headroom % or "no fit"; the **smallest fitting GPU per row** gets a solid lime "smallest" pill — that is where cost-optimised routing starts.

### `PricingTools.tsx`
- **`RateRanges`** — for L4/L40S/H100: a track on a ₹0–₹420 axis with the provider's indicative range (cyan) and the suggested list rate (lime) animating in.
- **`CostEstimator`** — GPU `seg`, presets (*Business hours 8h×22d*, *Burst 2h×10d*, *Always on 24h×30d*), faders for GPU count (1–8), hours/day, days/month. Output: monthly **mid-point** plus range (`hours × days × count × listRate`), runtime, rate, per-day, the expanded formula, and a caveat.
- **`TokenCostCalc`** — GPU rate × throughput × utilization → **₹ per 1M tokens** with the formula shown (§9).

### `ApiExplorer.tsx`
Sidebar of 13 endpoints (method badge + path) grouped by area; the panel shows the summary, a **request** `CodeBlock` (cURL / Python / TypeScript tabs) and a **response** `CodeBlock` with a status chip. Content switches with an `AnimatePresence` fade. Everything is derived from `data/api.ts`.

### `RiskMatrix.tsx`
5×5 grid (impact on Y, likelihood on X) coloured by band; cells containing risks show a numbered "ball" that springs in. Selecting a cell lists its risks with ID, title and mitigation, plus the scoring method note. Default selection: (L3, I5).

### `RackStack.tsx`
The 4 architecture layers as brushed-metal **rack units** with a 3-LED panel (staggered blinking), a layer tag, title, description, "module slot" chips (live/future styling) and vent slots; animated pulses travel down the connectors between units.

### `AdapterContract.tsx`
A plate listing the four adapter responsibilities as LCD rows with cyan LEDs, and slots for *JarvisLabs · live in MVP*, *Mock adapter*, *More · Phase 2*.

### `ConsolePreview.tsx`
A mock product console (clearly badged **sample data**): sidebar, four KPI wells with **sparklines** (Catmull-Rom → Bézier smoothing; `pathLength` draw-in), an **area chart** (24 points), an "inference playground" that **types a reply character-by-character** (38 ms/char, only while visible, looping), and a deployments table with status LEDs.

### `Gantt.tsx`
12-week grid: each row's bar is positioned in % from `[startWeek, endWeek]`, animates with `scaleX` from the left (staggered), and shows its description and `Wx–y` range. Horizontally scrollable on small screens (`min-width: 840px`). Used with `MVP_TRACKS` and `DELIVERY_PHASES`.

### `Timeline.tsx`
Vertical timeline of the 11 end-to-end steps; the rail fill is `useScroll` (offset `start 65% → end 55%`) smoothed by a spring; each node **lights up** when its row enters the viewport (`onViewportEnter`).

### `BarChart.tsx`
Horizontal bars in recessed tracks, animating width on view; tones lime/cyan/amber; used for memory (GB) and bandwidth (GB/s).

### `ContactForm.tsx`
Controlled form: name*, email*, company, role, interest*, message (≤ 2000 chars with counter), consent*. **Validation** runs on submit (then live): required fields, email regex, length, consent. States: `idle → sending → done | error`. Success shows an SVG check drawn with `pathLength`, a personalised message, and — when no endpoint is configured — an amber **"nothing was sent"** notice. Custom skeuomorphic checkbox; `aria-invalid`, labelled inputs, `role="alert"` for errors.

## 22. Pages (`src/pages/`)

Every page sets its own `<title>`/description with `usePageMeta`, opens with `PageHero` (except Home, Legal, 404) and closes with `CtaBand` (except Contact, Legal, 404).

| Route | Sections (in order) |
| --- | --- |
| **`/` Home** | **Hero** (parallax datacenter photo, split-word headline, CTA buttons, three fact tiles, tilting 3D GPU card with three floating glass chips computed from `recommend(defaultWorkload)`) → **Stack marquee** → **Problem** (photo + 4 cards) → **Solution** (3 intent cards activated on hover/focus + routing diagram) → **How it works** (`PipelineSteps`) → **Placement console** (`GpuStudio`) → **Architecture** (`RackStack`) → **NVIDIA fit** (6 GPU cards with animated VRAM bars) → **Console + ops** (4 feature rows + tilted `ConsolePreview`) → **Stats** (4 LCD counters) → **India-first policy** card → **Pricing teaser** (light "paper" section: equation + 3 rate cards) → **Roadmap teaser** (Gantt + 3 phases) → CTA. |
| **`/platform`** | Hero (`AdapterContract` aside) → **8-cell bento** of core components (grid-auto-flow dense; wide/tall spans; chips; lifecycle list in the tall cell) → **Routing** (9 criteria with Mandatory/High/Medium meters; sticky intro) → **Managed inference** (4 vLLM points + `docker run vllm/vllm-openai` snippet) → **Provider abstraction** (6 adapter duties + photo) → **Console** preview → **Cost visibility** (paper: 4 pricing models + 2 formulas) → **Data foundation** (9 PostgreSQL entities) → CTA. |
| **`/how-it-works`** | Hero (routing diagram aside) → **5 stages** → **Simulator** (`#simulator`) → **11-step timeline** with a sticky "what you actually do" card → **Architecture** (9-node request-flow chain with sequential glow + 6-row layer table) → **Natural-language GPU search** (two glass stages + banner) → **Lifecycle states** (7 states, failure branch) → CTA. |
| **`/gpus`** | Hero (memory bar chart aside) → **Catalogue** (animated filter: All / In MVP / Benchmarking / Roadmap; spec cards) → **Memory & bandwidth charts** → **Compatibility matrix** (`#matrix`) → **Placement console** (`#studio`) → **Benchmark programme** (3 pillars, results table showing **"pending"** everywhere, 10 metrics chips) → CTA. |
| **`/solutions`** | Hero → **4 personas** (photo cards: Developers, Enterprises, Applications, Researchers) → **6 use cases** → **3 scenarios** (explicitly "not customer stories") → **7-step journey** → CTA. |
| **`/pricing`** | Hero (equation plate) → **Indicative rates** (`RateRanges` + caveat) → **Cost estimator** (`#estimator`) → **Normalization** (4 models + token-price calculator) → **Estimated vs actual** → **Commercial model** (paper: 5 streams with phase chips) → **FAQ** (6) → CTA. |
| **`/developers`** | Hero (cURL sample aside) → **API explorer** (`#explorer`) → **OpenAI-compatible inference** (Python/TS streaming) → **Auth & limits** (Cognito+TOTP, API keys+HTTPS, rate limits) → **Errors** (sample 409 body + 8-row table) → **Reliability practices** (6) → **Data model chips** (9) → CTA. |
| **`/security`** | Hero (design-controls plate) → **8 controls** → **Privacy & data** (5 principles + "where we are": **no certification claimed**) → **Reliability & observability** (8 KRIs, failure-handling note) → **Validation** (8 test areas) → **Risk framework** (`#risk`, matrix + 8 owners) → CTA. |
| **`/roadmap`** | Hero → **MVP Gantt** (toggle *Tracks* / *Delivery phases*; phases mode adds 9 deliverable cards) → **Beyond the MVP** (vertical glowing path, 4 milestones, alternating sides) → **10 future capabilities** → **India-first evolution** (8 candidate providers, photo; labelled *not announced integrations*) → CTA. |
| **`/company`** | Hero (Automatrix plate) → **Vision** → **6 principles** → **7-asset moat** → **Market position** (providers · Inferxe · marketplaces, with no-affiliation note) → **Stack table** (`#stack`) → **Research foundations** (3 reference groups) → CTA. |
| **`/contact`** | Hero → **`ContactForm`** + side cards (what happens next, provider-partnership pitch, website/email/stage facts). |
| **`/privacy`, `/terms`** | `Legal.tsx` renders either document from a data map; shows an amber **"draft for review"** notice. |
| **`*` (404)** | `NotFound.tsx` — red LED, amber LCD "404 · no compatible route found", links to key pages. |

---

# Part V — Cross-cutting concerns

## 23. Accessibility
- Semantic landmarks (`header`, `nav` with `aria-label`, `main#main`, `footer`), **skip link**, visible `:focus-visible` rings.
- Interactive widgets use real controls: radio-groups (`Dial`, simulator presets), `aria-pressed` on segmented buttons, `aria-expanded` on accordions/menus, labelled inputs, `aria-live` regions for results and pipeline output, `aria-current` on active items, `role="alert"` for form errors.
- Decorative elements (`screw`, `led`, SVG art, grids, glows) are `aria-hidden`.
- Motion is disabled/shortened under `prefers-reduced-motion` (Framer Motion config **and** a global CSS rule).
- Colour contrast (computed from the token values against `--bg-0`): primary text ≈ 17:1, secondary (`--ink-2`) ≈ 10:1, tertiary (`--ink-3`) ≈ 6.9:1 — all above WCAG AA. The dimmest token (`--ink-4`, ≈ 4.4:1) is reserved for non-essential meta text and fine print. A full audit (e.g. axe) of the light "paper" sections is still recommended.

## 24. Performance
- **Route-level code splitting**; lazy-loaded below-the-fold images (`loading="lazy"`); hero images `fetchPriority="high"`.
- WebP photos, 18–330 KB each (≈ 2.3 MB total, loaded per page, not upfront).
- Self-hosted variable fonts (no external font CSS).
- GPU-cheap effects: animations use `transform`/`opacity`; ambient blobs are `will-change: transform`; only ~one `backdrop-filter` layer per visible card.
- SMIL/CSS animations instead of JS loops; effect timers (`setInterval`) exist only in the pipeline, console typing and simulator and are cleaned up on unmount.

## 25. SEO & sharing
`index.html` carries description, theme colour, Open Graph/Twitter tags and `og-image.png` (1200×630, generated from the brand assets). `usePageMeta` updates title/description per route. `public/sitemap.xml` lists
all 13 routes and `robots.txt` allows all. **Caveat:** this is a client-rendered SPA — crawlers that don't execute JavaScript see only the shell. For maximum SEO add prerendering/SSR (e.g. `vite-plugin-ssr`, Astro, Next.js) later.

## 26. Security & privacy of the site itself
- No secrets in the bundle; the only environment variable is the public form endpoint (`VITE_` vars are embedded in client code by design).
- No third-party scripts, trackers, cookies or analytics. Fonts and images are self-hosted. External links: `rel="noreferrer"` on the Unsplash credit.
- The contact form posts only what the user typed and requires explicit consent; client-side validation is a convenience — **the receiving endpoint must validate/rate-limit/spam-filter** server-side.
- React escapes all interpolated text; there is **no `dangerouslySetInnerHTML`**.

## 27. Browser support
Evergreen browsers: Chrome/Edge ≥ 111, Safari ≥ 16.4, Firefox ≥ 121 (needed for `color-mix()`, `:has()`, individual transform properties and `mask-composite`). `backdrop-filter` has a `-webkit-` fallback. SMIL (`animateMotion`) is supported in all of these. Internet Explorer is not supported.

## 28. Testing & QA
There is **no automated test suite committed** — be aware of this. Quality gates are:
1. `npm run typecheck` / `npm run build` (strict TS, unused-code errors).
2. During development, every route was rendered in headless Chrome at 1440×900, 1100, 820 and 390 px; checked for **console errors/warnings** (none), **horizontal overflow** (fixed), and the interactive widgets were driven programmatically (palette, dropdown, console dial/selects, simulator, form validation/success, estimator, API explorer, risk matrix).
3. Suggested next steps: **Vitest** unit tests for `lib/calc.ts` (it is pure and the highest-value target: memory maths, state precedence, budget/no-price rules, policy filtering), **Playwright** smoke tests per route, and an a11y check with `axe`.

---

# Part VI — Operating & extending

## 29. Content integrity — rules this site follows
- Every factual claim traces to the deck or DPR (see §4). **No invented customers, testimonials, uptime/SLA numbers, certifications or benchmark results.** The benchmark table is "pending".
- Prices are the DPR's **planning figures**, always accompanied by a caveat.
- Interactive models, console preview, API contracts and the simulator are labelled **illustrative / sample data**.
- Phase honesty: "Live in MVP" = JarvisLabs only; everything else is tagged *Phase 2+*, *Roadmap* or *Benchmarking*.
- Third-party names (providers, marketplaces, NVIDIA, model families) are text-only, for identification, with a no-affiliation note where competitors are named.
- No team/founder section — the deck still contains `[Founder name]`, `[email]`, `[current stage]` placeholders.

**Assumptions to verify:** GPU bandwidth & architectures; model layer/KV-head/parameter counts; the overhead constant (`2 GB + 4 %`); the 0.8 tensor-parallel efficiency; the `int4` 0.56 B/param; legal drafts.

## 30. Configuration
| Setting | Where | Notes |
| --- | --- | --- |
| Cognito authentication | `frontend/.env` / `frontend/.env.local` (`VITE_COGNITO_USER_POOL_ID`, `VITE_COGNITO_CLIENT_ID`, `VITE_COGNITO_REGION`) | Use real values from your Cognito user pool. Backend profile synchronization and FastAPI Supabase REST calls read server-only `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` exclusively from `backend/.env` (see `backend/.env.example`). Never place `SUPABASE_SERVICE_ROLE_KEY` in `frontend/.env*`, never prefix it with `VITE_`, and never expose it to the browser. Restart Vite/backend after changing env values. |
| Contact email | `src/data/site.ts` → `SITE.contactEmail` | Empty = hidden on Contact page and in form fallback text. |
| Form endpoint | env `VITE_FORM_ENDPOINT` (e.g. in `.env.local`) | Create `.env.local` with `VITE_FORM_ENDPOINT=https://…`; restart the dev server after changing env. |
| Brand/stage text | `SITE` (`tagline`, `stage`, `updated`) | Footer chips and Company plate read from it. |
| Domain | `SITE.url/domain`, `index.html` OG URLs, `public/sitemap.xml`, `robots.txt` | Update all four if the domain changes. |
| Colours/spacing/fonts | `styles/tokens.css` | Change `--brand*` to re-theme globally. |

## 31. Deployment
`npm run build` produces a static `dist/`. Host anywhere (Netlify, Vercel, Cloudflare Pages, S3+CloudFront, nginx). **Configure an SPA fallback** so deep links work:

```nginx
# nginx
location / { try_files $uri /index.html; }
location /assets/ { add_header Cache-Control "public, max-age=31536000, immutable"; }
```
```
# Netlify: public/_redirects
/*    /index.html   200
```
```jsonc
// Vercel: vercel.json
{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }
```

Hashed files in `dist/assets/` are safe to cache forever; serve `index.html` with short/no cache.

## 32. How to extend — recipes

| Task | Steps |
| --- | --- |
| **Add a page** | 1) Create `src/pages/Foo.tsx` (default export; call `usePageMeta`). 2) `lazy(() => import('./pages/Foo'))` + `<Route>` in `App.tsx`. 3) Add to `NAV`/`FOOTER_COLS`/`PAGE_INDEX` in `data/site.ts`. 4) Add the URL to `public/sitemap.xml`. |
| **Add a GPU** | Append to `GPUS` in `data/gpus.ts`. To make it a candidate in the recommender, add `{gpuId, count}` to `CONFIGS` in `lib/calc.ts`; to show it in the matrix add its id to `COLS` in `CompatMatrix.tsx`. |
| **Add a model** | Append to `MODELS` (`params` in billions; `kvBytesPerToken = 2 × layers × kvHeads × headDim × 2`). It appears in the console, matrix and simulator automatically. |
| **Change a rate** | Edit `rate`, `listRange`, `providerRange` in `GPUS`; all calculators and charts follow (the `RateRanges` axis scale is `SCALE = 420` — raise it if rates exceed ₹420). |
| **Add an API endpoint** | Add to `ENDPOINTS` (`data/content.ts`) and a matching entry in `DOCS` (`data/api.ts`) — the explorer and code samples update. |
| **Add/modify a risk** | Edit `RISKS` (`l`, `i` 1–5); the matrix bands/counts recompute. |
| **Add a provider candidate** | `INDIA_PROVIDERS` (Roadmap) or `MARKET` (Company). |
| **Swap a photo** | Replace the WebP in `public/images/` (keep the file name) or change the path in the page; keep widths ≈ 1600 px and quality ≈ 76. |
| **Re-theme** | Edit `--brand`, `--brand-hi*`, `--brand-lo`, `--brand-glow` in `tokens.css`; some SVG art uses hard-coded hexes (`#76b900`, `#9be015`, `#b6f23a`) — search and replace for a full re-brand. |
| **Add a widget** | Put it in `components/widgets/`, style it in the relevant page CSS file, and build on `Glass`/`Plate`/`Reveal`; keep logic in `lib/` if it's computational. |

## 33. Pre-launch checklist
1. Fill `SITE.contactEmail`; set `VITE_FORM_ENDPOINT`; **send a real test enquiry**.
2. Counsel review of `/privacy` and `/terms`; remove the "draft" notice afterwards.
3. Decide whether naming competitors/candidate providers (Company, Roadmap) is acceptable.
4. Re-validate pricing against live provider rate cards; keep caveats until you do.
5. Verify the added public specs (§29); replace illustrative console/API/simulator data with real contracts when they exist.
6. Fill team/founder details if desired.
7. Deploy with SPA fallback; confirm `og-image.png`, sitemap and robots resolve at the production domain.
8. Consider prerendering for SEO and adding privacy-friendly analytics.

## 34. Known limitations
- Client-rendered SPA (SEO caveat above); no CMS, i18n or analytics; one (dark) theme plus light "paper" sections.
- Placement maths is a planning model, not a benchmark; H200/B200/GB200 have no price in the source data.
- `useMediaQuery` is exported but unused; `inner.css` holds Platform-page styles (historical name).
- No committed automated tests (see §28).

## 35. Glossary
**Adapter** — provider-specific translator behind Inferxe's single provider contract. · **Bento grid** — asymmetric card grid with some cells spanning multiple rows/columns. · **Concurrency** — number of requests being served simultaneously. · **Control plane** — the decision/orchestration layer (as opposed to the data plane that serves tokens). · **Decode** — token-by-token generation phase. · **GQA** — grouped-query attention; fewer KV heads than query heads. · **KV cache** — stored attention keys/values for past tokens. · **L×I** — likelihood × impact risk score. · **MVP** — minimum viable product (12-week vertical slice). · **Normalization** — converting differing price units to one comparable metric. · **Prefill** — prompt-processing phase. · **Quantization** — storing weights at lower precision (FP8/INT4) to save memory. · **TTFT** — time to first token. · **Tensor parallelism** — splitting a model's layers' tensors across GPUs. · **VRAM** — GPU memory. · **vLLM** — high-throughput LLM serving engine with an OpenAI-compatible API (continuous batching, PagedAttention).

## 36. Credits & licences
Photography via [Unsplash](https://unsplash.com) (Unsplash License). Fonts: Rubik (OFL), IBM Plex Sans (OFL), JetBrains Mono (OFL) via Fontsource. Icons: Lucide (ISC). Libraries: React, React Router, Framer Motion, Vite (MIT).
NVIDIA, Qwen, Llama, Mistral, JarvisLabs, vLLM, AWS and all other names are trademarks of their owners, used for identification only.
Inferxe is a product of **Automatrix**.
