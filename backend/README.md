# Inferxe Backend Services

This directory houses all server-side logic, API services, and machine learning pipelines for the Inferxe platform.

## Directory Structure

```
backend/
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

### 1. Admin Authentication Server
```bash
npm run server:admin
# Runs on http://127.0.0.1:5174
```

### 2. RAG FastAPI Server
```bash
cd backend/rag
uvicorn server:app --host 127.0.0.1 --port 8000 --reload
```

### 3. Web Search Server
```bash
cd backend/search
python web_search_server.py
```

