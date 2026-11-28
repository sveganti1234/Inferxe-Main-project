/**
 * Admin Notification Service
 * ==========================
 * Provides real-time backend notification fetching, unread counting, and read state
 * management for the Inferxe Admin Portal using the authenticated administrator HS256 session token.
 */

import { getSession } from './authStore'
import { NOTIFICATIONS_API_BASE } from './apiConfig'
import { formatRelativeTime } from './adminAccountStore'

export interface AdminNotificationItem {
  id: string
  user_id: string
  title: string
  message: string
  notification_type: string
  is_read: boolean
  created_at: string
  read_at?: string | null
  metadata?: Record<string, unknown> | null
  related_entity_id?: string | null
}

export interface AdminNotificationsResponse {
  total: number
  unread_count: number
  items: AdminNotificationItem[]
}

export interface AdminUiNotification {
  id: string
  title: string
  detail: string
  type: string
  time: string
  read: boolean
  raw?: AdminNotificationItem
}

export function toUiNotification(item: AdminNotificationItem): AdminUiNotification {
  return {
    id: item.id,
    title: item.title,
    detail: item.message,
    type: item.notification_type,
    time: formatRelativeTime(item.created_at),
    read: item.is_read,
    raw: item,
  }
}

function getAdminAuthHeaders(): HeadersInit {
  const session = getSession()
  const token = session?.token?.trim() || ''
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

function resolveNotificationUrl(path: string): string {
  const base = NOTIFICATIONS_API_BASE ? NOTIFICATIONS_API_BASE.replace(/\/$/, '') : ''
  return `${base}${path}`
}

/**
 * Fetch notifications for the authenticated administrator.
 */
export async function fetchAdminNotifications(options: {
  unread_only?: boolean
  limit?: number
  offset?: number
  signal?: AbortSignal
} = {}): Promise<{ ok: boolean; data?: AdminNotificationsResponse; error?: string }> {
  const session = getSession()
  if (!session?.token) {
    return { ok: false, error: 'Unauthenticated: No admin session active.' }
  }

  const { unread_only = false, limit = 20, offset = 0, signal } = options
  const query = new URLSearchParams({
    unread_only: String(unread_only),
    limit: String(limit),
    offset: String(offset),
  })

  const url = resolveNotificationUrl(`/api/notifications?${query.toString()}`)

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: getAdminAuthHeaders(),
      signal,
    })

    if (!res.ok) {
      const errBody = await res.json().catch(() => null)
      const detail = errBody?.detail || errBody?.error || `HTTP ${res.status}`
      return { ok: false, error: String(detail) }
    }

    const data: AdminNotificationsResponse = await res.json()
    return { ok: true, data }
  } catch (err) {
    if (signal?.aborted) {
      return { ok: false, error: 'Request aborted' }
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to fetch admin notifications',
    }
  }
}

/**
 * Fetch the real-time unread notification count for the authenticated administrator.
 */
export async function fetchAdminUnreadCount(
  signal?: AbortSignal,
): Promise<{ ok: boolean; unreadCount: number; error?: string }> {
  const session = getSession()
  if (!session?.token) {
    return { ok: false, unreadCount: 0, error: 'Unauthenticated' }
  }

  const url = resolveNotificationUrl('/api/notifications/unread-count')

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: getAdminAuthHeaders(),
      signal,
    })

    if (!res.ok) {
      return { ok: false, unreadCount: 0, error: `HTTP ${res.status}` }
    }

    const data = await res.json()
    const unreadCount = typeof data?.unread_count === 'number' ? data.unread_count : 0
    return { ok: true, unreadCount }
  } catch (err) {
    if (signal?.aborted) {
      return { ok: false, unreadCount: 0, error: 'Request aborted' }
    }
    return {
      ok: false,
      unreadCount: 0,
      error: err instanceof Error ? err.message : 'Failed to fetch unread count',
    }
  }
}

/**
 * Mark a specific notification as read for the authenticated administrator.
 */
export async function markAdminNotificationRead(
  notificationId: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = getSession()
  if (!session?.token) {
    return { ok: false, error: 'Unauthenticated' }
  }

  const url = resolveNotificationUrl(`/api/notifications/${encodeURIComponent(notificationId)}/read`)

  try {
    const res = await fetch(url, {
      method: 'PATCH',
      headers: getAdminAuthHeaders(),
    })

    if (!res.ok) {
      const errBody = await res.json().catch(() => null)
      return { ok: false, error: errBody?.detail || `HTTP ${res.status}` }
    }

    try {
      window.dispatchEvent(new CustomEvent('inferxe_notifications_change'))
    } catch {}

    return { ok: true }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to mark notification as read',
    }
  }
}

/**
 * Mark all notifications as read for the authenticated administrator.
 */
export async function markAllAdminNotificationsRead(): Promise<{
  ok: boolean
  updatedCount?: number
  error?: string
}> {
  const session = getSession()
  if (!session?.token) {
    return { ok: false, error: 'Unauthenticated' }
  }

  const url = resolveNotificationUrl('/api/notifications/read-all')

  try {
    const res = await fetch(url, {
      method: 'PATCH',
      headers: getAdminAuthHeaders(),
    })

    if (!res.ok) {
      const errBody = await res.json().catch(() => null)
      return { ok: false, error: errBody?.detail || `HTTP ${res.status}` }
    }

    const data = await res.json().catch(() => ({}))
    const updatedCount = typeof data?.updated_count === 'number' ? data.updated_count : 0

    try {
      window.dispatchEvent(new CustomEvent('inferxe_notifications_change'))
    } catch {}

    return { ok: true, updatedCount }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to mark all notifications as read',
    }
  }
}

