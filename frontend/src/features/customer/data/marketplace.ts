/**
 * GPU marketplace view models, built only from the customer's workspace records
 * (`gpu_providers`, `gpu_listings`, `saved_gpu_listings`).
 *
 * Nothing is invented: providers, specs, prices and quantities are shown exactly as recorded.
 * Specs (`vram`, `bandwidth`, `tflops`) are free text in the database, so they are displayed
 * verbatim without assuming units. There are no ratings, scores or availability estimates.
 */
import { toFiniteNumber } from './selectors'
import type { CustomerWorkspace } from './types'

export interface ListingView {
  id: string
  name: string
  gpuModel: string
  providerId: string | null
  providerName: string | null
  region: string | null
  vram: string | null
  architecture: string | null
  bandwidth: string | null
  tflops: string | null
  quantity: number | null
  hourlyPrice: number | null
  currency: string | null
  status: 'Available' | 'Paused' | 'Maintenance' | string
  isSample?: boolean
  saved: boolean
  savedAt: string | null
}

export type ListingSort = 'price-asc' | 'price-desc' | 'name' | 'quantity-desc' | 'vram-desc'

export type GpuArchOrStatusFilter = 'all' | 'ada' | 'hopper' | 'available' | 'paused'

/** Clearly identified development-only sovereign GPU capacity sample dataset */
export const SAMPLE_GPU_LISTINGS: ListingView[] = [
  {
    id: 'sample-gpu-101',
    name: 'NVIDIA L40S',
    gpuModel: 'NVIDIA L40S',
    providerId: 'provider-yotta',
    providerName: 'Yotta NM1 (Mumbai)',
    region: 'Mumbai, IN',
    vram: '48 GB',
    architecture: 'Ada Lovelace',
    bandwidth: '864 GB/s',
    tflops: '91.6 TFLOPS',
    quantity: 8,
    hourlyPrice: 100,
    currency: 'INR',
    status: 'Available',
    isSample: true,
    saved: false,
    savedAt: null,
  },
  {
    id: 'sample-gpu-102',
    name: 'NVIDIA L4',
    gpuModel: 'NVIDIA L4',
    providerId: 'provider-ctrls',
    providerName: 'CtrlS (Hyderabad)',
    region: 'Hyderabad, IN',
    vram: '24 GB',
    architecture: 'Ada Lovelace',
    bandwidth: '300 GB/s',
    tflops: '30.3 TFLOPS',
    quantity: 16,
    hourlyPrice: 60,
    currency: 'INR',
    status: 'Available',
    isSample: true,
    saved: false,
    savedAt: null,
  },
  {
    id: 'sample-gpu-103',
    name: 'NVIDIA A100',
    gpuModel: 'NVIDIA A100',
    providerId: 'provider-sify',
    providerName: 'Sify Infinit (Chennai)',
    region: 'Chennai, IN',
    vram: '80 GB',
    architecture: 'Ampere',
    bandwidth: '2039 GB/s',
    tflops: '77.9 TFLOPS',
    quantity: 4,
    hourlyPrice: 210,
    currency: 'INR',
    status: 'Paused',
    isSample: true,
    saved: false,
    savedAt: null,
  },
  {
    id: 'sample-gpu-104',
    name: 'NVIDIA H100 SXM5',
    gpuModel: 'NVIDIA H100 SXM5',
    providerId: 'provider-yotta',
    providerName: 'Yotta NM1 (Mumbai)',
    region: 'Mumbai, IN',
    vram: '80 GB',
    architecture: 'Hopper',
    bandwidth: '3350 GB/s',
    tflops: '134.0 TFLOPS',
    quantity: 8,
    hourlyPrice: 275,
    currency: 'INR',
    status: 'Available',
    isSample: true,
    saved: false,
    savedAt: null,
  },
  {
    id: 'sample-gpu-105',
    name: 'NVIDIA H200',
    gpuModel: 'NVIDIA H200',
    providerId: 'provider-e2e',
    providerName: 'E2E Cloud (Noida/Delhi)',
    region: 'Delhi, IN',
    vram: '141 GB',
    architecture: 'Hopper',
    bandwidth: '4800 GB/s',
    tflops: '140.0 TFLOPS',
    quantity: 2,
    hourlyPrice: 340,
    currency: 'INR',
    status: 'Maintenance',
    isSample: true,
    saved: false,
    savedAt: null,
  },
]

