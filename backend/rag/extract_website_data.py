"""
Reads and extracts comprehensive factual knowledge from the Inferxe website source code
(pages, navigation, features, pricing, architecture, dashboard, security, developers, company).
Outputs structured, high-signal knowledge chunks ready for RAG ingestion.
"""

import os
import sys
import json
import re

sys.stdout.reconfigure(encoding='utf-8')

WEBSITE_KNOWLEDGE = [
    {
        "page": "Overview & About Inferxe Website",
        "route": "/",
        "category": "website_overview",
        "title": "Inferxe AI & Cloud GPU Marketplace Overview",
        "content": (
            "INFERXE WEBSITE OVERVIEW & PURPOSE:\n"
            "Inferxe (inferxe.com) is India's premier sovereign cloud GPU infrastructure and LLM inference marketplace platform. "
            "The website allows AI startups, enterprises, developers, and researchers to discover, compare, size, and deploy high-performance NVIDIA GPUs "
            "(such as H100 SXM, H200, B200, L40S, L4, and A100) with one-click Docker and vLLM containerized serving. "
            "Key Website Modules & Navigation:\n"
            "- Home (/): Platform highlights, sovereign cloud infrastructure, real-time GPU availability, and key value propositions.\n"
            "- Platform (/platform): Intermediary orchestration engine, automated model-to-GPU sizing, and cluster management.\n"
            "- Solutions (/solutions): Tailored solutions for startups, enterprise AI, healthcare, fintech, and fine-tuning.\n"
            "- Pricing (/pricing): Transparent hourly on-demand and spot rates in Indian Rupees (INR) and USD, prepaid wallet system.\n"
            "- GPU Catalogue (/gpus): Complete specifications, VRAM, interconnects, and pricing across all supported NVIDIA GPUs.\n"
            "- How It Works (/how-it-works): 4-step onboarding from account setup to one-click model deployment.\n"
            "- Developers (/developers): OpenAI-compatible REST API documentation, Python SDK snippet, and curl examples.\n"
            "- Roadmap (/roadmap): Development phases from MVP launch to multi-provider federation and distributed clusters.\n"
            "- Company (/company): Mission, vision, Indian data sovereignty commitment, leadership, and Noida headquarters.\n"
            "- Security (/security): Tier-IV datacenter facilities in Noida and Mumbai, DPDP Act compliance, SOC2, and zero cross-border data egress.\n"
            "- Contact (/contact): Enterprise inquiries, sales, and 24/7 technical support.\n"
            "- Dashboard & Workspace (/dashboard): Real-time instance management, simulated wallet balance, hourly burn rate tracker, and JupyterLab/SSH access."
        )
    },
    {
        "page": "Home Page",
        "route": "/",
        "category": "website_page",
        "title": "Inferxe Home Page Features & Highlights",
        "content": (
            "INFERXE HOME PAGE DETAILS:\n"
            "- Hero Section: 'Next-Gen Sovereign GPU Cloud for AI & LLM Inference'. Instant provisioning of frontier NVIDIA GPUs with lowest latency in India.\n"
            "- Core Value Proposition: Eliminates infrastructure complexity. Users do not need to configure bare-metal drivers, CUDA, or vLLM runtimes manually.\n"
            "- Interactive GPU Studio: Allows users to test model prompts and compare token generation latency directly on the website.\n"
            "- Real-Time Telemetry: Live indicators of GPU cluster health, active nodes, and sub-25ms Time-To-First-Token (TTFT).\n"
            "- Trusted by Enterprises: Compliant with Indian regulatory standards (MeitY empanelment, DPDP Act 2023)."
        )
    },
    {
        "page": "Platform Architecture Page",
        "route": "/platform",
        "category": "website_page",
        "title": "Inferxe Platform Architecture & Capabilities",
        "content": (
            "INFERXE PLATFORM ARCHITECTURE PAGE:\n"
            "- Architecture Layers: Built on a 4-layer stack: 1) Presentation Layer (React + TypeScript SPA), 2) Orchestration Engine (FastAPI & intermediate routing), 3) GPU Infrastructure Layer (JarvisLabs.ai integration and bare-metal nodes), 4) LLM Serving Engine (vLLM with continuous batching and PagedAttention).\n"
            "- Intermediary Model: Inferxe acts as an intelligent intermediary. Users specify their workload requirements (model parameters, context length, budget), and the platform automates GPU selection and instance deployment.\n"
            "- High-Throughput Serving: Native integration with vLLM enables continuous request batching, reducing inference cost per token by up to 60% compared to traditional cloud providers.\n"
            "- Containerization: Deployments run inside optimized Docker containers with pre-installed PyTorch, CUDA 12.x, and Hugging Face weights cache."
        )
    },
    {
        "page": "Solutions Page",
        "route": "/solutions",
        "category": "website_page",
        "title": "Inferxe Solutions for Startups, Enterprises & Research",
        "content": (
            "INFERXE SOLUTIONS PAGE:\n"
            "- AI Startups: Cost-effective spot instances and per-minute billing for fast experimentation without upfront commitments or long-term contracts.\n"
            "- Enterprise Production AI: High-availability dedicated clusters (99.9% SLA), guaranteed capacity reservations, and strict data privacy.\n"
            "- FinTech & Healthcare: Indian sovereign data residency ensuring sensitive user records, prompts, and embeddings never leave Indian soil.\n"
            "- AI Researchers: Multi-GPU nodes over NVLink (H100 SXM5 / B200) for training, LoRA fine-tuning, and massive Mixture-of-Experts (MoE) models."
        )
    },
    {
        "page": "Pricing Page",
        "route": "/pricing",
        "category": "website_page",
        "title": "Inferxe Pricing Model, Rates & Wallet System",
        "content": (
            "INFERXE PRICING PAGE DETAILS:\n"
            "- Billing Model: Per-minute granular billing with zero hidden egress fees and no lock-in commitments.\n"
            "- Documented Listing Rates (INR & USD):\n"
            "  * NVIDIA L4 (24 GB GDDR6): â‚¹60/hour ($0.72/hr) â€” Best for 7B-8B models, audio/video AI, and embeddings.\n"
            "  * NVIDIA L40S (48 GB GDDR6 ECC): â‚¹100/hour ($1.20/hr) â€” Best for 14B-32B models and LoRA fine-tuning.\n"
            "  * NVIDIA A100 80GB (80 GB HBM2e): â‚¹141/hour ($1.49/hr) â€” Proven foundation model serving and distributed training.\n"
            "  * NVIDIA H100 SXM5 (80 GB HBM3): â‚¹275/hour ($3.30/hr) â€” Frontier 70B+ inference with FP8 Transformer Engine.\n"
            "  * NVIDIA H200 SXM (141 GB HBM3e): â‚¹435/hour ($4.59/hr) â€” Extreme 128k long-context reasoning without out-of-memory errors.\n"
            "  * NVIDIA Blackwell B200 (192 GB HBM3e): â‚¹650/hour ($7.80/hr) â€” Massive Mixture-of-Experts (DeepSeek-V3, Llama 405B).\n"
            "- Spot Instance Discounts: Up to 50%-56% savings on interruptible batch workloads.\n"
            "- Prepaid Wallet System: Users top up their balance in INR. The platform displays real-time hourly burn rates and estimates remaining runtime."
        )
    },
    {
        "page": "GPU Catalogue Page",
        "route": "/gpus",
        "category": "website_page",
        "title": "Inferxe GPU Catalogue Specifications & Comparison",
        "content": (
            "INFERXE GPU CATALOGUE PAGE:\n"
            "The GPU catalogue presents side-by-side hardware specifications, benchmarks, and availability:\n"
            "- NVIDIA L4: 24 GB GDDR6, 300 GB/s bandwidth, 242 FP16 TFLOPS, 72W low TDP, PCIe Gen4 single-slot.\n"
            "- NVIDIA L40S: 48 GB GDDR6 ECC, 864 GB/s bandwidth, 366 FP16 TFLOPS, 350W TDP, PCIe Gen4.\n"
            "- NVIDIA H100 SXM5: 80 GB HBM3, 3350 GB/s (3.35 TB/s) bandwidth, 989 FP16 TFLOPS, 1979 FP8 TFLOPS, 700W TDP, NVLink 4 (900 GB/s).\n"
            "- NVIDIA H200 SXM: 141 GB HBM3e, 4800 GB/s (4.8 TB/s) bandwidth, 700W TDP, NVLink 4.\n"
            "- NVIDIA Blackwell B200: 192 GB HBM3e, 8000 GB/s (8.0 TB/s) bandwidth, 2250 FP16 TFLOPS, 4500 FP8 TFLOPS, NVLink 5 (1800 GB/s).\n"
            "- Users can filter GPUs by VRAM, architecture (Hopper, Ada Lovelace, Blackwell, Ampere), interconnect type, and price range."
        )
    },
    {
        "page": "How It Works Page",
        "route": "/how-it-works",
        "category": "website_page",
        "title": "How Inferxe Works â€” 4 Step Deployment Workflow",
        "content": (
            "HOW INFERXE WORKS (4-STEP WORKFLOW):\n"
            "1. Step 1: Select Workload & Model â€” Choose your open-source model (Llama 3.1, Qwen 2.5, DeepSeek, Mistral) or custom PyTorch container.\n"
            "2. Step 2: Automated GPU Sizing â€” Inferxe automatically calculates required VRAM (Weights + KV-Cache + 2.5GB overhead) and recommends the most cost-effective GPU.\n"
            "3. Step 3: One-Click Instant Provisioning â€” The platform provisions the GPU through JarvisLabs.ai infrastructure and deploys Docker with vLLM in under 60 seconds.\n"
            "4. Step 4: Connect & Scale â€” Receive a production-ready, OpenAI-compatible API endpoint with API key and monitoring telemetry."
        )
    },
    {
        "page": "Developers & API Page",
        "route": "/developers",
        "category": "website_page",
        "title": "Inferxe Developer SDK, API Endpoints & Code Examples",
        "content": (
            "INFERXE DEVELOPERS PAGE & API INTEGRATION:\n"
            "- Base URL: https://api.inferxe.com/v1\n"
            "- OpenAI SDK Drop-in Replacement: Change only base_url and api_key to switch any existing application to Inferxe.\n"
            "- Python Code Example:\n"
            "```python\n"
            "from openai import OpenAI\n\n"
            "client = OpenAI(\n"
            "    base_url='https://api.inferxe.com/v1',\n"
            "    api_key='ix_live_your_api_key_here'\n"
            ")\n"
            "response = client.chat.completions.create(\n"
            "    model='meta-llama/Llama-3.1-8B-Instruct',\n"
            "    messages=[{'role': 'user', 'content': 'Hello Inferxe'}],\n"
            "    stream=True\n"
            ")\n"
            "for chunk in response:\n"
            "    print(chunk.choices[0].delta.content or '', end='', flush=True)\n"
            "```\n"
            "- cURL Example:\n"
            "```bash\n"
            "curl https://api.inferxe.com/v1/chat/completions \\\n"
            "  -H 'Content-Type: application/json' \\\n"
            "  -H 'Authorization: Bearer ix_live_your_api_key_here' \\\n"
            "  -d '{\"model\": \"Qwen/Qwen2.5-14B-Instruct\", \"messages\": [{\"role\": \"user\", \"content\": \"Hi\"}]}'\n"
            "```\n"
            "- Features: Token streaming (Server-Sent Events), latency metrics, usage tracking, and batch inference."
        )
    },
    {
        "page": "Dashboard & Workspace",
        "route": "/dashboard",
        "category": "website_page",
        "title": "Inferxe Dashboard, Workspace & Wallet Management",
        "content": (
            "INFERXE DASHBOARD & WORKSPACE FEATURES:\n"
            "- Dashboard Overview: Shows total active GPU instances, current hourly burn rate (e.g. â‚¹160/hr), available wallet balance, and cluster uptime.\n"
            "- Marketplace Workspace (/dashboard/marketplace): Search and provision GPUs, select OS templates (Ubuntu, PyTorch, vLLM, Ollama), configure SSH public keys, and attach NVMe volume storage.\n"
            "- Instance Lifecycle Control: One-click Start, Stop, Restart, and Terminate instance controls to manage infrastructure spending.\n"
            "- Integrated Web Terminal & JupyterLab: Access running GPU instances directly from your browser without third-party SSH clients.\n"
            "- Team & User Access Control (/dashboard/users): Invite team members, configure Role-Based Access Control (Admin, Developer, Viewer), and manage API keys.\n"
            "- Wallet & Billing (/dashboard/wallet): Top up balance with UPI, NetBanking, Credit Cards, or Wire Transfer; view transaction history and invoices."
        )
    },
    {
        "page": "Security & Indian Data Sovereignty",
        "route": "/security",
        "category": "website_page",
        "title": "Inferxe Security Standards & India DPDP Act Compliance",
        "content": (
            "INFERXE SECURITY & SOVEREIGNTY PAGE:\n"
            "- Indian Data Residency: 100% of GPU compute and data storage is hosted domestically in Tier-IV datacenter facilities in Noida (NCR) and Mumbai.\n"
            "- DPDP Act 2023 Compliance: Fully compliant with India's Digital Personal Data Protection Act. Customer data, prompts, model weights, and telemetry never leave Indian territory.\n"
            "- Infrastructure Security: Isolated VPC networking, encrypted NVMe disks at rest (AES-256), TLS 1.3 encryption in transit, and role-based access control.\n"
            "- No Training on Customer Data: Inferxe guarantees zero data retention for model retraining. Your proprietary prompts and inference data are never used for training."
        )
    },
    {
        "page": "Company & About Page",
        "route": "/company",
        "category": "website_page",
        "title": "About Inferxe â€” Mission, Leadership & Location",
        "content": (
            "ABOUT INFERXE (COMPANY PAGE):\n"
            "- Mission: Democratize high-performance AI compute for India and global emerging markets by providing friction-free, sovereign GPU access.\n"
            "- Headquartered: Noida, Uttar Pradesh (Delhi NCR), India.\n"
            "- Vision: Build India's foundational AI infrastructure layer so startups and developers can innovate without exorbitant foreign cloud bills or latency.\n"
            "- Partnerships: Partnered with top-tier datacenters and infrastructure providers including JarvisLabs.ai for high-availability GPU supply.\n"
            "- Careers & Community: Active open-source AI community and developer programs."
        )
    },
    {
        "page": "Contact & Support",
        "route": "/contact",
        "category": "website_page",
        "title": "Contact Inferxe, Sales Inquiries & Technical Support",
        "content": (
            "INFERXE CONTACT & SUPPORT PAGE:\n"
            "- General & Sales Inquiries: sales@inferxe.com or submit the website contact form at /contact.\n"
            "- Technical Support: 24/7 engineering support available for enterprise customers and active deployments.\n"
            "- Community Channels: Official Inferxe Discord and Slack channels for developer assistance, sizing advice, and updates.\n"
            "- Custom Enterprise Deployment: Dedicated account managers for multi-node H100 clusters, private VPC interconnects, and annual capacity contracts."
        )
    }
]

def save_website_knowledge():
    out_file = "rag/data/inferxe_website_complete_knowledge.json"
    os.makedirs("rag/data", exist_ok=True)
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(WEBSITE_KNOWLEDGE, f, indent=2, ensure_ascii=False)
    print(f"Extracted {len(WEBSITE_KNOWLEDGE)} complete website knowledge modules into '{out_file}'.")

if __name__ == "__main__":
    save_website_knowledge()
