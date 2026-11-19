/**
 * Sign-out from the native console: the real authStore runs (only Amplify's network-facing signOut
 * is mocked). Verifies that the Cognito sign-out is invoked, the stored session is destroyed,
 * protected routes become inaccessible, and nothing is silently restored.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'

const amplify = vi.hoisted(() => ({ signOut: vi.fn(async () => {}) }))
vi.mock('aws-amplify/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('aws-amplify/auth')>()),
  signOut: amplify.signOut,
}))

import App from '../../App'
import { getSession, ensureFreshSession, signOutCurrentUser } from '../../lib/authStore'
import { emptyWorkspace, jsonResponse, workspaceEnvelope } from './fixtures'

const mockFetch = vi.mocked(globalThis.fetch)
const SESSION_KEY = 'inferxe_auth_session'
const CLIENT_ID = '334trhnhmim8v42gq4bgk7umst'
const ISSUER = 'https://cognito-idp.ap-south-1.amazonaws.com/ap-south-1_cYw1QjgbQ'
const b64url = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')

function storeCustomerSession() {
  const exp = Math.floor(Date.now() / 1000) + 3600
  const token = [b64url({ alg: 'RS256' }), b64url({ sub: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', token_use: 'id', iss: ISSUER, aud: CLIENT_ID, exp }), 'sig'].join('.')
  localStorage.setItem(SESSION_KEY, JSON.stringify({
    token, expiresAt: exp * 1000,
    user: { id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', fullName: 'Test Customer', email: 'customer@example.test', username: 'cust_test', role: 'customer' },
  }))
}

let root: Root | null = null
let host: HTMLDivElement
let replaceSpy: ReturnType<typeof vi.fn>
const realLocation = window.location

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  amplify.signOut.mockClear()
  replaceSpy = vi.fn()
  Object.defineProperty(window, 'location', { configurable: true, value: { ...realLocation, replace: replaceSpy, assign: vi.fn(), href: realLocation.href } })
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  }))
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo
  Element.prototype.scrollIntoView = vi.fn()
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
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation })
})

async function renderApp(path: string) {
  host = document.createElement('div')
  document.body.appendChild(host)
  await act(async () => {
    root = createRoot(host)
    root.render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>)
  })
  for (let i = 0; i < 100; i++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    if (i >= 9 && (host.querySelector('.cx-app') || (host.textContent ?? '').includes('Sign in to Inferxe'))) break
  }
}
const text = () => host.textContent ?? ''

describe('console sign-out', () => {
  it('runs the real Cognito sign-out, destroys the stored session and sends the browser to /login', async () => {
    storeCustomerSession()
    await renderApp('/dashboard/app')
    expect(host.querySelector('.cx-app')).not.toBeNull()
    expect(getSession()).not.toBeNull()

    await act(async () => { host.querySelector<HTMLButtonElement>('.cx-account__trigger')!.click() })
    const signOutBtn = [...host.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((n) => /sign out/i.test(n.textContent ?? ''))
    expect(signOutBtn).toBeTruthy()
    await act(async () => { signOutBtn!.click(); await new Promise((r) => setTimeout(r, 50)) })

    expect(amplify.signOut).toHaveBeenCalledTimes(1) // real Cognito/Amplify flow, not just a navigation
    expect(localStorage.getItem(SESSION_KEY)).toBeNull() // application session destroyed
    expect(getSession()).toBeNull()
    expect(replaceSpy).toHaveBeenCalledWith('/login') // replace(): the console is not left in history as the current entry
  })

  it('makes the protected console inaccessible afterwards and does not restore a session on its own', async () => {
    storeCustomerSession()
    await signOutCurrentUser()
    expect(await ensureFreshSession()).toBeNull()
    for (const path of ['/dashboard/app', '/dashboard/app/billing', '/dashboard/customer', '/dashboard/legacy']) {
      await renderApp(path)
      expect(text(), path).toContain('Sign in to Inferxe')
      expect(host.querySelector('.cx-app'), path).toBeNull()
      expect(host.querySelector('iframe'), path).toBeNull()
      act(() => root!.unmount()); root = null; document.body.replaceChildren()
    }
    expect(localStorage.getItem(SESSION_KEY)).toBeNull()
  })

  it('still clears the session if Cognito sign-out itself fails', async () => {
    storeCustomerSession()
    amplify.signOut.mockRejectedValueOnce(new Error('network'))
    await signOutCurrentUser()
    expect(localStorage.getItem(SESSION_KEY)).toBeNull()
    expect(getSession()).toBeNull()
  })

  it('rejects an expired or malformed stored session on a protected route (no demo identity is substituted)', async () => {
    const exp = Math.floor(Date.now() / 1000) - 600
    const token = [b64url({ alg: 'RS256' }), b64url({ sub: 'x', token_use: 'id', iss: ISSUER, aud: CLIENT_ID, exp }), 'sig'].join('.')
    localStorage.setItem(SESSION_KEY, JSON.stringify({ token, expiresAt: exp * 1000, user: { id: 'x', fullName: 'Sahith', email: 'demo@example.test', username: 'demo', role: 'customer' } }))
    await renderApp('/dashboard/app')
    expect(text()).toContain('Sign in to Inferxe')
    expect(host.querySelector('.cx-app')).toBeNull()

    act(() => root!.unmount()); root = null; document.body.replaceChildren()
    localStorage.setItem(SESSION_KEY, JSON.stringify({ token: 'ix-customer-demo-token', expiresAt: Date.now() + 3_600_000, user: { id: 'usr_1', fullName: 'Sahith', email: 'demo@example.test', username: 'demo', role: 'customer' } }))
    await renderApp('/dashboard/app')
    expect(text()).toContain('Sign in to Inferxe')
    expect(host.querySelector('.cx-app')).toBeNull()
  })
})
