/**
 * walletService.ts
 * ===============
 * Service layer connecting the Inferxe Dashboard to the PostgreSQL-backed
 * wallet endpoints (/api/wallet/*) on the Notifications API server.
 * All requests carry the authenticated Cognito JWT as a Bearer token;
 * the backend derives user_id strictly from the JWT 'sub' claim.
 */

import { getSession, ensureFreshSession } from './authStore'
import { apiErrorDetail } from './apiConfig'

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

export interface WalletTransaction {
  id: string
  type: string
  direction: string
  amount: number
  currency: string
  status: string
  description: string
  balance_after: number | null
  created_at: string
}

export interface WalletTransactionHistory {
  user_id: string
  transactions: WalletTransaction[]
  count: number
  limit: number
  offset: number
}

export interface WalletRefundRequest {
  original_transaction_id: string
  amount: number
  description?: string
  idempotency_key?: string
}

export interface WalletRefundResult {
  status: string
  transaction_id: string
  amount: number
  new_balance: number
  original_transaction_id: string
}

/**
 * Validates that the token looks like a real JWT (three base64url parts)
 * and is not a demo bypass token. Demo tokens (e.g. 'ix-demo-...',
 * 'ix-tok-...') are rejected before any request reaches the backend,
 * preventing unnecessary 401 errors and silent localStorage fallback.
 */
function isValidJwtFormat(token: string): boolean {
  if (!token || typeof token !== 'string') return false
  const parts = token.split('.')
  if (parts.length !== 3 || !parts.every((p) => p.length > 0)) return false
  const firstPart = parts[0]
  return !firstPart.startsWith('ix-demo') && !firstPart.startsWith('ix-tok')
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
    const session = await ensureFreshSession()
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
      return { ok: false, error: apiErrorDetail(data, 'Failed to fetch wallet balance from backend.') }
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
  /** HTTP status when the backend answered; undefined for network failures. */
  status?: number
}> {
  try {
    const session = await ensureFreshSession()
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
      return { ok: false, unauthorized: true, status: 401, error: 'Session expired or unauthenticated.' }
    }

    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      const detail = typeof data.detail === 'string' ? data.detail : ''
      let error: string
      if (res.status === 403) {
        // Self-service top-ups are disabled until a payment gateway verifies payments.
        error = detail || 'Wallet top-ups are not available for self-service yet.'
      } else if (res.status === 400) {
        error = detail || 'The top-up amount was rejected.'
      } else if (res.status >= 500) {
        error = 'The wallet service had a problem processing your top-up. Please try again later.'
      } else {
        error = detail || 'Failed to top up wallet.'
      }
      return { ok: false, status: res.status, error }
    }

    try {
      window.dispatchEvent(new CustomEvent('inferxe_notifications_change'))
    } catch {}

    return { ok: true, status: res.status, result: data as WalletTransactionResult }
  } catch (err) {
    return {
      ok: false,
      error:
        'Notifications API server is unreachable. Please ensure the backend is running.',
    }
  }
}

/**
 * Fetch the authenticated customer's wallet transaction history from the backend.
 * Backend derives user_id from the Cognito JWT 'sub' claim; the frontend
 * never sends user_id. Supports pagination via limit/offset.
 */
export async function fetchWalletTransactionHistory(
  limit: number = 50,
  offset: number = 0,
): Promise<{
  ok: boolean
  history?: WalletTransactionHistory
  error?: string
  unauthorized?: boolean
}> {
  try {
    const session = getSession()
    if (!session?.token) {
      return { ok: false, unauthorized: true, error: 'Please sign in to view transaction history.' }
    }

    if (!isValidJwtFormat(session.token)) {
      return demoTokenError()
    }

    const res = await fetch(
      `${NOTIFICATIONS_API_BASE}/api/wallet/transactions/history?limit=${limit}&offset=${offset}`,
      {
        method: 'GET',
        headers: getAuthHeaders(),
      },
    )

    if (res.status === 401) {
      return { ok: false, unauthorized: true, error: 'Session expired or unauthenticated.' }
    }

    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      return { ok: false, error: apiErrorDetail(data, 'Failed to fetch transaction history from backend.') }
    }

    return { ok: true, history: data as WalletTransactionHistory }
  } catch (err) {
    return {
      ok: false,
      error:
        'Notifications API server is unreachable. Please ensure the backend is running.',
    }
  }
}

/**
 * Refund a prior wallet debit for the authenticated customer.
 * Backend derives user_id from the Cognito JWT 'sub' claim; the frontend
 * never sends user_id. The frontend supplies original_transaction_id,
 * amount, optional description and idempotency_key.
 */
export async function refundWallet(
  original_transaction_id: string,
  amount: number,
  description?: string,
  idempotency_key?: string,
): Promise<{
  ok: boolean
  result?: WalletRefundResult
  error?: string
  unauthorized?: boolean
}> {
  try {
    const session = getSession()
    if (!session?.token) {
      return { ok: false, unauthorized: true, error: 'Please sign in to request a wallet refund.' }
    }

    if (!isValidJwtFormat(session.token)) {
      return demoTokenError()
    }

    if (!amount || !Number.isFinite(amount) || amount <= 0) {
      return { ok: false, error: 'Refund amount must be greater than zero.' }
    }

    const idemKey =
      idempotency_key || `wallet_refund_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`

    const res = await fetch(`${NOTIFICATIONS_API_BASE}/api/wallet/refund`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        original_transaction_id,
        amount,
        description: description || 'Wallet refund',
        idempotency_key: idemKey,
      }),
    })

    if (res.status === 401) {
      return { ok: false, unauthorized: true, error: 'Session expired or unauthenticated.' }
    }

    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      return { ok: false, error: apiErrorDetail(data, 'Failed to process wallet refund.') }
    }

    return { ok: true, result: data as WalletRefundResult }
  } catch (err) {
    return {
      ok: false,
      error:
        'Notifications API server is unreachable. Please ensure the backend is running.',
    }
  }
}
