import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  fetchBackendApiKeys,
  createBackendApiKey,
  revokeBackendApiKey,
} from '../lib/apiKeyService'
import { getSession, decodeJwt } from '../lib/authStore'

vi.mock('../lib/authStore', () => ({
  getSession: vi.fn(),
  decodeJwt: vi.fn(),
}))

const mockGetSession = vi.mocked(getSession)
const mockDecodeJwt = vi.mocked(decodeJwt)
const mockFetch = vi.mocked(globalThis.fetch)

function makeCognitoIdToken() {
  return 'header.eyJpc3MiOiJodHRwczovL2NvZ25pdG8taWRwLmFwLXNvdXRoLTEuYW1hem9uYXdzLmNvbS9hcC1zb3V0aC0xX2N5dzFRamdRRSIsInN1YiI6InVzZXItMTIzIn0.signature'
}

function makeAdminHs256Token() {
  return 'header.eyJpc3MiOiJodHRwczovL2luZmV4ZS1hZG1pbi5sb2NhbCIsInN1YiI6ImFkbWluLTEyMyJ9.signature'
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('apiKeyService — customer token gating', () => {
  describe('fetchBackendApiKeys', () => {
    it('proceeds to fetch when a valid Cognito ID token is present', async () => {
      mockGetSession.mockReturnValue({
        token: makeCognitoIdToken(),
        user: { id: 'user-123', fullName: 'Test User', email: 'test@example.com', username: 'testuser', role: 'customer' },
        expiresAt: Date.now() + 3600000,
      })
      mockDecodeJwt.mockReturnValue({
        iss: 'https://cognito-idp.ap-south-1.amazonaws.com/ap-south-1_cYw1QjgbQ',
        sub: 'user-123',
        token_use: 'id',
        exp: Math.floor(Date.now() / 1000) + 3600,
      })
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ keys: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      )

      const result = await fetchBackendApiKeys()

      expect(result.ok).toBe(true)
      expect(result.unauthorized).toBeUndefined()
      expect(mockFetch).toHaveBeenCalledTimes(1)
      expect(mockFetch.mock.calls[0]![1]!.headers).toMatchObject({ Authorization: expect.stringContaining('Bearer ') })
    })

    it('rejects admin HS256 JWT without sending a request', async () => {
      mockGetSession.mockReturnValue({
        token: makeAdminHs256Token(),
        user: { id: 'admin-123', fullName: 'Admin User', email: 'admin@example.com', username: 'admin', role: 'admin' },
        expiresAt: Date.now() + 3600000,
      })
      mockDecodeJwt.mockReturnValue({
        iss: 'https://inferxe-admin.local',
        sub: 'admin-123',
      })

      const result = await fetchBackendApiKeys()

      expect(result.ok).toBe(false)
      expect(result.unauthorized).toBe(true)
      expect(result.error).toBe('Please sign in with your customer account to access API keys.')
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('rejects missing token', async () => {
      mockGetSession.mockReturnValue(null)

      const result = await fetchBackendApiKeys()

      expect(result.ok).toBe(false)
      expect(result.unauthorized).toBe(true)
      expect(result.error).toBe('Please sign in to view your API keys.')
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('rejects invalid JWT structure (not 3 parts)', async () => {
      mockGetSession.mockReturnValue({
        token: 'not-a-jwt',
        user: { id: 'user-123', fullName: 'Test User', email: 'test@example.com', username: 'testuser', role: 'customer' },
        expiresAt: Date.now() + 3600000,
      })
      mockDecodeJwt.mockReturnValue(null)

      const result = await fetchBackendApiKeys()

      expect(result.ok).toBe(false)
      expect(result.unauthorized).toBe(true)
      expect(result.error).toBe('Please sign in with your customer account to access API keys.')
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('rejects token without cognito-idp issuer', async () => {
      mockGetSession.mockReturnValue({
        token: makeAdminHs256Token(),
        user: { id: 'user-123', fullName: 'Test User', email: 'test@example.com', username: 'testuser', role: 'customer' },
        expiresAt: Date.now() + 3600000,
      })
      mockDecodeJwt.mockReturnValue({
        iss: 'https://some-other-auth-provider.example.com',
        sub: 'user-123',
      })

      const result = await fetchBackendApiKeys()

      expect(result.ok).toBe(false)
      expect(result.unauthorized).toBe(true)
      expect(result.error).toBe('Please sign in with your customer account to access API keys.')
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('rejects token with non-id token_use', async () => {
      mockGetSession.mockReturnValue({
        token: makeCognitoIdToken(),
        user: { id: 'user-123', fullName: 'Test User', email: 'test@example.com', username: 'testuser', role: 'customer' },
        expiresAt: Date.now() + 3600000,
      })
      mockDecodeJwt.mockReturnValue({
        iss: 'https://cognito-idp.ap-south-1.amazonaws.com/ap-south-1_cYw1QjgbQ',
        sub: 'user-123',
        token_use: 'access',
      })

      const result = await fetchBackendApiKeys()

      expect(result.ok).toBe(false)
      expect(result.unauthorized).toBe(true)
      expect(result.error).toBe('Please sign in with your customer account to access API keys.')
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('rejects expired Cognito token', async () => {
      mockGetSession.mockReturnValue({
        token: makeCognitoIdToken(),
        user: { id: 'user-123', fullName: 'Test User', email: 'test@example.com', username: 'testuser', role: 'customer' },
        expiresAt: Date.now() + 3600000,
      })
      mockDecodeJwt.mockReturnValue({
        iss: 'https://cognito-idp.ap-south-1.amazonaws.com/ap-south-1_cYw1QjgbQ',
        sub: 'user-123',
        token_use: 'id',
        exp: Math.floor(Date.now() / 1000) - 3600,
      })

      const result = await fetchBackendApiKeys()

      expect(result.ok).toBe(false)
      expect(result.unauthorized).toBe(true)
      expect(result.error).toBe('Please sign in with your customer account to access API keys.')
      expect(mockFetch).not.toHaveBeenCalled()
    })
  })

  describe('createBackendApiKey', () => {
    it('rejects admin HS256 JWT without sending a request', async () => {
      mockGetSession.mockReturnValue({
        token: makeAdminHs256Token(),
        user: { id: 'admin-123', fullName: 'Admin User', email: 'admin@example.com', username: 'admin', role: 'admin' },
        expiresAt: Date.now() + 3600000,
      })
      mockDecodeJwt.mockReturnValue({
        iss: 'https://inferxe-admin.local',
        sub: 'admin-123',
      })

      const result = await createBackendApiKey('Test Key')

      expect(result.ok).toBe(false)
      expect(result.unauthorized).toBe(true)
      expect(result.error).toBe('Please sign in with your customer account to access API keys.')
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('proceeds to fetch when a valid Cognito ID token is present', async () => {
      mockGetSession.mockReturnValue({
        token: makeCognitoIdToken(),
        user: { id: 'user-123', fullName: 'Test User', email: 'test@example.com', username: 'testuser', role: 'customer' },
        expiresAt: Date.now() + 3600000,
      })
      mockDecodeJwt.mockReturnValue({
        iss: 'https://cognito-idp.ap-south-1.amazonaws.com/ap-south-1_cYw1QjgbQ',
        sub: 'user-123',
        token_use: 'id',
        exp: Math.floor(Date.now() / 1000) + 3600,
      })
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'key-1', name: 'Test Key', key_prefix: 'inf_live_ab12', api_key: 'inf_live_xyz', environment: 'live', created_at: '2026-01-01T00:00:00Z' }), { status: 201, headers: { 'Content-Type': 'application/json' } })
      )

      const result = await createBackendApiKey('Test Key')

      expect(result.ok).toBe(true)
      expect(result.unauthorized).toBeUndefined()
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })
  })

  describe('revokeBackendApiKey', () => {
    it('rejects admin HS256 JWT without sending a request', async () => {
      mockGetSession.mockReturnValue({
        token: makeAdminHs256Token(),
        user: { id: 'admin-123', fullName: 'Admin User', email: 'admin@example.com', username: 'admin', role: 'admin' },
        expiresAt: Date.now() + 3600000,
      })
      mockDecodeJwt.mockReturnValue({
        iss: 'https://inferxe-admin.local',
        sub: 'admin-123',
      })

      const result = await revokeBackendApiKey('key-1')

      expect(result.ok).toBe(false)
      expect(result.unauthorized).toBe(true)
      expect(result.error).toBe('Please sign in with your customer account to access API keys.')
      expect(mockFetch).not.toHaveBeenCalled()
    })
  })
})
