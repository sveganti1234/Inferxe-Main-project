/**
 * Routing through the real <App/>: the console is guarded. (Where /dashboard/customer leads is covered
 * by stage7Cutover.test.tsx.) All network calls are mocked.
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

describe('console preview routing', () => {
  it('redirects to sign-in when there is no session', async () => {
    const text = await renderApp('/dashboard/app')
    expect(text).toContain('Sign in to Inferxe')
    expect(host.querySelector('.cx-app')).toBeNull()
  })

  it('renders the console for a customer session', async () => {
    storeCustomerSession()
    await renderApp('/dashboard/app/api-keys')
    expect(host.querySelector('.cx-app')).not.toBeNull()
    expect(host.querySelectorAll('.cx-nav__item')).toHaveLength(18)
  })
})
