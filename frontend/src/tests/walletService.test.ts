import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fetchWalletBalance, topUpWallet } from '../lib/walletService'
import { getSession } from '../lib/authStore'

vi.mock('../lib/authStore', () => ({
  getSession: vi.fn(),
}))

const mockGetSession = vi.mocked(getSession)
const mockFetch = vi.mocked(globalThis.fetch)

function mockSession(token: string, expiresAt: number = Date.now() + 3600000) {
  mockGetSession.mockReturnValue({
    token,
    user: { id: 'user-123', fullName: 'Test User', email: 'test@example.com', username: 'testuser', role: 'customer' },
    expiresAt,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('walletService', () => {
  describe('fetchWalletBalance', () => {
    it('returns unauthorized when no session exists', async () => {
      mockGetSession.mockReturnValue(null)

      const result = await fetchWalletBalance()

      expect(result.ok).toBe(false)
      expect(result.unauthorized).toBe(true)
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('returns demo token error when token is not a valid JWT', async () => {
      mockSession('ix-demo-token')

      const result = await fetchWalletBalance()

      expect(result.ok).toBe(false)
      expect(result.unauthorized).toBe(true)
      expect(result.error).toContain('not a valid Cognito identity')
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('returns demo token error when token starts with ix-tok', async () => {
      mockSession('ix-tok-abc.def.ghi')

      const result = await fetchWalletBalance()

      expect(result.ok).toBe(false)
      expect(result.unauthorized).toBe(true)
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('fetches balance from backend with valid token', async () => {
      mockSession('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTEyMyJ9.signature')

      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({
          user_id: 'user-123',
          balance: 500,
          currency: 'INR',
          low_balance_alert_level: 'NORMAL',
          updated_at: '2026-01-01T00:00:00Z',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      )

      const result = await fetchWalletBalance()

      expect(result.ok).toBe(true)
      expect(result.balance).toMatchObject({
        user_id: 'user-123',
        balance: 500,
        currency: 'INR',
      })
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/wallet/balance'),
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({ Authorization: expect.any(String) }),
        })
      )
    })

    it('returns unauthorized when backend returns 401', async () => {
      mockSession('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTEyMyJ9.signature')

      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ detail: 'Unauthorized' }), { status: 401 }))

      const result = await fetchWalletBalance()

      expect(result.ok).toBe(false)
      expect(result.unauthorized).toBe(true)
      expect(result.error).toBe('Session expired or unauthenticated.')
    })
  })

  describe('topUpWallet', () => {
    it('returns unauthorized when no session exists', async () => {
      mockGetSession.mockReturnValue(null)

      const result = await topUpWallet(100)

      expect(result.ok).toBe(false)
      expect(result.unauthorized).toBe(true)
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('returns demo token error when token is not a valid JWT', async () => {
      mockSession('ix-demo-token')

      const result = await topUpWallet(100)

      expect(result.ok).toBe(false)
      expect(result.unauthorized).toBe(true)
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('rejects invalid amount', async () => {
      mockSession('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTEyMyJ9.signature')

      const result = await topUpWallet(0)

      expect(result.ok).toBe(false)
      expect(result.error).toBe('Top-up amount must be greater than zero.')
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('rejects negative amount', async () => {
      mockSession('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTEyMyJ9.signature')

      const result = await topUpWallet(-50)

      expect(result.ok).toBe(false)
      expect(result.error).toBe('Top-up amount must be greater than zero.')
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('tops up wallet successfully with custom idempotency key', async () => {
      mockSession('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTEyMyJ9.signature')

      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({
          status: 'success',
          transaction_id: 'tx-abc-123',
          amount: 100,
          new_balance: 600,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      )

      const result = await topUpWallet(100, 'idem-key-123', 'Custom top-up')

      expect(result.ok).toBe(true)
      expect(result.result).toMatchObject({
        status: 'success',
        transaction_id: 'tx-abc-123',
        amount: 100,
        new_balance: 600,
      })

      const callArgs = mockFetch.mock.calls[0]
      expect(callArgs).toBeDefined()
      expect(callArgs![0]!).toContain('/api/wallet/transactions')
      expect(callArgs![1]!.method).toBe('POST')
      const body = JSON.parse(callArgs![1]!.body as string)
      expect(body.amount).toBe(100)
      expect(body.idempotency_key).toBe('idem-key-123')
      expect(body.description).toBe('Custom top-up')
    })

    it('generates idempotency key when none provided', async () => {
      mockSession('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTEyMyJ9.signature')

      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({
          status: 'success',
          transaction_id: 'tx-xyz-789',
          amount: 200,
          new_balance: 800,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      )

      await topUpWallet(200)

      const callArgs = mockFetch.mock.calls[0]
      expect(callArgs).toBeDefined()
      const body = JSON.parse(callArgs![1]!.body as string)
      expect(body.idempotency_key).toMatch(/^wallet_topup_\d+/)
    })

    it('returns unauthorized when backend returns 401', async () => {
      mockSession('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTEyMyJ9.signature')

      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ detail: 'Unauthorized' }), { status: 401 }))

      const result = await topUpWallet(100)

      expect(result.ok).toBe(false)
      expect(result.unauthorized).toBe(true)
      expect(result.error).toBe('Session expired or unauthenticated.')
    })
  })
})
