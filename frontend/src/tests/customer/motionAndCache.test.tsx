/**
 * Page-data cache isolation (user, workspace, sign-out), honest failure after a refresh, the
 * refresh indicator, and theme-transition fallbacks (View Transitions / reduced motion).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

const auth = vi.hoisted(() => ({ user: 'user-a' as string | null }))
vi.mock('../../lib/authStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/authStore')>()),
  getSession: () => (auth.user ? { token: 't', expiresAt: Date.now() + 1e6, user: { id: auth.user, fullName: 'X', email: 'x@example.test', username: 'x', role: 'customer' } } : null),
}))

import { clearResourceCache, readCache, setCacheWorkspace, writeCache } from '../../features/customer/data/resourceCache'
import { useAsyncResource, useResourceRefreshing } from '../../features/customer/data/useAsyncResource'
import { useConsoleTheme } from '../../features/customer/shell/useConsoleTheme'

let root: Root | null = null
let host: HTMLDivElement
const flush = async (ms = 10) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })

beforeEach(() => {
  auth.user = 'user-a'
  clearResourceCache()
  localStorage.clear()
  host = document.createElement('div')
  document.body.appendChild(host)
})
afterEach(() => {
  if (root) act(() => root!.unmount())
  root = null
  document.body.replaceChildren()
  delete (document as { startViewTransition?: unknown }).startViewTransition
})

describe('resource cache isolation', () => {
  it('never returns one user’s data to another, even after switching back', () => {
    writeCache('wallet', { balance: 10 })
    expect(readCache('wallet')).toEqual({ balance: 10 })
    auth.user = 'user-b'
    expect(readCache('wallet')).toBeNull()
    writeCache('wallet', { balance: 99 })
    auth.user = 'user-a'
    expect(readCache('wallet')).toBeNull() // switching accounts emptied the cache entirely
  })

  it('switching workspace empties the cache', () => {
    setCacheWorkspace('org-1')
    writeCache('api-keys', ['k1'])
    setCacheWorkspace('org-1')
    expect(readCache('api-keys')).toEqual(['k1'])
    setCacheWorkspace('org-2')
    expect(readCache('api-keys')).toBeNull()
  })

  it('sign-out clears it immediately and nothing is cached without a session', () => {
    writeCache('ssh-keys', ['a'])
    auth.user = null
    window.dispatchEvent(new Event('inferxe_auth_change'))
    expect(readCache('ssh-keys')).toBeNull()
    writeCache('ssh-keys', ['b'])
    expect(readCache('ssh-keys')).toBeNull()
    auth.user = 'user-a'
    expect(readCache('ssh-keys')).toBeNull()
  })

  it('is memory-only (nothing written to browser storage)', () => {
    writeCache('wallet', { balance: 1 })
    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
  })
})

describe('useAsyncResource with cacheKey', () => {
  function Probe({ loader }: { loader: () => Promise<string> }) {
    const r = useAsyncResource(loader, { cacheKey: 'probe' })
    const refreshing = useResourceRefreshing()
    return <div data-status={r.state.status} data-refreshing={String(refreshing)}>{r.state.status === 'error' ? 'ERROR' : (r.state.data ?? 'EMPTY')}</div>
  }
  const el = () => host.firstElementChild as HTMLElement

  it('shows the last result while revalidating, flags refreshing, then shows fresh data', async () => {
    await act(async () => { root = createRoot(host); root.render(<Probe loader={async () => 'v1'} />) })
    await flush()
    expect(el().textContent).toBe('v1')
    act(() => root!.unmount())

    let resolve!: (v: string) => void
    root = createRoot(host)
    await act(async () => { root!.render(<Probe loader={() => new Promise((r) => { resolve = r })} />) })
    await flush()
    expect(el().textContent).toBe('v1') // no skeleton flash on revisit
    expect(el().dataset.status).toBe('loading')
    expect(el().dataset.refreshing).toBe('true')
    await act(async () => resolve('v2'))
    await flush()
    expect(el().textContent).toBe('v2')
    expect(el().dataset.refreshing).toBe('false')
  })

  it('reports a failed refresh as an error instead of presenting cached data as current', async () => {
    writeCache('probe', 'old')
    await act(async () => { root = createRoot(host); root.render(<Probe loader={async () => { throw new Error('down') }} />) })
    await flush()
    expect(el().dataset.status).toBe('error')
    expect(el().textContent).toBe('ERROR')
    expect(el().dataset.refreshing).toBe('false')
  })

  it('does not show another user’s cached data on first render', async () => {
    writeCache('probe', 'user-a-secret')
    auth.user = 'user-b'
    await act(async () => { root = createRoot(host); root.render(<Probe loader={() => new Promise(() => {})} />) })
    expect(el().textContent).toBe('EMPTY')
  })
})

describe('theme transition', () => {
  function ThemeProbe() {
    const { theme, toggleTheme } = useConsoleTheme()
    return <button onClick={toggleTheme}>{theme}</button>
  }
  const setReducedMotion = (reduce: boolean) => {
    window.matchMedia = vi.fn().mockImplementation((q: string) => ({ matches: reduce && q.includes('reduce'), media: q, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(), onchange: null }))
  }

  it('falls back to an instant switch when View Transitions are unsupported', async () => {
    setReducedMotion(false)
    await act(async () => { root = createRoot(host); root.render(<ThemeProbe />) })
    await act(async () => host.querySelector('button')!.click())
    expect(host.textContent).toBe('light')
  })

  it('uses View Transitions when available, and skips them under reduced motion', async () => {
    setReducedMotion(false)
    const startViewTransition = vi.fn((update: () => void) => { update() })
    ;(document as { startViewTransition?: unknown }).startViewTransition = startViewTransition
    await act(async () => { root = createRoot(host); root.render(<ThemeProbe />) })
    await act(async () => host.querySelector('button')!.click())
    expect(startViewTransition).toHaveBeenCalledTimes(1)
    expect(host.textContent).toBe('light')

    setReducedMotion(true)
    await act(async () => host.querySelector('button')!.click())
    expect(startViewTransition).toHaveBeenCalledTimes(1)
    expect(host.textContent).toBe('forest')
  })
})
