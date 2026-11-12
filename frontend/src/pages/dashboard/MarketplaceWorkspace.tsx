import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useLocation, Link, useNavigate } from 'react-router-dom'
import {
  Activity, Archive, ArrowDownToLine, ArrowUpDown, Bell, Check, ChevronDown, ChevronRight,
  CircleDollarSign, Copy, Cpu, Download, Eye, EyeOff, FileText,
  Heart, Info, KeyRound, Layers, LayoutGrid, List, Lock, MapPin, Play, Plus,
  Search, Server, Settings2, Share2, ShieldCheck, Sparkles, Terminal,
  Trash2, TrendingUp, User, Users, Wallet, Wrench, X, Zap,
} from 'lucide-react'
import { DashboardLayout } from '../../components/dashboard/DashboardLayout'
import { AdminGuard } from '../../components/auth/AdminGuard'
import { usePageMeta } from '../../lib/hooks'
import { MODELS, QUANTS, type Quant } from '../../data/gpus'
import { estimateMemory, recommend, fmtGB, inr } from '../../lib/calc'
import { getSession, saveSession, changeUserPassword, getUserPasswordLastUpdated } from '../../lib/authStore'
import {
  fetchBackendApiKeys,
  createBackendApiKey,
  revokeBackendApiKey,
} from '../../lib/apiKeyService'
import { fetchWalletBalance, topUpWallet } from '../../lib/walletService'
import {
  fetchBackendSshKeys,
  createBackendSshKey,
  deleteBackendSshKey,
} from '../../lib/sshKeyService'
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
  environment?: 'live' | 'test'
  lastUsed?: string | null
}

