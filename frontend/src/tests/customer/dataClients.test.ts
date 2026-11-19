import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ensureFreshSession } from '../../lib/authStore'
import { CustomerApiError, customerRequest, kindForStatus } from '../../features/customer/data/http'
import { fetchCustomerWorkspace, normaliseWorkspace } from '../../features/customer/data/workspaceClient'
import {
  fetchInferenceHealth,
  fetchNotifications,
  fetchUnreadNotificationCount,
  fetchWalletBalance,
} from '../../features/customer/data/serviceClients'
import { SESSION, TEST_SUB, emptyWorkspace, jsonResponse, workspaceEnvelope } from './fixtures'

vi.mock('../../lib/authStore', () => ({ ensureFreshSession: vi.fn() }))

const mockSession = vi.mocked(ensureFreshSession)
const mockFetch = vi.mocked(globalThis.fetch)

beforeEach(() => {
  mockSession.mockReset()
  mockFetch.mockReset()
  mockSession.mockResolvedValue(SESSION)
})

/** Await a promise that is expected to reject and return its CustomerApiError. */
async function failure(promise: Promise<unknown>): Promise<CustomerApiError> {
  try {
    await promise
  } catch (e) {
    expect(e).toBeInstanceOf(CustomerApiError)
    return e as CustomerApiError
  }
  throw new Error('Expected the request to fail')
}

const lastRequest = () => {
  const [url, init] = mockFetch.mock.calls.at(-1)!
  return { url: String(url), init: init as RequestInit, headers: (init as RequestInit).headers as Record<string, string> }
}

describe('customerRequest — authentication', () => {
  it('attaches the bearer token from ensureFreshSession()', async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { ok: true }))
    await customerRequest('/api/customer/workspace')
    expect(mockSession).toHaveBeenCalledTimes(1)
    expect(lastRequest().headers.Authorization).toBe(`Bearer ${SESSION.token}`)
  })

  it('never sends a user id in the URL or body', async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, workspaceEnvelope()))
    await fetchCustomerWorkspace()
    mockFetch.mockResolvedValue(jsonResponse(200, { total: 0, unread_count: 0, items: [] }))
    await fetchNotifications({ limit: 5, unreadOnly: true })
    mockFetch.mockResolvedValue(jsonResponse(200, { unread_count: 0 }))
    await fetchUnreadNotificationCount()
    mockFetch.mockResolvedValue(jsonResponse(200, { balance: 0, currency: 'INR' }))
    await fetchWalletBalance()
    for (const [url, init] of mockFetch.mock.calls) {
      expect(String(url)).not.toMatch(/user_?id|sub=/i)
      expect(String(url)).not.toContain(TEST_SUB)
      expect(String((init as RequestInit).body ?? '')).not.toContain(TEST_SUB)
    }
  })

  it('does not call the API without a session and reports unauthenticated', async () => {
    mockSession.mockResolvedValue(null)
    await expect(customerRequest('/api/customer/workspace')).rejects.toMatchObject({ kind: 'unauthenticated' })
    expect(mockFetch).not.toHaveBeenCalled()
  })
})

describe('customerRequest — error handling', () => {
  it.each([
    [401, 'unauthenticated'],
    [403, 'forbidden'],
    [404, 'not_found'],
    [409, 'bad_request'],
    [422, 'bad_request'],
    [500, 'server'],
    [502, 'unavailable'],
    [503, 'unavailable'],
  ] as const)('maps HTTP %i to %s', async (status, kind) => {
    expect(kindForStatus(status)).toBe(kind)
    mockFetch.mockResolvedValue(jsonResponse(status, { error: 'nope' }))
    await expect(customerRequest('/api/x')).rejects.toMatchObject({ kind, status })
  })

  it('uses the server message when safe, and never echoes token-like text', async () => {
    mockFetch.mockResolvedValue(jsonResponse(403, { error: 'This account is not active.' }))
    await expect(customerRequest('/api/x')).rejects.toThrow('This account is not active.')
    mockFetch.mockResolvedValue(jsonResponse(401, { detail: 'bad token eyJhbGciOiJSUzI1NiJ9.abc' }))
    const err = await failure(customerRequest('/api/x'))
    expect(err.message).not.toMatch(/eyJ/)
    expect(err.kind).toBe('unauthenticated')
  })

  it('reports network failures as retryable', async () => {
    mockFetch.mockRejectedValue(new TypeError('Failed to fetch'))
    const err = await failure(customerRequest('/api/x'))
    expect(err.kind).toBe('network')
    expect(err.retryable).toBe(true)
  })

  it('rejects non-JSON success bodies as invalid_response', async () => {
    mockFetch.mockResolvedValue(new Response('<html>', { status: 200 }))
    await expect(customerRequest('/api/x')).rejects.toMatchObject({ kind: 'invalid_response' })
  })
})

describe('workspace client', () => {
  it('normalises missing collections to empty arrays', async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { ok: true, workspace: { profile: emptyWorkspace().profile, api_keys: [{ id: 'k' }] } }))
    const ws = await fetchCustomerWorkspace()
    expect(ws.api_keys).toHaveLength(1)
    expect(ws.inference_requests).toEqual([])
    expect(ws.gpu_listings).toEqual([])
    expect(ws.profile.user_id).toBe(TEST_SUB)
  })

  it('rejects envelopes without ok=true or without a profile', () => {
    expect(() => normaliseWorkspace({ ok: false })).toThrow(CustomerApiError)
    expect(() => normaliseWorkspace({ ok: true, workspace: {} })).toThrow(CustomerApiError)
    expect(() => normaliseWorkspace(null)).toThrow(CustomerApiError)
  })

  it('requests GET /api/customer/workspace', async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, workspaceEnvelope()))
    await fetchCustomerWorkspace()
    expect(lastRequest().url).toBe('/api/customer/workspace')
    expect(lastRequest().init.method).toBe('GET')
  })
})

describe('service clients', () => {
  it('notifications: clamps paging and passes unread_only', async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { total: 1, unread_count: 1, items: [{ id: 'n1', is_read: 0 }] }))
    const page = await fetchNotifications({ limit: 999, offset: -5, unreadOnly: true })
    expect(lastRequest().url).toBe('/api/notifications?limit=200&offset=0&unread_only=true')
    expect(page.items[0].is_read).toBe(false)
  })

  it('unread count and wallet balance validate their payloads', async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { unread_count: 'x' }))
    await expect(fetchUnreadNotificationCount()).rejects.toMatchObject({ kind: 'invalid_response' })
    mockFetch.mockResolvedValue(jsonResponse(200, { balance: '125.50', currency: 'INR' }))
    await expect(fetchWalletBalance()).resolves.toMatchObject({ balance: 125.5, currency: 'INR' })
  })

  it('inference health: public endpoint, no credentials, availability only when provider configured', async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { status: 'degraded', nvidia_provider: 'missing_api_key' }))
    await expect(fetchInferenceHealth()).resolves.toMatchObject({ inferenceAvailable: false, providerStatus: 'missing_api_key' })
    expect(lastRequest().headers.Authorization).toBeUndefined()
    expect(mockSession).not.toHaveBeenCalled()
    mockFetch.mockResolvedValue(jsonResponse(200, { status: 'ok', nvidia_provider: 'configured' }))
    await expect(fetchInferenceHealth()).resolves.toMatchObject({ inferenceAvailable: true })
  })
})
