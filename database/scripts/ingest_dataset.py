"""
ingest_dataset.py
=================
Comprehensive data ingestion and cleaning pipeline for the Inferxe RAG knowledge base.
Ingests, validates, normalizes, deduplicates, and chunks all relevant datasets from
'Dataset for web scrap/' into structured, source-attributed passages.
Distinguishes between:
  - Inferxe proposed marketplace pricing
  - Cloud provider on-demand pricing
  - Cloud provider spot pricing
  - Token economics & cost benchmarks
  - Technical specs and architecture docs
"""

import os
import sys
import json
import csv
import re
import hashlib
from typing import List, Dict, Any, Tuple

sys.stdout.reconfigure(encoding='utf-8')

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_ROOT = os.path.abspath(os.path.join(BASE_DIR, ".."))
DATASET_DIR = os.environ.get("DATASET_DIR", os.path.join(DB_ROOT, "datasets"))
OUTPUT_DIR = os.path.join(DB_ROOT, "datasets", "knowledge")
CONFIG_DIR = os.path.join(DB_ROOT, "config")
OUTPUT_CHUNKS_FILE = os.path.join(OUTPUT_DIR, "cleaned_knowledge_chunks.json")
OUTPUT_REPORT_FILE = os.path.join(CONFIG_DIR, "ingestion_report.json")

def compute_hash(text: str) -> str:
    return hashlib.sha256(text.strip().lower().encode("utf-8")).hexdigest()[:16]

def clean_text(text: str) -> str:
    if not text:
        return ""
    # Remove excessive blank lines or carriage returns
    text = re.sub(r'[\r\t]+', ' ', text)
    text = re.sub(r' +', ' ', text)
    return text.strip()

