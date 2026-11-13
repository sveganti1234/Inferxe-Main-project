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

function readWallet(): number {
  try {
    const raw = localStorage.getItem('inferxe_demo_wallet_balance_v1')
    return raw ? Number(JSON.parse(raw)) : 10000
  } catch {
    return 10000
  }
}

function readBurnPerHour(): number {
  try {
    const raw = localStorage.getItem('inferxe_demo_deployments_v1')
    if (!raw) return 160
    const deps = JSON.parse(raw) as { status: string; hourlyRate?: number }[]
    return deps.filter((d) => d.status === 'Running').reduce((s, d) => s + (d.hourlyRate ?? 0), 0)
  } catch {
    return 160
  }
}

function walletSummary(): string {
  const balance = readWallet()
  const burn = readBurnPerHour()
  const hrs = burn > 0 ? balance / burn : null
  return `Your wallet balance is ₹${balance.toLocaleString('en-IN')}. ${
    hrs === null
      ? 'No GPUs are running, so nothing is being billed.'
      : `Running GPUs cost ₹${burn}/hr, so you have about ${hrs.toFixed(1)} hours of runtime left.`
  }${balance < 2000 ? ' ⚠️ Balance is low — top up from Dashboard → Wallet.' : ''}`
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
    "Navigate to Wallet: Once logged in, navigate to the Dashboard and open the [Wallet](/dashboard/wallet) section (Dashboard -> Wallet).\n\n" +
    "Choose Top-Up Amount: In the Wallet section, choose your top-up amount in Indian Rupees (INR) or USD (e.g., ₹2,000, ₹5,000, ₹10,000, or custom amount).\n\n" +
    "Pay Using UPI, Credit/Debit Cards, or NetBanking: Choose a payment method: UPI (Google Pay, PhonePe, Paytm), Indian Debit/Credit Cards (Visa, MasterCard, RuPay), NetBanking, or Enterprise Invoicing.\n\n" +
    "Complete Payment: Your prepaid balance is credited to your account instantly.\n\n" +
    `Current Balance Status: ${walletSummary()}`
  )
}

const PUBLIC_ADMIN_REPLY =
  "Login or Sign Up: First, you need to log in or sign up with an Administrator account using your credentials at [Sign In](/login)."

const CUSTOMER_ADMIN_REFUSAL =
  "Admin features, provider analysis, and administrative details are restricted to Administrator accounts. Customers do not have permission to access administration features or provider analysis data."

const ADMIN_PROVIDER_REPLY =
  "Navigate to Provider Management: Open the [Provider Management](/dashboard/provider) section (Dashboard -> Provider Management).\n\n" +
  "Provider Analysis & Node Telemetry:\n" +
  "• Active Providers: JarvisLabs, E2E Networks, Yotta Shakti Cloud, and sovereign Tier-IV nodes.\n" +
  "• Provider Health & Telemetry: Real-time telemetry monitoring for GPU node uptime, thermals, power draw, and VRAM utilization across Indian data centers.\n" +
  "• Provider Routing & Allocation: Automated dynamic routing allocating workloads between spot instances (up to 65% discount) and dedicated reserved nodes.\n" +
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

