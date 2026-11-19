/**
 * Stage 4 — Billing & wallet, Usage & analytics, SSH keys & notebooks.
 * Network is mocked per "METHOD /path"; the real data layer, existing services and pages run.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ensureFreshSession, getSession } from '../../lib/authStore'
import CustomerApp from '../../features/customer/CustomerApp'
import type { CustomerWorkspace, InferenceRequestRecord, WalletTransaction } from '../../features/customer/data/types'
import { emptyWorkspace, jsonResponse, workspaceEnvelope } from './fixtures'

vi.mock('../../lib/authStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/authStore')>()),
  ensureFreshSession: vi.fn(),
  getSession: vi.fn(),
  signOutCurrentUser: vi.fn(async () => {}),
}))

const SESSION = {
  token: 'header.payload.signature',
  expiresAt: Date.now() + 3_600_000,
  user: { id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', fullName: 'Ada', email: 'ada@example.test', username: 'ada', role: 'customer' },
}
const mockFetch = vi.mocked(globalThis.fetch)
const NOW = Date.now()
const ago = (ms: number) => new Date(NOW - ms).toISOString()
const H = 3_600_000
const DAY = 24 * H

type Handler = (url: URL, init: RequestInit) => Response | Promise<Response>
let handlers: Record<string, Handler>
const calls = () => mockFetch.mock.calls.map(([u, i]) => `${((i as RequestInit | undefined)?.method ?? 'GET').toUpperCase()} ${String(u).split('?')[0]}`)

function setMobile(mobile = false) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: mobile && query.includes('max-width: 1023px'), media: query, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  }))
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  setMobile(false)
  vi.mocked(ensureFreshSession).mockResolvedValue(SESSION)
  vi.mocked(getSession).mockReturnValue(SESSION)
  mockFetch.mockReset()
  handlers = {
    'GET /api/customer/workspace': () => jsonResponse(200, workspaceEnvelope(emptyWorkspace())),
    'GET /api/notifications/unread-count': () => jsonResponse(200, { unread_count: 0 }),
    'GET /api/v1/health': () => jsonResponse(200, { status: 'ok', nvidia_provider: 'configured' }),
    'GET /api/wallet/balance': () => jsonResponse(200, { balance: 1250.5, currency: 'INR', updated_at: ago(DAY) }),
  }
  mockFetch.mockImplementation(async (input, init = {}) => {
    const url = new URL(String(input), 'http://localhost')
    const handler = handlers[`${(init.method ?? 'GET').toUpperCase()} ${url.pathname}`]
    return handler ? handler(url, init) : jsonResponse(404, { error: 'unmocked' })
  })
})

let root: Root | null = null
let host: HTMLDivElement
afterEach(() => {
  if (root) act(() => root!.unmount())
  root = null
  document.body.replaceChildren()
  document.body.className = ''
})

async function flush(times = 6) {
  for (let i = 0; i < times; i++) await act(async () => { await new Promise((r) => setTimeout(r, 10)) })
}
async function render(path: string) {
  host = document.createElement('div')
  document.body.appendChild(host)
  await act(async () => {
    root = createRoot(host)
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route path="/dashboard/app/*" element={<CustomerApp />} /></Routes>
      </MemoryRouter>,
    )
  })
  await flush()
}
async function remount(path: string) {
  act(() => root!.unmount())
  root = null
  document.body.replaceChildren()
  await render(path)
}
const text = () => document.body.textContent ?? ''
/** Page content only: the shell sidebar carries restored demo content (spend limit). */
const pageText = () => document.querySelector('#cx-main')?.textContent ?? ''
const main = () => document.querySelector('main')!
const byText = (selector: string, pattern: RegExp) => [...document.querySelectorAll<HTMLElement>(selector)].find((n) => pattern.test(n.textContent ?? ''))
async function click(el: Element | null | undefined) {
  expect(el, 'element to click').toBeTruthy()
  await act(async () => { (el as HTMLElement).click() })
  await flush()
}
async function setValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const pending = () => new Promise<Response>(() => {})

/* ───────────────────────── Billing & wallet ───────────────────────── */

const tx = (over: Partial<WalletTransaction>): WalletTransaction => ({
  id: 'x', wallet_id: 'wallet-sentinel-id', user_id: 'user-sentinel-id', order_id: 'order-sentinel-id', transaction_reference: 'TXREF-SENTINEL',
  transaction_type: 'top_up', direction: 'credit', amount: '100', currency: 'INR', status: 'completed', description: null, created_at: ago(H), ...over,
})
const billingWorkspace = (): CustomerWorkspace =>
  emptyWorkspace({
    wallet_transactions: [
      tx({ id: 't1', amount: '1000', created_at: ago(3 * H) }),
      tx({ id: 't2', transaction_type: 'usage_charge', direction: 'debit', amount: '250', description: 'GPU Compute Usage', created_at: ago(26 * H) }),
      tx({ id: 't3', amount: '500', created_at: ago(5 * DAY) }),
      tx({ id: 't4', transaction_type: 'refund', amount: '75', status: 'pending', created_at: ago(H) }),
    ],
  })

