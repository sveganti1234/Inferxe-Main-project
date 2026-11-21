import { describe, it, expect } from 'vitest'
import {
  DAY_MS,
  selectDuplicateWalletNotificationIds,
  selectInferenceSummary,
  selectLedger,
  selectLedgerTotals,
  selectRecentActivity,
  walletTypeLabel,
  windowStartMs,
} from '../../features/customer/data/selectors'
import { MIN_P95_SAMPLES, percentile, selectLatencyStats, selectUsageReport } from '../../features/customer/data/usage'
import type { InferenceRequestRecord, WalletTransaction, WorkspaceNotification } from '../../features/customer/data/types'
import { emptyWorkspace } from './fixtures'

const NOW = Date.parse('2026-11-17T12:00:00Z')
const at = (offsetMs: number) => new Date(NOW + offsetMs).toISOString()

const tx = (over: Partial<WalletTransaction>): WalletTransaction => ({
  id: 't', wallet_id: null, user_id: 'u', order_id: null, transaction_reference: null, transaction_type: 'top_up',
  direction: 'credit', amount: '100', currency: 'INR', status: 'completed', description: null, created_at: at(0), ...over,
})
const note = (over: Partial<WorkspaceNotification>): WorkspaceNotification => ({
  id: 'n', user_id: 'u', title: 'Wallet recharged', detail: null, notification_type: 'WALLET_RECHARGE_SUCCESS',
  is_read: false, created_at: at(150), read_at: null, ...over,
})
const req = (over: Partial<InferenceRequestRecord>): InferenceRequestRecord => ({
  id: Math.random().toString(36).slice(2), user_id: 'u', organization_id: null, api_key_id: null, deployment_id: null,
  model_name: 'model-a', provider_name: 'nvidia', input_tokens: 10, output_tokens: 5, latency_ms: 100, status: 'success',
  error_message: null, cost: 0, created_at: at(-DAY_MS), ...over,
})

describe('duplicate wallet activity', () => {
  it('collapses a wallet notification into its matching transaction (same direction, within seconds)', () => {
    const ws = emptyWorkspace({ wallet_transactions: [tx({ id: 't1' })], notifications: [note({ id: 'n1' })] })
    expect([...selectDuplicateWalletNotificationIds(ws)]).toEqual(['n1'])
    const feed = selectRecentActivity(ws)
    expect(feed).toHaveLength(1)
    expect(feed[0]).toMatchObject({ kind: 'transaction', title: 'Wallet credit' })
  })

  it('keeps notifications that are not duplicates', () => {
    const base = { wallet_transactions: [tx({ id: 't1' })] }
    const keeps: Array<Partial<WorkspaceNotification>> = [
      { id: 'wrong-direction', notification_type: 'WALLET_DEBIT' }, // debit notification vs credit transaction
      { id: 'low-balance', notification_type: 'WALLET_LOW_BALANCE' }, // an alert, never a duplicate
      { id: 'too-far', created_at: at(30_000) }, // 30 s apart
      { id: 'other-type', notification_type: 'MAINTENANCE_SCHEDULED' },
    ]
    for (const keep of keeps) {
      const ws = emptyWorkspace({ ...base, notifications: [note(keep)] })
      expect(selectDuplicateWalletNotificationIds(ws).size, String(keep.id)).toBe(0)
      expect(selectRecentActivity(ws)).toHaveLength(2)
    }
  })

  it('matches strictly one-to-one, closest first', () => {
    const ws = emptyWorkspace({
      wallet_transactions: [tx({ id: 't1' })],
      notifications: [note({ id: 'near', created_at: at(100) }), note({ id: 'far', created_at: at(3_000) })],
    })
    expect([...selectDuplicateWalletNotificationIds(ws)]).toEqual(['near'])
    expect(selectRecentActivity(ws).map((i) => i.kind).sort()).toEqual(['notification', 'transaction'])
  })

  it('can be switched off, and never hides transactions', () => {
    const ws = emptyWorkspace({ wallet_transactions: [tx({ id: 't1' })], notifications: [note({ id: 'n1' })] })
    expect(selectRecentActivity(ws, 8, { collapseWalletDuplicates: false })).toHaveLength(2)
    expect(selectRecentActivity(ws).some((i) => i.kind === 'transaction')).toBe(true)
  })

  it('works for debits and refunds too', () => {
    const ws = emptyWorkspace({
      wallet_transactions: [tx({ id: 'd', direction: 'debit', transaction_type: 'usage_charge' }), tx({ id: 'r', direction: 'credit', transaction_type: 'refund', created_at: at(60_000) })],
      notifications: [
        note({ id: 'nd', notification_type: 'WALLET_DEBIT' }),
        note({ id: 'nr', notification_type: 'WALLET_REFUND', created_at: at(60_100) }),
      ],
    })
    expect([...selectDuplicateWalletNotificationIds(ws)].sort()).toEqual(['nd', 'nr'])
  })
})

