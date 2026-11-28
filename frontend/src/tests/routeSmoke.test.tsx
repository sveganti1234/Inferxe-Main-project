/**
 * Route smoke test through the real <App/> after route-level code splitting: public, customer, admin and
 * super-admin pages are lazy chunks and must still resolve inside their shells (no error fallback, no
 * stuck skeleton). Network calls are mocked; admin sessions are verified by the mocked /verify endpoint.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import App from '../App'
import { emptyWorkspace, jsonResponse, workspaceEnvelope } from './customer/fixtures'

const mockFetch = vi.mocked(globalThis.fetch)
const b64url = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
const EXP = () => Math.floor(Date.now() / 1000) + 3600

function storeSession(role: 'customer' | 'admin' | 'superadmin') {
  const token = role === 'customer'
    ? [b64url({ alg: 'RS256' }), b64url({ sub: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', token_use: 'id',
      iss: 'https://cognito-idp.ap-south-1.amazonaws.com/ap-south-1_cYw1QjgbQ', aud: '334trhnhmim8v42gq4bgk7umst', exp: EXP() }), 'sig'].join('.')
    : [b64url({ alg: 'HS256' }), b64url({ sub: 'adm-1', role, sid: 's1', sv: 1, exp: EXP() }), 'sig'].join('.')
  localStorage.setItem('inferxe_auth_session', JSON.stringify({
    token, expiresAt: EXP() * 1000,
    user: { id: role === 'customer' ? 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' : 'adm-1', fullName: 'Test', email: 't@example.test', username: 't', role },
  }))
}

let root: Root | null = null
let host: HTMLDivElement

async function renderApp(path: string, ready: (el: HTMLElement) => boolean) {
  host = document.createElement('div')
  document.body.appendChild(host)
  await act(async () => {
    root = createRoot(host)
    root.render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>)
  })
  // Up to 10 s: a cold admin/console chunk under full-suite parallel load can exceed 3 s. Exits as soon as ready.
  for (let i = 0; i < 500 && !ready(host); i++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
  }
  return ready(host)
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  }))
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo
  // jsdom lacks these browser APIs used by reveal animations and charts.
  class NoopObserver { observe() {} unobserve() {} disconnect() {} takeRecords() { return [] } }
  vi.stubGlobal('IntersectionObserver', NoopObserver)
  vi.stubGlobal('ResizeObserver', NoopObserver)
  mockFetch.mockReset()
  mockFetch.mockImplementation(async (input) => {
    const path = String(input).split('?')[0]
    if (path === '/api/customer/workspace') return jsonResponse(200, workspaceEnvelope(emptyWorkspace()))
    if (path === '/api/notifications/unread-count') return jsonResponse(200, { unread_count: 0 })
    if (path.endsWith('/verify')) {
      const role = JSON.parse(localStorage.getItem('inferxe_auth_session') || '{}')?.user?.role
      return jsonResponse(200, { ok: true, valid: true, user: { id: 'adm-1', email: 't@example.test', role, fullName: 'Test', username: 't' } })
    }
    return jsonResponse(404, { ok: false, error: 'Not mocked' })
  })
})

afterEach(() => {
  if (root) act(() => root!.unmount())
  root = null
  document.body.replaceChildren()
})

const text = () => host.textContent ?? ''
const noErrorFallback = () => !host.querySelector('.dash-admin-error-fallback')

describe('lazy routes resolve inside their shells', () => {
  it.each([
    ['/', (el: HTMLElement) => (el.querySelector('main')?.textContent ?? '').length > 200],
    ['/pricing', (el: HTMLElement) => (el.querySelector('main')?.textContent ?? '').length > 200],
    ['/login', (el: HTMLElement) => (el.textContent ?? '').includes('Sign in')],
  ])('public page %s', async (path, ready) => {
    expect(await renderApp(path, ready)).toBe(true)
  })

  it.each([
    ['/dashboard/app/usage', 'Usage & Analytics'],
    ['/dashboard/app/deployments', 'Model Deployments'],
    ['/dashboard/app/api-keys', 'API keys'],
  ])('customer page %s (lazy inside the console shell)', async (path, heading) => {
    storeSession('customer')
    const ok = await renderApp(path, () => Boolean(host.querySelector('.cx-app')) && text().includes(heading))
    expect(ok, `${path}: "${heading}" not rendered`).toBe(true)
  })

  it.each(['/dashboard', '/dashboard/customers', '/dashboard/keys', '/dashboard/provider'])('admin page %s', async (path) => {
    storeSession('admin')
    const ok = await renderApp(path, () => (host.querySelector('.adm-console #cx-main')?.textContent ?? '').trim().length > 40)
    expect(ok, `${path}: admin page did not render`).toBe(true)
    expect(noErrorFallback()).toBe(true)
  })

  it.each(['/dashboard/superadmin', '/dashboard/superadmin/admins', '/dashboard/super-admin/accounts'])('super-admin page %s', async (path) => {
    storeSession('superadmin')
    const ok = await renderApp(path, () => (host.querySelector('.adm-console #cx-main')?.textContent ?? '').trim().length > 40)
    expect(ok, `${path}: super-admin page did not render`).toBe(true)
    expect(noErrorFallback()).toBe(true)
  })

  it('a customer session cannot open admin pages', async () => {
    storeSession('customer')
    await renderApp('/dashboard', () => !host.querySelector('.adm-console #cx-main') && text().length > 0)
    expect(host.querySelector('.adm-console #cx-main')).toBeNull()
  })
})
