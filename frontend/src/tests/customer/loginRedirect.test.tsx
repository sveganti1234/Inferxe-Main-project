/**
 * Login → console: a successful customer sign-in must land on /dashboard/app, never on the old
 * /dashboard/customer (Verdelo) dashboard; admin sign-in must still go to /dashboard.
 * Amplify and the profile/admin backends are mocked; the real <Login/> component runs.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'

const amplify = vi.hoisted(() => ({
  signIn: vi.fn(),
  signOut: vi.fn(async () => {}),
  fetchAuthSession: vi.fn(),
}))
vi.mock('aws-amplify/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('aws-amplify/auth')>()),
  signIn: amplify.signIn,
  signOut: amplify.signOut,
  fetchAuthSession: amplify.fetchAuthSession,
}))
vi.mock('aws-amplify/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('aws-amplify/utils')>()),
  Hub: { listen: vi.fn(() => () => {}), dispatch: vi.fn() },
}))

const auth = vi.hoisted(() => ({
  loginAdminBackend: vi.fn(),
  syncCustomerProfile: vi.fn(),
  saveSession: vi.fn(),
  ensureFreshSession: vi.fn(),
}))
vi.mock('../../lib/authStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/authStore')>()),
  loginAdminBackend: auth.loginAdminBackend,
  syncCustomerProfile: auth.syncCustomerProfile,
  saveSession: auth.saveSession,
  ensureFreshSession: auth.ensureFreshSession,
}))

import Login from '../../pages/Login'

const PROFILE = { id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', fullName: 'Test Customer', email: 'customer@example.test', username: 'cust_test', role: 'customer' }

function Where() {
  const l = useLocation()
  return <div id="where" data-path={l.pathname} />
}

let root: Root | null = null
let host: HTMLDivElement

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  }))
  Object.values({ ...amplify, ...auth }).forEach((m) => m.mockReset())
  amplify.signOut.mockResolvedValue(undefined)
  auth.ensureFreshSession.mockResolvedValue(null)
  auth.loginAdminBackend.mockResolvedValue({ isAdmin: false, ok: false })
  auth.syncCustomerProfile.mockResolvedValue(PROFILE)
  amplify.signIn.mockResolvedValue({ isSignedIn: true, nextStep: { signInStep: 'DONE' } })
  amplify.fetchAuthSession.mockResolvedValue({ tokens: { idToken: { toString: () => 'header.payload.signature', payload: { exp: Math.floor(Date.now() / 1000) + 3600 } } } })
})

afterEach(() => {
  if (root) act(() => root!.unmount())
  root = null
  document.body.replaceChildren()
})

async function flush(times = 8) {
  for (let i = 0; i < times; i++) await act(async () => { await new Promise((r) => setTimeout(r, 10)) })
}
async function renderLogin(path = '/login') {
  host = document.createElement('div')
  document.body.appendChild(host)
  await act(async () => {
    root = createRoot(host)
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <Where />
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/dashboard/app" element={<div id="console-marker" />} />
          <Route path="/dashboard/customer" element={<div id="legacy-marker" />} />
          <Route path="/dashboard" element={<div id="admin-marker" />} />
        </Routes>
      </MemoryRouter>,
    )
  })
  await flush()
}
const where = () => document.getElementById('where')?.getAttribute('data-path')
async function setValue(el: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function submitCredentials(email: string, password: string) {
  await setValue(document.querySelector<HTMLInputElement>('input[type="email"], input[autocomplete="email"], input[autocomplete="username"]')!, email)
  await setValue(document.querySelector<HTMLInputElement>('input[type="password"]')!, password)
  await act(async () => { document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
  await flush(12)
}

describe('login destination', () => {
  it('sends a customer who signs in with Cognito to /dashboard/app, not the old dashboard', async () => {
    await renderLogin()
    await submitCredentials('customer@example.test', 'correct-horse-battery')
    expect(amplify.signIn).toHaveBeenCalledTimes(1)
    expect(auth.saveSession).toHaveBeenCalledTimes(1)
    expect(where()).toBe('/dashboard/app')
    expect(document.getElementById('legacy-marker')).toBeNull()
  })

  it('stores only the verified profile from the backend (no demo identity) when saving the session', async () => {
    await renderLogin()
    await submitCredentials('customer@example.test', 'correct-horse-battery')
    const saved = JSON.stringify(auth.saveSession.mock.calls[0][0])
    expect(saved).toContain('Test Customer')
    expect(saved).not.toMatch(/sahith|verdelo/i)
  })

  it('sends an already signed-in customer who opens /login straight to the console', async () => {
    auth.ensureFreshSession.mockResolvedValue({ token: 'header.payload.signature', expiresAt: Date.now() + 3_600_000, user: PROFILE })
    await renderLogin()
    expect(where()).toBe('/dashboard/app')
    expect(amplify.signIn).not.toHaveBeenCalled()
  })

  it('does not redirect an admin session away from the login page and keeps the admin destination', async () => {
    auth.ensureFreshSession.mockResolvedValue({ token: 'header.payload.signature', expiresAt: Date.now() + 3_600_000, user: { ...PROFILE, role: 'admin' } })
    await renderLogin()
    expect(where()).toBe('/login')
    auth.loginAdminBackend.mockResolvedValue({ isAdmin: true, ok: true })
    await submitCredentials('admin@example.test', 'admin-password-1')
    expect(where()).toBe('/dashboard')
    expect(amplify.signIn).not.toHaveBeenCalled()
  })

  it('shows an error, signs nobody in and goes nowhere when Cognito rejects the credentials', async () => {
    amplify.signIn.mockRejectedValue(Object.assign(new Error('Incorrect username or password.'), { name: 'NotAuthorizedException' }))
    await renderLogin()
    await submitCredentials('customer@example.test', 'wrong-password-1')
    expect(auth.saveSession).not.toHaveBeenCalled()
    expect(where()).toBe('/login')
  })

  it('signs nobody in and goes nowhere when the profile sync fails after Cognito accepts the password', async () => {
    auth.syncCustomerProfile.mockRejectedValue(Object.assign(new Error('Your customer profile could not be synchronized. Please try again.'), { name: 'ProfileSyncError' }))
    await renderLogin()
    await submitCredentials('customer@example.test', 'correct-horse-battery')
    expect(auth.saveSession).not.toHaveBeenCalled()
    expect(where()).toBe('/login')
    expect(document.body.textContent).toContain('could not be synchronized')
  })
})
