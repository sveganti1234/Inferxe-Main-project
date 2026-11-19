/**
 * Read-only clients for the dedicated Inferxe services used by the customer dashboard.
 * (Mutations are added in the stages that build the corresponding pages.)
 *
 * - Notifications & wallet balance: 8002 (`/api/notifications*`, `/api/wallet/balance`)
 * - Inference service health:       8001 (`/api/v1/health`, public)
 */
import { INFERENCE_API_BASE } from '../../../lib/apiConfig'
import { CustomerApiError, customerRequest, defaultMessage, kindForStatus } from './http'
import type { InferenceServiceHealth, NotificationItem, NotificationPage, WalletBalance, WorkspaceBudget } from './types'

const toNumber = (value: unknown): number | null => {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(n) ? n : null
}

/* ── Notifications (8002) ── */

export async function fetchUnreadNotificationCount(signal?: AbortSignal): Promise<number> {
  const body = await customerRequest<{ unread_count?: unknown }>('/api/notifications/unread-count', { signal })
  const count = toNumber(body?.unread_count)
  if (count === null || count < 0) throw new CustomerApiError('invalid_response', defaultMessage('invalid_response'))
  return count
}

export async function fetchNotifications(
  params: { limit?: number; offset?: number; unreadOnly?: boolean } = {},
  signal?: AbortSignal,
): Promise<NotificationPage> {
  const body = await customerRequest<Partial<NotificationPage>>('/api/notifications', {
    query: {
      limit: Math.min(Math.max(params.limit ?? 20, 1), 200),
      offset: Math.max(params.offset ?? 0, 0),
      unread_only: params.unreadOnly ? true : undefined,
    },
    signal,
  })
  if (!body || !Array.isArray(body.items)) {
    throw new CustomerApiError('invalid_response', defaultMessage('invalid_response'))
  }
  const items: NotificationItem[] = body.items.map((item) => ({ ...item, is_read: Boolean(item.is_read) }))
  return {
    total: toNumber(body.total) ?? items.length,
    unread_count: toNumber(body.unread_count) ?? items.filter((i) => !i.is_read).length,
    items,
  }
}

/** Tell the shell (topbar unread count) that notification state changed. */
export function announceNotificationsChanged(): void {
  window.dispatchEvent(new Event('inferxe_notifications_change'))
}

/** PATCH /api/notifications/{id}/read — the backend rejects other users' notifications (403). */
export async function markNotificationRead(id: string): Promise<void> {
  await customerRequest<unknown>(`/api/notifications/${encodeURIComponent(id)}/read`, { method: 'PATCH' })
}

/** PATCH /api/notifications/read-all — marks every unread notification of the signed-in customer. */
export async function markAllNotificationsRead(): Promise<number> {
  const body = await customerRequest<{ updated_count?: unknown }>('/api/notifications/read-all', { method: 'PATCH' })
  return toNumber(body?.updated_count) ?? 0
}

/** DELETE /api/notifications/{id} — the backend rejects other users' notifications (403). */
export async function deleteNotification(id: string): Promise<void> {
  await customerRequest<unknown>(`/api/notifications/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

/* ── Profile (Node customer API) ── */

export const DISPLAY_NAME_MAX = 150

/** PATCH /api/customer/profile — updates the signed-in customer's display name only. */
export async function updateDisplayName(fullName: string): Promise<string> {
  const name = fullName.trim()
  if (!name || name.length > DISPLAY_NAME_MAX) {
    throw new CustomerApiError('bad_request', `Display name must be between 1 and ${DISPLAY_NAME_MAX} characters.`)
  }
  const body = await customerRequest<{ ok?: boolean; profile?: { full_name?: unknown } }>('/api/customer/profile', {
    method: 'PATCH',
    body: { full_name: name },
  })
  if (!body?.ok || typeof body.profile?.full_name !== 'string') {
    throw new CustomerApiError('invalid_response', defaultMessage('invalid_response'))
  }
  return body.profile.full_name
}

/* ── Saved GPU listings (Node customer API) ── */

/** POST /api/customer/saved-listings — saves a listing for the signed-in customer (idempotent). */
export async function saveGpuListing(listingId: string): Promise<void> {
  if (!listingId) throw new CustomerApiError('bad_request', 'A listing is required.')
  await customerRequest<unknown>('/api/customer/saved-listings', { method: 'POST', body: { listing_id: listingId } })
}

/** DELETE /api/customer/saved-listings/{listingId} — removes the customer's own saved listing. */
export async function unsaveGpuListing(listingId: string): Promise<void> {
  if (!listingId) throw new CustomerApiError('bad_request', 'A listing is required.')
  await customerRequest<unknown>(`/api/customer/saved-listings/${encodeURIComponent(listingId)}`, { method: 'DELETE' })
}

/* ── Wallet balance (8002, table `wallets`) ── */

export async function fetchWalletBalance(signal?: AbortSignal): Promise<WalletBalance> {
  const body = await customerRequest<Record<string, unknown>>('/api/wallet/balance', { signal })
  const balance = toNumber(body?.balance)
  if (balance === null) throw new CustomerApiError('invalid_response', defaultMessage('invalid_response'))
  return {
    balance,
    currency: typeof body.currency === 'string' && body.currency ? body.currency : 'INR',
    lowBalanceAlertLevel: typeof body.low_balance_alert_level === 'string' ? body.low_balance_alert_level : null,
    updatedAt: typeof body.updated_at === 'string' ? body.updated_at : null,
  }
}

/* ── Monthly budget (8002) ── */

/** Only a budget the customer saved is returned; the service reports `budget_configured: false` otherwise. */
export async function fetchWorkspaceBudget(signal?: AbortSignal): Promise<WorkspaceBudget> {
  const body = await customerRequest<Record<string, unknown>>('/api/workspace/settings', { signal })
  const configured = body?.budget_configured === true
  return { monthlyBudget: configured ? toNumber(body?.monthly_budget) : null }
}

/* ── Inference service health (8001, public endpoint — no credentials sent) ── */

export async function fetchInferenceHealth(signal?: AbortSignal): Promise<InferenceServiceHealth> {
  let response: Response
  try {
    response = await fetch(`${INFERENCE_API_BASE}/api/v1/health`, { headers: { Accept: 'application/json' }, signal })
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') throw err
    throw new CustomerApiError('network', defaultMessage('network'))
  }
  if (!response.ok) {
    const kind = kindForStatus(response.status)
    throw new CustomerApiError(kind, defaultMessage(kind), response.status)
  }
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body.status !== 'string') {
    throw new CustomerApiError('invalid_response', defaultMessage('invalid_response'), response.status)
  }
  const providerStatus = typeof body.nvidia_provider === 'string' ? body.nvidia_provider : null
  return {
    status: body.status,
    providerStatus,
    // 8001 reports nvidia_provider as 'configured' or 'missing_api_key'; only the former can serve requests.
    inferenceAvailable: providerStatus === 'configured',
  }
}
