/**
 * Stage 5 — Models, GPU marketplace, Inference playground, Deployments, Help (+ assistant).
 * All network is mocked per "METHOD /path". No real inference request can be made.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ensureFreshSession, getSession } from '../../lib/authStore'
import CustomerApp from '../../features/customer/CustomerApp'
import type { CustomerWorkspace } from '../../features/customer/data/types'
import { emptyWorkspace, jsonResponse, workspaceEnvelope } from './fixtures'
import { preloadCustomerPages } from './preloadPages'

beforeAll(preloadCustomerPages)

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
const KEY = 'inf_live_abcdefghijklmnop1234'
const mockFetch = vi.mocked(globalThis.fetch)

type Handler = (url: URL, init: RequestInit) => Response | Promise<Response>
let handlers: Record<string, Handler>
const calls = () => mockFetch.mock.calls.map(([u, i]) => `${((i as RequestInit | undefined)?.method ?? 'GET').toUpperCase()} ${new URL(String(u), 'http://localhost').pathname}`)
const inferenceCalls = () => calls().filter((c) => c === 'POST /api/v1/inference')

function setMobile(mobile = false) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: mobile && query.includes('max-width: 1023px'), media: query, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  }))
}

const listingWs = (): CustomerWorkspace =>
  emptyWorkspace({
    gpu_providers: [{ id: 'p1', name: 'Alpha Cloud', slug: 'alpha', region: 'ap-south', status: 'active', created_at: null, updated_at: null }],
    gpu_listings: [
      { id: 'l1', provider_id: 'p1', name: 'H100 node', gpu_model: 'H100', vram: '80 GB', architecture: 'Hopper', bandwidth: null, tflops: null, region: 'ap-south', quantity: 4, hourly_price: 250, currency: 'INR', status: 'active', created_at: null, updated_at: null },
      { id: 'l2', provider_id: 'p1', name: 'L4 box', gpu_model: 'L4', vram: '24 GB', architecture: null, bandwidth: null, tflops: null, region: 'ap-south', quantity: 2, hourly_price: null, currency: null, status: 'active', created_at: null, updated_at: null },
    ],
    saved_gpu_listings: [{ id: 's1', user_id: 'u', listing_id: 'l2', created_at: '2026-01-01T00:00:00Z' }],
  })

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
    'GET /api/v1/gpu/deployments': () => jsonResponse(200, { success: true, deployments: [] }),
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
/** Page content only: the shell sidebar/topbar carry restored demo content (spend limit, trial chip). */
const pageText = () => document.querySelector('#cx-main')?.textContent ?? ''
const pageButton = (pattern: RegExp) => [...document.querySelectorAll<HTMLElement>('#cx-main button')].find((n) => pattern.test(n.textContent ?? ''))
const byText = (selector: string, pattern: RegExp) => [...document.querySelectorAll<HTMLElement>(selector)].find((n) => pattern.test(n.textContent ?? ''))
const byLabel = (label: string) => document.querySelector<HTMLElement>(`[aria-label="${label}"]`)
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

/* ── Models ── */
describe('Models page', () => {
  it('shows the reference catalogue, clearly labelled, with no prices or availability', async () => {
    await render('/dashboard/app/models')
    expect(text()).toMatch(/reference/i)
    expect(document.querySelectorAll('[role="listitem"]').length).toBeGreaterThan(3)
    expect(pageText()).not.toMatch(/₹|\$\s?\d/)
    expect(text()).not.toMatch(/roadmap|coming soon/i)
  })

  it('searches, shows an empty state, and clears', async () => {
    await render('/dashboard/app/models')
    const search = byLabel('Search models') as HTMLInputElement
    await setValue(search, 'zzzz-nothing')
    expect(text()).toContain('No models match your search')
    await setValue(search, '')
    expect(document.querySelectorAll('[role="listitem"]').length).toBeGreaterThan(3)
  })

  it('compares up to three models and opens the estimator', async () => {
    await render('/dashboard/app/models')
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('button[aria-label$="to comparison"]')]
    for (const b of buttons.slice(0, 4)) await click(b)
    expect(document.querySelectorAll('.cx-model button[aria-label$="from comparison"]').length).toBe(3) // 4th is refused
    expect(text()).toContain('Compare models')
    await click(document.querySelector('button[aria-label^="Estimate GPU fit"]'))
    expect(text()).toContain('GPU memory estimator')
    expect(text()).toContain('Reference GPU configurations')
  })

  it('makes no requests beyond the shell’s own', async () => {
    await render('/dashboard/app/models')
    expect(calls().every((c) => c.startsWith('GET /api/customer/workspace') || c.startsWith('GET /api/notifications') || c.startsWith('GET /api/v1/health') || c.startsWith('GET /api/workspace/settings'))).toBe(true)
  })
})

