/**
 * Read-only clients for the dedicated Inferxe services used by the customer dashboard.
 * (Mutations are added in the stages that build the corresponding pages.)
 *
 * - Notifications & wallet balance: 8002 (`/api/notifications*`, `/api/wallet/balance`)
 * - Inference service health:       8001 (`/api/v1/health`, public)
 * - GPU deployments:                8001 (`/api/v1/gpu/*`)
 */
import { INFERENCE_API_BASE } from '../../../lib/apiConfig'
import { CustomerApiError, customerRequest, defaultMessage, kindForStatus } from './http'
import type {
  InferenceServiceHealth,
  NotificationItem,
  NotificationPage,
  StorageListingResponse,
  WalletBalance,
  WorkspaceBudget,
  WorkspaceFile,
} from './types'

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

/** Largest single demo top-up the wallet service accepts (MAX_DEMO_TOPUP in the notifications router). */
export const MAX_DEMO_TOPUP = 100_000

/**
 * Demo "Add money": credits the signed-in customer's own wallet. No payment is taken; the service only
 * accepts it while WALLET_SELF_RECHARGE_ENABLED is on. One idempotency key per attempt prevents double credits.
 */
export async function addMoneyToWallet(amount: number, idempotencyKey: string): Promise<void> {
  await customerRequest<unknown>('/api/wallet/transactions', {
    method: 'POST',
    body: { amount, idempotency_key: idempotencyKey },
  })
  announceNotificationsChanged()
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
    // 8001 reports nvidia_provider as 'configured', 'demo' (simulated replies) or 'missing_api_key'.
    inferenceAvailable: providerStatus === 'configured' || providerStatus === 'demo',
    simulated: providerStatus === 'demo',
  }
}

/* ── GPU deployments (8001 `/api/v1/gpu/*`, provider adapter framework) ── */

/** A GPU a provider can launch now. Prices come from the provider, never from this client. */
export interface GpuOffering {
  gpu_id: string
  name: string
  provider_id: string
  vram_gb: number
  architecture: string
  hourly_price_inr: number
  pricing_type: 'on_demand' | 'spot'
  region: string
  available_quantity: number
  is_available: boolean
}

export interface GpuDeployment {
  id: string
  name: string
  model_name: string
  gpu_id: string | null
  gpu_model: string
  provider_id: string | null
  provider_instance_id: string | null
  region: string | null
  status: string
  hourly_rate: number
  currency: string
  endpoint_url: string | null
  /** Present only while the instance is running. */
  ssh: { host: string; port: number; username: string | null; command: string } | null
  ssh_key_ids: string[]
  error_message: string | null
  started_at: string | null
  stopped_at: string | null
  created_at: string | null
}

export interface CreateGpuDeploymentPayload {
  name: string
  model_name: string
  gpu_id: string
  provider_id?: string
  ssh_key_ids?: string[]
  /** Same key on a retry returns the same deployment instead of launching a second GPU. */
  idempotency_key: string
}

export async function fetchGpuOfferings(signal?: AbortSignal): Promise<GpuOffering[]> {
  const body = await customerRequest<{ offerings?: GpuOffering[] }>('/api/v1/gpu/offerings', { signal })
  return Array.isArray(body.offerings) ? body.offerings : []
}

export async function fetchGpuDeployments(signal?: AbortSignal): Promise<GpuDeployment[]> {
  const body = await customerRequest<{ deployments?: GpuDeployment[] }>('/api/v1/gpu/deployments', { signal })
  if (!Array.isArray(body.deployments)) {
    throw new CustomerApiError('invalid_response', defaultMessage('invalid_response'))
  }
  return body.deployments
}

export async function createGpuDeployment(payload: CreateGpuDeploymentPayload): Promise<GpuDeployment> {
  return customerRequest<GpuDeployment>('/api/v1/gpu/deployments', { method: 'POST', body: payload })
}

export type GpuDeploymentAction = 'stop' | 'resume' | 'terminate'

export async function runGpuDeploymentAction(id: string, action: GpuDeploymentAction): Promise<GpuDeployment> {
  if (!id) throw new CustomerApiError('bad_request', 'Deployment ID is required.')
  const path = `/api/v1/gpu/deployments/${encodeURIComponent(id)}`
  return action === 'terminate'
    ? customerRequest<GpuDeployment>(path, { method: 'DELETE' })
    : customerRequest<GpuDeployment>(`${path}/${action}`, { method: 'POST' })
}

/* ── Orders & Purchase History (Customer API) ── */

