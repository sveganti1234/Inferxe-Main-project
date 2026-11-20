import { describe, it, expect, vi, beforeEach } from 'vitest'
import { loginAdminBackend, verifyAdminSessionServer, getSession, clearSession } from '../lib/authStore'

const mockFetch = vi.mocked(globalThis.fetch)
// Well-formed, unexpired admin JWT shape (role + exp): authStore treats undecodable tokens as expired (upstream bd3824a).
const SERVER_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c3JfYWRtaW4iLCJyb2xlIjoiYWRtaW4iLCJleHAiOjQxMDI0NDQ4MDB9.sig'

function respond(status: number, body: unknown) {
  mockFetch.mockResolvedValueOnce(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}

beforeEach(() => {
  mockFetch.mockReset()  // also drops queued responses a previous test did not consume
  clearSession()
})

describe('verifyAdminSessionServer', () => {
  it('does not trust locally minted ix- tokens without the backend', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    expect(await verifyAdminSessionServer('ix-tok-forged')).toBe(false)
  })

  it('rejects ix- tokens without even asking the backend', async () => {
    expect(await verifyAdminSessionServer('ix-admin-forged')).toBe(false)
    expect(await verifyAdminSessionServer('admin-dev-token')).toBe(false)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('accepts only when the backend says valid', async () => {
    respond(200, { ok: true, valid: false, user: { id: 'usr_admin', role: 'admin', email: 'o@example.test' } })
    expect(await verifyAdminSessionServer('real.admin.token')).toBe(false)
    respond(200, { ok: true, valid: true, user: { id: 'usr_admin', role: 'admin', email: 'o@example.test' } })
    expect(await verifyAdminSessionServer('real.admin.token')).toBe(true)
  })
})

describe('loginAdminBackend has no client-side fallback', () => {
  it('backend unreachable: no admin session for well-known admin emails/passwords', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const r = await loginAdminBackend('admin@inferxe.com', 'admin123')
    expect(r.ok).toBe(false)
    expect(getSession()).toBeNull()
  })

  it('backend rejects the password: error, no session', async () => {
    respond(401, { ok: false, isAdmin: true, error: 'Incorrect email or password.' })
    const r = await loginAdminBackend('owner@example.test', 'Admin@123')
    expect(r).toMatchObject({ ok: false, isAdmin: true })
    expect(getSession()).toBeNull()
  })

  it('lockout (429) is shown as an admin error instead of falling through to customer login', async () => {
    // Body as sent by backend/auth/adminAuth.js when the login rate limit is hit.
    respond(429, { ok: false, isAdmin: true, error: 'Too many failed sign-in attempts. Please wait and try again.' })
    const r = await loginAdminBackend('owner@example.test', 'x')
    expect(r).toMatchObject({ ok: false, isAdmin: true })
    expect(r.error).toContain('Too many')
  })

  it('backend accepts: session saved with the backend token', async () => {
    respond(200, { ok: true, isAdmin: true, token: SERVER_TOKEN, user: { id: 'usr_admin', role: 'admin', email: 'o@example.test' } })
    const r = await loginAdminBackend('o@example.test', 'right')
    expect(r.ok).toBe(true)
    expect(getSession()?.token).toBe(SERVER_TOKEN)
  })
})
