# Inferxe Backend Services

This directory houses all server-side logic, API services, and machine learning pipelines for the Inferxe platform.

## Directory Structure

```
backend/
├── inference/          # Inferxe Customer Inference API (FastAPI + PostgreSQL + NVIDIA Nemotron)
│   ├── main.py               # FastAPI application entry point (port 8001) & /docs Swagger
│   ├── routes.py             # POST /api/v1/inference, GET /api/v1/health, POST /api/v1/api-keys
│   ├── schemas.py            # Pydantic request/response validation
│   ├── auth.py               # Customer API key authentication (SHA-256 hashed) & key generator
│   ├── service.py            # Inference orchestration & telemetry logger
│   ├── database.py           # SQLAlchemy engine, session maker, connection pool
│   ├── models.py             # SQLAlchemy ORM models (api_keys, inference_requests)
│   ├── scripts/
│   │   ├── init_db.py        # Database creation and table initialization
│   │   └── create_api_key.py # Customer API key generator CLI
│   └── tests/
│       └── test_inference_api.py # Automated unit & integration test suite
├── providers/          # Hardware & AI Inference Providers
│   └── nvidia/               # NVIDIA NIM / Nemotron provider
│       ├── nvidia_provider.py # Direct OpenAI-compatible client
│       └── test_provider.py   # Connection verification test
├── auth/               # Node.js Admin Authentication Service (JWT & timing-safe crypto)
│   ├── adminAuth.js          # Middleware & token verification logic
│   └── adminAuthServer.mjs   # Standalone HTTP server (port 5174)
├── rag/                # Python FastAPI RAG Service (ChromaDB + Ollama)
│   ├── server.py             # FastAPI backend server (port 8000)
│   ├── extract_website_data.py # Text & metadata extraction
│   ├── tests/                # Test suites & benchmarks
│   │   ├── test_chat_store.mjs
│   │   ├── test_live_queries.py
│   │   ├── test_privacy_rules.py
│   │   └── test_rag_pipeline.py
│   └── README.md
├── search/             # Web Search Grounding API Service
│   ├── web_search_server.py  # DuckDuckGo search API server
│   ├── test_search.py        # Search endpoint tests
│   └── test_web_grounded_chat.py # Grounded chat evaluation
├── ml/                 # LoRA Fine-Tuning & Model Evaluation
│   ├── train_lora_sft.py     # LoRA SFT training script
│   ├── evaluate_models.py    # Perplexity & accuracy evaluator
│   ├── prepare_sft_dataset.py # SFT prompt formatting
│   ├── run_live_demo.py      # Terminal chat demo
│   ├── configs/              # Modelfile and training hyperparameters
│   ├── models/               # Fine-tuned adapter weights & tokenizer
│   └── results/              # Evaluation reports & training metrics
├── requirements.txt    # Python dependencies
└── package.json        # Backend NPM scripts
```

## Running Backend Services

### 1. Inferxe Inference API (New)
```bash
# 1. Initialize PostgreSQL database and tables (ensure PostgreSQL service is running)
python -m inference.scripts.init_db

# 2. Issue a customer API key
python -m inference.scripts.create_api_key --name "Dev Key" --user "dev@inferxe.internal"

# 3. Start the Inference Server (port 8001)
uvicorn inference.main:app --host 127.0.0.1 --port 8001 --reload

# 4. Run automated tests
python -m unittest inference/tests/test_inference_api.py
```

### 2. Admin Authentication Server
```bash
npm run server:admin
# Runs on http://127.0.0.1:5174
```

### 3. RAG FastAPI Server
```bash
cd backend/rag
uvicorn server:app --host 127.0.0.1 --port 8000 --reload
```

### 4. Web Search Server
```bash
cd backend/search
python web_search_server.py
```

---

# Team Setup — Wallet & Notifications Integration

This section covers the complete setup for the Wallet and Notifications features,
which share a single Supabase PostgreSQL database. Every teammate can run the
full stack locally with their own environment configuration.