export interface CreateOrderPayload {
  order_number?: string
  item_name: string
  provider_name: string
  duration_minutes?: number
  total_cost?: number
  currency?: string
  status?: 'running' | 'completed' | 'cancelled' | 'archived'
  deployment_id?: string
  details?: Record<string, unknown>
}

export async function createOrder(payload: CreateOrderPayload): Promise<Record<string, unknown> | undefined> {
  const body = await customerRequest<{ ok?: boolean; order?: Record<string, unknown> }>(
    '/api/customer/orders',
    {
      method: 'POST',
      body: payload,
    },
  )
  if (!body?.ok) {
    throw new CustomerApiError('invalid_response', defaultMessage('invalid_response'))
  }
  return body.order
}

export async function updateOrderStatus(
  id: string,
  status: 'running' | 'completed' | 'cancelled' | 'archived',
  details?: Record<string, unknown>,
): Promise<void> {
  if (!id) throw new CustomerApiError('bad_request', 'Order ID is required.')
  const body = await customerRequest<{ ok?: boolean; order?: Record<string, unknown> }>(
    `/api/customer/orders/${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      body: { status, ...(details ? { details } : {}) },
    },
  )
  if (!body?.ok) {
    throw new CustomerApiError('invalid_response', defaultMessage('invalid_response'))
  }
}

/* ── Workspace Storage APIs ── */

export async function fetchStorageFiles(
  folder: string = '/',
  search?: string,
  signal?: AbortSignal,
): Promise<StorageListingResponse> {
  const query: Record<string, string> = { folder }
  if (search && search.trim()) {
    query.search = search.trim()
  }

  const body = await customerRequest<StorageListingResponse>('/api/customer/storage/files', {
    query,
    signal,
  })

  if (!body || !body.ok || !Array.isArray(body.items)) {
    throw new CustomerApiError('invalid_response', defaultMessage('invalid_response'))
  }

  return body
}

export async function createStorageFolder(
  folderPath: string,
  name: string,
): Promise<WorkspaceFile> {
  const trimmedName = name.trim()
  if (!trimmedName) throw new CustomerApiError('bad_request', 'Folder name is required.')

  const body = await customerRequest<{ ok?: boolean; item?: WorkspaceFile }>('/api/customer/storage/folders', {
    method: 'POST',
    body: { folder_path: folderPath, name: trimmedName },
  })

  if (!body?.ok || !body.item) {
    throw new CustomerApiError('invalid_response', defaultMessage('invalid_response'))
  }

  return body.item
}

export async function uploadStorageFile(
  folderPath: string,
  name: string,
  contentBase64: string,
  mimeType: string = 'application/octet-stream',
): Promise<WorkspaceFile> {
  const trimmedName = name.trim()
  if (!trimmedName) throw new CustomerApiError('bad_request', 'File name is required.')
  if (!contentBase64) throw new CustomerApiError('bad_request', 'File content is empty.')

  const body = await customerRequest<{ ok?: boolean; item?: WorkspaceFile }>('/api/customer/storage/upload', {
    method: 'POST',
    body: {
      folder_path: folderPath,
      name: trimmedName,
      content_base64: contentBase64,
      mime_type: mimeType,
    },
  })

  if (!body?.ok || !body.item) {
    throw new CustomerApiError('invalid_response', defaultMessage('invalid_response'))
  }

  return body.item
}

export async function getStorageFileDownloadUrl(
  fileId: string,
): Promise<{ download_url: string; name: string; size_bytes?: number }> {
  if (!fileId) throw new CustomerApiError('bad_request', 'File ID is required.')

  const body = await customerRequest<{ ok?: boolean; download_url?: string; name?: string; size_bytes?: number }>(
    `/api/customer/storage/files/${encodeURIComponent(fileId)}/download`,
  )

  if (!body?.ok || !body.download_url) {
    throw new CustomerApiError('invalid_response', defaultMessage('invalid_response'))
  }

  return {
    download_url: body.download_url,
    name: body.name || 'download',
    size_bytes: body.size_bytes,
  }
}

export async function deleteStorageItem(
  id: string,
): Promise<{ deleted: boolean; id: string }> {
  if (!id) throw new CustomerApiError('bad_request', 'Item ID is required.')

  const body = await customerRequest<{ ok?: boolean; deleted?: boolean; id?: string }>(
    `/api/customer/storage/files/${encodeURIComponent(id)}`,
    {
      method: 'DELETE',
    },
  )

  if (!body?.ok || !body.deleted) {
    throw new CustomerApiError('invalid_response', defaultMessage('invalid_response'))
  }

  return { deleted: true, id }
}


