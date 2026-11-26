/**
 * Pure selectors over the customer workspace.
 *
 * Rules:
 * - Only derive values from real records. When there is no data, return `null` (or empty
 *   collections) — never a placeholder number.
 * - Costs are only meaningful when the backend recorded a non-zero cost. Until per-model
 *   pricing exists, `pricingConfigured` is false and the UI must say so.
 */
import type {
  ApiKeyRecord,
  CustomerWorkspace,
  InferenceRequestRecord,
  Organization,
  WalletTransaction,
} from './types'

export const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Start (inclusive, UTC midnight) of a window covering the last `days` UTC calendar days,
 * including today. Used by every page that reports "last N days" so figures agree.
 */
export function windowStartMs(now: number, days: number): number {
  return Math.floor(now / DAY_MS) * DAY_MS - (Math.max(1, days) - 1) * DAY_MS
}

export function toFiniteNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN
  return Number.isFinite(n) ? n : null
}

function toTime(value: string | null | undefined): number | null {
  if (!value) return null
  const t = Date.parse(value)
  return Number.isFinite(t) ? t : null
}

/* ── Identity ── */

export interface ProfileSummary {
  displayName: string
  email: string | null
  initials: string
  status: string | null
  isActive: boolean
  organization: Organization | null
}

export function selectProfileSummary(ws: CustomerWorkspace): ProfileSummary {
  const { profile } = ws
  const email = profile.email
  const displayName =
    // Email before username: self-registered usernames are generated ids (cust_…), never a name.
    profile.full_name?.trim() || (email ? email.split('@')[0] : '') || profile.username?.trim() || 'Customer'
  const initials =
    displayName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]!.toUpperCase())
      .join('') || 'C'
  const organization =
    ws.organizations.find((o) => o.id === profile.organization_id) ?? ws.organizations[0] ?? null
  return {
    displayName,
    email,
    initials,
    status: profile.status,
    isActive: (profile.status ?? 'active').toLowerCase() === 'active',
    organization,
  }
}

/* ── Plan & trial (customer_plans, set by administrators) ── */

export interface PlanSummary {
  tier: string | null
  /** none = no trial recorded; active = now before trial_ends_at; expired = after it. */
  trial: 'none' | 'active' | 'expired'
  trialEndsAt: string | null
}

export function selectPlan(ws: CustomerWorkspace, now = Date.now()): PlanSummary {
  const plan = ws.customer_plans?.[0] ?? null
  const tier = plan?.tier?.trim() || null
  const ends = toTime(plan?.trial_ends_at)
  return {
    tier,
    trial: ends === null ? 'none' : now < ends ? 'active' : 'expired',
    trialEndsAt: ends === null ? null : plan!.trial_ends_at,
  }
}

/* ── API keys ── */

export function isApiKeyActive(key: ApiKeyRecord, now = Date.now()): boolean {
  if (key.revoked_at) return false
  if ((key.status ?? '').toLowerCase() !== 'active') return false
  const expires = toTime(key.expires_at)
  return expires === null || expires > now
}

export interface ApiKeySummary {
  total: number
  active: number
  lastUsedAt: string | null
}

export function selectApiKeySummary(ws: CustomerWorkspace, now = Date.now()): ApiKeySummary {
  const active = ws.api_keys.filter((k) => isApiKeyActive(k, now))
  let lastUsed: number | null = null
  for (const key of ws.api_keys) {
    const t = toTime(key.last_used_at)
    if (t !== null && (lastUsed === null || t > lastUsed)) lastUsed = t
  }
  return {
    total: ws.api_keys.length,
    active: active.length,
    lastUsedAt: lastUsed === null ? null : new Date(lastUsed).toISOString(),
  }
}

/* ── Inference usage ── */

export interface ModelUsage {
  model: string
  requests: number
  inputTokens: number
  outputTokens: number
}

export interface DailyUsagePoint {
  date: string // YYYY-MM-DD (UTC)
  requests: number
  tokens: number
}

export interface InferenceSummary {
  windowDays: number
  requests: number
  successful: number
  failed: number
  /** null when there were no requests in the window */
  successRate: number | null
  inputTokens: number
  outputTokens: number
  /** null when no request in the window reported latency */
  averageLatencyMs: number | null
  /** true only when at least one request carried a non-zero recorded cost */
  pricingConfigured: boolean
  /** null unless pricing is configured */
  totalCost: number | null
  byModel: ModelUsage[]
  daily: DailyUsagePoint[]
}

const isSuccess = (r: InferenceRequestRecord) => (r.status ?? '').toLowerCase() === 'success'

