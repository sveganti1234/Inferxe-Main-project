/**
 * The native console shows the authenticated customer's real profile on every one of its 12
 * sections and never any demo identity or banking-demo content ("Sahith", Verdelo, household...).
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ensureFreshSession, getSession } from '../../lib/authStore'
import CustomerApp from '../../features/customer/CustomerApp'
import { CONSOLE_SECTIONS } from '../../features/customer/navigation'
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
  user: { id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', fullName: 'Test Customer', email: 'customer@example.test', username: 'cust_test', role: 'customer' },
}
const mockFetch = vi.mocked(globalThis.fetch)
let root: Root | null = null
let host: HTMLDivElement

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
  mockFetch.mockImplementation(async (input) => {
    const path = new URL(String(input), 'http://localhost').pathname
    if (path === '/api/customer/workspace') return jsonResponse(200, workspaceEnvelope(emptyWorkspace()))
    if (path === '/api/notifications/unread-count') return jsonResponse(200, { unread_count: 0 })
    if (path === '/api/v1/health') return jsonResponse(200, { status: 'ok', nvidia_provider: 'configured' })
    if (path === '/api/wallet/balance') return jsonResponse(200, { balance: 0, currency: 'INR', updated_at: null })
    if (path === '/api/v1/ssh-keys') return jsonResponse(200, { success: true, keys: [] })
    if (path === '/api/v1/notebooks') return jsonResponse(200, { success: true, notebooks: [] })
    return jsonResponse(404, {})
  })
})

afterEach(() => {
  if (root) act(() => root!.unmount())
  root = null
  document.body.replaceChildren()
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

describe('native console identity', () => {
  it.each(CONSOLE_SECTIONS.map((s) => [s.id, s.path] as const))('%s shows the real customer and no demo identity or banking-demo content', async (_id, sectionPath) => {
    await render(`/dashboard/app${sectionPath ? `/${sectionPath}` : ''}`)
    const text = document.body.textContent ?? ''
    expect(document.querySelector('.cx-account__name')?.textContent).toBe('Test Customer')
    expect(text).not.toMatch(/sahith|verdelo|household|\bowner\b/i)
    expect(text).not.toMatch(/\bcards?\b.*\bpayments?\b.*\bbudgets?\b/i)
    expect(document.querySelector('iframe')).toBeNull()
  })

  it('shows an unavailable state instead of any substitute when the profile cannot be loaded', async () => {
    mockFetch.mockImplementation(async (input) => {
      const path = new URL(String(input), 'http://localhost').pathname
      if (path === '/api/customer/workspace') return jsonResponse(503, { ok: false })
      return jsonResponse(404, {})
    })
    await render('/dashboard/app')
    const text = document.body.textContent ?? ''
    expect(text).toMatch(/unavailable|try again/i)
    expect(text).not.toMatch(/sahith|verdelo|household/i)
  })
})
