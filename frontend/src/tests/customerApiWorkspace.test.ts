import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getCustomerWorkspace } from '../lib/customerApi'
import { getSession } from '../lib/authStore'

vi.mock('../lib/authStore', () => ({
  getSession: vi.fn(),
}))

const mockGetSession = vi.mocked(getSession)
const mockFetch = vi.mocked(globalThis.fetch)

function mockSession(token: string) {
  mockGetSession.mockReturnValue({
    token,
    user: { id: 'user-123', fullName: 'Test User', email: 'test@example.com', username: 'testuser', role: 'customer' },
    expiresAt: Date.now() + 60 * 60 * 1000,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

function mockWorkspaceResponse(workspace: Record<string, unknown>) {
  mockFetch.mockResolvedValueOnce(
    new Response(JSON.stringify({ ok: true, workspace }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  )
}

describe('customerApi getCustomerWorkspace', () => {
  it('returns wallet as single object (not array) from wallets table', async () => {
    mockSession('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTEyMyJ9.signature')
    mockWorkspaceResponse({
      profile: { user_id: 'user-123', full_name: 'Test User', email: 'test@example.com', username: 'testuser', role: 'customer', status: 'active', organization_id: null },
      organizations: [],
      organization_members: [],
      user_access_policies: [],
      gpu_providers: [],
      gpu_listings: [],
      saved_gpu_listings: [],
      deployments: [],
      orders: [],
      usage_records: [],
      wallet: { user_id: 'user-123', balance: 5000, currency: 'INR', low_balance_alert_level: 'NORMAL', updated_at: '2026-01-01T00:00:00Z' },
      wallet_transactions: [],
      api_keys: [],
      ssh_public_keys: [],
      notifications: [],
      order_reviews: [],
      notebook_sessions: [],
      inference_requests: [],
    })

    const result = await getCustomerWorkspace()

    expect(result.wallet).toMatchObject({
      user_id: 'user-123',
      balance: 5000,
      currency: 'INR',
    })
    expect(result.wallet).not.toBeInstanceOf(Array)
    expect(Array.isArray(result.wallet)).toBe(false)
  })

  it('returns null wallet when no wallet record exists', async () => {
    mockSession('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTEyMyJ9.signature')
    mockWorkspaceResponse({
      profile: { user_id: 'user-123', full_name: 'Test User', email: 'test@example.com', username: 'testuser', role: 'customer', status: 'active', organization_id: null },
      organizations: [],
      organization_members: [],
      user_access_policies: [],
      gpu_providers: [],
      gpu_listings: [],
      saved_gpu_listings: [],
      deployments: [],
      orders: [],
      usage_records: [],
      wallet: null,
      wallet_transactions: [],
      api_keys: [],
      ssh_public_keys: [],
      notifications: [],
      order_reviews: [],
      notebook_sessions: [],
      inference_requests: [],
    })

    const result = await getCustomerWorkspace()

    expect(result.wallet).toBeNull()
  })

  it('returns wallet_transactions as array from wallet_transactions table', async () => {
    mockSession('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTEyMyJ9.signature')
    mockWorkspaceResponse({
      profile: { user_id: 'user-123', full_name: 'Test User', email: 'test@example.com', username: 'testuser', role: 'customer', status: 'active', organization_id: null },
      organizations: [],
      organization_members: [],
      user_access_policies: [],
      gpu_providers: [],
      gpu_listings: [],
      saved_gpu_listings: [],
      deployments: [],
      orders: [],
      usage_records: [],
      wallet: { user_id: 'user-123', balance: 5000, currency: 'INR', low_balance_alert_level: 'NORMAL', updated_at: '2026-01-01T00:00:00Z' },
      wallet_transactions: [
        { id: 'tx-1', user_id: 'user-123', amount: 5000, balance_after: 5000, currency: 'INR', status: 'completed', idempotency_key: 'key-1', description: 'Top up', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', transaction_type: 'top_up', direction: 'credit' },
        { id: 'tx-2', user_id: 'user-123', amount: 1000, balance_after: 4000, currency: 'INR', status: 'completed', idempotency_key: 'key-2', description: 'Usage', created_at: '2026-01-02T00:00:00Z', updated_at: '2026-01-02T00:00:00Z', transaction_type: 'usage_charge', direction: 'debit' },
      ],
      api_keys: [],
      ssh_public_keys: [],
      notifications: [],
      order_reviews: [],
      notebook_sessions: [],
      inference_requests: [],
    })

    const result = await getCustomerWorkspace()

    expect(Array.isArray(result.wallet_transactions)).toBe(true)
    expect(result.wallet_transactions).toHaveLength(2)
    expect(result.wallet_transactions[0]).toMatchObject({
      id: 'tx-1',
      user_id: 'user-123',
      amount: 5000,
      balance_after: 5000,
      transaction_type: 'top_up',
      direction: 'credit',
    })
    expect(result.wallet_transactions[1]).toMatchObject({
      id: 'tx-2',
      user_id: 'user-123',
      amount: 1000,
      balance_after: 4000,
      transaction_type: 'usage_charge',
      direction: 'debit',
    })
  })

  it('throws when workspace response is missing wallet_transactions array', async () => {
    mockSession('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTEyMyJ9.signature')
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, workspace: { profile: {}, wallet: null, wallet_transactions: 'not-an-array' } }), { status: 200 })
    )

    await expect(getCustomerWorkspace()).rejects.toThrow()
  })
})