## Prerequisites

- Node.js 20 or newer (developed on Node 24, npm 11)
- Python 3.11+ with `pip`
- Access to the shared Supabase project (PostgreSQL database + REST credentials)
- AWS Cognito User Pool credentials (for customer authentication)

## 1. Clone and Install Dependencies

```bash
# Clone the repository
git clone <repo-url>
cd Inferxe-Main-project-1

# Install Node.js dependencies (root workspace installs frontend)
npm install

# Install Python dependencies for backend services
cd backend
pip install -r requirements.txt
cd ..
```

## 2. Configure Environment Variables

All `.env` files are gitignored — create them locally from the `.env.example`
templates. Never commit `.env` files.

### Step 2a — Root `.env` (Supabase PostgreSQL + Frontend VITE variables)

Copy `.env.example` → `.env` and fill in:

```bash
cp .env.example .env
```

**Required variables (root `.env`):**

| Variable | Description | Example |
|---|---|---|
| `DATABASE_URL` | Supabase PostgreSQL connection string | `postgresql://user:pass@host:5432/dbname` |
| `VITE_COGNITO_REGION` | AWS Cognito region | `ap-south-1` |
| `VITE_COGNITO_USER_POOL_ID` | Cognito User Pool ID | `ap-south-1_xxxxxxxxx` |
| `VITE_COGNITO_CLIENT_ID` | Cognito App Client ID | `your-cognito-client-id` |
| `VITE_COGNITO_DOMAIN` | Cognito hosted UI domain | `your-domain.auth.ap-south-1.amazoncognito.com` |
| `VITE_COGNITO_REDIRECT_SIGN_IN` | Post-sign-in callback URL | `http://127.0.0.1:5173/login/callback` |
| `VITE_COGNITO_REDIRECT_SIGN_OUT` | Post-sign-out redirect URL | `http://127.0.0.1:5173` |
| `VITE_NOTIFICATIONS_API_ENDPOINT` | Backend API base URL | `http://127.0.0.1:8000` |

**`DATABASE_URL`** is the Supabase **PostgreSQL** connection string used by the
notifications/wallet service to connect directly to the shared database. Format:
`postgresql://<user>:<password>@<host>:<port>/<dbname>`. This is distinct from
the inference service's local PostgreSQL (`inferxe_inference_db`) configured in
`backend/.env`.

### Step 2b — Backend `.env` (Supabase REST credentials + Cognito)

Copy `backend/.env.example` → `backend/.env` and fill in:

```bash
cp backend/.env.example backend/.env
```

**Required variables (`backend/.env`):**

| Variable | Description | Example |
|---|---|---|
| `SUPABASE_URL` | Supabase project REST URL | `https://your-project.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (server-only) | `<redacted>` |
| `COGNITO_REGION` | AWS Cognito region | `ap-south-1` |
| `COGNITO_USER_POOL_ID` | Cognito User Pool ID | `ap-south-1_xxxxxxxxx` |
| `COGNITO_CLIENT_ID` | Cognito App Client ID | `your-cognito-client-id` |
| `DATABASE_URL` | Local inference PostgreSQL (pgAdmin 4) | `postgresql://<user>:<password>@localhost:5432/inferxe_inference_db` |

**Never place `SUPABASE_SERVICE_ROLE_KEY` in `frontend/.env*` or prefix it with
`VITE_`.** It is server-only.

### Step 2c — Frontend `.env` (VITE variables for Vite client)

Vite loads `VITE_*` variables from `frontend/` (where `vite.config.ts` lives).
Copy `frontend/.env.example` → `frontend/.env` and fill in:

```bash
cp frontend/.env.example frontend/.env
```

**Required variables (`frontend/.env`):**