export const WISHLIST_STORAGE_KEY = 'inferxe_demo_wishlist_v1'
export const DEFAULT_WISHLIST_IDS = ['sample-gpu-101', 'sample-gpu-104']

export function getLocalWishlistIds(): string[] {
  try {
    const raw = localStorage.getItem(WISHLIST_STORAGE_KEY)
    if (!raw) return DEFAULT_WISHLIST_IDS
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : DEFAULT_WISHLIST_IDS
  } catch {
    return DEFAULT_WISHLIST_IDS
  }
}

export function setLocalWishlistIds(ids: string[]): void {
  try {
    localStorage.setItem(WISHLIST_STORAGE_KEY, JSON.stringify(ids))
    window.dispatchEvent(new CustomEvent('inferxe_wishlist_change'))
  } catch {}
}

export function toggleLocalWishlistId(id: string): boolean {
  const current = getLocalWishlistIds()
  const exists = current.includes(id)
  const next = exists ? current.filter((item) => item !== id) : [...current, id]
  setLocalWishlistIds(next)
  return !exists
}

const text = (value: unknown): string | null => {
  if (value === null || value === undefined) return null
  const s = String(value).trim()
  return s ? s : null
}

export function selectListings(ws: CustomerWorkspace): ListingView[] {
  const providers = new Map((ws.gpu_providers ?? []).map((p) => [p.id, p]))
  const saved = new Map((ws.saved_gpu_listings ?? []).map((s) => [s.listing_id, s]))
  return (ws.gpu_listings ?? []).map((l): ListingView => {
    const provider = l.provider_id ? providers.get(l.provider_id) : undefined
    const quantity = toFiniteNumber(l.quantity)
    return {
      id: l.id,
      name: text(l.name) ?? text(l.gpu_model) ?? 'GPU listing',
      gpuModel: text(l.gpu_model) ?? text(l.name) ?? 'GPU',
      providerId: l.provider_id ?? null,
      providerName: provider ? text(provider.name) : null,
      region: text(l.region) ?? (provider ? text(provider.region) : null),
      vram: text(l.vram),
      architecture: text(l.architecture),
      bandwidth: text(l.bandwidth),
      tflops: text(l.tflops),
      quantity: quantity === null ? null : Math.max(0, Math.trunc(quantity)),
      hourlyPrice: toFiniteNumber(l.hourly_price),
      currency: text(l.currency),
      status: (text((l as any).status) as any) ?? (quantity && quantity > 0 ? 'Available' : 'Paused'),
      isSample: false,
      saved: saved.has(l.id),
      savedAt: saved.get(l.id)?.created_at ?? null,
    }
  })
}

/** Saved listings that are no longer in the available listings (so they can only be removed). */
export function selectUnavailableSaved(ws: CustomerWorkspace): Array<{ listingId: string; savedAt: string | null }> {
  const available = new Set(ws.gpu_listings.map((l) => l.id))
  return ws.saved_gpu_listings
    .filter((s) => !available.has(s.listing_id))
    .map((s) => ({ listingId: s.listing_id, savedAt: s.created_at }))
}

/* ── Deployment records (read-only) ── */

export interface DeploymentView {
  id: string
  name: string
  model: string | null
  gpu: string | null
  region: string | null
  /** The status value stored on the record. */
  recordedStatus: string | null
  /** Recorded hourly rate — only when its currency is also recorded (otherwise both are null). */
  hourlyRate: number | null
  currency: string | null
  createdAt: string | null
  startedAt?: string | null
  stoppedAt?: string | null
}

