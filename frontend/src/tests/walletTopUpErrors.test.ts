import { describe, it, expect, vi, beforeEach } from 'vitest'
import { topUpWallet } from '../lib/walletService'
import { getSession } from '../lib/authStore'

vi.mock('../lib/authStore', () => ({
  getSession: vi.fn(),
  // walletService refreshes the session first (upstream bd3824a); return the same mocked session.
  ensureFreshSession: vi.fn(async () => (await import('../lib/authStore')).getSession()),
}))

const mockGetSession = vi.mocked(getSession)
const mockFetch = vi.mocked(globalThis.fetch)
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEyMyJ9.sig'

function respond(status: number, body: unknown) {
  mockFetch.mockResolvedValueOnce(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSession.mockReturnValue({
    token: JWT,
    user: { id: 'user-123', fullName: 'T', email: 't@example.test', username: 't', role: 'customer' },
    expiresAt: Date.now() + 3600000,
  })
})

describe('topUpWallet error handling', () => {
  it('403: self-service top-ups disabled, surfaces backend detail and status', async () => {
    respond(403, { detail: 'Wallet top-ups require a verified payment and are not available for self-service.' })
    const r = await topUpWallet(500)
    expect(r.ok).toBe(false)
    expect(r.status).toBe(403)
    expect(r.result).toBeUndefined()
    expect(r.error).toContain('verified payment')
  })

  it('400: rejected amount', async () => {
    respond(400, { detail: 'Recharge amount must be greater than zero' })
    const r = await topUpWallet(500)
    expect(r).toMatchObject({ ok: false, status: 400, error: 'Recharge amount must be greater than zero' })
  })

  it('500: generic message, never the raw server error', async () => {
    respond(500, { detail: 'psycopg2.OperationalError: connection to server failed' })
    const r = await topUpWallet(500)
    expect(r.ok).toBe(false)
    expect(r.status).toBe(500)
    expect(r.error).not.toContain('psycopg2')
  })

  it('network failure: no status, clear message', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const r = await topUpWallet(500)
    expect(r.ok).toBe(false)
    expect(r.status).toBeUndefined()
    expect(r.error).toContain('unreachable')
  })

  it('success returns the backend result', async () => {
    respond(200, { status: 'success', transaction_id: 'tx1', amount: 500, new_balance: 1500 })
    const r = await topUpWallet(500)
    expect(r).toMatchObject({ ok: true, status: 200, result: { new_balance: 1500 } })
  })
})
