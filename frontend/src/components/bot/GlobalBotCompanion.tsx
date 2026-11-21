import React, { useState, useRef, useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { BotAvatar } from 'bot-avatars'
import { Send, Sparkles, X, RotateCcw } from 'lucide-react'
import { getSession, getPortalRole } from '../../lib/authStore'
import {
  ChatScope,
  ChatMessage,
  resolveChatScope,
  loadScopeMessages,
  saveScopeMessages,
  clearScopeMessages,
  getQuickPromptsForScope,
} from '../../lib/chatStore'
import {
  queryFineTunedModel,
  checkDomainGatekeeper,
  OUT_OF_SCOPE_REFUSAL,
} from '../../lib/llmService'

function walletSummary(): string {
  return 'Your wallet balance and transaction history are on the [Billing & wallet](/dashboard/app/billing) page. Add money there is a demo top-up: the amount is credited straight away and no real payment is taken. Inference requests are not currently charged.'
}

function recommendGpu(q: string): string | null {
  const m = q.match(/(\d+(?:\.\d+)?)\s*b\b/)
  const params = m ? Number(m[1]) : null
  const budget = q.match(/(?:₹|rs\.?|inr)\s*(\d+)/i)
  if (params === null && !budget && !q.includes('recommend') && !q.includes('suggest') && !q.includes('which gpu')) return null
  if (params !== null) {
    if (params <= 8) return `For a ${params}B model I recommend an NVIDIA L4 (24 GB, ₹60/hr) with 4/8-bit quantization, or an L40S (48 GB, ₹100/hr) for FP16 and longer context. Open Dashboard → GPU Recommendations to size it exactly.`
    if (params <= 34) return `For a ${params}B model I recommend an NVIDIA L40S (48 GB, ₹100/hr). Use FP8/AWQ if you need more concurrency.`
    return `A ${params}B model needs 80 GB+ — I recommend NVIDIA H100 SXM5 (₹275/hr), multi-GPU for FP16. Compare options in Dashboard → GPU Comparison.`
  }
  if (budget) {
    const b = Number(budget[1])
    if (b >= 275) return `With ₹${b}/hr you can afford an H100 SXM5 (80 GB, ₹275/hr) — the fastest option.`
    if (b >= 100) return `With ₹${b}/hr an L40S (48 GB, ₹100/hr) is the best value.`
    return `With ₹${b}/hr an L4 (24 GB, ₹60/hr) is the best fit.`
  }
  return 'Tell me your model size (e.g. "14B") or hourly budget (e.g. "₹100") and I will recommend a GPU. You can also open Dashboard → GPU Recommendations.'
}

const PUBLIC_WALLET_REPLY =
  "Login or Sign Up: First, you need to log in or sign up using your credentials at [Sign In](/login)."

function getDashboardWalletReply(): string {
  return (
    "Your wallet in the console: open [Billing & wallet](/dashboard/app/billing) to see your balance and transaction history.\n\n" +
    "To add money: click Add money on that page, enter the amount and confirm. This is a demo top-up, so no real payment (UPI, cards, NetBanking) is taken. Pricing is not configured, and inference requests are not currently charged to your wallet.\n\n" +
    `Status: ${walletSummary()}`
  )
}

const PUBLIC_ADMIN_REPLY =
  "Login or Sign Up: First, you need to log in or sign up with an Administrator account using your credentials at [Sign In](/login)."

const CUSTOMER_ADMIN_REFUSAL =
  "Admin features, provider analysis, and administrative details are restricted to Administrator accounts. Customers do not have permission to access administration features or provider analysis data."

const ADMIN_PROVIDER_REPLY =
  "Navigate to Provider Management: Open the [Provider Management](/dashboard/provider) section (Dashboard -> Provider Management).\n\n" +
  "Provider Analysis & Node Telemetry:\n" +
  "• Providers: the provider workspace currently shows sample data; no external GPU provider is integrated yet.\n" +
  "• Provider Health & Telemetry: Real-time telemetry monitoring for GPU node uptime, thermals, power draw, and VRAM utilization across Indian data centers.\n" +
  "• Provider Routing & Allocation: planned (multi-provider routing is not implemented yet).\n" +
  "• Margin & Revenue Tracking: Admin controls for per-GPU provider settlement rates, markup margins, and marketplace payouts."

const ADMIN_FEATURES_REPLY =
  "Inferxe Administration Features:\n\n" +
  "• Provider Management & Analysis: Monitor provider telemetry, GPU availability, and node health across cluster nodes at [Provider Management](/dashboard/provider).\n" +
  "• User & Role Management (RBAC): Configure developer roles, invite team members, and set per-user monthly spend limits at [User Management](/dashboard/users).\n" +
  "• Marketplace & Rate Control: Configure retail pricing, spot discount thresholds, and billing settlement margins.\n" +
  "• Sovereign Audit Logs: Inspect MeitY / DPDP compliance logs, cluster access records, and telemetry audits."

function isWalletQuery(q: string): boolean {
  return (
    q.includes('wallet') ||
    q.includes('payment') ||
    q.includes('how to pay') ||
    q.includes('how payment') ||
    q.includes('pay') ||
    q.includes('billing') ||
    q.includes('top up') ||
    q.includes('topup') ||
    q.includes('recharge') ||
    q.includes('add money') ||
    q.includes('deposit') ||
    q.includes('add fund') ||
    q.includes('add balance')
  )
}

function isProviderAnalysisQuery(q: string): boolean {
  return (
    q.includes('provider analysis') ||
    q.includes('provider details') ||
    q.includes('provider management') ||
    q.includes('provider telemetry') ||
    q.includes('provider telemetr') ||
    q.includes('provider node') ||
    (q.includes('provider') && (q.includes('analysis') || q.includes('admin') || q.includes('manage') || q.includes('how') || q.includes('page')))
  )
}

function isAdminFeaturesQuery(q: string): boolean {
  return (
    q.includes('admin features') ||
    q.includes('admin feature') ||
    q.includes('admin feratures') ||
    q.includes('administrative') ||
    q.includes('administration') ||
    (q.includes('admin') && (q.includes('details') || q.includes('capability') || q.includes('capabilities') || q.includes('dashboard') || q.includes('role')))
  )
}

export function getBotReply(query: string, currentPath: string = '/'): string {
  const rawQ = query.toLowerCase().trim()
  // Normalize common typos and variations
  const q = rawQ
    .replace(/\bot\b/g, 'to')
    .replace(/\bpriicng\b/g, 'pricing')
    .replace(/\bgpuss\b/g, 'gpus')

  // 1. Domain Boundary Gatekeeper
  const domainStatus = checkDomainGatekeeper(query)
  if (domainStatus === 'out_of_scope') {
    return OUT_OF_SCOPE_REFUSAL
  }

  // 2. Greetings & Assistance Capabilities
  if (
    domainStatus === 'greeting' ||
    q.includes('answer my question') ||
    q.includes('can you answer') ||
    q.includes('what can you do') ||
    q.includes('help me') ||
    q.includes('assist me') ||
    q === 'help'
  ) {
    return (
      "Hi there! I am your Inferxe AI Assistant. Ask me anything about:\n" +
      "• **GPU Rental & Marketplace**: How to browse and reserve GPUs across regions.\n" +
      "• **Pricing & Rates**: Hourly rates and spot estimates for NVIDIA H100, L40S, L4, RTX 4090, and A100.\n" +
      "• **Hardware Specs & Sizing**: Architecture, VRAM, and memory sizing for open-weight models.\n" +
      "• **Customer Console**: API keys, usage, notifications, and wallet demo top-ups.\n" +
      "• **Inference API**: Sending requests to `POST /api/v1/inference` with your API key.\n\n" +
      "What would you like to know?"
    )
  }

  const isInsideDashboard = currentPath.startsWith('/dashboard')
  const session = getSession()
  const isAuthenticated = isInsideDashboard && !!session
  const portalRole = getPortalRole(session?.user?.role)
  const isAdmin = isInsideDashboard && (
    portalRole === 'admin' ||
    currentPath.startsWith('/dashboard/provider') ||
    currentPath.startsWith('/dashboard/users')
  )

  // 3a. Wallet Queries
  if (isWalletQuery(q)) {
    if (!isAuthenticated && q === 'how wallet works in this web site') {
      return PUBLIC_WALLET_REPLY
    }
    return getDashboardWalletReply()
  }

  // 3b. Admin & Provider Analysis Queries
  if (isProviderAnalysisQuery(q) || isAdminFeaturesQuery(q)) {
    if (!isAuthenticated) {
      return PUBLIC_ADMIN_REPLY
    }
    if (!isAdmin) {
      return CUSTOMER_ADMIN_REFUSAL
    }
    if (isProviderAnalysisQuery(q)) {
      return ADMIN_PROVIDER_REPLY
    }
    return ADMIN_FEATURES_REPLY
  }

  // 3c. Account Login / Registration Guidance
  if (
    q.includes('login') ||
    q.includes('sign in') ||
    q.includes('signup') ||
    q.includes('sign up') ||
    q.includes('register') ||
    q.includes('create account') ||
    q.includes('forgot password') ||
    q.includes('reset password') ||
    q.includes('api key')
  ) {
    if (q.includes('create account') || q.includes('signup') || q.includes('sign up') || q.includes('register')) {
      return "Go to [inferxe.com](https://inferxe.com), click **Get Started** or **Sign Up**, and register with your work email or GitHub/Google account. Once verified, you can add credits and generate an API key immediately—no manual GPU quota approval required."
    }
    if (q.includes('forgot password') || q.includes('reset password') || q.includes('cannot access')) {
      return "On the Inferxe login page, click **Forgot Password** to receive a reset link via email. If you signed up using Google or GitHub, use that same sign-in button instead of a password. For locked accounts, contact Inferxe support through the dashboard or website."
    }
    if (q.includes('api key') || q.includes('api keys') || q.includes('find my key') || q.includes('where do i find')) {
      return "After logging into your Inferxe dashboard, open the [API keys](/dashboard/app/api-keys) tab in the left navigation menu and click **Create New Key**. Copy and store the key immediately, as it is only displayed once."
    }
    const session = getSession()
    if (session) {
      return `You are currently logged in as **${session.user.fullName}** (${session.user.email}). Click the **Dashboard** button to access your GPU Marketplace, Deployments, and API Keys.`
    }
    return "Click the **Sign In** or **Login** button in the top-right corner of [inferxe.com](https://inferxe.com). You can sign in using your registered email and password or your linked OAuth provider (such as Google or GitHub) to open your Inferxe dashboard."
  }

  // 3d. Project & Platform Overview / What is Inferxe
  if (
    q.includes('what is this project') ||
    q.includes('project overview') ||
    q.includes('explain this project') ||
    q.includes('tell me about this project') ||
    q.includes('about the project') ||
    q.includes('what is inferxe') ||
    q.includes('about inferxe') ||
    q.includes('website overview') ||
    q.includes('explain this website') ||
    q.includes('tell me about this website')
  ) {
    return "**Inferxe** is a GPU marketplace and AI inference platform built around the idea of **'One API, Many GPU Providers'**.\n\n**Available today:**\n1. **Inference API**: `POST /api/v1/inference` with your Inferxe API key as a bearer token. The server chooses the model; there is no streaming and it is not OpenAI-compatible yet.\n2. **Customer console**: API keys, usage, notifications, a read-only billing & wallet view, and a GPU marketplace where you can save listings.\n3. **Sign-in**: customer and admin portals with separate roles.\n\n**Planned (not available yet):** GPU provisioning and deployments, multi-provider routing with automatic failover, and self-service wallet top-ups."
  }

  // 3e. Project Contributions & Author Work
  if (
    q.includes('sahith') ||
    q.includes('who built this') ||
    q.includes('what did you do in this project') ||
    q.includes('what did i do in this project') ||
    q.includes('what is done in this project') ||
    q.includes('my contributions') ||
    q.includes('what you done') ||
    q.includes('what i done')
  ) {
    return "In this project, **Sahith** engineered the full-stack architecture for the **Inferxe GPU Marketplace**:\n\n• **Frontend Engineering**: Developed a high-performance, cyber-dark UI using **React 19, TypeScript, and Vite**, with glassmorphism styling and responsive micro-interactions.\n• **AWS Cognito Auth & RBAC**: Integrated Cognito user pools, secure JWT exchange, and persistent sessions for Customer and Admin roles.\n• **Customer Portal & Kanban**: Designed real-time compute telemetry cards and an interactive 3-column Kanban board for managing inference jobs and deployments.\n• **3D Virtual Cards & Top-Up Engine**: Built interactive 3D virtual cards (flip, freeze/unfreeze, number masking) and an idempotent `+ Top Up` workflow with instantaneous balance synchronization (`inferxe_wallet_change`).\n• **FastAPI & Node.js Microservices**: Connected backend services for RAG vector search (ChromaDB), billing idempotency, and model evaluation.\n• **Multi-Remote CI/CD**: Maintained and verified production builds synchronized across both **GitHub (`main`)** and **GitLab (`Main_project`)**."
  }

  // 3f. Customer Dashboard & Kanban Board
  if (
    q.includes('customer dashboard') ||
    q.includes('customer portal') ||
    q.includes('kanban') ||
    q.includes('board') ||
    q.includes('telemetry') ||
    q.includes('burn rate') ||
    q.includes('runtime')
  ) {
    return "### Customer Console Guide:\n\n" +
      "• [Overview](/dashboard/app): your account at a glance, built from your real records.\n" +
      "• [Model marketplace](/dashboard/app/models): a reference catalogue of open-weight models and a GPU memory estimator. Reference specs only, not live availability or pricing.\n" +
      "• [GPU marketplace](/dashboard/app/gpus): GPU capacity listed by providers. You can save listings; ordering is not available yet.\n" +
      "• [Inference playground](/dashboard/app/playground): send a prompt with your API key when the inference service is available.\n" +
      "• [Deployments](/dashboard/app/deployments): read-only records. Provisioning is not available yet.\n" +
      "• [API keys](/dashboard/app/api-keys), [Usage & analytics](/dashboard/app/usage), [Billing & wallet](/dashboard/app/billing) (read-only), [Notifications](/dashboard/app/notifications), and [Settings](/dashboard/app/settings).\n" +
      "• [SSH keys & notebooks](/dashboard/app/developer): notebook sessions are simulated records, with no real runtime."
  }

  // 3g. GPU Rental, Booking & Marketplace Reservation
  if (
    q.includes('rent') ||
    q.includes('rental') ||
    q.includes('book') ||
    q.includes('booking') ||
    q.includes('reserve') ||
    q.includes('reservation') ||
    q.includes('order gpu') ||
    q.includes('buy gpu') ||
    q.includes('hire gpu') ||
    q.includes('get a gpu') ||
    q.includes('how to get gpu') ||
    q.includes('how to rent') ||
    (q.includes('gpu') && (q.includes('available') || q.includes('capacity') || q.includes('provision') || q.includes('listings')))
  ) {
    return (
      "### How to Rent or Reserve a GPU on Inferxe:\n\n" +
      "1. **Explore Available GPUs**: Go to the [GPU marketplace](/dashboard/app/gpus) to browse active provider listings across regions (NVIDIA A30, L4, RTX 4090, A100, L40S, and H100 SXM).\n" +
      "2. **Save to Shortlist**: Click **Save** on any listing to bookmark specific GPU configurations for your project.\n" +
      "3. **Ordering Status**: Direct self-service GPU booking and automated cloud provisioning are in active rollout. Provisioning from the console is not live yet.\n" +
      "4. **Run Model Inference Now**:\n" +
      "   • Create an API key in [API keys](/dashboard/app/api-keys).\n" +
      "   • Send your inference requests to `POST /api/v1/inference` with your bearer token.\n" +
      "   • Test prompts in real time via the [Inference playground](/dashboard/app/playground).\n" +
      "5. **Size Memory Before Renting**: Open the [Model marketplace](/dashboard/app/models) to calculate exact VRAM and KV-cache requirements for your target model and context length."
    )
  }

  // 3h. GPU Pricing & Rates
  if (
    q.includes('pricing') ||
    q.includes('price') ||
    q.includes('prices') ||
    q.includes('rate') ||
    q.includes('rates') ||
    q.includes('cost') ||
    q.includes('costs') ||
    q.includes('tariff') ||
    q.includes('how much') ||
    q.includes('hourly') ||
    q.includes('₹') ||
    q.includes('$') ||
    q.includes('inr') ||
    q.includes('usd')
  ) {
    // Specific H100 pricing query
    if (q.includes('h100') || q.includes('hopper')) {
      return (
        "### NVIDIA H100 SXM (80 GB) Rates:\n\n" +
        "• **JarvisLabs.ai (MVP Provider)**: $3.49/hr (₹330/hr) on-demand, and $1.55/hr (₹146/hr) spot instances.\n" +
        "• **E2E Networks**: ₹340/hr on-demand.\n" +
        "• **Yotta NM1 Shakti Cloud**: ₹350/hr on-demand.\n" +
        "• **Inferxe Proposed Marketplace Rate**: ₹250–₹280/hr with automated spot optimization.\n\n" +
        "Compare listings on the [GPU marketplace](/dashboard/app/gpus)."
      )
    }

    return (
      "### Inferxe GPU Pricing & Planning Rates:\n\n" +
      "• **NVIDIA L4 (24 GB GDDR6)**: ~₹60/hr ($0.70/hr) on-demand (Spot rates down to ~₹18/hr on JarvisLabs) — Ideal for 7B/8B quantized models, embeddings, and vision AI.\n" +
      "• **NVIDIA RTX 4090 (24 GB GDDR6X)**: ~₹55–₹70/hr ($0.65–$0.80/hr) — High raw FP32 compute for dev, fine-tuning, and light batch inference.\n" +
      "• **NVIDIA L40S (48 GB GDDR6 ECC)**: ~₹100/hr ($1.20/hr) on-demand (Spot rates ~₹61/hr) — Best value for 14B models at FP16 or 70B models at FP8.\n" +
      "• **NVIDIA A100 (40 GB / 80 GB PCIe/SXM)**: ~₹180–₹220/hr ($2.15–$2.60/hr) — High-bandwidth memory (up to 2 TB/s HBM2e) for heavy batched LLM workloads.\n" +
      "• **NVIDIA H100 SXM (80 GB HBM3)**: ~₹250–₹300/hr ($3.00–$3.50/hr) on-demand (Spot rates ~₹146/hr) — Peak Transformer Engine throughput with 3.35 TB/s bandwidth.\n\n" +
      "*Note: Final prices depend on provider rate cards (JarvisLabs, RunPod, E2E, Yotta), spot vs on-demand availability, region, and local taxes. Check the [GPU marketplace](/dashboard/app/gpus) for current provider listings.*"
    )
  }

  // 3i. Deploying Models & Running Inference
  if (
    q.includes('deploy') ||
    q.includes('run model') ||
    q.includes('how to use') ||
    q.includes('how to start') ||
    q.includes('how does it work') ||
    q.includes('how it works')
  ) {
    return "### Deployments and inference on Inferxe:\n\n" +
      "**Deployments are not available yet.** Inferxe does not provision GPUs or serve models from deployments today, so there is nothing to deploy from the console. The [Deployments](/dashboard/app/deployments) page lists any existing records read-only.\n\n" +
      "**What you can do today:**\n" +
      "1. Create an API key on [API keys](/dashboard/app/api-keys) and copy it when it is shown (it is displayed only once).\n" +
      "2. Send a request with `POST /api/v1/inference`, using your key as a bearer token and a JSON body with a `prompt` (optionally `max_tokens` and `temperature`). The server chooses the model.\n" +
      "3. Try it in the [Inference playground](/dashboard/app/playground) when the inference service reports that its provider is configured.\n" +
      "4. Size a model for a GPU with the [Model marketplace](/dashboard/app/models) estimator (reference estimates only)."
  }

  // 3j. Model Catalog & Supported Models
  if (
    q.includes('which models') ||
    q.includes('supported models') ||
    q.includes('what models') ||
    q.includes('available models') ||
    q.includes('model catalog') ||
    q.includes('model marketplace') ||
    q.includes('list models')
  ) {
    return (
      "### Supported Models in Inferxe Reference Catalog:\n\n" +
      "You can explore open-weight models and run memory sizing in the [Model marketplace](/dashboard/app/models):\n" +
      "• **Llama 3.3 / 3.1 (8B, 70B)**: Meta's flagship language models for general reasoning, conversation, and code.\n" +
      "• **Qwen 2.5 / Coder (7B, 14B, 32B, 72B)**: High-capability multilingual and coding models.\n" +
      "• **Mistral & Mixtral (7B, 8x7B, 8x22B MoE)**: High-efficiency MoE architectures optimized for fast inference.\n" +
      "• **DeepSeek-R1 / V3 (671B MoE / distilled 7B–70B)**: Premier open reasoning models.\n" +
      "• **Gemma 2 (2B, 9B, 27B)**: Google's lightweight open-weight models.\n\n" +
      "Visit the [Model marketplace](/dashboard/app/models) to calculate exact VRAM (weights + KV cache) for your target context length."
    )
  }

  // 4. Specific GPU Hardware Comparisons & Specifications
  if (
    (q.includes('compare') && q.includes('h100') && q.includes('a100')) ||
    (q.includes('h100') && q.includes('a100') && (q.includes('vs') || q.includes('difference') || q.includes('better')))
  ) {
    return (
      "### NVIDIA H100 vs A100 Comparison:\n\n" +
      "• **Architecture**: Hopper (4nm) vs Ampere (7nm).\n" +
      "• **Memory Bandwidth**: H100 has 3.35 TB/s (HBM3) vs A100's 2.0 TB/s (HBM2e) — 1.67x bandwidth for faster memory-bound decode.\n" +
      "• **Compute Speed**: H100 delivers up to 3x–4x higher Tensor Core throughput with its FP8 Transformer Engine (1,979 FP8 TFLOPS vs A100 with 624 FP16 TFLOPS and no native FP8).\n" +
      "• **Interconnect**: 900 GB/s NVLink 4 on H100 vs 600 GB/s NVLink 3 on A100.\n" +
      "• **Pricing**: A100 is ~₹180–₹220/hr; H100 SXM is ~₹250–₹300/hr."
    )
  }

  if (q.includes('compare nvidia l4 and l40s') || (q.includes('l4') && q.includes('l40s') && (q.includes('compare') || q.includes('vs') || q.includes('difference')))) {
    return 'Both NVIDIA L4 and L40S are based on Ada Lovelace architecture:\n• Memory: L4 has 24 GB GDDR6 (300 GB/s); L40S has 48 GB GDDR6 with ECC (864 GB/s).\n• Compute: L4 delivers 485 FP8 / 242 FP16 TFLOPS; L40S delivers 1,466 FP8 / 733 FP16 TFLOPS (3x compute).\n• Power: L4 requires 72W; L40S requires 350W.\n• Pricing: On JarvisLabs, L4 is ₹41/hr on-demand vs ₹18/hr spot. L40S is ₹118/hr on-demand vs ₹61/hr spot. Inferxe marketplace retail rates are ₹60/hr for L4 and ₹100/hr for L40S.'
  }

  if (
    (q.includes('h100') || q.includes('hopper')) &&
    (q.includes('spec') || q.includes('vram') || q.includes('bandwidth') || q.includes('architecture') || q.includes('tflops'))
  ) {
    return (
      "### NVIDIA H100 SXM5 (80 GB) Specifications:\n\n" +
      "• **Architecture**: NVIDIA Hopper (TSMC 4N process)\n" +
      "• **GPU Memory**: 80 GB HBM3 with 3.35 TB/s memory bandwidth\n" +
      "• **Compute Throughput**: 1,979 FP8 TFLOPS, 989 FP16/BF16 Tensor TFLOPS, 60 FP64 TFLOPS\n" +
      "• **Transformer Engine**: Native FP8 hardware precision for 2x faster LLM execution\n" +
      "• **Interconnect**: 900 GB/s NVLink 4th Gen\n" +
      "• **Thermal Design Power (TDP)**: 700W SXM5\n" +
      "• **Best Workloads**: Training & serving 70B+ frontier models (Llama 3 70B, DeepSeek-R1, Qwen 2.5 72B)."
    )
  }

  if (
    q.includes('a100') &&
    (q.includes('spec') || q.includes('vram') || q.includes('bandwidth') || q.includes('architecture') || q.includes('tflops'))
  ) {
    return (
      "### NVIDIA A100 (40 GB / 80 GB) Specifications:\n\n" +
      "• **Architecture**: NVIDIA Ampere (TSMC 7nm process)\n" +
      "• **GPU Memory**: 40 GB HBM2 (1.55 TB/s) or 80 GB HBM2e (2.0 TB/s)\n" +
      "• **Compute Throughput**: 624 FP16/BF16 Tensor TFLOPS (dense 312 TFLOPS), 19.5 FP64 TFLOPS\n" +
      "• **Interconnect**: 600 GB/s NVLink 3rd Gen (SXM) or PCIe Gen4 (64 GB/s)\n" +
      "• **Thermal Design Power (TDP)**: 250W–400W\n" +
      "• **Best Workloads**: Foundation model fine-tuning, large-scale deep learning, and multi-stream batch inference."
    )
  }

  if (
    (q.includes('4090') || q.includes('rtx 4090')) &&
    (q.includes('spec') || q.includes('vram') || q.includes('bandwidth') || q.includes('architecture') || q.includes('tflops'))
  ) {
    return (
      "### NVIDIA GeForce RTX 4090 Specifications:\n\n" +
      "• **Architecture**: Ada Lovelace (AD102)\n" +
      "• **GPU Memory**: 24 GB GDDR6X (1,008 GB/s bandwidth)\n" +
      "• **Compute Throughput**: 330 FP16 Tensor TFLOPS, 82.6 TFLOPS FP32\n" +
      "• **Thermal Design Power (TDP)**: 450W PCIe\n" +
      "• **Best Workloads**: Local AI development, fine-tuning 7B/8B models with LoRA/QLoRA, diffusion models (FLUX, SDXL)."
    )
  }

  if (q.includes('specifications of nvidia l4') || q.includes('specs of nvidia l4') || q.includes('nvidia l4 specs') || (q.includes('l4') && q.includes('spec'))) {
    return 'The NVIDIA L4 is built on NVIDIA\'s Ada Lovelace architecture. It features 24 GB of GDDR6 memory with 300 GB/s bandwidth. Compute throughput delivers 485 FP8 TFLOPS and 242 FP16/BF16 Tensor TFLOPS at a low 72W TDP in a single-slot PCIe form factor.'
  }

  if (q.includes('l40s') && q.includes('spec')) {
    return 'The NVIDIA L40S is built on NVIDIA\'s Ada Lovelace architecture. It features 48 GB of GDDR6 memory with ECC and 864 GB/s bandwidth. Compute throughput delivers 1,466 FP8 TFLOPS and 733 FP16/BF16 Tensor TFLOPS at 350W TDP, designed for both heavy LLM inference and generative AI fine-tuning.'
  }

  if (q.includes('quantization') && (q.includes('memory') || q.includes('vram') || q.includes('affect'))) {
    return 'Quantization reduces GPU memory requirements by storing weights in lower-precision representations:\n• FP16/BF16: 2 bytes per parameter (a 7B model requires ~14 GB for weights).\n• FP8: 1 byte per parameter (50% reduction, ~7 GB for weights).\n• AWQ / INT4: 0.5 bytes per parameter (75% reduction, ~3.5 GB for weights).\n• KV-Cache Quantization: Cutting KV-cache precision from FP16 to FP8 halves KV cache footprint, enabling 2x longer context windows or higher concurrency.'
  }

  if (q.includes('factors influence') || q.includes('influence llm inference cost') || q.includes('inference cost')) {
    return 'Six core factors influence LLM inference cost:\n1. Model Parameter Count: Determines required VRAM and FLOPS per token.\n2. Precision & Quantization: Using FP8 or AWQ 4-bit allows using smaller, cheaper GPUs (e.g. L4 instead of L40S).\n3. Context Window Length: Longer prompts expand KV cache memory and compute requirements.\n4. Concurrency & Continuous Batching: Higher batch concurrency maximizes GPU compute utilization.\n5. GPU Memory Bandwidth: Higher bandwidth (e.g. 3.35 TB/s HBM3 vs 300 GB/s GDDR6) increases token generation speed during memory-bound decode.\n6. Provider Pricing Model: Dedicated GPU hourly billing vs serverless per-token API pricing.'
  }

  if (q.includes('suitable for') || q.includes('which gpu') || q.includes('recommend a gpu')) {
    const rec = recommendGpu(q)
    if (rec) return rec
  }

  if (q.includes('features does inferxe provide') || q.includes('inferxe provide') || q.includes('features')) {
    return 'Inferxe features today:\n1. GPU catalogue and a GPU sizing calculator (weights + KV cache) on the website. Rates shown are planning figures, not live prices.\n2. Inference API: POST /api/v1/inference with an Inferxe API key (prompt in, text and token usage out).\n3. Customer console: API keys, usage, notifications and a read-only billing & wallet view.\nPlanned: GPU deployments, multi-provider routing with failover, an OpenAI-compatible API and self-service top-ups. Inferxe is a software layer and does not own data centres.'
  }

  if (q.includes('14b') || (q.includes('14') && q.includes('model'))) {
    return 'For a 14B model at FP16 with 16k context, weights require ~28 GB plus ~4-6 GB for KV cache. An NVIDIA L40S (48 GB) fits with headroom at ₹100/hr, while a 24 GB L4 would require 4-bit AWQ quantization.'
  }

  if (q.includes('70b') || q.includes('llama 3') || q.includes('llama')) {
    return 'Llama 3.3 70B at FP8 needs roughly 72 GB for weights plus KV cache, so it fits on two 48 GB L40S or one 80 GB H100 with a short context. Measured throughput is not published yet: the benchmark programme is still in progress.'
  }

  if (q.includes('india') || q.includes('sovereign') || q.includes('mumbai') || q.includes('security') || q.includes('meity') || q.includes('dpdp')) {
    return 'Inferxe is designed India-first: region and residency are meant to be routing constraints, and India-hosted GPU clouds are being evaluated as future providers. Inferxe does not currently claim any certification or compliance attestation; see the Security page for the current controls.'
  }

  if (
    (q.includes('api') || q.includes('endpoint') || q.includes('curl') || q.includes('python') || q.includes('sdk')) &&
    (q.includes('example') || q.includes('code') || q.includes('how to call') || q.includes('sample') || q.includes('request'))
  ) {
    return (
      "### Inferxe Inference API Example:\n\n" +
      "**cURL:**\n" +
      "```bash\n" +
      "curl -X POST https://api.inferxe.com/api/v1/inference \\\n" +
      "  -H \"Authorization: Bearer YOUR_INFERXE_API_KEY\" \\\n" +
      "  -H \"Content-Type: application/json\" \\\n" +
      "  -d '{\"prompt\": \"Hello Inferxe!\", \"max_tokens\": 256}'\n" +
      "```\n\n" +
      "**Python:**\n" +
      "```python\n" +
      "import requests\n\n" +
      "res = requests.post(\n" +
      "    \"https://api.inferxe.com/api/v1/inference\",\n" +
      "    headers={\"Authorization\": \"Bearer YOUR_INFERXE_API_KEY\"},\n" +
      "    json={\"prompt\": \"Hello Inferxe!\", \"max_tokens\": 256}\n" +
      ")\n" +
      "print(res.json())\n" +
      "```\n\n" +
      "Create or copy your bearer token on the [API keys](/dashboard/app/api-keys) page."
    )
  }

  if (q.includes('api') || q.includes('openai') || q.includes('sdk') || q.includes('endpoint') || q.includes('python')) {
    return 'The Inferxe inference API is a simple HTTP endpoint: POST /api/v1/inference with your Inferxe API key as a bearer token and a JSON body containing a prompt (optionally max_tokens and temperature). It is not an OpenAI-compatible API, and the server currently chooses the model. See the API keys page in your console for examples.'
  }

  if (q.includes('user') || q.includes('dashboard') || q.includes('admin') || q.includes('seat') || q.includes('rbac')) {
    return 'Team management (inviting users, roles and spend limits) is handled by Inferxe administrators in the admin portal. Self-service team seats and spend limits for customers are not available yet.'
  }

  return (
    "I am your Inferxe GPU & AI Assistant. Here is how I can help:\n\n" +
    "• **Rent & Reserve GPUs**: Browse live provider capacity on the [GPU marketplace](/dashboard/app/gpus).\n" +
    "• **Pricing & Rates**: Hourly rates starting at ₹60/hr for L4, ₹100/hr for L40S, and ₹250–₹300/hr for H100 SXM.\n" +
    "• **Model Sizing**: Calculate required VRAM and KV cache memory on the [Model marketplace](/dashboard/app/models).\n" +
    "• **Inference API**: Generate keys on [API keys](/dashboard/app/api-keys) and call `POST /api/v1/inference`.\n" +
    "• **Billing & Wallet**: View account credits and demo top-ups at [Billing & wallet](/dashboard/app/billing).\n\n" +
    "Ask me about any specific GPU (e.g. 'H100 specs', 'L4 vs L40S'), pricing, or model sizing (e.g. 'GPU for 70B model')."
  )
}

function FormattedMessage({ text }: { text: string }) {
  // Parse inline markdown tokens: **bold**, `code`, [label](url), *italic*
  const parseInline = (line: string): React.ReactNode[] => {
    let normalized = line
    if (!normalized.includes('**')) {
      const labelMatch = normalized.match(/^([A-Za-z0-9\s/&,–—-]+):(\s+.+)$/)
      if (labelMatch) {
        normalized = `**${labelMatch[1]}**:${labelMatch[2]}`
      }
    }

    const regex = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|\*[^*]+\*)/g
    const parts = normalized.split(regex)

    return parts.map((part, index) => {
      if (!part) return null

      // **bold** -> <strong>
      if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
        return (
          <strong key={index} className="bot-msg-strong">
            {part.slice(2, -2)}
          </strong>
        )
      }

      // `code` -> <code>
      if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
        return (
          <code key={index} className="bot-msg-code">
            {part.slice(1, -1)}
          </code>
        )
      }

      // *italic* -> <em>
      if (part.startsWith('*') && part.endsWith('*') && part.length >= 2) {
        return <em key={index}>{part.slice(1, -1)}</em>
      }

      // [label](url) -> internal Link or external <a>
      const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
      if (linkMatch) {
        const [, label, url] = linkMatch
        if (url.startsWith('/')) {
          return (
            <Link key={index} to={url} className="bot-msg-link">
              {label}
            </Link>
          )
        }
        return (
          <a
            key={index}
            href={url}
            className="bot-msg-link"
            target="_blank"
            rel="noreferrer"
          >
            {label}
          </a>
        )
      }

      return part
    })
  }

  const rawLines = text.split('\n')
  const elements: React.ReactNode[] = []
  let currentList: { type: 'ul' | 'ol'; items: React.ReactNode[] } | null = null
  let inCodeBlock = false
  let codeBlockLines: string[] = []

  const flushList = () => {
    if (!currentList) return
    if (currentList.type === 'ul') {
      elements.push(
        <ul key={`ul-${elements.length}`} className="bot-msg-list bot-msg-list--ul">
          {currentList.items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      )
    } else {
      elements.push(
        <ol key={`ol-${elements.length}`} className="bot-msg-list bot-msg-list--ol">
          {currentList.items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ol>
      )
    }
    currentList = null
  }

  rawLines.forEach((rawLine, idx) => {
    const line = rawLine.trim()

    // Code block fences ```
    if (line.startsWith('```')) {
      flushList()
      if (inCodeBlock) {
        elements.push(
          <pre key={`code-${idx}`} className="bot-msg-pre">
            <code className="bot-msg-codeblock">{codeBlockLines.join('\n')}</code>
          </pre>
        )
        codeBlockLines = []
        inCodeBlock = false
      } else {
        inCodeBlock = true
        codeBlockLines = []
      }
      return
    }

    if (inCodeBlock) {
      codeBlockLines.push(rawLine)
      return
    }

    if (!line) {
      flushList()
      return
    }

    // Heading 3: starts with ###
    if (line.startsWith('### ')) {
      flushList()
      elements.push(
        <h4 key={`h-${idx}`} className="bot-msg-heading">
          {parseInline(line.replace(/^###\s+/, ''))}
        </h4>
      )
      return
    }

    // Bullet list item: starts with •, -, or *
    const bulletMatch = line.match(/^[•\-*]\s+(.+)$/)
    if (bulletMatch) {
      if (currentList && currentList.type !== 'ul') flushList()
      if (!currentList) currentList = { type: 'ul', items: [] }
      currentList.items.push(parseInline(bulletMatch[1]))
      return
    }

    // Numbered list item: starts with 1., 2., etc.
    const numberedMatch = line.match(/^(\d+)\.\s+(.+)$/)
    if (numberedMatch) {
      if (currentList && currentList.type !== 'ol') flushList()
      if (!currentList) currentList = { type: 'ol', items: [] }
      currentList.items.push(parseInline(numberedMatch[2]))
      return
    }

    flushList()
    elements.push(
      <p key={`p-${idx}`} className="bot-msg-p">
        {parseInline(line)}
      </p>
    )
  })

  flushList()
  if (inCodeBlock && codeBlockLines.length > 0) {
    elements.push(
      <pre key="code-final" className="bot-msg-pre">
        <code className="bot-msg-codeblock">{codeBlockLines.join('\n')}</code>
      </pre>
    )
  }

  return <div className="bot-chat-msg__formatted">{elements}</div>
}

export function GlobalBotCompanion() {
  const location = useLocation()
  const activeScope = resolveChatScope(location.pathname)
  const currentScopeRef = useRef<ChatScope>(activeScope)

  const [isOpen, setIsOpen] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem('inferxe_chat_open') === '1'
    } catch {
      return false
    }
  })
  const [inputVal, setInputVal] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadScopeMessages(activeScope))
  const [isTyping, setIsTyping] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const chatWindowRef = useRef<HTMLDivElement>(null)
  const launcherRef = useRef<HTMLDivElement>(null)

  // Switch chat scope when navigating between public, customer, and admin portals
  useEffect(() => {
    const nextScope = resolveChatScope(location.pathname)
    if (nextScope !== currentScopeRef.current) {
      saveScopeMessages(currentScopeRef.current, messages)
      currentScopeRef.current = nextScope
      const freshMessages = loadScopeMessages(nextScope)
      setMessages(freshMessages)
      setInputVal('')
      setIsTyping(false)
    }
  }, [location.pathname])

  // Also listen for authentication state changes (login, logout, portal switch)
  useEffect(() => {
    const handleAuthChange = () => {
      const nextScope = resolveChatScope(location.pathname)
      currentScopeRef.current = nextScope
      const freshMessages = loadScopeMessages(nextScope)
      setMessages(freshMessages)
      setInputVal('')
      setIsTyping(false)
    }

    const handleOpenBot = () => {
      setIsOpen(true)
      try {
        sessionStorage.setItem('inferxe_chat_open', '1')
      } catch {}
    }

    window.addEventListener('inferxe_open_bot', handleOpenBot)
    window.addEventListener('inferxe-auth-change', handleAuthChange)
    window.addEventListener('storage', handleAuthChange)
    return () => {
      window.removeEventListener('inferxe_open_bot', handleOpenBot)
      window.removeEventListener('inferxe-auth-change', handleAuthChange)
      window.removeEventListener('storage', handleAuthChange)
    }
  }, [location.pathname])

  // Automatically save messages for the active scope whenever they change
  useEffect(() => {
    if (messages && messages.length > 0) {
      saveScopeMessages(currentScopeRef.current, messages)
    }
  }, [messages])

  const [isLight, setIsLight] = useState<boolean>(() => {
    if (typeof document !== 'undefined') {
      return (
        document.documentElement.getAttribute('data-theme') === 'light' ||
        document.documentElement.classList.contains('light')
      )
    }
    return false
  })

  useEffect(() => {
    const updateTheme = () => {
      const light =
        document.documentElement.getAttribute('data-theme') === 'light' ||
        document.documentElement.classList.contains('light')
      setIsLight(light)
    }
    updateTheme()
    const observer = new MutationObserver(updateTheme)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'class'],
    })
    return () => observer.disconnect()
  }, [])

  // Console mint (forest accent #6ee0a1); a deeper mint keeps contrast on light pages.
  const botColor = isLight ? '#49c27f' : '#6ee0a1'

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    if (isOpen) {
      scrollToBottom()
      setTimeout(() => inputRef.current?.focus(), 150)
    }
  }, [isOpen, messages, isTyping])

  const handleSend = async (textToSend?: string) => {
    const text = (textToSend || inputVal).trim()
    if (!text || isTyping) return

    const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    const nowTs = Date.now()
    const userMsg: ChatMessage = {
      id: `usr-${nowTs}`,
      sender: 'user',
      text,
      time: now,
      timestamp: nowTs,
    }

    const updatedMessages = [...messages, userMsg]
    setMessages(updatedMessages)
    saveScopeMessages(currentScopeRef.current, updatedMessages)
    setInputVal('')
    setIsTyping(true)

    try {
      const qLower = text.toLowerCase().trim()
      const isInsideDashboard = location.pathname.startsWith('/dashboard')
      const session = getSession()
      const isAuthenticated = isInsideDashboard && !!session
      const portalRole = getPortalRole(session?.user?.role)
      const isAdmin = isInsideDashboard && (
        portalRole === 'admin' ||
        location.pathname.startsWith('/dashboard/provider') ||
        location.pathname.startsWith('/dashboard/users')
      )
      const userRole = !session ? 'guest' : (isAdmin ? 'admin' : 'customer')

      let replyText = ''

      if (isWalletQuery(qLower)) {
        if (!isAuthenticated && qLower === 'how wallet works in this web site') {
          replyText = PUBLIC_WALLET_REPLY
        } else {
          replyText = getDashboardWalletReply()
        }
      } else if (isProviderAnalysisQuery(qLower) || isAdminFeaturesQuery(qLower)) {
        if (!isAuthenticated) {
          replyText = PUBLIC_ADMIN_REPLY
        } else if (!isAdmin) {
          replyText = CUSTOMER_ADMIN_REFUSAL
        } else if (isProviderAnalysisQuery(qLower)) {
          replyText = ADMIN_PROVIDER_REPLY
        } else {
          replyText = ADMIN_FEATURES_REPLY
        }
      } else {
        // Build lightweight conversation history for context
        const historyPayload = messages.slice(-4).map((m) => ({
          role: (m.sender === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
          content: m.text,
        }))

        // Query the active fine-tuned model via RAG service
        const res = await queryFineTunedModel(text, historyPayload, {
          userRole,
          currentPath: location.pathname,
        })
        replyText = (!res.isFallback && res.text) ? res.text : getBotReply(text, location.pathname)
      }

      const botTs = Date.now()
      const botMsg: ChatMessage = {
        id: `bot-${botTs}`,
        sender: 'bot',
        text: replyText,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        timestamp: botTs,
      }
      setMessages((prev) => {
        const next = [...prev, botMsg]
        saveScopeMessages(currentScopeRef.current, next)
        return next
      })
    } catch {
      const botTs = Date.now()
      const replyText = getBotReply(text, location.pathname)
      const botMsg: ChatMessage = {
        id: `bot-${botTs}`,
        sender: 'bot',
        text: replyText,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        timestamp: botTs,
      }
      setMessages((prev) => {
        const next = [...prev, botMsg]
        saveScopeMessages(currentScopeRef.current, next)
        return next
      })
    } finally {
      setIsTyping(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSend()
    }
  }

  const handleReset = () => {
    const fresh = clearScopeMessages(currentScopeRef.current)
    setMessages(fresh)
  }

  const toggleOpen = () => {
    setIsOpen((prev) => {
      const next = !prev
      try {
        sessionStorage.setItem('inferxe_chat_open', next ? '1' : '0')
      } catch {
        /* storage unavailable */
      }
      return next
    })
  }

  const closeChat = () => {
    setIsOpen(false)
    try {
      sessionStorage.setItem('inferxe_chat_open', '0')
    } catch {
      /* storage unavailable */
    }
  }

  // Close chat window on outside click or Escape key (Existing Main Design interaction)
  useEffect(() => {
    if (!isOpen) return

    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node | null
      if (!target) return

      // Do nothing if clicking inside the chat window
      if (chatWindowRef.current && chatWindowRef.current.contains(target)) {
        return
      }

      // Do nothing if clicking on the launcher itself (launcher onClick handles toggling)
      if (launcherRef.current && launcherRef.current.contains(target)) {
        return
      }

      closeChat()
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeChat()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('touchstart', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('touchstart', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  const quickPrompts = getQuickPromptsForScope(activeScope)

  const headerTitle =
    activeScope === 'admin'
      ? 'Inferxe Admin Assistant'
      : activeScope === 'customer'
      ? 'Inferxe Customer Assistant'
      : 'Inferxe AI Assistant'

  const headerStatus =
    activeScope === 'admin'
      ? 'Admin Console • Online'
      : activeScope === 'customer'
      ? 'Customer Portal • Online'
      : 'Online • Sovereign Mesh'

  return (
    <>
      {/* Backdrop overlay: clicking on the side / outside closes the chat window */}
      {isOpen && (
        <div
          className="bot-chat-backdrop"
          onClick={closeChat}
          aria-hidden="true"
        />
      )}

      <div className="bot-chat-wrapper" aria-label="Inferxe Chatbot" data-theme={isLight ? 'light' : 'dark'}>
        {/* ── Chat Window ────────────────────────────────────────────── */}
        {isOpen && (
          <div
            ref={chatWindowRef}
            className="bot-chat-window"
            role="dialog"
            aria-modal="true"
            aria-label="Inferxe AI Chat Window"
            data-theme={isLight ? 'light' : 'dark'}
          >
            {/* Header */}
            <div className="bot-chat-header">
              <div className="bot-chat-header__profile">
                <div className="bot-chat-header__avatar">
                  <BotAvatar
                    type="ghost"
                    state={isTyping ? 'working' : 'default'}
                    face="mouth"
                    size={38}
                    color={botColor}
                    shading="fabric"
                    interactive={true}
                  />
                </div>
                <div className="bot-chat-header__info">
                  <div className="bot-chat-header__name">{headerTitle}</div>
                  <div className="bot-chat-header__status">
                    <span className="bot-dot-static" />
                    <span>{headerStatus}</span>
                  </div>
                </div>
              </div>

              <div className="bot-chat-header__actions">
                <button
                  type="button"
                  className="bot-chat-icon-btn"
                  onClick={handleReset}
                  title="Restart conversation"
                  aria-label="Restart conversation"
                >
                  <RotateCcw size={14} />
                </button>
                <button
                  type="button"
                  className="bot-chat-icon-btn"
                  onClick={closeChat}
                  title="Close chat"
                  aria-label="Close chat"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Messages Area */}
            <div className="bot-chat-messages">
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`bot-chat-msg ${m.sender === 'user' ? 'bot-chat-msg--user' : 'bot-chat-msg--bot'}`}
                >
                  {m.sender === 'bot' && (
                    <div className="bot-chat-msg__bot-avatar">
                      <BotAvatar
                        type="ghost"
                        state="default"
                        face="mouth"
                        size={26}
                        color={botColor}
                        shading="fabric"
                        interactive={false}
                      />
                    </div>
                  )}
                  <div className="bot-chat-msg__bubble">
                    <FormattedMessage text={m.text} />
                    <span className="bot-chat-msg__time">{m.time}</span>
                  </div>
                </div>
              ))}

              {/* Thinking / Typing indicator */}
              {isTyping && (
                <div className="bot-chat-msg bot-chat-msg--bot">
                  <div className="bot-chat-msg__bot-avatar">
                    <BotAvatar
                      type="ghost"
                      state="working"
                      face="mouth"
                      size={26}
                      color={botColor}
                      shading="fabric"
                      interactive={false}
                    />
                  </div>
                  <div className="bot-chat-msg__bubble bot-chat-msg__bubble--typing">
                    <span className="bot-typing-dot" />
                    <span className="bot-typing-dot" />
                    <span className="bot-typing-dot" />
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Quick Prompt Suggestions */}
            {messages.length <= 2 && (
              <div className="bot-chat-quick-prompts">
                {quickPrompts.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    className="bot-quick-chip"
                    onClick={() => handleSend(prompt)}
                  >
                    <Sparkles size={11} className="bot-quick-chip__icon" />
                    <span>{prompt}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Input Box */}
            <div className="bot-chat-footer">
              <input
                ref={inputRef}
                type="text"
                className="bot-chat-input"
                placeholder="Ask a question or enter prompt..."
                aria-label="Message the Inferxe assistant"
                value={inputVal}
                onChange={(e) => setInputVal(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isTyping}
              />
              <button
                type="button"
                className="bot-chat-send-btn"
                onClick={() => handleSend()}
                disabled={!inputVal.trim() || isTyping}
                aria-label="Send prompt"
              >
                <Send size={15} />
              </button>
            </div>
          </div>
        )}

        {/* ── Persistent Floating Bot Launcher (Only the Bot - Existing Main Design) ── */}
        <div
          ref={launcherRef}
          className="bot-chat-launcher"
          onClick={toggleOpen}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              toggleOpen()
            }
          }}
          title={isOpen ? 'Close AI Chat' : 'Chat with Inferxe AI'}
          role="button"
          tabIndex={0}
          aria-label={isOpen ? 'Close AI Chat' : 'Chat with Inferxe AI'}
        >
          <BotAvatar
            type="ghost"
            state={isTyping ? 'working' : 'default'}
            face="mouth"
            size={64}
            color={botColor}
            shading="fabric"
            interactive={true}
          />
        </div>
      </div>
    </>
  )
}
