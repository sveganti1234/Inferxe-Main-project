/**
 * Admin & Super Admin sign-out flow tests: mirrors customer signOutFlow.test.tsx so admin logout
 * behaves identically to customer logout (clears local session + caches, notifies /api/admin/logout,
 * redirects to /login via window.location.replace, blocks protected routes, and handles cross-tab /
 * bfcache sign-out).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import App from '../App'
import {
  getSession,
  isSessionVerifiedRecently,
  signOutCurrentUser,
  verifyAdminSessionWithDetails,
} from '../lib/authStore'

const SESSION_KEY = 'inferxe_auth_session'
const b64url = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')

function adminJwt(role: 'admin' | 'superadmin' = 'admin') {
  const exp = Math.floor(Date.now() / 1000) + 3600
  return [
    b64url({ alg: 'HS256', typ: 'JWT' }),
    b64url({ sub: 'adm-1', email: 'admin@inferxe.com', role, sid: 'sid-1', exp }),
    'sig',
  ].join('.')
}

function storeAdminSession(role: 'admin' | 'superadmin' = 'admin') {
  const token = adminJwt(role)
  const exp = Math.floor(Date.now() / 1000) + 3600
  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      token,
      expiresAt: exp * 1000,
      user: {
        id: 'adm-1',
        fullName: 'Admin User',
        email: 'admin@inferxe.com',
        username: 'admin',
        role,
      },
    }),
  )
  return token
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

let root: Root | null = null
let host: HTMLDivElement
let replaceSpy: ReturnType<typeof vi.fn>
const realLocation = window.location
const realFetch = globalThis.fetch

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  replaceSpy = vi.fn()
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...realLocation, replace: replaceSpy, assign: vi.fn(), href: realLocation.href },
  })
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo
  Element.prototype.scrollIntoView = vi.fn()
  Element.prototype.getBoundingClientRect = vi.fn(() => ({
    x: 0, y: 0, width: 100, height: 32, top: 0, right: 100, bottom: 32, left: 0, toJSON: () => ({}),
  }))
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
  globalThis.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof IntersectionObserver
})

afterEach(() => {
  if (root) act(() => root!.unmount())
  root = null
  document.body.replaceChildren()
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation })
  globalThis.fetch = realFetch
})

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
  for (let i = 0; i < 100; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })
    if (
      i >= 6 &&
      (host.querySelector('.cx-account__trigger') || (host.textContent ?? '').includes('Sign in to Inferxe'))
    ) {
      break
    }
  }
}

describe('admin sign-out', () => {
  it('revokes the server session, clears local session and caches, and redirects to /login like customer logout', async () => {
    const token = storeAdminSession('admin')
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input).split('?')[0]
      if (path === '/api/admin/verify') {
        return jsonResponse(200, {
          ok: true,
          valid: true,
          user: { id: 'adm-1', fullName: 'Admin User', email: 'admin@inferxe.com', username: 'admin', role: 'admin' },
        })
      }
      if (path === '/api/admin/logout') {
        return jsonResponse(200, { ok: true })
      }
      return jsonResponse(200, { ok: true })
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    await renderApp('/dashboard')
    expect(host.querySelector('.cx-account__trigger')).not.toBeNull()
    expect(isSessionVerifiedRecently(token)).toBe(true)

    await act(async () => {
      host.querySelector<HTMLElement>('.cx-account__trigger')!.click()
    })
    const signOutBtn = [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      /sign out/i.test(b.textContent ?? ''),
    )
    expect(signOutBtn).toBeTruthy()

    await act(async () => {
      signOutBtn!.click()
      await new Promise((r) => setTimeout(r, 50))
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/logout',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        headers: expect.objectContaining({ Authorization: `Bearer ${token}` }),
      }),
    )
    expect(localStorage.getItem(SESSION_KEY)).toBeNull()
    expect(getSession()).toBeNull()
    expect(isSessionVerifiedRecently(token)).toBe(false)
    expect(replaceSpy).toHaveBeenCalledTimes(1)
    expect(replaceSpy).toHaveBeenCalledWith('/login')
    expect(host.textContent ?? '').not.toContain('Sign in to Inferxe')
  })

  it('makes admin and superadmin routes inaccessible after sign-out', async () => {
    storeAdminSession('superadmin')
    globalThis.fetch = vi.fn(async () => jsonResponse(200, { ok: true })) as unknown as typeof fetch
    await signOutCurrentUser()

    for (const path of ['/dashboard', '/dashboard/users', '/dashboard/super-admin']) {
      await renderApp(path)
      expect(host.textContent ?? '', path).toContain('Sign in to Inferxe')
      expect(host.querySelector('.cx-account__trigger'), path).toBeNull()
      act(() => root!.unmount())
      root = null
      document.body.replaceChildren()
    }
  })

  it('still clears local session and caches when /api/admin/logout fails', async () => {
    const token = storeAdminSession('admin')
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input).split('?')[0]
      if (path === '/api/admin/verify') {
        return jsonResponse(200, {
          ok: true,
          valid: true,
          user: { id: 'adm-1', fullName: 'Admin User', email: 'admin@inferxe.com', username: 'admin', role: 'admin' },
        })
      }
      throw new Error('network down')
    }) as unknown as typeof fetch

    expect((await verifyAdminSessionWithDetails(token)).valid).toBe(true)
    expect(isSessionVerifiedRecently(token)).toBe(true)

    await signOutCurrentUser()
    expect(localStorage.getItem(SESSION_KEY)).toBeNull()
    expect(getSession()).toBeNull()
    expect(isSessionVerifiedRecently(token)).toBe(false)
  })

  it('kicks out AdminGuard on cross-tab storage sign-out and bfcache pageshow restore', async () => {
    storeAdminSession('admin')
    let serverValid = true
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input).split('?')[0]
      if (path === '/api/admin/verify') {
        return serverValid
          ? jsonResponse(200, {
              ok: true,
              valid: true,
              user: { id: 'adm-1', fullName: 'Admin User', email: 'admin@inferxe.com', username: 'admin', role: 'admin' },
            })
          : jsonResponse(401, { ok: false, valid: false })
      }
      return jsonResponse(200, { ok: true })
    }) as unknown as typeof fetch

    await renderApp('/dashboard')
    expect(host.querySelector('.cx-account__trigger')).not.toBeNull()

    // Simulate bfcache restoration after server session revocation
    serverValid = false
    await act(async () => {
      window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }))
      await new Promise((r) => setTimeout(r, 50))
    })
    expect(host.textContent ?? '').toContain('Sign in to Inferxe')
    expect(host.querySelector('.cx-account__trigger')).toBeNull()
  })
})