/**
 * Deployment records exactly as stored. A rate is shown only together with its recorded currency.
 * Endpoint URLs, metadata and identifiers are intentionally left out.
 */
export function selectDeployments(ws: CustomerWorkspace): DeploymentView[] {
  return ws.deployments
    .map((d): DeploymentView => {
      const rate = toFiniteNumber(d.hourly_rate)
      const currency = text(d.currency ?? null)?.toUpperCase() ?? null
      const priced = rate !== null && rate >= 0 && !!currency && /^[A-Z]{3}$/.test(currency)
      return {
        id: d.id,
        name: text(d.name) ?? 'Untitled deployment',
        model: text(d.model_name),
        gpu: text(d.gpu_model),
        region: text(d.region),
        recordedStatus: text(d.status),
        hourlyRate: priced ? rate : null,
        currency: priced ? currency : null,
        createdAt: d.created_at ?? null,
        startedAt: d.started_at ?? null,
        stoppedAt: d.stopped_at ?? null,
      }
    })
    .sort((a, b) => (Date.parse(b.createdAt ?? '') || 0) - (Date.parse(a.createdAt ?? '') || 0))
}

export function filterDeployments(
  deployments: DeploymentView[],
  query: string,
  statusFilter: string,
): DeploymentView[] {
  const q = query.trim().toLowerCase()
  return deployments.filter((d) => {
    if (statusFilter !== 'all') {
      const s = (d.recordedStatus ?? '').toLowerCase()
      if (statusFilter === 'running' && s !== 'running') return false
      if (statusFilter === 'provisioning' && s !== 'provisioning') return false
      if (statusFilter === 'stopped' && s !== 'stopped' && s !== 'terminated' && s !== 'failed') return false
    }
    if (!q) return true
    return [d.name, d.model, d.gpu, d.region, d.id].some((v) => (v ?? '').toLowerCase().includes(q))
  })
}

export interface Burn {
  /** Sum of recorded rates of running deployments priced in `currency`, or null when none are. */
  perHour: number | null
  /** Running deployments that have no rate in `currency` (not counted in perHour). */
  unpriced: number
}

/** Hourly burn of deployments recorded as running, in one currency only (currencies are never mixed). */
export function selectBurn(deployments: DeploymentView[], currency: string): Burn {
  const running = deployments.filter((d) => (d.recordedStatus ?? '').toLowerCase() === 'running')
  const priced = running.filter((d) => d.hourlyRate !== null && d.currency === currency)
  return {
    perHour: priced.length ? priced.reduce((sum, d) => sum + d.hourlyRate!, 0) : null,
    unpriced: running.length - priced.length,
  }
}

export interface ListingFilters {
  query: string
  providerId: string
  region: string
  archOrStatus?: GpuArchOrStatusFilter
  savedOnly: boolean
}

export function filterListings(listings: ListingView[], f: ListingFilters): ListingView[] {
  const q = f.query.trim().toLowerCase()
  return listings.filter((l) => {
    if (f.providerId && l.providerId !== f.providerId) return false
    if (f.region && l.region !== f.region) return false
    if (f.savedOnly && !l.saved) return false
    if (f.archOrStatus && f.archOrStatus !== 'all') {
      if (f.archOrStatus === 'ada') {
        const arch = (l.architecture ?? '').toLowerCase()
        const model = (l.gpuModel ?? '').toLowerCase()
        if (!arch.includes('ada') && !arch.includes('lovelace') && !model.includes('l4')) return false
      } else if (f.archOrStatus === 'hopper') {
        const arch = (l.architecture ?? '').toLowerCase()
        const model = (l.gpuModel ?? '').toLowerCase()
        if (!arch.includes('hopper') && !model.includes('h100') && !model.includes('h200')) return false
      } else if (f.archOrStatus === 'available') {
        if ((l.status ?? '').toLowerCase() !== 'available') return false
      } else if (f.archOrStatus === 'paused') {
        if ((l.status ?? '').toLowerCase() !== 'paused') return false
      }
    }
    if (!q) return true
    return [l.name, l.gpuModel, l.providerName, l.region, l.architecture, l.status].some((v) => (v ?? '').toLowerCase().includes(q))
  })
}

