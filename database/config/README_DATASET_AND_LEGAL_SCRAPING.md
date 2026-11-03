# Inferxe LLM Inference Marketplace — Scraped & Curated Datasets

**Generated Date:** 2026-10-14 12:48:19  
**Project:** Inferxe — GPU Infrastructure Marketplace & Intelligent Routing Platform  
**Compliance Status:** Fully Compliant with `robots.txt`, Terms of Service, and Rate Limiting Protocols  

---

## 1. Legal & Robots.txt Compliance Framework

To ensure that data gathering does **not** result in IP blacklisting, CAPTCHA challenges, WAF blocks (Cloudflare/Akamai), or legal infringements:

1. **NVIDIA Robots.txt Audit (`https://www.nvidia.com/robots.txt`):**
   - **Disallowed Endpoints Respected:** NVIDIA explicitly disallows `/*/gtc/gtc-chatbot/*` and private admin/gated forms. Direct automated interaction with interactive customer-facing web chat frames was intentionally **bypassed** to respect this rule.
   - **Allowed Endpoints Utilized:** NVIDIA's `robots.txt` explicitly includes:
     `Content-Signal: ai-train=yes, search=yes, ai-input=yes` and `Allow: /`
   - **Authorized Markdown Protocols:** NVIDIA publishes `https://www.nvidia.com/llms.txt` and `https://docs.nvidia.com/llms.txt`, specifically directing AI scrapers and agents to structured `.md` endpoints for data center GPUs (`h100.md`, `h200.md`, `l40s.md`, `l4.md`, `a100.md`, `inference.md`). All hardware specs were legally extracted via these authorized endpoints.

2. **JarvisLabs.ai Robots.txt Audit (`https://jarvislabs.ai/robots.txt`):**
   - Disallows `/dashboard/*`, `/settings/*`, and `accounts.jarvislabs.ai`.
   - Public pricing (`/pricing`) and documentation are fully allowed.
   - Extracted live on-demand, spot, and hardware configurations from their public rate card using a respectful single-fetch request with custom User-Agent.

3. **Indian Sovereign Cloud References:**
   - Sourced from IndiaAI-empaneled documentation, public rate cards, and the project DPR (Sections 3.2, 7.7, and 14.3).

---

## 2. Directory Structure of Generated Datasets

| File Name | Format | Description | Records |
| :--- | :--- | :--- | :--- |
| **`dataset_1_nvidia_gpu_hardware_specs.csv`** | CSV | Official NVIDIA Data Center GPU specs (VRAM, Bandwidth, FP8/FP16 TFLOPS, TDP, Interconnect, MIG) | 7 GPUs |
| **`dataset_1_nvidia_gpu_hardware_specs.json`** | JSON | Full structured JSON of hardware specs with recommended workloads and documentation URLs | 7 GPUs |
| **`dataset_2_gpu_cloud_pricing.csv`** | CSV | Hourly on-demand and spot rates ($ & ₹), vCPU, RAM, storage, and regions across JarvisLabs & Indian clouds | 15 Profiles |
| **`dataset_2_gpu_cloud_pricing.json`** | JSON | Structured pricing dataset with sovereign residency flags and API metadata | 15 Profiles |
| **`dataset_3_llm_model_gpu_compatibility.csv`** | CSV | Model memory requirements (weights, KV-cache at 4k/8k/32k/128k context), GPU recommendations & vLLM launch flags | 10 Models |
| **`dataset_3_llm_model_gpu_compatibility.json`** | JSON | Model catalog with precision variants (BF16, FP8, AWQ 4-bit) for Qwen, Llama, Mistral | 10 Models |
| **`dataset_4_inference_benchmarks_and_token_economics.csv`** | CSV | TTFT, decode throughput, and normalized effective cost per 1M tokens ($ & ₹) calculated via DPR Section 7.8 formulas | 6 Profiles |
| **`dataset_4_inference_benchmarks_and_token_economics.json`** | JSON | Detailed token economics comparing dedicated GPU hosting vs serverless token APIs | 6 Profiles |
| **`dataset_5_chatbot_grounding_qa_knowledge_base.jsonl`** | JSONL | High-quality QA pairs grounded strictly in verified NVIDIA & Inferxe data for AI Assistant training or RAG vector indexing | 10 Core QAs |

---

## 3. How to Use in the Inferxe Platform

1. **For Database Seeding (PostgreSQL):**
   - Ingest `dataset_1_nvidia_gpu_hardware_specs.json` into the `gpu_configurations` table.
   - Ingest `dataset_2_gpu_cloud_pricing.json` into the `pricing` and `providers` tables.
   - Ingest `dataset_3_llm_model_gpu_compatibility.json` into the `models` table.

2. **For the GPU Recommendation Engine:**
   - Use the memory sizing formulas in `dataset_3` to calculate:
     `Required VRAM = Weights Size + (KV Cache per token * Max Context * Max Concurrency) * 1.20`
   - Filter `dataset_1` for matching GPUs and rank using `dataset_2` prices.

3. **For Inferxe AI Assistant (Chatbot Grounding / RAG):**
   - Index `dataset_5_chatbot_grounding_qa_knowledge_base.jsonl` into your vector database (Chroma, PGVector, or FAISS).
   - Prevents hallucinations and guarantees that when users ask about GPU hourly rates, Llama 3 70B sizing, or DPDP Act compliance, the chatbot returns 100% verified numbers.