describe('Billing & wallet', () => {
  beforeEach(() => {
    handlers['GET /api/customer/workspace'] = () => jsonResponse(200, workspaceEnvelope(billingWorkspace()))
  })

  it('shows the real balance, totals and history exactly as recorded', async () => {
    await render('/dashboard/app/billing')
    expect(text()).toContain('₹1,250.50')
    expect(text()).toContain('₹1,500.00') // credited: completed only (pending refund excluded)
    expect(text()).toContain('₹250.00') // charged
    const rows = [...document.querySelectorAll('.cx-table tbody tr')].map((r) => r.textContent ?? '')
    expect(rows).toHaveLength(4)
    expect(rows[0]).toMatch(/Refund.*Pending.*\+₹75\.00/) // newest first, non-completed status is visible
    expect(rows.some((r) => /Usage charge.*GPU Compute Usage.*−₹250\.00/.test(r))).toBe(true)
    expect(rows.some((r) => /Wallet credit.*\+₹1,000\.00/.test(r))).toBe(true)
    expect(text()).toMatch(/Updated yesterday|Updated 1 day ago/)
  })

  it('states clearly that payments are unavailable and offers no way to add or move money', async () => {
    await render('/dashboard/app/billing')
    expect(text()).toContain('Payments are not available yet.')
    expect(text()).toContain('Pricing is not configured.')
    const controls = [...main().querySelectorAll('button, a, form, input, textarea, select')]
    const labels = controls.map((c) => `${c.getAttribute('aria-label') ?? ''} ${c.textContent ?? ''}`)
    expect(labels.filter((l) => /top.?up|add (funds|money|credit)|checkout|pay\b|payment|recharge|buy|purchase|card|invoice|deposit/i.test(l))).toEqual([])
    expect(main().querySelectorAll('form, input, textarea, select')).toHaveLength(0)
    expect(calls().every((c) => c.startsWith('GET '))).toBe(true)
    expect(calls().some((c) => /wallet\/transactions/.test(c))).toBe(false)
  })

  it('filters credits and charges and pages long histories', async () => {
    await render('/dashboard/app/billing')
    await click(byText('.cx-seg__opt', /^Charges/))
    expect([...document.querySelectorAll('.cx-table tbody tr')]).toHaveLength(1)
    await click(byText('.cx-seg__opt', /^Credits/))
    expect([...document.querySelectorAll('.cx-table tbody tr')]).toHaveLength(3)

    handlers['GET /api/customer/workspace'] = () =>
      jsonResponse(200, workspaceEnvelope(emptyWorkspace({ wallet_transactions: Array.from({ length: 20 }, (_, i) => tx({ id: `p${i}`, created_at: ago(i * H) })) })))
    await remount('/dashboard/app/billing')
    expect(document.querySelectorAll('.cx-table tbody tr')).toHaveLength(15)
    await click(byText('button', /Show more \(5 remaining\)/))
    expect(document.querySelectorAll('.cx-table tbody tr')).toHaveLength(20)
  })

  it('renders an honest empty state for a wallet with no history', async () => {
    handlers['GET /api/customer/workspace'] = () => jsonResponse(200, workspaceEnvelope(emptyWorkspace()))
    handlers['GET /api/wallet/balance'] = () => jsonResponse(200, { balance: 0, currency: 'INR', updated_at: null })
    await render('/dashboard/app/billing')
    expect(text()).toContain('No transactions yet')
    expect(text()).toContain('No wallet activity yet')
    expect(byText('.cx-stat', /Total credited/)?.querySelector('.cx-stat__value')?.textContent).toBe('—')
    expect(text()).not.toMatch(/Show more/)
  })

  it('shows loading placeholders', async () => {
    handlers['GET /api/customer/workspace'] = pending
    handlers['GET /api/wallet/balance'] = pending
    await render('/dashboard/app/billing')
    expect(text()).toContain('Loading transactions')
    expect(document.querySelector('[aria-label="Wallet summary"] .cx-skeleton')).not.toBeNull()
  })

  it('keeps the history when only the wallet-balance service fails (no invented balance)', async () => {
    handlers['GET /api/wallet/balance'] = () => jsonResponse(503, { detail: 'down' })
    await render('/dashboard/app/billing')
    const tile = byText('.cx-stat', /Wallet balance/)!
    expect(tile.querySelector('.cx-stat__value')?.textContent).toBe('—')
    expect(tile.textContent).toContain('Wallet service unavailable')
    expect(document.querySelectorAll('.cx-table tbody tr')).toHaveLength(4)
  })

  it('handles workspace errors and expired sessions', async () => {
    handlers['GET /api/customer/workspace'] = () => jsonResponse(503, { error: 'down' })
    await render('/dashboard/app/billing')
    expect(text()).toMatch(/temporarily unavailable/i)
    const attempts = calls().filter((c) => c === 'GET /api/customer/workspace').length
    handlers['GET /api/customer/workspace'] = () => jsonResponse(200, workspaceEnvelope(billingWorkspace()))
    await click(byText('button', /Try again/))
    expect(calls().filter((c) => c === 'GET /api/customer/workspace').length).toBeGreaterThan(attempts)
    expect(document.querySelectorAll('.cx-table tbody tr')).toHaveLength(4)

    handlers['GET /api/customer/workspace'] = () => jsonResponse(401, { ok: false, error: 'expired' })
    await remount('/dashboard/app/billing')
    expect(text()).toContain('Your session has expired')
  })

  it('totals each recorded currency separately', async () => {
    handlers['GET /api/customer/workspace'] = () =>
      jsonResponse(200, workspaceEnvelope(emptyWorkspace({ wallet_transactions: [tx({ id: 'a', amount: '100' }), tx({ id: 'b', amount: '5', currency: 'USD' }), tx({ id: 'c', amount: '50' })] })))
    await render('/dashboard/app/billing')
    expect(byText('.cx-stat', /Total credited/)?.textContent).toContain('₹150.00')
    expect(text()).toContain('also recorded in USD')
  })

  it('never renders internal identifiers', async () => {
    await render('/dashboard/app/billing')
    for (const secret of ['wallet-sentinel-id', 'user-sentinel-id', 'order-sentinel-id', 'TXREF-SENTINEL']) expect(document.body.innerHTML).not.toContain(secret)
  })

  it('stacks the ledger into labelled rows on small screens so the amount is never off-screen', async () => {
    await render('/dashboard/app/billing')
    const table = document.querySelector('.cx-table')!
    expect(table.classList.contains('cx-table--stack')).toBe(true)
    for (const row of table.querySelectorAll('tbody tr')) {
      expect([...row.querySelectorAll('td')].map((td) => td.getAttribute('data-label'))).toEqual(['Date', 'Type', 'Description', 'Amount'])
    }
  })
})