class DatasetIngester:
    def __init__(self, dataset_dir: str):
        self.dataset_dir = dataset_dir
        self.chunks: List[Dict[str, Any]] = []
        self.seen_hashes = set()
        self.report = {
            "processed_files": [],
            "total_chunks_created": 0,
            "category_counts": {},
            "skipped_or_duplicate": 0,
            "errors": []
        }

    def add_chunk(self, content: str, metadata: Dict[str, Any]):
        cleaned = clean_text(content)
        if len(cleaned) < 35:
            return  # skip trivial or empty text
        
        h = compute_hash(cleaned)
        if h in self.seen_hashes:
            self.report["skipped_or_duplicate"] += 1
            return
        self.seen_hashes.add(h)

        cat = metadata.get("category", "general")
        self.report["category_counts"][cat] = self.report["category_counts"].get(cat, 0) + 1

        self.chunks.append({
            "id": f"chunk_{cat}_{len(self.chunks)+1}_{h[:8]}",
            "content": cleaned,
            "metadata": metadata
        })

    def process_gpu_hardware_specs(self):
        filepath = os.path.join(self.dataset_dir, "dataset_1_nvidia_gpu_hardware_specs.json")
        if not os.path.exists(filepath):
            return
        
        with open(filepath, "r", encoding="utf-8") as f:
            data = json.load(f)

        for item in data:
            model = item.get("gpu_model", "NVIDIA GPU")
            text = (
                f"NVIDIA GPU HARDWARE SPECIFICATION:\n"
                f"Model: {model}\n"
                f"Architecture: {item.get('architecture', 'N/A')}\n"
                f"VRAM Capacity: {item.get('vram_gb', 'N/A')} GB {item.get('memory_type', 'HBM/GDDR')}\n"
                f"Memory Bandwidth: {item.get('memory_bandwidth_tb_s', 'N/A')} TB/s\n"
                f"Compute Performance: {item.get('fp8_tensor_tflops', 'N/A')} FP8 TFLOPS | "
                f"{item.get('fp16_tensor_tflops', 'N/A')} FP16 TFLOPS | "
                f"{item.get('bfloat16_tensor_tflops', 'N/A')} BF16 TFLOPS | "
                f"{item.get('fp32_tflops', 'N/A')} FP32 TFLOPS\n"
                f"Thermal Design Power (TDP): {item.get('tdp_watts', 'N/A')} Watts\n"
                f"Form Factor & Interconnect: {item.get('form_factor', 'PCIe/SXM')} | {item.get('interconnect', 'N/A')}\n"
                f"MIG Multi-Instance GPU Support: {item.get('mig_support', 'N/A')}\n"
                f"Transformer Engine: {item.get('transformer_engine', 'N/A')}\n"
                f"Inference Benchmark Metric: {item.get('cost_per_1m_tokens_benchmark', 'N/A')}\n"
                f"Recommended AI Workloads: {item.get('recommended_workloads', 'N/A')}"
            )
            self.add_chunk(text, {
                "source_file": "dataset_1_nvidia_gpu_hardware_specs.json",
                "category": "gpu_hardware",
                "gpu_model": model,
                "vram_gb": str(item.get("vram_gb", "")),
                "doc_type": "technical_specs",
                "pricing_type": "none"
            })
        self.report["processed_files"].append("dataset_1_nvidia_gpu_hardware_specs.json")

    def process_gpu_cloud_pricing(self):
        filepath = os.path.join(self.dataset_dir, "dataset_2_gpu_cloud_pricing.json")
        if not os.path.exists(filepath):
            return

        with open(filepath, "r", encoding="utf-8") as f:
            data = json.load(f)

        for item in data:
            provider = item.get("provider", "Cloud Provider")
            gpu = item.get("gpu_model", "GPU")
            on_demand_usd = item.get("on_demand_hourly_usd") or item.get("on_demand_price_per_hour_usd") or item.get("on_demand_rate_usd_hr")
            on_demand_inr = item.get("on_demand_hourly_inr") or item.get("on_demand_price_per_hour_inr") or item.get("on_demand_rate_inr_hr")
            spot_usd = item.get("spot_hourly_usd") or item.get("spot_price_per_hour_usd") or item.get("spot_rate_usd_hr")
            spot_inr = item.get("spot_hourly_inr") or item.get("spot_price_per_hour_inr") or item.get("spot_rate_inr_hr")
            vram = item.get("total_vram_gb") or item.get("vram_per_gpu_gb") or item.get("vram_gb") or "N/A"
            vcpu = item.get("vcpu") or item.get("vcpu_count") or "N/A"
            ram = item.get("system_ram_gb", "N/A")
            region = item.get("data_center_region") or item.get("region") or "N/A"

            text = (
                f"GPU CLOUD PRICING RECORD:\n"
                f"Provider: {provider}\n"
                f"GPU Model: {gpu} (Count: {item.get('gpu_count', 1)}x, VRAM per GPU: {vram} GB)\n"
                f"Host Configuration: {vcpu} vCPU, {ram} GB RAM, Storage: {item.get('storage_included', item.get('storage_cost_per_gb_month_usd', 'N/A'))}\n"
                f"On-Demand Hourly Rate: ${on_demand_usd}/hr (approx ₹{on_demand_inr}/hr)\n"
                f"Spot Instance Hourly Rate: ${spot_usd}/hr (approx ₹{spot_inr}/hr) [Discount: {item.get('spot_discount_percent', '0')}%]\n"
                f"Datacenter Region: {region}\n"
                f"Billing Cadence: {item.get('billing_unit', item.get('billing_cadence', 'Per-minute billing'))}\n"
                f"Pricing Distinction: Documented external provider catalog rate for {provider}. Note: Stored historical reference pricing; not a live API quote."
            )
            self.add_chunk(text, {
                "source_file": "dataset_2_gpu_cloud_pricing.json",
                "category": "cloud_pricing",
                "provider": provider,
                "gpu_model": gpu,
                "doc_type": "pricing_rate_card",
                "pricing_type": "provider_on_demand_and_spot"
            })
        self.report["processed_files"].append("dataset_2_gpu_cloud_pricing.json")

    def process_model_gpu_compatibility(self):
        filepath = os.path.join(self.dataset_dir, "dataset_3_llm_model_gpu_compatibility.json")
        if not os.path.exists(filepath):
            return

        with open(filepath, "r", encoding="utf-8") as f:
            data = json.load(f)

        for item in data:
            model = item.get("model_name", "LLM")
            text = (
                f"LLM MODEL WORKLOAD & GPU SIZING COMPATIBILITY:\n"
                f"Model: {model} (Parameters: {item.get('parameter_count', 'N/A')})\n"
                f"Precision / Quantization: {item.get('precision_format', 'N/A')}\n"
                f"Weights Memory Required: {item.get('weights_memory_gb', 'N/A')} GB\n"
                f"KV-Cache Memory Requirement: {item.get('kv_cache_memory_per_token_mb', 'N/A')} MB/token (4K context ~{item.get('kv_cache_memory_4k_context_gb', 'N/A')} GB, 16K context ~{item.get('kv_cache_memory_16k_context_gb', 'N/A')} GB)\n"
                f"Recommended Single GPU: {item.get('recommended_single_gpu', 'N/A')}\n"
                f"Recommended Multi-GPU Cluster: {item.get('recommended_multi_gpu_cluster', 'N/A')}\n"
                f"Minimum VRAM Required: {item.get('min_vram_gb', 'N/A')} GB\n"
                f"Serving Architecture Notes: {item.get('serving_notes', 'vLLM continuous batching recommended')}"
            )
            self.add_chunk(text, {
                "source_file": "dataset_3_llm_model_gpu_compatibility.json",
                "category": "llm_sizing",
                "model_name": model,
                "doc_type": "model_compatibility",
                "pricing_type": "none"
            })
        self.report["processed_files"].append("dataset_3_llm_model_gpu_compatibility.json")

    def process_inference_benchmarks(self):
        filepath = os.path.join(self.dataset_dir, "dataset_4_inference_benchmarks_and_token_economics.json")
        if not os.path.exists(filepath):
            return

        with open(filepath, "r", encoding="utf-8") as f:
            data = json.load(f)

        for item in data:
            text = (
                f"INFERENCE BENCHMARK & TOKEN ECONOMICS:\n"
                f"Model Tested: {item.get('model_name', 'LLM')}\n"
                f"GPU Hardware: {item.get('gpu_hardware', 'N/A')}\n"
                f"Serving Engine: {item.get('serving_engine', 'vLLM')} (Batching: {item.get('batching_mode', 'Continuous')})\n"
                f"Throughput: {item.get('tokens_per_second_output', 'N/A')} tokens/sec\n"
                f"Time-to-First-Token (TTFT): {item.get('time_to_first_token_ms', 'N/A')} ms\n"
                f"Concurrency Level: {item.get('concurrent_requests', 'N/A')} users\n"
                f"Effective Cost per 1 Million Output Tokens: {item.get('effective_cost_per_1m_tokens', 'N/A')}\n"
                f"Optimization Techniques: {item.get('optimizations_applied', 'PagedAttention, FlashAttention-2')}"
            )
            self.add_chunk(text, {
                "source_file": "dataset_4_inference_benchmarks_and_token_economics.json",
                "category": "benchmarks",
                "doc_type": "token_economics",
                "pricing_type": "benchmark"
            })
        self.report["processed_files"].append("dataset_4_inference_benchmarks_and_token_economics.json")

    def process_qa_knowledge_base(self):
        filepath = os.path.join(self.dataset_dir, "dataset_5_chatbot_grounding_qa_knowledge_base.jsonl")
        if not os.path.exists(filepath):
            return

        with open(filepath, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                    q = obj.get("question", "")
                    a = obj.get("answer", "")
                    cat = obj.get("category", "qa_knowledge")
                    if q and a:
                        text = f"VERIFIED KNOWLEDGE Q&A:\nQuestion: {q}\nAnswer: {a}"
                        self.add_chunk(text, {
                            "source_file": "dataset_5_chatbot_grounding_qa_knowledge_base.jsonl",
                            "category": cat,
                            "doc_type": "verified_qa",
                            "pricing_type": "none"
                        })
                except Exception:
                    continue
        self.report["processed_files"].append("dataset_5_chatbot_grounding_qa_knowledge_base.jsonl")

    def process_inferxe_curated_knowledge(self):
        filepath = os.path.join(self.dataset_dir, "inferxe_filtered_curated_knowledge.json")
        if not os.path.exists(filepath):
            return

        with open(filepath, "r", encoding="utf-8") as f:
            data = json.load(f)

        # 1. GPU Hardware on Inferxe platform
        for gpu in data.get("gpu_hardware", []):
            name = gpu.get("name", "NVIDIA GPU")
            text = (
                f"INFERXE VERIFIED GPU HARDWARE & MARKETPLACE RATE:\n"
                f"Model: {name} (ID: {gpu.get('gpu_id', '')})\n"
                f"Architecture: {gpu.get('architecture', 'N/A')}\n"
                f"VRAM: {gpu.get('vram_gb', 'N/A')} GB {gpu.get('memory_type', 'HBM/GDDR')}\n"
                f"Memory Bandwidth: {gpu.get('memory_bandwidth_gbps', 'N/A')} GB/s\n"
                f"Compute: {gpu.get('fp8_tflops', 'N/A')} FP8 TFLOPS | {gpu.get('fp16_tflops', 'N/A')} FP16 TFLOPS\n"
                f"TDP: {gpu.get('tdp_watts', 'N/A')}W | Interconnect: {gpu.get('interconnect', 'N/A')}\n"
                f"Proposed Inferxe Listing Rate: ₹{gpu.get('inr_per_hour', 'N/A')}/hr (${gpu.get('usd_per_hour', 'N/A')}/hr)\n"
                f"Optimal Workloads: {gpu.get('optimal_workloads', 'N/A')}\n"
                f"Key Technologies: {gpu.get('key_technologies', 'N/A')}\n"
                f"Pricing Distinction: Proposed Inferxe marketplace rate. Verified catalog reference."
            )
            self.add_chunk(text, {
                "source_file": "inferxe_filtered_curated_knowledge.json",
                "category": "gpu_hardware",
                "gpu_model": name,
                "vram_gb": str(gpu.get("vram_gb", "")),
                "doc_type": "inferxe_verified_specs",
                "pricing_type": "inferxe_marketplace"
            })

        # 2. Models sizing
        for m in data.get("models", []):
            name = m.get("name", "LLM")
            text = (
                f"INFERXE MODEL SPECIFICATION & SIZING:\n"
                f"Model: {name} (ID: {m.get('model_id', '')})\n"
                f"Parameters: {m.get('parameter_count_b', 'N/A')}B\n"
                f"Default Precision: {m.get('default_precision', 'FP16')}\n"
                f"Weights Memory: FP16={m.get('weights_fp16_gb', 'N/A')} GB | FP8={m.get('weights_fp8_gb', 'N/A')} GB | INT4={m.get('weights_int4_gb', 'N/A')} GB\n"
                f"Context Window: {m.get('context_window_tokens', 'N/A')} tokens\n"
                f"Recommended GPU: {m.get('recommended_gpu', 'N/A')}"
            )
            self.add_chunk(text, {
                "source_file": "inferxe_filtered_curated_knowledge.json",
                "category": "llm_sizing",
                "model_name": name,
                "doc_type": "inferxe_model_sizing",
                "pricing_type": "none"
            })

        # 3. VRAM Derivation Engine
        vde = data.get("vram_derivation_engine", {})
        if vde:
            vde_text = (
                f"INFERXE VRAM DERIVATION & SIZING ENGINE:\n"
                f"Total Peak VRAM Formula: {vde.get('formula', '')}\n"
                f"Usable Memory Ceiling: {vde.get('usable_memory_ceiling', '')}\n"
                f"Weights Calculation: {vde.get('weights_calculation', '')}\n"
                f"KV-Cache Calculation: {vde.get('kv_cache_calculation', '')}\n"
                f"Runtime Overhead: {vde.get('runtime_overhead', '')}"
            )
            self.add_chunk(vde_text, {
                "source_file": "inferxe_filtered_curated_knowledge.json",
                "category": "llm_sizing",
                "doc_type": "vram_derivation_engine",
                "pricing_type": "none"
            })

        # 4. Advanced Technical Concepts
        for c in data.get("advanced_technical_concepts", []):
            concept = c.get("concept", "")
            cat = c.get("category", "technical_concept")
            text = (
                f"TECHNICAL CONCEPT & THEORY:\n"
                f"Concept: {concept}\n"
                f"Category: {cat}\n"
                f"Summary: {c.get('summary', '')}\n"
                f"Application to Inferxe: {c.get('application_to_inferxe', '')}"
            )
            self.add_chunk(text, {
                "source_file": "inferxe_filtered_curated_knowledge.json",
                "category": "technical_concept",
                "concept": concept,
                "doc_type": "architecture_concept",
                "pricing_type": "none"
            })

        # 5. Developer Code Examples
        code_examples = data.get("developer_code_examples", {})
        if code_examples:
            py_code = code_examples.get("python_openai_sdk", "")
            curl_code = code_examples.get("curl_example", "")
            text = (
                f"INFERXE DEVELOPER INTEGRATION & API SDK:\n"
                f"Base URL: https://api.inferxe.com/v1\n"
                f"OpenAI Python SDK Example:\n```python\n{py_code}\n```\n\n"
                f"cURL Example:\n```bash\n{curl_code}\n```"
            )
            self.add_chunk(text, {
                "source_file": "inferxe_filtered_curated_knowledge.json",
                "category": "inferxe_platform",
                "doc_type": "developer_sdk",
                "pricing_type": "none"
            })

        # 6. Explicit Inferxe Platform Architecture & Documented Features
        platform_summary = (
            "VERIFIED INFERXE PLATFORM ARCHITECTURE & CORE FEATURES:\n"
            "- Role: Customer-facing intermediary and orchestration layer connecting users to external GPU providers (JarvisLabs MVP provider) without physical GPU ownership.\n"
            "- Workload Recommendation Engine: Automates GPU selection based on model parameters, context length, precision, and VRAM sizing.\n"
            "- Automated Deployment: Provisions GPUs and deploys open LLMs with Docker and vLLM continuous batching.\n"
            "- Unified API: Exposes OpenAI-compatible endpoints at https://api.inferxe.com/v1 for seamless application integration.\n"
            "- Sovereign India Data Residency: Hosted exclusively in Tier-IV datacenters in Noida and Mumbai with zero cross-border telemetry egress (DPDP compliance).\n"
            "- Prepaid Wallet & Telemetry: Live hourly burn rate estimation, instant top-up, and real-time usage metrics."
        )
        self.add_chunk(platform_summary, {
            "source_file": "inferxe_filtered_curated_knowledge.json",
            "category": "inferxe_platform",
            "doc_type": "platform_features",
            "pricing_type": "none"
        })

        # 7. KV-Cache Core Definition Chunk
        kv_cache_summary = (
            "TECHNICAL CONCEPT & THEORY: KV-CACHE IN LLM INFERENCE:\n"
            "Concept: KV-Cache (Key-Value Cache)\n"
            "Category: LLM_Inference_Software\n"
            "Summary: In transformer-based LLM inference, the attention mechanism computes Key (K) and Value (V) vector representations for tokens. "
            "Autoregressive generation generates one token at a time. Without caching, all previous tokens would need to be recomputed at every step. "
            "The KV-cache stores previous tokens' key and value states in GPU VRAM, drastically speeding up token generation and saving massive compute. "
            "Memory scales linearly with sequence length (context window), batch size, number of layers, and hidden dimensions.\n"
            "Application to Inferxe: Sizing engine factors KV-cache memory requirements per sequence length into GPU recommendations."
        )
        self.add_chunk(kv_cache_summary, {
            "source_file": "inferxe_filtered_curated_knowledge.json",
            "category": "technical_concept",
            "concept": "KV-Cache",
            "doc_type": "architecture_concept",
            "pricing_type": "none"
        })

        self.report["processed_files"].append("inferxe_filtered_curated_knowledge.json")

    def process_jarvislabs_instances_and_pricing(self):
        filepath = os.path.join(self.dataset_dir, "jarvislabs_gpu_instances_and_pricing.json")
        if not os.path.exists(filepath):
            return

        with open(filepath, "r", encoding="utf-8") as f:
            data = json.load(f)

        for item in data:
            gpu = item.get("gpu_model", "GPU")
            on_demand_usd = item.get("on_demand_rate_usd_hr")
            on_demand_inr = item.get("on_demand_rate_inr_hr")
            spot_usd = item.get("spot_rate_usd_hr")
            spot_inr = item.get("spot_rate_inr_hr")
            region = item.get("data_center_region", "India (Noida)")

            text = (
                f"JARVISLABS GPU INSTANCE & PRICING:\n"
                f"GPU Model: {gpu} (Architecture: {item.get('architecture', 'N/A')})\n"
                f"VRAM: {item.get('vram_gb', 'N/A')} GB {item.get('memory_type', 'GDDR/HBM')}\n"
                f"Host Specs: {item.get('vcpu_count', 'N/A')} vCPU, {item.get('system_ram_gb', 'N/A')} GB System RAM\n"
                f"Supported GPU Counts: {item.get('supported_gpu_counts', '1x')}\n"
                f"On-Demand Rate: ${on_demand_usd}/hr (₹{on_demand_inr}/hr)\n"
                f"Spot Rate: ${spot_usd}/hr (₹{spot_inr}/hr) [{item.get('spot_discount_percent', '')} discount]\n"
                f"Form Factor & Interconnect: {item.get('form_factor', 'PCIe/SXM')} | {item.get('interconnect', 'N/A')}\n"
                f"Datacenter Region: {region}\n"
                f"Billing & Storage: {item.get('billing_unit', 'Per-minute')}, Storage: ${item.get('storage_rate_usd_gb_month', '0.1')}/GB/mo, Egress: {item.get('egress_fee', 'Free')}\n"
                f"Best Suited For: {item.get('best_for', 'AI workloads')}\n"
                f"Pricing Distinction: JarvisLabs infrastructure provider catalog rate (MVP provider for Inferxe)."
            )
            self.add_chunk(text, {
                "source_file": "jarvislabs_gpu_instances_and_pricing.json",
                "category": "cloud_pricing",
                "provider": "JarvisLabs",
                "gpu_model": gpu,
                "doc_type": "provider_rate_card",
                "pricing_type": "provider_on_demand_and_spot"
            })
        self.report["processed_files"].append("jarvislabs_gpu_instances_and_pricing.json")

    def process_jarvislabs_features_and_faqs(self):
        # 1. products and features
        p1 = os.path.join(self.dataset_dir, "jarvislabs_products_and_features.json")
        if os.path.exists(p1):
            with open(p1, "r", encoding="utf-8") as f:
                items = json.load(f)
            for it in items:
                text = (
                    f"JARVISLABS PLATFORM FEATURE:\n"
                    f"Feature: {it.get('feature_name', '')}\n"
                    f"Details: {it.get('description', '')}\n"
                    f"Capabilities: {it.get('capabilities', '')}"
                )
                self.add_chunk(text, {
                    "source_file": "jarvislabs_products_and_features.json",
                    "category": "provider_features",
                    "provider": "JarvisLabs",
                    "doc_type": "features",
                    "pricing_type": "none"
                })
            self.report["processed_files"].append("jarvislabs_products_and_features.json")

        # 2. faqs and recommendations
        p2 = os.path.join(self.dataset_dir, "jarvislabs_ai_faqs_and_model_recommendations.json")
        if os.path.exists(p2):
            with open(p2, "r", encoding="utf-8") as f:
                items = json.load(f)
            for it in items:
                topic = it.get('faq_topic', '')
                question = it.get('question', '')
                rec_gpu = it.get('recommended_gpu', '')
                summary = it.get('expert_summary') or it.get('answer_and_recommendation') or it.get('answer', '')
                text = (
                    f"JARVISLABS WORKLOAD FAQ & RECOMMENDATION:\n"
                    f"Topic: {topic}\n"
                    f"Question: {question}\n"
                    f"Recommended GPU: {rec_gpu}\n"
                    f"Expert Summary & Guidance: {summary}"
                )
                self.add_chunk(text, {
                    "source_file": "jarvislabs_ai_faqs_and_model_recommendations.json",
                    "category": "provider_features",
                    "provider": "JarvisLabs",
                    "doc_type": "faq_recommendation",
                    "pricing_type": "none"
                })
            self.report["processed_files"].append("jarvislabs_ai_faqs_and_model_recommendations.json")

    def process_inferxe_dpr_document(self):
        filepath = os.path.join(self.dataset_dir, "extracted_dpr_text.txt")
        if not os.path.exists(filepath):
            return

        with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
            lines = f.readlines()

        # Find where main content begins: around line "[133] 1. Document Control"
        start_idx = 0
        for i, l in enumerate(lines):
            if "1. Document Control" in l and i > 50:
                start_idx = i
                break

        body_lines = lines[start_idx:]
        
        # Strip line markers like "[133]"
        cleaned_lines = []
        for l in body_lines:
            subbed = re.sub(r'^\[\d+\]\s*', '', l).strip()
            if subbed:
                cleaned_lines.append(subbed)

        # Chunk by logical sections or ~25 lines per chunk with 5 lines overlap
        chunk_size_lines = 25
        overlap_lines = 5
        section_idx = 1
        
        i = 0
        while i < len(cleaned_lines):
            chunk_slice = cleaned_lines[i : i + chunk_size_lines]
            combined = "\n".join(chunk_slice)
            
            # Identify chapter heading if present
            heading = "Inferxe Detailed Project Report (Platform Architecture & Roadmap)"
            for cl in chunk_slice[:3]:
                if re.match(r'^\d+(\.\d+)*\s+[A-Za-z]', cl):
                    heading = cl
                    break

            text = (
                f"INFERXE DETAILED PROJECT REPORT (DPR) SECTION:\n"
                f"Topic: {heading}\n"
                f"Content:\n{combined}"
            )

            is_pricing = any(k in combined.lower() for k in ["pricing", "cost", "inr", "usd", "rate", "envelope"])
            self.add_chunk(text, {
                "source_file": "extracted_dpr_text.txt",
                "category": "inferxe_platform",
                "doc_type": "dpr_architecture",
                "section": f"section_{section_idx}",
                "pricing_type": "inferxe_financial_estimate" if is_pricing else "none"
            })

            section_idx += 1
            i += (chunk_size_lines - overlap_lines)

        self.report["processed_files"].append("extracted_dpr_text.txt")

    def process_guardrails_and_policies(self):
        filepath = os.path.join(self.dataset_dir, "chatbot_guardrail_config.json")
        if not os.path.exists(filepath):
            return

        with open(filepath, "r", encoding="utf-8") as f:
            cfg = json.load(f)

        domains_text = "INFERXE AI ASSISTANT ALLOWED SCOPE & DOMAIN POLICIES:\n"
        domains_text += "Allowed Topics:\n" + "\n".join([f"- {d}" for d in cfg.get("allowed_domains", [])]) + "\n\n"
        domains_text += "Disallowed Off-Topic Scope:\n" + "\n".join([f"- {d}" for d in cfg.get("disallowed_topics", [])]) + "\n\n"
        domains_text += f"Exact Out-of-Scope Refusal Response:\n\"{cfg.get('refusal_responses', {}).get('out_of_scope', '')}\"\n\n"
        domains_text += f"Exact Insufficient Information Fallback Response:\n\"{cfg.get('refusal_responses', {}).get('ungrounded_fallback', '')}\""

        self.add_chunk(domains_text, {
            "source_file": "chatbot_guardrail_config.json",
            "category": "guardrail_policy",
            "doc_type": "policy_definition",
            "pricing_type": "none"
        })
        self.report["processed_files"].append("chatbot_guardrail_config.json")

    def run_all(self):
        print("=" * 80)
        print("INFERXE RAG DATASET INGESTION & CLEANING PIPELINE")
        print("=" * 80)
        print(f"Reading from: {self.dataset_dir}\n")

        self.process_gpu_hardware_specs()
        self.process_gpu_cloud_pricing()
        self.process_model_gpu_compatibility()
        self.process_inference_benchmarks()
        self.process_qa_knowledge_base()
        self.process_inferxe_curated_knowledge()
        self.process_jarvislabs_instances_and_pricing()
        self.process_jarvislabs_features_and_faqs()
        self.process_inferxe_dpr_document()
        self.process_guardrails_and_policies()
        self.process_inferxe_website_knowledge()

    def process_inferxe_website_knowledge(self):
        filepath = "rag/data/inferxe_website_complete_knowledge.json"
        if not os.path.exists(filepath):
            return

        with open(filepath, "r", encoding="utf-8") as f:
            items = json.load(f)

        for it in items:
            text = f"{it.get('title', 'Inferxe Website Module')}:\n{it.get('content', '')}"
            self.add_chunk(text, {
                "source_file": "inferxe_website_complete_knowledge.json",
                "category": it.get("category", "website_knowledge"),
                "page": it.get("page", ""),
                "route": it.get("route", ""),
                "doc_type": "website_documentation",
                "pricing_type": "inferxe_marketplace" if "pricing" in it.get("category", "") else "none"
            })
        self.report["processed_files"].append("inferxe_website_complete_knowledge.json")

        os.makedirs(OUTPUT_DIR, exist_ok=True)
        self.report["total_chunks_created"] = len(self.chunks)

        with open(OUTPUT_CHUNKS_FILE, "w", encoding="utf-8") as f:
            json.dump(self.chunks, f, indent=2, ensure_ascii=False)

        with open(OUTPUT_REPORT_FILE, "w", encoding="utf-8") as f:
            json.dump(self.report, f, indent=2, ensure_ascii=False)

        print(f"✅ Ingestion Complete!")
        print(f"Total Chunks Generated: {len(self.chunks)}")
        print(f"Duplicate / Skipped:   {self.report['skipped_or_duplicate']}")
        print(f"Categories Breakdown:")
        for cat, cnt in sorted(self.report["category_counts"].items()):
            print(f"  • {cat.ljust(22)}: {cnt} chunks")
        print(f"\nSaved chunks to: {OUTPUT_CHUNKS_FILE}")
        print(f"Saved audit report to: {OUTPUT_REPORT_FILE}")
        print("=" * 80)

if __name__ == "__main__":
    ingester = DatasetIngester(DATASET_DIR)
    ingester.run_all()
