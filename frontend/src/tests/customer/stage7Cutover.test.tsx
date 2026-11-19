/**
 * Stage 7 cutover routing through the real <App/>: /dashboard/customer lands in the native console, Verdelo-only
 * tabs and /dashboard/legacy keep the old iframe, and everything stays guarded. All network calls are mocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import App from '../../App'
import { emptyWorkspace, jsonResponse, workspaceEnvelope } from './fixtures'

const mockFetch = vi.mocked(globalThis.fetch)
const CLIENT_ID = '334trhnhmim8v42gq4bgk7umst'
const ISSUER = 'https://cognito-idp.ap-south-1.amazonaws.com/ap-south-1_cYw1QjgbQ'
const b64url = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')

/** Structurally valid (unsigned) Cognito ID token: passes the client-side guard only. */
function storeCustomerSession() {
  const exp = Math.floor(Date.now() / 1000) + 3600
  const token = [b64url({ alg: 'RS256' }), b64url({ sub: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', token_use: 'id', iss: ISSUER, aud: CLIENT_ID, exp }), 'sig'].join('.')
  localStorage.setItem('inferxe_auth_session', JSON.stringify({
    token, expiresAt: exp * 1000,
    user: { id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', fullName: 'Ada', email: 'ada@example.test', username: 'ada', role: 'customer' },
  }))
}

let root: Root | null = null
let host: HTMLDivElement

async function renderApp(path: string) {
  host = document.createElement('div')
  document.body.appendChild(host)
  await act(async () => {
    root = createRoot(host)
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>,
    )
  })
  // allow lazy routes, guard evaluation and data loading to settle
  // (the console chunk is larger since Stage 5, so cold module loading can exceed a fixed 200 ms)
  for (let i = 0; i < 100; i++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    if (i >= 9 && (host.querySelector('.cx-app') || host.querySelector('iframe') || (host.textContent ?? '').includes('Sign in to Inferxe'))) break
  }
  return host.textContent ?? ''
}

beforeEach(() => {
  localStorage.clear()
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  }))
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo
  mockFetch.mockReset()
  mockFetch.mockImplementation(async (input) => {
    const path = String(input).split('?')[0]
    if (path === '/api/customer/workspace') return jsonResponse(200, workspaceEnvelope(emptyWorkspace()))
    if (path === '/api/notifications/unread-count') return jsonResponse(200, { unread_count: 0 })
    if (path === '/api/v1/health') return jsonResponse(200, { status: 'ok', nvidia_provider: 'configured' })
    return jsonResponse(404, {})
  })
})

afterEach(() => {
  if (root) act(() => root!.unmount())
  root = null
  document.body.replaceChildren()
})

describe('route cutover', () => {
  const finalIframe = () => host.querySelector('iframe')?.getAttribute('src') ?? null
  const reset = () => { act(() => root!.unmount()); root = null; document.body.replaceChildren() }

  it('sends a signed-in customer from /dashboard/customer to the native console', async () => {
    storeCustomerSession()
    await renderApp('/dashboard/customer')
    expect(host.querySelector('.cx-app')).not.toBeNull()
    expect(host.querySelector('iframe')).toBeNull()
    expect(host.querySelector('h1')?.textContent).toMatch(/Hello, /)
  })

  it('maps ?tab=settings and /dashboard/customer/help to native pages', async () => {
    storeCustomerSession()
    await renderApp('/dashboard/customer?tab=settings')
    expect(host.querySelector('h1')?.textContent).toBe('Settings')
    reset()
    await renderApp('/dashboard/customer/help')
    expect(host.querySelector('h1')?.textContent).toBe('Help')
  })

  it('keeps Verdelo-only deep links working through the guarded legacy route', async () => {
    storeCustomerSession()
    for (const [path, hash] of [['/dashboard/customer?tab=cards', '#/cards'], ['/dashboard/customer/payments', '#/payments'], ['/dashboard/customer?tab=budgets', '#/budgets']]) {
      await renderApp(path)
      expect(host.querySelector('.cx-app')).toBeNull()
      expect(finalIframe()).toBe(`/verdelo/${hash}`)
      reset()
    }
  })

  it('serves the old dashboard at /dashboard/legacy (rollback route) for a signed-in customer', async () => {
    storeCustomerSession()
    await renderApp('/dashboard/legacy')
    expect(finalIframe()).toBe('/verdelo/#/overview')
  })

  it('protects /dashboard/customer, its sub-paths and /dashboard/legacy: signed-out users go to sign-in', async () => {
    for (const path of ['/dashboard/customer', '/dashboard/customer?tab=cards', '/dashboard/customer/help', '/dashboard/legacy', '/dashboard/legacy/cards', '/dashboard/app']) {
      const text = await renderApp(path)
      expect(text, path).toContain('Sign in to Inferxe')
      expect(host.querySelector('iframe'), path).toBeNull()
      expect(host.querySelector('.cx-app'), path).toBeNull()
      reset()
    }
  })

  it('still serves the console at /dashboard/app', async () => {
    storeCustomerSession()
    await renderApp('/dashboard/app/billing')
    expect(host.querySelector('h1')?.textContent).toBe('Billing & wallet')
  })

  it('sends old customer workspace pages to their native console equivalents (no demo workspace for customers)', async () => {
    storeCustomerSession()
    for (const [path, h1] of [['/dashboard/gpus', 'GPU marketplace'], ['/dashboard/wallet', 'Billing & wallet'], ['/dashboard/api-keys', 'API keys'], ['/dashboard/analytics', 'Usage & analytics'], ['/dashboard/anything-else', null]] as const) {
      await renderApp(path)
      expect(host.querySelector('.cx-app'), path).not.toBeNull()
      expect(host.querySelector('iframe'), path).toBeNull()
      if (h1) expect(host.querySelector('h1')?.textContent, path).toBe(h1)
      expect(host.textContent ?? '', path).not.toMatch(/sahith|verdelo/i)
      reset()
    }
  })

  it('keeps admin routes guarded and unchanged: a signed-out visitor to /dashboard/provider and /dashboard/users goes to sign-in', async () => {
    for (const path of ['/dashboard', '/dashboard/provider', '/dashboard/users', '/dashboard/customers']) {
      const text = await renderApp(path)
      expect(text, path).toContain('Sign in to Inferxe')
      reset()
    }
  })
})