/* ───────────────────────── Usage & analytics ───────────────────────── */

const reqRec = (over: Partial<InferenceRequestRecord>): InferenceRequestRecord => ({
  id: Math.random().toString(36).slice(2), user_id: 'user-sentinel-id', organization_id: null, api_key_id: 'apikey-sentinel-id', deployment_id: 'deploy-sentinel-id',
  model_name: 'nvidia/nemotron', provider_name: 'nvidia', input_tokens: 100, output_tokens: 50, latency_ms: 100, status: 'success', error_message: null, cost: 0, created_at: ago(H), ...over,
})
/** 24 requests over the last ~3 days (2 failures) plus one successful request 20 days ago. */
function usageWorkspace(): CustomerWorkspace {
  const recent = Array.from({ length: 24 }, (_, i) =>
    reqRec({
      created_at: ago(i * 3 * H + H),
      latency_ms: 100 + i * 10,
      status: i === 5 ? 'failed' : i === 17 ? 'timeout' : 'success',
      error_message: i === 5 ? 'Upstream provider rejected the request' : i === 17 ? 'Request timed out' : null,
    }),
  )
  const old = reqRec({ model_name: 'old/model', created_at: ago(20 * DAY), latency_ms: 500, input_tokens: 10, output_tokens: 5 })
  return emptyWorkspace({ inference_requests: [...recent, old] })
}

