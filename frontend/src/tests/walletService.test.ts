import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fetchWalletBalance, fetchWalletTransactionHistory, topUpWallet } from '../lib/walletService'
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

  describe('wallet balance synchronization', () => {
    it('returns consistent balance across multiple fetchWalletBalance calls', async () => {
      mockSession('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTEyMyJ9.signature')

      const makeResponse = (balance: number) => new Response(JSON.stringify({
        user_id: 'user-123',
        balance,
        currency: 'INR',
        low_balance_alert_level: 'NORMAL',
        updated_at: '2026-01-01T00:00:00Z',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })

      mockFetch.mockResolvedValueOnce(makeResponse(7500))
      mockFetch.mockResolvedValueOnce(makeResponse(7500))

      const result1 = await fetchWalletBalance()
      const result2 = await fetchWalletBalance()

      expect(result1.ok).toBe(true)
      expect(result1.balance?.balance).toBe(7500)
      expect(result2.ok).toBe(true)
      expect(result2.balance?.balance).toBe(7500)
    })

    it('top-up updates balance and returns new_balance as source of truth', async () => {
      mockSession('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTEyMyJ9.signature')

      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({
          status: 'success',
          transaction_id: 'tx-sync-001',
          amount: 3000,
          new_balance: 10500,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      )

      const result = await topUpWallet(3000, 'sync-idem-001', 'Synchronization test top-up')

      expect(result.ok).toBe(true)
      expect(result.result?.new_balance).toBe(10500)
      expect(result.result?.amount).toBe(3000)
      expect(result.result?.transaction_id).toBe('tx-sync-001')

      const callArgs = mockFetch.mock.calls[0]
      const body = JSON.parse(callArgs![1]!.body as string)
      expect(body.idempotency_key).toBe('sync-idem-001')
    })

    it('fetchWalletBalance after top-up reflects updated balance', async () => {
      mockSession('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTEyMyJ9.signature')

      mockFetch
        .mockResolvedValueOnce(
          new Response(JSON.stringify({
            status: 'success',
            transaction_id: 'tx-sync-002',
            amount: 2000,
            new_balance: 12500,
          }), { status: 200, headers: { 'Content-Type': 'application/json' } })
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({
            user_id: 'user-123',
            balance: 12500,
            currency: 'INR',
            low_balance_alert_level: 'NORMAL',
            updated_at: '2026-01-01T00:00:00Z',
          }), { status: 200, headers: { 'Content-Type': 'application/json' } })
        )

      const topUpResult = await topUpWallet(2000, 'sync-idem-002', 'Post-topup sync test')
      expect(topUpResult.ok).toBe(true)
      expect(topUpResult.result?.new_balance).toBe(12500)

      const balanceResult = await fetchWalletBalance()
      expect(balanceResult.ok).toBe(true)
      expect(balanceResult.balance?.balance).toBe(12500)
    })

    it('backend balance is source of truth even when localStorage has stale value', async () => {
      mockSession('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTEyMyJ9.signature')

      // Simulate stale localStorage value of 999999
      localStorage.setItem('inferxe_demo_wallet_balance_v1_user-123', JSON.stringify(999999))

      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({
          user_id: 'user-123',
          balance: 450,
          currency: 'INR',
          low_balance_alert_level: 'WARNING',
          updated_at: '2026-01-01T00:00:00Z',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      )

      const result = await fetchWalletBalance()
      expect(result.ok).toBe(true)
      expect(result.balance?.balance).toBe(450) // backend value, not stale localStorage

      // Clean up
      localStorage.removeItem('inferxe_demo_wallet_balance_v1_user-123')
    })
  })

  describe('wallet transaction history', () => {
    it('returns unauthorized when no session exists', async () => {
      mockGetSession.mockReturnValue(null)

      const result = await fetchWalletTransactionHistory()

      expect(result.ok).toBe(false)
      expect(result.unauthorized).toBe(true)
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('returns demo token error when token is not a valid JWT', async () => {
      mockSession('ix-demo-token')

      const result = await fetchWalletTransactionHistory()

      expect(result.ok).toBe(false)
      expect(result.unauthorized).toBe(true)
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('fetches transaction history from backend with valid token', async () => {
      mockSession('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTEyMyJ9.signature')

      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({
          user_id: 'user-123',
          transactions: [
            {
              id: 'tx-1',
              type: 'top_up',
              direction: 'credit',
              amount: 5000,
              currency: 'INR',
              status: 'completed',
              description: 'Wallet top-up',
              balance_after: 5000,
              created_at: '2026-01-01T00:00:00Z',
            },
            {
              id: 'tx-2',
              type: 'usage_charge',
              direction: 'debit',
              amount: 1000,
              currency: 'INR',
              status: 'completed',
              description: 'GPU compute usage',
              balance_after: 4000,
              created_at: '2026-01-02T00:00:00Z',
            },
          ],
          count: 2,
          limit: 50,
          offset: 0,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      )

      const result = await fetchWalletTransactionHistory(50, 0)

      expect(result.ok).toBe(true)
      expect(result.history?.transactions).toHaveLength(2)
      expect(result.history?.count).toBe(2)
      expect(result.history?.limit).toBe(50)
      expect(result.history?.offset).toBe(0)
      expect(result.history?.transactions[0]).toMatchObject({
        id: 'tx-1',
        type: 'top_up',
        direction: 'credit',
        amount: 5000,
        currency: 'INR',
        status: 'completed',
        balance_after: 5000,
      })
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/wallet/transactions/history?limit=50&offset=0'),
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({ Authorization: expect.any(String) }),
        })
      )
    })

    it('returns empty transactions for user with no history', async () => {
      mockSession('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTEyMyJ9.signature')

      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({
          user_id: 'user-123',
          transactions: [],
          count: 0,
          limit: 50,
          offset: 0,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      )

      const result = await fetchWalletTransactionHistory()

      expect(result.ok).toBe(true)
      expect(result.history?.transactions).toEqual([])
      expect(result.history?.count).toBe(0)
    })

    it('returns unauthorized when backend returns 401', async () => {
      mockSession('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTEyMyJ9.signature')

      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ detail: 'Unauthorized' }), { status: 401 }))

      const result = await fetchWalletTransactionHistory()

      expect(result.ok).toBe(false)
      expect(result.unauthorized).toBe(true)
      expect(result.error).toBe('Session expired or unauthenticated.')
    })
  })
})