export function sortListings(listings: ListingView[], sort: ListingSort): ListingView[] {
  const byName = (a: ListingView, b: ListingView) => a.gpuModel.localeCompare(b.gpuModel) || a.name.localeCompare(b.name)
  const sorted = [...listings]
  switch (sort) {
    case 'price-asc':
      return sorted.sort((a, b) => (a.hourlyPrice ?? Infinity) - (b.hourlyPrice ?? Infinity) || byName(a, b))
    case 'price-desc':
      // listings without a price always sort last
      return sorted.sort((a, b) => (b.hourlyPrice ?? -Infinity) - (a.hourlyPrice ?? -Infinity) || byName(a, b))
    case 'quantity-desc':
      return sorted.sort((a, b) => (b.quantity ?? -1) - (a.quantity ?? -1) || byName(a, b))
    case 'vram-desc': {
      const parseVram = (v: string | null) => {
        if (!v) return -1
        const m = v.match(/(\d+(?:\.\d+)?)/)
        return m ? parseFloat(m[1]) : -1
      }
      return sorted.sort((a, b) => parseVram(b.vram) - parseVram(a.vram) || byName(a, b))
    }
    default:
      return sorted.sort(byName)
  }
}

/** Distinct, sorted values for the filter dropdowns. */
export function selectFilterOptions(listings: ListingView[]): { providers: Array<{ id: string; name: string }>; regions: string[] } {
  const providers = new Map<string, string>()
  const regions = new Set<string>()
  for (const l of listings) {
    if (l.providerId && l.providerName) providers.set(l.providerId, l.providerName)
    if (l.region) regions.add(l.region)
  }
  return {
    providers: [...providers.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
    regions: [...regions].sort((a, b) => a.localeCompare(b)),
  }
}

/* ── Orders & Purchase History ── */

export type OrderStatus = 'running' | 'completed' | 'cancelled' | 'archived'

export interface OrderView {
  id: string
  orderNumber: string
  workload: string
  hardware: string
  workloadHardware: string
  datacenterFacility: string
  orderDate: string
  orderDateIso: string
  duration: string
  durationMinutes: number
  estimatedCost: string
  estimatedCostNum: number
  actualCost: string
  actualCostNum: number
  currency: string
  status: OrderStatus
  deploymentId: string | null
  details: Record<string, any>
  createdAt: string | null
  updatedAt: string | null
}

export const SAMPLE_ORDERS: OrderView[] = [
  {
    id: 'ord-8492-uuid',
    orderNumber: 'ORD-8492',
    workload: 'Qwen 2.5 7B',
    hardware: '1x NVIDIA L4',
    workloadHardware: 'Qwen 2.5 7B · 1x NVIDIA L4',
    datacenterFacility: 'Yotta NM1 (Mumbai)',
    orderDate: '10 Oct 2026',
    orderDateIso: '2026-10-10T14:30:00Z',
    duration: '24 hours',
    durationMinutes: 1440,
    estimatedCost: '₹1,440',
    estimatedCostNum: 1440,
    actualCost: '₹1,440',
    actualCostNum: 1440,
    currency: 'INR',
    status: 'running',
    deploymentId: 'dep_1',
    details: {
      gpu_model: '1x NVIDIA L4',
      workload: 'Qwen 2.5 7B',
      datacenter: 'Yotta NM1 (Mumbai)',
      specs: '24GB VRAM · 300 GB/s · PCIe Gen 4',
      start_date: '10 Oct 2026, 14:30',
      end_date: '11 Oct 2026, 14:30',
      duration: '24 hours',
      estimated_cost: '₹1,440',
      actual_cost: '₹1,440',
      payment_method: 'Prepaid Wallet',
      payment_status: 'Active Debit',
      transaction_id: 'TX-1048',
      invoice_number: 'INV-2026-08492',
    },
    createdAt: '2026-10-10T14:30:00Z',
    updatedAt: '2026-10-10T14:30:00Z',
  },
  {
    id: 'ord-8431-uuid',
    orderNumber: 'ORD-8431',
    workload: 'Llama 3.1 8B',
    hardware: '1x NVIDIA L40S',
    workloadHardware: 'Llama 3.1 8B · 1x NVIDIA L40S',
    datacenterFacility: 'E2E Cloud (Noida)',
    orderDate: '08 Oct 2026',
    orderDateIso: '2026-10-08T09:15:00Z',
    duration: '12 hours',
    durationMinutes: 720,
    estimatedCost: '₹1,200',
    estimatedCostNum: 1200,
    actualCost: '₹1,200',
    actualCostNum: 1200,
    currency: 'INR',
    status: 'completed',
    deploymentId: 'dep_2',
    details: {
      gpu_model: '1x NVIDIA L40S',
      workload: 'Llama 3.1 8B',
      datacenter: 'E2E Cloud (Noida)',
      specs: '48GB VRAM · 864 GB/s · Ada Lovelace',
      start_date: '08 Oct 2026, 09:15',
      end_date: '08 Oct 2026, 21:15',
      duration: '12 hours',
      estimated_cost: '₹1,200',
      actual_cost: '₹1,200',
      payment_method: 'Prepaid Wallet',
      payment_status: 'Paid & Settled',
      transaction_id: 'TX-1032',
      invoice_number: 'INV-2026-08431',
    },
    createdAt: '2026-10-08T09:15:00Z',
    updatedAt: '2026-10-08T21:15:00Z',
  },
  {
    id: 'ord-8390-uuid',
    orderNumber: 'ORD-8390',
    workload: 'DeepSeek R1 671B',
    hardware: '8x NVIDIA H100',
    workloadHardware: 'DeepSeek R1 671B · 8x NVIDIA H100',
    datacenterFacility: 'CtrlS Datacenters (Hyderabad)',
    orderDate: '04 Oct 2026',
    orderDateIso: '2026-10-04T16:00:00Z',
    duration: '4 hours',
    durationMinutes: 240,
    estimatedCost: '₹8,800',
    estimatedCostNum: 8800,
    actualCost: '₹8,800',
    actualCostNum: 8800,
    currency: 'INR',
    status: 'completed',
    deploymentId: null,
    details: {
      gpu_model: '8x NVIDIA H100',
      workload: 'DeepSeek R1 671B',
      datacenter: 'CtrlS Datacenters (Hyderabad)',
      specs: '640GB SXM5 · 3.35 TB/s · NVLink 4',
      start_date: '04 Oct 2026, 16:00',
      end_date: '04 Oct 2026, 20:00',
      duration: '4 hours',
      estimated_cost: '₹8,800',
      actual_cost: '₹8,800',
      payment_method: 'Prepaid Wallet',
      payment_status: 'Paid & Settled',
      transaction_id: 'TX-1011',
      invoice_number: 'INV-2026-08390',
    },
    createdAt: '2026-10-04T16:00:00Z',
    updatedAt: '2026-10-04T20:00:00Z',
  },
  {
    id: 'ord-8312-uuid',
    orderNumber: 'ORD-8312',
    workload: 'Mistral 7B',
    hardware: '1x NVIDIA L4',
    workloadHardware: 'Mistral 7B · 1x NVIDIA L4',
    datacenterFacility: 'Yotta NM1 (Mumbai)',
    orderDate: '01 Oct 2026',
    orderDateIso: '2026-10-01T11:00:00Z',
    duration: '8 hours',
    durationMinutes: 480,
    estimatedCost: '₹480',
    estimatedCostNum: 480,
    actualCost: '₹0',
    actualCostNum: 0,
    currency: 'INR',
    status: 'cancelled',
    deploymentId: null,
    details: {
      gpu_model: '1x NVIDIA L4',
      workload: 'Mistral 7B',
      datacenter: 'Yotta NM1 (Mumbai)',
      specs: '24GB VRAM · 300 GB/s · PCIe Gen 4',
      start_date: '01 Oct 2026, 11:00',
      end_date: '01 Oct 2026, 11:05',
      duration: '8 hours (Cancelled after 5m)',
      estimated_cost: '₹480',
      actual_cost: '₹0',
      payment_method: 'Prepaid Wallet',
      payment_status: 'Refunded',
      transaction_id: 'TX-998',
      invoice_number: 'INV-2026-08312',
    },
    createdAt: '2026-10-01T11:00:00Z',
    updatedAt: '2026-10-01T11:05:00Z',
  },
  {
    id: 'ord-8201-uuid',
    orderNumber: 'ORD-8201',
    workload: 'CodeQwen 7B',
    hardware: '1x NVIDIA L40S',
    workloadHardware: 'CodeQwen 7B · 1x NVIDIA L40S',
    datacenterFacility: 'Sify Infinit (Chennai)',
    orderDate: '25 Sep 2026',
    orderDateIso: '2026-09-25T08:00:00Z',
    duration: '72 hours',
    durationMinutes: 4320,
    estimatedCost: '₹7,200',
    estimatedCostNum: 7200,
    actualCost: '₹7,200',
    actualCostNum: 7200,
    currency: 'INR',
    status: 'archived',
    deploymentId: null,
    details: {
      gpu_model: '1x NVIDIA L40S',
      workload: 'CodeQwen 7B',
      datacenter: 'Sify Infinit (Chennai)',
      specs: '48GB VRAM · 864 GB/s · Ada Lovelace',
      start_date: '25 Sep 2026, 08:00',
      end_date: '28 Sep 2026, 08:00',
      duration: '72 hours',
      estimated_cost: '₹7,200',
      actual_cost: '₹7,200',
      payment_method: 'Prepaid Wallet',
      payment_status: 'Paid & Archived',
      transaction_id: 'TX-942',
      invoice_number: 'INV-2026-08201',
    },
    createdAt: '2026-09-25T08:00:00Z',
    updatedAt: '2026-09-28T08:00:00Z',
  },
]

function formatOrderDate(isoString: string | null | undefined): string {
  if (!isoString) return '—'
  try {
    const d = new Date(isoString)
    if (isNaN(d.getTime())) return String(isoString)
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  } catch {
    return String(isoString)
  }
}

export function selectOrders(workspace: CustomerWorkspace | null): OrderView[] {
  if (!workspace || !workspace.orders) return []
  return workspace.orders.map((o) => {
    let details: Record<string, any> = {}
    if (typeof o.details === 'string') {
      try {
        details = JSON.parse(o.details)
      } catch {
        details = {}
      }
    } else if (typeof o.details === 'object' && o.details) {
      details = o.details as Record<string, any>
    }

    const orderNumber = o.order_number || (o.id ? `ORD-${o.id.slice(0, 4).toUpperCase()}` : 'ORD-0000')
    const workload = details.workload || o.item_name?.split('·')[0]?.trim() || o.item_name || 'Compute Workload'
    const hardware = details.gpu_model || o.item_name?.split('·')[1]?.trim() || 'NVIDIA GPU'
    const workloadHardware = o.item_name || `${workload} · ${hardware}`
    const datacenterFacility = o.provider_name || details.datacenter || 'Mumbai, IN'
    const orderDateIso = o.order_date || o.created_at || new Date().toISOString()
    const orderDate = formatOrderDate(orderDateIso)
    const durationMinutes = typeof o.duration_minutes === 'number' ? o.duration_minutes : 60
    const duration = details.duration || (durationMinutes >= 60 ? `${Math.round(durationMinutes / 60)} hours` : `${durationMinutes} mins`)
    const costNum = typeof o.total_cost === 'number' ? o.total_cost : parseFloat(String(o.total_cost || '0')) || 0
    const currency = o.currency || 'INR'
    const estimatedCost = details.estimated_cost || (currency === 'INR' ? `₹${costNum.toLocaleString('en-IN')}` : `$${costNum.toFixed(2)}`)
    const actualCost = details.actual_cost || estimatedCost
    const actualCostNum = details.actual_cost ? parseFloat(String(details.actual_cost).replace(/[^0-9.]/g, '')) || costNum : costNum

    const rawStatus = (o.status || '').toLowerCase().trim()
    let status: OrderStatus = 'running'
    if (rawStatus === 'completed' || rawStatus === 'success') status = 'completed'
    else if (rawStatus === 'cancelled' || rawStatus === 'failed') status = 'cancelled'
    else if (rawStatus === 'archived') status = 'archived'

    return {
      id: o.id,
      orderNumber,
      workload,
      hardware,
      workloadHardware,
      datacenterFacility,
      orderDate,
      orderDateIso,
      duration,
      durationMinutes,
      estimatedCost,
      estimatedCostNum: costNum,
      actualCost,
      actualCostNum,
      currency,
      status,
      deploymentId: o.deployment_id || null,
      details,
      createdAt: o.created_at,
      updatedAt: o.updated_at,
    }
  })
}

export function filterOrders(
  orders: OrderView[],
  statusTab: 'all' | 'running' | 'completed' | 'cancelled' | 'archived',
  query?: string,
): OrderView[] {
  const q = (query || '').trim().toLowerCase()
  return orders.filter((o) => {
    if (statusTab !== 'all' && o.status !== statusTab) return false
    if (!q) return true
    return [
      o.orderNumber,
      o.workload,
      o.hardware,
      o.workloadHardware,
      o.datacenterFacility,
      o.orderDate,
      o.duration,
      o.estimatedCost,
      o.status,
    ].some((field) => (field || '').toLowerCase().includes(q))
  })
}

export function getOrderCounts(orders: OrderView[]): {
  all: number
  running: number
  completed: number
  cancelled: number
  archived: number
} {
  return {
    all: orders.length,
    running: orders.filter((o) => o.status === 'running').length,
    completed: orders.filter((o) => o.status === 'completed').length,
    cancelled: orders.filter((o) => o.status === 'cancelled').length,
    archived: orders.filter((o) => o.status === 'archived').length,
  }
}

/* ── Checkout & Payments View Helpers ── */

export interface CheckoutCoupon {
  code: string
  percent?: number
  flat?: number
}

export const VALID_COUPONS: Record<string, CheckoutCoupon> = {
  INFERXE10: { code: 'INFERXE10', percent: 10 },
  FRIEND15: { code: 'FRIEND15', percent: 15 },
  LAUNCH50: { code: 'LAUNCH50', flat: 500 },
}

export interface CheckoutBreakdown {
  baseCost: number
  discount: number
  taxable: number
  tax: number
  total: number
}

export function calculateCheckoutCost(
  hourlyPrice: number,
  durationHours: number,
  appliedCoupon?: CheckoutCoupon | null,
): CheckoutBreakdown {
  const baseCost = Math.max(0, hourlyPrice * durationHours)
  let discount = 0
  if (appliedCoupon?.percent) {
    discount = Math.round((baseCost * appliedCoupon.percent) / 100)
  } else if (appliedCoupon?.flat) {
    discount = Math.min(baseCost, appliedCoupon.flat)
  }
  const taxable = Math.max(0, baseCost - discount)
  const tax = Math.round(taxable * 0.18)
  const total = taxable + tax
  return { baseCost, discount, taxable, tax, total }
}