describe('Usage & analytics', () => {
  beforeEach(() => {
    handlers['GET /api/customer/workspace'] = () => jsonResponse(200, workspaceEnvelope(usageWorkspace()))
  })

  it('computes every figure from the recorded requests', async () => {
    await render('/dashboard/app/usage')
    const kpi = (label: RegExp) => byText('.cx-stat', label)!.textContent ?? ''
    expect(kpi(/Requests/)).toMatch(/25.*23 successful · 2 failed/)
    expect(kpi(/Tokens/)).toMatch(/3\.6K.*2\.4K in · 1\.2K out/)
    expect(kpi(/Success rate/)).toContain('92.0%')
    expect(kpi(/Avg latency/)).toMatch(/226 ms.*p50 220 · p95 330 ms/)
    expect(kpi(/Spend/)).toContain('Pricing not configured')
    expect(text()).not.toMatch(/Recorded cost/)
  })

  it('draws charts from real data with an accessible data table and tooltips', async () => {
    await render('/dashboard/app/usage')
    expect(document.querySelectorAll('.cx-chart')).toHaveLength(2)
    const first = document.querySelector('.cx-chart')!
    expect(first.querySelectorAll('table tbody tr')).toHaveLength(30) // one row per day, zero-filled
    expect(first.querySelectorAll('.cx-chart__col')).toHaveLength(30)
    expect(first.querySelectorAll('.cx-chart__col .cx-chart__seg').length).toBeGreaterThan(0)
    expect(first.getAttribute('aria-label')).toBe('Requests per day, last 30 days')
    expect(first.querySelector('.cx-chart__cols')?.getAttribute('aria-hidden')).toBe('true')
    const cols = first.querySelectorAll('.cx-chart__col')
    await act(async () => { cols[29].dispatchEvent(new Event('pointerover', { bubbles: true })) })
    expect(first.querySelector('.cx-chart__tip')?.textContent).toMatch(/UTC.*Successful.*Failed/)
  })

  it('lists models, recent failures with their recorded errors, and the request log', async () => {
    await render('/dashboard/app/usage')
    const modelRows = [...document.querySelectorAll('table[aria-label], .cx-table')].find((t) => /By model|Usage by model/.test(t.querySelector('caption')?.textContent ?? ''))!
    expect(modelRows.querySelectorAll('tbody tr')).toHaveLength(2)
    expect(modelRows.textContent).toMatch(/nvidia\/nemotron.*24.*91\.7%/)
    expect(text()).toContain('Recent failures')
    expect(text()).toContain('Upstream provider rejected the request')
    expect(text()).toContain('Request timed out')
    const log = [...document.querySelectorAll('.cx-table')].find((t) => /request log/i.test(t.querySelector('caption')?.textContent ?? ''))!
    expect(log.querySelectorAll('tbody tr')).toHaveLength(15)
    await click(byText('button', /Show more \(10 remaining\)/))
    expect(log.querySelectorAll('tbody tr')).toHaveLength(25)
  })

  it('switches the time range', async () => {
    await render('/dashboard/app/usage')
    await click(byText('.cx-seg__opt', /^7 days$/))
    expect(byText('.cx-stat', /Requests/)?.textContent).toMatch(/24.*22 successful · 2 failed/)
    expect(document.querySelector('.cx-chart table tbody')?.querySelectorAll('tr')).toHaveLength(7)
    expect(byText('.cx-stat', /Avg latency/)?.textContent).toMatch(/215 ms.*p50 210 · p95 320 ms/)
    await click(byText('.cx-seg__opt', /^90 days$/))
    expect(document.querySelector('.cx-chart table tbody')?.querySelectorAll('tr')).toHaveLength(90)
  })

  it('explains that the p95 needs enough samples', async () => {
    handlers['GET /api/customer/workspace'] = () => jsonResponse(200, workspaceEnvelope(emptyWorkspace({ inference_requests: [reqRec({}), reqRec({})] })))
    await render('/dashboard/app/usage')
    expect(text()).toContain('p95 needs 20+ requests')
  })

  it('shows an honest empty state when no request has ever been recorded', async () => {
    handlers['GET /api/customer/workspace'] = () => jsonResponse(200, workspaceEnvelope(emptyWorkspace()))
    await render('/dashboard/app/usage')
    expect(text()).toContain('No inference requests yet')
    expect(text()).toContain('Nothing is estimated or sampled')
    expect(document.querySelector('.cx-chart')).toBeNull()
    expect(pageText()).not.toMatch(/\d+(\.\d+)?%/)
    expect(byText('a', /Create an API key/)).toBeTruthy()
  })

  it('distinguishes "none in this period" from "none ever"', async () => {
    handlers['GET /api/customer/workspace'] = () =>
      jsonResponse(200, workspaceEnvelope(emptyWorkspace({ inference_requests: [reqRec({ created_at: ago(60 * DAY) })] })))
    await render('/dashboard/app/usage')
    expect(text()).toContain('No requests in the last 30 days')
    expect(text()).toContain('1 earlier request is recorded outside this period')
    expect(document.querySelector('.cx-chart')).toBeNull()
    await click(byText('button', /Show the last 90 days/))
    // 60 days ago is inside a 90-day window, so the same record now produces real charts.
    expect(document.querySelector('.cx-chart')).not.toBeNull()
    expect(byText('.cx-stat', /Requests/)?.textContent).toMatch(/1.*1 successful · 0 failed/)
  })

  it('only shows a cost when the backend recorded one, without inventing a currency', async () => {
    handlers['GET /api/customer/workspace'] = () =>
      jsonResponse(200, workspaceEnvelope(emptyWorkspace({ inference_requests: [reqRec({ cost: '0.25' }), reqRec({ cost: 0.5 })] })))
    await render('/dashboard/app/usage')
    const spend = byText('.cx-stat', /Recorded cost/)!
    expect(spend.textContent).toContain('0.75')
    expect(spend.textContent).toContain('Currency is not recorded')
    expect(text()).not.toContain('Pricing not configured')
    expect(spend.textContent).not.toMatch(/[₹$€]/)
  })

  it('warns when the inference provider is unavailable', async () => {
    handlers['GET /api/v1/health'] = () => jsonResponse(200, { status: 'degraded', nvidia_provider: 'missing_api_key' })
    await render('/dashboard/app/usage')
    expect(text()).toContain('The inference API is not serving requests right now.')
  })

  it('shows loading, error and expired-session states', async () => {
    handlers['GET /api/customer/workspace'] = pending
    await render('/dashboard/app/usage')
    expect(text()).toContain('Loading usage')
    handlers['GET /api/customer/workspace'] = () => jsonResponse(503, { error: 'down' })
    await remount('/dashboard/app/usage')
    expect(text()).toMatch(/temporarily unavailable/i)
    handlers['GET /api/customer/workspace'] = () => jsonResponse(401, { ok: false, error: 'expired' })
    await remount('/dashboard/app/usage')
    expect(text()).toContain('Your session has expired')
  })

  it('never renders internal identifiers or issues write requests', async () => {
    await render('/dashboard/app/usage')
    for (const secret of ['user-sentinel-id', 'apikey-sentinel-id', 'deploy-sentinel-id']) expect(document.body.innerHTML).not.toContain(secret)
    expect(calls().every((c) => c.startsWith('GET '))).toBe(true)
  })
})