/* ── GPU marketplace ── */
describe('GPU marketplace page', () => {
  it('shows an honest empty state when no listings exist and invents nothing', async () => {
    await render('/dashboard/app/gpus')
    expect(text()).toContain('No GPU capacity is listed yet')
    expect(pageText()).not.toMatch(/₹|★|rating/i)
  })

  it('renders only real listings, verbatim, with provider names', async () => {
    handlers['GET /api/customer/workspace'] = () => jsonResponse(200, workspaceEnvelope(listingWs()))
    await render('/dashboard/app/gpus')
    expect(text()).toContain('H100')
    expect(text()).toContain('80 GB')
    expect(text()).toContain('Alpha Cloud')
    expect(text()).toContain('Price not listed') // l2 has no price: nothing made up
    expect(text()).toMatch(/ordering|not available/i)
    // no internal identifiers leak into the DOM
    expect(document.body.innerHTML).not.toMatch(/"?l1"?\s*[:=]|user_id|aaaaaaaa-bbbb/)
  })

  it('saves and unsaves via the real endpoints (no user id sent)', async () => {
    handlers['GET /api/customer/workspace'] = () => jsonResponse(200, workspaceEnvelope(listingWs()))
    handlers['POST /api/customer/saved-listings'] = (_u, init) => {
      expect(JSON.parse(String(init.body))).toEqual({ listing_id: 'l1' })
      return jsonResponse(200, { ok: true })
    }
    handlers['DELETE /api/customer/saved-listings/l2'] = () => jsonResponse(200, { ok: true })
    await render('/dashboard/app/gpus')
    await click(document.querySelector('button[aria-label^="Save H100"]'))
    expect(calls()).toContain('POST /api/customer/saved-listings')
    await click(document.querySelector('button[aria-label^="Remove L4"]'))
    expect(calls()).toContain('DELETE /api/customer/saved-listings/l2')
  })

  it('shows an error and keeps the previous state when saving fails', async () => {
    handlers['GET /api/customer/workspace'] = () => jsonResponse(200, workspaceEnvelope(listingWs()))
    handlers['POST /api/customer/saved-listings'] = () => jsonResponse(500, { error: 'boom' })
    await render('/dashboard/app/gpus')
    const btn = document.querySelector<HTMLButtonElement>('button[aria-label^="Save H100"]')!
    await click(btn)
    expect(document.querySelector('button[aria-label^="Save H100"]')).toBeTruthy()
    expect(document.querySelector('button[aria-label^="Remove H100"]')).toBeFalsy()
  })

  it('filters to saved listings and shows a no-match state', async () => {
    handlers['GET /api/customer/workspace'] = () => jsonResponse(200, workspaceEnvelope(listingWs()))
    await render('/dashboard/app/gpus')
    await click(byText('button', /^Saved · 1$/))
    expect(text()).toContain('L4')
    expect(document.querySelectorAll('.cx-listing').length).toBe(1)
    await setValue(document.querySelector<HTMLInputElement>('input[type="search"], input[aria-label*="earch"]')!, 'zzzz')
    expect(document.querySelectorAll('.cx-listing').length).toBe(0)
  })

  it('shows loading, then an error with retry, when the workspace fails', async () => {
    handlers['GET /api/customer/workspace'] = () => jsonResponse(503, { error: 'down' })
    await render('/dashboard/app/gpus')
    expect(text()).toMatch(/temporarily unavailable|try again/i)
    handlers['GET /api/customer/workspace'] = pending
    await remount('/dashboard/app/gpus')
    expect(document.querySelector('[aria-busy="true"], .cx-skeleton')).toBeTruthy()
  })

  it('does not carry one customer’s saved state into another session', async () => {
    handlers['GET /api/customer/workspace'] = () => jsonResponse(200, workspaceEnvelope(listingWs()))
    await render('/dashboard/app/gpus')
    expect(document.querySelector('button[aria-label^="Remove L4"]')).toBeTruthy()
    handlers['GET /api/customer/workspace'] = () => jsonResponse(200, workspaceEnvelope(emptyWorkspace()))
    await remount('/dashboard/app/gpus')
    expect(text()).toContain('No GPU capacity is listed yet')
    expect(document.querySelector('button[aria-label^="Remove"]')).toBeFalsy()
  })
})

