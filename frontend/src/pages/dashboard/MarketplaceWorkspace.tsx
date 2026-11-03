import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useLocation, Link, useNavigate } from 'react-router-dom'
import {
  Activity, ArrowDownToLine, Bell, Check, ChevronDown, ChevronRight,
  CircleDollarSign, Copy, Cpu, Download, Eye, EyeOff, FileText,
  Heart, KeyRound, Layers, LayoutGrid, List, Lock, MapPin, Play, Plus,
  Search, Server, Settings2, Share2, ShieldCheck, Sparkles, Terminal,
  Trash2, TrendingUp, User, Wallet, Wrench, X, Zap,
} from 'lucide-react'
import { DashboardLayout } from '../../components/dashboard/DashboardLayout'
import { AdminGuard } from '../../components/auth/AdminGuard'
import { usePageMeta } from '../../lib/hooks'
import { MODELS, QUANTS, type Quant } from '../../data/gpus'
import { estimateMemory, recommend, fmtGB, inr } from '../../lib/calc'
import { getSession, saveSession, changeUserPassword, getUserPasswordLastUpdated } from '../../lib/authStore'
import { NotebooksSection, ReviewsSection, RewardsSection, UsageDetail } from './ExtraSections'
import { SovereignNodesMap } from '../../components/dashboard/SovereignNodesMap'
import { InteractivePriceHistoryChart, type PriceHistoryRange, type GpuModel } from '../../components/dashboard/InteractivePriceHistoryChart'

type Listing = {
  id: string
  name: string
  gpu: string
  vram: string
  region: string
  quantity: number
  price: number
  status: 'Available' | 'Paused' | 'Maintenance'
  arch?: string
  bandwidth?: string
  tflops?: string
}

type Deployment = {
  id: string
  name: string
  model: string
  gpu: string
  region: string
  status: 'Running' | 'Stopped' | 'Provisioning'
  hourlyRate?: number
}

type ApiKey = {
  id: string
  name: string
  key: string
  created: string
  revoked: boolean
}

type SshKey = {
  id: string
  name: string
  key: string
  fingerprint: string
  addedDate: string
}

type OrderItem = {
  id: string
  modelOrGpu: string
  provider: string
  date: string
  duration: string
  cost: number
  status: 'Running' | 'Completed' | 'Cancelled' | 'Archived'
  details: string
}

type TransactionItem = {
  id: string
  desc: string
  date: string
  amount: number
  isCredit: boolean
  status: 'Completed' | 'Pending'
}

type NotificationItem = {
  id: string
  title: string
  detail: string
  type: string
  time: string
  read: boolean
}

const STORE = {
  listings: 'inferxe_demo_provider_listings_v1',
  deployments: 'inferxe_demo_deployments_v1',
  keys: 'inferxe_demo_api_keys_v1',
  sshKeys: 'inferxe_demo_ssh_keys_v1',
  orders: 'inferxe_demo_orders_v1',
  wishlist: 'inferxe_demo_wishlist_v1',
  notifications: 'inferxe_demo_notifications_v3',
  wallet: 'inferxe_demo_wallet_balance_v1',
  transactions: 'inferxe_demo_transactions_v2',
  announcementDismissed: 'inferxe_dismissed_gpu_announcement_v1',
}

const initialListings: Listing[] = [
  { id: 'gpu-101', name: 'NVIDIA L40S', gpu: 'L40S', vram: '48 GB', region: 'Mumbai, IN', quantity: 8, price: 100, status: 'Available', arch: 'Ada Lovelace', bandwidth: '864 GB/s', tflops: '91.6 TFLOPS' },
  { id: 'gpu-102', name: 'NVIDIA L4', gpu: 'L4', vram: '24 GB', region: 'Hyderabad, IN', quantity: 16, price: 60, status: 'Available', arch: 'Ada Lovelace', bandwidth: '300 GB/s', tflops: '30.3 TFLOPS' },
  { id: 'gpu-103', name: 'NVIDIA A100', gpu: 'A100 80GB', vram: '80 GB', region: 'Chennai, IN', quantity: 4, price: 210, status: 'Paused', arch: 'Ampere', bandwidth: '2039 GB/s', tflops: '77.9 TFLOPS' },
  { id: 'gpu-104', name: 'NVIDIA H100 SXM5', gpu: 'H100', vram: '80 GB', region: 'Mumbai, IN', quantity: 8, price: 275, status: 'Available', arch: 'Hopper', bandwidth: '3350 GB/s', tflops: '134.0 TFLOPS' },
  { id: 'gpu-105', name: 'NVIDIA H200', gpu: 'H200', vram: '141 GB', region: 'Delhi, IN', quantity: 2, price: 340, status: 'Maintenance', arch: 'Hopper', bandwidth: '4800 GB/s', tflops: '140.0 TFLOPS' },
]

const initialDeployments: Deployment[] = [
  { id: 'dep-1042', name: 'qwen-chat-staging', model: 'Qwen2.5 7B Instruct', gpu: 'L4', region: 'Hyderabad, IN', status: 'Running', hourlyRate: 60 },
  { id: 'dep-1038', name: 'llama-support-api', model: 'Llama 3.1 8B Instruct', gpu: 'L40S', region: 'Mumbai, IN', status: 'Running', hourlyRate: 100 },
  { id: 'dep-1027', name: 'mistral-evaluation', model: 'Mistral 7B Instruct v0.3', gpu: 'L40S', region: 'Mumbai, IN', status: 'Provisioning', hourlyRate: 100 },
]

const initialSshKeys: SshKey[] = [
  { id: 'ssh-1', name: 'Workstation ed25519', key: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOm5KqB1+7Lq/9+Xk9P+aJ dev@novatech.ai', fingerprint: 'SHA256:7mP4e2x9...yK9', addedDate: '02 Oct 2026' },
  { id: 'ssh-2', name: 'CI/CD Deployer key', key: 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQC8vF0w1e9K8p... ci@novatech.ai', fingerprint: 'SHA256:3aF8x11q...9wQ', addedDate: '08 Oct 2026' },
]

const initialOrders: OrderItem[] = [
  { id: 'ORD-8492', modelOrGpu: 'Qwen 2.5 7B · 1x NVIDIA L4', provider: 'Yotta NM1 (Mumbai)', date: '10 Oct 2026', duration: '24 hours', cost: 1440, status: 'Running', details: 'Dedicated endpoint deployment with FP16 weights' },
  { id: 'ORD-8431', modelOrGpu: 'Llama 3.1 8B · 1x NVIDIA L40S', provider: 'E2E Cloud (Noida)', date: '08 Oct 2026', duration: '12 hours', cost: 1200, status: 'Completed', details: 'Customer support batch fine-tuning pipeline' },
  { id: 'ORD-8390', modelOrGpu: 'DeepSeek R1 671B · 8x NVIDIA H100', provider: 'CtrlS Datacenters (Hyderabad)', date: '04 Oct 2026', duration: '4 hours', cost: 8800, status: 'Completed', details: 'Frontier MoE reasoning benchmark evaluation' },
  { id: 'ORD-8312', modelOrGpu: 'Mistral 7B · 1x NVIDIA L4', provider: 'Yotta NM1 (Mumbai)', date: '01 Oct 2026', duration: '8 hours', cost: 480, status: 'Cancelled', details: 'Workload canceled by user before warm-up' },
  { id: 'ORD-8201', modelOrGpu: 'CodeQwen 7B · 1x NVIDIA L40S', provider: 'Sify Infinit (Chennai)', date: '25 Sep 2026', duration: '72 hours', cost: 7200, status: 'Archived', details: 'Archived monthly sandbox workload' },
]

const initialTransactions: TransactionItem[] = [
  { id: 'TX-1048', desc: 'Wallet top-up (Demo)', date: '10 Oct 2026', amount: 5000, isCredit: true, status: 'Completed' },
  { id: 'TX-1032', desc: 'Inference deployment billing', date: '08 Oct 2026', amount: 1240, isCredit: false, status: 'Completed' },
  { id: 'TX-1011', desc: 'Inference runtime usage', date: '01 Oct 2026', amount: 3580, isCredit: false, status: 'Completed' },
]

const initialNotifications: NotificationItem[] = [
  { id: 'n1', title: 'Deployment qwen-chat-staging is healthy', detail: 'Serving tokens at 118 tok/s with 0.42s P95 TTFT.', type: 'Deployment', time: '12 mins ago', read: false },
  { id: 'n2', title: 'Monthly spending alert threshold reached', detail: 'Estimated spend has reached 48% of your monthly cap.', type: 'Billing', time: '2 hours ago', read: false },
  { id: 'n3', title: 'Yotta NM1 sovereign cluster capacity added', detail: 'New NVIDIA H100 nodes provisioned in Mumbai region.', type: 'Marketplace', time: 'Yesterday', read: true },
]

const FAQS = [
  {
    id: 'faq-1',
    category: 'hardware',
    q: 'How does Inferxe ensure sovereign GPU compute for Indian enterprises?',
    a: 'All sovereign GPU instances are hosted in Tier-IV MeitY-empanelled datacenters located physically in Mumbai (Yotta NM1), Hyderabad (CtrlS), and Noida (E2E Cloud). Weights, activations, and tenant logs remain within Indian borders with zero cross-border telemetry.',
  },
  {
    id: 'faq-2',
    category: 'hardware',
    q: 'Which GPU models are available for deployment?',
    a: 'We offer NVIDIA L4 (24GB Ada), L40S (48GB Ada), A100 (80GB SXM4), H100 (80GB SXM5), and H200 (141GB HBM3e). All instances are interconnected via NVLink and RoCE v2 low-latency fabrics.',
  },
  {
    id: 'faq-3',
    category: 'billing',
    q: 'How does demo wallet billing and trial time work?',
    a: 'The 1-Hour Free Sandbox Trial tracks real elapsed wall-clock time in your browser local storage. When you top up your demo wallet, transactions are recorded in the simulated ledger and deduction occurs against active endpoint hours.',
  },
  {
    id: 'faq-4',
    category: 'billing',
    q: 'Are there discount coupons available?',
    a: 'Yes, during checkout you can apply promo code "INFERXE10" for 10% off your total reservation, or "LAUNCH50" for a flat ₹500 discount on your first deployment.',
  },
  {
    id: 'faq-5',
    category: 'deploy',
    q: 'Can I deploy custom weights from Hugging Face or private registries?',
    a: 'Yes, in production Inferxe supports pulling quantized AWQ/GPTQ and GGUF safetensors directly from Hugging Face or private S3/MinIO buckets with vLLM and TensorRT-LLM runtimes.',
  },
  {
    id: 'faq-6',
    category: 'api',
    q: 'Is the API compatible with the standard OpenAI Python SDK?',
    a: 'Inferxe exposes drop-in OpenAI-compatible endpoints (/v1/chat/completions, /v1/completions, /v1/embeddings). You can set base_url="https://api.inferxe.com/v1" and use your standard api_key.',
  },
]

const SOVEREIGN_NODES = [
  { id: 'node-mum', city: 'Mumbai', dc: 'Yotta NM1', nodes: 64, gpus: 'H100 SXM5 / L40S', latency: '4 ms', status: 'Optimal', compliance: 'MeitY Empanelled', users: 1420 },
  { id: 'node-hyd', city: 'Hyderabad', dc: 'CtrlS HiTech', nodes: 48, gpus: 'NVIDIA L4 / A100', latency: '8 ms', status: 'Optimal', compliance: 'MeitY Empanelled', users: 890 },
  { id: 'node-noi', city: 'Noida (Delhi NCR)', dc: 'E2E Cloud D1', nodes: 32, gpus: 'NVIDIA L40S', latency: '12 ms', status: 'Optimal', compliance: 'Sovereign Certified', users: 670 },
  { id: 'node-che', city: 'Chennai', dc: 'Sify Infinit', nodes: 24, gpus: 'NVIDIA A100 80GB', latency: '14 ms', status: 'Optimal', compliance: 'Tier-IV Certified', users: 510 },
  { id: 'node-blr', city: 'Bengaluru', dc: 'Netmagic BLR2', nodes: 40, gpus: 'NVIDIA L4 / H100', latency: '6 ms', status: 'Optimal', compliance: 'MeitY Empanelled', users: 1120 },
  { id: 'node-fra', city: 'Frankfurt (EU Gateway)', dc: 'Equinix FR5', nodes: 16, gpus: 'NVIDIA A100', latency: '98 ms', status: 'Available', compliance: 'GDPR Compliant', users: 310 },
  { id: 'node-sjc', city: 'San Jose (US West)', dc: 'CoreSite SV1', nodes: 16, gpus: 'NVIDIA H100', latency: '184 ms', status: 'Available', compliance: 'SOC2 Type II', users: 240 },
]

function readStore<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function saveStore<T>(key: string, value: T) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* demo browser storage */
  }
}

function money(value: number | null | undefined) {
  if (value == null) return '—'
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value)
}

function StatusBadge({ children }: { children: string }) {
  const norm = children.toLowerCase().replace(/\s+/g, '-')
  return <span className={`mw-status mw-status--${norm}`}>{children}</span>
}

const pageInfo: Record<string, { title: string; description: string; group: 'customer' | 'admin' }> = {
  customer: { title: 'Dashboard', description: 'Customer workspace overview, active deployments, and quick actions.', group: 'customer' },
  models: { title: 'Models & Specifications', description: 'Explore supported LLM architectures, context windows and GPU compatibility.', group: 'customer' },
  deployments: { title: 'Deployments', description: 'Manage your model endpoints and deployment lifecycle.', group: 'customer' },
  gpus: { title: 'GPU Marketplace', description: 'Browse sample GPU capacity, filter by region and compare configurations.', group: 'customer' },
  compare: { title: 'GPU Comparison Matrix', description: 'Side-by-side hardware comparison across VRAM, throughput, and pricing.', group: 'customer' },
  'price-history': { title: 'GPU Spot Price History', description: 'Historical price trends across sovereign Indian datacenter regions.', group: 'customer' },
  playground: { title: 'Inference Playground', description: 'Interactive prompt sandbox with simulated live streaming and metrics.', group: 'customer' },
  'api-keys': { title: 'API Keys & JWT Tokens', description: 'Create and manage demo API keys and inspect simulated JWT bearer tokens.', group: 'customer' },
  'ssh-keys': { title: 'SSH Public Keys', description: 'Configure demo SSH credentials for compute cluster access.', group: 'customer' },
  analytics: { title: 'Usage & Analytics', description: 'Review illustrative request, token, latency and spend metrics.', group: 'customer' },
  orders: { title: 'Orders & Cost History', description: 'Track active, completed, and archived compute orders.', group: 'customer' },
  checkout: { title: 'Payment & Checkout', description: 'Simulated payment processing with demo coupon discounts.', group: 'customer' },
  billing: { title: 'Wallet & Billing', description: 'Review sample wallet activity, usage estimates and invoices.', group: 'customer' },
  wallet: { title: 'Wallet & Billing', description: 'Review sample wallet activity, usage estimates and invoices.', group: 'customer' },
  wishlist: { title: 'Saved Hardware Wishlist', description: 'Review your bookmarked GPU listings for quick deployment.', group: 'customer' },
  notifications: { title: 'Notifications & Alerts', description: 'Review marketplace alerts and mark them as read.', group: 'customer' },
  profile: { title: 'User Profile & Organization', description: 'Manage your personal account details, avatar, and role.', group: 'customer' },
  settings: { title: 'Settings & Quotas', description: 'Configure demo preferences, quotas and workspace details.', group: 'customer' },
  notebooks: { title: 'Notebooks & SSH Access', description: 'Open JupyterLab or SSH into your running GPUs, with optional bot access.', group: 'customer' },
  reviews: { title: 'Reviews & Notes', description: 'Rate completed orders and keep private notes about GPUs and providers.', group: 'customer' },
  rewards: { title: 'Rewards & Discounts', description: 'Referral discounts, coupon codes and creator trial codes.', group: 'customer' },
  faq: { title: 'FAQ & Support Hub', description: 'Frequently asked questions, architecture guidelines, and support.', group: 'customer' },
  provider: { title: 'Provider Overview', description: 'Manage sample GPU listings, capacity and provider activity.', group: 'admin' },
  'provider/onboarding': { title: 'Provider Onboarding', description: 'Create a local demo provider profile and review integration requirements.', group: 'admin' },
  'provider/listings': { title: 'GPU Listings', description: 'Add, edit, pause or remove GPU listings in demo mode.', group: 'admin' },
  'provider/capacity': { title: 'Capacity & Health', description: 'Review sample capacity, availability and maintenance status.', group: 'admin' },
  'provider/workloads': { title: 'Workloads', description: 'Review example workloads allocated to your listed GPUs.', group: 'admin' },
  'provider/analytics': { title: 'Provider Analytics', description: 'Inspect illustrative utilization, uptime and workload performance.', group: 'admin' },
  'provider/earnings': { title: 'Earnings & Payouts', description: 'Review estimated provider earnings and sample payout history.', group: 'admin' },
  'provider/integrations': { title: 'Integrations & Maintenance', description: 'Track demo integration status and mark listings for maintenance.', group: 'admin' },
  'provider/profile': { title: 'Provider Profile', description: 'Datacenter facilities, tier specifications, and payout details.', group: 'admin' },
  'users/map': { title: 'Sovereign Nodes Map', description: 'Geographic distribution of users and cluster nodes.', group: 'admin' },
}