/* ───────────────────────── SSH keys & notebooks ───────────────────────── */

const SECRET_KEY_BODY = 'AAAAC3NzaC1lZDI1NTE5AAAAIPUBLICKEYBODYSENTINEL'
const NOTEBOOK_TOKEN = 'SECRET-NOTEBOOK-ACCESS-TOKEN'
const sshKey = (over: object = {}) => ({ id: 's1', name: 'Work laptop', public_key: `ssh-ed25519 ${SECRET_KEY_BODY} me@laptop`, fingerprint: 'SHA256:abcDEF123fingerprint', key_type: 'ssh-ed25519', created_at: ago(4 * DAY), ...over })
const notebook = (over: object = {}) => ({
  id: 'n1', user_id: 'user-sentinel-id', name: 'Scratchpad', gpu_profile: 'NVIDIA L4', status: 'running', runtime_type: 'simulated', runtime_reference: 'sim-worker-abc',
  selected_ssh_key_id: 's1', ssh_command: 'ssh -i ~/.ssh/id_ed25519 -p 2222 ubuntu@abc12345.simulated.nodes.inferxe.com',
  jupyter_url: 'https://abc12345.simulated.nodes.inferxe.com/lab?token=active_session', access_token: NOTEBOOK_TOKEN,
  is_simulated: true, simulation_notice: 'Simulated runtime environment', created_at: ago(2 * DAY), updated_at: ago(H), last_active_at: ago(H), ...over,
})