describe('wallet ledger', () => {
  it('labels transaction types and sorts newest first', () => {
    expect(walletTypeLabel('top_up')).toBe('Wallet credit')
    expect(walletTypeLabel('usage_charge')).toBe('Usage charge')
    expect(walletTypeLabel('some_new_kind')).toBe('Some new kind')
    expect(walletTypeLabel(null)).toBe('Transaction')
    const entries = selectLedger(emptyWorkspace({ wallet_transactions: [tx({ id: 'old', created_at: at(-DAY_MS) }), tx({ id: 'new', created_at: at(0) })] }))
    expect(entries.map((e) => e.id)).toEqual(['new', 'old'])
  })

  it('totals completed transactions per recorded currency without mixing currencies', () => {
    const entries = selectLedger(emptyWorkspace({
      wallet_transactions: [
        tx({ id: '1', amount: '1000' }),
        tx({ id: '2', amount: '250', direction: 'debit' }),
        tx({ id: '3', amount: '999', status: 'pending' }),
        tx({ id: '4', amount: '5', currency: 'USD' }),
        tx({ id: '5', amount: null }),
        tx({ id: '6', currency: null }),
      ],
    }))
    const totals = selectLedgerTotals(entries)
    expect(totals).toEqual([
      { currency: 'INR', credited: 1000, debited: 250, count: 2 },
      { currency: 'USD', credited: 5, debited: 0, count: 1 },
    ])
  })

  it('returns nothing for an empty ledger', () => {
    expect(selectLedger(emptyWorkspace())).toEqual([])
    expect(selectLedgerTotals([])).toEqual([])
  })
})

