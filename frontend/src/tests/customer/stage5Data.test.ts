/** Stage 5 — pure data layer: models, marketplace, deployments, inference client, help. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DEFAULT_SCENARIO, estimateFit, filterModels, formatContext, formatParams, selectModelRows, MAX_COMPARE } from '../../features/customer/data/models'
import { filterListings, selectBurn, selectDeployments, selectFilterOptions, selectListings, selectUnavailableSaved, sortListings } from '../../features/customer/data/marketplace'
import { InferenceError, runInference, scrubSecrets, validateApiKeyInput, validatePrompt } from '../../features/customer/data/inference'
import { FAQ, FAQ_CATEGORIES, filterFaq } from '../../features/customer/data/help'
import { emptyWorkspace, jsonResponse } from './fixtures'
import type { CustomerWorkspace } from '../../features/customer/data/types'

const KEY = 'inf_live_abcdefghijklmnop1234'

function ws(): CustomerWorkspace {
  return emptyWorkspace({
    gpu_providers: [
      { id: 'p1', name: 'Alpha Cloud', slug: 'alpha', region: 'ap-south', status: 'active', created_at: null, updated_at: null },
      { id: 'p2', name: 'Beta Compute', slug: 'beta', region: null, status: 'active', created_at: null, updated_at: null },
    ],
    gpu_listings: [
      { id: 'l1', provider_id: 'p1', name: 'H100 node', gpu_model: 'H100', vram: '80 GB', architecture: 'Hopper', bandwidth: null, tflops: null, region: 'ap-south', quantity: 4, hourly_price: 250, currency: 'INR', status: 'active', created_at: null, updated_at: null },
      { id: 'l2', provider_id: 'p2', name: 'A100', gpu_model: 'A100', vram: '40 GB', architecture: 'Ampere', bandwidth: null, tflops: null, region: 'eu-west', quantity: 9, hourly_price: null, currency: null, status: 'active', created_at: null, updated_at: null },
      { id: 'l3', provider_id: 'p1', name: 'L4', gpu_model: 'L4', vram: null, architecture: null, bandwidth: null, tflops: null, region: null, quantity: null, hourly_price: 90, currency: 'INR', status: 'active', created_at: null, updated_at: null },
    ],
    saved_gpu_listings: [
      { id: 's1', user_id: 'u', listing_id: 'l2', created_at: '2026-01-01T00:00:00Z' },
      { id: 's2', user_id: 'u', listing_id: 'gone', created_at: '2026-01-02T00:00:00Z' },
    ],
    deployments: [
      { id: 'd1', user_id: 'u', organization_id: null, listing_id: null, name: 'old', model_name: 'm', gpu_model: 'H100', region: 'r', status: 'running', hourly_rate: 5, endpoint_url: 'https://secret.example/x', started_at: null, stopped_at: null, metadata: { token: 'x' }, created_at: '2026-01-01T00:00:00Z', updated_at: null },
      { id: 'd2', user_id: 'u', organization_id: null, listing_id: null, name: 'new', model_name: null, gpu_model: null, region: null, status: null, hourly_rate: null, endpoint_url: null, started_at: null, stopped_at: null, metadata: null, created_at: '2026-02-01T00:00:00Z', updated_at: null },
    ],
  })
}

describe('models data', () => {
  it('lists the reference catalogue and filters by text and family', () => {
    const rows = selectModelRows()
    expect(rows.length).toBeGreaterThan(3)
    const llama = filterModels(rows, { query: '', family: 'Llama' })
    expect(llama.length).toBeGreaterThan(0)
    expect(llama.every((r) => r.family === 'Llama')).toBe(true)
    expect(filterModels(rows, { query: 'zzzz-no-such-model', family: 'all' })).toEqual([])
    expect(MAX_COMPARE).toBe(3)
  })

  it('estimates fit without exposing prices or roadmap status', () => {
    const fit = estimateFit(DEFAULT_SCENARIO)
    expect(fit.rows.length).toBeGreaterThan(0)
    const dump = JSON.stringify(fit)
    expect(dump).not.toMatch(/₹|inr|hourly|price|roadmap|recommended/i)
    const totals = fit.rows.map((r) => r.totalGb)
    expect([...totals].sort((a, b) => a - b)).toEqual(totals)
  })

  it('formats parameter counts and context', () => {
    expect(formatParams(8)).toBe('8B')
    expect(formatContext(8192)).toBe('8K')
  })
})

describe('marketplace data', () => {
  it('builds listings from workspace records only, with saved flags', () => {
    const l = selectListings(ws())
    expect(l.map((x) => x.id)).toEqual(['l1', 'l2', 'l3'])
    expect(l.find((x) => x.id === 'l2')!.saved).toBe(true)
    expect(l.find((x) => x.id === 'l1')!.providerName).toBe('Alpha Cloud')
    expect(l.find((x) => x.id === 'l2')!.hourlyPrice).toBeNull()
    expect(l.find((x) => x.id === 'l1')!.vram).toBe('80 GB')
  })

  it('never invents a provider for a listing that has none', () => {
    const w = ws()
    w.gpu_listings[0].provider_id = null
    expect(selectListings(w)[0].providerName).toBeNull()
  })

  it('filters, sorts (unpriced last) and reports orphaned saved listings', () => {
    const l = selectListings(ws())
    const f = { query: '', providerId: '', region: '', savedOnly: false }
    expect(filterListings(l, { ...f, providerId: 'p1' }).map((x) => x.id)).toEqual(['l1', 'l3'])
    expect(filterListings(l, { ...f, savedOnly: true }).map((x) => x.id)).toEqual(['l2'])
    expect(filterListings(l, { ...f, query: 'hopper' }).map((x) => x.id)).toEqual(['l1'])
    expect(sortListings(l, 'price-asc').map((x) => x.id)).toEqual(['l3', 'l1', 'l2'])
    expect(sortListings(l, 'price-desc').map((x) => x.id)).toEqual(['l1', 'l3', 'l2'])
    expect(selectUnavailableSaved(ws())).toEqual([{ listingId: 'gone', savedAt: '2026-01-02T00:00:00Z' }])
    const opts = selectFilterOptions(l)
    expect(opts.providers.map((p) => p.name)).toEqual(['Alpha Cloud', 'Beta Compute'])
    expect(opts.regions).toEqual(['ap-south', 'eu-west'])
  })

  it('exposes deployment records without endpoint, metadata or identifiers beyond the row id', () => {
    const d = selectDeployments(ws())
    expect(d.map((x) => x.name)).toEqual(['new', 'old'])
    const dump = JSON.stringify(d)
    expect(dump).not.toMatch(/secret\.example|metadata|token|endpoint/i)
    expect(d[0].recordedStatus).toBeNull()
  })

  it('shows a rate only together with its recorded currency', () => {
    const w = ws()
    expect(selectDeployments(w).find((x) => x.name === 'old')).toMatchObject({ hourlyRate: null, currency: null }) // no currency recorded
    w.deployments[0].currency = 'inr'
    expect(selectDeployments(w).find((x) => x.name === 'old')).toMatchObject({ hourlyRate: 5, currency: 'INR' })
    w.deployments[0].currency = 'rupees'
    expect(selectDeployments(w).find((x) => x.name === 'old')).toMatchObject({ hourlyRate: null, currency: null })
  })

  it('sums burn for running deployments in one currency and counts the rest as unpriced', () => {
    const row = (id: string, status: string, rate: number | null, currency: string | null) => ({ id, name: id, model: null, gpu: null, region: null, recordedStatus: status, hourlyRate: rate, currency, createdAt: null })
    const list = [row('a', 'running', 60, 'INR'), row('b', 'Running', 100, 'INR'), row('c', 'running', 9, 'USD'), row('d', 'running', null, null), row('e', 'stopped', 100, 'INR')]
    expect(selectBurn(list, 'INR')).toEqual({ perHour: 160, unpriced: 2 })
    expect(selectBurn([row('x', 'stopped', 50, 'INR')], 'INR')).toEqual({ perHour: null, unpriced: 0 })
  })
})

describe('inference client contract', () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  const ok = { success: true, response: 'Hello there', model: 'srv-model', provider: 'nvidia', usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 } }

  it('validates key shape and prompt without any request', () => {
    expect(validateApiKeyInput('')).toBeTruthy()
    expect(validateApiKeyInput('has space in it 123456')).toBeTruthy()
    expect(validateApiKeyInput('nvapi-abcdefghijklmnop')).toMatch(/NVIDIA/)
    expect(validateApiKeyInput('short')).toBeTruthy()
    expect(validateApiKeyInput(KEY)).toBeNull()
    expect(validatePrompt('  ')).toBeTruthy()
    expect(validatePrompt('x'.repeat(8001))).toBeTruthy()
    expect(validatePrompt('hi')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends only prompt, max_tokens and temperature (never a model) and maps the response', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, ok))
    const r = await runInference({ apiKey: KEY, prompt: ' hi ', maxTokens: 50, temperature: 0.5 })
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toMatch(/\/api\/v1\/inference$/)
    expect(JSON.parse(init.body)).toEqual({ prompt: 'hi', max_tokens: 50, temperature: 0.5 })
    expect(init.headers.Authorization).toBe(`Bearer ${KEY}`)
    expect(r).toMatchObject({ text: 'Hello there', model: 'srv-model', provider: 'nvidia', totalTokens: 7 })
  })

  it('never fabricates a result from malformed or unsuccessful bodies', async () => {
    for (const body of [{}, { success: false, response: 'x', model: 'm', usage: ok.usage }, { response: 'x', model: 'm' }, { ...ok, usage: { prompt_tokens: -1, completion_tokens: 1, total_tokens: 1 } }]) {
      fetchMock.mockResolvedValueOnce(jsonResponse(200, body))
      await expect(runInference({ apiKey: KEY, prompt: 'hi', maxTokens: 10, temperature: 0 })).rejects.toMatchObject({ kind: 'invalid_response' })
    }
  })

  it('maps HTTP failures and scrubs secrets from server messages', async () => {
    const cases: Array<[number, unknown, string]> = [
      [401, { detail: 'bad' }, 'invalid_key'],
      [403, { detail: 'nope' }, 'forbidden'],
      [422, { detail: [{ msg: 'prompt too short', input: KEY }] }, 'validation'],
      [429, {}, 'rate_limited'],
      [503, {}, 'provider_unavailable'],
      [504, {}, 'timeout'],
      [500, { detail: `leaked ${KEY}` }, 'unexpected'],
    ]
    for (const [status, body, kind] of cases) {
      fetchMock.mockResolvedValueOnce(jsonResponse(status, body))
      const err = await runInference({ apiKey: KEY, prompt: 'hi', maxTokens: 10, temperature: 0 }).catch((e) => e)
      expect(err).toBeInstanceOf(InferenceError)
      expect(err.kind).toBe(kind)
      expect(err.message).not.toContain(KEY)
    }
  })

  it('reports network failure and cancellation distinctly', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fail'))
    await expect(runInference({ apiKey: KEY, prompt: 'hi', maxTokens: 10, temperature: 0 })).rejects.toMatchObject({ kind: 'network' })
    const c = new AbortController()
    fetchMock.mockImplementationOnce((_u: string, init: RequestInit) => new Promise((_r, rej) => init.signal!.addEventListener('abort', () => rej(Object.assign(new Error('a'), { name: 'AbortError' })))))
    const p = runInference({ apiKey: KEY, prompt: 'hi', maxTokens: 10, temperature: 0, signal: c.signal })
    c.abort()
    await expect(p).rejects.toMatchObject({ kind: 'cancelled' })
  })

  it('rejects out-of-range options before any request', async () => {
    await expect(runInference({ apiKey: KEY, prompt: 'hi', maxTokens: 0, temperature: 0 })).rejects.toMatchObject({ kind: 'validation' })
    await expect(runInference({ apiKey: KEY, prompt: 'hi', maxTokens: 10, temperature: 3 })).rejects.toMatchObject({ kind: 'validation' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('scrubSecrets removes keys, provider keys and JWTs', () => {
    const out = scrubSecrets(`a ${KEY} b nvapi-abcdefghij c eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.sig`, KEY)
    expect(out).not.toMatch(/inf_live_|nvapi-|eyJ/)
  })
})

describe('help content', () => {
  it('covers every category with unique ids and filters', () => {
    expect(new Set(FAQ.map((f) => f.id)).size).toBe(FAQ.length)
    for (const c of FAQ_CATEGORIES) expect(FAQ.some((f) => f.category === c)).toBe(true)
    expect(filterFaq(FAQ, { query: 'hash', category: 'all' }).some((f) => f.id === 'key-storage')).toBe(true)
    expect(filterFaq(FAQ, { query: '', category: 'Billing & usage' }).every((f) => f.category === 'Billing & usage')).toBe(true)
    expect(filterFaq(FAQ, { query: 'zzzzqqq', category: 'all' })).toEqual([])
  })

  it('does not promise capabilities that do not exist', () => {
    const all = FAQ.map((f) => f.answer).join(' ')
    expect(all).not.toMatch(/₹|\$\d/)
    expect(FAQ.find((f) => f.id === 'deploy')!.answer).toMatch(/not available/i)
    expect(FAQ.find((f) => f.id === 'add-funds')!.answer).toMatch(/not available/i)
  })
})