function getBotReply(query: string, currentPath: string = '/'): string {
  const q = query.toLowerCase().trim()

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
    return "Hi there! I am your Inferxe AI Assistant. Ask me anything about:\n• **Project & Architecture**: Overview of Inferxe, the multi-provider orchestration, and what was built.\n• **GPU Specs & Pricing**: Live hourly rates and sizing for NVIDIA H100, L40S, and L4.\n• **Wallet & Top-Up**: How to add funds, top up your compute credits, and manage 3D virtual cards.\n• **Customer Dashboard**: Real-time telemetry, ₹60/hr burn rate, and the 3-column Kanban deployment board.\n• **Model Inference & API**: Deploying Llama 3, Qwen 2.5, or Mistral with OpenAI SDK compatibility.\n• **Authentication**: Customer and Admin login with AWS Cognito.\n\nWhat would you like to know?"
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
  if (q.includes('login') || q.includes('sign in') || q.includes('signup') || q.includes('register') || q.includes('create account')) {
    const session = getSession()
    if (session) {
      return `You are currently logged in as **${session.user.fullName}** (${session.user.email}) with role **${session.user.role}**. You have full access to your Dashboard, GPU Marketplace, and Wallet.`
    }
    return "To access the GPU Marketplace, launch instances, or manage your wallet, please visit the **[Sign In](/login)** page to log in or create your free account."
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
    return "**Inferxe** is an intelligent, decentralized GPU inference marketplace and compute orchestration platform built on the **'One API, Many GPU Providers'** architecture.\n\n**Core Highlights:**\n1. **Unified Marketplace**: Aggregates enterprise GPUs (NVIDIA H100, L40S, L4) across Indian sovereign Tier-IV data centers (Navi Mumbai & Noida) and cloud providers like JarvisLabs.\n2. **Customer Workspace**: Real-time compute telemetry (live balance, ₹60/hr burn rate, remaining runtime) and an interactive 3-column Kanban workflow board.\n3. **3D Virtual Cards & Top-Up**: Interactive digital cards with live flip, security freeze/unfreeze, and an idempotent `+ Top Up` modal with instant balance synchronization.\n4. **Cognito Enterprise Auth**: Strict RBAC for Customer and Admin portals with encrypted JWT token verification.\n5. **Drop-in OpenAI SDK**: Compatible with any OpenAI client pointing to `https://api.inferxe.com/v1`."
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
    return "### Customer Dashboard & Workspace Guide (`/dashboard/customer`):\n\n" +
      "• **Compute Balance & Credits Hero Card**:\n" +
      "  - Displays your available balance in INR (e.g. ₹5,000).\n" +
      "  - Calculates live **hourly burn rate** (e.g. `₹60/hr` for active L4 instances).\n" +
      "  - Estimates **remaining runtime** (e.g. `≈ 83.3 hrs left`).\n" +
      "  - Shows active GPU count and Sovereign Tier status.\n" +
      "  - Features quick-action buttons: `+ Add Funds`, `Playground`, `API Keys`, and `Compare`.\n\n" +
      "• **3-Column Kanban Workflow Board**:\n" +
      "  1. **To Do**: Pending inference tasks, prompt engineering jobs, and scheduled runs.\n" +
      "  2. **Done – Waiting for you**: Finished jobs awaiting authorization or payout.\n" +
      "  3. **Paid / Active**: Live GPU deployments and fulfilled compute allocations.\n\n" +
      "• **30-Day Activity Sparklines**: Tracks daily token throughput and cluster consumption."
  }

  // 3g. Deploying Models & Running Inference
  if (
    q.includes('deploy') ||
    q.includes('run model') ||
    q.includes('how to use') ||
    q.includes('how to start') ||
    q.includes('how does it work') ||
    q.includes('how it works') ||
    q.includes('which models') ||
    q.includes('supported models') ||
    q.includes('what models')
  ) {
    return "### How to Deploy Models and Run Inference on Inferxe:\n\n" +
      "1. **Sign In**: Log in to your account at [Sign In](/login).\n" +
      "2. **Check Balance**: Make sure you have compute credits in [Wallet & Cards](/dashboard/wallet). Top up anytime via `+ Top Up`.\n" +
      "3. **Choose Hardware**: Select an optimal GPU (NVIDIA L4 for ≤8B at ₹60/hr, L40S for 14B–34B at ₹100/hr, or H100 for 70B+ at ₹280/hr).\n" +
      "4. **Supported Models**: Meta Llama 3.3 70B, Qwen 2.5 14B/72B, Mistral 7B, and DeepSeek distilled models with FP8 FlashAttention.\n" +
      "5. **Invoke API**: Use the standard OpenAI SDK:\n" +
      "```python\n" +
      "from openai import OpenAI\n" +
      "client = OpenAI(\n" +
      "    base_url='https://api.inferxe.com/v1',\n" +
      "    api_key='your_inferxe_api_key'\n" +
      ")\n" +
      "response = client.chat.completions.create(\n" +
      "    model='llama-3.3-70b',\n" +
      "    messages=[{'role': 'user', 'content': 'Hello Inferxe!'}]\n" +
      ")\n" +
      "```"
  }

  // 4. Specific Factual Queries
  if (q.includes('specifications of nvidia l4') || q.includes('specs of nvidia l4') || q.includes('nvidia l4 specs')) {
    return 'The NVIDIA L4 is built on NVIDIA\'s Ada Lovelace architecture. It features 24 GB of GDDR6 memory with 300 GB/s bandwidth. Compute throughput delivers 485 FP8 TFLOPS and 242 FP16/BF16 Tensor TFLOPS at a low 72W TDP in a single-slot PCIe form factor.'
  }

  if (q.includes('compare nvidia l4 and l40s') || (q.includes('l4') && q.includes('l40s') && q.includes('compare'))) {
    return 'Both NVIDIA L4 and L40S are based on Ada Lovelace architecture:\n• Memory: L4 has 24 GB GDDR6 (300 GB/s); L40S has 48 GB GDDR6 with ECC (864 GB/s).\n• Compute: L4 delivers 485 FP8 / 242 FP16 TFLOPS; L40S delivers 1,466 FP8 / 733 FP16 TFLOPS (3x compute).\n• Power: L4 requires 72W; L40S requires 350W.\n• Pricing: On JarvisLabs, L4 is ₹41/hr ($0.44/hr) on-demand vs ₹18/hr ($0.19/hr) spot. L40S is ₹118/hr ($1.25/hr) on-demand vs ₹61/hr ($0.65/hr) spot. Inferxe marketplace retail rates are ₹60/hr for L4 and ₹100/hr for L40S.'
  }

  if (q.includes('hourly price of an h100') || q.includes('price of an h100') || q.includes('h100 price') || q.includes('h100 rate')) {
    return 'Documented hourly rates for NVIDIA H100 SXM (80 GB):\n• JarvisLabs.ai (MVP Provider): $3.49/hr (₹330/hr) on-demand, and $1.55/hr (₹146/hr) spot instances.\n• E2E Networks: ₹340/hr on-demand.\n• Yotta NM1 Shakti Cloud: ₹350/hr on-demand.\n• Inferxe Proposed Marketplace Rate: ₹250–₹280/hr with automated spot optimization.'
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
    return 'Documented features of the Inferxe platform:\n1. GPU Marketplace Catalog: Discover and filter GPUs across sovereign Indian clouds and JarvisLabs.\n2. GPU Sizing Calculator: Calculates weights and KV cache memory to recommend the most cost-effective GPU.\n3. Simulated Wallet & Burn Rate: Tracks runtime spend, hourly burn rates, and low-balance warnings.\n4. Sovereign Indian Data Residency: Tier-IV datacenters in Navi Mumbai and Noida compliant with DPDP Act and MeitY.\n5. OpenAI-Compatible API: Drop-in SDK endpoint pointing base_url to https://api.inferxe.com/v1.\n6. Intermediary Orchestration: Intermediary software routing layer (Inferxe does not own physical data centers).'
  }

  if (q.includes('14b') || q.includes('l40s') || q.includes('l4')) {
    return 'For a 14B model at FP16 with 16k context, weights require ~28 GB plus ~4-6 GB for KV cache. An NVIDIA L40S (48 GB) fits with headroom at ₹100/hr, while a 24 GB L4 would require 4-bit AWQ quantization.'
  }

  if (q.includes('70b') || q.includes('llama 3') || q.includes('llama')) {
    return 'Llama 3.3 70B at FP8 requires ~72 GB memory. Dual L40S (96 GB) delivers ~38 tok/s at ₹200/hr. For lowest TTFT (<25ms), our NVIDIA H100 SXM5 (80 GB) cluster reaches up to 65 tok/s.'
  }

  if (q.includes('rate') || q.includes('price') || q.includes('cost') || q.includes('₹') || q.includes('$') || q.includes('hourly')) {
    return 'Inferxe sovereign GPU rates:\n• NVIDIA L4 (24 GB): ₹60/hr\n• NVIDIA L40S (48 GB): ₹100/hr\n• NVIDIA H100 SXM5 (80 GB): ₹280/hr\nSpot routing provides up to 65% automatic discount with zero lock-in contracts.'
  }

  if (q.includes('india') || q.includes('sovereign') || q.includes('mumbai') || q.includes('security') || q.includes('meity') || q.includes('dpdp')) {
    return 'All Inferxe clusters operate strictly inside India-based Tier-IV datacenters (ap-south-1 Mumbai and Noida, UP). We comply with the DPDP Act and MeitY empanelment, guaranteeing zero cross-border telemetry or data egress.'
  }

  if (q.includes('api') || q.includes('openai') || q.includes('sdk') || q.includes('endpoint') || q.includes('python')) {
    return 'Inferxe is 100% drop-in compatible with the OpenAI API! Simply point your OpenAI SDK client to baseURL: "https://api.inferxe.com/v1" and supply your Inferxe API key.'
  }

  if (q.includes('user') || q.includes('dashboard') || q.includes('admin') || q.includes('seat') || q.includes('rbac')) {
    return 'You can invite developers and configure RBAC under Dashboard → Users (/dashboard/users). Set monthly INR spend limits, rate limits, and custom model permissions.'
  }

  return 'Thanks for asking! Inferxe routes LLM inference across low-latency sovereign NVIDIA L4, L40S, and H100 clusters with FP8 FlashAttention. What model or token throughput target are you looking for?'
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
    if (!line) {
      flushList()
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

    window.addEventListener('inferxe-auth-change', handleAuthChange)
    window.addEventListener('storage', handleAuthChange)
    return () => {
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

  const botColor = isLight ? '#9be015' : '#76b900'

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  // Proactive wallet / GPU notification from the bot (once per browser session)
  useEffect(() => {
    const check = () => {
      try {
        if (sessionStorage.getItem('inferxe_bot_wallet_alert') === '1') return
        const balance = readWallet()
        const burn = readBurnPerHour()
        if (balance < 2000 || (burn > 0 && balance / burn < 6)) {
          sessionStorage.setItem('inferxe_bot_wallet_alert', '1')
          const nowTs = Date.now()
          setMessages((prev) => [
            ...prev,
            {
              id: `bot-alert-${nowTs}`,
              sender: 'bot',
              text: `⚠️ Heads up: ${walletSummary()}`,
              time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              timestamp: nowTs,
            },
          ])
        }
      } catch {
        /* storage unavailable */
      }
    }
    check()
    const t = setInterval(check, 60000)
    return () => clearInterval(t)
  }, [])

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
