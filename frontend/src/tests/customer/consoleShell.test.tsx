import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ensureFreshSession } from '../../lib/authStore'
import CustomerApp from '../../features/customer/CustomerApp'
import {
  CONSOLE_BASE,
  CONSOLE_SECTIONS,
  effectiveAvailability,
  getSection,
  sectionForPath,
  sectionHref,
} from '../../features/customer/navigation'
import { AvailabilityBadge } from '../../features/customer/ui/AvailabilityBadge'
import { ErrorState } from '../../features/customer/ui/states'
import { Stat } from '../../features/customer/ui/primitives'
import { CustomerApiError } from '../../features/customer/data/http'
import { SESSION, emptyWorkspace, jsonResponse, workspaceEnvelope } from './fixtures'

vi.mock('../../lib/authStore', () => ({
  ensureFreshSession: vi.fn(),
  signOutCurrentUser: vi.fn(async () => {}),
}))

const mockSession = vi.mocked(ensureFreshSession)
const mockFetch = vi.mocked(globalThis.fetch)

beforeEach(() => {
  // jsdom has no matchMedia (used by framer-motion's reduced-motion hook)
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  }))
  mockSession.mockReset()
  mockSession.mockResolvedValue(SESSION)
  mockFetch.mockReset()
})

/* ── Navigation config ── */
describe('console navigation', () => {
  it('defines the 12 approved sections with unique paths', () => {
    expect(CONSOLE_SECTIONS.map((s) => s.id)).toEqual([
      'overview', 'models', 'gpus', 'playground', 'deployments', 'api-keys',
      'developer', 'usage', 'notifications', 'billing', 'settings', 'help',
    ])
    expect(new Set(CONSOLE_SECTIONS.map((s) => s.path)).size).toBe(12)
  })

  it('labels availability honestly', () => {
    expect(getSection('models').availability).toBe('reference')
    expect(getSection('deployments').availability).toBe('unavailable')
    expect(getSection('developer').availability).toBe('simulated')
    expect(getSection('api-keys').availability).toBe('live')
    expect(effectiveAvailability(getSection('playground'), { inferenceAvailable: false })).toBe('unavailable')
    expect(effectiveAvailability(getSection('playground'), { inferenceAvailable: true })).toBe('live')
  })

  it('resolves paths and hrefs under the preview base', () => {
    expect(CONSOLE_BASE).toBe('/dashboard/app')
    expect(sectionHref(getSection('overview'))).toBe('/dashboard/app')
    expect(sectionForPath('/dashboard/app/')?.id).toBe('overview')
    expect(sectionForPath('/dashboard/app/api-keys')?.id).toBe('api-keys')
    expect(sectionForPath('/dashboard/app/nope')).toBeNull()
    expect(sectionForPath('/dashboard/customer')).toBeNull()
  })
})

/* ── UI states ── */
function renderStatic(node: React.ReactNode) {
  const host = document.createElement('div')
  const root = createRoot(host)
  act(() => root.render(<MemoryRouter>{node}</MemoryRouter>))
  return { host, root }
}

describe('shared UI', () => {
  it('AvailabilityBadge renders all four variants', () => {
    const { host, root } = renderStatic(
      <>
        <AvailabilityBadge availability="live" />
        <AvailabilityBadge availability="reference" />
        <AvailabilityBadge availability="simulated" />
        <AvailabilityBadge availability="unavailable" />
      </>,
    )
    const labels = [...host.querySelectorAll('[data-availability]')].map((n) => n.getAttribute('data-availability'))
    expect(labels).toEqual(['live', 'reference', 'simulated', 'unavailable'])
    expect(host.textContent).toMatch(/Live.*Reference.*Simulated.*Unavailable/)
    act(() => root.unmount())
  })

  it('Stat renders an em dash for unknown values instead of a number', () => {
    const { host, root } = renderStatic(<Stat label="Requests" value={null} />)
    expect(host.querySelector('.cx-stat__value')?.textContent).toBe('—')
    act(() => root.unmount())
  })

  it('ErrorState adapts to the error kind', () => {
    const retry = vi.fn()
    const signIn = vi.fn()
    const cases: Array<[CustomerApiError, RegExp, string | null]> = [
      [new CustomerApiError('unauthenticated', 'expired', 401), /session has expired/i, 'Sign in again'],
      [new CustomerApiError('forbidden', 'nope', 403), /restricted/i, null],
      [new CustomerApiError('unavailable', 'down', 503), /temporarily unavailable/i, 'Try again'],
    ]
    for (const [error, title, button] of cases) {
      const { host, root } = renderStatic(<ErrorState error={error} onRetry={retry} onSignIn={signIn} what="your workspace" />)
      expect(host.textContent).toMatch(title)
      const btn = host.querySelector('button')
      expect(btn?.textContent?.trim() ?? null).toBe(button)
      act(() => root.unmount())
    }
  })
})

/* ── Shell integration (CustomerApp rendered under its preview base) ── */
type Responder = (url: string) => Response
function routeFetch(handlers: Record<string, () => Response>): Responder {
  return (url: string) => {
    const path = url.split('?')[0]
    const handler = handlers[path]
    return handler ? handler() : jsonResponse(404, { error: 'not mocked' })
  }
}