| Variable | Description | Example |
|---|---|---|
| `VITE_COGNITO_REGION` | AWS Cognito region | `ap-south-1` |
| `VITE_COGNITO_USER_POOL_ID` | Cognito User Pool ID | `ap-south-1_xxxxxxxxx` |
| `VITE_COGNITO_CLIENT_ID` | Cognito App Client ID | `your-cognito-client-id` |
| `VITE_COGNITO_DOMAIN` | Cognito hosted UI domain | `your-domain.auth.ap-south-1.amazoncognito.com` |
| `VITE_COGNITO_REDIRECT_SIGN_IN` | Post-sign-in callback URL | `http://127.0.0.1:5173/login/callback` |
| `VITE_COGNITO_REDIRECT_SIGN_OUT` | Post-sign-out redirect URL | `http://127.0.0.1:5173` |
| `VITE_COGNITO_AUTHORITY` | Cognito token issuer URL | `https://cognito-idp.ap-south-1.amazonaws.com/ap-south-1_xxxxxxxxx` |
| `VITE_COGNITO_SCOPE` | OAuth scopes | `phone openid email` |
| `VITE_NOTIFICATIONS_API_ENDPOINT` | Backend API base URL | `http://127.0.0.1:8000` |

**Distinguishing the two `DATABASE_URL` variables:**

- Root `.env` `DATABASE_URL`: Supabase **PostgreSQL** — shared by Wallet and
  Notifications (multi-user data).
- `backend/.env` `DATABASE_URL`: Local inference **PostgreSQL** — used only by
  the inference service (`inferxe_inference_db`).

They point to different databases and must not be confused.

## 3. Start All Servers

You need three servers running simultaneously. Open three terminals.

### Terminal 1 — Frontend (Vite dev server, port 5173)

```bash
# From project root
npm run dev
```

### Terminal 2 — Customer Authentication Server (Node, port 5174)

```bash
# From project root
npm run server:admin
```

### Terminal 3 — FastAPI Notifications Backend (port 8000)

```bash
# From project root
npm run dev:backend
```

Or directly with uvicorn:
```bash
uvicorn backend.notifications.main:app --host 127.0.0.1 --port 8000 --reload
```

## 4. How Wallet & Notifications Connect to Supabase

The Wallet and Notifications features share a single Supabase PostgreSQL
database configured via `DATABASE_URL` in root `.env`.

**On backend startup**, `backend/notifications/main.py` runs a FastAPI
lifespan hook that calls `init_db()` (`backend/notifications/db.py`).
This performs idempotent, non-destructive migrations:

- `CREATE TABLE IF NOT EXISTS` for `wallets`, `wallet_transactions`,
  `notifications`, `notification_outbox`, `users`, and other tables.
- `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` for any new columns on existing
  tables.

No manual migration step is required — the backend self-migrates on every
startup. Teammates connecting to the same Supabase project will see the same
schema and data.

**Data flow:**

1. Frontend calls `GET/POST /api/wallet/...` (proxied via Vite to port 8000,
   or direct in production via `VITE_NOTIFICATIONS_API_ENDPOINT`).
2. FastAPI backend validates the Cognito JWT, then reads/writes
   `wallets` / `wallet_transactions` in Supabase PostgreSQL via `psycopg2`.
3. Notifications use the same connection pool and `init_db()` migration.

## 5. Verification

```bash
# Frontend typecheck
npm run typecheck

# Frontend production build
npm run build

# Backend wallet tests (from project root)
python -m backend.notifications.tests.test_wallet_initialization
```

## 6. Troubleshooting

| Problem | Likely Cause | Fix |
|---|---|---|
| Wallet API returns 401 | Admin JWT (HS256) used instead of Cognito ID token (RS256) | Sign in via Cognito customer login, not admin login |
| `VITE_NOTIFICATIONS_API_ENDPOINT` is empty | Variable not in `frontend/.env` | Vite loads from `frontend/`, not root — copy `frontend/.env.example` |
| Backend can't connect to Supabase | `DATABASE_URL` missing or wrong in root `.env` | Fill in Supabase PostgreSQL connection string |
| `psycopg2` import error | Python dependency not installed | `pip install -r backend/requirements.txt` |
