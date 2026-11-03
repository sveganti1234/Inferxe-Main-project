# Inferxe Website Data Filtering & Curation Report

**Date:** 2026-10-14 13:04:12  
**Source Files Analyzed:** `gpu_wikipedia_data_collection.py` & `generate_inferxe_gpu_dataset.py`  
**Status:** Completed — Filtered, Deduplicated, and Merged into Workspace Datasets  

---

## 1. What Unnecessary Data Was Removed & Why

1. **Synthetic Loop Bloat & Fake Permutations Removed:**
   * *Problem:* `generate_inferxe_gpu_dataset.py` contained an infinite loop designed to generate up to **1.5 GB** of randomized text by appending artificial micro-variation tags (e.g., `[TraceRef: #4821]`).
   * *Why Removed:* Generating hundreds of megabytes of the same 5 sentences with random hash tags adds massive storage bloat, causes hallucination, and ruins RAG vector retrieval without adding any new factual knowledge.
   * *Action:* Removed the synthetic loop completely and extracted the **pure underlying reference data and formulas**.

2. **Wikipedia Editorial & Script Boilerplate Removed:**
   * *Problem:* `gpu_wikipedia_data_collection.py` contained API polling scripts, MediaWiki session handling, retry loops, and raw regex splitters that pull unvetted sentences.
   * *Why Removed:* Running real-time Wikipedia searches introduces noisy citation text, disambiguation notices, and unverified edits.
   * *Action:* Replaced with vetted, factual extracts on **Hopper, Blackwell, Ada Lovelace, HBM3e, NVLink, FlashAttention, and the Roofline Model**.

3. **Inconsistent Pricing Harmonized:**
   * *Problem:* Legacy mock data had outdated pricing (e.g. L4 listed as ₹60 while live JarvisLabs rate is ₹41/hr; H100 listed as ₹275 while live on-demand rate is ₹330/hr).
   * *Action:* Harmonized all figures to distinguish between **Live Provider Rates (JarvisLabs: L4 ₹41, H100 ₹330, H200 ₹435)** and **Inferxe Suggested Marketplace Retail Rates (L4 ₹55–₹65, H100 ₹250–₹300)**.

---

## 2. What High-Value Data Was Extracted & Preserved

| Category | Extracted Factual Content | Destination |
| :--- | :--- | :--- |
| **Blackwell B200 Specs** | 192 GB HBM3e, 8,000 GB/s bandwidth, 4,500 FP8 TFLOPS, NVLink 5 (1,800 GB/s), 1000W TDP, ₹650/hr | `inferxe_filtered_gpu_hardware.csv` & `dataset_1` |
| **Mathematical Sizing Engine** | `Total VRAM = Weights + KV Cache + Overhead (2.5GB)`, enforcing `90% Usable Ceiling` rule | `inferxe_filtered_curated_knowledge.json` & `qa-tech-001` |
| **DeepSeek-V3 671B MoE** | 671B total params, 37B active params, 671 GB FP8, 370 GB INT4 memory footprint | `inferxe_filtered_curated_knowledge.json` & `dataset_3` |
| **Compute Theory & FlashAttention** | Roofline model (memory-bound decode vs compute-bound prefill), FlashAttention IO-aware tiling | `inferxe_filtered_technical_concepts.csv` & `qa-tech-004` |
| **Developer API SDK Integration** | Official drop-in OpenAI Python SDK snippet (`base_url="https://api.inferxe.com/v1"`) & cURL | `inferxe_filtered_curated_knowledge.json` & `qa-tech-003` |
| **India Sovereignty & DPDP Act** | Tier-IV datacenters in Navi Mumbai (NM1) and Noida, MeitY compliance, zero cross-border telemetry | `inferxe_filtered_curated_knowledge.json` & `dataset_5` |
| **Jailbreak Defense** | Defensive response against DAN and system prompt / API credential extraction | `dataset_5_chatbot_grounding_qa_knowledge_base.jsonl` |

---

## 3. Curated Files Generated

* **`inferxe_filtered_curated_knowledge.json`**: Master JSON containing the clean, deduplicated knowledge base.
* **`inferxe_filtered_gpu_hardware.csv`**: Cleaned GPU hardware catalog.
* **`inferxe_filtered_technical_concepts.csv`**: High-value technical concepts (Roofline, FlashAttention, NVLink, Quantization).
* **`dataset_5_chatbot_grounding_qa_knowledge_base.jsonl`**: Enriched with the new technical Q&As (now contains 19 comprehensive, grounded Q&A pairs).
