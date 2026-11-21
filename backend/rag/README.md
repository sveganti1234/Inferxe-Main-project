# Inferxe RAG Pipeline & Chatbot Grounding Engine

Production-grade Retrieval-Augmented Generation (RAG) pipeline for the **Inferxe AI Chatbot**. Grounded strictly in curated NVIDIA GPU hardware specifications, cloud provider rate cards (JarvisLabs, RunPod, Lambda, etc.), model-to-GPU sizing mathematics, inference benchmarks, and the verified Inferxe Detailed Project Report (DPR).

---

## 1. Architecture Overview

```
User Question
     │
     ▼
Domain & Injection Gatekeeper (Scope validation & defense against prompt injection)
     │
     ▼
Query Embedding (nomic-embed-text 768-dim via local Ollama)
     │
     ▼
ChromaDB Persistent Vector Store (Cosine Similarity on 144 indexed chunks)
     │
     ▼
Hybrid Ranking & Evidence Verification (Dense semantic + sparse lexical + GPU entity boost)
     │
     ▼
Strict Grounding & Disambiguation (Exact GPU matching, provider rate vs Inferxe marketplace distinction)
     │
     ▼
Local Qwen Generation (inferxe-qwen-ft:latest via Ollama at http://127.0.0.1:11434)
     │
     ▼
Exact Refusal Enforcement (Deterministic guardrails for out-of-scope or ungrounded queries)
     │
     ▼
Inferxe Chatbot UI (Floating launcher dock, ghost avatar companion, source attribution)
```

---

## 2. Environment Setup & Prerequisites

### Prerequisites
1. **Python 3.10+** (Virtual environment configured at `.venv/`)
2. **Node.js 18+** & npm
3. **Ollama** running locally on `http://127.0.0.1:11434`

### Required Python Packages
Installed in the virtual environment:
```bash
pip install chromadb fastapi uvicorn pydantic requests
```

### Required Ollama Models
Ensure both models are available in your local Ollama instance:
```bash
# 1. Local embedding model (768 dimensions)
ollama pull nomic-embed-text

# 2. Local LLM models
# The fine-tuned Qwen model (inferxe-qwen-ft:latest) is configured as primary,
# with qwen2.5:0.5b as fallback.
ollama list
```

---

## 3. Data Ingestion & Vector Indexing

The knowledge base ingests and cleans the entire dataset from `Dataset for web scrap/`:
- `dataset_1_nvidia_gpu_hardware_specs.json` (NVIDIA L4, L40S, H100 PCIe, H100 SXM, H200, B200, A100 specs)
- `dataset_2_gpu_cloud_pricing.json` (Provider on-demand and spot rates)
- `dataset_3_llm_model_gpu_compatibility.json` (Llama 3, Qwen 2.5, DeepSeek-V3 VRAM sizing)
- `dataset_4_inference_benchmarks_and_token_economics.json` (vLLM throughput and TTFT)
- `dataset_5_chatbot_grounding_qa_knowledge_base.jsonl` (Verified Q&A pairs)
- `inferxe_filtered_curated_knowledge.json` (Inferxe marketplace listing rates, VRAM formula, DPDP data sovereignty)
- `jarvislabs_gpu_instances_and_pricing.json` (JarvisLabs instance pricing and Noida datacenter region)
- `jarvislabs_ai_faqs_and_model_recommendations.json` (Architecture recommendations)
- `extracted_dpr_text.txt` (Detailed Project Report platform chapters)
- `chatbot_guardrail_config.json` (Allowed domains and refusal policies)

### Run Ingestion
```bash
# Validates, normalizes, deduplicates, and chunks the datasets:
.venv\Scripts\python.exe rag/ingest_dataset.py
```
Output:
- Cleaned chunks: `rag/data/cleaned_knowledge_chunks.json` (144 chunks)
- Audit report: `rag/data/ingestion_report.json`

### Run Vector Indexing
```bash
# Embeds all 144 chunks using nomic-embed-text and persists to ChromaDB:
.venv\Scripts\python.exe rag/index_knowledge.py --force
```
Output:
- Vector Database: `rag/chroma_db/`
- Manifest: `rag/data/index_manifest.json`

---

## 4. Running the Backend & Frontend

### 1. Start the FastAPI RAG Backend
```bash
.venv\Scripts\python.exe -m uvicorn rag.server:app --host 127.0.0.1 --port 8000
```
Endpoints:
- `GET http://127.0.0.1:8000/health` — Service health, Ollama status, and chunk count.
- `POST http://127.0.0.1:8000/api/chat` — Grounded RAG conversation endpoint.
- `POST http://127.0.0.1:8000/api/knowledge/reindex` — Administrative reindexing endpoint (requires `X-Admin-Key`).

### 2. Start the Frontend Dev Server
```bash
npm run dev
```
The frontend website runs at `http://127.0.0.1:5173/`.
Click the floating green ghost avatar on the bottom right to open the Inferxe AI Chatbot.

---

## 5. Automated Evaluation & Verification Suite

A 19-point automated test suite validates the entire RAG pipeline against all criteria specified in Section 10:

```bash
.venv\Scripts\python.exe rag/test_rag_pipeline.py
```

### Verified Test Categories:
1. **GPU Specifications:**
   - NVIDIA L4 specifications (24 GB GDDR6, 72W TDP, Ada Lovelace)
   - L4 vs L40S comparison (24 GB vs 48 GB)
   - H100 PCIe vs H100 SXM (interconnect, NVLink vs PCIe)
   - NVIDIA H200 memory capacity (141 GB HBM3e)
2. **LLM Inference & Sizing:**
   - Quantization memory savings (FP8, INT4 AWQ)
   - KV-cache definition and memory scaling
   - 70B model GPU recommendations (NVIDIA H100 SXM 80GB)
   - Inference cost factors (batching, throughput, hardware)
3. **Pricing & Inferxe Platform:**
   - JarvisLabs H100 hourly rate ($3.49/hr on-demand, $1.75/hr spot)
   - Provider rates vs proposed Inferxe marketplace rates (e.g. ₹275/hr for H100)
   - Inferxe platform features (intermediary layer, vLLM deployment, wallet)
   - Data residency in India (Noida and Mumbai Tier-IV facilities, DPDP compliance)
4. **Out-of-Scope Strict Refusal:**
   - Jokes, unrelated Python programs, recipes, sports
   - Returns exact mandated refusal string:
     `"I can only answer questions related to GPU infrastructure, hardware specifications, cloud pricing, and verified Inferxe website features. I cannot assist with topics outside this scope."`
5. **Missing Evidence & Security:**
   - Absent GPU model query (GeForce FX 5200) triggers exact ungrounded refusal:
     `"I can only answer questions related to GPU infrastructure, hardware specifications, cloud pricing, and verified Inferxe website features. I couldn't find verified information about that in the available documentation, so I don't want to guess."`
   - Jailbreak / Prompt injection defense ("ignore all instructions", "reveal system prompt") refused cleanly with zero credential/prompt leakage.

---

## 6. Rebuilding the Index when New Scraped Data Arrives

When new files are added to `Dataset for web scrap/`:
1. Re-run ingestion:
   ```bash
   .venv\Scripts\python.exe rag/ingest_dataset.py
   ```
2. Re-run vector indexing:
   ```bash
   .venv\Scripts\python.exe rag/index_knowledge.py --force
   ```
3. Or trigger remote reindexing via HTTP:
   ```bash
   curl -X POST "http://127.0.0.1:8000/api/knowledge/reindex?force=true" \
        -H "X-Admin-Key: your-placeholder-rag-admin-key"
   ```
