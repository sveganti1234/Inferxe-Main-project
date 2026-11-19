import { selectMonthSpend, selectPlan, type LedgerEntry } from '../../features/customer/data/selectors'
import { describe, it, expect } from 'vitest'
import {
  DAY_MS,
  formatCurrency,
  formatInteger,
  formatPercent,
  isWorkspaceEmpty,
  selectApiKeySummary,
  selectDeveloperSummary,
  selectInferenceSummary,
  selectLedgerSummary,
  selectMarketplaceSummary,
  selectProfileSummary,
} from '../../features/customer/data/selectors'
import type { InferenceRequestRecord } from '../../features/customer/data/types'
import { emptyWorkspace } from './fixtures'
import type { CustomerWorkspace } from '../../features/customer/data/types'

const NOW = Date.parse('2026-11-17T12:00:00Z')
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString()
const req = (over: Partial<InferenceRequestRecord>): InferenceRequestRecord => ({
  id: Math.random().toString(36).slice(2), user_id: 'u', organization_id: null, api_key_id: null, deployment_id: null,
  model_name: 'model-a', provider_name: 'nvidia', input_tokens: 0, output_tokens: 0, latency_ms: null,
  status: 'success', error_message: null, cost: 0, created_at: iso(DAY_MS), ...over,
})

describe('empty workspace — no fabricated values', () => {
  const ws = emptyWorkspace()

  it('inference summary is zero/null, pricing not configured', () => {
    const s = selectInferenceSummary(ws, { now: NOW })
    expect(s).toMatchObject({ requests: 0, inputTokens: 0, outputTokens: 0, successRate: null, averageLatencyMs: null, pricingConfigured: false, totalCost: null })
    expect(s.byModel).toEqual([])
    expect(s.daily).toEqual([])
  })

  it('other summaries are zero and the workspace is reported empty', () => {
    expect(selectApiKeySummary(ws, NOW)).toEqual({ total: 0, active: 0, lastUsedAt: null })
    expect(selectLedgerSummary(ws)).toMatchObject({ count: 0, credits: 0, debits: 0, currency: null, latest: [] })
    expect(selectMarketplaceSummary(ws)).toEqual({ providers: 0, listings: 0, availableGpus: 0, regions: [], savedListings: 0 })
    expect(selectDeveloperSummary(ws)).toEqual({ sshKeys: 0, notebooks: 0, runningNotebooks: 0, deployments: 0 })
    expect(isWorkspaceEmpty(ws)).toBe(true)
  })

  it('formatters render missing values as an em dash, not a number', () => {
    expect(formatInteger(null)).toBe('—')
    expect(formatPercent(null)).toBe('—')
    expect(formatCurrency(null, 'INR')).toBe('—')
    expect(formatCurrency(10, null)).toBe('—')
  })
})

describe('profile summary', () => {
  it('derives name, initials and linked organization', () => {
    const ws = emptyWorkspace({
      organizations: [{ id: 'o2', name: 'Other', slug: null, billing_email: null, status: 'active', created_at: null },
                      { id: 'o1', name: 'Acme AI', slug: 'acme', billing_email: null, status: 'active', created_at: null }],
    })
    ws.profile.organization_id = 'o1'
    ws.profile.full_name = 'ada lovelace'
    const s = selectProfileSummary(ws)
    expect(s).toMatchObject({ displayName: 'ada lovelace', initials: 'AL', isActive: true })
    expect(s.organization?.name).toBe('Acme AI')
  })

  it('falls back to username/email and flags inactive accounts', () => {
    const ws = emptyWorkspace()
    ws.profile.full_name = null
    ws.profile.username = null
    ws.profile.status = 'suspended'
    expect(selectProfileSummary(ws)).toMatchObject({ displayName: 'customer', isActive: false, organization: null })
  })
})

describe('inference summary', () => {
  it('aggregates only requests inside the window', () => {
    const ws = emptyWorkspace({
      inference_requests: [
        req({ input_tokens: 100, output_tokens: 50, latency_ms: 200, model_name: 'model-a' }),
        req({ input_tokens: 10, output_tokens: 5, latency_ms: 400, model_name: 'model-b', status: 'failed', created_at: iso(2 * DAY_MS) }),
        req({ input_tokens: 999, created_at: iso(40 * DAY_MS) }), // outside 30d
        req({ created_at: null }), // unusable timestamp
      ],
    })
    const s = selectInferenceSummary(ws, { now: NOW, windowDays: 30 })
    expect(s).toMatchObject({ requests: 2, successful: 1, failed: 1, successRate: 0.5, inputTokens: 110, outputTokens: 55, averageLatencyMs: 300 })
    expect(s.byModel.map((m) => m.model)).toEqual(['model-a', 'model-b'])
    expect(s.daily).toHaveLength(2)
    expect(s.daily[0].date < s.daily[1].date).toBe(true)
  })

  it('reports cost only when the backend recorded a non-zero cost', () => {
    const zero = selectInferenceSummary(emptyWorkspace({ inference_requests: [req({ cost: 0 }), req({ cost: '0' })] }), { now: NOW })
    expect(zero.pricingConfigured).toBe(false)
    expect(zero.totalCost).toBeNull()
    const priced = selectInferenceSummary(emptyWorkspace({ inference_requests: [req({ cost: '1.25' }), req({ cost: 0.75 })] }), { now: NOW })
    expect(priced.pricingConfigured).toBe(true)
    expect(priced.totalCost).toBeCloseTo(2)
  })
})

