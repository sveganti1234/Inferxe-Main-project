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