type SshKey = {
  id: string
  name: string
  key: string
  fingerprint: string
  keyType?: string
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
  is_archived?: boolean
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

type PayoutRecord = {
  id: string
  period: string
  gross: number
  fee: number
  net: number
  status: 'Paid' | 'Pending' | 'Processing'
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
  payouts: 'inferxe_demo_provider_payouts_v1',
  pendingPayout: 'inferxe_demo_provider_pending_payout_v1',
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

const initialOrders: OrderItem[] = [
  { id: 'ORD-8492', modelOrGpu: 'Qwen 2.5 7B · 1x NVIDIA L4', provider: 'Yotta NM1 (Mumbai)', date: '10 Oct 2026', duration: '24 hours', cost: 1440, status: 'Running', details: 'Dedicated endpoint deployment with FP16 weights', is_archived: false },
  { id: 'ORD-8431', modelOrGpu: 'Llama 3.1 8B · 1x NVIDIA L40S', provider: 'E2E Cloud (Noida)', date: '08 Oct 2026', duration: '12 hours', cost: 1200, status: 'Completed', details: 'Customer support batch fine-tuning pipeline', is_archived: false },
  { id: 'ORD-8390', modelOrGpu: 'DeepSeek R1 671B · 8x NVIDIA H100', provider: 'CtrlS Datacenters (Hyderabad)', date: '04 Oct 2026', duration: '4 hours', cost: 8800, status: 'Completed', details: 'Frontier MoE reasoning benchmark evaluation', is_archived: false },
  { id: 'ORD-8312', modelOrGpu: 'Mistral 7B · 1x NVIDIA L4', provider: 'Yotta NM1 (Mumbai)', date: '01 Oct 2026', duration: '8 hours', cost: 480, status: 'Cancelled', details: 'Workload canceled by user before warm-up', is_archived: false },
  { id: 'ORD-8201', modelOrGpu: 'CodeQwen 7B · 1x NVIDIA L40S', provider: 'Sify Infinit (Chennai)', date: '25 Sep 2026', duration: '72 hours', cost: 7200, status: 'Archived', details: 'Archived monthly sandbox workload', is_archived: true },
]

const initialPayouts: PayoutRecord[] = [
  { id: 'PO-2026-09', period: 'Sep 2026', gross: 110000, fee: 13200, net: 96800, status: 'Paid' },
  { id: 'PO-2026-10', period: 'Oct 2026', gross: 72000, fee: 8640, net: 63360, status: 'Pending' },
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
  notebooks: { title: 'Developer Workspace', description: 'Access your GPU-powered development environment, launch JupyterLab notebooks and manage secure SSH connections.', group: 'customer' },
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

  // User session & Cognito-scoped storage keys (declared before any state initializer uses them)
  const session = getSession()
  const sessionUser = session?.user as ({ fullName: string; email: string; organization?: string }) | undefined
  const cognitoSub = session?.user?.id || ''
  const walletStorageKey = cognitoSub ? `inferxe_demo_wallet_balance_v1_${cognitoSub}` : STORE.wallet
  const transactionsStorageKey = cognitoSub ? `inferxe_demo_transactions_v2_${cognitoSub}` : STORE.transactions

  // Global Workspace State
  const [listings, setListings] = useState<Listing[]>(() => readStore(STORE.listings, initialListings))
  const [deployments, setDeployments] = useState<Deployment[]>(() => readStore(STORE.deployments, initialDeployments))
  const [keys, setKeys] = useState<ApiKey[]>(() => readStore(STORE.keys, [
    { id: 'key-1', name: 'Production Backend API', key: 'inf_demo_live_pk_93a74b12c8e0', created: '01 Oct 2026', revoked: false },
    { id: 'key-2', name: 'Staging Evaluation Key', key: 'inf_demo_test_sk_44f12d88e7a1', created: '06 Oct 2026', revoked: false },
  ]))
  const [sshKeys, setSshKeys] = useState<SshKey[]>([])
  const [orders, setOrders] = useState<OrderItem[]>(() => readStore(STORE.orders, initialOrders))
  const [wishlist, setWishlist] = useState<string[]>(() => readStore(STORE.wishlist, ['gpu-101', 'gpu-104']))
  const [walletBalance, setWalletBalance] = useState<number>(() => readStore(walletStorageKey, 0))
  const [transactions, setTransactions] = useState<TransactionItem[]>(() => readStore(transactionsStorageKey, []))
  const [notifications, setNotifications] = useState<NotificationItem[]>(() => readStore(STORE.notifications, initialNotifications))

  // Wallet usage computed from transactions (not hardcoded)
  const monthSpend = transactions.filter((t) => !t.isCredit).reduce((s, t) => s + t.amount, 0)

  // Customer Zesto-style UI state (Tabs, Filter, Chart range, Toast, Balance visibility)
  const [customerSectionTab, setCustomerSectionTab] = useState<'workloads' | 'marketplace' | 'orders'>('workloads')
  const [customerChartRange, setCustomerChartRange] = useState<'7D' | '14D' | '30D' | '90D'>('30D')
  const [customerModelFilter, setCustomerModelFilter] = useState<string>('all')
  const [customerToastVisible, setCustomerToastVisible] = useState<boolean>(true)
  const [hideBalance, setHideBalance] = useState<boolean>(() => {
    try {
      return localStorage.getItem('inferxe_hide_balance') === 'true'
    } catch {
      return false
    }
  })

  useEffect(() => {
    const handleSyncHide = () => {
      try {
        setHideBalance(localStorage.getItem('inferxe_hide_balance') === 'true')
      } catch {}
    }
    window.addEventListener('inferxe_balance_visibility', handleSyncHide)
    window.addEventListener('storage', handleSyncHide)
    return () => {
      window.removeEventListener('inferxe_balance_visibility', handleSyncHide)
      window.removeEventListener('storage', handleSyncHide)
    }
  }, [])

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

  // Sync wallet balance from backend (source of truth) on mount
  useEffect(() => {
    let mounted = true
    const syncWalletBalance = async () => {
      const res = await fetchWalletBalance()
      if (!mounted) return
      if (res.ok && res.balance) {
        setWalletBalance(res.balance.balance)
        saveStore(walletStorageKey, res.balance.balance)
      }
    }
    void syncWalletBalance()
    return () => {
      mounted = false
    }
  }, [])

  const startTrial = () => {
    localStorage.setItem('inferxe_demo_trial_active', 'true')
    localStorage.setItem('inferxe_demo_trial_start', Date.now().toString())
    setTrialTimeLeft(3600000)
    flash('1-Hour Free Sandbox Trial started! 3600s compute credits activated.')
  }

type ToastNotice = {
  title: string
  description?: string
  icon?: 'server' | 'bell' | 'wallet' | 'check'
}

  // UI notice state
  const [notice, setNotice] = useState<ToastNotice | null>(null)
  const noticeTimerRef = useRef<number | null>(null)
  const [search, setSearch] = useState('')
  const [gpuArchFilter, setGpuArchFilter] = useState<'all' | 'ada' | 'hopper' | 'available' | 'paused'>('all')
  const [gpuSort, setGpuSort] = useState<'rate-asc' | 'rate-desc' | 'vram-desc' | 'qty-desc'>('rate-asc')
  const [comparedGpuIds, setComparedGpuIds] = useState<string[]>([])
  const [showCompareModal, setShowCompareModal] = useState(false)
  const [comparedModelIds, setComparedModelIds] = useState<string[]>([])
  const [showModelCompareModal, setShowModelCompareModal] = useState(false)

  // Deployments UI State
  const [showDeployModal, setShowDeployModal] = useState(false)
  const [isDeploying, setIsDeploying] = useState(false)
  const [deployForm, setDeployForm] = useState({ name: '', model: 'Qwen2.5 7B Instruct', gpu: 'L4', region: 'Hyderabad, IN' })
  const [deployToDelete, setDeployToDelete] = useState<Deployment | null>(null)

  // API Keys UI State
  const [showNewKeyModal, setShowNewKeyModal] = useState(false)
  const [newKeyName, setNewKeyName] = useState('')
  const [newKeyEnv, setNewKeyEnv] = useState<'live' | 'test'>('live')
  const [keysLoading, setKeysLoading] = useState(false)
  const [keysError, setKeysError] = useState<string | null>(null)
  const [createdSecretData, setCreatedSecretData] = useState<{ id: string; name: string; key: string } | null>(null)
  const [keyToRevoke, setKeyToRevoke] = useState<ApiKey | null>(null)
  const [showJwtModal, setShowJwtModal] = useState(false)

  const loadApiKeys = async () => {
    const session = getSession()
    if (!session?.token) {
      return
    }
    setKeysLoading(true)
    setKeysError(null)
    const res = await fetchBackendApiKeys()
    if (res.ok && res.keys) {
      const mapped: ApiKey[] = res.keys.map((k) => ({
        id: k.id,
        name: k.name,
        key: `${k.key_prefix}••••••••`,
        created: k.created_at ? new Date(k.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Recently',
        revoked: !k.is_active || Boolean(k.revoked_at),
        environment: k.environment,
        lastUsed: k.last_used_at ? new Date(k.last_used_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Never used',
      }))
      setKeys(mapped)
    } else if (res.error) {
      setKeysError(res.error)
    }
    setKeysLoading(false)
  }

  useEffect(() => {
    if (route === 'api-keys') {
      void loadApiKeys()
    }
  }, [route])

  // SSH Keys UI State
  const [showAddSshModal, setShowAddSshModal] = useState(false)
  const [newSshName, setNewSshName] = useState('')
  const [newSshKey, setNewSshKey] = useState('')
  const [sshModalError, setSshModalError] = useState('')
  const [sshError, setSshError] = useState<string | null>(null)
  const [sshLoading, setSshLoading] = useState(false)
  const [sshSubmitting, setSshSubmitting] = useState(false)
  const [sshKeyToDelete, setSshKeyToDelete] = useState<SshKey | null>(null)

  const loadSshKeys = async () => {
    const session = getSession()
    if (!session?.token) {
      setSshKeys([])
      return
    }
    setSshLoading(true)
    setSshError(null)
    const res = await fetchBackendSshKeys()
    if (res.ok && res.keys) {
      const mapped: SshKey[] = res.keys.map((k) => ({
        id: k.id,
        name: k.name,
        key: k.public_key,
        fingerprint: k.fingerprint,
        keyType: k.key_type,
        addedDate: k.created_at
          ? new Date(k.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
          : 'Recently',
      }))
      setSshKeys(mapped)
    } else if (res.error) {
      setSshError(res.error)
    }
    setSshLoading(false)
  }

  useEffect(() => {
    if (route === 'ssh-keys') {
      void loadSshKeys()
    }
  }, [route])

  // Orders UI State
  const [orderTab, setOrderTab] = useState<'All' | 'Running' | 'Completed' | 'Cancelled' | 'Archived'>('All')
  const [selectedOrder, setSelectedOrder] = useState<OrderItem | null>(null)
  const [orderToArchive, setOrderToArchive] = useState<OrderItem | null>(null)
  const [isArchiving, setIsArchiving] = useState(false)
  const [notifToDelete, setNotifToDelete] = useState<NotificationItem | null>(null)

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
  const [topUpAmount, setTopUpAmount] = useState<string>('10000')
  const [viewInvoiceItem, setViewInvoiceItem] = useState<TransactionItem | null>(null)

  const numericTopUp = Math.floor(Number(topUpAmount)) || 0

  const handleOpenTopUpModal = (prefill?: string) => {
    if (prefill) {
      setTopUpAmount(prefill)
    } else if (!topUpAmount || Number(topUpAmount) <= 0) {
      setTopUpAmount('10000')
    }
    setShowTopUpModal(true)
  }

  // Notifications Filter & Sorting
  const [notifFilter, setNotifFilter] = useState<'all' | 'unread' | 'read'>('all')
  const [notifSort, setNotifSort] = useState<'newest' | 'oldest'>('newest')

  // Analytics UI State
  const [analyticsRange, setAnalyticsRange] = useState<'24h' | '7d' | '30d'>('24h')

  // Provider State
  const [showAddListing, setShowAddListing] = useState(false)
  const [listingForm, setListingForm] = useState({ gpu: 'NVIDIA L4', vram: '24 GB', region: 'Hyderabad, IN', quantity: '4', price: '60' })
  const [editingListing, setEditingListing] = useState<Listing | null>(null)
  const [providerForm, setProviderForm] = useState({ company: 'Yotta Sovereign Infrastructure Ltd', contact: 'Anil Mehta', email: 'anil.mehta@yotta.com', regions: 'Mumbai NM1, Noida D1', apiType: 'REST + Daemon' })
  const [providerSaved, setProviderSaved] = useState(false)
  const [showPayoutModal, setShowPayoutModal] = useState(false)
  const [payoutHistory, setPayoutHistory] = useState<PayoutRecord[]>(() =>
    readStore(STORE.payouts, initialPayouts)
  )
  const [pendingPayout, setPendingPayout] = useState<number>(() =>
    readStore(STORE.pendingPayout, 72000)
  )
  const [payoutAmount, setPayoutAmount] = useState<string>('72000')
  const numericPayout = Math.floor(Number(payoutAmount)) || 0
  const [workloadTelemetry, setWorkloadTelemetry] = useState<Deployment | null>(null)

  const [profileName, setProfileName] = useState(sessionUser?.fullName || 'Priya Sharma')
  const [profileEmail] = useState(sessionUser?.email || 'priya.s@novatech.ai')
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
  useEffect(() => { saveStore(STORE.orders, orders) }, [orders])
  useEffect(() => { saveStore(STORE.wishlist, wishlist) }, [wishlist])
  useEffect(() => { saveStore(walletStorageKey, walletBalance) }, [walletStorageKey, walletBalance])
  useEffect(() => { saveStore(transactionsStorageKey, transactions) }, [transactionsStorageKey, transactions])
  useEffect(() => { saveStore(STORE.payouts, payoutHistory) }, [payoutHistory])
  useEffect(() => { saveStore(STORE.pendingPayout, pendingPayout) }, [pendingPayout])
  useEffect(() => {
    saveStore(STORE.notifications, notifications)
    try {
      window.dispatchEvent(new CustomEvent('inferxe_notifications_change'))
    } catch {}
  }, [notifications])
  useEffect(() => { setNotice(null); setSearch('') }, [route])

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

  const flash = (
    msg: string | { title: string; description?: string; detail?: string; icon?: 'server' | 'bell' | 'wallet' | 'check' },
    maybeDesc?: string
  ) => {
    if (noticeTimerRef.current) {
      window.clearTimeout(noticeTimerRef.current)
    }

    if (typeof msg === 'object' && msg !== null) {
      setNotice({
        title: msg.title,
        description: msg.description || msg.detail || '',
        icon: msg.icon || 'server',
      })
    } else if (maybeDesc) {
      setNotice({
        title: msg,
        description: maybeDesc,
        icon: 'server',
      })
    } else {
      const trimmed = msg.trim()
      const colonIdx = trimmed.indexOf(': ')
      const exclIdx = trimmed.indexOf('! ')

      if (colonIdx > 0 && colonIdx < 35) {
        setNotice({
          title: trimmed.substring(0, colonIdx).trim(),
          description: trimmed.substring(colonIdx + 2).trim(),
          icon: 'server',
        })
      } else if (exclIdx > 0 && exclIdx < 45) {
        setNotice({
          title: trimmed.substring(0, exclIdx + 1).trim(),
          description: trimmed.substring(exclIdx + 2).trim(),
          icon: 'server',
        })
      } else {
        let title = 'Notification'
        let icon: 'server' | 'bell' | 'wallet' | 'check' = 'server'
        if (/copi(ed|y)/i.test(trimmed)) {
          title = 'Copied to Clipboard'
        } else if (/deploy/i.test(trimmed)) {
          title = 'GPU Deployment Initialized'
          icon = 'server'
        } else if (/wallet|added to your wallet/i.test(trimmed)) {
          title = 'Wallet Recharge Successful'
          icon = 'wallet'
        } else if (/price/i.test(trimmed)) {
          title = 'GPU Price Updated'
          icon = 'bell'
        } else if (/key/i.test(trimmed)) {
          title = 'Access Key Generated'
          icon = 'server'
        } else if (/payout/i.test(trimmed)) {
          title = 'Payout Submitted'
          icon = 'wallet'
        } else if (/order/i.test(trimmed)) {
          title = 'Order Provisioned'
          icon = 'server'
        } else if (/alert|telemetry|audit|notice/i.test(trimmed)) {
          title = 'System Alert'
          icon = 'bell'
        } else if (/saved|updated|preferences/i.test(trimmed)) {
          title = 'Settings Saved'
        }
        setNotice({
          title,
          description: trimmed,
          icon,
        })
      }
    }

    noticeTimerRef.current = window.setTimeout(() => {
      setNotice(null)
    }, 3800)
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
    if (!deployForm.name.trim() || isDeploying) return

    setIsDeploying(true)
    const matchingListing = listings.find((l) => l.gpu === deployForm.gpu)
    const rate = matchingListing ? matchingListing.price : (deployForm.gpu.includes('H100') ? 275 : deployForm.gpu.includes('L40S') ? 100 : 60)

    const newDep: Deployment = {
      id: `dep-${Date.now().toString().slice(-4)}`,
      name: deployForm.name.trim().toLowerCase().replace(/\s+/g, '-'),
      model: deployForm.model,
      gpu: deployForm.gpu,
      region: deployForm.region,
      status: 'Running',
      hourlyRate: rate,
    }

    setDeployments((prev) => [newDep, ...prev])
    setIsDeploying(false)
    setShowDeployModal(false)
    setDeployForm({ name: '', model: 'Qwen2.5 7B Instruct', gpu: 'L4', region: 'Hyderabad, IN' })
    addNotification({
      title: `GPU Deployed: ${newDep.name}`,
      detail: `${newDep.model} running on ${newDep.gpu} (${newDep.region}) at ₹${newDep.hourlyRate}/hr.`,
      type: 'Deployment',
    })
    flash({
      title: 'GPU Deployment Initialized',
      description: `Deployment '${newDep.name}' (${newDep.id.toUpperCase()}) for ${newDep.model} on NVIDIA ${newDep.gpu} (${newDep.region}) has been requested and is currently provisioning.`,
      icon: 'server',
    })
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

  const handleCreateKey = async (e: FormEvent) => {
    e.preventDefault()
    const name = newKeyName.trim() || `API Key ${keys.length + 1}`
    const session = getSession()

    if (!session?.token) {
      flash('Please sign in with Cognito to generate production API keys.')
      return
    }

    setKeysLoading(true)
    const res = await createBackendApiKey(name, newKeyEnv)
    setKeysLoading(false)

    if (res.ok && res.data) {
      setShowNewKeyModal(false)
      setNewKeyName('')
      setNewKeyEnv('live')
      setCreatedSecretData({
        id: res.data.id,
        name: res.data.name,
        key: res.data.api_key,
      })
      flash(`API key "${name}" created and saved to PostgreSQL.`)
      void loadApiKeys()
    } else {
      flash(res.error || 'Failed to create API key.')
    }
  }

  const handleConfirmRevokeKey = async () => {
    if (!keyToRevoke) return
    setKeysLoading(true)
    const res = await revokeBackendApiKey(keyToRevoke.id)
    setKeysLoading(false)
    if (res.ok) {
      flash(`API key "${keyToRevoke.name}" revoked in PostgreSQL.`)
      setKeyToRevoke(null)
      void loadApiKeys()
    } else {
      flash(res.error || 'Failed to revoke API key.')
    }
  }

  const handleTopUpWallet = async (e: FormEvent) => {
    e.preventDefault()
    const amountNum = Math.floor(Number(topUpAmount))
    if (!amountNum || isNaN(amountNum) || amountNum <= 0) {
      flash('Please enter a valid amount greater than ₹0')
      return
    }

    const idemKey = `wallet_topup_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`
    const result = await topUpWallet(amountNum, idemKey, 'Wallet top-up (Demo)')

    if (!result.ok) {
      if (result.unauthorized) {
        flash('Session expired. Please sign in again.')
        return
      }
      flash(result.error || 'Wallet top-up failed. Please try again.')
      return
    }

    const newBalance = result.result!.new_balance
    setWalletBalance(newBalance)
    saveStore(walletStorageKey, newBalance)

    const newTx: TransactionItem = {
      id: result.result!.transaction_id,
      desc: 'Wallet top-up (Demo)',
      date: new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
      amount: amountNum,
      isCredit: true,
      status: 'Completed',
    }
    const updatedTxs = [newTx, ...transactions]
    setTransactions(updatedTxs)
    saveStore(transactionsStorageKey, updatedTxs)

    setShowTopUpModal(false)
    addNotification({
      title: `Wallet Credited: +₹${amountNum.toLocaleString('en-IN')}`,
      detail: `₹${amountNum.toLocaleString('en-IN')} successfully credited to compute wallet. Transaction ${result.result!.transaction_id} confirmed.`,
      type: 'Billing',
    })
    flash(`₹${amountNum.toLocaleString('en-IN')} added to your wallet! Transaction completed.`)

    try {
      window.dispatchEvent(new CustomEvent('inferxe_wallet_change', { detail: newBalance }))
    } catch {
      /* ignore */
    }

    if (route !== 'wallet' && route !== 'billing') {
      navigate('/dashboard/wallet')
    }
  }

  const handleAddSshKey = async (e: FormEvent) => {
    e.preventDefault()
    setSshModalError('')

    const trimmedKey = newSshKey.trim()
    const trimmedName = newSshName.trim()

    if (trimmedKey.includes('PRIVATE KEY')) {
      setSshModalError('Private keys are strictly forbidden. Please provide your OpenSSH public key (e.g. id_ed25519.pub).')
      return
    }

    if (!trimmedKey.startsWith('ssh-') && !trimmedKey.startsWith('ecdsa-')) {
      setSshModalError('Public key must begin with ssh-ed25519, ssh-rsa, or ecdsa-sha2-nistp256')
      return
    }

    setSshSubmitting(true)
    const res = await createBackendSshKey(trimmedName || 'Workstation Key', trimmedKey)
    setSshSubmitting(false)

    if (res.ok && res.data) {
      flash(`SSH Public Key "${res.data.name}" registered in PostgreSQL.`)
      setShowAddSshModal(false)
      setNewSshName('')
      setNewSshKey('')
      setSshModalError('')
      void loadSshKeys()
    } else {
      setSshModalError(res.error || 'Failed to register SSH key.')
    }
  }

  const handleConfirmDeleteSshKey = async () => {
    if (!sshKeyToDelete) return
    setSshSubmitting(true)
    const res = await deleteBackendSshKey(sshKeyToDelete.id)
    setSshSubmitting(false)

    if (res.ok) {
      flash(`SSH key "${sshKeyToDelete.name}" removed from PostgreSQL.`)
      setSshKeyToDelete(null)
      void loadSshKeys()
    } else {
      flash(res.error || 'Failed to delete SSH key.')
      setSshKeyToDelete(null)
    }
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

  const handleConfirmDeleteNotification = () => {
    if (!notifToDelete) return
    const idToDelete = notifToDelete.id
    setNotifications((prev) => prev.filter((item) => item.id !== idToDelete))
    setNotifToDelete(null)
    flash('Notification deleted.')
  }

  const handleConfirmArchiveOrder = async () => {
    if (!orderToArchive || isArchiving) return

    // Eligibility check: Running orders cannot be archived while active
    if (orderToArchive.status === 'Running') {
      flash('Running orders cannot be archived while GPU deployment is actively running.', 'error')
      setOrderToArchive(null)
      return
    }

    if (orderToArchive.is_archived || orderToArchive.status === 'Archived') {
      flash(`Order ${orderToArchive.id} is already archived.`)
      setOrderToArchive(null)
      return
    }

    setIsArchiving(true)
    try {
      await new Promise((resolve) => setTimeout(resolve, 200))

      const targetId = orderToArchive.id
      setOrders((prev) =>
        prev.map((o) =>
          o.id === targetId
            ? { ...o, is_archived: true }
            : o
        )
      )

      addNotification({
        title: `Order Archived: ${targetId}`,
        detail: `Moved ${orderToArchive.modelOrGpu} order to Archived section.`,
        type: 'Marketplace',
      })

      flash(`Order ${targetId} archived successfully. You can access it anytime from the Archived filter.`)
      setOrderToArchive(null)
    } catch {
      flash(`Failed to archive order ${orderToArchive.id}. Please try again.`, 'error')
    } finally {
      setIsArchiving(false)
    }
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

  const handleConfirmPayout = (e?: FormEvent) => {
    if (e) e.preventDefault()
    if (numericPayout <= 0) {
      flash('Please enter a valid amount greater than ₹0')
      return
    }
    if (numericPayout > pendingPayout) {
      flash(`Amount exceeds available pending payout of ${money(pendingPayout)}`)
      return
    }

    let maxNum = 10
    for (const r of payoutHistory) {
      const m = r.id.match(/PO-(\d{4})-(\d+)/)
      if (m) {
        const n = parseInt(m[2], 10)
        if (n > maxNum) maxNum = n
      }
    }
    const nextSeq = String(maxNum + 1).padStart(2, '0')
    const currentYear = new Date().getFullYear()
    const nextId = `PO-${currentYear}-${nextSeq}`
    const currentPeriod = new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    const fee = Math.round(numericPayout * 0.12)
    const net = Math.round(numericPayout * 0.88)

    const newRecord: PayoutRecord = {
      id: nextId,
      period: currentPeriod,
      gross: numericPayout,
      fee,
      net,
      status: 'Pending',
    }

    const updatedHistory = [...payoutHistory, newRecord]
    const updatedPending = Math.max(0, pendingPayout - numericPayout)

    setPayoutHistory(updatedHistory)
    setPendingPayout(updatedPending)
    saveStore(STORE.payouts, updatedHistory)
    saveStore(STORE.pendingPayout, updatedPending)

    setShowPayoutModal(false)
    addNotification({
      title: `Payout Requested: ${nextId}`,
      detail: `Withdrawal request for ${money(numericPayout)} (Net ${money(net)}) initiated via RTGS/NEFT.`,
      type: 'Billing',
    })
    flash(`Payout request ${nextId} of ${money(numericPayout)} submitted successfully!`)
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
        {/* Action Toast Feedback - Matching Image 2 Reference */}
        {notice && (
          <div className="mw-toast" role="status" aria-live="polite">
            <div className="mw-toast-icon-wrap">
              {notice.icon === 'wallet' ? (
                <Wallet size={20} strokeWidth={2.2} />
              ) : notice.icon === 'bell' ? (
                <Bell size={20} strokeWidth={2.2} />
              ) : (
                <Server size={20} strokeWidth={2.2} />
              )}
            </div>
            <div className="mw-toast-content">
              <div className="mw-toast-title">{notice.title}</div>
              {notice.description && (
                <div className="mw-toast-desc">{notice.description}</div>
              )}
            </div>
            <button
              className="mw-toast-close"
              onClick={() => {
                if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current)
                setNotice(null)
              }}
              aria-label="Dismiss notification"
            >
              <X size={15} />
            </button>
            <div className="mw-toast-progress">
              <div className="mw-toast-progress-bar" />
            </div>
          </div>
        )}

        {/* ───────────────────────────────────────────────────────────
            1. CUSTOMER PORTAL OVERVIEW (route === 'customer')
            Matching Zesto Cyber-Dark Design with Real Inferxe Data
            ─────────────────────────────────────────────────────────── */}
        {route === 'customer' && (() => {
          const session = getSession()
          const fullName = session?.user.fullName || 'Priya Sharma'
          const firstName = fullName.split(' ')[0]
          const running = deployments.filter((d) => d.status === 'Running')
          const burn = running.reduce((s, d) => s + (d.hourlyRate ?? 0), 0)
          const hoursLeft = burn > 0 ? walletBalance / burn : null
          const spend = transactions.filter((t) => !t.isCredit).reduce((s, t) => s + t.amount, 0)
          const trialActive = trialTimeLeft !== null && trialTimeLeft > 0
          const trialLabel =
            trialTimeLeft === null ? 'Not started' : trialTimeLeft > 0 ? `${Math.floor(trialTimeLeft / 60000)}m ${String(Math.floor((trialTimeLeft % 60000) / 1000)).padStart(2, '0')}s` : 'Expired'

          // Model initials badge helper (DS, LL, QW, MI)
          const getModelInitials = (modelName: string, depName: string) => {
            const combined = `${modelName} ${depName}`.toLowerCase()
            if (combined.includes('deepseek')) return 'DS'
            if (combined.includes('llama')) return 'LL'
            if (combined.includes('qwen')) return 'QW'
            if (combined.includes('mistral')) return 'MI'
            if (combined.includes('gemma')) return 'GM'
            return (modelName.substring(0, 2) || 'IX').toUpperCase()
          }

          // Filtered deployments for Kanban board
          const filteredDeployments = deployments.filter((d) => {
            if (customerModelFilter === 'all') return true
            const q = customerModelFilter.toLowerCase()
            return (
              d.model.toLowerCase().includes(q) ||
              d.name.toLowerCase().includes(q) ||
              d.gpu.toLowerCase().includes(q) ||
              d.region.toLowerCase().includes(q)
            )
          })

          const kanbanRunning = filteredDeployments.filter((d) => d.status === 'Running')
          const kanbanProvisioning = filteredDeployments.filter((d) => d.status === 'Provisioning')
          const kanbanStopped = filteredDeployments.filter((d) => d.status === 'Stopped')

          // 30-day activity data bars with multi-colors matching photo 7
          const barColors = ['#d4ff00', '#00e5ff', '#ff5c72', '#ffd600', '#ff9100']
          const activityDays = [
            { day: 1, val: 35, color: barColors[0], hrs: 14.2 },
            { day: 2, val: 50, color: barColors[1], hrs: 22.5 },
            { day: 3, val: 28, color: barColors[2], hrs: 11.0 },
            { day: 4, val: 65, color: barColors[0], hrs: 29.8 },
            { day: 5, val: 42, color: barColors[3], hrs: 18.4 },
            { day: 6, val: 80, color: barColors[4], hrs: 38.0 },
            { day: 7, val: 95, color: barColors[0], hrs: 48.0 },
            { day: 8, val: 60, color: barColors[1], hrs: 28.2 },
            { day: 9, val: 45, color: barColors[2], hrs: 20.1 },
            { day: 10, val: 70, color: barColors[3], hrs: 33.4 },
            { day: 11, val: 85, color: barColors[0], hrs: 41.2 },
            { day: 12, val: 55, color: barColors[4], hrs: 25.8 },
            { day: 13, val: 40, color: barColors[1], hrs: 18.0 },
            { day: 14, val: 68, color: barColors[0], hrs: 31.5 },
            { day: 15, val: 32, color: barColors[2], hrs: 14.5 },
            { day: 16, val: 74, color: barColors[3], hrs: 35.0 },
            { day: 17, val: 88, color: barColors[0], hrs: 42.8 },
            { day: 18, val: 62, color: barColors[4], hrs: 28.6 },
            { day: 19, val: 50, color: barColors[1], hrs: 23.0 },
            { day: 20, val: 78, color: barColors[0], hrs: 36.9 },
            { day: 21, val: 92, color: barColors[2], hrs: 46.5 },
            { day: 22, val: 58, color: barColors[3], hrs: 27.0 },
            { day: 23, val: 44, color: barColors[4], hrs: 19.8 },
            { day: 24, val: 66, color: barColors[0], hrs: 30.4 },
            { day: 25, val: 72, color: barColors[1], hrs: 34.0 },
            { day: 26, val: 84, color: barColors[0], hrs: 39.5 },
            { day: 27, val: 56, color: barColors[2], hrs: 26.2 },
            { day: 28, val: 64, color: barColors[3], hrs: 30.1 },
            { day: 29, val: 76, color: barColors[4], hrs: 36.0 },
            { day: 30, val: 90, color: barColors[0], hrs: 44.5 },
          ]

          return (
            <div className="zesto-customer-view">
              {/* 1. Greeting Header Row (Photos 1, 2, 4) */}
              <div className="zesto-greeting-header">
                <div>
                  <div className="zesto-greeting-status">
                    <span className="zesto-pulse-dot" />
                    <span>Sovereign Yotta NM1 &amp; E2E Clusters Connected • 4ms SLA</span>
                  </div>
                  <h1 className="zesto-greeting-title">
                    Hello, {firstName}
                  </h1>
                  <p className="zesto-greeting-sub">
                    {running.length > 0
                      ? `${running.length} GPU node${running.length > 1 ? 's' : ''} live &amp; processing inference · ${money(burn)}/hr burn`
                      : 'No live GPUs active right now. Deploy from marketplace to start inference.'}
                  </p>
                </div>

                <div className="zesto-greeting-actions">
                  <button
                    type="button"
                    className="zesto-btn-glass"
                    onClick={() => navigate('/dashboard/playground')}
                  >
                    <Terminal size={14} /> Playground
                  </button>
                  <button
                    type="button"
                    className="zesto-btn-lime-pill"
                    onClick={() => setShowDeployModal(true)}
                  >
                    <Plus size={14} /> Deploy a GPU
                  </button>
                </div>
              </div>

              {/* 2. Top Grid: Signature Hero Gradient Mesh + 30-Day Activity Chart (Photos 3 & 7) */}
              <div className="zesto-top-grid">
                {/* Hero Card: Vibrant Neon-Lime Gradient Mesh */}
                <div className="zesto-hero-card">
                  <div className="zesto-hero-header">
                    <span className="zesto-hero-tag">
                      <Zap size={15} style={{ fill: '#0b0d0e' }} />
                      Compute Balance &amp; Credits
                    </span>
                    <div className="zesto-hero-badges">
                      <span className="zesto-hero-badge">Tier IV</span>
                      <span className="zesto-hero-badge">Sovereign IN</span>
                    </div>
                  </div>

                  <div>
                    <div className="zesto-hero-amount">
                      {hideBalance ? '••••••••' : money(walletBalance)}
                    </div>

                    {/* Smooth glowing bezier curve */}
                    <svg className="zesto-hero-sparkline" viewBox="0 0 320 40" fill="none" preserveAspectRatio="none">
                      <path
                        d="M0 32 Q 40 10, 80 24 T 160 8 T 240 28 T 320 6"
                        stroke="#0b0d0e"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        fill="none"
                        opacity="0.85"
                      />
                    </svg>

                    <div className="zesto-hero-submetrics">
                      <span>Burn: {money(burn)}/hr</span>
                      <span>•</span>
                      <span>
                        Runtime: {hoursLeft === null ? 'No active burn' : `≈ ${hoursLeft.toFixed(1)} hrs left`}
                      </span>
                      <span>•</span>
                      <span>{running.length} GPU{running.length !== 1 ? 's' : ''} active</span>
                    </div>
                  </div>

                  <div className="zesto-hero-actions">
                    <button
                      type="button"
                      className="zesto-hero-action-btn"
                      onClick={() => handleOpenTopUpModal()}
                    >
                      <Plus size={13} /> Add Funds
                    </button>
                    <button
                      type="button"
                      className="zesto-hero-action-btn"
                      onClick={() => navigate('/dashboard/playground')}
                    >
                      <Terminal size={13} /> Playground
                    </button>
                    <button
                      type="button"
                      className="zesto-hero-action-btn"
                      onClick={() => navigate('/dashboard/api-keys')}
                    >
                      <KeyRound size={13} /> API Keys
                    </button>
                    <button
                      type="button"
                      className="zesto-hero-action-btn"
                      onClick={() => navigate('/dashboard/compare')}
                    >
                      <Layers size={13} /> Compare
                    </button>
                  </div>
                </div>

                {/* 30-Day Activity Bar Chart Card (Photo 7) */}
                <div className="zesto-chart-card">
                  <div className="zesto-chart-header">
                    <div>
                      <h3 className="zesto-chart-title">30-Day Activity</h3>
                      <p className="zesto-chart-sub">Cluster inference runtime hours &amp; traffic</p>
                    </div>
                    <div className="zesto-chart-pills">
                      {(['7D', '14D', '30D', '90D'] as const).map((rng) => (
                        <button
                          key={rng}
                          type="button"
                          className={`zesto-chart-pill ${customerChartRange === rng ? 'is-active' : ''}`}
                          onClick={() => setCustomerChartRange(rng)}
                        >
                          {rng}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="zesto-bars-wrap">
                    {activityDays.map((bar) => (
                      <div
                        key={bar.day}
                        className="zesto-bar-col"
                        title={`Day ${bar.day}: ${bar.hrs} hrs compute runtime`}
                      >
                        <div
                          className="zesto-bar"
                          style={{
                            height: `${bar.val}%`,
                            background: bar.color,
                          }}
                        />
                      </div>
                    ))}
                  </div>

                  <div className="zesto-chart-footer">
                    <span>Total Compute: <strong>842.5 hrs</strong></span>
                    <span>Daily Avg: <strong>28.1 hrs</strong></span>
                    <span>Peak Day: <strong>48.0 hrs</strong></span>
                  </div>
                </div>
              </div>

              {/* 3. Middle 4 Stat Cards with Sparklines (Photos 3 & 7) */}
              <div className="zesto-stats-grid">
                {/* Metric 1: Running GPUs */}
                <div className="zesto-stat-card">
                  <div className="zesto-stat-top">
                    <span className="zesto-stat-label">Running GPUs</span>
                    <span className="zesto-stat-icon-box"><Server size={14} /></span>
                  </div>
                  <div className="zesto-stat-value">
                    {running.length} <span style={{ fontSize: '0.85rem', color: '#6b7280', fontWeight: 500 }}>of {deployments.length}</span>
                  </div>
                  <svg width="100%" height="22" viewBox="0 0 140 22" fill="none">
                    <path d="M0 16 Q 35 4, 70 12 T 140 6" stroke="#d4ff00" strokeWidth="2" fill="none" />
                  </svg>
                  <div className="zesto-stat-bottom">
                    <span style={{ color: '#d4ff00' }}>●</span>
                    <span>{money(burn)}/hr live burn</span>
                  </div>
                </div>

                {/* Metric 2: Spend This Month */}
                <div className="zesto-stat-card">
                  <div className="zesto-stat-top">
                    <span className="zesto-stat-label">Spend This Month</span>
                    <span className="zesto-stat-icon-box"><CircleDollarSign size={14} /></span>
                  </div>
                  <div className="zesto-stat-value">{money(spend)}</div>
                  <svg width="100%" height="22" viewBox="0 0 140 22" fill="none">
                    <path d="M0 18 Q 30 14, 60 8 T 140 4" stroke="#00e5ff" strokeWidth="2" fill="none" />
                  </svg>
                  <div className="zesto-stat-bottom">
                    <span style={{ color: '#10b981' }}>↑ 12%</span>
                    <span>vs last billing cycle</span>
                  </div>
                </div>

                {/* Metric 3: Safe Daily Spend */}
                <div className="zesto-stat-card">
                  <div className="zesto-stat-top">
                    <span className="zesto-stat-label">Safe Daily Spend</span>
                    <span className="zesto-stat-icon-box"><ShieldCheck size={14} /></span>
                  </div>
                  <div className="zesto-stat-value">₹1,200<span style={{ fontSize: '0.82rem', color: '#6b7280' }}>/day</span></div>
                  <div style={{ height: 4, background: 'rgba(255,255,255,0.08)', borderRadius: 999, overflow: 'hidden', margin: '9px 0 6px' }}>
                    <div style={{ width: '64%', height: '100%', background: '#d4ff00', borderRadius: 999 }} />
                  </div>
                  <div className="zesto-stat-bottom">
                    <span>64% of budget utilized</span>
                  </div>
                </div>

                {/* Metric 4: Sandbox Trial */}
                <div className="zesto-stat-card">
                  <div className="zesto-stat-top">
                    <span className="zesto-stat-label">Sandbox Trial</span>
                    <span className="zesto-stat-icon-box"><Sparkles size={14} /></span>
                  </div>
                  <div className="zesto-stat-value">{trialLabel}</div>
                  <svg width="100%" height="22" viewBox="0 0 140 22" fill="none">
                    <path d="M0 12 Q 35 18, 70 8 T 140 14" stroke="#ffd600" strokeWidth="2" fill="none" />
                  </svg>
                  <div className="zesto-stat-bottom">
                    {trialTimeLeft === null ? (
                      <button
                        type="button"
                        onClick={startTrial}
                        style={{ background: 'none', border: 'none', color: '#d4ff00', padding: 0, font: 'inherit', cursor: 'pointer', textDecoration: 'underline' }}
                      >
                        Start 1-hr trial
                      </button>
                    ) : trialActive ? (
                      <span>Sandbox credits active</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleOpenTopUpModal()}
                        style={{ background: 'none', border: 'none', color: '#d4ff00', padding: 0, font: 'inherit', cursor: 'pointer', textDecoration: 'underline' }}
                      >
                        Top up to renew
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* 4. Section Tabs with Neon-Lime Underline (Photos 1 & 2) */}
              <div className="zesto-section-tabs">
                <button
                  type="button"
                  className={`zesto-tab-btn ${customerSectionTab === 'workloads' ? 'is-active' : ''}`}
                  onClick={() => setCustomerSectionTab('workloads')}
                >
                  <span>Workloads (Kanban)</span>
                  <span className="zesto-tab-badge">{deployments.length}</span>
                </button>
                <button
                  type="button"
                  className={`zesto-tab-btn ${customerSectionTab === 'marketplace' ? 'is-active' : ''}`}
                  onClick={() => setCustomerSectionTab('marketplace')}
                >
                  <span>GPU Marketplace</span>
                  <span className="zesto-tab-badge">{listings.length}</span>
                </button>
                <button
                  type="button"
                  className={`zesto-tab-btn ${customerSectionTab === 'orders' ? 'is-active' : ''}`}
                  onClick={() => setCustomerSectionTab('orders')}
                >
                  <span>Recent Orders</span>
                  <span className="zesto-tab-badge">{orders.length}</span>
                </button>
              </div>

              {/* Subfilter Pills Bar */}
              <div className="zesto-subfilter-bar">
                <div className="zesto-filter-pill-group">
                  {[
                    { id: 'all', label: 'All Workloads' },
                    { id: 'deepseek', label: 'DeepSeek R1' },
                    { id: 'llama', label: 'Llama 3.3 / 3.1' },
                    { id: 'qwen', label: 'Qwen 2.5' },
                    { id: 'mistral', label: 'Mistral' },
                    { id: 'yotta', label: 'Yotta (Mumbai)' },
                  ].map((flt) => (
                    <button
                      key={flt.id}
                      type="button"
                      className={`zesto-filter-pill ${customerModelFilter === flt.id ? 'is-active' : ''}`}
                      onClick={() => setCustomerModelFilter(flt.id)}
                    >
                      {flt.label}
                    </button>
                  ))}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <button
                    type="button"
                    className="zesto-btn-glass"
                    style={{ fontSize: '0.74rem', padding: '5px 12px' }}
                    onClick={() => setShowDeployModal(true)}
                  >
                    <Plus size={13} /> New Deployment
                  </button>
                </div>
              </div>

              {/* 5. TAB 1: 3-Column Interactive Kanban Board (Photos 1 & 2) */}
              {customerSectionTab === 'workloads' && (
                <div className="zesto-kanban-board">
                  {/* Column 1: Running GPUs */}
                  <div className="zesto-kanban-col">
                    <div className="zesto-col-header">
                      <div className="zesto-col-title-wrap">
                        <span className="zesto-col-title">
                          Running GPUs
                          <span className="zesto-col-badge">{kanbanRunning.length}</span>
                        </span>
                        <span className="zesto-col-sub">Live inference &amp; training nodes</span>
                      </div>
                    </div>

                    {kanbanRunning.length === 0 ? (
                      <div style={{ padding: '36px 16px', textAlign: 'center', color: '#6b7280', fontSize: '0.82rem' }}>
                        <Server size={28} style={{ margin: '0 auto 10px', opacity: 0.4 }} />
                        <p style={{ margin: 0 }}>No running instances matching filter.</p>
                        <button
                          type="button"
                          className="zesto-btn-lime-pill"
                          style={{ marginTop: 14, fontSize: '0.75rem', padding: '6px 14px' }}
                          onClick={() => setShowDeployModal(true)}
                        >
                          <Plus size={12} /> Deploy a GPU
                        </button>
                      </div>
                    ) : (
                      kanbanRunning.map((d) => {
                        const initials = getModelInitials(d.model, d.name)
                        return (
                          <div className="zesto-card-item" key={d.id}>
                            <div className="zesto-card-top">
                              <div className="zesto-avatar-pill">{initials}</div>
                              <div className="zesto-card-details">
                                <h4 className="zesto-card-title">{d.name}</h4>
                                <div className="zesto-card-meta">{d.model}</div>
                                <div style={{ fontSize: '0.72rem', color: '#9ca3af', marginTop: 2 }}>
                                  {d.gpu} • {d.region}
                                </div>
                              </div>
                              <div className="zesto-card-price-badge">
                                {money(d.hourlyRate ?? 0)}/hr
                              </div>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.72rem', color: '#d4ff00', marginTop: 2 }}>
                              <span className="zesto-pulse-dot" />
                              <span>Live cluster node • 4ms SLA</span>
                            </div>

                            <div className="zesto-card-footer">
                              <button
                                type="button"
                                className="zesto-card-action-btn zesto-card-action-btn--glass"
                                onClick={() => navigate('/dashboard/playground')}
                              >
                                <Terminal size={11} /> Playground
                              </button>
                              <button
                                type="button"
                                className="zesto-card-action-btn zesto-card-action-btn--glass"
                                onClick={() => handleToggleDeployment(d.id, 'stop')}
                              >
                                Stop Node
                              </button>
                            </div>
                          </div>
                        )
                      })
                    )}
                  </div>

                  {/* Column 2: Provisioning & Queued */}
                  <div className="zesto-kanban-col">
                    <div className="zesto-col-header">
                      <div className="zesto-col-title-wrap">
                        <span className="zesto-col-title">
                          Provisioning &amp; Queued
                          <span className="zesto-col-badge" style={{ background: '#00e5ff', color: '#0b0d0e' }}>
                            {kanbanProvisioning.length}
                          </span>
                        </span>
                        <span className="zesto-col-sub">Allocating bare-metal nodes &amp; weights</span>
                      </div>
                    </div>

                    {kanbanProvisioning.length === 0 ? (
                      <div style={{ padding: '36px 16px', textAlign: 'center', color: '#6b7280', fontSize: '0.82rem' }}>
                        <Zap size={28} style={{ margin: '0 auto 10px', opacity: 0.4 }} />
                        <p style={{ margin: 0 }}>Queue is clear. All nodes allocated.</p>
                      </div>
                    ) : (
                      kanbanProvisioning.map((d) => {
                        const initials = getModelInitials(d.model, d.name)
                        return (
                          <div className="zesto-card-item" key={d.id}>
                            <div className="zesto-card-top">
                              <div className="zesto-avatar-pill" style={{ borderColor: 'rgba(0,229,255,0.4)', color: '#00e5ff' }}>
                                {initials}
                              </div>
                              <div className="zesto-card-details">
                                <h4 className="zesto-card-title">{d.name}</h4>
                                <div className="zesto-card-meta">{d.model}</div>
                                <div style={{ fontSize: '0.72rem', color: '#9ca3af', marginTop: 2 }}>
                                  {d.gpu} • {d.region}
                                </div>
                              </div>
                              <div className="zesto-card-price-badge" style={{ color: '#00e5ff', borderColor: 'rgba(0,229,255,0.3)', background: 'rgba(0,229,255,0.1)' }}>
                                {money(d.hourlyRate ?? 0)}/hr
                              </div>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.72rem', color: '#00e5ff', marginTop: 2 }}>
                              <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: '#00e5ff' }} />
                              <span>Warming weights in VRAM (85%)...</span>
                            </div>

                            <div className="zesto-card-footer">
                              <span style={{ fontSize: '0.7rem', color: '#6b7280' }}>Est. ~45s remaining</span>
                              <button
                                type="button"
                                className="zesto-card-action-btn zesto-card-action-btn--lime"
                                onClick={() => handleToggleDeployment(d.id, 'start')}
                              >
                                Ready to Start
                              </button>
                            </div>
                          </div>
                        )
                      })
                    )}
                  </div>

                  {/* Column 3: Completed / Standby */}
                  <div className="zesto-kanban-col">
                    <div className="zesto-col-header">
                      <div className="zesto-col-title-wrap">
                        <span className="zesto-col-title">
                          Standby &amp; Snapshots
                          <span className="zesto-col-badge" style={{ background: '#6b7280', color: '#ffffff' }}>
                            {kanbanStopped.length}
                          </span>
                        </span>
                        <span className="zesto-col-sub">Saved checkpoints ready to resume</span>
                      </div>
                    </div>

                    {kanbanStopped.length === 0 ? (
                      <div style={{ padding: '36px 16px', textAlign: 'center', color: '#6b7280', fontSize: '0.82rem' }}>
                        <Layers size={28} style={{ margin: '0 auto 10px', opacity: 0.4 }} />
                        <p style={{ margin: 0 }}>No stopped nodes. All clusters are live or unprovisioned.</p>
                      </div>
                    ) : (
                      kanbanStopped.map((d) => {
                        const initials = getModelInitials(d.model, d.name)
                        return (
                          <div className="zesto-card-item" key={d.id}>
                            <div className="zesto-card-top">
                              <div className="zesto-avatar-pill" style={{ borderColor: 'rgba(255,255,255,0.15)', color: '#9ca3af' }}>
                                {initials}
                              </div>
                              <div className="zesto-card-details">
                                <h4 className="zesto-card-title">{d.name}</h4>
                                <div className="zesto-card-meta">{d.model}</div>
                                <div style={{ fontSize: '0.72rem', color: '#9ca3af', marginTop: 2 }}>
                                  {d.gpu} • {d.region}
                                </div>
                              </div>
                              <div className="zesto-card-price-badge" style={{ color: '#9ca3af', borderColor: 'rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.05)' }}>
                                {money(d.hourlyRate ?? 0)}/hr
                              </div>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.72rem', color: '#6b7280', marginTop: 2 }}>
                              <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: '#6b7280' }} />
                              <span>Snapshot stored in NVMe cluster</span>
                            </div>

                            <div className="zesto-card-footer">
                              <button
                                type="button"
                                className="zesto-card-action-btn zesto-card-action-btn--lime"
                                onClick={() => handleToggleDeployment(d.id, 'start')}
                              >
                                <Play size={11} /> Resume Node
                              </button>
                              <button
                                type="button"
                                className="zesto-card-action-btn zesto-card-action-btn--glass"
                                onClick={() => setDeployToDelete(d)}
                              >
                                <Trash2 size={11} />
                              </button>
                            </div>
                          </div>
                        )
                      })
                    )}
                  </div>
                </div>
              )}

              {/* 6. TAB 2: GPU Marketplace Grid (Photos 4 & 5) */}
              {customerSectionTab === 'marketplace' && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
                  {listings.map((item) => (
                    <div key={item.id} className="zesto-card-item">
                      <div className="zesto-card-top">
                        <div className="zesto-avatar-pill">
                          <Cpu size={16} />
                        </div>
                        <div className="zesto-card-details">
                          <h4 className="zesto-card-title">{item.name}</h4>
                          <div className="zesto-card-meta">{item.gpu} • {item.vram} VRAM</div>
                          <div style={{ fontSize: '0.72rem', color: '#9ca3af', marginTop: 2 }}>
                            {item.region} • {item.quantity} available
                          </div>
                        </div>
                        <div className="zesto-card-price-badge">
                          {money(item.price)}/hr
                        </div>
                      </div>

                      <div style={{ fontSize: '0.72rem', color: '#9ca3af', background: 'rgba(255,255,255,0.03)', padding: '6px 10px', borderRadius: 8 }}>
                        {item.bandwidth && <span>Bandwidth: {item.bandwidth} • </span>}
                        {item.tflops && <span>TFLOPS: {item.tflops}</span>}
                      </div>

                      <div className="zesto-card-footer">
                        <span style={{ color: '#d4ff00', fontSize: '0.72rem' }}>● In Stock</span>
                        <button
                          type="button"
                          className="zesto-card-action-btn zesto-card-action-btn--lime"
                          onClick={() => {
                            setDeployForm((prev) => ({ ...prev, gpu: item.gpu, region: item.region }))
                            setShowDeployModal(true)
                          }}
                        >
                          <Plus size={11} /> Deploy Now
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* 7. TAB 3: Recent Orders (Photos 4 & 6) */}
              {customerSectionTab === 'orders' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {orders.map((ord) => (
                    <div
                      key={ord.id}
                      className="zesto-card-item"
                      style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 14 }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div className="zesto-avatar-pill">
                          <Activity size={15} />
                        </div>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <strong style={{ color: '#ffffff', fontSize: '0.88rem' }}>{ord.id}</strong>
                            <span className="zesto-card-price-badge" style={{ fontSize: '0.7rem' }}>
                              {ord.status}
                            </span>
                          </div>
                          <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: 2 }}>
                            {ord.modelOrGpu} • {ord.provider}
                          </div>
                          <div style={{ fontSize: '0.7rem', color: '#6b7280', marginTop: 1 }}>
                            {ord.date} • Duration: {ord.duration}
                          </div>
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: '1rem', fontWeight: 700, color: '#ffffff' }}>
                            {money(ord.cost)}
                          </div>
                          <div style={{ fontSize: '0.7rem', color: '#9ca3af' }}>Billed to Wallet</div>
                        </div>

                        {ord.status === 'Completed' ? (
                          <Link
                            to="/dashboard/reviews"
                            className="zesto-card-action-btn zesto-card-action-btn--glass"
                            style={{ textDecoration: 'none' }}
                          >
                            Rate Workload
                          </Link>
                        ) : (
                          <Link
                            to="/dashboard/orders"
                            className="zesto-card-action-btn zesto-card-action-btn--glass"
                            style={{ textDecoration: 'none' }}
                          >
                            Details
                          </Link>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* 8. Floating Bottom Toast Pill (Photos 2, 3, 4) */}
              {customerToastVisible && (
                <div className="zesto-floating-toast">
                  <span className="zesto-toast-icon">
                    <Check size={16} />
                  </span>
                  <span>Connected to Sovereign Yotta NM1 Cluster • 4ms latency</span>
                  <button
                    type="button"
                    className="zesto-toast-btn"
                    onClick={() => setCustomerToastVisible(false)}
                  >
                    Dismiss
                  </button>
                </div>
              )}
            </div>
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

            {/* Model Comparison Sticky Prompt */}
            {comparedModelIds.length > 0 && (
              <div className="mw-compare-bar">
                <span style={{ fontSize: '0.8rem', color: 'var(--ink)' }}>
                  Selected <strong>{comparedModelIds.length}</strong> LLM model{comparedModelIds.length === 1 ? '' : 's'} for side-by-side comparison.
                </span>
                <div className="row" style={{ gap: 8 }}>
                  <button
                    type="button"
                    className="mw-secondary"
                    onClick={() => setComparedModelIds([])}
                    style={{ minHeight: 32, padding: '4px 10px' }}
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    className="mw-primary"
                    onClick={() => setShowModelCompareModal(true)}
                    style={{ minHeight: 32, padding: '4px 12px' }}
                  >
                    View Comparison
                  </button>
                </div>
              </div>
            )}

            {/* Model Cards Grid */}
            <div className="mw-models-grid">
              {filteredModels.map((m) => {
                const isSel = m.id === selectedModel.id
                const isCompared = comparedModelIds.includes(m.id)
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

                    <div className="row" style={{ gap: 8, marginTop: 'auto', width: '100%' }}>
                      <button
                        type="button"
                        className="mw-primary"
                        style={{ flex: 1, justifyContent: 'center' }}
                        onClick={(e) => {
                          e.stopPropagation()
                          setSelectedModelId(m.id)
                          setDeployForm((f) => ({
                            ...f,
                            model: m.name,
                            gpu: m.params >= 70 ? 'H100' : m.params >= 14 ? 'L40S' : (f.gpu || 'L4'),
                          }))
                          setShowDeployModal(true)
                        }}
                      >
                        Select & Deploy <span>→</span>
                      </button>
                      <button
                        type="button"
                        className={isCompared ? 'mw-primary' : 'mw-secondary'}
                        onClick={(e) => {
                          e.stopPropagation()
                          setComparedModelIds((prev) =>
                            prev.includes(m.id) ? prev.filter((id) => id !== m.id) : [...prev, m.id]
                          )
                        }}
                        title={isCompared ? 'Remove from Comparison' : 'Add to Comparison'}
                      >
                        {isCompared ? 'Compared' : 'Compare'}
                      </button>
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
                <p>Generate and manage PostgreSQL-backed authentication keys for Inferxe Nemotron Inference API.</p>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                {keysLoading && <span className="mw-muted" style={{ display: 'flex', alignItems: 'center', fontSize: '0.8rem' }}>Syncing...</span>}
                <button className="mw-primary" onClick={() => setShowNewKeyModal(true)}>
                  <Plus size={16} /> Create API Key
                </button>
              </div>
            </div>

            {!getSession()?.token && (
              <div style={{ padding: '12px 16px', background: 'rgba(234, 179, 8, 0.1)', border: '1px solid rgba(234, 179, 8, 0.3)', borderRadius: 8, marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.82rem', color: '#eab308' }}>
                  <strong>Authentication Notice:</strong> Please sign in with your Cognito account to manage persistent production API keys.
                </span>
                <Link to="/login" style={{ fontSize: '0.8rem', color: 'var(--brand-hi)', textDecoration: 'underline' }}>Sign In</Link>
              </div>
            )}

            {keysError && (
              <div style={{ padding: '12px 16px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: 8, marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.82rem', color: '#ef4444' }}>{keysError}</span>
                <button className="mw-secondary" style={{ padding: '4px 10px', fontSize: '0.76rem' }} onClick={() => void loadApiKeys()}>Retry</button>
              </div>
            )}

            <div className="mw-panel">
              <div className="mw-panel-head">
                <h3>Issued API Keys</h3>
                <span className="mw-muted">{keys.filter((k) => !k.revoked).length} active</span>
              </div>

              {keys.length === 0 && !keysLoading ? (
                <div className="mw-empty">
                  <span className="mw-icon-box"><KeyRound size={22} /></span>
                  <h3>No API Keys Issued</h3>
                  <p>Generate a secure key to authenticate with the Inferxe PostgreSQL inference gateway.</p>
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
                        <th>Prefix / Key</th>
                        <th>Environment</th>
                        <th>Issued Date</th>
                        <th>Last Used</th>
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
                            <code>{k.key}</code>
                          </td>
                          <td>
                            <span style={{
                              fontSize: '0.68rem',
                              padding: '2px 7px',
                              borderRadius: 4,
                              background: k.environment === 'test' ? 'rgba(59, 130, 246, 0.15)' : 'rgba(34, 197, 94, 0.15)',
                              color: k.environment === 'test' ? '#60a5fa' : '#4ade80',
                              border: k.environment === 'test' ? '1px solid rgba(59, 130, 246, 0.3)' : '1px solid rgba(34, 197, 94, 0.3)',
                              fontWeight: 600,
                              textTransform: 'uppercase'
                            }}>
                              {k.environment || 'live'}
                            </span>
                          </td>
                          <td>{k.created}</td>
                          <td style={{ fontSize: '0.8rem', color: 'var(--ink-3)' }}>{k.lastUsed || 'Never'}</td>
                          <td><StatusBadge>{k.revoked ? 'Revoked' : 'Active'}</StatusBadge></td>
                          <td>
                            {!k.revoked && (
                              <div className="mw-actions">
                                <button
                                  onClick={() => {
                                    void navigator.clipboard?.writeText(k.key.replace(/•/g, ''))
                                    flash('Key prefix copied to clipboard.')
                                  }}
                                >
                                  <Copy size={13} /> Copy Prefix
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
        {route === 'notebooks' && <NotebooksSection deployments={deployments} flash={flash} addNotification={addNotification} />}
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
              <button className="mw-primary" onClick={() => handleOpenTopUpModal()}>
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
                <strong>{money(monthSpend)}</strong>
                <small>{monthSpend === 0 ? 'No usage this month' : `${Math.round((monthSpend / 10000) * 100)}% of ₹10,000 monthly limit`}</small>
              </div>
              <div className="mw-metric">
                <div className="mw-metric-top"><span>Pending Invoices</span><span className="mw-icon-box"><ArrowDownToLine /></span></div>
                <strong>0</strong>
                <small>No pending invoices</small>
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
                    {transactions.length === 0 ? (
                      <tr>
                        <td colSpan={6} style={{ textAlign: 'center', color: 'var(--ink-4)', padding: 24 }}>
                          No transactions recorded yet.
                        </td>
                      </tr>
                    ) : (
                      transactions.map((tx) => (
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
                      ))
                    )}
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

            {/* Notification Filter Tabs & Sorting */}
            <div className="mw-filter-bar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
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

              {/* Sorting Dropdown */}
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                <div className="mw-sort-control">
                  <ArrowUpDown size={13} style={{ color: 'var(--brand-hi)', flexShrink: 0 }} />
                  <select
                    value={notifSort}
                    onChange={(e) => setNotifSort(e.target.value as 'newest' | 'oldest')}
                    className="mw-select"
                    style={{
                      border: 'none',
                      background: 'transparent',
                      padding: '4px 6px 4px 2px',
                      fontSize: '0.74rem',
                      color: 'var(--ink)',
                      cursor: 'pointer',
                      outline: 'none',
                      height: '100%'
                    }}
                    aria-label="Sort notifications"
                  >
                    <option value="newest" style={{ background: 'var(--bg-1)', color: 'var(--ink)' }}>Newest First</option>
                    <option value="oldest" style={{ background: 'var(--bg-1)', color: 'var(--ink)' }}>Oldest First</option>
                  </select>
                </div>
              </div>
            </div>

            {(() => {
              const filtered = notifications.filter((n) => (notifFilter === 'all' ? true : notifFilter === 'unread' ? !n.read : n.read))
              const sorted = notifSort === 'oldest' ? [...filtered].reverse() : filtered

              return (
                <div className="mw-panel">
                  {sorted.length === 0 ? (
                    <div className="mw-empty">
                      <span className="mw-icon-box"><Bell size={22} /></span>
                      <h3>No Notifications</h3>
                      <p>You have reviewed all alerts matching this filter.</p>
                    </div>
                  ) : (
                    sorted.map((n) => (
                      <div className={`mw-notification ${n.read ? 'is-read' : ''}`} key={n.id}>
                        <span className="mw-notification-dot" />
                        <div className="mw-notification-body">
                          <strong>{n.title}</strong>
                          <p>{n.detail}</p>
                          <small>{n.type} · {n.time}</small>
                        </div>
                        <div className="mw-notification-actions">
                          <button
                            type="button"
                            className="mw-secondary"
                            onClick={() => {
                              setNotifications((prev) => prev.map((item) => (item.id === n.id ? { ...item, read: !item.read } : item)))
                            }}
                          >
                            {n.read ? 'Mark Unread' : 'Mark Read'}
                          </button>
                          <button
                            type="button"
                            className="mw-notif-delete-btn"
                            onClick={() => setNotifToDelete(n)}
                            title="Delete Notification"
                            aria-label={`Delete notification: ${n.title}`}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )
            })()}
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
              <Link
                className="dash-btn-primary mw-primary"
                to="/dashboard/provider/onboarding"
                style={{ padding: '10px 18px', fontSize: '0.86rem', display: 'inline-flex', alignItems: 'center', gap: 8 }}
              >
                <Plus size={16} />
                <span>Onboard Datacenter</span>
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
              <button
                className="mw-primary"
                onClick={() => {
                  setPayoutAmount(pendingPayout > 0 ? String(pendingPayout) : '0')
                  setShowPayoutModal(true)
                }}
              >
                <ArrowDownToLine size={16} /> Request Payment
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
                <strong>{money(pendingPayout)}</strong>
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
                    {[...payoutHistory]
                      .sort((a, b) => b.id.localeCompare(a.id))
                      .map((row) => (
                        <tr key={row.id}>
                          <td><strong>{row.id}</strong></td>
                          <td>{row.period}</td>
                          <td>{money(row.gross)}</td>
                          <td>{money(row.fee)}</td>
                          <td>{money(row.net)}</td>
                          <td><StatusBadge>{row.status}</StatusBadge></td>
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

            <div className="mw-playground-layout" style={{ display: 'flex', flexDirection: 'column', gap: 20, width: '100%' }}>
              {/* Section 1: Model & Hyperparameters */}
              <div className="mw-panel mw-playground-form" style={{ width: '100%' }}>
                <div className="mw-panel-head">
                  <h3>Model & Hyperparameters</h3>
                  <StatusBadge>{playgroundStreaming ? 'Streaming' : 'Ready'}</StatusBadge>
                </div>

                <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {/* Row 1: Serving Model & Prompt Templates */}
                  <div className="grid grid--2" style={{ gap: 18, alignItems: 'start' }}>
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
                      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
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
                  </div>

                  {/* Row 2: Prompt Input Area */}
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.76rem', color: 'var(--ink-3)' }}>
                    Prompt
                    <textarea
                      rows={5}
                      value={playgroundPrompt}
                      onChange={(e) => setPlaygroundPrompt(e.target.value)}
                      placeholder="Enter user prompt or system instruction..."
                      style={{
                        padding: '12px 14px',
                        background: 'var(--bg-2)',
                        border: '1px solid var(--line-2)',
                        borderRadius: 8,
                        color: 'var(--ink)',
                        resize: 'vertical',
                        fontFamily: 'inherit',
                        fontSize: '0.84rem',
                        lineHeight: 1.5,
                        width: '100%'
                      }}
                    />
                  </label>

                  {/* Row 3: Sliders (Temperature & Max Tokens) */}
                  <div className="grid grid--2" style={{ gap: 18 }}>
                    <div style={{ background: 'var(--bg-2)', padding: '12px 14px', borderRadius: 8, border: '1px solid var(--line-2)' }}>
                      <div className="mw-slider-header" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                        <span style={{ fontSize: '0.74rem', color: 'var(--ink-3)' }}>Temperature</span>
                        <strong style={{ fontSize: '0.74rem', color: 'var(--brand-hi)', fontFamily: 'var(--font-mono)' }}>{playgroundTemp}</strong>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={playgroundTemp}
                        onChange={(e) => setPlaygroundTemp(Number(e.target.value))}
                        style={{ width: '100%', accentColor: 'var(--brand)' }}
                      />
                    </div>
                    <div style={{ background: 'var(--bg-2)', padding: '12px 14px', borderRadius: 8, border: '1px solid var(--line-2)' }}>
                      <div className="mw-slider-header" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                        <span style={{ fontSize: '0.74rem', color: 'var(--ink-3)' }}>Max Tokens</span>
                        <strong style={{ fontSize: '0.74rem', color: 'var(--brand-hi)', fontFamily: 'var(--font-mono)' }}>{playgroundMaxTokens}</strong>
                      </div>
                      <input
                        type="range"
                        min="64"
                        max="2048"
                        step="64"
                        value={playgroundMaxTokens}
                        onChange={(e) => setPlaygroundMaxTokens(Number(e.target.value))}
                        style={{ width: '100%', accentColor: 'var(--brand)' }}
                      />
                    </div>
                  </div>

                  {/* Row 4: Action Button */}
                  <div className="row" style={{ justifyContent: 'flex-end', gap: 10, marginTop: 4, flexWrap: 'wrap' }}>
                    {playgroundPrompt && (
                      <button
                        type="button"
                        className="mw-secondary"
                        onClick={() => setPlaygroundPrompt('')}
                        disabled={playgroundStreaming}
                      >
                        Clear Prompt
                      </button>
                    )}
                    <button
                      type="button"
                      className="mw-primary"
                      onClick={handleRunPlayground}
                      disabled={playgroundStreaming}
                      style={{ minWidth: 200 }}
                    >
                      <Play size={14} /> {playgroundStreaming ? 'Generating...' : 'Run Model Inference'}
                    </button>
                  </div>
                </div>
              </div>

              {/* Section 2: Generated Token Stream */}
              <div className="mw-panel mw-playground-output" style={{ width: '100%' }}>
                <div className="mw-panel-head">
                  <h3>Generated Token Stream</h3>
                  <div className="row" style={{ gap: 8 }}>
                    {playgroundOutput && (
                      <>
                        <button
                          type="button"
                          className="mw-secondary"
                          onClick={() => setPlaygroundOutput('')}
                          disabled={playgroundStreaming}
                        >
                          Clear Output
                        </button>
                        <button
                          type="button"
                          className="mw-secondary"
                          onClick={() => {
                            navigator.clipboard?.writeText(playgroundOutput)
                            flash('Inference response copied to clipboard!')
                          }}
                        >
                          <Copy size={13} /> Copy Output
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Metrics Bar */}
                <div
                  className="row"
                  style={{
                    gap: 16,
                    padding: '10px 18px',
                    background: 'var(--bg-2)',
                    borderBottom: '1px solid var(--line-2)',
                    fontSize: '0.74rem',
                    color: 'var(--ink-3)',
                    flexWrap: 'wrap'
                  }}
                >
                  <span>TTFT: <strong style={{ color: 'var(--brand-hi)', fontFamily: 'var(--font-mono)' }}>{playgroundMetrics.ttft}s</strong></span>
                  <span>Throughput: <strong style={{ color: 'var(--brand-hi)', fontFamily: 'var(--font-mono)' }}>{playgroundMetrics.speed} tok/s</strong></span>
                  <span>Tokens: <strong style={{ color: 'var(--ink)', fontFamily: 'var(--font-mono)' }}>{playgroundMetrics.tokens}</strong></span>
                  <span>Model: <strong style={{ color: 'var(--ink)' }}>{playgroundModel}</strong></span>
                </div>

                <div className="mw-console-box" style={{ minHeight: 220, maxHeight: 480, overflowY: 'auto', padding: 18, background: 'var(--bg-0)' }}>
                  {playgroundOutput ? (
                    <pre style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: '0.84rem', whiteSpace: 'pre-wrap', lineHeight: 1.6, color: 'var(--ink)' }}>
                      {playgroundOutput}
                      {playgroundStreaming && <span className="mw-cursor-blink">▌</span>}
                    </pre>
                  ) : (
                    <div className="mw-empty" style={{ padding: '48px 20px' }}>
                      <Terminal size={28} />
                      <h3>Playground Output Ready</h3>
                      <p>Type a prompt and click "Run Inference" to stream response tokens.</p>
                    </div>
                  )}
                </div>

                {/* Recent History */}
                <div style={{ padding: '14px 18px', borderTop: '1px solid var(--line-2)' }}>
                  <span style={{ fontSize: '0.72rem', color: 'var(--ink-4)', display: 'block', marginBottom: 8 }}>
                    Recent Playground Prompts
                  </span>
                  <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                    {playgroundHistory.map((h, i) => (
                      <span
                        key={i}
                        className="chip"
                        style={{ cursor: 'pointer', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
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
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                {sshLoading && <span className="mw-muted" style={{ display: 'flex', alignItems: 'center', fontSize: '0.8rem' }}>Syncing...</span>}
                <button className="mw-primary" onClick={() => { setSshModalError(''); setShowAddSshModal(true) }}>
                  <Plus size={16} /> Add Public SSH Key
                </button>
              </div>
            </div>

            {!getSession()?.token && (
              <div style={{ padding: '12px 16px', background: 'rgba(234, 179, 8, 0.1)', border: '1px solid rgba(234, 179, 8, 0.3)', borderRadius: 8, marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.82rem', color: '#eab308' }}>
                  <strong>Authentication Notice:</strong> Please sign in with your account to register and manage persistent SSH keys.
                </span>
                <Link to="/login" style={{ fontSize: '0.8rem', color: 'var(--brand-hi)', textDecoration: 'underline' }}>Sign In</Link>
              </div>
            )}

            {sshError && (
              <div style={{ padding: '12px 16px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: 8, marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.82rem', color: '#ef4444' }}>{sshError}</span>
                <button className="mw-secondary" style={{ padding: '4px 10px', fontSize: '0.76rem' }} onClick={() => void loadSshKeys()}>Retry</button>
              </div>
            )}

            <div className="mw-info-box" style={{ marginBottom: 16 }}>
              <ShieldCheck size={18} />
              <span>
                <strong>Sovereign Security Notice:</strong> Never upload private keys. Only OpenSSH public keys (e.g., id_ed25519.pub, id_rsa.pub) are accepted. Stored securely in PostgreSQL and cryptographically verified.
              </span>
            </div>

            <div className="mw-panel">
              <div className="mw-panel-head">
                <h3>Registered Public Keys</h3>
                <span className="mw-muted">{sshKeys.length} {sshKeys.length === 1 ? 'key' : 'keys'}</span>
              </div>

              {sshKeys.length === 0 && !sshLoading ? (
                <div className="mw-empty">
                  <span className="mw-icon-box"><KeyRound size={22} /></span>
                  <h3>No SSH Keys Configured</h3>
                  <p>Add an OpenSSH public key to pair with GPU container shells.</p>
                  <button className="mw-primary" onClick={() => { setSshModalError(''); setShowAddSshModal(true) }}>
                    Add Public Key
                  </button>
                </div>
              ) : (
                <div className="mw-table-wrap">
                  <table className="mw-table">
                    <thead>
                      <tr>
                        <th>Key Label</th>
                        <th>Type</th>
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
                          <td>
                            <span style={{
                              fontSize: '0.72rem',
                              padding: '2px 7px',
                              borderRadius: 4,
                              background: 'rgba(255, 255, 255, 0.06)',
                              border: '1px solid rgba(255, 255, 255, 0.1)',
                              fontFamily: 'var(--font-mono)'
                            }}>
                              {k.keyType || 'ssh'}
                            </span>
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
              {(['All', 'Running', 'Completed', 'Cancelled', 'Archived'] as const).map((tab) => {
                const count = orders.filter((o) => {
                  const isArchived = Boolean(o.is_archived || o.status === 'Archived')
                  if (tab === 'Archived') return isArchived
                  if (isArchived) return false
                  if (tab === 'All') return true
                  return o.status === tab
                }).length
                return (
                  <button
                    key={tab}
                    type="button"
                    className={`mw-filter-pill ${orderTab === tab ? 'is-active' : ''}`}
                    onClick={() => setOrderTab(tab)}
                  >
                    {tab} ({count})
                  </button>
                )
              })}
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
                      .filter((o) => {
                        const isArchived = Boolean(o.is_archived || o.status === 'Archived')
                        if (orderTab === 'Archived') return isArchived
                        if (isArchived) return false
                        if (orderTab === 'All') return true
                        return o.status === orderTab
                      })
                      .map((ord) => {
                        const isArchived = Boolean(ord.is_archived || ord.status === 'Archived')
                        const canArchive = !isArchived && (ord.status === 'Completed' || ord.status === 'Cancelled')
                        return (
                          <tr key={ord.id}>
                            <td><strong>{ord.id}</strong></td>
                            <td>{ord.modelOrGpu}</td>
                            <td>{ord.provider}</td>
                            <td>{ord.date}</td>
                            <td>{ord.duration}</td>
                            <td><strong style={{ color: 'var(--ink)' }}>{money(ord.cost)}</strong></td>
                            <td><StatusBadge>{ord.status}</StatusBadge></td>
                            <td>
                              <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                                <button
                                  type="button"
                                  className="mw-secondary"
                                  onClick={() => setSelectedOrder(ord)}
                                  style={{ minHeight: 32, padding: '4px 10px', fontSize: '0.74rem' }}
                                >
                                  View Details
                                </button>
                                {canArchive && (
                                  <button
                                    type="button"
                                    className="mw-secondary"
                                    onClick={() => setOrderToArchive(ord)}
                                    title={`Archive order ${ord.id}`}
                                    style={{
                                      minHeight: 32,
                                      padding: '4px 10px',
                                      fontSize: '0.74rem',
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: 6,
                                    }}
                                  >
                                    <Archive size={13} />
                                    Archive
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        )
                      })}
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

            <div style={{ display: 'flex', flexDirection: 'column', gap: 18, width: '100%' }}>
              {/* Section 1: Hardware Configuration */}
              <div className="mw-panel mw-form-panel" style={{ width: '100%' }}>
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
                    <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
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

              {/* Section 2: Order Cost Summary */}
              <div className="mw-panel" style={{ width: '100%' }}>
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
              <button className="mw-primary" onClick={() => handleOpenTopUpModal()}>
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
                <strong>{money(monthSpend)}</strong>
                <small>{monthSpend === 0 ? 'No usage this month' : `${Math.round((monthSpend / 10000) * 100)}% of ₹10,000 monthly limit`}</small>
              </div>
              <div className="mw-metric">
                <div className="mw-metric-top"><span>Pending Invoices</span><span className="mw-icon-box"><ArrowDownToLine /></span></div>
                <strong>0</strong>
                <small>No pending invoices</small>
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
                    {transactions.length === 0 ? (
                      <tr>
                        <td colSpan={6} style={{ textAlign: 'center', color: 'var(--ink-4)', padding: 24 }}>
                          No transactions recorded yet.
                        </td>
                      </tr>
                    ) : (
                      transactions.map((tx) => (
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
                      ))
                    )}
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
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>Work Email</span>
                      <span style={{ fontSize: '0.72rem', color: 'var(--brand-hi)', background: 'rgba(118, 185, 0, 0.1)', padding: '2px 6px', borderRadius: 4, fontWeight: 500 }}>
                        Managed by SSO
                      </span>
                    </div>
                    <input
                      disabled
                      type="email"
                      value={profileEmail}
                      title="Work email is managed by corporate SSO"
                      style={{ opacity: 0.75, cursor: 'not-allowed', background: 'var(--bg-3)' }}
                    />
                    <small style={{ color: 'var(--ink-4)', fontSize: '0.75rem', marginTop: 3, display: 'block' }}>
                      Primary work email is governed by corporate SSO authentication. Contact administrator to modify.
                    </small>
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
        <div className="mw-modal-backdrop" onClick={() => !isDeploying && setShowDeployModal(false)}>
          <div className="mw-modal" onClick={(e) => e.stopPropagation()}>
            <div className="mw-modal-head">
              <h3>Create Model Deployment</h3>
              <button onClick={() => !isDeploying && setShowDeployModal(false)} aria-label="Close" disabled={isDeploying}><X size={16} /></button>
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
                    disabled={isDeploying}
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.76rem', color: 'var(--ink-3)' }}>
                  Model
                  <select
                    value={deployForm.model}
                    onChange={(e) => setDeployForm({ ...deployForm, model: e.target.value })}
                    className="mw-select"
                    disabled={isDeploying}
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
                    disabled={isDeploying}
                  >
                    {listings.map((l) => (
                      <option key={l.id} value={l.gpu}>
                        {l.name} ({l.vram}) · ₹{l.price}/hr
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.76rem', color: 'var(--ink-3)' }}>
                  Deployment Region
                  <select
                    value={deployForm.region}
                    onChange={(e) => setDeployForm({ ...deployForm, region: e.target.value })}
                    className="mw-select"
                    disabled={isDeploying}
                  >
                    <option value="Hyderabad, IN">Hyderabad (Sovereign Tier IV)</option>
                    <option value="Mumbai, IN">Mumbai (Yotta NM1)</option>
                    <option value="Delhi, IN">Delhi NCR (MeitY Empanelled)</option>
                  </select>
                </label>
              </div>
              <div className="mw-modal-foot">
                <button type="button" className="mw-secondary" onClick={() => setShowDeployModal(false)} disabled={isDeploying}>Cancel</button>
                <button type="submit" className="mw-primary" disabled={isDeploying}>
                  {isDeploying ? 'Deploying Endpoint...' : 'Deploy Endpoint'}
                </button>
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
              <h3>Create Inferxe API Key</h3>
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
                    placeholder="e.g. Production Nemotron Client"
                    style={{ padding: '8px 10px', background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 7, color: 'var(--ink)' }}
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.76rem', color: 'var(--ink-3)', marginTop: 10 }}>
                  Environment
                  <select
                    value={newKeyEnv}
                    onChange={(e) => setNewKeyEnv(e.target.value as 'live' | 'test')}
                    style={{ padding: '8px 10px', background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 7, color: 'var(--ink)' }}
                  >
                    <option value="live">Live (Production)</option>
                    <option value="test">Test (Sandbox / Staging)</option>
                  </select>
                </label>
                <p style={{ margin: 0, fontSize: '0.74rem', color: 'var(--ink-4)', lineHeight: 1.5, marginTop: 10 }}>
                  Keys are cryptographically hashed using SHA-256 and verified through PostgreSQL. Only the raw key will be displayed once.
                </p>
              </div>
              <div className="mw-modal-foot">
                <button type="button" className="mw-secondary" onClick={() => setShowNewKeyModal(false)}>Cancel</button>
                <button type="submit" className="mw-primary" disabled={keysLoading}>
                  {keysLoading ? 'Generating...' : 'Generate Key'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 3b. Secret Key Generated Modal (Display Once) */}
      {createdSecretData && (
        <div className="mw-modal-backdrop" onClick={() => setCreatedSecretData(null)}>
          <div className="mw-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
            <div className="mw-modal-head" style={{ borderBottom: '1px solid rgba(34, 197, 94, 0.2)' }}>
              <h3 style={{ color: '#4ade80', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Check size={18} /> API Key Created Successfully
              </h3>
              <button onClick={() => setCreatedSecretData(null)} aria-label="Close"><X size={16} /></button>
            </div>
            <div className="mw-modal-body" style={{ gap: 14 }}>
              <div style={{ padding: '10px 14px', background: 'rgba(234, 179, 8, 0.1)', border: '1px solid rgba(234, 179, 8, 0.25)', borderRadius: 7, fontSize: '0.78rem', color: '#eab308', lineHeight: 1.5 }}>
                <strong>Important:</strong> Save this key now! For security reasons, Inferxe only stores the SHA-256 hash. <strong>You will not be able to view this secret token again.</strong>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontSize: '0.76rem', color: 'var(--ink-3)' }}>Key Name: <strong>{createdSecretData.name}</strong></span>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    readOnly
                    value={createdSecretData.key}
                    style={{
                      flex: 1,
                      fontFamily: 'monospace',
                      fontSize: '0.85rem',
                      padding: '10px 12px',
                      background: 'rgba(0, 0, 0, 0.4)',
                      border: '1px solid var(--brand-line, #38bdf8)',
                      borderRadius: 7,
                      color: 'var(--brand-hi, #38bdf8)',
                    }}
                  />
                  <button
                    className="mw-primary"
                    style={{ whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6 }}
                    onClick={() => {
                      void navigator.clipboard?.writeText(createdSecretData.key)
                      flash('Secret API Key copied to clipboard!')
                    }}
                  >
                    <Copy size={14} /> Copy
                  </button>
                </div>
              </div>
            </div>
            <div className="mw-modal-foot">
              <button
                className="mw-primary"
                style={{ width: '100%' }}
                onClick={() => setCreatedSecretData(null)}
              >
                I have safely stored this key
              </button>
            </div>
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

      {/* 5b. Model Comparison Modal */}
      {showModelCompareModal && (
        <div className="mw-modal-backdrop" onClick={() => setShowModelCompareModal(false)}>
          <div className="mw-modal mw-modal--wide" style={{ maxWidth: 'min(980px, 95vw)' }} onClick={(e) => e.stopPropagation()}>
            <div className="mw-modal-head">
              <h3>Model Comparison</h3>
              <button onClick={() => setShowModelCompareModal(false)} aria-label="Close"><X size={16} /></button>
            </div>
            <div className="mw-modal-body">
              {comparedModelIds.length === 1 && (
                <div className="mw-info-box" style={{ marginBottom: 14 }}>
                  <Info size={16} />
                  <span>Select at least 1 additional model from the catalog for side-by-side comparison.</span>
                </div>
              )}
              {comparedModelIds.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--ink-3)' }}>
                  <p>No models selected for comparison.</p>
                  <p style={{ fontSize: '0.8rem', color: 'var(--ink-4)' }}>Select models from the catalog using the Compare button.</p>
                </div>
              ) : (
                <div
                  className="mw-compare-grid"
                  style={{
                    display: 'flex',
                    flexWrap: 'nowrap',
                    overflowX: 'auto',
                    gap: 14,
                    paddingBottom: 8,
                  }}
                >
                  {comparedModelIds
                    .map((id) => MODELS.find((m) => m.id === id))
                    .filter((m): m is (typeof MODELS)[number] => Boolean(m))
                    .map((model) => (
                      <div
                        className="mw-compare-col"
                        key={model.id}
                        style={{
                          minWidth: 260,
                          maxWidth: 320,
                          flex: '1 0 260px',
                          display: 'flex',
                          flexDirection: 'column',
                        }}
                      >
                        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                          <span className="tag" style={{ background: 'rgba(118,185,0,0.12)', color: 'var(--brand-hi)', borderColor: 'var(--brand)' }}>
                            {model.family}
                          </span>
                          <small style={{ fontFamily: 'var(--font-mono)', color: 'var(--ink-4)', fontSize: '0.68rem' }}>
                            {model.params}B params
                          </small>
                        </div>
                        <h4>{model.name}</h4>
                        <div className="mw-compare-item"><span>Family</span><strong>{model.family}</strong></div>
                        <div className="mw-compare-item"><span>Parameters</span><strong>{model.params}B</strong></div>
                        <div className="mw-compare-item"><span>Architecture</span><strong style={{ textAlign: 'right' }}>{model.arch}</strong></div>
                        <div className="mw-compare-item"><span>FP16 VRAM</span><strong>~{(model.params * 2).toFixed(1)} GB</strong></div>
                        <div className="mw-compare-item"><span>FP8 VRAM</span><strong>~{model.params.toFixed(1)} GB</strong></div>
                        <div className="mw-compare-item"><span>KV Cache Footprint</span><strong>{((model.kvBytesPerToken * 1024) / (1024 * 1024)).toFixed(2)} MB / 1k tok</strong></div>
                        <button
                          type="button"
                          className="mw-primary mw-full"
                          style={{ marginTop: 'auto', paddingTop: 10, paddingBottom: 10, justifyContent: 'center' }}
                          onClick={() => {
                            setSelectedModelId(model.id)
                            setDeployForm((f) => ({
                              ...f,
                              model: model.name,
                              gpu: model.params >= 70 ? 'H100' : model.params >= 14 ? 'L40S' : (f.gpu || 'L4'),
                            }))
                            setShowModelCompareModal(false)
                            setShowDeployModal(true)
                          }}
                        >
                          Select & Deploy <span>→</span>
                        </button>
                      </div>
                    ))}
                </div>
              )}
            </div>
            <div className="mw-modal-foot">
              <button type="button" className="mw-secondary" onClick={() => setShowModelCompareModal(false)}>Close</button>
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
              <div className="mw-modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--ink-3)', lineHeight: 1.5 }}>
                  Enter your desired amount or pick a quick preset to add funds to your prepaid inference wallet:
                </p>

                {/* Custom Amount Input Field */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label htmlFor="wallet-topup-input" style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--ink-2)' }}>
                    Top-Up Amount (₹)
                  </label>
                  <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                    <span
                      style={{
                        position: 'absolute',
                        left: 14,
                        color: 'var(--brand-hi, #76b900)',
                        fontSize: '1.15rem',
                        fontWeight: 700,
                        pointerEvents: 'none',
                        userSelect: 'none',
                      }}
                    >
                      ₹
                    </span>
                    <input
                      id="wallet-topup-input"
                      type="number"
                      min="1"
                      step="1"
                      placeholder="Enter amount (e.g. 10000)"
                      value={topUpAmount}
                      onChange={(e) => {
                        const sanitized = e.target.value.replace(/[^0-9]/g, '')
                        setTopUpAmount(sanitized)
                      }}
                      style={{
                        width: '100%',
                        padding: '10px 14px 10px 34px',
                        fontSize: '1.05rem',
                        fontWeight: 600,
                        fontFamily: 'var(--font-mono, monospace)',
                        background: 'var(--bg-2, #111a14)',
                        border: '1px solid var(--line-2, #26382a)',
                        borderRadius: 8,
                        color: 'var(--ink, #fff)',
                        outline: 'none',
                      }}
                      autoFocus
                      required
                    />
                  </div>
                </div>

                {/* Quick Presets (Amounts 2000 and 5000 removed) */}
                <div>
                  <span style={{ fontSize: '0.74rem', color: 'var(--ink-4)', display: 'block', marginBottom: 8, fontWeight: 500 }}>
                    Quick Select Presets:
                  </span>
                  <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                    {[10000, 25000, 50000, 100000].map((amt) => (
                      <button
                        key={amt}
                        type="button"
                        className={`mw-filter-pill ${numericTopUp === amt ? 'is-active' : ''}`}
                        onClick={() => setTopUpAmount(String(amt))}
                        style={{ cursor: 'pointer' }}
                      >
                        {money(amt)}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Live balance preview */}
                {numericTopUp > 0 && (
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '10px 14px',
                      background: 'rgba(118, 185, 0, 0.08)',
                      borderRadius: 8,
                      border: '1px solid rgba(118, 185, 0, 0.25)',
                      fontSize: '0.8rem',
                    }}
                  >
                    <span style={{ color: 'var(--ink-3)' }}>
                      Current Balance: <strong>{money(walletBalance)}</strong>
                    </span>
                    <span style={{ color: 'var(--brand-hi, #76b900)', fontWeight: 600 }}>
                      New Balance: <strong>{money(walletBalance + numericTopUp)}</strong>
                    </span>
                  </div>
                )}

                <div className="mw-info-box" style={{ marginTop: 0 }}>
                  <ShieldCheck size={16} />
                  <span>Simulated transaction. Funds will instantly reflect in your wallet and show in the transaction history.</span>
                </div>
              </div>
              <div className="mw-modal-foot">
                <button type="button" className="mw-secondary" onClick={() => setShowTopUpModal(false)}>Cancel</button>
                <button
                  type="submit"
                  className="mw-primary"
                  disabled={numericTopUp <= 0}
                  style={numericTopUp <= 0 ? { opacity: 0.5, cursor: 'not-allowed' } : {}}
                >
                  {numericTopUp > 0 ? `Add ${money(numericTopUp)}` : 'Enter an amount'}
                </button>
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
              <h3>Request Payment</h3>
              <button onClick={() => setShowPayoutModal(false)} aria-label="Close"><X size={16} /></button>
            </div>
            {pendingPayout <= 0 ? (
              <div className="mw-modal-body" style={{ textAlign: 'center', padding: '28px 22px' }}>
                <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--ink-2)', lineHeight: 1.6 }}>
                  You currently have no pending earnings available for disbursement. All accrued revenue has already been requested.
                </p>
                <div style={{ marginTop: 16 }}>
                  <button
                    type="button"
                    className="mw-secondary"
                    onClick={() => {
                      setPendingPayout(72000)
                      setPayoutAmount('72000')
                      saveStore(STORE.pendingPayout, 72000)
                      flash('Demo pending balance reset to ₹72,000.')
                    }}
                  >
                    Reset Demo Balance (₹72,000)
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleConfirmPayout}>
                <div className="mw-modal-body">
                  {/* Available Balance Box */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '12px 16px',
                      background: 'rgba(118, 185, 0, 0.08)',
                      border: '1px solid rgba(118, 185, 0, 0.22)',
                      borderRadius: 10,
                    }}
                  >
                    <div>
                      <span style={{ fontSize: '0.72rem', color: 'var(--ink-3)', display: 'block', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        Available to Withdraw
                      </span>
                      <strong style={{ fontSize: '1.25rem', color: 'var(--brand-hi, #76b900)' }}>
                        {money(pendingPayout)}
                      </strong>
                    </div>
                    <span style={{ fontSize: '0.74rem', color: 'var(--ink-4)', maxWidth: 170, textAlign: 'right' }}>
                      Max balance eligible for payout disbursement
                    </span>
                  </div>

                  {/* Amount Input */}
                  <div>
                    <label
                      htmlFor="payout-amount-input"
                      style={{ fontSize: '0.78rem', color: 'var(--ink-2)', display: 'block', marginBottom: 6, fontWeight: 500 }}
                    >
                      Withdrawal Amount (₹)
                    </label>
                    <div style={{ position: 'relative' }}>
                      <span
                        style={{
                          position: 'absolute',
                          left: 14,
                          top: '50%',
                          transform: 'translateY(-50%)',
                          color: 'var(--ink-3)',
                          fontWeight: 600,
                          fontSize: '1rem',
                          pointerEvents: 'none',
                        }}
                      >
                        ₹
                      </span>
                      <input
                        id="payout-amount-input"
                        type="number"
                        min="1"
                        max={pendingPayout}
                        step="1"
                        value={payoutAmount}
                        onChange={(e) => {
                          const sanitized = e.target.value.replace(/[^0-9]/g, '')
                          setPayoutAmount(sanitized)
                        }}
                        placeholder="Enter amount to withdraw"
                        style={{
                          width: '100%',
                          padding: '10px 14px 10px 34px',
                          fontSize: '1.05rem',
                          fontWeight: 600,
                          fontFamily: 'var(--font-mono, monospace)',
                          background: 'var(--bg-2, #111a14)',
                          border: '1px solid var(--line-2, #26382a)',
                          borderRadius: 8,
                          color: 'var(--ink, #fff)',
                          outline: 'none',
                        }}
                        autoFocus
                        required
                      />
                    </div>
                    {numericPayout > pendingPayout && (
                      <span style={{ color: '#ef4444', fontSize: '0.76rem', display: 'block', marginTop: 4 }}>
                        Amount cannot exceed available pending earnings of {money(pendingPayout)}.
                      </span>
                    )}
                  </div>

                  {/* Quick Select Presets */}
                  <div>
                    <span style={{ fontSize: '0.74rem', color: 'var(--ink-4)', display: 'block', marginBottom: 8, fontWeight: 500 }}>
                      Quick Select Presets:
                    </span>
                    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                      {[10000, 25000, 50000].filter((amt) => amt < pendingPayout).map((amt) => (
                        <button
                          key={amt}
                          type="button"
                          className={`mw-filter-pill ${numericPayout === amt ? 'is-active' : ''}`}
                          onClick={() => setPayoutAmount(String(amt))}
                          style={{ cursor: 'pointer' }}
                        >
                          {money(amt)}
                        </button>
                      ))}
                      <button
                        type="button"
                        className={`mw-filter-pill ${numericPayout === pendingPayout ? 'is-active' : ''}`}
                        onClick={() => setPayoutAmount(String(pendingPayout))}
                        style={{ cursor: 'pointer' }}
                      >
                        Max ({money(pendingPayout)})
                      </button>
                    </div>
                  </div>

                  {/* Live Breakdown Box */}
                  {numericPayout > 0 && numericPayout <= pendingPayout && (
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                        padding: '12px 14px',
                        background: 'rgba(255, 255, 255, 0.02)',
                        borderRadius: 8,
                        border: '1px solid var(--line, #1e2c22)',
                        fontSize: '0.82rem',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--ink-2)' }}>
                        <span>Gross Inflow Requested</span>
                        <strong>{money(numericPayout)}</strong>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--ink-3)' }}>
                        <span>Platform Fee (12%)</span>
                        <span style={{ color: '#f59e0b' }}>- {money(Math.round(numericPayout * 0.12))}</span>
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          color: 'var(--ink)',
                          borderTop: '1px solid rgba(255,255,255,0.08)',
                          paddingTop: 6,
                          fontWeight: 600,
                        }}
                      >
                        <span>Net Disbursed to Bank</span>
                        <span style={{ color: 'var(--brand-hi, #76b900)' }}>
                          {money(Math.round(numericPayout * 0.88))}
                        </span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--ink-4)', fontSize: '0.74rem' }}>
                        <span>Remaining Pending Balance</span>
                        <span>{money(pendingPayout - numericPayout)}</span>
                      </div>
                    </div>
                  )}

                  <div className="mw-info-box" style={{ marginTop: 0 }}>
                    <ShieldCheck size={16} />
                    <span>Simulated payout request. In production, disbursements are processed via NEFT/RTGS settlement to your registered bank account.</span>
                  </div>
                </div>

                <div className="mw-modal-foot">
                  <button type="button" className="mw-secondary" onClick={() => setShowPayoutModal(false)}>
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="mw-primary"
                    disabled={numericPayout <= 0 || numericPayout > pendingPayout}
                    style={numericPayout <= 0 || numericPayout > pendingPayout ? { opacity: 0.5, cursor: 'not-allowed' } : {}}
                  >
                    Confirm Payout
                  </button>
                </div>
              </form>
            )}
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
        <div className="mw-modal-backdrop" onClick={() => !sshSubmitting && setShowAddSshModal(false)}>
          <div className="mw-modal" onClick={(e) => e.stopPropagation()}>
            <div className="mw-modal-head">
              <h3>Add Public SSH Key</h3>
              <button disabled={sshSubmitting} onClick={() => setShowAddSshModal(false)} aria-label="Close"><X size={16} /></button>
            </div>
            <form onSubmit={handleAddSshKey}>
              <div className="mw-modal-body">
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.76rem', color: 'var(--ink-3)' }}>
                  Key Name / Machine Label
                  <input
                    required
                    disabled={sshSubmitting}
                    value={newSshName}
                    onChange={(e) => setNewSshName(e.target.value)}
                    placeholder="e.g. Workstation id_ed25519"
                    style={{ padding: '8px 10px', background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 7, color: 'var(--ink)' }}
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.76rem', color: 'var(--ink-3)' }}>
                  Public Key (.pub file content)
                  <textarea
                    required
                    disabled={sshSubmitting}
                    rows={4}
                    value={newSshKey}
                    onChange={(e) => {
                      setNewSshKey(e.target.value)
                      setSshModalError('')
                    }}
                    placeholder="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI... user@machine"
                    style={{ padding: '8px 10px', background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 7, color: 'var(--ink)', fontFamily: 'var(--font-mono)', fontSize: '0.74rem' }}
                  />
                </label>
                {sshModalError && <small style={{ color: '#ef4444', display: 'block', lineHeight: 1.4 }}>{sshModalError}</small>}
                <div className="mw-info-box" style={{ marginTop: 4 }}>
                  <ShieldCheck size={16} />
                  <span>Never upload private keys (.id_rsa). Only OpenSSH public (.pub) keys are accepted. Cryptographically validated and saved to PostgreSQL.</span>
                </div>
              </div>
              <div className="mw-modal-foot">
                <button type="button" disabled={sshSubmitting} className="mw-secondary" onClick={() => setShowAddSshModal(false)}>Cancel</button>
                <button type="submit" disabled={sshSubmitting} className="mw-primary">
                  {sshSubmitting ? 'Registering Key...' : 'Add Public Key'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 12. Delete SSH Key Confirmation Dialog */}
      {sshKeyToDelete && (
        <div className="mw-modal-backdrop" onClick={() => !sshSubmitting && setSshKeyToDelete(null)}>
          <div className="mw-modal" onClick={(e) => e.stopPropagation()}>
            <div className="mw-modal-head">
              <h3>Remove SSH Key</h3>
              <button disabled={sshSubmitting} onClick={() => setSshKeyToDelete(null)} aria-label="Close"><X size={16} /></button>
            </div>
            <div className="mw-modal-body">
              <p style={{ margin: 0, fontSize: '0.84rem', color: 'var(--ink-2)', lineHeight: 1.5 }}>
                Are you sure you want to remove public key <strong>{sshKeyToDelete.name}</strong> ({sshKeyToDelete.fingerprint})?
                GPU cluster instances will revoke terminal pairing for this key.
              </p>
            </div>
            <div className="mw-modal-foot">
              <button disabled={sshSubmitting} className="mw-secondary" onClick={() => setSshKeyToDelete(null)}>Cancel</button>
              <button
                disabled={sshSubmitting}
                className="mw-primary"
                style={{ background: '#ef4444', borderColor: '#ef4444', color: '#fff' }}
                onClick={handleConfirmDeleteSshKey}
              >
                {sshSubmitting ? 'Removing...' : 'Remove Key'}
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

      {/* 13b. Archive Order Confirmation Dialog */}
      {orderToArchive && (
        <div className="mw-modal-backdrop" onClick={() => !isArchiving && setOrderToArchive(null)}>
          <div className="mw-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
            <div className="mw-modal-head">
              <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                <span className="mw-icon-box" style={{ background: 'rgba(118, 185, 0, 0.12)', color: 'var(--brand-hi)', width: 32, height: 32 }}>
                  <Archive size={16} />
                </span>
                <h3 style={{ margin: 0 }}>Archive Order?</h3>
              </div>
              <button
                type="button"
                onClick={() => !isArchiving && setOrderToArchive(null)}
                aria-label="Close"
                disabled={isArchiving}
              >
                <X size={16} />
              </button>
            </div>
            <div className="mw-modal-body">
              <p style={{ margin: 0, fontSize: '0.84rem', color: 'var(--ink-2)', lineHeight: 1.5 }}>
                Are you sure you want to archive this order? You can access it later from the Archived section.
              </p>
              <div className="mw-info-box" style={{ marginTop: 12, padding: '10px 12px' }}>
                <div>
                  <strong style={{ display: 'block', color: 'var(--ink)', fontSize: '0.85rem' }}>{orderToArchive.id} · {orderToArchive.modelOrGpu}</strong>
                  <span style={{ fontSize: '0.74rem', color: 'var(--ink-4)' }}>{orderToArchive.provider} · {orderToArchive.date} · {money(orderToArchive.cost)}</span>
                </div>
              </div>
            </div>
            <div className="mw-modal-foot">
              <button
                type="button"
                className="mw-secondary"
                onClick={() => setOrderToArchive(null)}
                disabled={isArchiving}
              >
                Cancel
              </button>
              <button
                type="button"
                className="mw-primary"
                onClick={handleConfirmArchiveOrder}
                disabled={isArchiving}
                style={{ minWidth: 120, justifyContent: 'center' }}
              >
                {isArchiving ? 'Archiving...' : 'Archive Order'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 13c. Delete Notification Confirmation Dialog */}
      {notifToDelete && (
        <div className="mw-modal-backdrop" onClick={() => setNotifToDelete(null)}>
          <div className="mw-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
            <div className="mw-modal-head">
              <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                <span className="mw-icon-box" style={{ background: 'rgba(239, 68, 68, 0.12)', color: '#ef4444', width: 32, height: 32 }}>
                  <Trash2 size={16} />
                </span>
                <h3 style={{ margin: 0 }}>Delete Notification?</h3>
              </div>
              <button
                type="button"
                onClick={() => setNotifToDelete(null)}
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>
            <div className="mw-modal-body">
              <p style={{ margin: 0, fontSize: '0.84rem', color: 'var(--ink-2)', lineHeight: 1.5 }}>
                Are you sure you want to delete this notification? This action cannot be undone.
              </p>
              <div className="mw-info-box" style={{ marginTop: 12, padding: '10px 12px' }}>
                <div>
                  <strong style={{ display: 'block', color: 'var(--ink)', fontSize: '0.85rem' }}>{notifToDelete.title}</strong>
                  <span style={{ fontSize: '0.74rem', color: 'var(--ink-4)' }}>{notifToDelete.type} · {notifToDelete.time}</span>
                </div>
              </div>
            </div>
            <div className="mw-modal-foot">
              <button
                type="button"
                className="mw-secondary"
                onClick={() => setNotifToDelete(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="mw-primary"
                onClick={handleConfirmDeleteNotification}
                style={{ minWidth: 140, justifyContent: 'center', background: '#ef4444', borderColor: '#ef4444', color: '#fff' }}
              >
                Delete Notification
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

// Helper to validate comma-separated CORS origins
function validateCorsOrigins(originsStr: string): { isValid: boolean; error?: string } {
  const trimmed = originsStr.trim()
  if (!trimmed) return { isValid: true }
  const parts = trimmed.split(',').map((s) => s.trim()).filter(Boolean)
  for (const part of parts) {
    if (part === '*') continue
    try {
      const url = new URL(part)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return { isValid: false, error: `Invalid protocol in "${part}". Origins must use http:// or https://.` }
      }
    } catch {
      return { isValid: false, error: `"${part}" is not a valid URL (e.g. https://app.novatech.ai).` }
    }
  }
  return { isValid: true }
}

function SettingsSection({ flash }: { flash: (msg: string) => void }) {
  const session = getSession()
  const userEmail = (session?.user as any)?.email || 'priya.s@novatech.ai'
  const [budget, setBudget] = useState(() => readStore('inferxe_demo_budget', '10000'))
  const [emailAlerts, setEmailAlerts] = useState(() => readStore('inferxe_demo_email_alerts', true))
  const [weekly, setWeekly] = useState(() => readStore('inferxe_demo_weekly_report', false))
  const [corsOrigins, setCorsOrigins] = useState(() =>
    readStore('inferxe_demo_cors_origins', 'https://app.novatech.ai, http://localhost:3000')
  )
  const [corsTouched, setCorsTouched] = useState(false)

  // Real-time calculation of current month spend and utilization
  const currentMonthSpend = 4820
  const budgetNum = Math.max(1, Number(budget) || 10000)
  const usedPct = Math.min(100, Math.max(0, Math.round((currentMonthSpend / budgetNum) * 100)))
  const softAlertThreshold = Math.round(budgetNum * 0.8)

  const corsValidation = useMemo(() => validateCorsOrigins(corsOrigins), [corsOrigins])

  const handleSave = (e: FormEvent) => {
    e.preventDefault()

    // Validate CORS origins
    const validation = validateCorsOrigins(corsOrigins)
    if (!validation.isValid) {
      flash(`Cannot save settings: ${validation.error}`)
      return
    }

    const numericBudget = Math.max(0, Number(budget) || 0)
    saveStore('inferxe_demo_budget', String(numericBudget))
    saveStore('inferxe_demo_email_alerts', emailAlerts)
    saveStore('inferxe_demo_weekly_report', weekly)
    saveStore('inferxe_demo_cors_origins', corsOrigins)

    // Notify sidebar and rest of dashboard immediately without page refresh
    window.dispatchEvent(new Event('inferxe_budget_updated'))
    try {
      window.dispatchEvent(new CustomEvent('storage', { detail: { key: 'inferxe_demo_budget' } }))
    } catch {}

    flash('Workspace settings and budget limits updated successfully.')
  }

  const handleResetDefaults = () => {
    setBudget('10000')
    setEmailAlerts(true)
    setWeekly(false)
    setCorsOrigins('https://app.novatech.ai, http://localhost:3000')
    saveStore('inferxe_demo_budget', '10000')
    saveStore('inferxe_demo_email_alerts', true)
    saveStore('inferxe_demo_weekly_report', false)
    saveStore('inferxe_demo_cors_origins', 'https://app.novatech.ai, http://localhost:3000')
    window.dispatchEvent(new Event('inferxe_budget_updated'))
    flash('Workspace preferences reset to platform defaults.')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Workspace Header Toolbar */}
      <div className="mw-toolbar">
        <div>
          <h2>Workspace Settings & Governance</h2>
          <p>Configure monthly compute budget, automated quota threshold alerts, telemetry reports, and API security for NovaTech AI Systems.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <StatusBadge>Active Workspace</StatusBadge>
          <span style={{ fontSize: '0.78rem', color: 'var(--ink-4)', fontFamily: 'var(--font-mono, monospace)', background: 'var(--bg-2)', padding: '3px 8px', borderRadius: 4, border: '1px solid var(--line)' }}>
            TENANT: novatech-ai
          </span>
        </div>
      </div>

      <form className="mw-form" onSubmit={handleSave} style={{ display: 'contents' }}>
        {/* Row 1: Budget & Quotas + Notification Preferences */}
        <div className="mw-two-col">
          {/* Section A: Workspace Budget & Quotas */}
          <div className="mw-panel mw-form-panel">
            <div className="mw-panel-head">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <CircleDollarSign size={16} style={{ color: 'var(--brand-hi)' }} />
                <h3>Workspace Budget & Quotas</h3>
              </div>
              <StatusBadge>{usedPct >= 100 ? 'Cap Exceeded' : usedPct >= 80 ? 'Threshold Alert' : 'Healthy Quota'}</StatusBadge>
            </div>

            <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <label style={{ margin: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <span>Monthly Spending Limit (₹)</span>
                  <span style={{ fontSize: '0.75rem', color: 'var(--ink-4)' }}>Authoritative cap</span>
                </div>
                <input
                  type="number"
                  min="0"
                  step="500"
                  required
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                  placeholder="10000"
                />
              </label>

              {/* Dynamic Budget Utilization Indicator */}
              <div style={{ background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 8, padding: '12px 14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.82rem', marginBottom: 6 }}>
                  <span style={{ color: 'var(--ink-3)', fontWeight: 500 }}>Budget Utilization</span>
                  <span style={{ color: usedPct >= 100 ? '#ef4444' : usedPct >= 80 ? '#f59e0b' : 'var(--brand-hi)', fontWeight: 700 }}>
                    {usedPct}% Utilized
                  </span>
                </div>

                <div style={{ background: 'rgba(255, 255, 255, 0.08)', borderRadius: 6, height: 8, overflow: 'hidden', margin: '6px 0' }}>
                  <div
                    style={{
                      width: `${usedPct}%`,
                      height: '100%',
                      background: usedPct >= 100 ? '#ef4444' : usedPct >= 80 ? '#f59e0b' : 'var(--brand-hi)',
                      borderRadius: 6,
                      transition: 'width 0.3s cubic-bezier(0.25, 1, 0.5, 1)',
                    }}
                  />
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: 'var(--ink-4)', marginTop: 4 }}>
                  <span>Current Month Spend: <strong style={{ color: 'var(--ink)' }}>₹{currentMonthSpend.toLocaleString('en-IN')}</strong></span>
                  <span>Limit: <strong style={{ color: 'var(--ink)' }}>₹{budgetNum.toLocaleString('en-IN')}</strong></span>
                </div>
              </div>

              {/* Threshold Alerts Info */}
              <div>
                <div style={{ fontSize: '0.78rem', color: 'var(--ink-4)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>
                  Automated Quota Thresholds
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '6px 10px',
                    borderRadius: 6,
                    fontSize: '0.76rem',
                    background: usedPct >= 80 ? 'rgba(245, 158, 11, 0.12)' : 'var(--bg-2)',
                    border: `1px solid ${usedPct >= 80 ? 'rgba(245, 158, 11, 0.35)' : 'var(--line)'}`,
                    color: usedPct >= 80 ? '#f59e0b' : 'var(--ink-3)',
                  }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#f59e0b' }} />
                    <span>80% Soft Alert: ₹{softAlertThreshold.toLocaleString('en-IN')}</span>
                  </div>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '6px 10px',
                    borderRadius: 6,
                    fontSize: '0.76rem',
                    background: usedPct >= 100 ? 'rgba(239, 68, 68, 0.12)' : 'var(--bg-2)',
                    border: `1px solid ${usedPct >= 100 ? 'rgba(239, 68, 68, 0.35)' : 'var(--line)'}`,
                    color: usedPct >= 100 ? '#ef4444' : 'var(--ink-3)',
                  }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#ef4444' }} />
                    <span>100% Hard Cap: ₹{budgetNum.toLocaleString('en-IN')}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Section B: Notification Preferences */}
          <div className="mw-panel mw-form-panel">
            <div className="mw-panel-head">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Bell size={16} style={{ color: 'var(--brand-hi)' }} />
                <h3>Notification Preferences</h3>
              </div>
              <StatusBadge>Operational Alerts</StatusBadge>
            </div>

            <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <label className="mw-toggle-label" style={{ margin: 0, padding: '12px 14px', background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 8 }}>
                <span>
                  <strong>Spending & Over-quota Notifications</strong>
                  <small style={{ display: 'block', color: 'var(--ink-4)', marginTop: 3 }}>
                    Receive automated email alerts when monthly GPU compute spend approaches 80% and 100% of your configured limit.
                  </small>
                </span>
                <input
                  type="checkbox"
                  checked={emailAlerts}
                  onChange={(e) => setEmailAlerts(e.target.checked)}
                />
              </label>

              <label className="mw-toggle-label" style={{ margin: 0, padding: '12px 14px', background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 8 }}>
                <span>
                  <strong>Weekly Summary Telemetry Report</strong>
                  <small style={{ display: 'block', color: 'var(--ink-4)', marginTop: 3 }}>
                    Aggregated inference latency (TTFT), token volume, active GPU node hours, and compute spend emailed every Monday.
                  </small>
                </span>
                <input
                  type="checkbox"
                  checked={weekly}
                  onChange={(e) => setWeekly(e.target.checked)}
                />
              </label>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'var(--bg-3)', borderRadius: 6, fontSize: '0.78rem', color: 'var(--ink-4)' }}>
                <span>Alerts delivered to:</span>
                <strong style={{ color: 'var(--brand-hi)', fontFamily: 'var(--font-mono, monospace)' }}>{userEmail}</strong>
              </div>
            </div>
          </div>
        </div>

        {/* Row 2: API Security & Configuration + Team & Workspace Management */}
        <div className="mw-two-col">
          {/* Section C: API Security & Configuration */}
          <div className="mw-panel mw-form-panel">
            <div className="mw-panel-head">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <ShieldCheck size={16} style={{ color: 'var(--brand-hi)' }} />
                <h3>API Security & CORS Configuration</h3>
              </div>
              {corsValidation.isValid ? (
                <StatusBadge>Valid Origins</StatusBadge>
              ) : (
                <span style={{ fontSize: '0.72rem', color: '#ef4444', background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.3)', padding: '2px 8px', borderRadius: 4, fontWeight: 600 }}>
                  Invalid URL Format
                </span>
              )}
            </div>

            <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <label style={{ margin: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <span>Allowed API CORS Origins</span>
                  <span style={{ fontSize: '0.72rem', color: 'var(--ink-4)' }}>Comma-separated URLs</span>
                </div>
                <input
                  value={corsOrigins}
                  onChange={(e) => {
                    setCorsOrigins(e.target.value)
                    setCorsTouched(true)
                  }}
                  placeholder="https://app.novatech.ai, http://localhost:3000"
                  style={{
                    borderColor: corsTouched && !corsValidation.isValid ? '#ef4444' : undefined,
                  }}
                />
                {corsTouched && !corsValidation.isValid && (
                  <small style={{ color: '#ef4444', fontSize: '0.75rem', marginTop: 4, display: 'block' }}>
                    {corsValidation.error}
                  </small>
                )}
                <small style={{ color: 'var(--ink-4)', fontSize: '0.75rem', marginTop: 4, display: 'block' }}>
                  Only requests originating from these whitelisted domains can access your Inference and Developer Workspace APIs.
                </small>
              </label>

              <div className="mw-info-box" style={{ margin: 0 }}>
                <Lock size={16} />
                <span>
                  <strong>Strict Enclave Policy:</strong> Production endpoints require signed authorization tokens and validate origin headers against this whitelist.
                </span>
              </div>
            </div>
          </div>

          {/* Section D: Team & Workspace Management */}
          <div className="mw-panel mw-form-panel">
            <div className="mw-panel-head">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Users size={16} style={{ color: 'var(--brand-hi)' }} />
                <h3>Team & Workspace Management</h3>
              </div>
              <StatusBadge>Tenant Boundary</StatusBadge>
            </div>

            <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="mw-info-box" style={{ margin: 0 }}>
                <ShieldCheck size={18} />
                <span>
                  <strong>Organization Tenant Isolation:</strong> NovaTech AI Systems operates under dedicated MeitY sovereign tenant isolation. Multi-user accounts, role definitions, and team permissions are governed in the Users Directory.
                </span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-2)', padding: '12px 14px', borderRadius: 8, border: '1px solid var(--line)' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.86rem', color: 'var(--ink)' }}>Team Directory & Role Assignment</div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--ink-4)' }}>14 Active Users · Enterprise RBAC Enforced</div>
                </div>
                <Link
                  to="/dashboard/users"
                  className="mw-secondary"
                  style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', whiteSpace: 'nowrap' }}
                >
                  <Users size={14} /> Open Directory
                </Link>
              </div>

              <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: '0.76rem', color: 'var(--ink-4)' }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--brand-hi)' }} />
                <span>Role changes require Enterprise Administrator credentials.</span>
              </div>
            </div>
          </div>
        </div>

        {/* Unified Form Actions Bar */}
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 4 }}>
          <button className="mw-primary" type="submit" disabled={!corsValidation.isValid}>
            Save Workspace Settings
          </button>
          <button type="button" className="mw-secondary" onClick={handleResetDefaults}>
            Reset Defaults
          </button>
        </div>
      </form>
    </div>
  )
}
