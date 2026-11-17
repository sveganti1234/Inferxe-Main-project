/**
 * sshKeyService.ts
 * ================
 * Service layer connecting the Inferxe Dashboard and Notebooks module
 * to the PostgreSQL-backed SSH Key Management endpoints (/api/v1/ssh-keys).
 */

import { getSession } from './authStore'
import {
  INFERENCE_API_BASE,
  formatApiConnectionError,
  getAuthHeaders,
} from './apiConfig'

export interface BackendSshKey {
  id: string
  name: string
  public_key: string
  fingerprint: string
  key_type: string
  created_at: string
}

export interface BackendSshKeyListResponse {
  success: boolean
  keys: BackendSshKey[]
}

export interface BackendSshKeyDeleteResponse {
  success: boolean
  message: string
  id: string
}

/**
 * Fetch all SSH public keys belonging to the authenticated customer.
 * Reusable helper exported for both Dashboard and Divya's Notebooks integration.
 */
export async function fetchBackendSshKeys(): Promise<{
  ok: boolean
  keys?: BackendSshKey[]
  error?: string
  unauthorized?: boolean
}> {
  try {
    const session = getSession()
    if (!session?.token) {
      return { ok: false, unauthorized: true, error: 'Please sign in to view your SSH keys.' }
    }

    const res = await fetch(`${INFERENCE_API_BASE}/api/v1/ssh-keys`, {
      method: 'GET',
      headers: getAuthHeaders(),
    })

    if (res.status === 401) {
      return { ok: false, unauthorized: true, error: 'Session expired or unauthenticated.' }
    }

    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      return { ok: false, error: data.detail || 'Failed to fetch SSH keys from backend.' }
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
 * Register a new OpenSSH public key for the authenticated customer.
 * Validates algorithm, minimum key size, and duplicate detection in PostgreSQL.
 * Never transmits user_id (derived strictly from Cognito JWT claims on backend).
 * Never accepts private key material.
 */
export async function createBackendSshKey(
  name: string,
  publicKey: string
): Promise<{
  ok: boolean
  data?: BackendSshKey
  error?: string
  conflict?: boolean
  unauthorized?: boolean
}> {
  try {
    const session = getSession()
    if (!session?.token) {
      return { ok: false, unauthorized: true, error: 'Please sign in to add an SSH key.' }
    }

    const trimmedKey = publicKey.trim()
    if (!trimmedKey) {
      return { ok: false, error: 'SSH public key content cannot be empty.' }
    }

    if (trimmedKey.includes('PRIVATE KEY')) {
      return {
        ok: false,
        error: 'Private keys are strictly forbidden. Please provide your OpenSSH public key (e.g. id_ed25519.pub).',
      }
    }

    const res = await fetch(`${INFERENCE_API_BASE}/api/v1/ssh-keys`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        name: name.trim() || 'Default SSH Key',
        public_key: trimmedKey,
      }),
    })

    if (res.status === 401) {
      return { ok: false, unauthorized: true, error: 'Session expired or unauthenticated.' }
    }

    const data = await res.json().catch(() => ({}))

    if (res.status === 409) {
      return {
        ok: false,
        conflict: true,
        error: data.detail || 'This SSH key is already registered in your account.',
      }
    }

    if (!res.ok) {
      return { ok: false, error: data.detail || 'Failed to register SSH key.' }
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
 * Delete a customer's registered SSH key by ID in PostgreSQL.
 * Enforces customer-level tenant isolation on the backend.
 */
export async function deleteBackendSshKey(keyId: string): Promise<{
  ok: boolean
  error?: string
  notFound?: boolean
  unauthorized?: boolean
}> {
  try {
    const session = getSession()
    if (!session?.token) {
      return { ok: false, unauthorized: true, error: 'Please sign in to delete an SSH key.' }
    }

    const res = await fetch(`${INFERENCE_API_BASE}/api/v1/ssh-keys/${keyId}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    })

    if (res.status === 401) {
      return { ok: false, unauthorized: true, error: 'Session expired or unauthenticated.' }
    }

    const data = await res.json().catch(() => ({}))

    if (res.status === 404) {
      return { ok: false, notFound: true, error: data.detail || 'SSH key not found.' }
    }

    if (!res.ok) {
      return { ok: false, error: data.detail || 'Failed to delete SSH key.' }
    }

    return { ok: true }
  } catch (err) {
    return {
      ok: false,
      error: formatApiConnectionError('Inference API server', INFERENCE_API_BASE),
    }
  }
}