describe('SSH keys & notebooks', () => {
  let keys: ReturnType<typeof sshKey>[]
  let notebooks: ReturnType<typeof notebook>[]
  beforeEach(() => {
    keys = [sshKey()]
    notebooks = [notebook(), notebook({ id: 'n2', name: 'Idle box', status: 'stopped', selected_ssh_key_id: null, ssh_command: null, jupyter_url: null }), notebook({ id: 'n3', name: 'Gone', status: 'terminated' })]
    handlers['GET /api/v1/ssh-keys'] = () => jsonResponse(200, { success: true, keys })
    handlers['GET /api/v1/notebooks'] = () => jsonResponse(200, { success: true, notebooks })
  })

  it('labels the notebook runtime as simulated and never suggests real infrastructure', async () => {
    await render('/dashboard/app/developer')
    expect(text()).toContain('The notebook runtime is simulated.')
    expect(text()).toContain('there is nothing to connect to')
    expect(byText('.cx-badge', /Simulated/)).toBeTruthy()
    const nbTable = [...document.querySelectorAll('.cx-table')].find((t) => /notebook sessions/i.test(t.querySelector('caption')?.textContent ?? ''))!
    const rows = [...nbTable.querySelectorAll('tbody tr')].map((r) => r.textContent ?? '')
    expect(rows).toHaveLength(2) // terminated notebook is hidden
    expect(rows[0]).toContain('Running (simulated)')
    expect(nbTable.textContent).not.toMatch(/Running(?! \(simulated\))/)
    expect(rows[1]).toContain('Stopped')
    expect(rows[0]).toContain('Work laptop') // SSH key name resolved from the real key list
    expect(text()).toContain('Connection details are intentionally not shown')
  })

  it('never renders or stores SSH commands, Jupyter URLs, access tokens or key bodies', async () => {
    const logs = [vi.spyOn(console, 'log'), vi.spyOn(console, 'info'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error')]
    await render('/dashboard/app/developer')
    const html = document.body.innerHTML
    for (const leaked of [NOTEBOOK_TOKEN, 'simulated.nodes', 'ubuntu@', 'token=active_session', 'ssh -i', SECRET_KEY_BODY, 'user-sentinel-id']) expect(html).not.toContain(leaked)
    for (const store of [localStorage, sessionStorage]) for (let i = 0; i < store.length; i++) expect(store.getItem(store.key(i)!) ?? '').not.toContain(NOTEBOOK_TOKEN)
    for (const spy of logs) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain(NOTEBOOK_TOKEN)
      spy.mockRestore()
    }
  })

  it('keeps notebook actions inside the row on small screens (stacked, label-less action cell)', async () => {
    await render('/dashboard/app/developer')
    const nbTable = [...document.querySelectorAll('.cx-table')].find((t) => /notebook sessions/i.test(t.querySelector('caption')?.textContent ?? ''))!
    expect(nbTable.classList.contains('cx-table--stack')).toBe(true)
    const actionCell = nbTable.querySelector('tbody tr td:last-child')!
    expect(actionCell.getAttribute('data-label')).toBe('')
    expect(actionCell.querySelectorAll('button')).toHaveLength(3) // start, stop, terminate
  })

  it('lists SSH keys with name, type and fingerprint', async () => {
    await render('/dashboard/app/developer')
    const row = [...document.querySelectorAll('.cx-table')].find((t) => /SSH keys/i.test(t.querySelector('caption')?.textContent ?? ''))!.querySelector('tbody tr')!
    expect(row.textContent).toContain('Work laptop')
    expect(row.textContent).toContain('ssh-ed25519')
    expect(row.textContent).toContain('SHA256:abcDEF123fingerprint')
  })

  it('adds an SSH key, validating input and refusing private keys before any request', async () => {
    const posted: unknown[] = []
    handlers['POST /api/v1/ssh-keys'] = (_u, init) => {
      posted.push(JSON.parse(String(init.body)))
      keys = [sshKey({ id: 's2', name: 'CI runner' }), ...keys]
      return jsonResponse(201, sshKey({ id: 's2', name: 'CI runner' }))
    }
    await render('/dashboard/app/developer')
    await click(byText('button', /Add SSH key/))
    const [nameInput] = document.querySelectorAll<HTMLInputElement>('.cx-dialog input.cx-input')
    const area = document.querySelector<HTMLTextAreaElement>('.cx-dialog textarea')!

    await click(byText('.cx-dialog button', /^Add key$/))
    expect(text()).toContain('Give the key a name')
    await setValue(nameInput, 'CI runner')
    await setValue(area, '-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----')
    expect(text()).toContain('That looks like a private key')
    expect((byText('.cx-dialog button', /^Add key$/) as HTMLButtonElement).disabled).toBe(true)
    expect(posted).toEqual([])

    await setValue(area, `  ssh-ed25519 ${SECRET_KEY_BODY} ci@runner  `)
    await click(byText('.cx-dialog button', /^Add key$/))
    expect(posted).toEqual([{ name: 'CI runner', public_key: `ssh-ed25519 ${SECRET_KEY_BODY} ci@runner` }])
    expect(JSON.stringify(posted)).not.toMatch(/user_?id/i)
    expect(document.querySelector('.cx-dialog')).toBeNull()
    expect(text()).toContain('CI runner')
    expect(document.body.innerHTML).not.toContain(SECRET_KEY_BODY)
  })

  it('shows backend errors such as duplicate keys', async () => {
    handlers['POST /api/v1/ssh-keys'] = () => jsonResponse(409, { detail: 'This SSH key is already registered in your account.' })
    await render('/dashboard/app/developer')
    await click(byText('button', /Add SSH key/))
    await setValue(document.querySelector<HTMLInputElement>('.cx-dialog input.cx-input')!, 'Dup')
    await setValue(document.querySelector<HTMLTextAreaElement>('.cx-dialog textarea')!, `ssh-ed25519 ${SECRET_KEY_BODY}`)
    await click(byText('.cx-dialog button', /^Add key$/))
    expect(text()).toContain('This SSH key is already registered in your account.')
    expect(document.querySelector('.cx-dialog')).not.toBeNull()
  })

  it('deletes an SSH key only after confirmation', async () => {
    const deleted: string[] = []
    handlers['DELETE /api/v1/ssh-keys/s1'] = (u) => { deleted.push(u.pathname); keys = []; return jsonResponse(200, { success: true, message: 'ok', id: 's1' }) }
    await render('/dashboard/app/developer')
    await click(document.querySelector('[aria-label="Delete SSH key Work laptop"]'))
    expect(text()).toContain('Delete SSH key “Work laptop”?')
    await click(byText('.cx-dialog button', /^Cancel$/))
    expect(deleted).toEqual([])
    await click(document.querySelector('[aria-label="Delete SSH key Work laptop"]'))
    await click(byText('.cx-dialog button', /^Delete key$/))
    expect(deleted).toEqual(['/api/v1/ssh-keys/s1'])
    expect(text()).toContain('No SSH keys yet')
  })

  it('creates a notebook RECORD, says nothing was provisioned, and discards the one-time token', async () => {
    const posted: Record<string, unknown>[] = []
    handlers['POST /api/v1/notebooks'] = (_u, init) => {
      posted.push(JSON.parse(String(init.body)))
      notebooks = [notebook({ id: 'n9', name: 'Fresh', selected_ssh_key_id: 's1' }), ...notebooks]
      return jsonResponse(201, notebook({ id: 'n9', name: 'Fresh', selected_ssh_key_id: 's1' }))
    }
    await render('/dashboard/app/developer')
    await click(byText('button', /New notebook record/))
    expect(text()).toContain('No GPU, Jupyter server or SSH server is provisioned.')
    await setValue(document.querySelector<HTMLInputElement>('.cx-dialog input.cx-input')!, 'Fresh')
    const select = document.querySelector<HTMLSelectElement>('.cx-dialog select')!
    await act(async () => { select.value = 's1'; select.dispatchEvent(new Event('change', { bubbles: true })) })
    await click(byText('.cx-dialog button', /^Create record$/))
    expect(posted).toHaveLength(1)
    expect(posted[0]).toMatchObject({ name: 'Fresh', selected_ssh_key_id: 's1' })
    expect(JSON.stringify(posted)).not.toMatch(/user_?id/i)
    expect(text()).toContain('Simulated notebook record created. No GPU or Jupyter server was provisioned.')
    expect(document.body.innerHTML).not.toContain(NOTEBOOK_TOKEN)
    expect(text()).toContain('Fresh')
  })

  it('starts, stops and terminates simulated notebooks with honest messages and confirmation', async () => {
    handlers['POST /api/v1/notebooks/n2/start'] = () => jsonResponse(200, { success: true, message: 'ok', notebook: notebook({ id: 'n2', name: 'Idle box', status: 'running' }) })
    handlers['POST /api/v1/notebooks/n1/stop'] = () => jsonResponse(200, { success: true, message: 'ok', notebook: notebook({ status: 'stopped' }) })
    handlers['DELETE /api/v1/notebooks/n1'] = () => { notebooks = notebooks.filter((n) => n.id !== 'n1'); return jsonResponse(200, { success: true, message: 'ok', notebook: notebook({ status: 'terminated' }) }) }
    await render('/dashboard/app/developer')

    // state-aware controls
    expect((document.querySelector('[aria-label="Start Scratchpad (simulated)"]') as HTMLButtonElement).disabled).toBe(true)
    expect((document.querySelector('[aria-label="Stop Idle box (simulated)"]') as HTMLButtonElement).disabled).toBe(true)

    await click(document.querySelector('[aria-label="Start Idle box (simulated)"]'))
    expect(calls()).toContain('POST /api/v1/notebooks/n2/start')
    expect(text()).toContain('was marked as running (simulated). Nothing was started or stopped on real infrastructure.')
    await click(document.querySelector('[aria-label="Stop Scratchpad (simulated)"]'))
    expect(calls()).toContain('POST /api/v1/notebooks/n1/stop')
    expect(text()).toContain('was marked as stopped (simulated)')

    await click(document.querySelector('[aria-label="Terminate Scratchpad"]'))
    expect(text()).toContain('Terminate “Scratchpad”?')
    expect(text()).toContain('No real infrastructure is affected')
    await click(byText('.cx-dialog button', /^Cancel$/))
    expect(calls()).not.toContain('DELETE /api/v1/notebooks/n1')
    await click(document.querySelector('[aria-label="Terminate Scratchpad"]'))
    await click(byText('.cx-dialog button', /^Terminate$/))
    expect(calls()).toContain('DELETE /api/v1/notebooks/n1')
    expect(document.querySelector('.cx-dialog')).toBeNull()
  })

  it('shows lifecycle conflicts from the backend', async () => {
    handlers['POST /api/v1/notebooks/n2/start'] = () => jsonResponse(409, { detail: 'Notebook is already running.' })
    await render('/dashboard/app/developer')
    await click(document.querySelector('[aria-label="Start Idle box (simulated)"]'))
    expect(text()).toContain('Notebook is already running.')
  })

  it('shows empty, loading, error and expired-session states for both lists', async () => {
    keys = []
    notebooks = []
    await render('/dashboard/app/developer')
    expect(text()).toContain('No SSH keys yet')
    expect(text()).toContain('No notebook records yet')
    expect(text()).toContain('does not start a GPU, a Jupyter server or an SSH server')

    handlers['GET /api/v1/ssh-keys'] = pending
    handlers['GET /api/v1/notebooks'] = pending
    await remount('/dashboard/app/developer')
    expect(text()).toContain('Loading SSH keys')
    expect(text()).toContain('Loading notebooks')

    handlers['GET /api/v1/ssh-keys'] = () => jsonResponse(500, { detail: 'Upstream SSH key database rejected the request.' })
    handlers['GET /api/v1/notebooks'] = () => jsonResponse(401, { detail: 'expired' })
    await remount('/dashboard/app/developer')
    expect(text()).toContain('Upstream SSH key database rejected the request.')
    expect(text()).toContain('Your session has expired')
  })
})

/* ───────────────────────── Overview: duplicate wallet activity ───────────────────────── */

describe('Overview alerts and orders', () => {
  it('lists the real low-wallet warning and unread notifications (newest 3), and real orders', async () => {
    const note = (id: string, title: string, hoursAgo: number, read = false) => ({ id, user_id: 'u', title, detail: null, notification_type: 'INFO', is_read: read, created_at: ago(hoursAgo * H), read_at: null })
    const ws = emptyWorkspace({
      notifications: [note('n1', 'Oldest', 5), note('n2', 'Newest', 1), note('n3', 'Already read', 0, true), note('n4', 'Middle', 2), note('n5', 'Fourth', 4)],
      orders: [{ id: 'o1', user_id: 'u', organization_id: null, deployment_id: null, order_number: 'ORD-1', item_name: 'H100 x1', provider_name: 'Alpha Cloud', order_date: ago(H), duration_minutes: 60, total_cost: '250', currency: 'INR', status: 'completed', details: null, created_at: ago(H), updated_at: null }],
    })
    handlers['GET /api/customer/workspace'] = () => jsonResponse(200, workspaceEnvelope(ws))
    handlers['GET /api/wallet/balance'] = () => jsonResponse(200, { balance: 500, currency: 'INR', low_balance_alert_level: 'CRITICAL', updated_at: null })
    await render('/dashboard/app')
    const alerts = [...document.querySelectorAll('.cx-card')].find((c) => /Alerts/.test(c.querySelector('.cx-card__title')?.textContent ?? ''))!
    expect([...alerts.querySelectorAll('.cx-activity__title')].map((n) => n.textContent)).toEqual(['Wallet running low', 'Newest', 'Middle', 'Fourth'])
    expect(text()).toContain('ORD-1')
    expect(text()).toContain('H100 x1 · Alpha Cloud')
    expect(text()).toContain('₹250.00')
  })
})

/* ───────────────────────── Customer isolation ───────────────────────── */

describe('customer data isolation', () => {
  it('does not carry one customer’s billing, usage or developer data into another session', async () => {
    const wsA = billingWorkspace()
    wsA.inference_requests = usageWorkspace().inference_requests
    handlers['GET /api/customer/workspace'] = () => jsonResponse(200, workspaceEnvelope(wsA))
    handlers['GET /api/v1/ssh-keys'] = () => jsonResponse(200, { success: true, keys: [sshKey({ name: 'Alice laptop' })] })
    handlers['GET /api/v1/notebooks'] = () => jsonResponse(200, { success: true, notebooks: [notebook({ name: 'Alice notebook' })] })
    await render('/dashboard/app/billing')
    expect(text()).toContain('GPU Compute Usage')
    await remount('/dashboard/app/usage')
    expect(text()).toContain('nvidia/nemotron')
    await remount('/dashboard/app/developer')
    expect(text()).toContain('Alice laptop')
    expect(text()).toContain('Alice notebook')

    // Customer B signs in on the same browser: new session, new (empty) data.
    handlers['GET /api/customer/workspace'] = () => jsonResponse(200, workspaceEnvelope(emptyWorkspace()))
    handlers['GET /api/wallet/balance'] = () => jsonResponse(200, { balance: 0, currency: 'INR', updated_at: null })
    handlers['GET /api/v1/ssh-keys'] = () => jsonResponse(200, { success: true, keys: [] })
    handlers['GET /api/v1/notebooks'] = () => jsonResponse(200, { success: true, notebooks: [] })
    for (const path of ['billing', 'usage', 'developer']) {
      await remount(`/dashboard/app/${path}`)
      expect(document.body.innerHTML, path).not.toMatch(/GPU Compute Usage|nvidia\/nemotron|Alice|1,500\.00|₹1,250/)
    }
    const stored = [localStorage, sessionStorage].flatMap((s) => Array.from({ length: s.length }, (_, i) => `${s.key(i)}=${s.getItem(s.key(i)!)}`)).join('\n')
    expect(stored).not.toMatch(/Alice|nemotron|GPU Compute|fingerprint|SENTINEL/)
  })
})