export interface PriceUpdateResponse {
  status: 'success' | 'noop' | 'skipped' | string
  message: string
  old_price?: number
  new_price?: number
  notifications_created?: number
  admin_notifications_created?: number
  event_id?: string
}

/**
 * Update GPU hourly price and trigger audit notifications across admins and affected customers.
 */
export async function updateAdminGpuPrice(
  gpuId: string,
  newPrice: number,
  options: { idempotencyKey?: string; signal?: AbortSignal } = {}
): Promise<{
  ok: boolean
  data?: PriceUpdateResponse
  error?: string
}> {
  const session = getSession()
  if (!session?.token) {
    return { ok: false, error: 'Unauthenticated: No admin session active.' }
  }

  const cleanGpuId = typeof gpuId === 'string' ? gpuId.trim() : ''
  const numericPrice = Number(newPrice)

  if (!cleanGpuId) {
    return { ok: false, error: 'GPU ID is required.' }
  }
  if (isNaN(numericPrice) || numericPrice <= 0) {
    return { ok: false, error: 'New price must be a valid number greater than 0.' }
  }

  const url = resolveNotificationUrl('/api/notifications/price-update')
  const payload: { gpu_id: string; new_price: number; idempotency_key?: string } = {
    gpu_id: cleanGpuId,
    new_price: numericPrice,
  }
  if (options.idempotencyKey) {
    payload.idempotency_key = options.idempotencyKey
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: getAdminAuthHeaders(),
      body: JSON.stringify(payload),
      signal: options.signal,
    })

    if (!res.ok) {
      const errBody = await res.json().catch(() => null)
      const detail = errBody?.detail || errBody?.error || `HTTP ${res.status}`
      return { ok: false, error: String(detail) }
    }

    const data: PriceUpdateResponse = await res.json()

    // Dispatch event so AdminShell notification bell and AdminNotificationsPage refresh
    try {
      window.dispatchEvent(new CustomEvent('inferxe_notifications_change'))
    } catch {}

    return { ok: true, data }
  } catch (err) {
    if (options.signal?.aborted) {
      return { ok: false, error: 'Request aborted' }
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to update GPU price',
    }
  }
}

export interface GpuListingItem {
  id: string
  name: string
  gpu_model: string
  gpu: string
  vram: string
  region: string
  price: number
  quantity: number
  currency: string
  billing_unit: string
  status: string
  updated_at: string
}

export interface GpuListingCreatePayload {
  name: string
  gpu_model?: string
  vram?: string
  region?: string
  price: number
  quantity?: number
  listing_id?: string
  currency?: string
  billing_unit?: string
  idempotency_key?: string
}

export interface GpuListingCreateResponse {
  status: 'success' | 'skipped' | string
  message: string
  listing?: GpuListingItem
  admin_notifications_created?: number
  event_id?: string
  listing_id?: string
}

/**
 * Create a new GPU listing in inventory and trigger an atomic audit notification for administrators.
 */
export async function createAdminGpuListing(
  payload: GpuListingCreatePayload,
  options: { signal?: AbortSignal } = {}
): Promise<{
  ok: boolean
  data?: GpuListingCreateResponse
  error?: string
}> {
  const session = getSession()
  if (!session?.token) {
    return { ok: false, error: 'Unauthenticated: No admin session active.' }
  }

  const cleanName = (payload.name || '').trim()
  const numericPrice = Number(payload.price)
  const numericQuantity = Math.max(1, Number(payload.quantity) || 1)

  if (!cleanName) {
    return { ok: false, error: 'GPU Name / Model is required.' }
  }
  if (isNaN(numericPrice) || numericPrice <= 0) {
    return { ok: false, error: 'Rate per hour must be a valid number greater than 0.' }
  }

  const url = resolveNotificationUrl('/api/notifications/gpu-listing')

  const body: Record<string, unknown> = {
    name: cleanName,
    gpu_model: payload.gpu_model || cleanName.replace('NVIDIA ', '').trim(),
    vram: (payload.vram || '24 GB').trim(),
    region: (payload.region || 'Mumbai, IN').trim(),
    price: numericPrice,
    quantity: numericQuantity,
    currency: payload.currency || 'INR',
    billing_unit: payload.billing_unit || 'hr',
  }

  if (payload.listing_id) {
    body.listing_id = payload.listing_id.trim()
  }
  if (payload.idempotency_key) {
    body.idempotency_key = payload.idempotency_key.trim()
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: getAdminAuthHeaders(),
      body: JSON.stringify(body),
      signal: options.signal,
    })

    if (!res.ok) {
      const errBody = await res.json().catch(() => null)
      const detail = errBody?.detail || errBody?.error || `HTTP ${res.status}`
      return { ok: false, error: String(detail) }
    }

    const data: GpuListingCreateResponse = await res.json()

    // Dispatch event so AdminShell notification bell and AdminNotificationsPage refresh
    try {
      window.dispatchEvent(new CustomEvent('inferxe_notifications_change'))
    } catch {}

    return { ok: true, data }
  } catch (err) {
    if (options.signal?.aborted) {
      return { ok: false, error: 'Request aborted' }
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to create GPU listing',
    }
  }
}