async function renderConsole(path: string, handlers: Record<string, () => Response>) {
  const responder = routeFetch(handlers)
  mockFetch.mockImplementation(async (input) => responder(String(input)))
  const host = document.createElement('div')
  document.body.appendChild(host)
  let root!: Root
  await act(async () => {
    root = createRoot(host)
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/dashboard/app/*" element={<CustomerApp />} />
        </Routes>
      </MemoryRouter>,
    )
  })
  await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
  return {
    host,
    text: () => host.textContent ?? '',
    unmount: () => { act(() => root.unmount()); host.remove() },
  }
}

const liveWorkspace = () => {
  const ws = emptyWorkspace({
    organizations: [{ id: 'org-1', name: 'Acme Research', slug: 'acme', billing_email: null, status: 'active', created_at: null }],
  })
  ws.profile.organization_id = 'org-1'
  ws.profile.full_name = 'Ada Lovelace'
  return ws
}

const okHandlers = (overrides: Record<string, () => Response> = {}) => ({
  '/api/customer/workspace': () => jsonResponse(200, workspaceEnvelope(liveWorkspace())),
  '/api/notifications/unread-count': () => jsonResponse(200, { unread_count: 3 }),
  '/api/v1/health': () => jsonResponse(200, { status: 'degraded', nvidia_provider: 'missing_api_key' }),
  ...overrides,
})

describe('console shell', () => {
  afterEach(() => document.body.replaceChildren())

  it('renders the sidebar, real identity and live signals on the home page', async () => {
    const view = await renderConsole('/dashboard/app', okHandlers())
    const navItems = view.host.querySelectorAll('.cx-nav__item')
    expect(navItems).toHaveLength(12)
    expect(view.host.querySelector('.cx-org')).toBeNull() // display-only organization card removed
    expect(view.host.querySelector('.cx-quota__sub')?.textContent).toContain('Acme Research')
    expect(view.host.querySelector('.cx-account__name')?.textContent).toBe('Ada Lovelace')
    expect(view.host.querySelector('.cx-iconbtn__count')?.textContent).toBe('3')
    expect(view.text()).toContain('Inference API unavailable')
    expect(view.text()).toMatch(/Hello, Ada/)
    // Sidebar items carry no availability tags; each page states its own status.
    expect([...navItems].map((n) => n.textContent).join(' ')).not.toMatch(/Unavailable|Reference|Simulated|Preview/)
    view.unmount()
  })

  it('spend-limit card: a saved budget shows limit, real spend and % used', async () => {
    const view = await renderConsole('/dashboard/app', okHandlers({
      '/api/workspace/settings': () => jsonResponse(200, { monthly_budget: 2000, budget_configured: true }),
    }))
    const quota = view.host.querySelector('.cx-quota')?.textContent ?? ''
    expect(quota).toContain('₹2,000.00')
    expect(quota).toMatch(/₹[\d,.]+ spent this month/)
    expect(quota).toMatch(/\d+% used/)
    expect(quota).toContain('Acme Research')
    expect(quota).not.toMatch(/NovaTech|Sovereign|4,820/)
    view.unmount()
  })

  it('spend-limit card: the service default is never shown as a budget', async () => {
    const view = await renderConsole('/dashboard/app', okHandlers({
      '/api/workspace/settings': () => jsonResponse(200, { monthly_budget: null, budget_configured: false }),
    }))
    const quota = view.host.querySelector('.cx-quota')?.textContent ?? ''
    expect(quota).toContain('No spending limit set')
    expect(quota).not.toMatch(/10,000|% used/)
    expect(view.host.querySelector('.cx-quota__bar')).toBeNull()
    expect(view.host.querySelector('a.cx-backlink')?.getAttribute('href')).toBe('/')
    view.unmount()
  })

  it('opens the Deployments page with summary cards and lifecycle controls', async () => {
    const view = await renderConsole('/dashboard/app/deployments', okHandlers())
    expect(view.text()).not.toContain('This section is being rebuilt')
    expect(view.text()).toContain('TOTAL DEPLOYMENTS')
    expect(view.host.querySelector('[aria-current="page"]')?.textContent).toContain('Deployments')
    view.unmount()
  })

  it('shows a not-found page for unknown console paths', async () => {
    const view = await renderConsole('/dashboard/app/does-not-exist', okHandlers())
    expect(view.text()).toContain('Page not found')
    view.unmount()
  })

  it('gates the console when the session has expired (401)', async () => {
    const view = await renderConsole('/dashboard/app', okHandlers({
      '/api/customer/workspace': () => jsonResponse(401, { ok: false, error: 'Customer authentication could not be verified.' }),
    }))
    expect(view.text()).toContain('Your session has expired')
    expect([...view.host.querySelectorAll('button')].some((b) => b.textContent?.includes('Sign in again'))).toBe(true)
    view.unmount()
  })

  it('gates the console when the account is not active (403)', async () => {
    const view = await renderConsole('/dashboard/app', okHandlers({
      '/api/customer/workspace': () => jsonResponse(403, { ok: false, error: 'This account is not active.' }),
    }))
    expect(view.text()).toContain('Your account is not active')
    view.unmount()
  })

  it('keeps the shell usable when signals fail (no guessed values)', async () => {
    const view = await renderConsole('/dashboard/app', okHandlers({
      '/api/notifications/unread-count': () => jsonResponse(503, { detail: 'down' }),
      '/api/v1/health': () => jsonResponse(503, {}),
    }))
    expect(view.host.querySelector('.cx-iconbtn__count')).toBeNull()
    expect(view.text()).toContain('Inference status unknown')
    expect(view.host.querySelectorAll('.cx-nav__item')).toHaveLength(12)
    view.unmount()
  })

  it('only calls read-only endpoints and never sends a user id', async () => {
    const view = await renderConsole('/dashboard/app', okHandlers())
    for (const [url, init] of mockFetch.mock.calls) {
      expect(((init as RequestInit | undefined)?.method ?? 'GET').toUpperCase()).toBe('GET')
      expect(String(url)).not.toMatch(/user_?id/i)
    }
    view.unmount()
  })
})
