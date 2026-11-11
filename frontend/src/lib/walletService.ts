/**
 * walletService.ts
 * ===============
 * Service layer connecting the Inferxe Dashboard to the PostgreSQL-backed
 * wallet endpoints (/api/wallet/*) on the Notifications API server.
 * All requests carry the authenticated Cognito JWT as a Bearer token;
 * the backend derives user_id strictly from the JWT 'sub' claim.
 */

import { getSession } from './authStore'

const NOTIFICATIONS_API_BASE =
  (import.meta.env.VITE_NOTIFICATIONS_API_ENDPOINT as string | undefined)?.replace(/\/$/, '') ||
  ''

export interface WalletBalance {
  user_id: string
  balance: number
  currency: string
  low_balance_alert_level: string
  updated_at: string | null
}

export interface WalletTransactionResult {
  status: string
  transaction_id: string
  amount: number
  new_balance: number
}

/**
 * Validates that the token looks like a real JWT (three base64url parts).
 * Demo tokens (e.g. 'ix-demo-...', 'ix-tok-...') are rejected before any
 * request reaches the backend, preventing unnecessary 401 errors.
 */
function isValidJwtFormat(token: string): boolean {
  if (!token || typeof token !== 'string') return false
  const parts = token.split('.')
  return parts.length === 3 && parts.every((p) => p.length > 0)
}

function getAuthHeaders(): HeadersInit {
  const session = getSession()
  const token = session?.token || ''
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

/**
 * Returns a standardized unauthorized response when the session token is
 * not a valid Cognito JWT.
 */
function demoTokenError(): {
  ok: false
  unauthorized: true
  error: string
} {
  return {
    ok: false,
    unauthorized: true,
    error:
      'Your session is not a valid Cognito identity. Please sign out and sign in again via AWS Cognito to access wallet features.',
  }
}

/**
 * Fetch the authenticated customer's wallet balance from the backend.
 * Backend derives user_id from the Cognito JWT 'sub' claim; the frontend
 * never sends user_id.
 */
export async function fetchWalletBalance(): Promise<{
  ok: boolean
  balance?: WalletBalance
  error?: string
  unauthorized?: boolean
}> {
  try {
    const session = getSession()
    if (!session?.token) {
      return { ok: false, unauthorized: true, error: 'Please sign in to view your wallet balance.' }
    }

    if (!isValidJwtFormat(session.token)) {
      return demoTokenError()
    }

    const res = await fetch(`${NOTIFICATIONS_API_BASE}/api/wallet/balance`, {
      method: 'GET',
      headers: getAuthHeaders(),
    })

    if (res.status === 401) {
      return { ok: false, unauthorized: true, error: 'Session expired or unauthenticated.' }
    }

    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      return { ok: false, error: data.detail || 'Failed to fetch wallet balance from backend.' }
    }

    return { ok: true, balance: data as WalletBalance }
  } catch (err) {
    return {
      ok: false,
      error:
        'Notifications API server is unreachable. Please ensure the backend is running.',
    }
  }
}

/**
 * Top up the authenticated customer's wallet via the backend.
 * Persists to Supabase wallets/wallet_transactions with user-scoped isolation
 * and idempotency. Never sends user_id; backend derives it from the JWT.
 */
export async function topUpWallet(
  amount: number,
  idempotencyKey?: string,
  description?: string
): Promise<{
  ok: boolean
  result?: WalletTransactionResult
  error?: string
  unauthorized?: boolean
}> {
  try {
    const session = getSession()
    if (!session?.token) {
      return { ok: false, unauthorized: true, error: 'Please sign in to top up your wallet.' }
    }

    if (!isValidJwtFormat(session.token)) {
      return demoTokenError()
    }

    if (!amount || !Number.isFinite(amount) || amount <= 0) {
      return { ok: false, error: 'Top-up amount must be greater than zero.' }
    }

    const idemKey =
      idempotencyKey || `wallet_topup_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`

    const res = await fetch(`${NOTIFICATIONS_API_BASE}/api/wallet/transactions`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        amount,
        idempotency_key: idemKey,
        description: description || 'Wallet top-up (Demo)',
      }),
    })

    if (res.status === 401) {
      return { ok: false, unauthorized: true, error: 'Session expired or unauthenticated.' }
    }

    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      return { ok: false, error: data.detail || 'Failed to top up wallet.' }
    }

    return { ok: true, result: data as WalletTransactionResult }
  } catch (err) {
    return {
      ok: false,
      error:
        'Notifications API server is unreachable. Please ensure the backend is running.',
    }
  }
}
