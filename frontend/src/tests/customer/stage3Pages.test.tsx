/**
 * Stage 3 — Overview, API keys, Notifications, Settings, drawer accessibility.
 * Network is mocked per "METHOD /path"; the real data layer, apiKeyService and pages run.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { changeUserPassword, ensureFreshSession, getSession } from '../../lib/authStore'
import CustomerApp from '../../features/customer/CustomerApp'
import type { CustomerWorkspace, InferenceRequestRecord } from '../../features/customer/data/types'
import { emptyWorkspace, jsonResponse, workspaceEnvelope } from './fixtures'

vi.mock('../../lib/authStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/authStore')>()),
  ensureFreshSession: vi.fn(),
  getSession: vi.fn(),
  signOutCurrentUser: vi.fn(async () => {}),
  changeUserPassword: vi.fn(),
}))

const b64url = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
const COGNITO_TOKEN = [
  b64url({ alg: 'RS256' }),
  b64url({ sub: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', token_use: 'id', iss: 'https://cognito-idp.ap-south-1.amazonaws.com/ap-south-1_cYw1QjgbQ', aud: '334trhnhmim8v42gq4bgk7umst', exp: Math.floor(Date.now() / 1000) + 3600 }),
  'sig',
].join('.')
const SESSION = { token: COGNITO_TOKEN, expiresAt: Date.now() + 3_600_000, user: { id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', fullName: 'Ada', email: 'ada@example.test', username: 'ada', role: 'customer' } }

const mockFetch = vi.mocked(globalThis.fetch)
const NOW = Date.now()
const ago = (ms: number) => new Date(NOW - ms).toISOString()
const DAY = 86_400_000

type Handler = (url: URL, init: RequestInit) => Response | Promise<Response>
let handlers: Record<string, Handler>
const calls = () => mockFetch.mock.calls.map(([u, i]) => `${((i as RequestInit | undefined)?.method ?? 'GET').toUpperCase()} ${String(u)}`)

function setMobile(mobile: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: mobile && query.includes('max-width: 1023px'),
    media: query, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  }))
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  setMobile(false)
  vi.mocked(ensureFreshSession).mockResolvedValue(SESSION)
  vi.mocked(getSession).mockReturnValue(SESSION)
  vi.mocked(changeUserPassword).mockReset()
  mockFetch.mockReset()
  handlers = {
    'GET /api/customer/workspace': () => jsonResponse(200, workspaceEnvelope(populatedWorkspace())),
    'GET /api/notifications/unread-count': () => jsonResponse(200, { unread_count: 2 }),
    'GET /api/v1/health': () => jsonResponse(200, { status: 'ok', nvidia_provider: 'configured' }),
    'GET /api/wallet/balance': () => jsonResponse(200, { balance: 1250.5, currency: 'INR', updated_at: ago(DAY) }),
  }
  mockFetch.mockImplementation(async (input, init = {}) => {
    const url = new URL(String(input), 'http://localhost')
    const key = `${(init.method ?? 'GET').toUpperCase()} ${url.pathname}`
    const handler = handlers[key]
    return handler ? handler(url, init) : jsonResponse(404, { error: `unmocked ${key}` })
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
const text = () => document.body.textContent ?? ''
const byText = (selector: string, pattern: RegExp) =>
  [...document.querySelectorAll<HTMLElement>(selector)].find((n) => pattern.test(n.textContent ?? ''))
async function click(el: Element | null | undefined) {
  expect(el, 'element to click').toBeTruthy()
  await act(async () => { (el as HTMLElement).click() })
  await flush()
}
async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function req(over: Partial<InferenceRequestRecord>): InferenceRequestRecord {
  return { id: Math.random().toString(36).slice(2), user_id: 'u', organization_id: null, api_key_id: null, deployment_id: null, model_name: 'nvidia/nemotron', provider_name: 'nvidia', input_tokens: 100, output_tokens: 50, latency_ms: 420, status: 'success', error_message: null, cost: 0, created_at: ago(DAY), ...over }
}
function populatedWorkspace(): CustomerWorkspace {
  const ws = emptyWorkspace({
    organizations: [{ id: 'org-internal-id-123', name: 'Acme Research', slug: 'acme-slug-internal', billing_email: 'billing-secret@acme.test', status: 'active', created_at: ago(30 * DAY) }],
    api_keys: [
      { id: 'k1', user_id: 'u', organization_id: null, name: 'Prod', key_prefix: 'inf_live_abc', created_at: ago(5 * DAY), last_used_at: ago(DAY), expires_at: null, revoked_at: null, status: 'active' },
      { id: 'k2', user_id: 'u', organization_id: null, name: 'CI', key_prefix: 'inf_test_def', created_at: ago(4 * DAY), last_used_at: null, expires_at: null, revoked_at: null, status: 'active' },
      { id: 'k3', user_id: 'u', organization_id: null, name: 'Old', key_prefix: 'inf_live_ghi', created_at: ago(9 * DAY), last_used_at: null, expires_at: null, revoked_at: ago(2 * DAY), status: 'revoked' },
    ],
    inference_requests: [req({}), req({ model_name: 'meta/llama', status: 'failed' }), req({ created_at: ago(2 * DAY) })],
    notifications: [{ id: 'n1', user_id: 'u', title: 'Wallet recharged', detail: 'Your wallet was credited.', notification_type: 'WALLET_RECHARGE_SUCCESS', is_read: false, created_at: ago(3_600_000), read_at: null }],
    wallet_transactions: [{ id: 't1', wallet_id: null, user_id: 'u', order_id: null, transaction_reference: null, transaction_type: 'top_up', direction: 'credit', amount: '500', currency: 'INR', status: 'completed', description: null, created_at: ago(7_200_000) }],
  })
  ws.profile.organization_id = 'org-internal-id-123'
  ws.profile.full_name = 'Ada Lovelace'
  return ws
}

/* ───────────────────────── Overview ───────────────────────── */
describe('Overview', () => {
  it('shows the real wallet, month spend and alerts', async () => {
    await render('/dashboard/app')
    expect(byText('.cx-card', /Wallet balance/)?.textContent).toContain('₹1,250.50')
    // only a credit is recorded, so this month's spend is a real ₹0.00
    expect(byText('.cx-card', /Spend this month/)?.querySelector('.cx-stat__value')?.textContent).toBe('₹0.00')
    expect(byText('.cx-card', /Alerts/)?.textContent).toContain('Wallet recharged')
  })

  it('shows the free trial as unavailable (no trial backend) and no topbar trial chip', async () => {
    await render('/dashboard/app')
    expect(byText('.cx-card', /Free trial/)?.textContent).toContain('Not available')
    expect(text()).not.toMatch(/Trial Expired|Start 1-Hr Trial|Top up to continue/)
  })

  it('shows an em dash for month spend while the workspace loads', async () => {
    handlers['GET /api/customer/workspace'] = () => new Promise<Response>(() => {})
    await render('/dashboard/app')
    expect(byText('.cx-card', /Spend this month/)?.querySelector('.cx-stat__value')?.textContent).toBe('—')
  })

  it('degrades a single failing source without inventing a value', async () => {
    handlers['GET /api/wallet/balance'] = () => jsonResponse(503, { detail: 'down' })
    await render('/dashboard/app')
    const walletCard = byText('.cx-card', /Wallet balance/)!
    expect(walletCard.textContent).toContain('Wallet service unavailable')
    expect(walletCard.querySelector('.cx-stat__value')?.textContent).toBe('—')
  })

  it('gates on an expired session', async () => {
    handlers['GET /api/customer/workspace'] = () => jsonResponse(401, { ok: false, error: 'expired' })
    await render('/dashboard/app')
    expect(text()).toContain('Your session has expired')
  })
})