describe('usage report', () => {
  it('uses UTC calendar-day windows that agree with the Overview summary', () => {
    expect(windowStartMs(NOW, 1)).toBe(Date.parse('2026-11-17T00:00:00Z'))
    expect(windowStartMs(NOW, 7)).toBe(Date.parse('2026-11-11T00:00:00Z'))
    const ws = emptyWorkspace({
      inference_requests: [
        req({ created_at: at(-1) }),
        req({ created_at: '2026-11-11T00:00:00Z' }), // first instant of a 7-day window
        req({ created_at: '2026-11-10T23:59:59Z' }), // just outside
        req({ created_at: at(60_000) }), // in the future → ignored
      ],
    })
    expect(selectUsageReport(ws, { now: NOW, windowDays: 7 }).requests).toBe(2)
    for (const windowDays of [7, 30, 90] as const) {
      expect(selectUsageReport(ws, { now: NOW, windowDays }).requests).toBe(selectInferenceSummary(ws, { now: NOW, windowDays }).requests)
    }
  })

  it('zero-fills one bucket per day, oldest first, ending today', () => {
    const ws = emptyWorkspace({ inference_requests: [req({ created_at: at(-DAY_MS), input_tokens: 40, output_tokens: 2 })] })
    const r = selectUsageReport(ws, { now: NOW, windowDays: 7 })
    expect(r.days).toHaveLength(7)
    expect(r.days[0].date).toBe('2026-11-11')
    expect(r.days[6].date).toBe('2026-11-17')
    expect(r.days.find((d) => d.date === '2026-11-16')).toMatchObject({ successful: 1, failed: 0, inputTokens: 40, outputTokens: 2 })
    expect(r.days.filter((d) => d.successful + d.failed === 0)).toHaveLength(6)
  })

  it('aggregates requests, tokens, success rate, models, failures and the log', () => {
    const ws = emptyWorkspace({
      inference_requests: [
        req({ model_name: 'a', created_at: at(-1000), latency_ms: 100 }),
        req({ model_name: 'a', created_at: at(-2000), latency_ms: 300, status: 'failed', error_message: 'boom' }),
        req({ model_name: 'b', created_at: at(-3000), latency_ms: null, status: 'timeout', error_message: null }),
        req({ model_name: null, created_at: at(-4000) }),
      ],
    })
    const r = selectUsageReport(ws, { now: NOW, windowDays: 30 })
    expect(r).toMatchObject({ requests: 4, successful: 2, failed: 2, successRate: 0.5, inputTokens: 40, outputTokens: 20 })
    // Most requests first; ties are broken alphabetically (locale-aware, so "b" sorts before "Unknown model").
    expect(r.models.map((m) => [m.model, m.requests, m.successRate, m.averageLatencyMs])).toEqual([
      ['a', 2, 0.5, 200],
      ['b', 1, 0, null],
      ['Unknown model', 1, 1, 100],
    ])
    expect(r.failures.map((f) => [f.status, f.error])).toEqual([['failed', 'boom'], ['timeout', null]])
    expect(r.log.map((l) => l.at)).toEqual([...r.log.map((l) => l.at)].sort().reverse())
    expect(r.latency).toMatchObject({ samples: 3, averageMs: 167, p50Ms: 100, p95Ms: null })
  })

  it('reports cost only when the backend recorded one, and never a currency', () => {
    const none = selectUsageReport(emptyWorkspace({ inference_requests: [req({ cost: 0 }), req({ cost: '0' })] }), { now: NOW })
    expect(none).toMatchObject({ pricingConfigured: false, recordedCost: null })
    const some = selectUsageReport(emptyWorkspace({ inference_requests: [req({ cost: '0.5' }), req({ cost: 0.25 })] }), { now: NOW })
    expect(some).toMatchObject({ pricingConfigured: true, recordedCost: 0.75 })
  })

  it('separates "nothing ever" from "nothing in this period"', () => {
    const ws = emptyWorkspace({ inference_requests: [req({ created_at: at(-60 * DAY_MS) })] })
    const r = selectUsageReport(ws, { now: NOW, windowDays: 30 })
    expect(r).toMatchObject({ requests: 0, successRate: null, allTimeRequests: 1, failures: [], log: [] })
    expect(r.latency).toEqual({ samples: 0, averageMs: null, p50Ms: null, p95Ms: null })
    expect(selectUsageReport(emptyWorkspace(), { now: NOW }).allTimeRequests).toBe(0)
  })

  it('computes percentiles with nearest-rank and only reports p95 with enough samples', () => {
    expect(percentile([], 50)).toBeNull()
    expect(percentile([10, 20, 30, 40], 50)).toBe(20)
    expect(percentile([10, 20, 30, 40], 100)).toBe(40)
    const few = selectLatencyStats(Array.from({ length: MIN_P95_SAMPLES - 1 }, (_, i) => i + 1))
    expect(few.p95Ms).toBeNull()
    expect(few.p50Ms).not.toBeNull()
    const enough = selectLatencyStats(Array.from({ length: MIN_P95_SAMPLES }, (_, i) => i + 1))
    expect(enough.p95Ms).toBe(19)
    expect(enough.averageMs).toBe(11)
  })
})