export function selectInferenceSummary(
  ws: CustomerWorkspace,
  options: { now?: number; windowDays?: number } = {},
): InferenceSummary {
  const now = options.now ?? Date.now()
  const windowDays = options.windowDays ?? 30
  const since = windowStartMs(now, windowDays)
  const inWindow = ws.inference_requests.filter((r) => {
    const t = toTime(r.created_at)
    return t !== null && t >= since && t <= now
  })

  let inputTokens = 0
  let outputTokens = 0
  let latencySum = 0
  let latencyCount = 0
  let costSum = 0
  let anyCost = false
  const models = new Map<string, ModelUsage>()
  const days = new Map<string, DailyUsagePoint>()

  for (const r of inWindow) {
    const inTok = Math.max(0, toFiniteNumber(r.input_tokens) ?? 0)
    const outTok = Math.max(0, toFiniteNumber(r.output_tokens) ?? 0)
    inputTokens += inTok
    outputTokens += outTok
    const latency = toFiniteNumber(r.latency_ms)
    if (latency !== null && latency >= 0) {
      latencySum += latency
      latencyCount += 1
    }
    const cost = toFiniteNumber(r.cost)
    if (cost !== null && cost > 0) {
      anyCost = true
      costSum += cost
    }
    const model = r.model_name?.trim() || 'Unknown model'
    const m = models.get(model) ?? { model, requests: 0, inputTokens: 0, outputTokens: 0 }
    m.requests += 1
    m.inputTokens += inTok
    m.outputTokens += outTok
    models.set(model, m)

    const date = new Date(toTime(r.created_at)!).toISOString().slice(0, 10)
    const d = days.get(date) ?? { date, requests: 0, tokens: 0 }
    d.requests += 1
    d.tokens += inTok + outTok
    days.set(date, d)
  }

  const successful = inWindow.filter(isSuccess).length
  return {
    windowDays,
    requests: inWindow.length,
    successful,
    failed: inWindow.length - successful,
    successRate: inWindow.length ? successful / inWindow.length : null,
    inputTokens,
    outputTokens,
    averageLatencyMs: latencyCount ? Math.round(latencySum / latencyCount) : null,
    pricingConfigured: anyCost,
    totalCost: anyCost ? costSum : null,
    byModel: [...models.values()].sort((a, b) => b.requests - a.requests || a.model.localeCompare(b.model)),
    daily: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
  }
}

/* ── Wallet ledger (wallet_transactions; balance itself comes from the 8002 wallet service) ── */

export interface LedgerSummary {
  count: number
  credits: number
  debits: number
  currency: string | null
  latest: WalletTransaction[]
}

export function selectLedgerSummary(ws: CustomerWorkspace, latestCount = 5): LedgerSummary {
  const sorted = [...ws.wallet_transactions].sort(
    (a, b) => (toTime(b.created_at) ?? 0) - (toTime(a.created_at) ?? 0),
  )
  let credits = 0
  let debits = 0
  for (const t of sorted) {
    if ((t.status ?? '').toLowerCase() !== 'completed') continue
    const amount = Math.abs(toFiniteNumber(t.amount) ?? 0)
    if ((t.direction ?? '').toLowerCase() === 'credit') credits += amount
    else if ((t.direction ?? '').toLowerCase() === 'debit') debits += amount
  }
  return {
    count: sorted.length,
    credits,
    debits,
    currency: sorted.find((t) => t.currency)?.currency?.trim() || null,
    latest: sorted.slice(0, latestCount),
  }
}

/* ── Recent activity (real notifications + wallet transactions) ── */

export type ActivityItem =
  | {
      kind: 'notification'
      id: string
      at: string
      title: string
      detail: string | null
      type: string | null
      unread: boolean
    }
  | {
      kind: 'transaction'
      id: string
      at: string
      title: string
      detail: string | null
      direction: 'credit' | 'debit' | null
      amount: number | null
      currency: string | null
      status: string | null
    }

