/**
 * Usage & analytics report built purely from the customer's recorded `inference_requests`.
 *
 * Honesty rules:
 *  - Every figure is derived from real rows. No rows → zeros / null, never sample values.
 *  - A day with no requests is a real zero, so the daily series is zero-filled.
 *  - Percentiles need enough samples to mean something (p95 requires MIN_P95_SAMPLES).
 *  - Cost is reported only when the backend recorded a non-zero cost; otherwise pricing is
 *    "not configured". `inference_requests` has no currency column, so cost carries none.
 *  - Days are UTC calendar days (the same windows as the Overview page).
 */
import { DAY_MS, toFiniteNumber, windowStartMs } from './selectors'
import type { CustomerWorkspace, InferenceRequestRecord } from './types'

export type UsageWindow = 7 | 30 | 90
export const USAGE_WINDOWS: UsageWindow[] = [7, 30, 90]
export const MIN_P95_SAMPLES = 20

export interface UsageDay {
  date: string // YYYY-MM-DD (UTC)
  successful: number
  failed: number
  inputTokens: number
  outputTokens: number
}

export interface ModelBreakdown {
  model: string
  requests: number
  successful: number
  successRate: number
  inputTokens: number
  outputTokens: number
  averageLatencyMs: number | null
}

export interface LatencyStats {
  samples: number
  averageMs: number | null
  p50Ms: number | null
  /** null until there are MIN_P95_SAMPLES samples */
  p95Ms: number | null
}

export interface RequestRow {
  id: string
  at: string
  model: string
  successful: boolean
  status: string
  inputTokens: number
  outputTokens: number
  latencyMs: number | null
  error: string | null
}

export interface UsageReport {
  windowDays: UsageWindow
  requests: number
  successful: number
  failed: number
  successRate: number | null
  inputTokens: number
  outputTokens: number
  latency: LatencyStats
  pricingConfigured: boolean
  /** Sum of backend-recorded costs; null unless pricing is configured. Currency is not recorded. */
  recordedCost: number | null
  days: UsageDay[]
  models: ModelBreakdown[]
  failures: RequestRow[]
  /** Requests in the window, newest first. */
  log: RequestRow[]
  /** Requests ever recorded (outside the window too) — distinguishes "none yet" from "none lately". */
  allTimeRequests: number
}

const ts = (value: string | null | undefined): number | null => {
  if (!value) return null
  const t = Date.parse(value)
  return Number.isFinite(t) ? t : null
}
const tokens = (n: number | null | undefined) => Math.max(0, toFiniteNumber(n) ?? 0)
const isSuccess = (r: InferenceRequestRecord) => (r.status ?? '').trim().toLowerCase() === 'success'

/** Nearest-rank percentile of an ascending-sorted array. */
export function percentile(sortedAscending: number[], p: number): number | null {
  if (sortedAscending.length === 0) return null
  const rank = Math.ceil((p / 100) * sortedAscending.length)
  return sortedAscending[Math.min(sortedAscending.length - 1, Math.max(0, rank - 1))]
}

export function selectLatencyStats(latencies: number[]): LatencyStats {
  const sorted = [...latencies].sort((a, b) => a - b)
  const sum = sorted.reduce((a, b) => a + b, 0)
  return {
    samples: sorted.length,
    averageMs: sorted.length ? Math.round(sum / sorted.length) : null,
    p50Ms: percentile(sorted, 50),
    p95Ms: sorted.length >= MIN_P95_SAMPLES ? percentile(sorted, 95) : null,
  }
}

function toRow(r: InferenceRequestRecord): RequestRow {
  const latency = toFiniteNumber(r.latency_ms)
  return {
    id: r.id,
    at: r.created_at as string,
    model: r.model_name?.trim() || 'Unknown model',
    successful: isSuccess(r),
    status: (r.status ?? 'unknown').trim().toLowerCase() || 'unknown',
    inputTokens: tokens(r.input_tokens),
    outputTokens: tokens(r.output_tokens),
    latencyMs: latency !== null && latency >= 0 ? latency : null,
    error: r.error_message?.trim() || null,
  }
}

export function selectUsageReport(
  ws: CustomerWorkspace,
  options: { now?: number; windowDays?: UsageWindow } = {},
): UsageReport {
  const now = options.now ?? Date.now()
  const windowDays = options.windowDays ?? 30
  const start = windowStartMs(now, windowDays)

  const inWindow = ws.inference_requests.filter((r) => {
    const t = ts(r.created_at)
    return t !== null && t >= start && t <= now
  })

  // Zero-filled UTC day buckets, oldest → newest.
  const days = new Map<string, UsageDay>()
  for (let i = 0; i < windowDays; i++) {
    const date = new Date(start + i * DAY_MS).toISOString().slice(0, 10)
    days.set(date, { date, successful: 0, failed: 0, inputTokens: 0, outputTokens: 0 })
  }

  const models = new Map<string, { requests: number; successful: number; input: number; output: number; lat: number[] }>()
  const latencies: number[] = []
  let inputTokens = 0
  let outputTokens = 0
  let costSum = 0
  let anyCost = false
  let successful = 0

  for (const r of inWindow) {
    const row = toRow(r)
    inputTokens += row.inputTokens
    outputTokens += row.outputTokens
    if (row.successful) successful += 1
    if (row.latencyMs !== null) latencies.push(row.latencyMs)
    const cost = toFiniteNumber(r.cost)
    if (cost !== null && cost > 0) {
      anyCost = true
      costSum += cost
    }

    const day = days.get(new Date(ts(r.created_at)!).toISOString().slice(0, 10))
    if (day) {
      if (row.successful) day.successful += 1
      else day.failed += 1
      day.inputTokens += row.inputTokens
      day.outputTokens += row.outputTokens
    }

    const m = models.get(row.model) ?? { requests: 0, successful: 0, input: 0, output: 0, lat: [] }
    m.requests += 1
    if (row.successful) m.successful += 1
    m.input += row.inputTokens
    m.output += row.outputTokens
    if (row.latencyMs !== null) m.lat.push(row.latencyMs)
    models.set(row.model, m)
  }

  const log = inWindow
    .map(toRow)
    .sort((a, b) => (ts(b.at) ?? 0) - (ts(a.at) ?? 0))

  return {
    windowDays,
    requests: inWindow.length,
    successful,
    failed: inWindow.length - successful,
    successRate: inWindow.length ? successful / inWindow.length : null,
    inputTokens,
    outputTokens,
    latency: selectLatencyStats(latencies),
    pricingConfigured: anyCost,
    recordedCost: anyCost ? costSum : null,
    days: [...days.values()],
    models: [...models.entries()]
      .map(([model, m]): ModelBreakdown => ({
        model,
        requests: m.requests,
        successful: m.successful,
        successRate: m.successful / m.requests,
        inputTokens: m.input,
        outputTokens: m.output,
        averageLatencyMs: m.lat.length ? Math.round(m.lat.reduce((a, b) => a + b, 0) / m.lat.length) : null,
      }))
      .sort((a, b) => b.requests - a.requests || a.model.localeCompare(b.model)),
    failures: log.filter((r) => !r.successful).slice(0, 5),
    log,
    allTimeRequests: ws.inference_requests.length,
  }
}