/* ───────────────────────── API keys ───────────────────────── */
const backendKeys = () => ({
  success: true,
  keys: [
    { id: 'k1', name: 'Prod', key_prefix: 'inf_live_abc', environment: 'live', is_active: true, created_at: ago(5 * DAY), last_used_at: ago(DAY), revoked_at: null },
    { id: 'k3', name: 'Old', key_prefix: 'inf_live_ghi', environment: 'live', is_active: false, created_at: ago(9 * DAY), last_used_at: null, revoked_at: ago(2 * DAY) },
  ],
})

describe('API keys', () => {
  beforeEach(() => {
    handlers['GET /api/v1/api-keys'] = () => jsonResponse(200, backendKeys())
  })

  it('lists keys with masked prefixes, active first, and a correct usage example', async () => {
    await render('/dashboard/app/api-keys')
    const rows = [...document.querySelectorAll('.cx-table tbody tr')].map((r) => r.textContent ?? '')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatch(/Prod.*inf_live_abc….*Active/)
    expect(rows[1]).toMatch(/Old.*Revoked/)
    expect(text()).toContain('/api/v1/inference')
    expect(text()).toContain('"prompt"')
    expect(text()).toContain('Authorization: Bearer $INFERXE_API_KEY')
  })

  it('shows the empty state and the error states', async () => {
    handlers['GET /api/v1/api-keys'] = () => jsonResponse(200, { success: true, keys: [] })
    await render('/dashboard/app/api-keys')
    expect(text()).toContain('No API keys yet')
    act(() => root!.unmount()); root = null; document.body.replaceChildren()

    handlers['GET /api/v1/api-keys'] = () => jsonResponse(500, { detail: 'Upstream API key database rejected the request.' })
    await render('/dashboard/app/api-keys')
    expect(text()).toContain('Upstream API key database rejected the request.')
    act(() => root!.unmount()); root = null; document.body.replaceChildren()

    handlers['GET /api/v1/api-keys'] = () => jsonResponse(401, { detail: 'expired' })
    await render('/dashboard/app/api-keys')
    expect(text()).toContain('Your session has expired')
    expect(byText('button', /Sign in again/)).toBeTruthy()
  })

  it('creates a key, shows the secret once, and never logs or stores it', async () => {
    const SECRET = 'inf_live_SUPERSECRETvalue_1234567890abcdef'
    const posted: unknown[] = []
    handlers['POST /api/v1/api-keys'] = (_u, init) => {
      posted.push(JSON.parse(String(init.body)))
      return jsonResponse(201, { id: 'k9', name: 'Backend', key_prefix: 'inf_live_SUP', api_key: SECRET, environment: 'live', created_at: new Date().toISOString() })
    }
    const logs = [vi.spyOn(console, 'log'), vi.spyOn(console, 'info'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error'), vi.spyOn(console, 'debug')]
    await render('/dashboard/app/api-keys')
    await click(byText('button', /Create API key/))
    const input = document.querySelector<HTMLInputElement>('.cx-dialog input.cx-input')!
    await type(input, 'Backend')
    await click(byText('.cx-dialog button', /^Create key$/))

    expect(posted).toEqual([{ name: 'Backend', environment: 'live' }])
    expect(document.querySelector('.cx-secret__value')?.textContent).toBe(SECRET)
    const done = byText('.cx-dialog button', /^Done$/) as HTMLButtonElement
    expect(done.disabled).toBe(true)
    await click(document.querySelector('.cx-check input'))
    expect(done.disabled).toBe(false)
    await click(done)

    expect(text()).not.toContain(SECRET)
    for (const store of [localStorage, sessionStorage]) {
      for (let i = 0; i < store.length; i++) expect(store.getItem(store.key(i)!) ?? '').not.toContain(SECRET)
    }
    for (const spy of logs) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain(SECRET)
      spy.mockRestore()
    }
    expect(calls().filter((c) => c === 'GET /api/v1/api-keys').length).toBeGreaterThanOrEqual(2) // list refreshed
  })

  it('validates the key name before calling the API', async () => {
    await render('/dashboard/app/api-keys')
    await click(byText('button', /Create API key/))
    await click(byText('.cx-dialog button', /^Create key$/))
    expect(text()).toContain('Give the key a name')
    expect(calls().some((c) => c.startsWith('POST'))).toBe(false)
  })

  it('requires confirmation before revoking', async () => {
    const deleted: string[] = []
    handlers['DELETE /api/v1/api-keys/k1'] = (u) => { deleted.push(u.pathname); return jsonResponse(200, { success: true }) }
    await render('/dashboard/app/api-keys')
    await click(document.querySelector('[aria-label="Revoke Prod"]'))
    expect(text()).toContain('Revoke “Prod”?')
    await click(byText('.cx-dialog button', /^Cancel$/))
    expect(deleted).toEqual([])

    await click(document.querySelector('[aria-label="Revoke Prod"]'))
    await click(byText('.cx-dialog button', /^Revoke key$/))
    expect(deleted).toEqual(['/api/v1/api-keys/k1'])
    expect(document.querySelector('.cx-dialog')).toBeNull()
  })
})

/* ───────────────────────── Notifications ───────────────────────── */
const notif = (id: string, isRead: boolean, over: object = {}) => ({ id, title: `Title ${id}`, message: `Message ${id}`, notification_type: 'WALLET_DEBIT', is_read: isRead, created_at: ago(DAY), ...over })

describe('Notifications', () => {
  beforeEach(() => {
    handlers['GET /api/notifications'] = (u) =>
      u.searchParams.get('unread_only') === 'true'
        ? jsonResponse(200, { total: 1, unread_count: 1, items: [notif('a', false)] })
        : jsonResponse(200, { total: 2, unread_count: 1, items: [notif('a', false), notif('b', true)] })
  })

  it('lists notifications and filters unread', async () => {
    await render('/dashboard/app/notifications')
    expect(document.querySelectorAll('.cx-inbox__item')).toHaveLength(2)
    expect(document.querySelectorAll('.cx-inbox__item.is-unread')).toHaveLength(1)
    await click(byText('.cx-seg__opt', /Unread/))
    expect(calls().some((c) => c.includes('unread_only=true'))).toBe(true)
    expect(document.querySelectorAll('.cx-inbox__item')).toHaveLength(1)
  })

  it('marks one as read and refreshes the topbar count', async () => {
    const changed = vi.fn()
    window.addEventListener('inferxe_notifications_change', changed)
    handlers['PATCH /api/notifications/a/read'] = () => jsonResponse(200, { id: 'a', is_read: true })
    await render('/dashboard/app/notifications')
    const unreadBefore = calls().filter((c) => c.includes('unread-count')).length
    await click(document.querySelector('[aria-label="Mark “Title a” as read"]'))
    expect(calls()).toContain('PATCH /api/notifications/a/read')
    expect(document.querySelectorAll('.cx-inbox__item.is-unread')).toHaveLength(0)
    expect(changed).toHaveBeenCalled()
    expect(calls().filter((c) => c.includes('unread-count')).length).toBeGreaterThan(unreadBefore)
    window.removeEventListener('inferxe_notifications_change', changed)
  })

  it('marks all as read and deletes with confirmation', async () => {
    handlers['PATCH /api/notifications/read-all'] = () => jsonResponse(200, { status: 'success', updated_count: 1 })
    handlers['DELETE /api/notifications/b'] = () => jsonResponse(200, { deleted: true, id: 'b' })
    await render('/dashboard/app/notifications')
    await click(byText('button', /Mark all as read/))
    expect(calls()).toContain('PATCH /api/notifications/read-all')
    expect(text()).toContain('1 notification marked as read.')
    await click(document.querySelector('[aria-label="Delete “Title b”"]'))
    expect(text()).toContain('Delete this notification?')
    await click(byText('.cx-dialog button', /^Delete$/))
    expect(calls()).toContain('DELETE /api/notifications/b')
    expect(document.querySelectorAll('.cx-inbox__item')).toHaveLength(1)
  })

  it('pages with Load more', async () => {
    handlers['GET /api/notifications'] = (u) =>
      u.searchParams.get('offset') === '0'
        ? jsonResponse(200, { total: 21, unread_count: 0, items: Array.from({ length: 20 }, (_, i) => notif(`p${i}`, true)) })
        : jsonResponse(200, { total: 21, unread_count: 0, items: [notif('last', true)] })
    await render('/dashboard/app/notifications')
    await click(byText('button', /Load more \(1 remaining\)/))
    expect(calls().some((c) => c.includes('offset=20'))).toBe(true)
    expect(document.querySelectorAll('.cx-inbox__item')).toHaveLength(21)
  })

  it('shows empty, error and session-expired states', async () => {
    handlers['GET /api/notifications'] = () => jsonResponse(200, { total: 0, unread_count: 0, items: [] })
    await render('/dashboard/app/notifications')
    expect(text()).toContain('No notifications yet')
    act(() => root!.unmount()); root = null; document.body.replaceChildren()

    handlers['GET /api/notifications'] = () => jsonResponse(503, { detail: 'down' })
    await render('/dashboard/app/notifications')
    expect(text()).toMatch(/temporarily unavailable/i)
    act(() => root!.unmount()); root = null; document.body.replaceChildren()

    handlers['GET /api/notifications'] = () => jsonResponse(401, { detail: 'expired' })
    await render('/dashboard/app/notifications')
    expect(text()).toContain('Your session has expired')
  })
})

/* ───────────────────────── Settings ───────────────────────── */
describe('Settings', () => {
  it('shows the real profile and never renders internal identifiers', async () => {
    await render('/dashboard/app/settings')
    expect(document.querySelector<HTMLInputElement>('input[autocomplete="name"]')?.value).toBe('Ada Lovelace')
    expect(text()).toContain('Acme Research')
    expect(text()).toContain('Active')
    expect(text()).toContain('Default limits')
    const html = document.body.innerHTML
    for (const secret of ['aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', 'org-internal-id-123', 'acme-slug-internal', 'billing-secret@acme.test']) {
      expect(html).not.toContain(secret)
    }
  })

  it('updates the display name through PATCH /api/customer/profile', async () => {
    const bodies: unknown[] = []
    handlers['PATCH /api/customer/profile'] = (_u, init) => { bodies.push(JSON.parse(String(init.body))); return jsonResponse(200, { ok: true, profile: { full_name: 'Ada King' } }) }
    await render('/dashboard/app/settings')
    const workspaceLoadsBefore = calls().filter((c) => c === 'GET /api/customer/workspace').length
    await type(document.querySelector<HTMLInputElement>('input[autocomplete="name"]')!, '  Ada King ')
    await click(byText('button', /Save changes/))
    expect(bodies).toEqual([{ full_name: 'Ada King' }])
    expect(text()).toContain('Display name updated.')
    expect(calls().filter((c) => c === 'GET /api/customer/workspace').length).toBeGreaterThan(workspaceLoadsBefore)
    expect(JSON.stringify(bodies)).not.toMatch(/user_?id/i)
  })

  it('surfaces profile update errors', async () => {
    handlers['PATCH /api/customer/profile'] = () => jsonResponse(400, { ok: false, error: 'Full name must be between 1 and 150 characters.' })
    await render('/dashboard/app/settings')
    await type(document.querySelector<HTMLInputElement>('input[autocomplete="name"]')!, 'New Name')
    await click(byText('button', /Save changes/))
    expect(text()).toContain('Full name must be between 1 and 150 characters.')
  })

  it('changes the password through the existing Cognito utility', async () => {
    await render('/dashboard/app/settings')
    const [current, next, confirm] = [...document.querySelectorAll<HTMLInputElement>('input[type="password"]')]
    await type(current, 'OldPass#123')
    await type(next, 'NewPass#4567')
    await type(confirm, 'Different#1')
    await click(byText('button', /Update password/))
    expect(changeUserPassword).not.toHaveBeenCalled()
    expect(text()).toContain('The new passwords do not match.')

    vi.mocked(changeUserPassword).mockResolvedValue({ ok: true })
    await type(confirm, 'NewPass#4567')
    await click(byText('button', /Update password/))
    expect(changeUserPassword).toHaveBeenCalledWith('customer@example.test', 'OldPass#123', 'NewPass#4567')
    expect(text()).toContain('Password changed.')
    expect([...document.querySelectorAll<HTMLInputElement>('input[type="password"]')].every((i) => i.value === '')).toBe(true)

    vi.mocked(changeUserPassword).mockResolvedValue({ ok: false, error: 'Incorrect username or password.' })
    const fields = [...document.querySelectorAll<HTMLInputElement>('input[type="password"]')]
    await type(fields[0], 'Wrong#123')
    await type(fields[1], 'NewPass#4567')
    await type(fields[2], 'NewPass#4567')
    await click(byText('button', /Update password/))
    expect(text()).toContain('Incorrect username or password.')
  })
})

/* ───────────────────────── Session isolation ───────────────────────── */
describe('session isolation', () => {
  it('does not carry one customer’s data into another session or browser storage', async () => {
    const wsA = populatedWorkspace()
    wsA.profile.full_name = 'Alice Alpha'
    handlers['GET /api/customer/workspace'] = () => jsonResponse(200, workspaceEnvelope(wsA))
    await render('/dashboard/app/settings')
    expect(text()).toContain('Acme Research')
    act(() => root!.unmount()); root = null; document.body.replaceChildren()

    const wsB = emptyWorkspace()
    wsB.profile.full_name = 'Bob Bravo'
    handlers['GET /api/customer/workspace'] = () => jsonResponse(200, workspaceEnvelope(wsB))
    await render('/dashboard/app/settings')
    expect(text()).toContain('Bob Bravo')
    expect(document.body.innerHTML).not.toMatch(/Alice Alpha|Acme Research/)
    const stored = [localStorage, sessionStorage].flatMap((s) => Array.from({ length: s.length }, (_, i) => `${s.key(i)}=${s.getItem(s.key(i)!)}`)).join('\n')
    expect(stored).not.toMatch(/Alice|Bob|Acme|inf_live/)
  })
})

/* ───────────────────────── Mobile drawer accessibility ───────────────────────── */
describe('mobile drawer accessibility', () => {
  it('is inert when closed, traps the page while open, restores focus and supports Escape', async () => {
    setMobile(true)
    await render('/dashboard/app')
    const sidebar = document.getElementById('cx-sidebar')!
    const menu = document.querySelector<HTMLButtonElement>('.cx-topbar__menu')!
    const mainCol = document.querySelector('.cx-main')!
    expect(sidebar.hasAttribute('inert')).toBe(true)
    expect(menu.getAttribute('aria-expanded')).toBe('false')

    await click(menu)
    expect(sidebar.hasAttribute('inert')).toBe(false)
    expect(sidebar.getAttribute('role')).toBe('dialog')
    expect(sidebar.getAttribute('aria-modal')).toBe('true')
    expect(mainCol.hasAttribute('inert')).toBe(true)
    expect(document.activeElement).toBe(document.querySelector('.cx-drawer-close'))
    expect(document.body.classList.contains('has-mnav-open')).toBe(true)

    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    await flush()
    expect(sidebar.hasAttribute('inert')).toBe(true)
    expect(mainCol.hasAttribute('inert')).toBe(false)
    expect(document.activeElement).toBe(menu)
    expect(document.body.classList.contains('has-mnav-open')).toBe(false)
  })

  it('moves focus to the page after navigating from the drawer', async () => {
    setMobile(true)
    await render('/dashboard/app')
    await click(document.querySelector('.cx-topbar__menu'))
    await click(byText('.cx-nav__item', /API keys/))
    expect(document.getElementById('cx-sidebar')!.hasAttribute('inert')).toBe(true)
    expect(document.activeElement).toBe(document.getElementById('cx-main'))
  })

  it('is never inert on desktop', async () => {
    setMobile(false)
    await render('/dashboard/app')
    expect(document.getElementById('cx-sidebar')!.hasAttribute('inert')).toBe(false)
  })
})