export default function MarketplaceWorkspace() {
  const location = useLocation()
  const navigate = useNavigate()
  const rawRoute = location.pathname.replace('/dashboard/', '').replace(/^\/+|\/+$/g, '') || 'customer'
  const route = rawRoute === 'overview' ? 'customer' : rawRoute
  const isRecognized = !!pageInfo[route]
  const info = pageInfo[route] || { title: 'Page Not Found', description: 'The requested dashboard page does not exist.', group: 'customer' }
  const isProvider = route.startsWith('provider')

  useEffect(() => {
    if (route === 'providers') {
      navigate('/dashboard/customer', { replace: true })
    }
  }, [route, navigate])

  // Global Workspace State
  const [listings, setListings] = useState<Listing[]>(() => readStore(STORE.listings, initialListings))
  const [deployments, setDeployments] = useState<Deployment[]>(() => readStore(STORE.deployments, initialDeployments))
  const [keys, setKeys] = useState<ApiKey[]>(() => readStore(STORE.keys, [
    { id: 'key-1', name: 'Production Backend API', key: 'inf_demo_live_pk_93a74b12c8e0', created: '01 Oct 2026', revoked: false },
    { id: 'key-2', name: 'Staging Evaluation Key', key: 'inf_demo_test_sk_44f12d88e7a1', created: '06 Oct 2026', revoked: false },
  ]))
  const [sshKeys, setSshKeys] = useState<SshKey[]>(() => readStore(STORE.sshKeys, initialSshKeys))
  const [orders, setOrders] = useState<OrderItem[]>(() => readStore(STORE.orders, initialOrders))
  const [wishlist, setWishlist] = useState<string[]>(() => readStore(STORE.wishlist, ['gpu-101', 'gpu-104']))
  const [walletBalance, setWalletBalance] = useState<number>(() => readStore(STORE.wallet, 10000))
  const [transactions, setTransactions] = useState<TransactionItem[]>(() => readStore(STORE.transactions, initialTransactions))
  const [notifications, setNotifications] = useState<NotificationItem[]>(() => readStore(STORE.notifications, initialNotifications))
  const [announcementDismissed, setAnnouncementDismissed] = useState<boolean>(() => localStorage.getItem(STORE.announcementDismissed) === 'true')

  // Real Elapsed Time 1-Hour Trial State
  const [trialTimeLeft, setTrialTimeLeft] = useState<number | null>(() => {
    const active = localStorage.getItem('inferxe_demo_trial_active') === 'true'
    const start = Number(localStorage.getItem('inferxe_demo_trial_start') || '0')
    if (!active || !start) return null
    return Math.max(0, 3600000 - (Date.now() - start))
  })

  useEffect(() => {
    const checkTimer = () => {
      const active = localStorage.getItem('inferxe_demo_trial_active') === 'true'
      const start = Number(localStorage.getItem('inferxe_demo_trial_start') || '0')
      if (active && start) {
        setTrialTimeLeft(Math.max(0, 3600000 - (Date.now() - start)))
      } else {
        setTrialTimeLeft(null)
      }
    }
    const interval = setInterval(checkTimer, 1000)
    return () => clearInterval(interval)
  }, [])

  const startTrial = () => {
    localStorage.setItem('inferxe_demo_trial_active', 'true')
    localStorage.setItem('inferxe_demo_trial_start', Date.now().toString())
    setTrialTimeLeft(3600000)
    flash('1-Hour Free Sandbox Trial started! 3600s compute credits activated.')
  }

  // UI notice state
  const [notice, setNotice] = useState('')
  const [search, setSearch] = useState('')
  const [gpuArchFilter, setGpuArchFilter] = useState<'all' | 'ada' | 'hopper' | 'available' | 'paused'>('all')
  const [gpuSort, setGpuSort] = useState<'rate-asc' | 'rate-desc' | 'vram-desc' | 'qty-desc'>('rate-asc')
  const [comparedGpuIds, setComparedGpuIds] = useState<string[]>([])
  const [showCompareModal, setShowCompareModal] = useState(false)

  // Deployments UI State
  const [showDeployModal, setShowDeployModal] = useState(false)
  const [deployForm, setDeployForm] = useState({ name: '', model: 'Qwen2.5 7B Instruct', gpu: 'L4', region: 'Hyderabad, IN' })
  const [deployToDelete, setDeployToDelete] = useState<Deployment | null>(null)

  // API Keys UI State
  const [showNewKeyModal, setShowNewKeyModal] = useState(false)
  const [newKeyName, setNewKeyName] = useState('')
  const [showKeySecretId, setShowKeySecretId] = useState<string | null>(null)
  const [keyToRevoke, setKeyToRevoke] = useState<ApiKey | null>(null)
  const [showJwtModal, setShowJwtModal] = useState(false)

  // SSH Keys UI State
  const [showAddSshModal, setShowAddSshModal] = useState(false)
  const [newSshName, setNewSshName] = useState('')
  const [newSshKey, setNewSshKey] = useState('')
  const [sshError, setSshError] = useState('')
  const [sshKeyToDelete, setSshKeyToDelete] = useState<SshKey | null>(null)

  // Orders UI State
  const [orderTab, setOrderTab] = useState<'All' | 'Running' | 'Completed' | 'Cancelled' | 'Archived'>('All')
  const [selectedOrder, setSelectedOrder] = useState<OrderItem | null>(null)

  // Checkout UI State
  const [checkoutGpuId, setCheckoutGpuId] = useState('gpu-101')
  const [checkoutDuration, setCheckoutDuration] = useState(24)
  const [checkoutCoupon, setCheckoutCoupon] = useState('')
  const [appliedCoupon, setAppliedCoupon] = useState<{ code: string; percent?: number; flat?: number } | null>(null)
  const [couponError, setCouponError] = useState('')
  const [checkoutPaymentMethod, setCheckoutPaymentMethod] = useState<'wallet' | 'card' | 'wire'>('wallet')
  const [checkoutState, setCheckoutState] = useState<'idle' | 'processing' | 'success'>('idle')
  const [checkoutReceipt, setCheckoutReceipt] = useState<any>(null)

  // Price History State
  const [priceHistoryGpu, setPriceHistoryGpu] = useState<GpuModel>('L40S')
  const [priceHistoryRange, setPriceHistoryRange] = useState<PriceHistoryRange>('7d')
  const [hoveredAnalyticsIdx, setHoveredAnalyticsIdx] = useState<number | null>(null)

  // Wishlist Actions
  const toggleWishlist = (id: string) => {
    setWishlist((prev) => {
      const next = prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
      saveStore(STORE.wishlist, next)
      flash(prev.includes(id) ? 'Removed from hardware wishlist.' : 'Saved to hardware wishlist!')
      return next
    })
  }

  // Share Listing Action
  const handleShareListing = async (listing: Listing) => {
    const url = `${window.location.origin}/dashboard/gpus#${listing.id}`
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Inferxe · ${listing.name}`,
          text: `Reserve ${listing.name} (${listing.vram}) on Inferxe GPU marketplace for ${money(listing.price)}/hr.`,
          url,
        })
        flash(`Shared ${listing.name} listing!`)
        return
      } catch {
        /* fallback to copy */
      }
    }
    await navigator.clipboard.writeText(url)
    flash(`Listing link for ${listing.name} copied to clipboard!`)
  }

  // Playground State
  const [playgroundModel, setPlaygroundModel] = useState('Qwen2.5 7B Instruct')
  const [playgroundPrompt, setPlaygroundPrompt] = useState('Explain tensor parallelism and how PagedAttention accelerates KV-cache decoding.')
  const [playgroundTemp, setPlaygroundTemp] = useState(0.7)
  const [playgroundMaxTokens, setPlaygroundMaxTokens] = useState(512)
  const [playgroundOutput, setPlaygroundOutput] = useState('')
  const [playgroundStreaming, setPlaygroundStreaming] = useState(false)
  const [playgroundMetrics, setPlaygroundMetrics] = useState({ ttft: 0.14, speed: 118, tokens: 0 })
  const [playgroundHistory, setPlaygroundHistory] = useState([
    { prompt: 'Explain tensor parallelism in vLLM', timestamp: '10:14 AM' },
    { prompt: 'Write Python OpenAI client for streaming chat completions', timestamp: '09:48 AM' },
  ])

  const handleRunPlayground = () => {
    if (!playgroundPrompt.trim()) return
    setPlaygroundStreaming(true)
    setPlaygroundOutput('')
    const targetText = `Tensor Parallelism (TP) splits individual weight matrices across multiple GPUs (e.g., across 8x H100s via NVLink). For matrix multiplication in multi-head attention:

1. Column Parallelism: The query, key, and value projection matrices are split along columns. Each GPU computes its slice of attention heads independently without inter-GPU communication during projection.
2. Row Parallelism: The final output projection matrix is split along rows. An All-Reduce operation then sums the activation slices across all TP ranks.

PagedAttention complements this by partitioning KV-cache tensors into non-contiguous physical memory blocks (similar to virtual memory paging in OS kernels). This eliminates memory fragmentation and increases GPU batch concurrency by up to 4x.`

    let idx = 0
    const interval = setInterval(() => {
      idx += 12
      if (idx >= targetText.length) {
        setPlaygroundOutput(targetText)
        setPlaygroundStreaming(false)
        setPlaygroundMetrics({ ttft: 0.14, speed: 118, tokens: Math.floor(targetText.length / 4) })
        clearInterval(interval)
      } else {
        setPlaygroundOutput(targetText.slice(0, idx))
      }
    }, 40)

    setPlaygroundHistory((prev) => [{ prompt: playgroundPrompt.slice(0, 50) + '...', timestamp: 'Just now' }, ...prev.slice(0, 4)])
  }

  // FAQ State
  const [faqSearch, setFaqSearch] = useState('')
  const [faqCategory, setFaqCategory] = useState<'all' | 'hardware' | 'billing' | 'deploy' | 'api'>('all')
  const [openFaqId, setOpenFaqId] = useState<string | null>('faq-1')

  // Admin Sovereign Map State
  const [mapViewMode, setMapViewMode] = useState<'visual' | 'table'>('visual')
  const [selectedGeoCountry, setSelectedGeoCountry] = useState<string | null>(null)

  // Models Page State
  const [modelFilterFamily, setModelFilterFamily] = useState<string>('all')
  const [modelSearch, setModelSearch] = useState('')
  const [selectedModelId, setSelectedModelId] = useState('llama-3.1-8b')
  const [modelQuant, setModelQuant] = useState<Quant>('fp16')
  const [modelContext, setModelContext] = useState(8192)
  const [modelConcurrency, setModelConcurrency] = useState(8)

  // Billing UI State
  const [showTopUpModal, setShowTopUpModal] = useState(false)
  const [topUpAmount, setTopUpAmount] = useState<number>(5000)
  const [viewInvoiceItem, setViewInvoiceItem] = useState<TransactionItem | null>(null)

  // Notifications Filter
  const [notifFilter, setNotifFilter] = useState<'all' | 'unread' | 'read'>('all')

  // Analytics UI State
  const [analyticsRange, setAnalyticsRange] = useState<'24h' | '7d' | '30d'>('24h')

  // Provider State
  const [showAddListing, setShowAddListing] = useState(false)
  const [listingForm, setListingForm] = useState({ gpu: 'NVIDIA L4', vram: '24 GB', region: 'Hyderabad, IN', quantity: '4', price: '60' })
  const [editingListing, setEditingListing] = useState<Listing | null>(null)
  const [providerForm, setProviderForm] = useState({ company: 'Yotta Sovereign Infrastructure Ltd', contact: 'Anil Mehta', email: 'anil.mehta@yotta.com', regions: 'Mumbai NM1, Noida D1', apiType: 'REST + Daemon' })
  const [providerSaved, setProviderSaved] = useState(false)
  const [showPayoutModal, setShowPayoutModal] = useState(false)
  const [workloadTelemetry, setWorkloadTelemetry] = useState<Deployment | null>(null)

  // User Profile State
  const session = getSession()
  const sessionUser = session?.user as ({ fullName: string; email: string; organization?: string }) | undefined
  const [profileName, setProfileName] = useState(sessionUser?.fullName || 'Priya Sharma')
  const [profileEmail, setProfileEmail] = useState(sessionUser?.email || 'priya.s@novatech.ai')
  const [profileOrg, setProfileOrg] = useState(sessionUser?.organization || 'NovaTech AI Systems')
  const [profileAvatar, setProfileAvatar] = useState('PS')

  const handleSaveProfile = (e: FormEvent) => {
    e.preventDefault()
    if (session?.user) {
      session.user.fullName = profileName
      session.user.email = profileEmail
        ; (session.user as any).organization = profileOrg
      saveSession(session)
      localStorage.setItem('inferxe:session:v1', JSON.stringify(session))
    }
    flash('User profile and organization preferences updated.')
  }

  // Sync to localStorage
  useEffect(() => { saveStore(STORE.listings, listings) }, [listings])
  useEffect(() => { saveStore(STORE.deployments, deployments) }, [deployments])
  useEffect(() => { saveStore(STORE.keys, keys) }, [keys])
  useEffect(() => { saveStore(STORE.sshKeys, sshKeys) }, [sshKeys])
  useEffect(() => { saveStore(STORE.orders, orders) }, [orders])
  useEffect(() => { saveStore(STORE.wishlist, wishlist) }, [wishlist])
  useEffect(() => { saveStore(STORE.wallet, walletBalance) }, [walletBalance])
  useEffect(() => { saveStore(STORE.transactions, transactions) }, [transactions])
  useEffect(() => {
    saveStore(STORE.notifications, notifications)
    try {
      window.dispatchEvent(new CustomEvent('inferxe_notifications_change'))
    } catch {}
  }, [notifications])
  useEffect(() => { setNotice(''); setSearch('') }, [route])

  usePageMeta(`${info.title} · Inferxe`, info.description)

  const addNotification = (notif: { title: string; detail: string; type?: string }) => {
    const item: NotificationItem = {
      id: `n-${Date.now()}`,
      title: notif.title,
      detail: notif.detail,
      type: notif.type || 'System',
      time: 'Just now',
      read: false,
    }
    setNotifications((prev) => [item, ...prev])
    try {
      window.dispatchEvent(new CustomEvent('inferxe_notifications_change'))
    } catch {}
  }

  const flash = (msg: string) => {
    setNotice(msg)
    window.setTimeout(() => setNotice(''), 3800)
  }

  // Filtered & Sorted GPU Listings
  const filteredListings = useMemo(() => {
    return listings
      .filter((item) => {
        const query = search.toLowerCase()
        const matchesQuery = `${item.name} ${item.gpu} ${item.region} ${item.status}`.toLowerCase().includes(query)
        if (!matchesQuery) return false

        if (gpuArchFilter === 'all') return true
        if (gpuArchFilter === 'ada') return item.name.includes('L4') || item.name.includes('L40S')
        if (gpuArchFilter === 'hopper') return item.name.includes('H100') || item.name.includes('H200')
        if (gpuArchFilter === 'available') return item.status === 'Available'
        if (gpuArchFilter === 'paused') return item.status === 'Paused' || item.status === 'Maintenance'
        return true
      })
      .sort((a, b) => {
        if (gpuSort === 'rate-asc') return a.price - b.price
        if (gpuSort === 'rate-desc') return b.price - a.price
        if (gpuSort === 'vram-desc') return parseInt(b.vram) - parseInt(a.vram)
        if (gpuSort === 'qty-desc') return b.quantity - a.quantity
        return 0
      })
  }, [listings, search, gpuArchFilter, gpuSort])

  // Models Calculations
  const selectedModel = useMemo(() => {
    return MODELS.find((m) => m.id === selectedModelId) || MODELS[1]
  }, [selectedModelId])

  const modelMemoryCalc = useMemo(() => {
    return estimateMemory({
      modelId: selectedModel.id,
      quant: modelQuant,
      context: modelContext,
      concurrency: modelConcurrency,
    })
  }, [selectedModel, modelQuant, modelContext, modelConcurrency])

  const modelRecommendation = useMemo(() => {
    return recommend({
      modelId: selectedModel.id,
      quant: modelQuant,
      context: modelContext,
      concurrency: modelConcurrency,
      priority: 'cost',
      budget: 1200,
      minTps: 40,
    })
  }, [selectedModel, modelQuant, modelContext, modelConcurrency])

  // Filtered Models
  const filteredModels = useMemo(() => {
    return MODELS.filter((m) => {
      const matchesSearch = `${m.name} ${m.family} ${m.arch}`.toLowerCase().includes(modelSearch.toLowerCase())
      if (!matchesSearch) return false
      if (modelFilterFamily === 'all') return true
      return m.family === modelFilterFamily
    })
  }, [modelSearch, modelFilterFamily])

  // Breadcrumbs
  const breadcrumb = [
    {
      label: info.group === 'admin' ? 'Admin Portal' : 'Customer Portal',
      to: info.group === 'admin' ? '/dashboard' : '/dashboard/customer',
    },
    { label: info.title },
  ]

  // Handlers
  const handleCreateDeployment = (e: FormEvent) => {
    e.preventDefault()
    if (!deployForm.name.trim()) return

    const newDep: Deployment = {
      id: `dep-${Date.now().toString().slice(-4)}`,
      name: deployForm.name.trim().toLowerCase().replace(/\s+/g, '-'),
      model: deployForm.model,
      gpu: deployForm.gpu,
      region: deployForm.region,
      status: 'Running',
      hourlyRate: deployForm.gpu.includes('H100') ? 275 : deployForm.gpu.includes('L40S') ? 100 : 60,
    }

    setDeployments((prev) => [newDep, ...prev])
    setShowDeployModal(false)
    setDeployForm({ name: '', model: 'Qwen2.5 7B Instruct', gpu: 'L4', region: 'Hyderabad, IN' })
    addNotification({
      title: `GPU Deployed: ${newDep.name}`,
      detail: `${newDep.model} running on ${newDep.gpu} (${newDep.region}) at ₹${newDep.hourlyRate}/hr.`,
      type: 'Deployment',
    })
    flash(`Deployment "${newDep.name}" initialized and running on ${newDep.gpu}!`)
  }

  const handleToggleDeployment = (id: string, action: 'start' | 'stop' | 'restart') => {
    const targetDep = deployments.find((d) => d.id === id)
    const statusLabel = action === 'restart' ? 'Restarted' : action === 'start' ? 'Running' : 'Stopped'
    setDeployments((prev) =>
      prev.map((d) => {
        if (d.id !== id) return d
        if (action === 'stop') return { ...d, status: 'Stopped' }
        if (action === 'start') return { ...d, status: 'Running' }
        return { ...d, status: 'Provisioning' }
      })
    )
    addNotification({
      title: `GPU Deployment ${statusLabel}: ${targetDep?.name || id}`,
      detail: `Instance state updated to ${statusLabel} on ${targetDep?.gpu || 'node'}.`,
      type: 'Hardware',
    })
    flash(`Deployment "${targetDep?.name || id}" is now ${statusLabel}.`)
  }

  const handleConfirmDeleteDeployment = () => {
    if (!deployToDelete) return
    setDeployments((prev) => prev.filter((d) => d.id !== deployToDelete.id))
    addNotification({
      title: `GPU Deployment Terminated: ${deployToDelete.name}`,
      detail: `Released ${deployToDelete.gpu} compute node in ${deployToDelete.region}.`,
      type: 'Hardware',
    })
    flash(`Deployment "${deployToDelete.name}" removed from demo environment.`)
    setDeployToDelete(null)
  }

  const handleCreateKey = (e: FormEvent) => {
    e.preventDefault()
    const name = newKeyName.trim() || `API Key ${keys.length + 1}`
    const newKey: ApiKey = {
      id: `key-${Date.now()}`,
      name,
      key: `inf_demo_live_${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 8)}`,
      created: new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
      revoked: false,
    }
    setKeys((prev) => [newKey, ...prev])
    setShowNewKeyModal(false)
    setNewKeyName('')
    setShowKeySecretId(newKey.id)
    flash(`Demo API key "${name}" generated locally.`)
  }

  const handleConfirmRevokeKey = () => {
    if (!keyToRevoke) return
    setKeys((prev) => prev.map((k) => (k.id === keyToRevoke.id ? { ...k, revoked: true } : k)))
    flash(`Key "${keyToRevoke.name}" revoked locally.`)
    setKeyToRevoke(null)
  }

  const handleTopUpWallet = (e: FormEvent) => {
    e.preventDefault()
    setWalletBalance((prev) => prev + topUpAmount)
    const newTx: TransactionItem = {
      id: `TX-${Math.floor(1000 + Math.random() * 9000)}`,
      desc: 'Wallet top-up (Demo)',
      date: new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
      amount: topUpAmount,
      isCredit: true,
      status: 'Completed',
    }
    setTransactions((prev) => [newTx, ...prev])
    setShowTopUpModal(false)
    addNotification({
      title: `Wallet Credited: +₹${topUpAmount.toLocaleString('en-IN')}`,
      detail: `₹${topUpAmount.toLocaleString('en-IN')} successfully credited to compute wallet. Transaction ${newTx.id} confirmed.`,
      type: 'Billing',
    })
    flash(`₹${topUpAmount.toLocaleString('en-IN')} added to your wallet! Transaction completed.`)
  }

  const handleAddSshKey = (e: FormEvent) => {
    e.preventDefault()
    if (!newSshKey.trim().startsWith('ssh-') && !newSshKey.trim().startsWith('ecdsa-')) {
      setSshError('Public key must begin with ssh-rsa, ssh-ed25519, or ecdsa-sha2-nistp256')
      return
    }
    const keyObj: SshKey = {
      id: `ssh-${Date.now()}`,
      name: newSshName.trim() || 'Workstation Key',
      key: newSshKey.trim(),
      fingerprint: `SHA256:${Math.random().toString(36).slice(2, 10)}...${Math.random().toString(36).slice(2, 6)}`,
      addedDate: new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
    }
    setSshKeys((prev) => [keyObj, ...prev])
    setShowAddSshModal(false)
    setNewSshName('')
    setNewSshKey('')
    setSshError('')
    flash(`SSH Public Key "${keyObj.name}" added for compute cluster pairing (demo).`)
  }

  const handleConfirmDeleteSshKey = () => {
    if (!sshKeyToDelete) return
    setSshKeys((prev) => prev.filter((k) => k.id !== sshKeyToDelete.id))
    flash(`SSH key "${sshKeyToDelete.name}" removed from local store.`)
    setSshKeyToDelete(null)
  }

  const handleApplyCoupon = (e: FormEvent) => {
    e.preventDefault()
    setCouponError('')
    const code = checkoutCoupon.trim().toUpperCase()
    if (code === 'INFERXE10') {
      setAppliedCoupon({ code: 'INFERXE10', percent: 10 })
      flash('Coupon INFERXE10 applied! 10% discount added to order.')
    } else if (code === 'FRIEND15') {
      setAppliedCoupon({ code: 'FRIEND15', percent: 15 })
      flash('Referral coupon FRIEND15 applied! 15% discount added to order.')
    } else if (code === 'LAUNCH50') {
      setAppliedCoupon({ code: 'LAUNCH50', flat: 500 })
      flash('Coupon LAUNCH50 applied! ₹500 flat discount added.')
    } else {
      setCouponError('Invalid or expired coupon code. Try INFERXE10, FRIEND15 or LAUNCH50.')
    }
  }

  const handleSimulatePayment = () => {
    const selectedGpu = listings.find((l) => l.id === checkoutGpuId) || listings[0]
    const baseCost = selectedGpu.price * checkoutDuration
    let discount = 0
    if (appliedCoupon?.percent) discount = Math.round((baseCost * appliedCoupon.percent) / 100)
    else if (appliedCoupon?.flat) discount = Math.min(baseCost, appliedCoupon.flat)
    const taxable = Math.max(0, baseCost - discount)
    const tax = Math.round(taxable * 0.18)
    const total = taxable + tax

    setCheckoutState('processing')
    setTimeout(() => {
      const orderId = `ORD-${Math.floor(1000 + Math.random() * 9000)}`
      const newOrder: OrderItem = {
        id: orderId,
        modelOrGpu: `Dedicated ${selectedGpu.name} (${selectedGpu.vram})`,
        provider: selectedGpu.region,
        date: new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
        duration: `${checkoutDuration} hours`,
        cost: total,
        status: 'Running',
        details: `Provisioned on ${selectedGpu.region} via ${checkoutPaymentMethod.toUpperCase()} (Simulated). Coupon: ${appliedCoupon?.code || 'None'}`,
      }
      setOrders((prev) => [newOrder, ...prev])

      if (checkoutPaymentMethod === 'wallet') {
        setWalletBalance((prev) => Math.max(0, prev - total))
        setTransactions((prev) => [
          {
            id: `TX-${Math.floor(1000 + Math.random() * 9000)}`,
            desc: `Compute order ${orderId} (${selectedGpu.name})`,
            date: new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
            amount: total,
            isCredit: false,
            status: 'Completed',
          },
          ...prev,
        ])
      }

      setCheckoutReceipt({
        orderId,
        gpu: selectedGpu.name,
        vram: selectedGpu.vram,
        region: selectedGpu.region,
        duration: checkoutDuration,
        baseCost,
        discount,
        tax,
        total,
        method: checkoutPaymentMethod,
      })
      setCheckoutState('success')
      addNotification({
        title: `GPU Instance Provisioned: ${selectedGpu.name}`,
        detail: `Order ${orderId} activated for ${checkoutDuration}h in ${selectedGpu.region}. Cost: ₹${total.toLocaleString('en-IN')}.`,
        type: 'Order',
      })
      flash(`Order ${orderId} successfully provisioned! GPU ${selectedGpu.name} running.`)
    }, 1200)
  }

  const handleSaveListing = (e: FormEvent) => {
    e.preventDefault()
    if (editingListing) {
      setListings((prev) =>
        prev.map((l) => (l.id === editingListing.id ? { ...editingListing } : l))
      )
      setEditingListing(null)
      addNotification({
        title: `GPU Listing Updated: ${editingListing.name}`,
        detail: `Updated ${editingListing.gpu} (${editingListing.vram}) pricing to ₹${editingListing.price}/hr. Status: ${editingListing.status}.`,
        type: 'Marketplace',
      })
      flash(`GPU listing "${editingListing.name}" updated.`)
    } else {
      const item: Listing = {
        id: `gpu-${Date.now()}`,
        name: listingForm.gpu,
        gpu: listingForm.gpu.replace('NVIDIA ', ''),
        vram: listingForm.vram,
        region: listingForm.region,
        quantity: Math.max(1, Number(listingForm.quantity) || 1),
        price: Math.max(1, Number(listingForm.price) || 1),
        status: 'Available',
      }
      setListings((prev) => [item, ...prev])
      setShowAddListing(false)
      addNotification({
        title: `New GPU Listing Added: ${item.name}`,
        detail: `${item.gpu} (${item.vram}) in ${item.region} added at ₹${item.price}/hr.`,
        type: 'Marketplace',
      })
      flash(`New GPU listing "${item.name}" added to inventory.`)
    }
  }

  const handleSendTestNotification = () => {
    const newNotif: NotificationItem = {
      id: `n-${Date.now()}`,
      title: 'Automated health audit passed',
      detail: 'Node ap-south-1 latency verified at 4ms.',
      type: 'System',
      time: 'Just now',
      read: false,
    }
    setNotifications((prev) => [newNotif, ...prev])
    flash('New demo notification generated.')
  }

  const workspaceContent = (
    <DashboardLayout
      pageTitle={info.title}
      hideHeader={route === 'customer'}
      heading={info.title}
      description={info.description}
      breadcrumb={breadcrumb}
      backButtonTo={isProvider ? '/dashboard/provider' : '/dashboard/customer'}
      backButtonLabel="Back to overview"
    >
      <div className="mw-page">
        {/* Action Toast Feedback */}
        {notice && (
          <div className="mw-toast" role="status">
            <Check size={16} />
            <span>{notice}</span>
            <button onClick={() => setNotice('')} aria-label="Dismiss message">
              <X size={14} />
            </button>
          </div>
        )}

        {/* ───────────────────────────────────────────────────────────
            1. CUSTOMER PORTAL OVERVIEW (route === 'customer')
            ─────────────────────────────────────────────────────────── */}
        {route === 'customer' && (() => {
          const session = getSession()
          const fullName = session?.user.fullName || 'Priya Sharma'
          const greet = 'Hello'
          const running = deployments.filter((d) => d.status === 'Running')
          const burn = running.reduce((s, d) => s + (d.hourlyRate ?? 0), 0)
          const hoursLeft = burn > 0 ? walletBalance / burn : null
          const spend = transactions.filter((t) => !t.isCredit).reduce((s, t) => s + t.amount, 0)
          const unread = notifications.filter((n) => !n.read)
          const recentOrders = orders.slice(0, 4)
          const trialActive = trialTimeLeft !== null && trialTimeLeft > 0
          const trialLabel =
            trialTimeLeft === null ? 'Not started' : trialTimeLeft > 0 ? `${Math.floor(trialTimeLeft / 60000)}m ${String(Math.floor((trialTimeLeft % 60000) / 1000)).padStart(2, '0')}s` : 'Expired'
          const lowWallet = walletBalance < 2000 || (hoursLeft !== null && hoursLeft < 6)

          return (
            <>
              {/* Greeting + primary action */}
              <div className="dh-hero">
                <div>
                  <h2>{greet}, {fullName.split(' ')[0]}</h2>
                  <p>
                    {running.length > 0
                      ? `${running.length} GPU${running.length > 1 ? 's' : ''} running · ${money(burn)}/hr`
                      : 'No GPUs running right now. Deploy one to get started.'}
                  </p>
                </div>
                <div className="row" style={{ gap: 8 }}>
                  <button className="mw-secondary" onClick={() => navigate('/dashboard/playground')}>
                    <Terminal size={15} /> Playground
                  </button>
                  <button className="mw-primary" onClick={() => setShowDeployModal(true)}>
                    <Plus size={15} /> Deploy a GPU
                  </button>
                </div>
              </div>

              {/* New-GPU announcement: thin, dismissible strip */}
              {!announcementDismissed && (
                <div className="dh-strip">
                  <Zap size={14} />
                  <span><strong>New:</strong> NVIDIA Blackwell GB200 now available in Mumbai (Yotta NM1).</span>
                  <button className="mw-link-btn" onClick={() => navigate('/dashboard/models')}>View specs</button>
                  <button
                    className="mw-icon-btn"
                    aria-label="Dismiss announcement"
                    onClick={() => {
                      localStorage.setItem(STORE.announcementDismissed, 'true')
                      setAnnouncementDismissed(true)
                    }}
                  >
                    <X size={13} />
                  </button>
                </div>
              )}

              {/* Live stat cards */}
              <div className="mw-stat-grid">
                <div className={`mw-metric ${lowWallet ? 'dh-warn' : ''}`}>
                  <div className="mw-metric-top"><span>Wallet balance</span><span className="mw-icon-box"><Wallet /></span></div>
                  <strong>{money(walletBalance)}</strong>
                  <small>
                    {hoursLeft === null ? 'Nothing billing right now' : `≈ ${hoursLeft.toFixed(1)} hrs left at current usage`}
                    {lowWallet && ' · '}
                    {lowWallet && <Link to="/dashboard/wallet" style={{ color: 'var(--brand-hi)', fontWeight: 600 }}>Top up</Link>}
                  </small>
                </div>
                <div className="mw-metric">
                  <div className="mw-metric-top"><span>Running GPUs</span><span className="mw-icon-box"><Server /></span></div>
                  <strong>{running.length} <span className="dh-of">of {deployments.length}</span></strong>
                  <small>{money(burn)}/hr current burn</small>
                </div>
                <div className="mw-metric">
                  <div className="mw-metric-top"><span>Spend this month</span><span className="mw-icon-box"><CircleDollarSign /></span></div>
                  <strong>{money(spend)}</strong>
                  <small><Link to="/dashboard/analytics" style={{ color: 'var(--brand-hi)' }}>View usage &amp; analytics</Link></small>
                </div>
                <div className="mw-metric">
                  <div className="mw-metric-top"><span>Free trial</span><span className="mw-icon-box"><Sparkles /></span></div>
                  <strong>{trialLabel}</strong>
                  <small>
                    {trialTimeLeft === null ? (
                      <button className="mw-link-btn" onClick={startTrial}>Start 1-hour free trial</button>
                    ) : trialActive ? 'Sandbox credits active' : (
                      <Link to="/dashboard/wallet" style={{ color: 'var(--brand-hi)' }}>Top up to continue</Link>
                    )}
                  </small>
                </div>
              </div>

              {/* Get-started checklist (until the free trial has been started) */}
              {trialTimeLeft === null && (
                <div className="mw-panel dh-start">
                  <div className="mw-panel-head"><h3>Get started in 3 steps</h3><span className="mw-muted">Login to experience our model for a limited time</span></div>
                  <div className="dh-steps">
                    <button onClick={startTrial}><span>1</span><div><strong>Start your 1-hour free trial</strong><small>No card needed</small></div></button>
                    <button onClick={() => navigate('/dashboard/api-keys')}><span>2</span><div><strong>Create an API key</strong><small>One API, many GPU providers</small></div></button>
                    <button onClick={() => setShowDeployModal(true)}><span>3</span><div><strong>Deploy your first GPU</strong><small>Or try the Playground</small></div></button>
                  </div>
                </div>
              )}

              <div className="dh-grid">
                {/* Main: running deployments */}
                <div className="mw-panel">
                  <div className="mw-panel-head">
                    <h3>Your GPUs &amp; models</h3>
                    <Link to="/dashboard/deployments" className="mw-muted">Manage all</Link>
                  </div>
                  {deployments.length === 0 && <p className="mw-muted" style={{ padding: 16 }}>Nothing deployed yet — hit “Deploy a GPU”.</p>}
                  <div className="dh-list">
                    {deployments.map((d) => (
                      <div className="dh-row" key={d.id}>
                        <div className="dh-row__main">
                          <strong>{d.name}</strong>
                          <small>{d.model} · {d.gpu} · {d.region}</small>
                        </div>
                        <StatusBadge>{d.status}</StatusBadge>
                        <span className="dh-row__rate">{money(d.hourlyRate ?? 0)}/hr</span>
                        <div className="mw-actions">
                          {d.status === 'Running' ? (
                            <>
                              <button onClick={() => navigate('/dashboard/notebooks')}>Notebook</button>
                              <button onClick={() => handleToggleDeployment(d.id, 'stop')}>Stop</button>
                            </>
                          ) : (
                            <button onClick={() => handleToggleDeployment(d.id, 'start')}>Start</button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Side: alerts + recent orders */}
                <div className="dh-side">
                  <div className="mw-panel">
                    <div className="mw-panel-head">
                      <h3>Alerts {unread.length > 0 && <span className="dh-count">{unread.length}</span>}</h3>
                      <Link to="/dashboard/notifications" className="mw-muted">All</Link>
                    </div>
                    <div className="dh-list">
                      {lowWallet && (
                        <div className="dh-alert dh-alert--warn">
                          <strong>Wallet running low</strong>
                          <small>{hoursLeft === null ? money(walletBalance) : `~${hoursLeft.toFixed(1)} hrs of runtime left`}. <Link to="/dashboard/wallet">Top up</Link></small>
                        </div>
                      )}
                      {unread.slice(0, 3).map((n) => (
                        <div className="dh-alert" key={n.id}><strong>{n.title}</strong><small>{n.time}</small></div>
                      ))}
                      {!lowWallet && unread.length === 0 && <p className="mw-muted" style={{ padding: '4px 16px 14px' }}>You are all caught up.</p>}
                    </div>
                  </div>

                  <div className="mw-panel">
                    <div className="mw-panel-head"><h3>Recent orders</h3><Link to="/dashboard/orders" className="mw-muted">History</Link></div>
                    <div className="dh-list">
                      {recentOrders.map((o) => (
                        <div className="dh-order" key={o.id}>
                          <div><strong>{o.id}</strong><small>{o.modelOrGpu}</small></div>
                          <div style={{ textAlign: 'right' }}>
                            <span>{money(o.cost)}</span>
                            {o.status === 'Completed' ? (
                              <Link to="/dashboard/reviews" className="dh-rate">Rate it</Link>
                            ) : (
                              <small>{o.status}</small>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Quick actions */}
              <div className="dh-tiles">
                {[
                  { to: '/dashboard/gpus', icon: <Cpu size={18} />, label: 'GPU Marketplace' },
                  { to: '/dashboard/compare', icon: <Layers size={18} />, label: 'Compare GPUs' },
                  { to: '/dashboard/notebooks', icon: <Terminal size={18} />, label: 'Notebooks & SSH' },
                  { to: '/dashboard/api-keys', icon: <KeyRound size={18} />, label: 'API Keys' },
                  { to: '/dashboard/rewards', icon: <Sparkles size={18} />, label: 'Rewards' },
                ].map((t) => (
                  <Link to={t.to} key={t.to} className="dh-tile">{t.icon}<span>{t.label}</span></Link>
                ))}
              </div>
            </>
          )
        })()}


        {/* ───────────────────────────────────────────────────────────
            2. MODELS & SPECIFICATIONS (route === 'models')
            ─────────────────────────────────────────────────────────── */}
        {route === 'models' && (
          <>
            <div className="mw-toolbar">
              <div>
                <h2>Models & Hardware Compatibility</h2>
                <p>Calculate VRAM footprints, evaluate KV-cache memory, and verify GPU fit across open-weights models.</p>
              </div>
              <button
                className="mw-primary"
                onClick={() => {
                  setDeployForm((f) => ({ ...f, model: selectedModel.name }))
                  setShowDeployModal(true)
                }}
              >
                <Plus size={15} /> Deploy Selected Model
              </button>
            </div>

            {/* Filter Bar */}
            <div className="mw-filter-bar">
              <div className="mw-search" style={{ maxWidth: 300, minHeight: 34 }}>
                <Search size={14} />
                <input
                  value={modelSearch}
                  onChange={(e) => setModelSearch(e.target.value)}
                  placeholder="Search model name or architecture..."
                />
              </div>

              {(['all', 'Qwen', 'Llama', 'Mistral'] as const).map((fam) => (
                <button
                  key={fam}
                  type="button"
                  className={`mw-filter-pill ${modelFilterFamily === fam ? 'is-active' : ''}`}
                  onClick={() => setModelFilterFamily(fam)}
                >
                  {fam === 'all' ? 'All Families' : fam}
                </button>
              ))}
            </div>

            {/* Model Cards Grid */}
            <div className="mw-models-grid">
              {filteredModels.map((m) => {
                const isSel = m.id === selectedModel.id
                return (
                  <div
                    key={m.id}
                    className={`mw-model-card ${isSel ? 'is-selected' : ''}`}
                    onClick={() => setSelectedModelId(m.id)}
                    role="button"
                    tabIndex={0}
                  >
                    <div className="row" style={{ justifyContent: 'space-between' }}>
                      <span className="tag" style={{ background: 'rgba(118,185,0,0.12)', color: 'var(--brand-hi)', borderColor: 'var(--brand)' }}>
                        {m.family}
                      </span>
                      <small style={{ fontFamily: 'var(--font-mono)', color: 'var(--ink-4)', fontSize: '0.68rem' }}>
                        {m.params}B params
                      </small>
                    </div>
                    <strong style={{ fontSize: '0.92rem', color: 'var(--ink)' }}>{m.name}</strong>
                    <small style={{ color: 'var(--ink-3)', fontSize: '0.74rem' }}>{m.arch}</small>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: '0.7rem', color: 'var(--ink-4)' }}>
                      <span>FP16: ~{(m.params * 2).toFixed(1)} GB</span>
                      <span>FP8: ~{m.params.toFixed(1)} GB</span>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Interactive Model Calculator Box */}
            <div className="mw-panel" style={{ marginTop: 8 }}>
              <div className="mw-panel-head">
                <h3>Workload Memory Estimator: {selectedModel.name}</h3>
                <span className="mw-muted">vLLM PagedAttention calculation</span>
              </div>

              <div className="mw-workload-box">
                <div className="grid grid--3" style={{ gap: 16 }}>
                  {/* Precision */}
                  <div>
                    <label style={{ fontSize: '0.74rem', color: 'var(--ink-3)', display: 'block', marginBottom: 6 }}>
                      Weight Precision
                    </label>
                    <div className="row" style={{ gap: 6 }}>
                      {QUANTS.map((q) => (
                        <button
                          key={q.id}
                          type="button"
                          className={`mw-filter-pill ${modelQuant === q.id ? 'is-active' : ''}`}
                          onClick={() => setModelQuant(q.id)}
                        >
                          {q.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Context Length */}
                  <div>
                    <div className="mw-slider-header" style={{ marginBottom: 6 }}>
                      <span>Context Window</span>
                      <strong>{modelContext.toLocaleString()} tokens</strong>
                    </div>
                    <div className="row" style={{ gap: 6 }}>
                      {[4096, 8192, 16384, 32768].map((c) => (
                        <button
                          key={c}
                          type="button"
                          className={`mw-filter-pill ${modelContext === c ? 'is-active' : ''}`}
                          onClick={() => setModelContext(c)}
                        >
                          {c / 1024}k
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Concurrency */}
                  <div>
                    <div className="mw-slider-header" style={{ marginBottom: 6 }}>
                      <span>Concurrent Streams</span>
                      <strong>{modelConcurrency} streams</strong>
                    </div>
                    <input
                      type="range"
                      min={1}
                      max={32}
                      value={modelConcurrency}
                      onChange={(e) => setModelConcurrency(Number(e.target.value))}
                      className="mw-slider-input"
                    />
                  </div>
                </div>

                {/* Calculation Outputs */}
                <div className="mw-calc-grid">
                  <div className="mw-calc-box">
                    <span>Model Weights</span>
                    <strong>{fmtGB(modelMemoryCalc.weights)}</strong>
                  </div>
                  <div className="mw-calc-box">
                    <span>KV Cache</span>
                    <strong>{fmtGB(modelMemoryCalc.kv)}</strong>
                  </div>
                  <div className="mw-calc-box">
                    <span>Runtime Overhead</span>
                    <strong>{fmtGB(modelMemoryCalc.overhead)}</strong>
                  </div>
                  <div className="mw-calc-box" style={{ borderColor: 'rgba(118,185,0,0.4)', background: 'rgba(118,185,0,0.06)' }}>
                    <span style={{ color: 'var(--brand-hi)' }}>Total VRAM Required</span>
                    <strong style={{ color: 'var(--brand-hi)' }}>{fmtGB(modelMemoryCalc.need)}</strong>
                  </div>
                </div>

                {/* Recommendation Card */}
                {modelRecommendation.pick && (
                  <div className="mw-rec-card">
                    <div className="row" style={{ justifyContent: 'space-between' }}>
                      <div className="row" style={{ gap: 8 }}>
                        <Zap size={18} style={{ color: 'var(--brand-hi)' }} />
                        <strong style={{ fontSize: '0.92rem', color: 'var(--ink)' }}>
                          Recommended Fit: {modelRecommendation.pick.label}
                        </strong>
                      </div>
                      <span className="tag" style={{ background: 'rgba(118,185,0,0.2)', color: 'var(--brand-hi)', borderColor: 'var(--brand)' }}>
                        {modelRecommendation.pick.rate ? inr(modelRecommendation.pick.rate) + '/hr' : 'Market Spot'}
                      </span>
                    </div>
                    <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--ink-2)' }}>
                      Provides <strong>{modelRecommendation.pick.usable.toFixed(0)} GB</strong> usable VRAM with{' '}
                      <strong>{(modelRecommendation.pick.headroom * 100).toFixed(0)}%</strong> memory headroom. Max decoding throughput bound: ~<strong>{modelRecommendation.pick.ceiling.toFixed(0)} tok/s</strong>.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {/* ───────────────────────────────────────────────────────────
            3. GPU MARKETPLACE (route === 'gpus')
            ─────────────────────────────────────────────────────────── */}
        {route === 'gpus' && (
          <>
            <div className="mw-toolbar">
              <div>
                <h2>GPU Capacity Marketplace</h2>
                <p>Compare sovereign hardware listings across Indian Tier-IV datacenters and reserve compute.</p>
              </div>
              <div className="row" style={{ gap: 8 }}>
                {comparedGpuIds.length > 0 && (
                  <button className="mw-secondary" onClick={() => setShowCompareModal(true)}>
                    Compare ({comparedGpuIds.length}) GPUs
                  </button>
                )}
                <Link className="mw-secondary" to="/gpus">Public GPU Guide</Link>
              </div>
            </div>

            {/* Filter and Sort Bar */}
            <div className="mw-filter-bar">
              <div className="mw-search" style={{ maxWidth: 280 }}>
                <Search size={15} />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search GPU, location or status…"
                />
              </div>

              {(['all', 'ada', 'hopper', 'available', 'paused'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  className={`mw-filter-pill ${gpuArchFilter === f ? 'is-active' : ''}`}
                  onClick={() => setGpuArchFilter(f)}
                >
                  {f === 'all' ? 'All Hardware' : f === 'ada' ? 'Ada Lovelace' : f === 'hopper' ? 'Hopper' : f === 'available' ? 'Available' : 'Paused'}
                </button>
              ))}

              <div style={{ marginLeft: 'auto' }}>
                <select
                  value={gpuSort}
                  onChange={(e) => setGpuSort(e.target.value as any)}
                  className="mw-select"
                >
                  <option value="rate-asc">Price: Low to High</option>
                  <option value="rate-desc">Price: High to Low</option>
                  <option value="vram-desc">VRAM: High to Low</option>
                  <option value="qty-desc">Quantity: High to Low</option>
                </select>
              </div>
            </div>

            {/* Comparison Sticky Prompt */}
            {comparedGpuIds.length > 0 && (
              <div className="mw-compare-bar">
                <span style={{ fontSize: '0.8rem', color: 'var(--ink)' }}>
                  Selected <strong>{comparedGpuIds.length}</strong> GPU models for side-by-side comparison.
                </span>
                <div className="row" style={{ gap: 8 }}>
                  <button className="mw-secondary" onClick={() => setComparedGpuIds([])} style={{ minHeight: 32, padding: '4px 10px' }}>
                    Clear
                  </button>
                  <button className="mw-primary" onClick={() => setShowCompareModal(true)} style={{ minHeight: 32, padding: '4px 12px' }}>
                    View Comparison
                  </button>
                </div>
              </div>
            )}

            {/* Listings Grid */}
            <div className="mw-card-grid">
              {filteredListings.map((item) => {
                const isCompared = comparedGpuIds.includes(item.id)
                return (
                  <article className="mw-gpu-card glass glass--lift" key={item.id} style={{ position: 'relative' }}>
                    <div className="mw-gpu-card__top">
                      <span className="mw-icon-box icon-tile"><Cpu size={20} /></span>
                      <div className="row" style={{ gap: 6, alignItems: 'center' }}>
                        <StatusBadge>{item.status}</StatusBadge>
                        <button
                          className={`mw-icon-btn mw-wish-btn ${wishlist.includes(item.id) ? 'is-active' : ''}`}
                          onClick={() => toggleWishlist(item.id)}
                          title={wishlist.includes(item.id) ? 'Remove from Wishlist' : 'Save to Wishlist'}
                          aria-label="Wishlist toggle"
                        >
                          <Heart size={14} fill={wishlist.includes(item.id) ? '#ef4444' : 'none'} color={wishlist.includes(item.id) ? '#ef4444' : 'currentColor'} />
                        </button>
                        <button
                          className="mw-icon-btn"
                          onClick={() => handleShareListing(item)}
                          title="Share Listing"
                          aria-label="Share Listing"
                        >
                          <Share2 size={14} />
                        </button>
                      </div>
                    </div>

                    <h3>{item.name}</h3>
                    <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.74rem' }}>{item.vram} VRAM · {item.region}</p>

                    <div className="mw-gpu-specs">
                      <span>
                        <small className="engrave">Inventory</small>
                        <strong className="readout" style={{ fontSize: '0.85rem' }}>{item.quantity} GPUs</strong>
                      </span>
                      <span>
                        <small className="engrave">Hourly Rate</small>
                        <strong className="readout" style={{ fontSize: '0.88rem' }}>{money(item.price)}/hr</strong>
                      </span>
                    </div>

                    <div className="row" style={{ gap: 8, marginTop: 12 }}>
                      <button
                        className="mw-primary"
                        style={{ flex: 1 }}
                        onClick={() => {
                          setDeployForm((f) => ({ ...f, gpu: item.gpu, region: item.region }))
                          setShowDeployModal(true)
                        }}
                      >
                        Select & Deploy <span>→</span>
                      </button>
                      <button
                        className={`mw-secondary ${isCompared ? 'mw-primary' : ''}`}
                        onClick={() => {
                          if (isCompared) setComparedGpuIds((c) => c.filter((id) => id !== item.id))
                          else setComparedGpuIds((c) => [...c, item.id])
                        }}
                        title="Toggle Comparison"
                      >
                        {isCompared ? 'Compared' : 'Compare'}
                      </button>
                    </div>
                  </article>
                )
              })}
            </div>
          </>
        )}

        {/* ───────────────────────────────────────────────────────────
            4. DEPLOYMENTS (route === 'deployments')
            ─────────────────────────────────────────────────────────── */}
        {route === 'deployments' && (
          <>
            <div className="mw-toolbar">
              <div>
                <h2>Model Deployments</h2>
                <p>Deploy serverless and dedicated LLM inference endpoints across sovereign clusters.</p>
              </div>
              <button className="mw-primary" onClick={() => setShowDeployModal(true)}>
                <Plus size={16} /> New Deployment
              </button>
            </div>

            <div className="mw-stat-grid">
              <div className="mw-metric glass glass--lift">
                <div className="mw-metric-top"><span className="engrave">Total Deployments</span><span className="mw-icon-box icon-tile"><Server /></span></div>
                <strong className="readout">{deployments.length}</strong>
              </div>
              <div className="mw-metric glass glass--lift">
                <div className="mw-metric-top"><span className="engrave">Running Endpoints</span><span className="mw-icon-box icon-tile"><Activity /></span></div>
                <strong className="readout">{deployments.filter((d) => d.status === 'Running').length}</strong>
              </div>
              <div className="mw-metric glass glass--lift">
                <div className="mw-metric-top"><span className="engrave">Provisioning</span><span className="mw-icon-box icon-tile"><Zap /></span></div>
                <strong className="readout">{deployments.filter((d) => d.status === 'Provisioning').length}</strong>
              </div>
              <div className="mw-metric glass glass--lift">
                <div className="mw-metric-top"><span className="engrave">Hourly Spend</span><span className="mw-icon-box icon-tile"><CircleDollarSign /></span></div>
                <strong className="readout">{money(deployments.filter((d) => d.status === 'Running').reduce((acc, d) => acc + (d.hourlyRate || 60), 0))}</strong>
              </div>
            </div>

            <div className="mw-panel glass glass--lift" style={{ position: 'relative' }}>
              <div className="mw-panel-head">
                <h3>Endpoint Instances</h3>
                <span className="mw-muted">{deployments.length} configured</span>
              </div>

              {deployments.length === 0 ? (
                <div className="mw-empty">
                  <span className="mw-icon-box"><Server size={22} /></span>
                  <h3>No Active Deployments</h3>
                  <p>Initialize a demo model endpoint to test latency and stream responses.</p>
                  <button className="mw-primary" onClick={() => setShowDeployModal(true)}>
                    <Plus size={15} /> Create Deployment
                  </button>
                </div>
              ) : (
                <div className="mw-table-wrap">
                  <table className="mw-table">
                    <thead>
                      <tr>
                        <th>Endpoint Name</th>
                        <th>Model</th>
                        <th>GPU</th>
                        <th>Region</th>
                        <th>Rate</th>
                        <th>Status</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {deployments.map((d) => (
                        <tr key={d.id}>
                          <td>
                            <strong>{d.name}</strong>
                            <small>{d.id}</small>
                          </td>
                          <td>{d.model}</td>
                          <td>{d.gpu}</td>
                          <td>{d.region}</td>
                          <td>{money(d.hourlyRate || 60)}/hr</td>
                          <td><StatusBadge>{d.status}</StatusBadge></td>
                          <td>
                            <div className="mw-actions">
                              {d.status === 'Running' ? (
                                <button onClick={() => handleToggleDeployment(d.id, 'stop')}>Stop</button>
                              ) : (
                                <button onClick={() => handleToggleDeployment(d.id, 'start')}>Start</button>
                              )}
                              <button onClick={() => handleToggleDeployment(d.id, 'restart')}>Restart</button>
                              <button
                                className="mw-danger"
                                onClick={() => setDeployToDelete(d)}
                                aria-label={`Delete ${d.name}`}
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}

        {/* ───────────────────────────────────────────────────────────
            5. API KEYS (route === 'api-keys')
            ─────────────────────────────────────────────────────────── */}
        {route === 'api-keys' && (
          <>
            <div className="mw-toolbar">
              <div>
                <h2>API Credentials</h2>
                <p>Generate and manage authentication tokens for client applications and OpenAI SDK callers.</p>
              </div>
              <button className="mw-primary" onClick={() => setShowNewKeyModal(true)}>
                <Plus size={16} /> Create Demo Key
              </button>
            </div>

            <div className="mw-panel">
              <div className="mw-panel-head">
                <h3>Issued API Keys</h3>
                <span className="mw-muted">{keys.filter((k) => !k.revoked).length} active</span>
              </div>

              {keys.length === 0 ? (
                <div className="mw-empty">
                  <span className="mw-icon-box"><KeyRound size={22} /></span>
                  <h3>No API Keys Issued</h3>
                  <p>Generate a demo token to authenticate with the Inferxe endpoint.</p>
                  <button className="mw-primary" onClick={() => setShowNewKeyModal(true)}>
                    Generate Key
                  </button>
                </div>
              ) : (
                <div className="mw-table-wrap">
                  <table className="mw-table">
                    <thead>
                      <tr>
                        <th>Key Label</th>
                        <th>Secret Token</th>
                        <th>Issued Date</th>
                        <th>Status</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {keys.map((k) => (
                        <tr key={k.id}>
                          <td>
                            <strong>{k.name}</strong>
                            <small>{k.id}</small>
                          </td>
                          <td className="mw-key-cell">
                            {k.revoked ? (
                              '••••••••••••••••'
                            ) : showKeySecretId === k.id ? (
                              k.key
                            ) : (
                              `${k.key.slice(0, 14)}••••••••`
                            )}
                            {!k.revoked && (
                              <button
                                className="mw-icon-btn"
                                onClick={() => setShowKeySecretId(showKeySecretId === k.id ? null : k.id)}
                                aria-label="Toggle Key Visibility"
                              >
                                {showKeySecretId === k.id ? <EyeOff size={13} /> : <Eye size={13} />}
                              </button>
                            )}
                          </td>
                          <td>{k.created}</td>
                          <td><StatusBadge>{k.revoked ? 'Revoked' : 'Active'}</StatusBadge></td>
                          <td>
                            {!k.revoked && (
                              <div className="mw-actions">
                                <button
                                  onClick={() => {
                                    void navigator.clipboard?.writeText(k.key)
                                    flash('API key copied to clipboard.')
                                  }}
                                >
                                  <Copy size={13} /> Copy
                                </button>
                                <button className="mw-danger" onClick={() => setKeyToRevoke(k)}>
                                  Revoke
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}

        {/* ───────────────────────────────────────────────────────────
            6. USAGE & ANALYTICS (route === 'analytics')
            ─────────────────────────────────────────────────────────── */}
        {route === 'analytics' && (
          <>
            <div className="mw-toolbar">
              <div>
                <h2>Usage & Analytics</h2>
                <p>Review real-time inference telemetry, token volumes, TTFT latencies and spend.</p>
              </div>
              <div className="row" style={{ gap: 6 }}>
                {(['24h', '7d', '30d'] as const).map((r) => (
                  <button
                    key={r}
                    className={`mw-filter-pill ${analyticsRange === r ? 'is-active' : ''}`}
                    onClick={() => setAnalyticsRange(r)}
                  >
                    {r === '24h' ? 'Last 24 Hours' : r === '7d' ? 'Last 7 Days' : 'Last 30 Days'}
                  </button>
                ))}
              </div>
            </div>

            <div className="mw-stat-grid">
              <div className="mw-metric">
                <div className="mw-metric-top"><span>Total Requests</span><span className="mw-icon-box"><Activity /></span></div>
                <strong>{analyticsRange === '24h' ? '128.4k' : analyticsRange === '7d' ? '892.1k' : '3.62M'}</strong>
                <small>+12.8% vs previous period</small>
              </div>
              <div className="mw-metric">
                <div className="mw-metric-top"><span>Tokens Processed</span><span className="mw-icon-box"><Zap /></span></div>
                <strong>{analyticsRange === '24h' ? '8.62M' : analyticsRange === '7d' ? '60.4M' : '241.8M'}</strong>
                <small>+8.2% token throughput</small>
              </div>
              <div className="mw-metric">
                <div className="mw-metric-top"><span>Median Latency</span><span className="mw-icon-box"><TrendingUp /></span></div>
                <strong>184 ms</strong>
                <small style={{ color: 'var(--brand-hi)' }}>0.42s P95 TTFT</small>
              </div>
              <div className="mw-metric">
                <div className="mw-metric-top"><span>Estimated Spend</span><span className="mw-icon-box"><CircleDollarSign /></span></div>
                <strong>{analyticsRange === '24h' ? '₹4,820' : analyticsRange === '7d' ? '₹31,400' : '₹1,24,600'}</strong>
                <small>Inference runtime budget</small>
              </div>
            </div>

            <div className="mw-two-col">
              <div className="mw-panel">
                <div className="mw-panel-head">
                  <h3>Request Throughput Profile</h3>
                  <span className="mw-muted">{analyticsRange.toUpperCase()} window</span>
                </div>
                <div
                  className="mw-bars"
                  onMouseLeave={() => setHoveredAnalyticsIdx(null)}
                >
                  {(analyticsRange === '24h'
                    ? [
                        { label: '00:00', fullDate: '12:00 AM - 04:00 AM', reqs: '38.2k', height: 42, tokens: '2.4M', latency: '172ms', status: 'Off-Peak' },
                        { label: '04:00', fullDate: '04:00 AM - 08:00 AM', reqs: '54.6k', height: 58, tokens: '3.6M', latency: '178ms', status: 'Nominal' },
                        { label: '08:00', fullDate: '08:00 AM - 12:00 PM', reqs: '89.1k', height: 86, tokens: '6.1M', latency: '194ms', status: 'Peak Window' },
                        { label: '12:00', fullDate: '12:00 PM - 04:00 PM', reqs: '96.4k', height: 94, tokens: '6.8M', latency: '188ms', status: 'Peak Window' },
                        { label: '16:00', fullDate: '04:00 PM - 08:00 PM', reqs: '84.8k', height: 82, tokens: '5.9M', latency: '184ms', status: 'Nominal' },
                        { label: '20:00', fullDate: '08:00 PM - 12:00 AM', reqs: '68.5k', height: 68, tokens: '4.8M', latency: '176ms', status: 'Nominal' },
                      ]
                    : analyticsRange === '7d'
                    ? [
                        { label: 'Mon', fullDate: 'Monday, 10 Oct', reqs: '118.2k', height: 68, tokens: '8.4M', latency: '182ms', status: 'Nominal' },
                        { label: 'Tue', fullDate: 'Tuesday, 11 Oct', reqs: '142.5k', height: 84, tokens: '10.2M', latency: '189ms', status: 'Peak Window' },
                        { label: 'Wed', fullDate: 'Wednesday, 12 Oct', reqs: '158.0k', height: 95, tokens: '11.4M', latency: '192ms', status: 'Peak Window' },
                        { label: 'Thu', fullDate: 'Thursday, 13 Oct', reqs: '136.4k', height: 80, tokens: '9.8M', latency: '185ms', status: 'Nominal' },
                        { label: 'Fri', fullDate: 'Friday, 14 Oct', reqs: '124.8k', height: 72, tokens: '8.9M', latency: '180ms', status: 'Nominal' },
                        { label: 'Sat', fullDate: 'Saturday, 15 Oct', reqs: '92.4k', height: 52, tokens: '6.2M', latency: '174ms', status: 'Off-Peak' },
                        { label: 'Sun', fullDate: 'Sunday, 16 Oct (Today)', reqs: '84.2k', height: 48, tokens: '5.8M', latency: '170ms', status: 'Off-Peak' },
                      ]
                    : [
                        { label: 'D1', fullDate: '17 Sep - 19 Sep', reqs: '310k', height: 55, tokens: '22.4M', latency: '180ms', status: 'Nominal' },
                        { label: 'D4', fullDate: '20 Sep - 22 Sep', reqs: '380k', height: 74, tokens: '27.2M', latency: '188ms', status: 'Peak Window' },
                        { label: 'D7', fullDate: '23 Sep - 25 Sep', reqs: '340k', height: 62, tokens: '24.5M', latency: '182ms', status: 'Nominal' },
                        { label: 'D10', fullDate: '26 Sep - 28 Sep', reqs: '410k', height: 88, tokens: '29.8M', latency: '194ms', status: 'Peak Window' },
                        { label: 'D13', fullDate: '29 Sep - 01 Oct', reqs: '395k', height: 82, tokens: '28.4M', latency: '186ms', status: 'Nominal' },
                        { label: 'D16', fullDate: '02 Oct - 04 Oct', reqs: '290k', height: 48, tokens: '20.6M', latency: '172ms', status: 'Off-Peak' },
                        { label: 'D19', fullDate: '05 Oct - 07 Oct', reqs: '365k', height: 70, tokens: '26.1M', latency: '184ms', status: 'Nominal' },
                        { label: 'D22', fullDate: '08 Oct - 10 Oct', reqs: '425k', height: 92, tokens: '31.2M', latency: '196ms', status: 'Peak Window' },
                        { label: 'D25', fullDate: '11 Oct - 13 Oct', reqs: '350k', height: 65, tokens: '25.0M', latency: '183ms', status: 'Nominal' },
                        { label: 'Today', fullDate: '14 Oct - 16 Oct (Current)', reqs: '402k', height: 86, tokens: '29.1M', latency: '185ms', status: 'Optimal' },
                      ]
                  ).map((pt, i) => {
                    const isHovered = hoveredAnalyticsIdx === i
                    return (
                      <div
                        className={`mw-bar-col ${isHovered ? 'is-active' : ''}`}
                        key={pt.label}
                        onMouseEnter={() => setHoveredAnalyticsIdx(i)}
                        tabIndex={0}
                        role="button"
                        aria-label={`${pt.fullDate}: ${pt.reqs} requests`}
                      >
                        {isHovered && (
                          <div className="mw-bar-tooltip">
                            <div className="mw-bar-tooltip__date">{pt.fullDate}</div>
                            <div className="mw-bar-tooltip__price">
                              {pt.reqs}
                              <span style={{ fontSize: '0.7rem', fontWeight: 500, color: 'var(--ink-3)', marginLeft: 4 }}>
                                requests
                              </span>
                            </div>
                            <div className="mw-bar-tooltip__meta">
                              <span
                                className={`mw-bar-tooltip__badge ${
                                  pt.status === 'Off-Peak'
                                    ? 'mw-bar-tooltip__badge--discount'
                                    : pt.status === 'Peak Window'
                                    ? 'mw-bar-tooltip__badge--peak'
                                    : 'mw-bar-tooltip__badge--optimal'
                                }`}
                              >
                                {pt.status}
                              </span>
                              <span style={{ color: 'var(--brand-hi)', fontSize: '0.64rem', fontFamily: 'var(--font-mono)' }}>
                                {pt.latency}
                              </span>
                            </div>
                          </div>
                        )}
                        <div className="mw-bar" style={{ height: `${pt.height}%` }}>
                          <div className="mw-bar-cap" />
                        </div>
                        <small>{pt.label}</small>
                      </div>
                    )
                  })}
                </div>
              </div>

              <div className="mw-panel">
                <div className="mw-panel-head">
                  <h3>Workload Breakdown</h3>
                  <span className="mw-muted">System allocation</span>
                </div>
                {[
                  ['Prompt Input Tokens', 68],
                  ['Generated Output Tokens', 44],
                  ['GPU Runtime Utilization', 78],
                  ['Successful Requests (200 OK)', 99],
                ].map(([label, value]) => (
                  <div className="mw-progress-row" key={String(label)}>
                    <div>
                      <span>{label}</span>
                      <strong>{value}%</strong>
                    </div>
                    <div className="mw-progress">
                      <span style={{ width: `${value}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* ── Extras: usage detail, notebooks, providers, reviews, rewards ── */}
        {route === 'analytics' && (
          <UsageDetail deployments={deployments} walletBalance={walletBalance} trialTimeLeft={trialTimeLeft} />
        )}
        {route === 'notebooks' && <NotebooksSection deployments={deployments} flash={flash} />}
        {route === 'reviews' && <ReviewsSection orders={orders} flash={flash} />}
        {route === 'rewards' && (
          <RewardsSection userName={getSession()?.user.fullName || 'Priya Sharma'} flash={flash} onGrantTrial={startTrial} />
        )}

        {/* ───────────────────────────────────────────────────────────
            7. WALLET & BILLING (route === 'billing')
            ─────────────────────────────────────────────────────────── */}
        {route === 'billing' && (
          <>
            <div className="mw-toolbar">
              <div>
                <h2>Wallet & Billing</h2>
                <p>Manage prepaid inference credits, monitor consumption, and inspect invoices.</p>
              </div>
              <button className="mw-primary" onClick={() => setShowTopUpModal(true)}>
                <Plus size={16} /> Top Up Balance (Demo)
              </button>
            </div>

            <div className="mw-stat-grid">
              <div className="mw-metric">
                <div className="mw-metric-top"><span>Available Balance</span><span className="mw-icon-box"><Wallet /></span></div>
                <strong>{money(walletBalance)}</strong>
                <small style={{ color: 'var(--brand-hi)' }}>Prepaid balance</small>
              </div>
              <div className="mw-metric">
                <div className="mw-metric-top"><span>Current Month Usage</span><span className="mw-icon-box"><CircleDollarSign /></span></div>
                <strong>₹4,820</strong>
                <small>48% of ₹10,000 monthly limit</small>
              </div>
              <div className="mw-metric">
                <div className="mw-metric-top"><span>Pending Invoices</span><span className="mw-icon-box"><ArrowDownToLine /></span></div>
                <strong>1</strong>
                <small>Generated on 01 Oct 2026</small>
              </div>
              <div className="mw-metric">
                <div className="mw-metric-top"><span>Next Billing Cycle</span><span className="mw-icon-box"><Bell /></span></div>
                <strong>01 Nov 2026</strong>
                <small>Auto-invoicing enabled</small>
              </div>
            </div>

            <div className="mw-panel">
              <div className="mw-panel-head">
                <h3>Transaction History</h3>
                <span className="mw-muted">{transactions.length} recorded</span>
              </div>
              <div className="mw-table-wrap">
                <table className="mw-table">
                  <thead>
                    <tr>
                      <th>Reference ID</th>
                      <th>Description</th>
                      <th>Date</th>
                      <th>Amount</th>
                      <th>Status</th>
                      <th>Invoice</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map((tx) => (
                      <tr key={tx.id}>
                        <td>
                          <strong>{tx.id}</strong>
                        </td>
                        <td>{tx.desc}</td>
                        <td>{tx.date}</td>
                        <td style={{ color: tx.isCredit ? 'var(--brand-hi)' : 'var(--ink)' }}>
                          {tx.isCredit ? `+${money(tx.amount)}` : `−${money(tx.amount)}`}
                        </td>
                        <td><StatusBadge>{tx.status}</StatusBadge></td>
                        <td>
                          <button
                            className="mw-link-btn"
                            onClick={() => setViewInvoiceItem(tx)}
                          >
                            View Invoice
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* ───────────────────────────────────────────────────────────
            8. NOTIFICATIONS (route === 'notifications')
            ─────────────────────────────────────────────────────────── */}
        {route === 'notifications' && (
          <>
            <div className="mw-toolbar">
              <div>
                <h2>System Alerts & Notifications</h2>
                <p>Stay informed regarding cluster health, deployment events, and budget warnings.</p>
              </div>
              <div className="row" style={{ gap: 8 }}>
                <button className="mw-secondary" onClick={handleSendTestNotification}>
                  <Zap size={14} /> Send Test Alert (Demo)
                </button>
                <button
                  className="mw-secondary"
                  onClick={() => {
                    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
                    flash('All notifications marked as read.')
                  }}
                >
                  Mark All Read
                </button>
              </div>
            </div>

            {/* Notification Filter Tabs */}
            <div className="mw-filter-bar">
              {(['all', 'unread', 'read'] as const).map((tab) => (
                <button
                  key={tab}
                  className={`mw-filter-pill ${notifFilter === tab ? 'is-active' : ''}`}
                  onClick={() => setNotifFilter(tab)}
                >
                  {tab === 'all'
                    ? `All (${notifications.length})`
                    : tab === 'unread'
                      ? `Unread (${notifications.filter((n) => !n.read).length})`
                      : 'Read'}
                </button>
              ))}
            </div>

            <div className="mw-panel">
              {notifications.filter((n) => (notifFilter === 'all' ? true : notifFilter === 'unread' ? !n.read : n.read)).length === 0 ? (
                <div className="mw-empty">
                  <span className="mw-icon-box"><Bell size={22} /></span>
                  <h3>No Notifications</h3>
                  <p>You have reviewed all alerts matching this filter.</p>
                </div>
              ) : (
                notifications
                  .filter((n) => (notifFilter === 'all' ? true : notifFilter === 'unread' ? !n.read : n.read))
                  .map((n) => (
                    <div className={`mw-notification ${n.read ? 'is-read' : ''}`} key={n.id}>
                      <span className="mw-notification-dot" />
                      <div>
                        <strong>{n.title}</strong>
                        <p>{n.detail}</p>
                        <small>{n.type} · {n.time}</small>
                      </div>
                      <div className="row" style={{ gap: 6 }}>
                        <button
                          className="mw-secondary"
                          onClick={() => {
                            setNotifications((prev) => prev.map((item) => (item.id === n.id ? { ...item, read: !item.read } : item)))
                          }}
                        >
                          {n.read ? 'Mark Unread' : 'Mark Read'}
                        </button>
                        <button
                          className="mw-icon-btn mw-danger"
                          onClick={() => {
                            setNotifications((prev) => prev.filter((item) => item.id !== n.id))
                          }}
                          aria-label="Delete Notification"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  ))
              )}
            </div>
          </>
        )}

        {/* ───────────────────────────────────────────────────────────
            9. SETTINGS (route === 'settings')
            ─────────────────────────────────────────────────────────── */}
        {route === 'settings' && (
          <SettingsSection flash={flash} />
        )}

        {/* ───────────────────────────────────────────────────────────
            10. PROVIDER OVERVIEW (route === 'provider')
            ─────────────────────────────────────────────────────────── */}
        {route === 'provider' && (
          <>
            <div className="mw-toolbar">
              <div>
                <h2>GPU Provider Workspace</h2>
                <p>Manage hardware supply, monitor workload allocations, and review earnings across Indian clusters.</p>
              </div>
              <Link className="mw-primary" to="/dashboard/provider/onboarding">
                <Plus size={16} /> Onboard Datacenter
              </Link>
            </div>

            <div className="mw-stat-grid">
              <div className="mw-metric">
                <div className="mw-metric-top"><span>Listed Nodes</span><span className="mw-icon-box"><Cpu /></span></div>
                <strong>{listings.length}</strong>
                <small>{listings.reduce((sum, l) => sum + l.quantity, 0)} total GPUs</small>
              </div>
              <div className="mw-metric">
                <div className="mw-metric-top"><span>Available GPUs</span><span className="mw-icon-box"><Server /></span></div>
                <strong>{listings.filter((l) => l.status === 'Available').reduce((sum, l) => sum + l.quantity, 0)}</strong>
                <small style={{ color: 'var(--brand-hi)' }}>Live for placement</small>
              </div>
              <div className="mw-metric">
                <div className="mw-metric-top"><span>Monthly Gross (Est.)</span><span className="mw-icon-box"><CircleDollarSign /></span></div>
                <strong>{money(listings.filter((l) => l.status === 'Available').reduce((sum, l) => sum + l.quantity * l.price * 8 * 30, 0))}</strong>
                <small>8h/day utilization assumption</small>
              </div>
              <div className="mw-metric">
                <div className="mw-metric-top"><span>Integration State</span><span className="mw-icon-box"><ShieldCheck /></span></div>
                <strong>Demo Mode</strong>
                <small>Adapter contract verified</small>
              </div>
            </div>

            <div className="mw-two-col">
              <div className="mw-panel">
                <div className="mw-panel-head">
                  <h3>GPU Inventory Summary</h3>
                  <Link className="mw-link-btn" to="/dashboard/provider/listings">
                    Manage listings →
                  </Link>
                </div>
                {listings.slice(0, 3).map((l) => (
                  <div className="mw-list-row" key={l.id}>
                    <span className="mw-icon-box"><Cpu size={18} /></span>
                    <div className="mw-list-main">
                      <strong>{l.name}</strong>
                      <small>{l.vram} · {l.region} ({l.quantity} units)</small>
                    </div>
                    <div className="mw-list-end">
                      <strong>{money(l.price)}/hr</strong>
                      <StatusBadge>{l.status}</StatusBadge>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mw-panel">
                <div className="mw-panel-head">
                  <h3>Provider Operations</h3>
                </div>
                <div className="mw-shortcuts">
                  <Link to="/dashboard/provider/listings" className="mw-shortcut">
                    <span className="mw-icon-box"><Cpu /></span>
                    <span><strong>GPU Inventory & Listings</strong><small>Add, edit and price hardware capacity</small></span>
                    <span className="mw-arrow">→</span>
                  </Link>
                  <Link to="/dashboard/provider/capacity" className="mw-shortcut">
                    <span className="mw-icon-box"><Activity /></span>
                    <span><strong>Capacity & Maintenance</strong><small>Manage offline windows and health</small></span>
                    <span className="mw-arrow">→</span>
                  </Link>
                  <Link to="/dashboard/provider/workloads" className="mw-shortcut">
                    <span className="mw-icon-box"><Wrench /></span>
                    <span><strong>Assigned Workloads</strong><small>Inspect tenant requests and streams</small></span>
                    <span className="mw-arrow">→</span>
                  </Link>
                  <Link to="/dashboard/provider/earnings" className="mw-shortcut">
                    <span className="mw-icon-box"><Wallet /></span>
                    <span><strong>Earnings & Payouts</strong><small>Review revenue and request payouts</small></span>
                    <span className="mw-arrow">→</span>
                  </Link>
                </div>
              </div>
            </div>
          </>
        )}

        {/* ───────────────────────────────────────────────────────────
            11. PROVIDER ONBOARDING (route === 'provider/onboarding')
            ─────────────────────────────────────────────────────────── */}
        {route === 'provider/onboarding' && (
          <div className="mw-panel mw-form-panel">
            <div className="mw-panel-head">
              <h3>Datacenter Provider Profile</h3>
              <StatusBadge>{providerSaved ? 'Draft saved' : 'Not submitted'}</StatusBadge>
            </div>
            {providerSaved ? (
              <div className="mw-success">
                <Check size={24} />
                <div>
                  <strong>Provider profile saved in browser state</strong>
                  <p>Your demo profile has been saved. Real hardware onboarding requires backend validation and SLA compliance verification.</p>
                </div>
                <button className="mw-secondary" onClick={() => setProviderSaved(false)}>
                  Edit Profile
                </button>
              </div>
            ) : (
              <form
                className="mw-form"
                onSubmit={(e) => {
                  e.preventDefault()
                  setProviderSaved(true)
                  flash('Provider profile saved locally.')
                }}
              >
                <label>
                  Company / Organization Name
                  <input
                    required
                    value={providerForm.company}
                    onChange={(e) => setProviderForm({ ...providerForm, company: e.target.value })}
                    placeholder="e.g. Yotta Sovereign Infrastructure Ltd"
                  />
                </label>
                <label>
                  Primary Infrastructure Contact
                  <input
                    required
                    value={providerForm.contact}
                    onChange={(e) => setProviderForm({ ...providerForm, contact: e.target.value })}
                    placeholder="Full Name"
                  />
                </label>
                <label>
                  Business Email
                  <input
                    required
                    type="email"
                    value={providerForm.email}
                    onChange={(e) => setProviderForm({ ...providerForm, email: e.target.value })}
                    placeholder="infra@datacenter.in"
                  />
                </label>
                <label>
                  Operating Regions
                  <input
                    value={providerForm.regions}
                    onChange={(e) => setProviderForm({ ...providerForm, regions: e.target.value })}
                    placeholder="Navi Mumbai, Delhi NCR"
                  />
                </label>
                <label>
                  Integration Mechanism
                  <select
                    value={providerForm.apiType}
                    onChange={(e) => setProviderForm({ ...providerForm, apiType: e.target.value })}
                  >
                    <option>REST API Adapter</option>
                    <option>vLLM Native Agent</option>
                    <option>Kubernetes DaemonSet</option>
                    <option>Manual Reservation</option>
                  </select>
                </label>
                <div className="mw-info-box">
                  <ShieldCheck size={18} />
                  <span>
                    No real secrets are exchanged in this demo. Production onboarding uses mTLS certificate authentication and hardware enclave verification.
                  </span>
                </div>
                <button className="mw-primary" type="submit">
                  Save Provider Profile
                </button>
              </form>
            )}
          </div>
        )}

        {/* ───────────────────────────────────────────────────────────
            12. PROVIDER GPU LISTINGS (route === 'provider/listings')
            ─────────────────────────────────────────────────────────── */}
        {route === 'provider/listings' && (
          <>
            <div className="mw-toolbar">
              <div>
                <h2>GPU Inventory & Listings</h2>
                <p>Publish, edit or pause GPU node allocations for marketplace tenants.</p>
              </div>
              <button className="mw-primary" onClick={() => setShowAddListing(!showAddListing)}>
                {showAddListing ? <X size={16} /> : <Plus size={16} />}
                {showAddListing ? 'Cancel' : 'Add GPU Listing'}
              </button>
            </div>

            {showAddListing && (
              <form className="mw-panel mw-form mw-listing-form" onSubmit={handleSaveListing}>
                <label>
                  GPU Model
                  <select
                    value={listingForm.gpu}
                    onChange={(e) => {
                      const v = e.target.value
                      setListingForm({
                        ...listingForm,
                        gpu: v,
                        vram: v.includes('L40S') ? '48 GB' : v.includes('H100') || v.includes('A100') ? '80 GB' : v.includes('H200') ? '141 GB' : '24 GB',
                      })
                    }}
                  >
                    <option>NVIDIA L4</option>
                    <option>NVIDIA L40S</option>
                    <option>NVIDIA A100</option>
                    <option>NVIDIA H100</option>
                    <option>NVIDIA H200</option>
                  </select>
                </label>
                <label>
                  VRAM
                  <input value={listingForm.vram} onChange={(e) => setListingForm({ ...listingForm, vram: e.target.value })} />
                </label>
                <label>
                  Region
                  <input required value={listingForm.region} onChange={(e) => setListingForm({ ...listingForm, region: e.target.value })} />
                </label>
                <label>
                  Quantity (Units)
                  <input type="number" min="1" required value={listingForm.quantity} onChange={(e) => setListingForm({ ...listingForm, quantity: e.target.value })} />
                </label>
                <label>
                  Hourly Rate (₹)
                  <input type="number" min="1" required value={listingForm.price} onChange={(e) => setListingForm({ ...listingForm, price: e.target.value })} />
                </label>
                <button className="mw-primary" type="submit">
                  Save Listing
                </button>
              </form>
            )}

            <div className="mw-panel">
              <div className="mw-table-wrap">
                <table className="mw-table">
                  <thead>
                    <tr>
                      <th>GPU Model</th>
                      <th>VRAM</th>
                      <th>Region</th>
                      <th>Quantity</th>
                      <th>Rate / hr</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {listings.map((l) => (
                      <tr key={l.id}>
                        <td>
                          <strong>{l.name}</strong>
                          <small>{l.id}</small>
                        </td>
                        <td>{l.vram}</td>
                        <td>{l.region}</td>
                        <td>{l.quantity}</td>
                        <td>{money(l.price)}</td>
                        <td><StatusBadge>{l.status}</StatusBadge></td>
                        <td>
                          <div className="mw-actions">
                            <button
                              onClick={() => {
                                setListings((prev) =>
                                  prev.map((x) => (x.id === l.id ? { ...x, status: x.status === 'Available' ? 'Paused' : 'Available' } : x))
                                )
                              }}
                            >
                              {l.status === 'Available' ? 'Pause' : 'Publish'}
                            </button>
                            <button
                              onClick={() => {
                                setListings((prev) =>
                                  prev.map((x) => (x.id === l.id ? { ...x, status: x.status === 'Maintenance' ? 'Available' : 'Maintenance' } : x))
                                )
                              }}
                            >
                              <Wrench size={13} />
                            </button>
                            <button onClick={() => setEditingListing(l)}>
                              Edit
                            </button>
                            <button
                              className="mw-danger"
                              onClick={() => setListings((prev) => prev.filter((x) => x.id !== l.id))}
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* ───────────────────────────────────────────────────────────
            13. PROVIDER CAPACITY & HEALTH (route === 'provider/capacity')
            ─────────────────────────────────────────────────────────── */}
        {route === 'provider/capacity' && (
          <>
            <div className="mw-stat-grid">
              <div className="mw-metric">
                <div className="mw-metric-top"><span>Total Nodes</span><span className="mw-icon-box"><Cpu /></span></div>
                <strong>{listings.reduce((s, l) => s + l.quantity, 0)} GPUs</strong>
              </div>
              <div className="mw-metric">
                <div className="mw-metric-top"><span>Available</span><span className="mw-icon-box"><Check /></span></div>
                <strong>{listings.filter((l) => l.status === 'Available').reduce((s, l) => s + l.quantity, 0)} GPUs</strong>
              </div>
              <div className="mw-metric">
                <div className="mw-metric-top"><span>Paused</span><span className="mw-icon-box"><Wrench /></span></div>
                <strong>{listings.filter((l) => l.status === 'Paused').reduce((s, l) => s + l.quantity, 0)} GPUs</strong>
              </div>
              <div className="mw-metric">
                <div className="mw-metric-top"><span>Maintenance</span><span className="mw-icon-box"><Activity /></span></div>
                <strong>{listings.filter((l) => l.status === 'Maintenance').reduce((s, l) => s + l.quantity, 0)} GPUs</strong>
              </div>
            </div>

            <div className="mw-panel">
              <div className="mw-panel-head">
                <h3>Capacity Allocation by Node</h3>
                <span className="mw-muted">Manage maintenance status</span>
              </div>
              {listings.map((l) => (
                <div className="mw-progress-row" key={l.id}>
                  <div>
                    <span>{l.name} · {l.region}</span>
                    <strong>{l.quantity} units · {l.status}</strong>
                  </div>
                  <div className="mw-progress">
                    <span
                      style={{
                        width: `${l.status === 'Available' ? 100 : l.status === 'Paused' ? 40 : 15}%`,
                        background: l.status === 'Maintenance' ? '#f59e0b' : undefined,
                      }}
                    />
                  </div>
                  <div className="mw-actions" style={{ marginTop: 8 }}>
                    <button onClick={() => {
                      setListings((prev) => prev.map((x) => (x.id === l.id ? { ...x, status: 'Available' } : x)))
                      addNotification({
                        title: `GPU Marked Available: ${l.name}`,
                        detail: `${l.name} (${l.gpu}) is now online and available in ${l.region}.`,
                        type: 'Marketplace',
                      })
                      flash(`GPU "${l.name}" set to Available.`)
                    }}>
                      Set Available
                    </button>
                    <button onClick={() => {
                      setListings((prev) => prev.map((x) => (x.id === l.id ? { ...x, status: 'Maintenance' } : x)))
                      addNotification({
                        title: `GPU In Maintenance: ${l.name}`,
                        detail: `${l.name} (${l.gpu}) shifted to scheduled maintenance.`,
                        type: 'Marketplace',
                      })
                      flash(`GPU "${l.name}" set to Maintenance.`)
                    }}>
                      Set Maintenance
                    </button>
                    <button onClick={() => {
                      setListings((prev) => prev.map((x) => (x.id === l.id ? { ...x, status: 'Paused' } : x)))
                      addNotification({
                        title: `GPU Listing Paused: ${l.name}`,
                        detail: `${l.name} lease requests paused by provider.`,
                        type: 'Marketplace',
                      })
                      flash(`GPU "${l.name}" listing paused.`)
                    }}>
                      Pause
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ───────────────────────────────────────────────────────────
            14. PROVIDER WORKLOADS (route === 'provider/workloads')
            ─────────────────────────────────────────────────────────── */}
        {route === 'provider/workloads' && (
          <div className="mw-panel">
            <div className="mw-panel-head">
              <h3>Allocated Tenant Workloads</h3>
              <span className="mw-muted">Simulated tenant streams</span>
            </div>
            <div className="mw-table-wrap">
              <table className="mw-table">
                <thead>
                  <tr>
                    <th>Workload Name</th>
                    <th>Model</th>
                    <th>GPU Model</th>
                    <th>Region</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {deployments.map((d) => (
                    <tr key={d.id}>
                      <td>
                        <strong>{d.name}</strong>
                        <small>{d.id}</small>
                      </td>
                      <td>{d.model}</td>
                      <td>{d.gpu}</td>
                      <td>{d.region}</td>
                      <td><StatusBadge>{d.status}</StatusBadge></td>
                      <td>
                        <button
                          className="mw-secondary"
                          onClick={() => setWorkloadTelemetry(d)}
                        >
                          Telemetry
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ───────────────────────────────────────────────────────────
            15. PROVIDER ANALYTICS (route === 'provider/analytics')
            ─────────────────────────────────────────────────────────── */}
        {route === 'provider/analytics' && (
          <>
            <div className="mw-stat-grid">
              <div className="mw-metric">
                <div className="mw-metric-top"><span>Cluster Utilization</span><span className="mw-icon-box"><Activity /></span></div>
                <strong>72%</strong>
              </div>
              <div className="mw-metric">
                <div className="mw-metric-top"><span>Uptime SLA</span><span className="mw-icon-box"><ShieldCheck /></span></div>
                <strong>99.96%</strong>
              </div>
              <div className="mw-metric">
                <div className="mw-metric-top"><span>Active Streams</span><span className="mw-icon-box"><Zap /></span></div>
                <strong>1,284</strong>
              </div>
              <div className="mw-metric">
                <div className="mw-metric-top"><span>Avg TTFT</span><span className="mw-icon-box"><TrendingUp /></span></div>
                <strong>38 ms</strong>
              </div>
            </div>

            <div className="mw-two-col">
              <div className="mw-panel">
                <div className="mw-panel-head">
                  <h3>Utilization by GPU Model</h3>
                  <span className="mw-muted">Sample telemetry</span>
                </div>
                {listings.map((l, i) => (
                  <div className="mw-progress-row" key={l.id}>
                    <div>
                      <span>{l.name}</span>
                      <strong>{[72, 54, 88, 64, 42][i % 5]}%</strong>
                    </div>
                    <div className="mw-progress">
                      <span style={{ width: `${[72, 54, 88, 64, 42][i % 5]}%` }} />
                    </div>
                  </div>
                ))}
              </div>

              <div className="mw-panel">
                <div className="mw-panel-head">
                  <h3>Provider Reliability Verification</h3>
                </div>
                {[
                  'Hardware health monitoring daemon installed',
                  'Sub-10ms network interconnect verified',
                  'Automated tenant isolation policies enabled',
                  'Zero data retention telemetry confirmed',
                ].map((item, idx) => (
                  <div className="mw-check-row" key={item}>
                    <Check size={16} />
                    <span>{item}</span>
                    <StatusBadge>{idx < 3 ? 'Verified' : 'Pending'}</StatusBadge>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* ───────────────────────────────────────────────────────────
            16. PROVIDER EARNINGS & PAYOUTS (route === 'provider/earnings')
            ─────────────────────────────────────────────────────────── */}
        {route === 'provider/earnings' && (
          <>
            <div className="mw-toolbar">
              <div>
                <h2>Earnings & Payouts</h2>
                <p>Track accrued revenue from marketplace capacity allocations and review payout records.</p>
              </div>
              <button className="mw-primary" onClick={() => setShowPayoutModal(true)}>
                <ArrowDownToLine size={16} /> Request Payout (Demo)
              </button>
            </div>

            <div className="mw-stat-grid">
              <div className="mw-metric">
                <div className="mw-metric-top"><span>Estimated Gross</span><span className="mw-icon-box"><CircleDollarSign /></span></div>
                <strong>₹2,84,400</strong>
              </div>
              <div className="mw-metric">
                <div className="mw-metric-top"><span>Platform Fee (12%)</span><span className="mw-icon-box"><TrendingUp /></span></div>
                <strong>₹34,128</strong>
              </div>
              <div className="mw-metric">
                <div className="mw-metric-top"><span>Net Payout</span><span className="mw-icon-box"><Wallet /></span></div>
                <strong>₹2,50,272</strong>
              </div>
              <div className="mw-metric">
                <div className="mw-metric-top"><span>Pending Payout</span><span className="mw-icon-box"><ArrowDownToLine /></span></div>
                <strong>₹72,000</strong>
              </div>
            </div>

            <div className="mw-panel">
              <div className="mw-panel-head">
                <h3>Payout History</h3>
                <span className="mw-muted">Settlement records</span>
              </div>
              <div className="mw-table-wrap">
                <table className="mw-table">
                  <thead>
                    <tr>
                      <th>Settlement ID</th>
                      <th>Billing Period</th>
                      <th>Gross Inflow</th>
                      <th>Platform Fee</th>
                      <th>Net Disbursed</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ['PO-2026-09', 'Sep 2026', '₹1,10,000', '₹13,200', '₹96,800', 'Paid'],
                      ['PO-2026-10', 'Oct 2026', '₹72,000', '₹8,640', '₹63,360', 'Pending'],
                    ].map((row) => (
                      <tr key={row[0]}>
                        <td><strong>{row[0]}</strong></td>
                        <td>{row[1]}</td>
                        <td>{row[2]}</td>
                        <td>{row[3]}</td>
                        <td>{row[4]}</td>
                        <td><StatusBadge>{row[5]}</StatusBadge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mw-footnote">Figures represent fictional UI simulations for evaluation purposes.</p>
            </div>
          </>
        )}

        {/* ───────────────────────────────────────────────────────────
            17. PROVIDER INTEGRATIONS (route === 'provider/integrations')
            ─────────────────────────────────────────────────────────── */}
        {route === 'provider/integrations' && (
          <>
            <div className="mw-panel">
              <div className="mw-panel-head">
                <h3>Adapter Integrations</h3>
                <StatusBadge>Demo mode</StatusBadge>
              </div>
              {[
                { name: 'Provider REST Adapter', detail: 'Contract defined in OpenAPI specifications', status: 'Not connected' },
                { name: 'Telemetry Streaming WebSocket', detail: 'Real-time TTFT and throughput synchronization', status: 'Not connected' },
                { name: 'Automated Node Provisioner', detail: 'Container daemon for dynamic scaling', status: 'Not connected' },
              ].map((x) => (
                <div className="mw-list-row" key={x.name}>
                  <span className="mw-icon-box"><Settings2 size={18} /></span>
                  <div className="mw-list-main">
                    <strong>{x.name}</strong>
                    <small>{x.detail}</small>
                  </div>
                  <StatusBadge>{x.status}</StatusBadge>
                  <button
                    className="mw-secondary"
                    onClick={() => flash('Integration setup requires backend credentials and provider adapter implementation.')}
                  >
                    Configure
                  </button>
                </div>
              ))}
            </div>

            <div className="mw-panel">
              <div className="mw-panel-head">
                <h3>Maintenance Configuration</h3>
              </div>
              <div style={{ padding: 18 }}>
                <p className="muted" style={{ margin: 0, fontSize: '0.8rem', lineHeight: 1.6 }}>
                  Mark listings under maintenance or adjust scheduled downtime in the{' '}
                  <Link to="/dashboard/provider/capacity" style={{ color: 'var(--brand-hi)' }}>Capacity Management</Link>{' '}
                  tab. Maintenance states are propagated instantly to avoid routing tenant requests to offline nodes.
                </p>
              </div>
            </div>
          </>
        )}

        {/* ───────────────────────────────────────────────────────────
            18. GPU COMPARISON MATRIX (route === 'compare')
            ─────────────────────────────────────────────────────────── */}
        {route === 'compare' && (
          <>
            <div className="mw-toolbar">
              <div>
                <h2>GPU Hardware Comparison Matrix</h2>
                <p>Side-by-side evaluation of memory capacity, memory bandwidth, pricing, and inference throughput.</p>
              </div>
              <div className="row" style={{ gap: 8 }}>
                <button className="mw-secondary" onClick={() => setComparedGpuIds(listings.map((l) => l.id))}>
                  Compare All ({listings.length})
                </button>
                <button className="mw-primary" onClick={() => navigate('/dashboard/gpus')}>
                  Browse Marketplace
                </button>
              </div>
            </div>

            <div className="mw-panel">
              <div className="mw-table-wrap">
                <table className="mw-table mw-compare-table">
                  <thead>
                    <tr>
                      <th style={{ width: 180 }}>Specification</th>
                      {(comparedGpuIds.length > 0 ? listings.filter((l) => comparedGpuIds.includes(l.id)) : listings.slice(0, 4)).map((g) => (
                        <th key={g.id}>
                          <strong>{g.name}</strong>
                          <small>{g.region}</small>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td><strong>VRAM Memory</strong></td>
                      {(comparedGpuIds.length > 0 ? listings.filter((l) => comparedGpuIds.includes(l.id)) : listings.slice(0, 4)).map((g) => (
                        <td key={g.id}><strong style={{ color: 'var(--brand-hi)' }}>{g.vram}</strong></td>
                      ))}
                    </tr>
                    <tr>
                      <td><strong>Architecture</strong></td>
                      {(comparedGpuIds.length > 0 ? listings.filter((l) => comparedGpuIds.includes(l.id)) : listings.slice(0, 4)).map((g) => (
                        <td key={g.id}>{g.arch || 'NVIDIA Hopper/Ada'}</td>
                      ))}
                    </tr>
                    <tr>
                      <td><strong>Memory Bandwidth</strong></td>
                      {(comparedGpuIds.length > 0 ? listings.filter((l) => comparedGpuIds.includes(l.id)) : listings.slice(0, 4)).map((g) => (
                        <td key={g.id}>{g.bandwidth || '2,000+ GB/s'}</td>
                      ))}
                    </tr>
                    <tr>
                      <td><strong>Hourly Rate (Spot)</strong></td>
                      {(comparedGpuIds.length > 0 ? listings.filter((l) => comparedGpuIds.includes(l.id)) : listings.slice(0, 4)).map((g) => (
                        <td key={g.id}><strong style={{ color: 'var(--ink)' }}>{money(g.price)}/hr</strong></td>
                      ))}
                    </tr>
                    <tr>
                      <td><strong>Est. Monthly (730h)</strong></td>
                      {(comparedGpuIds.length > 0 ? listings.filter((l) => comparedGpuIds.includes(l.id)) : listings.slice(0, 4)).map((g) => (
                        <td key={g.id}>{money(g.price * 730)}</td>
                      ))}
                    </tr>
                    <tr>
                      <td><strong>Target Workloads</strong></td>
                      {(comparedGpuIds.length > 0 ? listings.filter((l) => comparedGpuIds.includes(l.id)) : listings.slice(0, 4)).map((g) => (
                        <td key={g.id} style={{ fontSize: '0.74rem', color: 'var(--ink-3)' }}>
                          {g.name.includes('H100') || g.name.includes('H200')
                            ? '70B+ Frontier Models (Llama 3.1 70B, DeepSeek R1)'
                            : g.name.includes('L40S')
                              ? 'Medium LLMs (Qwen 14B/32B, Mistral NeMo)'
                              : 'Efficient Serving (Qwen 7B, Llama 8B, Gemma 2)'}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <td><strong>Est. Throughput</strong></td>
                      {(comparedGpuIds.length > 0 ? listings.filter((l) => comparedGpuIds.includes(l.id)) : listings.slice(0, 4)).map((g) => (
                        <td key={g.id}>
                          <span className="chip chip--lime">
                            {g.name.includes('H100') ? '~140 tok/s' : g.name.includes('H200') ? '~165 tok/s' : g.name.includes('L40S') ? '~95 tok/s' : '~65 tok/s'}
                          </span>
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <td><strong>Deploy</strong></td>
                      {(comparedGpuIds.length > 0 ? listings.filter((l) => comparedGpuIds.includes(l.id)) : listings.slice(0, 4)).map((g) => (
                        <td key={g.id}>
                          <button
                            className="mw-primary"
                            style={{ minHeight: 32, fontSize: '0.74rem', padding: '4px 10px' }}
                            onClick={() => {
                              setDeployForm((f) => ({ ...f, gpu: g.gpu, region: g.region }))
                              setShowDeployModal(true)
                            }}
                          >
                            Deploy Now
                          </button>
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* ───────────────────────────────────────────────────────────
            19. GPU SPOT PRICE HISTORY (route === 'price-history')
            ─────────────────────────────────────────────────────────── */}
        {route === 'price-history' && (
          <>
            <div className="mw-toolbar">
              <div>
                <h2>GPU Spot Price History & Trends</h2>
                <p>Track historical hourly compute rates across sovereign Indian datacenters.</p>
              </div>
            </div>

            <InteractivePriceHistoryChart
              gpu={priceHistoryGpu}
              range={priceHistoryRange}
              onGpuChange={(g) => setPriceHistoryGpu(g)}
              onRangeChange={(r) => setPriceHistoryRange(r)}
            />
          </>
        )}

        {/* ───────────────────────────────────────────────────────────
            20. INFERENCE PLAYGROUND (route === 'playground')
            ─────────────────────────────────────────────────────────── */}
        {route === 'playground' && (
          <>
            <div className="mw-toolbar">
              <div>
                <h2>Inference Playground Sandbox</h2>
                <p>Test prompt generation, measure time-to-first-token (TTFT), and evaluate model responses in real-time.</p>
              </div>
              <div className="row" style={{ gap: 8 }}>
                <button className="mw-secondary" onClick={() => setPlaygroundOutput('')}>
                  Clear Output
                </button>
                <button className="mw-primary" onClick={handleRunPlayground} disabled={playgroundStreaming}>
                  <Play size={14} /> {playgroundStreaming ? 'Generating...' : 'Run Inference'}
                </button>
              </div>
            </div>

            <div className="mw-playground-layout">
              {/* Left Column: Config & Input */}
              <div className="mw-panel mw-playground-form">
                <div className="mw-panel-head">
                  <h3>Model & Hyperparameters</h3>
                  <StatusBadge>{playgroundStreaming ? 'Streaming' : 'Ready'}</StatusBadge>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.76rem', color: 'var(--ink-3)' }}>
                    Serving Model
                    <select
                      value={playgroundModel}
                      onChange={(e) => setPlaygroundModel(e.target.value)}
                      className="mw-select"
                    >
                      <option>Qwen2.5 7B Instruct</option>
                      <option>Llama 3.1 8B Instruct</option>
                      <option>DeepSeek V3 (Reasoning)</option>
                      <option>Mistral 7B Instruct v0.3</option>
                    </select>
                  </label>

                  <div>
                    <span style={{ fontSize: '0.74rem', color: 'var(--ink-3)', display: 'block', marginBottom: 6 }}>
                      Prompt Templates
                    </span>
                    <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                      {[
                        ['Code Gen', 'Write a Python FastAPI service for streaming Server-Sent Events with vLLM client.'],
                        ['Math & Logic', 'If 5 GPUs can process 400 requests in 2 minutes, how many GPUs are needed for 2400 requests in 3 minutes?'],
                        ['Customer AI', 'Draft a polite support response explaining how to rotate API keys without downtime.'],
                      ].map(([label, promptText]) => (
                        <button
                          key={String(label)}
                          type="button"
                          className="mw-filter-pill"
                          onClick={() => setPlaygroundPrompt(String(promptText))}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.76rem', color: 'var(--ink-3)' }}>
                    Prompt
                    <textarea
                      rows={5}
                      value={playgroundPrompt}
                      onChange={(e) => setPlaygroundPrompt(e.target.value)}
                      placeholder="Enter user prompt or system instruction..."
                      style={{ padding: '10px', background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 8, color: 'var(--ink)', resize: 'vertical' }}
                    />
                  </label>

                  <div className="grid grid--2" style={{ gap: 12 }}>
                    <div>
                      <div className="mw-slider-header" style={{ marginBottom: 4 }}>
                        <span style={{ fontSize: '0.72rem', color: 'var(--ink-3)' }}>Temperature</span>
                        <strong style={{ fontSize: '0.72rem', color: 'var(--brand-hi)' }}>{playgroundTemp}</strong>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={playgroundTemp}
                        onChange={(e) => setPlaygroundTemp(Number(e.target.value))}
                        style={{ width: '100%' }}
                      />
                    </div>
                    <div>
                      <div className="mw-slider-header" style={{ marginBottom: 4 }}>
                        <span style={{ fontSize: '0.72rem', color: 'var(--ink-3)' }}>Max Tokens</span>
                        <strong style={{ fontSize: '0.72rem', color: 'var(--brand-hi)' }}>{playgroundMaxTokens}</strong>
                      </div>
                      <input
                        type="range"
                        min="64"
                        max="2048"
                        step="64"
                        value={playgroundMaxTokens}
                        onChange={(e) => setPlaygroundMaxTokens(Number(e.target.value))}
                        style={{ width: '100%' }}
                      />
                    </div>
                  </div>

                  <div className="row" style={{ gap: 8, marginTop: 4 }}>
                    <button className="mw-primary mw-full" onClick={handleRunPlayground} disabled={playgroundStreaming}>
                      <Play size={14} /> Run Model Inference
                    </button>
                  </div>
                </div>
              </div>

              {/* Right Column: Output Console */}
              <div className="mw-panel mw-playground-output">
                <div className="mw-panel-head">
                  <h3>Generated Token Stream</h3>
                  <div className="row" style={{ gap: 8 }}>
                    {playgroundOutput && (
                      <button
                        className="mw-secondary"
                        onClick={() => {
                          navigator.clipboard?.writeText(playgroundOutput)
                          flash('Inference response copied to clipboard!')
                        }}
                      >
                        <Copy size={13} /> Copy Output
                      </button>
                    )}
                  </div>
                </div>

                {/* Metrics Bar */}
                <div className="row" style={{ gap: 12, padding: '8px 14px', background: 'var(--bg-2)', borderBottom: '1px solid var(--line-2)', fontSize: '0.72rem', color: 'var(--ink-3)' }}>
                  <span>TTFT: <strong style={{ color: 'var(--brand-hi)' }}>{playgroundMetrics.ttft}s</strong></span>
                  <span>Throughput: <strong style={{ color: 'var(--brand-hi)' }}>{playgroundMetrics.speed} tok/s</strong></span>
                  <span>Tokens: <strong style={{ color: 'var(--ink)' }}>{playgroundMetrics.tokens}</strong></span>
                  <span>Model: <strong style={{ color: 'var(--ink)' }}>{playgroundModel}</strong></span>
                </div>

                <div className="mw-console-box">
                  {playgroundOutput ? (
                    <pre style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: '0.82rem', whiteSpace: 'pre-wrap', lineHeight: 1.6, color: 'var(--ink)' }}>
                      {playgroundOutput}
                      {playgroundStreaming && <span className="mw-cursor-blink">▌</span>}
                    </pre>
                  ) : (
                    <div className="mw-empty" style={{ padding: '40px 20px' }}>
                      <Terminal size={26} />
                      <h3>Playground Output Ready</h3>
                      <p>Type a prompt and click "Run Inference" to stream response tokens.</p>
                    </div>
                  )}
                </div>

                {/* Recent History */}
                <div style={{ padding: '12px 16px', borderTop: '1px solid var(--line-2)' }}>
                  <span style={{ fontSize: '0.72rem', color: 'var(--ink-4)', display: 'block', marginBottom: 6 }}>Recent Playground Prompts</span>
                  <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                    {playgroundHistory.map((h, i) => (
                      <span
                        key={i}
                        className="chip"
                        style={{ cursor: 'pointer', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        onClick={() => setPlaygroundPrompt(h.prompt)}
                        title={h.prompt}
                      >
                        {h.prompt}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {/* ───────────────────────────────────────────────────────────
            21. SSH PUBLIC KEYS (route === 'ssh-keys')
            ─────────────────────────────────────────────────────────── */}
        {route === 'ssh-keys' && (
          <>
            <div className="mw-toolbar">
              <div>
                <h2>SSH Public Keys Vault</h2>
                <p>Register public keys to enable secure terminal and container shell pairing with dedicated GPU nodes.</p>
              </div>
              <button className="mw-primary" onClick={() => setShowAddSshModal(true)}>
                <Plus size={16} /> Add Public SSH Key
              </button>
            </div>

            <div className="mw-info-box" style={{ marginBottom: 16 }}>
              <ShieldCheck size={18} />
              <span>
                <strong>Sovereign Security Notice:</strong> Never upload private keys. Only public key pairs (e.g., id_ed25519.pub) are accepted. Public keys are stored locally in your browser demo session.
              </span>
            </div>

            <div className="mw-panel">
              <div className="mw-panel-head">
                <h3>Registered Public Keys</h3>
                <span className="mw-muted">{sshKeys.length} keys</span>
              </div>

              {sshKeys.length === 0 ? (
                <div className="mw-empty">
                  <span className="mw-icon-box"><KeyRound size={22} /></span>
                  <h3>No SSH Keys Configured</h3>
                  <p>Add a public key to pair with GPU container shells.</p>
                  <button className="mw-primary" onClick={() => setShowAddSshModal(true)}>
                    Add Public Key
                  </button>
                </div>
              ) : (
                <div className="mw-table-wrap">
                  <table className="mw-table">
                    <thead>
                      <tr>
                        <th>Key Label</th>
                        <th>Fingerprint</th>
                        <th>Public Key Snippet</th>
                        <th>Added Date</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sshKeys.map((k) => (
                        <tr key={k.id}>
                          <td>
                            <strong>{k.name}</strong>
                            <small>{k.id}</small>
                          </td>
                          <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.74rem', color: 'var(--brand-hi)' }}>
                            {k.fingerprint}
                          </td>
                          <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--ink-4)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {k.key}
                          </td>
                          <td>{k.addedDate}</td>
                          <td>
                            <div className="mw-actions">
                              <button
                                onClick={() => {
                                  navigator.clipboard?.writeText(k.key)
                                  flash('Public SSH key copied to clipboard.')
                                }}
                              >
                                <Copy size={13} /> Copy
                              </button>
                              <button
                                className="mw-danger"
                                onClick={() => setSshKeyToDelete(k)}
                              >
                                <Trash2 size={13} /> Remove
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}

        {/* ───────────────────────────────────────────────────────────
            22. ORDERS & COMPUTE HISTORY (route === 'orders')
            ─────────────────────────────────────────────────────────── */}
        {route === 'orders' && (
          <>
            <div className="mw-toolbar">
              <div>
                <h2>Orders & Compute History</h2>
                <p>Track historical and active GPU instance reservations, durations, and estimated expenditures.</p>
              </div>
              <button className="mw-primary" onClick={() => navigate('/dashboard/checkout')}>
                <Plus size={16} /> New Compute Order
              </button>
            </div>

            {/* Filter Tabs */}
            <div className="mw-filter-bar">
              {(['All', 'Running', 'Completed', 'Cancelled', 'Archived'] as const).map((tab) => (
                <button
                  key={tab}
                  className={`mw-filter-pill ${orderTab === tab ? 'is-active' : ''}`}
                  onClick={() => setOrderTab(tab)}
                >
                  {tab} ({orders.filter((o) => (tab === 'All' ? true : o.status === tab)).length})
                </button>
              ))}
            </div>

            <div className="mw-panel">
              <div className="mw-table-wrap">
                <table className="mw-table">
                  <thead>
                    <tr>
                      <th>Order ID</th>
                      <th>Workload / Hardware</th>
                      <th>Datacenter Facility</th>
                      <th>Order Date</th>
                      <th>Duration</th>
                      <th>Estimated Cost</th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders
                      .filter((o) => (orderTab === 'All' ? true : o.status === orderTab))
                      .map((ord) => (
                        <tr key={ord.id}>
                          <td><strong>{ord.id}</strong></td>
                          <td>{ord.modelOrGpu}</td>
                          <td>{ord.provider}</td>
                          <td>{ord.date}</td>
                          <td>{ord.duration}</td>
                          <td><strong style={{ color: 'var(--ink)' }}>{money(ord.cost)}</strong></td>
                          <td><StatusBadge>{ord.status}</StatusBadge></td>
                          <td>
                            <button className="mw-secondary" onClick={() => setSelectedOrder(ord)}>
                              View Details
                            </button>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* ───────────────────────────────────────────────────────────
            23. PAYMENT & CHECKOUT (route === 'checkout')
            ─────────────────────────────────────────────────────────── */}
        {route === 'checkout' && (
          <>
            <div className="mw-toolbar">
              <div>
                <h2>Payment & Checkout Simulation</h2>
                <p>Configure dedicated compute duration, apply promotional discount coupons, and simulate reservation.</p>
              </div>
              <button className="mw-secondary" onClick={() => navigate('/dashboard/orders')}>
                View Orders History
              </button>
            </div>

            <div className="mw-two-col">
              {/* Left Column: Order Configuration */}
              <div className="mw-panel mw-form-panel">
                <div className="mw-panel-head">
                  <h3>Hardware Configuration</h3>
                  <StatusBadge>Demo checkout</StatusBadge>
                </div>

                <div className="mw-form">
                  <label>
                    Select GPU Listing
                    <select
                      value={checkoutGpuId}
                      onChange={(e) => setCheckoutGpuId(e.target.value)}
                      className="mw-select"
                    >
                      {listings.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name} ({l.vram}) · {l.region} · {money(l.price)}/hr
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    Reservation Duration (Hours)
                    <div className="row" style={{ gap: 6 }}>
                      {[4, 12, 24, 72, 168].map((h) => (
                        <button
                          key={h}
                          type="button"
                          className={`mw-filter-pill ${checkoutDuration === h ? 'is-active' : ''}`}
                          onClick={() => setCheckoutDuration(h)}
                        >
                          {h} Hours {h === 168 ? '(1 Wk)' : ''}
                        </button>
                      ))}
                    </div>
                  </label>

                  {/* Coupon Code Input */}
                  <div>
                    <label style={{ fontSize: '0.76rem', color: 'var(--ink-3)', display: 'block', marginBottom: 6 }}>
                      Promotional Coupon / Discount Code
                    </label>
                    <form className="mw-coupon-input-wrap" onSubmit={handleApplyCoupon}>
                      <input
                        value={checkoutCoupon}
                        onChange={(e) => setCheckoutCoupon(e.target.value)}
                        placeholder="e.g. INFERXE10 or LAUNCH50"
                        style={{ textTransform: 'uppercase' }}
                      />
                      <button type="submit" className="mw-secondary">
                        Apply Code
                      </button>
                    </form>
                    {appliedCoupon && (
                      <div className="chip chip--lime" style={{ marginTop: 8, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <Check size={12} /> Coupon <strong>{appliedCoupon.code}</strong> applied ({appliedCoupon.percent ? `${appliedCoupon.percent}% off` : '₹500 off'})
                        <button
                          type="button"
                          onClick={() => setAppliedCoupon(null)}
                          style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: 0 }}
                        >
                          <X size={12} />
                        </button>
                      </div>
                    )}
                    {couponError && (
                      <small style={{ color: '#ef4444', display: 'block', marginTop: 6 }}>{couponError}</small>
                    )}
                  </div>

                  {/* Payment Method */}
                  <div>
                    <label style={{ fontSize: '0.76rem', color: 'var(--ink-3)', display: 'block', marginBottom: 6 }}>
                      Payment Method
                    </label>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <label className="mw-toggle-label" style={{ border: '1px solid var(--line-2)', borderRadius: 8, padding: 10 }}>
                        <span>
                          <strong>Prepaid Wallet Balance</strong>
                          <small>Available Credits: {money(walletBalance)}</small>
                        </span>
                        <input
                          type="radio"
                          name="payMethod"
                          checked={checkoutPaymentMethod === 'wallet'}
                          onChange={() => setCheckoutPaymentMethod('wallet')}
                        />
                      </label>
                      <label className="mw-toggle-label" style={{ border: '1px solid var(--line-2)', borderRadius: 8, padding: 10 }}>
                        <span>
                          <strong>Corporate Credit Card</strong>
                          <small>•••• •••• •••• 4092 (Simulated)</small>
                        </span>
                        <input
                          type="radio"
                          name="payMethod"
                          checked={checkoutPaymentMethod === 'card'}
                          onChange={() => setCheckoutPaymentMethod('card')}
                        />
                      </label>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Column: Order Summary & Checkout Action */}
              <div className="mw-panel">
                <div className="mw-panel-head">
                  <h3>Order Cost Summary</h3>
                  <StatusBadge>INR Breakdown</StatusBadge>
                </div>

                {(() => {
                  const selectedGpu = listings.find((l) => l.id === checkoutGpuId) || listings[0]
                  const baseCost = selectedGpu.price * checkoutDuration
                  let discount = 0
                  if (appliedCoupon?.percent) discount = Math.round((baseCost * appliedCoupon.percent) / 100)
                  else if (appliedCoupon?.flat) discount = Math.min(baseCost, appliedCoupon.flat)
                  const taxable = Math.max(0, baseCost - discount)
                  const tax = Math.round(taxable * 0.18)
                  const total = taxable + tax

                  return (
                    <div style={{ padding: 16 }}>
                      <div className="mw-calc-box" style={{ marginBottom: 14 }}>
                        <span>Selected Hardware</span>
                        <strong>{selectedGpu.name} ({selectedGpu.vram})</strong>
                        <small style={{ color: 'var(--ink-4)', display: 'block', marginTop: 2 }}>{selectedGpu.region} · {checkoutDuration} Hours Reservation</small>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, borderBottom: '1px solid var(--line-2)', paddingBottom: 14 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--ink-2)', fontSize: '0.84rem' }}>
                          <span>Base Compute Rate ({money(selectedGpu.price)} × {checkoutDuration}h)</span>
                          <span>{money(baseCost)}</span>
                        </div>
                        {discount > 0 && (
                          <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--brand-hi)', fontSize: '0.84rem' }}>
                            <span>Promotional Discount ({appliedCoupon?.code})</span>
                            <span>−{money(discount)}</span>
                          </div>
                        )}
                        <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--ink-3)', fontSize: '0.82rem' }}>
                          <span>CGST + SGST (18%)</span>
                          <span>+{money(tax)}</span>
                        </div>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 0', fontSize: '1.05rem' }}>
                        <strong>Total Amount Payable</strong>
                        <strong style={{ color: 'var(--brand-hi)', fontSize: '1.25rem' }}>{money(total)}</strong>
                      </div>

                      <div className="mw-info-box" style={{ marginBottom: 16 }}>
                        <ShieldCheck size={16} />
                        <span>Simulated checkout. No real currency is transferred. Order will be recorded to your demo Orders ledger.</span>
                      </div>

                      <button
                        className="mw-primary mw-full"
                        onClick={handleSimulatePayment}
                        disabled={checkoutState === 'processing'}
                        style={{ minHeight: 44, fontSize: '0.92rem' }}
                      >
                        {checkoutState === 'processing' ? 'Processing Reservation...' : `Pay & Reserve (${money(total)})`}
                      </button>

                      {checkoutReceipt && (
                        <div style={{ marginTop: 14, padding: 12, background: 'rgba(118,185,0,0.08)', border: '1px solid var(--brand)', borderRadius: 8 }}>
                          <div className="row" style={{ gap: 6, alignItems: 'center', color: 'var(--brand-hi)', marginBottom: 4 }}>
                            <Check size={16} /> <strong>Order {checkoutReceipt.orderId} Confirmed!</strong>
                          </div>
                          <p style={{ margin: 0, fontSize: '0.76rem', color: 'var(--ink-2)' }}>
                            Your reservation is now active. You can monitor streaming endpoints in{' '}
                            <Link to="/dashboard/orders" style={{ color: 'var(--brand-hi)', fontWeight: 600 }}>Orders</Link>.
                            When it completes, rate it and leave a note on the{' '}
                            <Link to="/dashboard/reviews" style={{ color: 'var(--brand-hi)', fontWeight: 600 }}>Reviews page</Link>.
                          </p>
                        </div>
                      )}
                    </div>
                  )
                })()}
              </div>
            </div>
          </>
        )}

        {/* ───────────────────────────────────────────────────────────
            24. WALLET & CREDITS (route === 'wallet')
            ─────────────────────────────────────────────────────────── */}
        {route === 'wallet' && (
          <>
            <div className="mw-toolbar">
              <div>
                <h2>Prepaid Wallet & Credit Ledger</h2>
                <p>Manage prepaid inference credits, monitor consumption, and inspect invoices.</p>
              </div>
              <button className="mw-primary" onClick={() => setShowTopUpModal(true)}>
                <Plus size={16} /> Top Up Balance (Demo)
              </button>
            </div>

            <div className="mw-stat-grid">
              <div className="mw-metric">
                <div className="mw-metric-top"><span>Available Balance</span><span className="mw-icon-box"><Wallet /></span></div>
                <strong>{money(walletBalance)}</strong>
                <small style={{ color: 'var(--brand-hi)' }}>Prepaid balance</small>
              </div>
              <div className="mw-metric">
                <div className="mw-metric-top"><span>Current Month Usage</span><span className="mw-icon-box"><CircleDollarSign /></span></div>
                <strong>₹4,820</strong>
                <small>48% of ₹10,000 monthly limit</small>
              </div>
              <div className="mw-metric">
                <div className="mw-metric-top"><span>Pending Invoices</span><span className="mw-icon-box"><ArrowDownToLine /></span></div>
                <strong>1</strong>
                <small>Generated on 01 Oct 2026</small>
              </div>
              <div className="mw-metric">
                <div className="mw-metric-top"><span>Next Billing Cycle</span><span className="mw-icon-box"><Bell /></span></div>
                <strong>01 Nov 2026</strong>
                <small>Auto-invoicing enabled</small>
              </div>
            </div>

            <div className="mw-panel">
              <div className="mw-panel-head">
                <h3>Transaction History</h3>
                <span className="mw-muted">{transactions.length} recorded</span>
              </div>
              <div className="mw-table-wrap">
                <table className="mw-table">
                  <thead>
                    <tr>
                      <th>Reference ID</th>
                      <th>Description</th>
                      <th>Date</th>
                      <th>Amount</th>
                      <th>Status</th>
                      <th>Invoice</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map((tx) => (
                      <tr key={tx.id}>
                        <td><strong>{tx.id}</strong></td>
                        <td>{tx.desc}</td>
                        <td>{tx.date}</td>
                        <td style={{ color: tx.isCredit ? 'var(--brand-hi)' : 'var(--ink)' }}>
                          {tx.isCredit ? `+${money(tx.amount)}` : `−${money(tx.amount)}`}
                        </td>
                        <td><StatusBadge>{tx.status}</StatusBadge></td>
                        <td>
                          <button className="mw-link-btn" onClick={() => setViewInvoiceItem(tx)}>
                            View Invoice
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* ───────────────────────────────────────────────────────────
            25. SAVED HARDWARE WISHLIST (route === 'wishlist')
            ─────────────────────────────────────────────────────────── */}
        {route === 'wishlist' && (
          <>
            <div className="mw-toolbar">
              <div>
                <h2>Saved Hardware Wishlist</h2>
                <p>Bookmarked GPU instances saved for instant comparison and deployment.</p>
              </div>
              <button className="mw-primary" onClick={() => navigate('/dashboard/gpus')}>
                Browse Marketplace
              </button>
            </div>

            {wishlist.length === 0 ? (
              <div className="mw-panel">
                <div className="mw-empty">
                  <span className="mw-icon-box"><Heart size={24} /></span>
                  <h3>Your Wishlist is Empty</h3>
                  <p>Browse the GPU Marketplace and click the heart icon on any instance card to bookmark it.</p>
                  <button className="mw-primary" onClick={() => navigate('/dashboard/gpus')}>
                    Explore GPU Marketplace
                  </button>
                </div>
              </div>
            ) : (
              <div className="mw-card-grid">
                {listings
                  .filter((item) => wishlist.includes(item.id))
                  .map((item) => (
                    <article className="mw-gpu-card" key={item.id}>
                      <div className="mw-gpu-card__top">
                        <span className="mw-icon-box"><Cpu size={20} /></span>
                        <div className="row" style={{ gap: 6, alignItems: 'center' }}>
                          <StatusBadge>{item.status}</StatusBadge>
                          <button
                            className="mw-icon-btn mw-wish-btn is-active"
                            onClick={() => toggleWishlist(item.id)}
                            title="Remove from Wishlist"
                            aria-label="Remove from Wishlist"
                          >
                            <Heart size={14} fill="#ef4444" color="#ef4444" />
                          </button>
                        </div>
                      </div>

                      <h3>{item.name}</h3>
                      <p>{item.vram} VRAM · {item.region}</p>

                      <div className="mw-gpu-specs">
                        <span>
                          <small>Inventory</small>
                          <strong>{item.quantity} GPUs</strong>
                        </span>
                        <span>
                          <small>Hourly Rate</small>
                          <strong>{money(item.price)}/hr</strong>
                        </span>
                      </div>

                      <div className="row" style={{ gap: 8, marginTop: 12 }}>
                        <button
                          className="mw-primary"
                          style={{ flex: 1 }}
                          onClick={() => {
                            setDeployForm((f) => ({ ...f, gpu: item.gpu, region: item.region }))
                            setShowDeployModal(true)
                          }}
                        >
                          Select & Deploy <span>→</span>
                        </button>
                        <button
                          className="mw-secondary"
                          onClick={() => toggleWishlist(item.id)}
                        >
                          Remove
                        </button>
                      </div>
                    </article>
                  ))}
              </div>
            )}
          </>
        )}

        {/* ───────────────────────────────────────────────────────────
            26. USER PROFILE & ORGANIZATION (route === 'profile')
            ─────────────────────────────────────────────────────────── */}
        {route === 'profile' && (
          <>
            <div className="mw-toolbar">
              <div>
                <h2>Profile & Security Settings</h2>
                <p>Manage identity credentials, change account password, tenant organization settings, and inspect security tokens.</p>
              </div>
              <button className="mw-secondary" onClick={() => setShowJwtModal(true)}>
                <ShieldCheck size={15} /> Inspect JWT Session Token
              </button>
            </div>

            <div className="mw-two-col">
              <div className="mw-panel mw-form-panel">
                <div className="mw-panel-head">
                  <h3>Profile Credentials</h3>
                  <StatusBadge>Verified Tenant</StatusBadge>
                </div>

                <form className="mw-form" onSubmit={handleSaveProfile}>
                  <div className="row" style={{ gap: 14, alignItems: 'center', marginBottom: 12 }}>
                    <div className="topbar__avatar" style={{ width: 52, height: 52, fontSize: '1.1rem' }}>
                      {profileAvatar}
                    </div>
                    <div>
                      <strong>{profileName}</strong>
                      <small style={{ display: 'block', color: 'var(--ink-4)' }}>{profileOrg}</small>
                    </div>
                  </div>

                  <label>
                    Full Name
                    <input
                      required
                      value={profileName}
                      onChange={(e) => {
                        setProfileName(e.target.value)
                        const parts = e.target.value.trim().split(' ')
                        if (parts.length >= 2) setProfileAvatar((parts[0][0] + parts[1][0]).toUpperCase())
                        else if (parts.length === 1 && parts[0]) setProfileAvatar(parts[0].slice(0, 2).toUpperCase())
                      }}
                    />
                  </label>

                  <label>
                    Work Email
                    <input
                      required
                      type="email"
                      value={profileEmail}
                      onChange={(e) => setProfileEmail(e.target.value)}
                    />
                  </label>

                  <label>
                    Organization Name
                    <input
                      required
                      value={profileOrg}
                      onChange={(e) => setProfileOrg(e.target.value)}
                    />
                  </label>

                  <label>
                    Access Role
                    <input
                      disabled
                      value="Customer Tenant / Infrastructure Operator"
                      style={{ opacity: 0.7 }}
                    />
                  </label>

                  <div className="row" style={{ gap: 10, marginTop: 8 }}>
                    <button className="mw-primary" type="submit">
                      Save Profile Changes
                    </button>
                  </div>
                </form>
              </div>

              <ChangePasswordCard userEmail={profileEmail} flash={flash} />
            </div>

            <div className="mw-panel" style={{ marginTop: 14 }}>
              <div className="mw-panel-head">
                <h3>Sovereign Tenant Security & Enclave Status</h3>
                <StatusBadge>Local Enclave</StatusBadge>
              </div>
              <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
                  <div className="mw-check-row">
                    <Check size={16} />
                    <span>Two-Factor Authentication (TOTP) Enabled</span>
                    <StatusBadge>Active</StatusBadge>
                  </div>
                  <div className="mw-check-row">
                    <Check size={16} />
                    <span>Zero Cross-Border Data Transfer Enforced</span>
                    <StatusBadge>MeitY SLA</StatusBadge>
                  </div>
                  <div className="mw-check-row">
                    <Check size={16} />
                    <span>OpenAI Drop-In SDK Gateway Paired</span>
                    <StatusBadge>Active</StatusBadge>
                  </div>
                </div>

                <div className="mw-info-box" style={{ marginTop: 6 }}>
                  <ShieldCheck size={18} />
                  <span>
                    Demo profile credentials and authentication tokens are secured in local client storage. Production sessions verify Ed25519 signatures issued by Inferxe Sovereign Auth Enclaves.
                  </span>
                </div>

                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <button className="mw-secondary" onClick={() => setShowJwtModal(true)}>
                    View Decoded JWT Claims
                  </button>
                </div>
              </div>
            </div>
          </>
        )}

        {/* ───────────────────────────────────────────────────────────
            27. FAQ & SUPPORT HUB (route === 'faq')
            ─────────────────────────────────────────────────────────── */}
        {route === 'faq' && (
          <>
            <div className="mw-toolbar">
              <div>
                <h2>Frequently Asked Questions & Support Hub</h2>
                <p>Technical architecture, pricing guarantees, hardware specifications, and API documentation.</p>
              </div>
              <button className="mw-primary" onClick={() => navigate('/developers')}>
                <FileText size={15} /> OpenAI SDK Docs
              </button>
            </div>

            <div className="mw-filter-bar">
              <div className="mw-search" style={{ maxWidth: 280 }}>
                <Search size={14} />
                <input
                  value={faqSearch}
                  onChange={(e) => setFaqSearch(e.target.value)}
                  placeholder="Search FAQ keywords..."
                />
              </div>

              {(['all', 'hardware', 'billing', 'deploy', 'api'] as const).map((cat) => (
                <button
                  key={cat}
                  className={`mw-filter-pill ${faqCategory === cat ? 'is-active' : ''}`}
                  onClick={() => setFaqCategory(cat)}
                >
                  {cat === 'all' ? 'All Categories' : cat === 'hardware' ? 'Hardware' : cat === 'billing' ? 'Billing' : cat === 'deploy' ? 'Deployments' : 'APIs'}
                </button>
              ))}
            </div>

            <div className="mw-faq-list">
              {FAQS
                .filter((item) => {
                  if (faqCategory !== 'all' && item.category !== faqCategory) return false
                  if (faqSearch && !`${item.q} ${item.a}`.toLowerCase().includes(faqSearch.toLowerCase())) return false
                  return true
                })
                .map((item) => {
                  const isOpen = openFaqId === item.id
                  return (
                    <div className="mw-panel mw-faq-item" key={item.id} style={{ marginBottom: 10 }}>
                      <button
                        className="mw-faq-question"
                        onClick={() => setOpenFaqId(isOpen ? null : item.id)}
                        style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'none', border: 'none', padding: '16px 20px', color: 'var(--ink)', cursor: 'pointer', textAlign: 'left', fontWeight: 600, fontSize: '0.92rem' }}
                      >
                        <span>{item.q}</span>
                        {isOpen ? <ChevronDown size={18} style={{ color: 'var(--brand-hi)' }} /> : <ChevronRight size={18} style={{ color: 'var(--ink-4)' }} />}
                      </button>
                      {isOpen && (
                        <div style={{ padding: '0 20px 18px', color: 'var(--ink-2)', fontSize: '0.84rem', lineHeight: 1.6, borderTop: '1px solid var(--line-2)', paddingTop: 14 }}>
                          {item.a}
                        </div>
                      )}
                    </div>
                  )
                })}
            </div>
          </>
        )}

        {/* ───────────────────────────────────────────────────────────
            28. PROVIDER PROFILE (route === 'provider/profile')
            ─────────────────────────────────────────────────────────── */}
        {route === 'provider/profile' && (
          <>
            <div className="mw-toolbar">
              <div>
                <h2>Datacenter Provider Profile</h2>
                <p>Facility credentials, MeitY certifications, interconnect bandwidth, and payout disbursement accounts.</p>
              </div>
              <button className="mw-primary" onClick={() => flash('Provider datacenter profile saved.')}>
                Save Facility Details
              </button>
            </div>

            <div className="mw-two-col">
              <div className="mw-panel mw-form-panel">
                <div className="mw-panel-head">
                  <h3>Facility Specifications</h3>
                  <StatusBadge>Tier-IV Certified</StatusBadge>
                </div>
                <div className="mw-form">
                  <label>
                    Operating Entity
                    <input defaultValue="Yotta Sovereign Infrastructure Private Limited" />
                  </label>
                  <label>
                    Facility Location
                    <input defaultValue="NM1 Datacenter, Panvel, Navi Mumbai, India" />
                  </label>
                  <label>
                    Power PUE & Redundancy
                    <input defaultValue="1.3 PUE · Dual 220kV Grid Infeed · 48h Diesel Backup" />
                  </label>
                  <label>
                    Network Fabric
                    <input defaultValue="800 Gbps RoCE v2 low-latency lossless interconnect" />
                  </label>
                  <label>
                    Compliance Certifications
                    <input defaultValue="MeitY Empanelled, ISO 27001, SOC 2 Type II, TIA-942 Rated 4" />
                  </label>
                </div>
              </div>

              <div className="mw-panel mw-form-panel">
                <div className="mw-panel-head">
                  <h3>Payout Settlement Bank</h3>
                  <StatusBadge>RTGS / NEFT Verified</StatusBadge>
                </div>
                <div className="mw-form">
                  <label>
                    Beneficiary Entity
                    <input defaultValue="Yotta Infrastructure Solutions Ltd" />
                  </label>
                  <label>
                    Settlement Account (Demo)
                    <input defaultValue="•••• •••• •••• 9821 (HDFC Bank)" />
                  </label>
                  <label>
                    IFSC Code
                    <input defaultValue="HDFC0000123" />
                  </label>
                  <div className="mw-info-box">
                    <ShieldCheck size={18} />
                    <span>
                      Demo banking information. Real settlements are executed via automated daily RTGS batch clearing.
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {/* ───────────────────────────────────────────────────────────
            29. SOVEREIGN NODES MAP (route === 'users/map')
            ─────────────────────────────────────────────────────────── */}
        {route === 'users/map' && (
          <>
            <div className="mw-toolbar">
              <div>
                <h2>Sovereign Nodes & Customer Map</h2>
                <p>Geographic cluster telemetry across Indian sovereign regions and global edge hubs.</p>
              </div>
              <div className="mw-view-toggle" role="group" aria-label="View mode">
                <button
                  type="button"
                  className={`mw-view-toggle-btn ${mapViewMode === 'visual' ? 'is-active' : ''}`}
                  onClick={() => setMapViewMode('visual')}
                  title="Node Grid View"
                  aria-label="Node Grid View"
                >
                  <LayoutGrid size={16} strokeWidth={2.2} />
                </button>
                <button
                  type="button"
                  className={`mw-view-toggle-btn ${mapViewMode === 'table' ? 'is-active' : ''}`}
                  onClick={() => setMapViewMode('table')}
                  title="Data Table View"
                  aria-label="Data Table View"
                >
                  <List size={16} strokeWidth={2.2} />
                </button>
              </div>
            </div>

            <div className="mw-stat-grid">
              <div className="mw-metric">
                <div className="mw-metric-top"><span>Total Nodes</span><span className="mw-icon-box"><Server /></span></div>
                <strong>{SOVEREIGN_NODES.reduce((s, n) => s + n.nodes, 0)} Clusters</strong>
                <small>Tier-IV Datacenters</small>
              </div>
              <div className="mw-metric">
                <div className="mw-metric-top"><span>Active Tenants</span><span className="mw-icon-box"><User /></span></div>
                <strong>{SOVEREIGN_NODES.reduce((s, n) => s + n.users, 0).toLocaleString()}</strong>
                <small>Enterprises & Labs</small>
              </div>
              <div className="mw-metric">
                <div className="mw-metric-top"><span>Lowest Latency</span><span className="mw-icon-box"><Zap /></span></div>
                <strong style={{ color: 'var(--brand-hi)' }}>4 ms</strong>
                <small>Mumbai NM1 Interconnect</small>
              </div>
              <div className="mw-metric">
                <div className="mw-metric-top"><span>Sovereignty Status</span><span className="mw-icon-box"><ShieldCheck /></span></div>
                <strong style={{ color: 'var(--brand-hi)' }}>100% In-Country</strong>
                <small>MeitY Empanelled</small>
              </div>
            </div>

            {/* Interactive World Map & Geo Distribution (Visible in both visual grid and table views) */}
            <SovereignNodesMap
              selectedCountryId={selectedGeoCountry}
              onSelectCountry={setSelectedGeoCountry}
            />

            {mapViewMode === 'visual' ? (
              <div className="mw-map-grid">
                {SOVEREIGN_NODES.map((node) => {
                  const isDimmed = selectedGeoCountry && (
                    (selectedGeoCountry === 'in' && !['node-mum', 'node-hyd', 'node-noi', 'node-che', 'node-blr'].includes(node.id)) ||
                    (selectedGeoCountry === 'us' && node.id !== 'node-sjc') ||
                    (selectedGeoCountry !== 'in' && selectedGeoCountry !== 'us')
                  )

                  return (
                    <div
                      className="mw-node-card"
                      key={node.id}
                      style={{
                        opacity: isDimmed ? 0.38 : 1,
                        transition: 'opacity 0.25s ease, transform 0.25s ease',
                        borderColor: !isDimmed && selectedGeoCountry ? 'var(--brand)' : undefined,
                      }}
                    >
                      <div className="mw-node-card__top">
                        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                          <MapPin size={18} style={{ color: 'var(--brand-hi)' }} />
                          <div>
                            <strong>{node.city}</strong>
                            <small style={{ display: 'block', color: 'var(--ink-4)' }}>{node.dc}</small>
                          </div>
                        </div>
                        <StatusBadge>{node.status}</StatusBadge>
                      </div>

                      <div className="grid grid--2" style={{ gap: 8, marginTop: 12 }}>
                        <div className="mw-calc-box">
                          <span>Hardware</span>
                          <strong style={{ fontSize: '0.78rem' }}>{node.gpus}</strong>
                        </div>
                        <div className="mw-calc-box">
                          <span>Ping / Latency</span>
                          <strong style={{ color: 'var(--brand-hi)', fontSize: '0.78rem' }}>{node.latency}</strong>
                        </div>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, fontSize: '0.72rem', color: 'var(--ink-3)' }}>
                        <span>Compliance: <strong style={{ color: 'var(--ink)' }}>{node.compliance}</strong></span>
                        <span>{node.users} Active Users</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="mw-panel">
                <div className="mw-table-wrap">
                  <table className="mw-table">
                    <thead>
                      <tr>
                        <th>City / Region</th>
                        <th>Facility</th>
                        <th>Allocated Nodes</th>
                        <th>Hardware Tier</th>
                        <th>Ping</th>
                        <th>Compliance</th>
                        <th>Active Tenants</th>
                      </tr>
                    </thead>
                    <tbody>
                      {SOVEREIGN_NODES.map((n) => {
                        const isDimmed = selectedGeoCountry && (
                          (selectedGeoCountry === 'in' && !['node-mum', 'node-hyd', 'node-noi', 'node-che', 'node-blr'].includes(n.id)) ||
                          (selectedGeoCountry === 'us' && n.id !== 'node-sjc') ||
                          (selectedGeoCountry !== 'in' && selectedGeoCountry !== 'us')
                        )

                        return (
                          <tr
                            key={n.id}
                            style={{
                              opacity: isDimmed ? 0.35 : 1,
                              transition: 'opacity 0.25s ease',
                              background: !isDimmed && selectedGeoCountry ? 'rgba(118, 185, 0, 0.06)' : undefined,
                            }}
                          >
                            <td><strong>{n.city}</strong></td>
                            <td>{n.dc}</td>
                            <td>{n.nodes} Nodes</td>
                            <td>{n.gpus}</td>
                            <td><span className="chip chip--lime">{n.latency}</span></td>
                            <td>{n.compliance}</td>
                            <td>{n.users}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}

        {/* ───────────────────────────────────────────────────────────
            18. 404 UNKNOWN ROUTE HANDLER
            ─────────────────────────────────────────────────────────── */}
        {!isRecognized && (
          <div className="mw-panel">
            <div className="mw-empty">
              <span className="mw-icon-box"><Server size={24} /></span>
              <h3>404 · Dashboard Page Not Found</h3>
              <p>The path <code>/dashboard/{rawRoute}</code> does not correspond to an active dashboard module.</p>
              <div className="row" style={{ gap: 10 }}>
                <Link className="mw-primary" to="/dashboard/customer">
                  Go to Customer Portal
                </Link>
                <Link className="mw-secondary" to="/dashboard">
                  Go to Admin Console
                </Link>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ───────────────────────────────────────────────────────────
          MODALS & INTERACTIVE DIALOGS
          ─────────────────────────────────────────────────────────── */}

      {/* 1. New Deployment Modal */}
      {showDeployModal && (
        <div className="mw-modal-backdrop" onClick={() => setShowDeployModal(false)}>
          <div className="mw-modal" onClick={(e) => e.stopPropagation()}>
            <div className="mw-modal-head">
              <h3>Create Model Deployment</h3>
              <button onClick={() => setShowDeployModal(false)} aria-label="Close"><X size={16} /></button>
            </div>
            <form onSubmit={handleCreateDeployment}>
              <div className="mw-modal-body">
                <label className="mw-form label" style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.76rem', color: 'var(--ink-3)' }}>
                  Endpoint Identifier
                  <input
                    required
                    value={deployForm.name}
                    onChange={(e) => setDeployForm({ ...deployForm, name: e.target.value })}
                    placeholder="e.g. qwen-support-bot"
                    style={{ padding: '8px 10px', background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 7, color: 'var(--ink)' }}
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.76rem', color: 'var(--ink-3)' }}>
                  Model
                  <select
                    value={deployForm.model}
                    onChange={(e) => setDeployForm({ ...deployForm, model: e.target.value })}
                    className="mw-select"
                  >
                    {MODELS.map((m) => (
                      <option key={m.id} value={m.name}>{m.name} ({m.params}B)</option>
                    ))}
                  </select>
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.76rem', color: 'var(--ink-3)' }}>
                  GPU Hardware Tier
                  <select
                    value={deployForm.gpu}
                    onChange={(e) => setDeployForm({ ...deployForm, gpu: e.target.value })}
                    className="mw-select"
                  >
                    <option value="L4">NVIDIA L4 (24 GB) · ₹60/hr</option>
                    <option value="L40S">NVIDIA L40S (48 GB) · ₹100/hr</option>
                    <option value="H100">NVIDIA H100 (80 GB) · ₹275/hr</option>
                  </select>
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.76rem', color: 'var(--ink-3)' }}>
                  Deployment Region
                  <select
                    value={deployForm.region}
                    onChange={(e) => setDeployForm({ ...deployForm, region: e.target.value })}
                    className="mw-select"
                  >
                    <option value="Hyderabad, IN">Hyderabad (Sovereign Tier IV)</option>
                    <option value="Mumbai, IN">Mumbai (Yotta NM1)</option>
                    <option value="Delhi, IN">Delhi NCR (MeitY Empanelled)</option>
                  </select>
                </label>
              </div>
              <div className="mw-modal-foot">
                <button type="button" className="mw-secondary" onClick={() => setShowDeployModal(false)}>Cancel</button>
                <button type="submit" className="mw-primary">Deploy Endpoint</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 2. Delete Deployment Confirmation Dialog */}
      {deployToDelete && (
        <div className="mw-modal-backdrop" onClick={() => setDeployToDelete(null)}>
          <div className="mw-modal" onClick={(e) => e.stopPropagation()}>
            <div className="mw-modal-head">
              <h3>Confirm Deletion</h3>
              <button onClick={() => setDeployToDelete(null)} aria-label="Close"><X size={16} /></button>
            </div>
            <div className="mw-modal-body">
              <p style={{ margin: 0, fontSize: '0.84rem', color: 'var(--ink-2)', lineHeight: 1.5 }}>
                Are you sure you want to terminate deployment <strong>{deployToDelete.name}</strong>?
                All active streams to this endpoint will be terminated.
              </p>
            </div>
            <div className="mw-modal-foot">
              <button className="mw-secondary" onClick={() => setDeployToDelete(null)}>Cancel</button>
              <button className="mw-primary" style={{ background: '#ef4444', borderColor: '#ef4444', color: '#fff' }} onClick={handleConfirmDeleteDeployment}>
                Terminate Deployment
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3. New API Key Modal */}
      {showNewKeyModal && (
        <div className="mw-modal-backdrop" onClick={() => setShowNewKeyModal(false)}>
          <div className="mw-modal" onClick={(e) => e.stopPropagation()}>
            <div className="mw-modal-head">
              <h3>Create Demo API Key</h3>
              <button onClick={() => setShowNewKeyModal(false)} aria-label="Close"><X size={16} /></button>
            </div>
            <form onSubmit={handleCreateKey}>
              <div className="mw-modal-body">
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.76rem', color: 'var(--ink-3)' }}>
                  Key Label / Application Name
                  <input
                    required
                    value={newKeyName}
                    onChange={(e) => setNewKeyName(e.target.value)}
                    placeholder="e.g. Chatbot Service Backend"
                    style={{ padding: '8px 10px', background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 7, color: 'var(--ink)' }}
                  />
                </label>
                <p style={{ margin: 0, fontSize: '0.74rem', color: 'var(--ink-4)', lineHeight: 1.5 }}>
                  This creates a simulated key for local frontend testing. Never share actual production credentials.
                </p>
              </div>
              <div className="mw-modal-foot">
                <button type="button" className="mw-secondary" onClick={() => setShowNewKeyModal(false)}>Cancel</button>
                <button type="submit" className="mw-primary">Generate Key</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 4. Revoke API Key Dialog */}
      {keyToRevoke && (
        <div className="mw-modal-backdrop" onClick={() => setKeyToRevoke(null)}>
          <div className="mw-modal" onClick={(e) => e.stopPropagation()}>
            <div className="mw-modal-head">
              <h3>Revoke API Key</h3>
              <button onClick={() => setKeyToRevoke(null)} aria-label="Close"><X size={16} /></button>
            </div>
            <div className="mw-modal-body">
              <p style={{ margin: 0, fontSize: '0.84rem', color: 'var(--ink-2)', lineHeight: 1.5 }}>
                Are you sure you want to revoke API key <strong>{keyToRevoke.name}</strong>?
                Applications using this token will receive 401 Unauthorized immediately.
              </p>
            </div>
            <div className="mw-modal-foot">
              <button className="mw-secondary" onClick={() => setKeyToRevoke(null)}>Cancel</button>
              <button className="mw-primary" style={{ background: '#ef4444', borderColor: '#ef4444', color: '#fff' }} onClick={handleConfirmRevokeKey}>
                Revoke Key
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 5. GPU Comparison Modal */}
      {showCompareModal && (
        <div className="mw-modal-backdrop" onClick={() => setShowCompareModal(false)}>
          <div className="mw-modal mw-modal--wide" onClick={(e) => e.stopPropagation()}>
            <div className="mw-modal-head">
              <h3>GPU Hardware Comparison</h3>
              <button onClick={() => setShowCompareModal(false)} aria-label="Close"><X size={16} /></button>
            </div>
            <div className="mw-modal-body">
              <div className="mw-compare-grid">
                {listings
                  .filter((l) => comparedGpuIds.includes(l.id))
                  .map((gpu) => (
                    <div className="mw-compare-col" key={gpu.id}>
                      <h4>{gpu.name}</h4>
                      <div className="mw-compare-item"><span>VRAM</span><strong>{gpu.vram}</strong></div>
                      <div className="mw-compare-item"><span>Hourly Rate</span><strong>{money(gpu.price)}/hr</strong></div>
                      <div className="mw-compare-item"><span>Datacenter</span><strong>{gpu.region}</strong></div>
                      <div className="mw-compare-item"><span>Status</span><StatusBadge>{gpu.status}</StatusBadge></div>
                      <div className="mw-compare-item"><span>Available Units</span><strong>{gpu.quantity} GPUs</strong></div>
                      <button
                        className="mw-primary mw-full"
                        style={{ marginTop: 14 }}
                        onClick={() => {
                          setDeployForm((f) => ({ ...f, gpu: gpu.gpu, region: gpu.region }))
                          setShowCompareModal(false)
                          setShowDeployModal(true)
                        }}
                      >
                        Select & Deploy
                      </button>
                    </div>
                  ))}
              </div>
            </div>
            <div className="mw-modal-foot">
              <button className="mw-secondary" onClick={() => setShowCompareModal(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* 6. Wallet Top Up Modal */}
      {showTopUpModal && (
        <div className="mw-modal-backdrop" onClick={() => setShowTopUpModal(false)}>
          <div className="mw-modal" onClick={(e) => e.stopPropagation()}>
            <div className="mw-modal-head">
              <h3>Top Up Wallet Balance (Demo)</h3>
              <button onClick={() => setShowTopUpModal(false)} aria-label="Close"><X size={16} /></button>
            </div>
            <form onSubmit={handleTopUpWallet}>
              <div className="mw-modal-body">
                <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--ink-3)' }}>
                  Select an amount to simulate adding funds to your prepaid inference balance:
                </p>
                <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  {[2000, 5000, 10000, 25000].map((amt) => (
                    <button
                      key={amt}
                      type="button"
                      className={`mw-filter-pill ${topUpAmount === amt ? 'is-active' : ''}`}
                      onClick={() => setTopUpAmount(amt)}
                    >
                      {money(amt)}
                    </button>
                  ))}
                </div>
                <div className="mw-info-box" style={{ marginTop: 8 }}>
                  <ShieldCheck size={16} />
                  <span>Simulated transaction. No actual credit card or bank account is charged.</span>
                </div>
              </div>
              <div className="mw-modal-foot">
                <button type="button" className="mw-secondary" onClick={() => setShowTopUpModal(false)}>Cancel</button>
                <button type="submit" className="mw-primary">Add {money(topUpAmount)}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 7. Invoice Preview Modal */}
      {viewInvoiceItem && (
        <div className="mw-modal-backdrop" onClick={() => setViewInvoiceItem(null)}>
          <div className="mw-modal" onClick={(e) => e.stopPropagation()}>
            <div className="mw-modal-head">
              <h3>Invoice Preview · {viewInvoiceItem.id}</h3>
              <button onClick={() => setViewInvoiceItem(null)} aria-label="Close"><X size={16} /></button>
            </div>
            <div className="mw-modal-body">
              <div className="mw-invoice-sheet">
                <div className="mw-invoice-head">
                  <div>
                    <strong style={{ fontSize: '1.05rem', color: 'var(--brand-hi)', display: 'block' }}>Inferxe Technologies Ltd</strong>
                    <span style={{ color: 'var(--ink-4)', fontSize: '0.72rem' }}>Sovereign GPU Inference Mesh</span>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <strong>{viewInvoiceItem.id}</strong>
                    <small style={{ display: 'block', color: 'var(--ink-4)' }}>{viewInvoiceItem.date}</small>
                  </div>
                </div>

                <div style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
                  <span style={{ color: 'var(--ink-4)', fontSize: '0.72rem', display: 'block' }}>Billed To:</span>
                  <strong style={{ color: 'var(--ink)' }}>NovaTech AI Enterprises</strong>
                  <span style={{ display: 'block', color: 'var(--ink-3)', fontSize: '0.74rem' }}>GSTIN: 27AABCI1234F1Z8 · Mumbai, India</span>
                </div>

                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', color: 'var(--ink-2)' }}>
                    <span>{viewInvoiceItem.desc}</span>
                    <strong>{money(viewInvoiceItem.amount)}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', color: 'var(--ink-3)', fontSize: '0.72rem' }}>
                    <span>CGST + SGST (18%)</span>
                    <span>{money(Math.round(viewInvoiceItem.amount * 0.18))}</span>
                  </div>
                </div>

                <div className="mw-invoice-totals">
                  <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', fontSize: '0.9rem' }}>
                    <span>Total Amount</span>
                    <strong style={{ color: 'var(--brand-hi)' }}>{money(Math.round(viewInvoiceItem.amount * 1.18))}</strong>
                  </div>
                  <span style={{ fontSize: '0.7rem', color: 'var(--ink-4)' }}>Status: {viewInvoiceItem.status} (Simulated)</span>
                </div>
              </div>
            </div>
            <div className="mw-modal-foot">
              <button
                className="mw-secondary"
                onClick={() => flash('Simulated invoice PDF download triggered.')}
              >
                <Download size={14} /> Download PDF
              </button>
              <button className="mw-primary" onClick={() => setViewInvoiceItem(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 8. Provider Edit Listing Modal */}
      {editingListing && (
        <div className="mw-modal-backdrop" onClick={() => setEditingListing(null)}>
          <div className="mw-modal" onClick={(e) => e.stopPropagation()}>
            <div className="mw-modal-head">
              <h3>Edit Listing: {editingListing.name}</h3>
              <button onClick={() => setEditingListing(null)} aria-label="Close"><X size={16} /></button>
            </div>
            <form onSubmit={handleSaveListing}>
              <div className="mw-modal-body">
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.76rem', color: 'var(--ink-3)' }}>
                  Quantity (Units)
                  <input
                    type="number"
                    min="1"
                    required
                    value={editingListing.quantity}
                    onChange={(e) => setEditingListing({ ...editingListing, quantity: Number(e.target.value) })}
                    style={{ padding: '8px 10px', background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 7, color: 'var(--ink)' }}
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.76rem', color: 'var(--ink-3)' }}>
                  Rate per Hour (₹)
                  <input
                    type="number"
                    min="1"
                    required
                    value={editingListing.price}
                    onChange={(e) => setEditingListing({ ...editingListing, price: Number(e.target.value) })}
                    style={{ padding: '8px 10px', background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 7, color: 'var(--ink)' }}
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.76rem', color: 'var(--ink-3)' }}>
                  Listing Status
                  <select
                    value={editingListing.status}
                    onChange={(e) => setEditingListing({ ...editingListing, status: e.target.value as any })}
                    className="mw-select"
                  >
                    <option value="Available">Available</option>
                    <option value="Paused">Paused</option>
                    <option value="Maintenance">Maintenance</option>
                  </select>
                </label>
              </div>
              <div className="mw-modal-foot">
                <button type="button" className="mw-secondary" onClick={() => setEditingListing(null)}>Cancel</button>
                <button type="submit" className="mw-primary">Save Changes</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 9. Provider Payout Modal */}
      {showPayoutModal && (
        <div className="mw-modal-backdrop" onClick={() => setShowPayoutModal(false)}>
          <div className="mw-modal" onClick={(e) => e.stopPropagation()}>
            <div className="mw-modal-head">
              <h3>Request Provider Payout (Demo)</h3>
              <button onClick={() => setShowPayoutModal(false)} aria-label="Close"><X size={16} /></button>
            </div>
            <div className="mw-modal-body">
              <p style={{ margin: 0, fontSize: '0.84rem', color: 'var(--ink-2)', lineHeight: 1.5 }}>
                Confirm requesting disbursement for pending earnings of <strong>₹72,000</strong> to your registered bank account?
              </p>
              <div className="mw-info-box">
                <ShieldCheck size={16} />
                <span>Simulated payout request. In production, disbursements are processed via NEFT/RTGS settlement.</span>
              </div>
            </div>
            <div className="mw-modal-foot">
              <button className="mw-secondary" onClick={() => setShowPayoutModal(false)}>Cancel</button>
              <button
                className="mw-primary"
                onClick={() => {
                  setShowPayoutModal(false)
                  flash('Payout request PO-2026-11 submitted (simulated).')
                }}
              >
                Confirm Payout
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 10. Workload Telemetry Modal */}
      {workloadTelemetry && (
        <div className="mw-modal-backdrop" onClick={() => setWorkloadTelemetry(null)}>
          <div className="mw-modal" onClick={(e) => e.stopPropagation()}>
            <div className="mw-modal-head">
              <h3>Telemetry: {workloadTelemetry.name}</h3>
              <button onClick={() => setWorkloadTelemetry(null)} aria-label="Close"><X size={16} /></button>
            </div>
            <div className="mw-modal-body">
              <div className="grid grid--2" style={{ gap: 10 }}>
                <div className="mw-calc-box"><span>Model</span><strong>{workloadTelemetry.model}</strong></div>
                <div className="mw-calc-box"><span>GPU Node</span><strong>{workloadTelemetry.gpu}</strong></div>
                <div className="mw-calc-box"><span>Throughput</span><strong style={{ color: 'var(--brand-hi)' }}>118 tok/s</strong></div>
                <div className="mw-calc-box"><span>TTFT</span><strong style={{ color: 'var(--brand-hi)' }}>0.42 s</strong></div>
              </div>
              <p style={{ margin: 0, fontSize: '0.74rem', color: 'var(--ink-4)' }}>
                Metrics retrieved from local telemetry cache for demonstration.
              </p>
            </div>
            <div className="mw-modal-foot">
              <button className="mw-primary" onClick={() => setWorkloadTelemetry(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* 11. Add SSH Public Key Modal */}
      {showAddSshModal && (
        <div className="mw-modal-backdrop" onClick={() => setShowAddSshModal(false)}>
          <div className="mw-modal" onClick={(e) => e.stopPropagation()}>
            <div className="mw-modal-head">
              <h3>Add Public SSH Key</h3>
              <button onClick={() => setShowAddSshModal(false)} aria-label="Close"><X size={16} /></button>
            </div>
            <form onSubmit={handleAddSshKey}>
              <div className="mw-modal-body">
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.76rem', color: 'var(--ink-3)' }}>
                  Key Name / Machine Label
                  <input
                    required
                    value={newSshName}
                    onChange={(e) => setNewSshName(e.target.value)}
                    placeholder="e.g. Workstation id_ed25519"
                    style={{ padding: '8px 10px', background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 7, color: 'var(--ink)' }}
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.76rem', color: 'var(--ink-3)' }}>
                  Public Key (ssh-rsa, ssh-ed25519, or ecdsa-*)
                  <textarea
                    required
                    rows={4}
                    value={newSshKey}
                    onChange={(e) => {
                      setNewSshKey(e.target.value)
                      setSshError('')
                    }}
                    placeholder="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI... user@machine"
                    style={{ padding: '8px 10px', background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 7, color: 'var(--ink)', fontFamily: 'var(--font-mono)', fontSize: '0.74rem' }}
                  />
                </label>
                {sshError && <small style={{ color: '#ef4444', display: 'block' }}>{sshError}</small>}
                <div className="mw-info-box" style={{ marginTop: 4 }}>
                  <ShieldCheck size={16} />
                  <span>Never upload private keys (.id_rsa). Only public (.pub) keys are accepted. Stored locally in browser session for demonstration.</span>
                </div>
              </div>
              <div className="mw-modal-foot">
                <button type="button" className="mw-secondary" onClick={() => setShowAddSshModal(false)}>Cancel</button>
                <button type="submit" className="mw-primary">Add Public Key</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 12. Delete SSH Key Confirmation Dialog */}
      {sshKeyToDelete && (
        <div className="mw-modal-backdrop" onClick={() => setSshKeyToDelete(null)}>
          <div className="mw-modal" onClick={(e) => e.stopPropagation()}>
            <div className="mw-modal-head">
              <h3>Remove SSH Key</h3>
              <button onClick={() => setSshKeyToDelete(null)} aria-label="Close"><X size={16} /></button>
            </div>
            <div className="mw-modal-body">
              <p style={{ margin: 0, fontSize: '0.84rem', color: 'var(--ink-2)', lineHeight: 1.5 }}>
                Are you sure you want to remove public key <strong>{sshKeyToDelete.name}</strong> ({sshKeyToDelete.fingerprint})?
                GPU cluster instances will revoke terminal pairing for this key.
              </p>
            </div>
            <div className="mw-modal-foot">
              <button className="mw-secondary" onClick={() => setSshKeyToDelete(null)}>Cancel</button>
              <button className="mw-primary" style={{ background: '#ef4444', borderColor: '#ef4444', color: '#fff' }} onClick={handleConfirmDeleteSshKey}>
                Remove Key
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 13. Order Details Modal */}
      {selectedOrder && (
        <div className="mw-modal-backdrop" onClick={() => setSelectedOrder(null)}>
          <div className="mw-modal" onClick={(e) => e.stopPropagation()}>
            <div className="mw-modal-head">
              <h3>Order Specification · {selectedOrder.id}</h3>
              <button onClick={() => setSelectedOrder(null)} aria-label="Close"><X size={16} /></button>
            </div>
            <div className="mw-modal-body">
              <div className="mw-invoice-sheet">
                <div className="mw-invoice-head">
                  <div>
                    <strong style={{ fontSize: '1rem', color: 'var(--brand-hi)', display: 'block' }}>Inferxe Compute Service</strong>
                    <span style={{ color: 'var(--ink-4)', fontSize: '0.72rem' }}>Order Reference: {selectedOrder.id}</span>
                  </div>
                  <StatusBadge>{selectedOrder.status}</StatusBadge>
                </div>

                <div className="grid grid--2" style={{ gap: 10, padding: '10px 0', borderBottom: '1px solid var(--line-2)' }}>
                  <div><span>Hardware / Model:</span> <strong style={{ display: 'block', color: 'var(--ink)' }}>{selectedOrder.modelOrGpu}</strong></div>
                  <div><span>Datacenter Region:</span> <strong style={{ display: 'block', color: 'var(--ink)' }}>{selectedOrder.provider}</strong></div>
                  <div><span>Reservation Date:</span> <strong style={{ display: 'block', color: 'var(--ink)' }}>{selectedOrder.date}</strong></div>
                  <div><span>Scheduled Duration:</span> <strong style={{ display: 'block', color: 'var(--ink)' }}>{selectedOrder.duration}</strong></div>
                </div>

                <div style={{ padding: '10px 0', borderBottom: '1px solid var(--line-2)' }}>
                  <span style={{ fontSize: '0.72rem', color: 'var(--ink-4)', display: 'block', marginBottom: 2 }}>Order Details / Provisions:</span>
                  <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--ink-2)' }}>{selectedOrder.details || 'Standard dedicated sovereign GPU reservation with NVLink fabric interconnect.'}</p>
                </div>

                <div className="mw-invoice-totals">
                  <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', fontSize: '0.95rem' }}>
                    <span>Estimated Total Cost</span>
                    <strong style={{ color: 'var(--brand-hi)' }}>{money(selectedOrder.cost)}</strong>
                  </div>
                </div>
              </div>
            </div>
            <div className="mw-modal-foot">
              <button className="mw-secondary" onClick={() => flash(`Invoice downloaded for ${selectedOrder.id} (demo).`)}>
                <Download size={14} /> Download Receipt
              </button>
              <button className="mw-primary" onClick={() => setSelectedOrder(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 14. JWT Token Inspector Modal */}
      {showJwtModal && (
        <div className="mw-modal-backdrop" onClick={() => setShowJwtModal(false)}>
          <div className="mw-modal mw-modal--wide" onClick={(e) => e.stopPropagation()}>
            <div className="mw-modal-head">
              <h3>JWT Session Token Inspector</h3>
              <button onClick={() => setShowJwtModal(false)} aria-label="Close"><X size={16} /></button>
            </div>
            <div className="mw-modal-body">
              <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--ink-3)' }}>
                Decoded structure of simulated JSON Web Token (RFC 7519) passed via <code>Authorization: Bearer</code>:
              </p>

              <div className="grid grid--2" style={{ gap: 12, marginTop: 12 }}>
                {/* Header */}
                <div className="mw-calc-box">
                  <span style={{ color: '#06b6d4' }}>Header (Algorithm & Token Type)</span>
                  <pre style={{ margin: 0, fontSize: '0.72rem', fontFamily: 'var(--font-mono)', color: 'var(--ink)' }}>
                    {JSON.stringify({ alg: 'EdDSA', typ: 'JWT', kid: 'inferxe-sovereign-auth-2026-v1' }, null, 2)}
                  </pre>
                </div>

                {/* Payload */}
                <div className="mw-calc-box">
                  <span style={{ color: 'var(--brand-hi)' }}>Payload (Claims & Scopes)</span>
                  <pre style={{ margin: 0, fontSize: '0.72rem', fontFamily: 'var(--font-mono)', color: 'var(--ink)' }}>
                    {JSON.stringify({
                      sub: 'usr_94a7e2b109c4',
                      email: profileEmail,
                      name: profileName,
                      org: profileOrg,
                      roles: ['customer', 'tenant_admin'],
                      scopes: ['inference:read', 'inference:write', 'gpus:reserve', 'tokens:create'],
                      iss: 'https://auth.inferxe.com',
                      aud: 'https://api.inferxe.com',
                      iat: 1791782400,
                      exp: 1791868800
                    }, null, 2)}
                  </pre>
                </div>
              </div>

              <div className="mw-info-box" style={{ marginTop: 12 }}>
                <ShieldCheck size={18} />
                <span>
                  <strong>Frontend Transparency Disclosure:</strong> This interface demonstrates token verification claims and scopes. No actual cryptographic signing keys or secrets are stored in the client.
                </span>
              </div>
            </div>
            <div className="mw-modal-foot">
              <button
                className="mw-secondary"
                onClick={() => {
                  navigator.clipboard?.writeText('eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c3JfOTRhN2UyYjEwOWM0IiwiZW1haWwiOiJkZW1vQG5vdmF0ZWNoLmFpIn0.simulated_eddsa_signature')
                  flash('Simulated Bearer token copied to clipboard.')
                }}
              >
                <Copy size={14} /> Copy Bearer Token
              </button>
              <button className="mw-primary" onClick={() => setShowJwtModal(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  )

  if (info.group === 'admin') {
    return <AdminGuard>{workspaceContent}</AdminGuard>
  }

  return workspaceContent
}

function ChangePasswordCard({
  userEmail,
  flash,
}: {
  userEmail: string
  flash: (msg: string) => void
}) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<string | null>(() =>
    getUserPasswordLastUpdated(userEmail)
  )

  // Password strength calculation
  const pwdStrength = useMemo(() => {
    if (!newPassword) return { score: 0, label: 'Not entered', color: 'var(--ink-4)', percent: 0 }
    let s = 0
    if (newPassword.length >= 8) s += 1
    if (newPassword.length >= 12) s += 1
    if (/[A-Z]/.test(newPassword) && /[a-z]/.test(newPassword)) s += 1
    if (/[0-9]/.test(newPassword)) s += 1
    if (/[^A-Za-z0-9]/.test(newPassword)) s += 1

    if (s <= 1) return { score: 1, label: 'Weak', color: '#ef4444', percent: 25 }
    if (s <= 2) return { score: 2, label: 'Fair', color: '#f59e0b', percent: 50 }
    if (s <= 3) return { score: 3, label: 'Good', color: '#84cc16', percent: 75 }
    return { score: 4, label: 'Strong', color: '#76b900', percent: 100 }
  }, [newPassword])

  // Validation rules checklist
  const rules = useMemo(() => ({
    minLen: newPassword.length >= 8,
    hasNumOrSymbol: /[0-9!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(newPassword),
    matches: Boolean(newPassword && confirmPassword && newPassword === confirmPassword),
  }), [newPassword, confirmPassword])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setErrorMsg(null)
    setSuccessMsg(null)

    if (!currentPassword) {
      setErrorMsg('Please enter your current password.')
      return
    }
    if (newPassword.length < 8) {
      setErrorMsg('New password must be at least 8 characters long.')
      return
    }
    if (!rules.hasNumOrSymbol) {
      setErrorMsg('New password must include at least one number or special character.')
      return
    }
    if (newPassword !== confirmPassword) {
      setErrorMsg('New password and confirmation do not match.')
      return
    }
    if (currentPassword === newPassword) {
      setErrorMsg('New password must be different from your current password.')
      return
    }

    setIsSubmitting(true)
    const res = await changeUserPassword(userEmail, currentPassword, newPassword)
    setIsSubmitting(false)

    if (res.ok) {
      setSuccessMsg('Account password has been successfully updated.')
      flash('Account password updated successfully.')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setLastUpdated(new Date().toISOString())
    } else {
      setErrorMsg(res.error || 'Failed to update password. Please check your credentials.')
    }
  }

  const handleReset = () => {
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
    setErrorMsg(null)
    setSuccessMsg(null)
  }

  const formattedDate = useMemo(() => {
    if (!lastUpdated) return 'Default Credentials'
    try {
      const d = new Date(lastUpdated)
      return `Updated ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
    } catch {
      return 'Recently Updated'
    }
  }, [lastUpdated])

  const hasInput = Boolean(currentPassword || newPassword || confirmPassword)

  return (
    <div className="mw-panel mw-form-panel dash-pwd-card">
      <div className="mw-panel-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Lock size={16} style={{ color: 'var(--brand-hi)' }} />
          <h3>Change Account Password</h3>
        </div>
        <StatusBadge>{formattedDate}</StatusBadge>
      </div>

      <form className="dash-pwd-form" onSubmit={handleSubmit}>
        {errorMsg && (
          <div className="dash-pwd-alert dash-pwd-alert--error" role="alert">
            <X size={15} style={{ flexShrink: 0 }} />
            <span>{errorMsg}</span>
          </div>
        )}

        {successMsg && (
          <div className="dash-pwd-alert dash-pwd-alert--success" role="status">
            <Check size={15} style={{ flexShrink: 0 }} />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Current Password Field */}
        <div className="dash-pwd-field">
          <label>
            <span>Current Password</span>
            <small style={{ color: 'var(--ink-4)', fontFamily: 'var(--font-mono)', fontSize: '0.68rem' }}>Required</small>
          </label>
          <div className="dash-input-wrap">
            <input
              type={showCurrent ? 'text' : 'password'}
              className="dash-input"
              value={currentPassword}
              onChange={(e) => {
                setCurrentPassword(e.target.value)
                setErrorMsg(null)
              }}
              placeholder="Enter current password"
              required
              autoComplete="current-password"
              style={{ paddingRight: 44, fontFamily: 'var(--font-mono)' }}
            />
            <div className="dash-pwd-tools">
              <button
                type="button"
                className="dash-icon-btn"
                onClick={() => setShowCurrent(!showCurrent)}
                title={showCurrent ? 'Hide password' : 'Show password'}
                aria-label="Toggle current password visibility"
              >
                {showCurrent ? <EyeOff /> : <Eye />}
              </button>
            </div>
          </div>
        </div>

        {/* New Password Field */}
        <div className="dash-pwd-field">
          <label>
            <span>New Password</span>
            {newPassword && (
              <span className="dash-pwd-strength-label" style={{ color: pwdStrength.color, fontWeight: 600 }}>
                Strength: {pwdStrength.label}
              </span>
            )}
          </label>
          <div className="dash-input-wrap">
            <input
              type={showNew ? 'text' : 'password'}
              className="dash-input"
              value={newPassword}
              onChange={(e) => {
                setNewPassword(e.target.value)
                setErrorMsg(null)
              }}
              placeholder="Enter new password (min. 8 characters)"
              required
              autoComplete="new-password"
              style={{ paddingRight: 44, fontFamily: 'var(--font-mono)' }}
            />
            <div className="dash-pwd-tools">
              <button
                type="button"
                className="dash-icon-btn"
                onClick={() => setShowNew(!showNew)}
                title={showNew ? 'Hide password' : 'Show password'}
                aria-label="Toggle new password visibility"
              >
                {showNew ? <EyeOff /> : <Eye />}
              </button>
            </div>
          </div>

          {/* Password Strength Meter */}
          {newPassword && (
            <div className="dash-pwd-meter">
              <div className="dash-pwd-bar-track">
                <div
                  className="dash-pwd-bar-fill"
                  style={{
                    width: `${pwdStrength.percent}%`,
                    backgroundColor: pwdStrength.color,
                  }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Confirm New Password Field */}
        <div className="dash-pwd-field">
          <label>
            <span>Confirm New Password</span>
            {confirmPassword && (
              <small style={{ color: rules.matches ? 'var(--brand-hi)' : '#ef4444', fontWeight: 600 }}>
                {rules.matches ? '✓ Matches' : '✗ Does not match'}
              </small>
            )}
          </label>
          <div className="dash-input-wrap">
            <input
              type={showConfirm ? 'text' : 'password'}
              className="dash-input"
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value)
                setErrorMsg(null)
              }}
              placeholder="Re-enter new password"
              required
              autoComplete="new-password"
              style={{ paddingRight: 44, fontFamily: 'var(--font-mono)' }}
            />
            <div className="dash-pwd-tools">
              <button
                type="button"
                className="dash-icon-btn"
                onClick={() => setShowConfirm(!showConfirm)}
                title={showConfirm ? 'Hide password' : 'Show password'}
                aria-label="Toggle confirm password visibility"
              >
                {showConfirm ? <EyeOff /> : <Eye />}
              </button>
            </div>
          </div>
        </div>

        {/* Real-time Requirements Checklist */}
        <div className="dash-pwd-checklist">
          <div className={`dash-pwd-check-item ${rules.minLen ? 'is-valid' : ''}`}>
            <span className="dash-pwd-check-dot">{rules.minLen ? '✓' : '•'}</span>
            <span>At least 8 characters long</span>
          </div>
          <div className={`dash-pwd-check-item ${rules.hasNumOrSymbol ? 'is-valid' : ''}`}>
            <span className="dash-pwd-check-dot">{rules.hasNumOrSymbol ? '✓' : '•'}</span>
            <span>Includes at least one number (0-9) or symbol</span>
          </div>
          <div className={`dash-pwd-check-item ${rules.matches ? 'is-valid' : ''}`}>
            <span className="dash-pwd-check-dot">{rules.matches ? '✓' : '•'}</span>
            <span>New password and confirmation match</span>
          </div>
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: 10, marginTop: 4, alignItems: 'center' }}>
          <button
            className="mw-primary"
            type="submit"
            disabled={isSubmitting}
            style={{ opacity: isSubmitting ? 0.7 : 1, display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Lock size={14} />
            {isSubmitting ? 'Updating Password...' : 'Update Password'}
          </button>
          {hasInput && (
            <button
              className="mw-secondary"
              type="button"
              onClick={handleReset}
              disabled={isSubmitting}
            >
              Reset
            </button>
          )}
        </div>
      </form>
    </div>
  )
}

function SettingsSection({ flash }: { flash: (msg: string) => void }) {
  const session = getSession()
  const userEmail = (session?.user as any)?.email || 'priya.s@novatech.ai'
  const [budget, setBudget] = useState(() => readStore('inferxe_demo_budget', '10000'))
  const [emailAlerts, setEmailAlerts] = useState(() => readStore('inferxe_demo_email_alerts', true))
  const [weekly, setWeekly] = useState(() => readStore('inferxe_demo_weekly_report', false))
  const [corsOrigins, setCorsOrigins] = useState('https://app.novatech.ai, http://localhost:3000')

  const handleSave = (e: FormEvent) => {
    e.preventDefault()
    saveStore('inferxe_demo_budget', budget)
    saveStore('inferxe_demo_email_alerts', emailAlerts)
    saveStore('inferxe_demo_weekly_report', weekly)
    flash('Settings & preferences saved in browser storage.')
  }

  return (
    <div className="mw-two-col">
      <div className="mw-panel mw-form-panel">
        <div className="mw-panel-head">
          <h3>Workspace Preferences & Security</h3>
          <StatusBadge>Local settings</StatusBadge>
        </div>

        <form className="mw-form" onSubmit={handleSave}>
          <label>
            Monthly Spending Limit (₹)
            <input
              type="number"
              min="0"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
            />
          </label>

          <label>
            Allowed API CORS Origins
            <input
              value={corsOrigins}
              onChange={(e) => setCorsOrigins(e.target.value)}
              placeholder="https://yourdomain.com"
            />
          </label>

          <label className="mw-toggle-label">
            <span>
              <strong>Spending & Over-quota Notifications</strong>
              <small>Receive email alerts when usage approaches 80% and 100% of budget.</small>
            </span>
            <input
              type="checkbox"
              checked={emailAlerts}
              onChange={(e) => setEmailAlerts(e.target.checked)}
            />
          </label>

          <label className="mw-toggle-label">
            <span>
              <strong>Weekly Summary Telemetry Report</strong>
              <small>Aggregated latency, token counts and spend emailed weekly.</small>
            </span>
            <input
              type="checkbox"
              checked={weekly}
              onChange={(e) => setWeekly(e.target.checked)}
            />
          </label>

          <div className="mw-info-box">
            <ShieldCheck size={18} />
            <span>
              Organization user accounts and role definitions can be managed in the{' '}
              <Link to="/dashboard/users" style={{ color: 'var(--brand-hi)', fontWeight: 600 }}>Users Directory</Link>.
            </span>
          </div>

          <div className="row" style={{ gap: 10, gridColumn: '1 / -1' }}>
            <button className="mw-primary" type="submit">
              Save Preferences
            </button>
          </div>
        </form>
      </div>

      <ChangePasswordCard userEmail={userEmail} flash={flash} />
    </div>
  )
}