export function humaniseCode(code: string | null | undefined): string {
  if (!code) return ''
  const words = code.replace(/[_-]+/g, ' ').trim().toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/**
 * The wallet service records a transaction and sends a notification for the same event
 * (measured on live data: every wallet notification has a same-direction transaction within
 * about 0.15 s). These are the notification types that merely announce a transaction.
 * Alerts such as low-balance warnings are NOT in this list and are never collapsed.
 */
const WALLET_EVENT_DIRECTION: Record<string, 'credit' | 'debit'> = {
  WALLET_RECHARGE_SUCCESS: 'credit',
  WALLET_REFUND: 'credit',
  WALLET_DEBIT: 'debit',
}
export const WALLET_DUPLICATE_WINDOW_MS = 10_000

/**
 * Ids of notifications that duplicate a wallet transaction. Matching is strictly one-to-one
 * (closest in time first), same direction, within `WALLET_DUPLICATE_WINDOW_MS`.
 */
export function selectDuplicateWalletNotificationIds(ws: CustomerWorkspace): Set<string> {
  const candidates: Array<{ notificationId: string; transactionId: string; delta: number }> = []
  for (const n of ws.notifications) {
    const direction = WALLET_EVENT_DIRECTION[(n.notification_type ?? '').toUpperCase()]
    const nt = toTime(n.created_at)
    if (!direction || nt === null) continue
    for (const t of ws.wallet_transactions) {
      const tt = toTime(t.created_at)
      if (tt === null || (t.direction ?? '').toLowerCase() !== direction) continue
      const delta = Math.abs(nt - tt)
      if (delta <= WALLET_DUPLICATE_WINDOW_MS) candidates.push({ notificationId: n.id, transactionId: t.id, delta })
    }
  }
  candidates.sort((a, b) => a.delta - b.delta)
  const usedNotifications = new Set<string>()
  const usedTransactions = new Set<string>()
  for (const c of candidates) {
    if (usedNotifications.has(c.notificationId) || usedTransactions.has(c.transactionId)) continue
    usedNotifications.add(c.notificationId)
    usedTransactions.add(c.transactionId)
  }
  return usedNotifications
}

export function selectRecentActivity(
  ws: CustomerWorkspace,
  limit = 8,
  options: { collapseWalletDuplicates?: boolean } = {},
): ActivityItem[] {
  const duplicates = options.collapseWalletDuplicates === false ? new Set<string>() : selectDuplicateWalletNotificationIds(ws)
  const items: ActivityItem[] = []
  for (const n of ws.notifications) {
    if (duplicates.has(n.id)) continue
    if (!n.created_at || toTime(n.created_at) === null) continue
    items.push({
      kind: 'notification',
      id: `n:${n.id}`,
      at: n.created_at,
      title: n.title?.trim() || humaniseCode(n.notification_type) || 'Notification',
      detail: n.detail?.trim() || null,
      type: n.notification_type,
      unread: !n.is_read,
    })
  }
  for (const t of ws.wallet_transactions) {
    if (!t.created_at || toTime(t.created_at) === null) continue
    const direction = (t.direction ?? '').toLowerCase()
    items.push({
      kind: 'transaction',
      id: `t:${t.id}`,
      at: t.created_at,
      title: walletTypeLabel(t.transaction_type),
      detail: t.description?.trim() || null,
      direction: direction === 'credit' || direction === 'debit' ? direction : null,
      amount: toFiniteNumber(t.amount),
      currency: t.currency?.trim() || null,
      status: t.status,
    })
  }
  return items.sort((a, b) => (toTime(b.at) ?? 0) - (toTime(a.at) ?? 0)).slice(0, limit)
}

/* ── Wallet ledger (full history for the Billing page) ── */

export interface LedgerEntry {
  id: string
  at: string
  typeLabel: string
  direction: 'credit' | 'debit' | null
  amount: number | null
  currency: string | null
  status: string | null
  description: string | null
}

const WALLET_TYPE_LABELS: Record<string, string> = {
  top_up: 'Wallet credit',
  usage_charge: 'Usage charge',
  refund: 'Refund',
  adjustment: 'Adjustment',
}

export function walletTypeLabel(type: string | null | undefined): string {
  const key = (type ?? '').trim().toLowerCase()
  return WALLET_TYPE_LABELS[key] ?? (humaniseCode(type) || 'Transaction')
}

/** Every wallet transaction of the customer, newest first. Nothing is added or inferred. */
export function selectLedger(ws: CustomerWorkspace): LedgerEntry[] {
  return ws.wallet_transactions
    .map((t): LedgerEntry => {
      const direction = (t.direction ?? '').toLowerCase()
      return {
        id: t.id,
        at: t.created_at ?? '',
        typeLabel: walletTypeLabel(t.transaction_type),
        direction: direction === 'credit' || direction === 'debit' ? direction : null,
        amount: toFiniteNumber(t.amount),
        currency: t.currency?.trim() || null,
        status: t.status,
        description: t.description?.trim() || null,
      }
    })
    .sort((a, b) => (toTime(b.at) ?? 0) - (toTime(a.at) ?? 0))
}

/** Completed wallet debits in `currency` since the start of the current local calendar month. */
export function selectMonthSpend(entries: LedgerEntry[], currency: string, now = new Date()): number {
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
  return entries
    .filter((e) => e.direction === 'debit' && e.amount !== null && e.currency === currency && (e.status ?? '').toLowerCase() === 'completed' && (toTime(e.at) ?? 0) >= monthStart)
    .reduce((sum, e) => sum + Math.abs(e.amount!), 0)
}

export interface CurrencyTotals {
  currency: string
  credited: number
  debited: number
  count: number
}

/**
 * Completed credits and debits grouped by their recorded currency (currencies are never mixed).
 * These are sums of recorded transactions, not a reconciliation of the wallet balance.
 */
export function selectLedgerTotals(entries: LedgerEntry[]): CurrencyTotals[] {
  const byCurrency = new Map<string, CurrencyTotals>()
  for (const e of entries) {
    if (!e.currency || e.amount === null || (e.status ?? '').toLowerCase() !== 'completed') continue
    const totals = byCurrency.get(e.currency) ?? { currency: e.currency, credited: 0, debited: 0, count: 0 }
    const value = Math.abs(e.amount)
    if (e.direction === 'credit') totals.credited += value
    else if (e.direction === 'debit') totals.debited += value
    totals.count += 1
    byCurrency.set(e.currency, totals)
  }
  return [...byCurrency.values()].sort((a, b) => b.count - a.count || a.currency.localeCompare(b.currency))
}

/* ── Marketplace & developer resources ── */

export interface MarketplaceSummary {
  providers: number
  listings: number
  availableGpus: number
  regions: string[]
  savedListings: number
}

export function selectMarketplaceSummary(ws: CustomerWorkspace): MarketplaceSummary {
  const regions = new Set<string>()
  let availableGpus = 0
  for (const l of ws.gpu_listings) {
    if (l.region) regions.add(l.region)
    availableGpus += Math.max(0, toFiniteNumber(l.quantity) ?? 0)
  }
  return {
    providers: ws.gpu_providers.length,
    listings: ws.gpu_listings.length,
    availableGpus,
    regions: [...regions].sort(),
    savedListings: ws.saved_gpu_listings.length,
  }
}

export interface DeveloperSummary {
  sshKeys: number
  notebooks: number
  runningNotebooks: number
  deployments: number
}

export function selectDeveloperSummary(ws: CustomerWorkspace): DeveloperSummary {
  return {
    sshKeys: ws.ssh_public_keys.filter((k) => !k.revoked_at).length,
    notebooks: ws.notebook_sessions.filter((n) => (n.status ?? '').toLowerCase() !== 'terminated').length,
    runningNotebooks: ws.notebook_sessions.filter((n) => (n.status ?? '').toLowerCase() === 'running').length,
    deployments: ws.deployments.length,
  }
}

/** True when the workspace contains no customer activity at all (fresh account). */
export function isWorkspaceEmpty(ws: CustomerWorkspace): boolean {
  return (
    ws.api_keys.length === 0 &&
    (ws.inference_requests_total ?? ws.inference_requests.length) === 0 &&
    ws.deployments.length === 0 &&
    ws.ssh_public_keys.length === 0 &&
    ws.notebook_sessions.length === 0 &&
    ws.wallet_transactions.length === 0
  )
}

/* ── Formatting (display only; never invents values) ── */

export function formatInteger(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : new Intl.NumberFormat('en-IN').format(value)
}

export function formatCompact(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

export function formatCurrency(amount: number | null | undefined, currency: string | null | undefined): string {
  if (amount === null || amount === undefined || !currency) return '—'
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount)
  } catch {
    return `${currency} ${amount.toFixed(2)}`
  }
}

export function formatPercent(ratio: number | null | undefined): string {
  return ratio === null || ratio === undefined ? '—' : `${(ratio * 100).toFixed(1)}%`
}

export function formatDate(value: string | null | undefined): string {
  const t = toTime(value)
  if (t === null) return '—'
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(t)
}

export function formatDateTime(value: string | null | undefined): string {
  const t = toTime(value)
  if (t === null) return '—'
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(t)
}

export function formatRelativeTime(value: string | null | undefined, now = Date.now()): string {
  const t = toTime(value)
  if (t === null) return '—'
  const diff = now - t
  const abs = Math.abs(diff)
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 365 * DAY_MS],
    ['month', 30 * DAY_MS],
    ['day', DAY_MS],
    ['hour', 3_600_000],
    ['minute', 60_000],
  ]
  for (const [unit, ms] of units) {
    if (abs >= ms) return rtf.format(-Math.round(diff / ms), unit)
  }
  return 'just now'
}
