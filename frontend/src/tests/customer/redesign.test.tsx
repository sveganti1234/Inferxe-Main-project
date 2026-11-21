/**
 * Overview shows the restored portal dashboard (demo content + real name/wallet), and the new shell
 * controls (quick actions, theme, sidebar account) work. Network is mocked per "METHOD /path".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ensureFreshSession, getSession } from '../../lib/authStore'
import CustomerApp from '../../features/customer/CustomerApp'
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
  user: { id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', fullName: 'Test Customer', email: 'customer@example.test', username: 'cust_test', role: 'customer' },
}
const THEME_KEY = 'inferxe_console_theme_v1'
const mockFetch = vi.mocked(globalThis.fetch)
const NOW = Date.now()
const ago = (ms: number) => new Date(NOW - ms).toISOString()

type Handler = (url: URL, init: RequestInit) => Response | Promise<Response>
let handlers: Record<string, Handler>

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  }))
  Element.prototype.scrollIntoView = vi.fn()
  vi.mocked(ensureFreshSession).mockResolvedValue(SESSION)
  vi.mocked(getSession).mockReturnValue(SESSION)
  mockFetch.mockReset()
  handlers = {
    'GET /api/customer/workspace': () => jsonResponse(200, workspaceEnvelope(emptyWorkspace())),
    'GET /api/notifications/unread-count': () => jsonResponse(200, { unread_count: 0 }),
    'GET /api/v1/health': () => jsonResponse(200, { status: 'ok', nvidia_provider: 'configured' }),
    'GET /api/wallet/balance': () => jsonResponse(200, { balance: 0, currency: 'INR', updated_at: null }),
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
})

async function flush(times = 6) {
  for (let i = 0; i < times; i++) await act(async () => { await new Promise((r) => setTimeout(r, 10)) })
}
async function render(path = '/dashboard/app') {
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
const text = () => document.body.textContent ?? ''
async function click(el: Element | null | undefined) {
  expect(el, 'element to click').toBeTruthy()
  await act(async () => { (el as HTMLElement).click() })
  await flush(3)
}

describe('Overview composition (original layout, real data only)', () => {
  it('fills the original sections from real records and invents nothing', async () => {
    handlers['GET /api/wallet/balance'] = () => jsonResponse(200, { balance: 1250.5, currency: 'INR', updated_at: ago(3_600_000) })
    await render()
    expect(text()).toMatch(/Hello, Test/)
    expect(text()).toContain('No GPUs running right now')
    expect(text()).toContain('₹1,250.50')
    expect(text()).toContain('0 of 0')
    expect(text()).toContain('Nothing deployed yet')
    expect(text()).toContain('No orders yet')
    expect(text()).toContain('You are all caught up')
    const trial = [...document.querySelectorAll('.cx-card')].find((c) => /Free trial/.test(c.textContent ?? ''))
    expect(trial?.textContent).toContain('No trial on this account')
    // nothing from the old hardcoded demo, and no rate/burn without real pricing data
    expect(text()).not.toMatch(/qwen-chat-staging|llama-support-api|blackwell|novatech|4,820|62\.5|\/hr|sahith|verdelo/i)
    expect(document.querySelector('.cx-announce')).toBeNull()
  })

  it('shows the newest unread platform notice as the announcement and marks it read on dismiss', async () => {
    const ws = emptyWorkspace({
      notifications: [
        { id: 'a1', user_id: 'u', title: 'Scheduled maintenance', detail: 'Mumbai cluster, Sunday 02:00 IST.', notification_type: 'MAINTENANCE', is_read: false, created_at: ago(3_600_000), read_at: null },
        { id: 'w1', user_id: 'u', title: 'Wallet recharged', detail: null, notification_type: 'WALLET_RECHARGE_SUCCESS', is_read: false, created_at: ago(60_000), read_at: null },
      ],
    })
    handlers['GET /api/customer/workspace'] = () => jsonResponse(200, workspaceEnvelope(ws))
    handlers['PATCH /api/notifications/a1/read'] = () => jsonResponse(200, { ok: true })
    await render()
    expect(document.querySelector('.cx-announce')?.textContent).toContain('Scheduled maintenance')
    expect(document.querySelector('.cx-announce')?.textContent).not.toContain('Wallet recharged')
    await click(document.querySelector('[aria-label="Dismiss announcement"]'))
    expect(document.querySelector('.cx-announce')).toBeNull()
    expect(mockFetch.mock.calls.some(([u, i]) => String(u).includes('/api/notifications/a1/read') && (i as RequestInit | undefined)?.method === 'PATCH')).toBe(true)
  })

  it('shows real burn, hours left, per-GPU rates, trial and tier once records carry them', async () => {
    const dep = (id: string, name: string, status: string, rate: number, currency: string | null) => ({ id, user_id: 'u', organization_id: null, listing_id: null, name, model_name: 'Llama 3.1 8B', gpu_model: 'L40S', region: 'Mumbai, IN', status, hourly_rate: rate, currency, endpoint_url: null, started_at: null, stopped_at: null, metadata: null, created_at: ago(3_600_000), updated_at: null })
    const ws = emptyWorkspace({
      deployments: [dep('d1', 'support-api', 'running', 100, 'INR'), dep('d2', 'chat', 'running', 60, 'INR'), dep('d3', 'eval', 'provisioning', 100, 'INR')],
      customer_plans: [{ user_id: 'u', tier: 'Sovereign', trial_started_at: ago(7_200_000), trial_ends_at: new Date(Date.now() + 3_600_000).toISOString(), updated_at: null }],
    })
    handlers['GET /api/customer/workspace'] = () => jsonResponse(200, workspaceEnvelope(ws))
    handlers['GET /api/wallet/balance'] = () => jsonResponse(200, { balance: 10000, currency: 'INR', updated_at: null })
    await render()
    expect(text()).toContain('2 GPUs running · ₹160.00/hr')
    expect(text()).toContain('≈ 62.5 hrs left at current usage')
    expect(text()).toContain('₹160.00/hr current burn')
    expect(text()).toContain('2 of 3')
    expect(text()).toContain('₹100.00/hr')
    const trial = [...document.querySelectorAll('.cx-card')].find((c) => /Free trial/.test(c.textContent ?? ''))
    expect(trial?.textContent).toMatch(/Active.*Ends/)
    expect(document.querySelector('.cx-quota__sub')?.textContent).toContain('Sovereign')
  })

  it('makes no request beyond the existing read-only sources', async () => {
    await render()
    const calls = mockFetch.mock.calls.map(([u, i]) => `${((i as RequestInit | undefined)?.method ?? 'GET').toUpperCase()} ${new URL(String(u), 'http://localhost').pathname}`)
    expect(calls.filter((c) => !c.startsWith('GET '))).toEqual([])
  })
})

describe('Shell controls', () => {
  it('a failed background refresh shows a stale-data notice instead of silently keeping old figures', async () => {
    let calls = 0
    handlers['GET /api/customer/workspace'] = () => (++calls === 1 ? jsonResponse(200, workspaceEnvelope(emptyWorkspace())) : jsonResponse(503, { ok: false, error: 'down' }))
    await render()
    expect(document.querySelector('.cx-stale')).toBeNull()
    await click(document.querySelector('[aria-label="Refresh overview"]'))
    await flush()
    expect(document.querySelector('.cx-stale')?.textContent).toMatch(/couldn’t refresh your workspace/i)
    handlers['GET /api/customer/workspace'] = () => jsonResponse(200, workspaceEnvelope(emptyWorkspace()))
    await click([...document.querySelectorAll('.cx-stale button')].find((b) => b.textContent === 'Retry'))
    await flush()
    expect(document.querySelector('.cx-stale')).toBeNull()
  })

  it('quick actions menu offers only real console destinations and closes on Escape', async () => {
    await render()
    await click(document.querySelector('[aria-label="Quick actions"]'))
    const items = [...document.querySelectorAll<HTMLAnchorElement>('.cx-menu--quick [role="menuitem"]')]
    expect(items.map((i) => i.getAttribute('href'))).toEqual(['/dashboard/app/api-keys', '/dashboard/app/playground', '/dashboard/app/gpus', '/dashboard/app/usage'])
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    await flush(25) // the menu fades out (120 ms) before it is removed
    expect(document.querySelector('.cx-menu--quick')).toBeNull()
  })

  it('theme control switches palette, persists the preference and restores it', async () => {
    await render()
    expect(document.querySelector('.cx-app')?.getAttribute('data-cx-theme')).toBe('forest')
    await click(document.querySelector('.cx-topbar__theme'))
    expect(document.querySelector('.cx-app')?.getAttribute('data-cx-theme')).toBe('light')
    expect(localStorage.getItem(THEME_KEY)).toBe('light')
    act(() => root!.unmount()); root = null; document.body.replaceChildren()
    await render()
    expect(document.querySelector('.cx-app')?.getAttribute('data-cx-theme')).toBe('light')
  })

  it('migrates the old graphite preference to the light theme', async () => {
    localStorage.setItem(THEME_KEY, 'graphite')
    await render()
    expect(document.querySelector('.cx-app')?.getAttribute('data-cx-theme')).toBe('light')
    expect(document.querySelector('.cx-topbar__theme')?.getAttribute('aria-label')).toBe('Switch to the dark theme')
  })

  it('breadcrumb starts with the current page’s sidebar group', async () => {
    await render()
    const crumbs = () => [...document.querySelectorAll('.cx-crumbs > :not(svg)')].map((n) => n.textContent)
    expect(crumbs()).toEqual(['General', 'Overview'])
    act(() => root!.unmount()); root = null; document.body.replaceChildren()
    await render('/dashboard/app/models')
    expect(crumbs()).toEqual(['Compute & AI', 'Model marketplace'])
    act(() => root!.unmount()); root = null; document.body.replaceChildren()
    await render('/dashboard/app/billing')
    expect(crumbs()).toEqual(['Billing & Payments', 'Billing & wallet'])
  })

  it('ignores an invalid stored theme', async () => {
    localStorage.setItem(THEME_KEY, 'neon')
    await render()
    expect(document.querySelector('.cx-app')?.getAttribute('data-cx-theme')).toBe('forest')
  })

  it('sidebar shows the real signed-in customer and links to settings', async () => {
    handlers['GET /api/customer/workspace'] = () => jsonResponse(200, workspaceEnvelope(emptyWorkspace()))
    await render()
    const account = document.querySelector<HTMLAnchorElement>('.cx-sideaccount')!
    expect(account.textContent).toContain('Test Customer')
    expect(account.textContent).toContain('customer@example.test')
    expect(account.getAttribute('href')).toBe('/dashboard/app/settings')
  })

  it('still offers collapse, notifications and account sign-out; the assistant is the floating ghost only', async () => {
    await render()
    expect(document.querySelector('[aria-label="Collapse sidebar"]')).not.toBeNull()
    expect(document.querySelector('[aria-label^="Notifications"]')).not.toBeNull()
    expect(document.querySelector('[aria-label="Open the assistant"]')).toBeNull() // topbar chat button removed
    await click(document.querySelector('.cx-account__trigger'))
    expect([...document.querySelectorAll('[role="menuitem"]')].some((n) => /sign out/i.test(n.textContent ?? ''))).toBe(true)
  })
})
