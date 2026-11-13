/**
 * apiKeyService.ts
 * ================
 * Service layer connecting the Inferxe Dashboard to the PostgreSQL-backed
 * Inference API key management endpoints (/api/v1/api-keys).
 */

import { getSession, decodeJwt } from './authStore'
import {
  INFERENCE_API_BASE,
  formatApiConnectionError,
  getAuthHeaders,
} from './apiConfig'

export interface BackendApiKey {
  id: string
  user_id?: string
  name: string
  key_prefix: string
  environment: 'live' | 'test'
  is_active: boolean
  created_at: string
  last_used_at?: string | null
  revoked_at?: string | null
}

export interface GeneratedApiKeyResponse {
  id: string
  name: string
  key_prefix: string
  api_key: string // Secret token shown only once
  environment: string
  created_at: string
}

// Client-side request filter: only Cognito RS256 ID tokens may reach the inference API.
// Admin HS256 JWTs (from loginAdminBackend) share the same session storage key but are
// rejected by the backend's Cognito JWKS verification. This check is purely for early
// request filtering and user-friendly error handling; the backend remains authoritative.
function isCognitoIdToken(token: string): boolean {
  const claims = decodeJwt(token)
  if (!claims) return false
  const iss = claims.iss as string | undefined
  if (typeof iss !== 'string' || !iss.includes('cognito-idp')) return false
  if (claims.token_use !== 'id') return false
  if (claims.exp && Date.now() / 1000 >= claims.exp - 30) return false
  return true
}

function assertCustomerToken(token: string | undefined): { ok: true } | { ok: false; error: string } {
  if (!token) {
    return { ok: false, error: 'Please sign in with your customer account to access API keys.' }
  }
  if (!isCognitoIdToken(token)) {
    return { ok: false, error: 'Please sign in with your customer account to access API keys.' }
  }
  return { ok: true }
}
/**
 * Fetch all API keys belonging to the authenticated Cognito user.
 */
export async function fetchBackendApiKeys(): Promise<{
  ok: boolean
  keys?: BackendApiKey[]
  error?: string
  unauthorized?: boolean
}> {
  try {
    const session = getSession()
    if (!session?.token) {
      return { ok: false, unauthorized: true, error: 'Please sign in to view your API keys.' }
    }
    const tokenCheck = assertCustomerToken(session.token)
    if (!tokenCheck.ok) {
      return { ok: false, unauthorized: true, error: tokenCheck.error }
    }

    const res = await fetch(`${INFERENCE_API_BASE}/api/v1/api-keys`, {
      method: 'GET',
      headers: getAuthHeaders(),
    })

    if (res.status === 401) {
      return { ok: false, unauthorized: true, error: 'Session expired or unauthenticated.' }
    }

    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      return { ok: false, error: data.detail || 'Failed to fetch API keys from backend.' }
    }

    return { ok: true, keys: data.keys || [] }
  } catch (err) {
    return {
      ok: false,
      error: formatApiConnectionError('Inference API server', INFERENCE_API_BASE),
    }
  }
}

/**
 * Generate a new cryptographically secure customer API key.
 * Stores SHA-256 hash in PostgreSQL; returns raw key ONCE.
 */
export async function createBackendApiKey(
  name: string,
  environment: 'live' | 'test' = 'live'
): Promise<{
  ok: boolean
  data?: GeneratedApiKeyResponse
  error?: string
  unauthorized?: boolean
}> {
  try {
    const session = getSession()
    if (!session?.token) {
      return { ok: false, unauthorized: true, error: 'Please sign in to create an API key.' }
    }
    const tokenCheck = assertCustomerToken(session.token)
    if (!tokenCheck.ok) {
      return { ok: false, unauthorized: true, error: tokenCheck.error }
    }

    const res = await fetch(`${INFERENCE_API_BASE}/api/v1/api-keys`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        name: name.trim() || 'Default Key',
        environment,
      }),
    })

    if (res.status === 401) {
      return { ok: false, unauthorized: true, error: 'Unauthorized: Invalid or expired Cognito token.' }
    }

    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      return { ok: false, error: data.detail || 'Failed to generate API key.' }
    }

    return { ok: true, data }
  } catch (err) {
    return {
      ok: false,
      error: formatApiConnectionError('Inference API server', INFERENCE_API_BASE),
    }
  }
}

/**
 * Revoke an existing customer API key in PostgreSQL.
 */
export async function revokeBackendApiKey(keyId: string): Promise<{
  ok: boolean
  error?: string
  unauthorized?: boolean
}> {
  try {
    const session = getSession()
    if (!session?.token) {
      return { ok: false, unauthorized: true, error: 'Please sign in to revoke an API key.' }
    }
    const tokenCheck = assertCustomerToken(session.token)
    if (!tokenCheck.ok) {
      return { ok: false, unauthorized: true, error: tokenCheck.error }
    }

    const res = await fetch(`${INFERENCE_API_BASE}/api/v1/api-keys/${keyId}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    })

    if (res.status === 401) {
      return { ok: false, unauthorized: true, error: 'Unauthorized: Invalid or expired session.' }
    }

    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      return { ok: false, error: data.detail || 'Failed to revoke API key.' }
    }

    return { ok: true }
  } catch (err) {
    return {
      ok: false,
      error: formatApiConnectionError('Inference API server', INFERENCE_API_BASE),
    }
  }
}