describe('API keys, ledger, marketplace, developer', () => {
  it('counts only active, unrevoked, unexpired keys', () => {
    const base = { user_id: 'u', organization_id: null, key_prefix: 'inf_live_x', created_at: null, last_used_at: null, expires_at: null, revoked_at: null }
    const ws = emptyWorkspace({
      api_keys: [
        { ...base, id: '1', name: 'a', status: 'active', last_used_at: iso(DAY_MS) },
        { ...base, id: '2', name: 'b', status: 'revoked', revoked_at: iso(DAY_MS) },
        { ...base, id: '3', name: 'c', status: 'active', expires_at: iso(1) },
        { ...base, id: '4', name: 'd', status: 'active', expires_at: iso(-DAY_MS) },
      ],
    })
    expect(selectApiKeySummary(ws, NOW)).toEqual({ total: 4, active: 2, lastUsedAt: iso(DAY_MS) })
  })

  it('sums completed credits/debits only and sorts latest first', () => {
    const t = (id: string, direction: string, amount: string, status = 'completed', ago = DAY_MS) => ({
      id, wallet_id: null, user_id: 'u', order_id: null, transaction_reference: null, transaction_type: 'x',
      direction, amount, currency: 'INR', status, description: null, created_at: iso(ago),
    })
    const s = selectLedgerSummary(emptyWorkspace({ wallet_transactions: [t('a', 'credit', '100', 'completed', 3 * DAY_MS), t('b', 'debit', '40'), t('c', 'credit', '500', 'pending', 0)] }))
    expect(s).toMatchObject({ count: 3, credits: 100, debits: 40, currency: 'INR' })
    expect(s.latest.map((x) => x.id)).toEqual(['c', 'b', 'a'])
  })

  it('marketplace and developer summaries reflect real rows', () => {
    const listing = { id: 'l', provider_id: 'p', name: 'n', gpu_model: 'L4', vram: 24, architecture: null, bandwidth: null, tflops: null, quantity: 3, hourly_price: null, currency: null, status: 'available', created_at: null, updated_at: null }
    const ws = emptyWorkspace({
      gpu_listings: [{ ...listing, region: 'ap-south-1' }, { ...listing, id: 'l2', region: 'eu-west-1', quantity: null }],
      notebook_sessions: [
        { id: 'n1', user_id: 'u', deployment_id: null, name: null, status: 'running', session_url: null, storage_path: null, bot_access_enabled: null, started_at: null, stopped_at: null, created_at: null, updated_at: null },
        { id: 'n2', user_id: 'u', deployment_id: null, name: null, status: 'terminated', session_url: null, storage_path: null, bot_access_enabled: null, started_at: null, stopped_at: null, created_at: null, updated_at: null },
      ],
    })
    expect(selectMarketplaceSummary(ws)).toMatchObject({ listings: 2, availableGpus: 3, regions: ['ap-south-1', 'eu-west-1'] })
    expect(selectDeveloperSummary(ws)).toMatchObject({ notebooks: 1, runningNotebooks: 1 })
    expect(isWorkspaceEmpty(ws)).toBe(false)
  })
})

describe('selectMonthSpend', () => {
  const entry = (over: Partial<LedgerEntry>): LedgerEntry => ({ id: Math.random().toString(36), at: '2026-11-10T10:00:00Z', typeLabel: 'Usage charge', direction: 'debit', amount: 100, currency: 'INR', status: 'completed', description: null, ...over })
  it('sums only completed debits in the given currency since the start of this month', () => {
    const now = new Date('2026-11-18T12:00:00')
    const entries = [
      entry({ amount: 100 }),
      entry({ amount: -40 }), // sign on debits is ignored
      entry({ at: '2026-10-28T10:00:00Z' }), // last month
      entry({ direction: 'credit', amount: 500 }),
      entry({ status: 'pending' }),
      entry({ currency: 'USD' }),
    ]
    expect(selectMonthSpend(entries, 'INR', now)).toBe(140)
  })
})

describe('selectPlan', () => {
  const now = Date.parse('2026-11-18T12:00:00Z')
  const withPlan = (over: Partial<CustomerWorkspace['customer_plans'][number]>) =>
    emptyWorkspace({ customer_plans: [{ user_id: 'u', tier: null, trial_started_at: null, trial_ends_at: null, updated_at: null, ...over }] })
  it('derives trial state from the dates and never invents one', () => {
    expect(selectPlan(emptyWorkspace(), now)).toEqual({ tier: null, trial: 'none', trialEndsAt: null })
    expect(selectPlan(withPlan({ tier: ' Sovereign ' }), now)).toMatchObject({ tier: 'Sovereign', trial: 'none' })
    expect(selectPlan(withPlan({ trial_ends_at: '2026-11-18T13:00:00Z' }), now).trial).toBe('active')
    expect(selectPlan(withPlan({ trial_ends_at: '2026-11-18T11:00:00Z' }), now).trial).toBe('expired')
  })
})