/* ── Inference playground ── */
describe('Inference playground', () => {
  const runButton = () => byText('button', /Run request|Running/) as HTMLButtonElement
  async function fill(key = KEY, prompt = 'Say hi') {
    await setValue(document.querySelector<HTMLInputElement>('input[autocomplete="off"][data-lpignore]')!, key)
    await setValue(document.querySelector<HTMLTextAreaElement>('textarea')!, prompt)
  }

  it('disables running and never posts when the provider is unavailable', async () => {
    handlers['GET /api/v1/health'] = () => jsonResponse(200, { status: 'ok', nvidia_provider: 'missing_api_key' })
    await render('/dashboard/app/playground')
    await fill()
    expect(runButton().disabled).toBe(true)
    expect(text()).toMatch(/not configured|unavailable/i)
    await click(runButton())
    expect(inferenceCalls()).toHaveLength(0)
  })

  it('disables running when health cannot be verified', async () => {
    handlers['GET /api/v1/health'] = () => jsonResponse(500, {})
    await render('/dashboard/app/playground')
    await fill()
    expect(runButton().disabled).toBe(true)
    expect(text()).toMatch(/could not be reached/i)
    expect(inferenceCalls()).toHaveLength(0)
  })

  it('stays disabled while health is still being checked', async () => {
    handlers['GET /api/v1/health'] = pending
    await render('/dashboard/app/playground')
    await fill()
    expect(runButton().disabled).toBe(true)
    expect(text()).toContain('Checking')
  })

  it('states that the server chooses the model and offers no model picker', async () => {
    await render('/dashboard/app/playground')
    expect(text()).toMatch(/chosen by the server/i)
    expect(document.querySelector('select')).toBeFalsy()
  })

  it('requires a valid key and prompt before enabling Run', async () => {
    await render('/dashboard/app/playground')
    expect(runButton().disabled).toBe(true)
    await fill('short', 'hi')
    expect(runButton().disabled).toBe(true)
    await fill(KEY, 'hi')
    expect(runButton().disabled).toBe(false)
  })

  it('shows exactly what a mocked successful run returns, never sends a model, and never stores the key', async () => {
    let body: Record<string, unknown> = {}
    handlers['POST /api/v1/inference'] = (_u, init) => {
      body = JSON.parse(String(init.body))
      expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`)
      return jsonResponse(200, { success: true, response: 'Mocked answer', model: 'server-model', provider: 'nvidia', usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } })
    }
    await render('/dashboard/app/playground')
    await fill()
    await click(runButton())
    expect(document.querySelector('pre')!.textContent).toBe('Mocked answer')
    expect(text()).toContain('server-model')
    expect(Object.keys(body).sort()).toEqual(['max_tokens', 'prompt', 'temperature'])
    expect(JSON.stringify({ ...localStorage })).not.toContain(KEY)
    expect(JSON.stringify({ ...sessionStorage })).not.toContain(KEY)
    expect(inferenceCalls()).toHaveLength(1)
  })

  it('clears the key from the field and the DOM on request', async () => {
    await render('/dashboard/app/playground')
    await fill()
    await click(byLabel('Clear API key'))
    const input = document.querySelector<HTMLInputElement>('input[data-lpignore]')!
    expect(input.value).toBe('')
    expect(document.body.innerHTML).not.toContain(KEY)
  })

  it('blocks the request if health flips to unavailable between page load and Run', async () => {
    await render('/dashboard/app/playground')
    await fill()
    handlers['GET /api/v1/health'] = () => jsonResponse(200, { status: 'ok', nvidia_provider: 'missing_api_key' })
    await click(runButton())
    expect(inferenceCalls()).toHaveLength(0)
    expect(text()).toMatch(/request was not sent/i)
  })

  it('maps a rejected key to a clear message without echoing the key', async () => {
    handlers['POST /api/v1/inference'] = () => jsonResponse(401, { detail: `bad key ${KEY}` })
    await render('/dashboard/app/playground')
    await fill()
    await click(runButton())
    expect(text()).toMatch(/key was rejected/i)
    expect(document.querySelector('.cx-response-card')!.innerHTML).not.toContain(KEY)
    expect(document.querySelector('pre')).toBeFalsy()
  })

  it('shows invalid responses as an error, not a fabricated answer', async () => {
    handlers['POST /api/v1/inference'] = () => jsonResponse(200, { success: true })
    await render('/dashboard/app/playground')
    await fill()
    await click(runButton())
    expect(text()).toMatch(/unexpected response/i)
    expect(document.querySelector('pre')).toBeFalsy()
  })

  it('cancels an in-flight request and shows nothing', async () => {
    handlers['POST /api/v1/inference'] = (_u, init) => new Promise<Response>((_r, rej) => init.signal!.addEventListener('abort', () => rej(Object.assign(new Error('a'), { name: 'AbortError' }))))
    await render('/dashboard/app/playground')
    await fill()
    await act(async () => { runButton().click() })
    await flush()
    expect(text()).toContain('Waiting for the model')
    await click(byText('button', /Cancel/))
    expect(text()).toMatch(/was cancelled/i)
    expect(document.querySelector('pre')).toBeFalsy()
  })
})

/* ── Deployments ── */
describe('Deployments page', () => {
  it('shows summary cards and empty state with new deployment action when empty', async () => {
    await render('/dashboard/app/deployments')
    expect(text()).toContain('TOTAL DEPLOYMENTS')
    expect(text()).toContain('RUNNING ENDPOINTS')
    expect(text()).toContain('HOURLY SPEND')
    expect(text()).toContain('No deployment records')
    expect(document.querySelector('button[aria-label="New deployment"]')).toBeTruthy()
  })

  it('shows deployment records with summary stats, status pill, and action buttons', async () => {
    handlers['GET /api/v1/gpu/deployments'] = () =>
      jsonResponse(200, {
        success: true,
        deployments: [{
          id: 'd1',
          name: 'my-dep',
          model_name: 'llama',
          gpu_id: 'h100-sxm5',
          gpu_model: 'H100',
          provider_id: 'mock',
          provider_instance_id: 'mock-inst-1',
          region: 'Mumbai, IN',
          status: 'running',
          hourly_rate: 60,
          currency: 'INR',
          endpoint_url: null,
          ssh: null,
          ssh_key_ids: [],
          error_message: null,
          started_at: '2026-01-01T00:00:00Z',
          stopped_at: null,
          created_at: '2026-01-01T00:00:00Z',
        }],
      })
    await render('/dashboard/app/deployments')
    expect(text()).toContain('my-dep')
    expect(text()).toContain('Running')
    expect(text()).toContain('₹60/hr')
    expect(document.querySelector('button[aria-label="Stop deployment my-dep"]')).toBeTruthy()
    expect(document.querySelector('button[aria-label="Terminate deployment my-dep"]')).toBeTruthy()
  })

  it('shows an error state and a loading state', async () => {
    handlers['GET /api/v1/gpu/deployments'] = () => jsonResponse(503, {})
    await render('/dashboard/app/deployments')
    expect(text()).toMatch(/temporarily unavailable|try again/i)
    handlers['GET /api/v1/gpu/deployments'] = pending
    await remount('/dashboard/app/deployments')
    expect(text()).toContain('Loading deployments')
  })
})

/* ── Help + assistant ── */
describe('Help page and assistant', () => {
  it('lists FAQ entries with an accessible accordion', async () => {
    await render('/dashboard/app/help')
    const toggles = [...document.querySelectorAll<HTMLButtonElement>('.cx-faq__btn')]
    expect(toggles.length).toBeGreaterThan(8)
    const closed = toggles.find((t) => t.getAttribute('aria-expanded') === 'false')!
    const panel = document.getElementById(closed.getAttribute('aria-controls')!)!
    expect(panel.hidden).toBe(true)
    await click(closed)
    expect(closed.getAttribute('aria-expanded')).toBe('true')
    expect(panel.hidden).toBe(false)
  })

  it('searches the FAQ and offers the assistant when nothing matches', async () => {
    await render('/dashboard/app/help')
    await setValue(byLabel('Search the FAQ') as HTMLInputElement, 'hash')
    expect(text()).toContain('Can I see an API key again')
    await setValue(byLabel('Search the FAQ') as HTMLInputElement, 'zzzzqqq')
    expect(text()).toContain('No answers match your search')
  })

  it('opens the existing assistant through its window event', async () => {
    const listener = vi.fn()
    window.addEventListener('inferxe_open_bot', listener)
    await render('/dashboard/app/help')
    await click(byText('button', /Open the assistant/))
    expect(listener).toHaveBeenCalledTimes(1)
    window.removeEventListener('inferxe_open_bot', listener)
  })

  it('marks the body while the console is mounted and removes the marker on leave', async () => {
    await render('/dashboard/app/help')
    expect(document.body.classList.contains('cx-console-active')).toBe(true)
    act(() => root!.unmount())
    root = null
    expect(document.body.classList.contains('cx-console-active')).toBe(false)
  })

  it('no longer shows the “being rebuilt” preview for any section', async () => {
    for (const p of ['models', 'gpus', 'playground', 'deployments', 'help']) {
      await render(`/dashboard/app/${p}`)
      expect(text()).not.toContain('being rebuilt')
      act(() => root!.unmount())
      root = null
      document.body.replaceChildren()
    }
  })
})
