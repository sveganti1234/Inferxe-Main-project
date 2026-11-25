/**
 * Authenticated HTTP helper for the customer dashboard.
 *
 * - The bearer token always comes from `ensureFreshSession()` (Cognito ID token, refreshed
 *   through Amplify when needed). No user id is ever added to a URL or body: the backend
 *   derives the customer from the verified token.
 * - Failures are normalised into `CustomerApiError` with a stable `kind`, so the UI can show
 *   the right state (sign in again, account inactive, service unavailable, retry...).
 * - Token values are never logged or included in error messages.
 */
import { ensureFreshSession } from '../../../lib/authStore'
import { INFERENCE_API_BASE, NOTIFICATIONS_API_BASE } from '../../../lib/apiConfig'

export type CustomerApiErrorKind =
  | 'unauthenticated' // no session, or the backend rejected the token (401)
  | 'forbidden' // authenticated but not allowed / account inactive (403)
  | 'not_found' // 404
  | 'bad_request' // 400 / 422
  | 'unavailable' // 502 / 503 / 504 — backend dependency down, safe to retry
  | 'server' // other 5xx
  | 'network' // request never reached a server
  | 'invalid_response' // reachable, but the payload was not what the contract promises

export class CustomerApiError extends Error {
  readonly kind: CustomerApiErrorKind
  readonly status: number | null

  constructor(kind: CustomerApiErrorKind, message: string, status: number | null = null) {
    super(message)
    this.name = 'CustomerApiError'
    this.kind = kind
    this.status = status
  }

  /** True when retrying the same request later may succeed. */
  get retryable(): boolean {
    return this.kind === 'unavailable' || this.kind === 'network' || this.kind === 'server'
  }
}

export function kindForStatus(status: number): CustomerApiErrorKind {
  if (status === 401) return 'unauthenticated'
  if (status === 403) return 'forbidden'
  if (status === 404) return 'not_found'
  if (status === 400 || status === 409 || status === 422) return 'bad_request'
  if (status === 502 || status === 503 || status === 504) return 'unavailable'
  return 'server'
}

const DEFAULT_MESSAGES: Record<CustomerApiErrorKind, string> = {
  unauthenticated: 'Your session has expired. Please sign in again.',
  forbidden: 'Your account does not have access to this information.',
  not_found: 'The requested information could not be found.',
  bad_request: 'The request could not be processed.',
  unavailable: 'This service is temporarily unavailable. Please try again shortly.',
  server: 'Something went wrong on our side. Please try again.',
  network: 'Unable to reach Inferxe services. Check your connection and try again.',
  invalid_response: 'The service returned an unexpected response.',
}

export function defaultMessage(kind: CustomerApiErrorKind): string {
  return DEFAULT_MESSAGES[kind]
}

/** Extract a short, server-provided message without echoing anything token-like. */
function serverMessage(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null
  const record = body as Record<string, unknown>
  let candidate = record.error ?? record.detail ?? record.message
  // FastAPI can return a structured detail, e.g. { message, deployment } when GPU provisioning fails.
  if (candidate && typeof candidate === 'object') candidate = (candidate as Record<string, unknown>).message
  if (typeof candidate !== 'string') return null
  const text = candidate.trim()
  if (!text || text.length > 240 || /eyJ[A-Za-z0-9_-]{10,}/.test(text)) return null
  return text
}

export interface CustomerRequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  query?: Record<string, string | number | boolean | undefined>
  body?: unknown
  signal?: AbortSignal
}

/**
 * Same-origin by default. The notifications and wallet services (8002) honour the existing
 * VITE_NOTIFICATIONS_API_ENDPOINT override, exactly like the legacy services do; the inference service
 * (8001, `/api/v1/*`) honours VITE_INFERENCE_API_ENDPOINT. `/api/customer/*` has no override: it must be
 * served from the same origin as the app.
 */
export function resolveApiPath(path: string): string {
  const onNotificationsService = path.startsWith('/api/notifications') || path.startsWith('/api/wallet')
  if (onNotificationsService && NOTIFICATIONS_API_BASE) return `${NOTIFICATIONS_API_BASE}${path}`
  if (path.startsWith('/api/v1/') && INFERENCE_API_BASE) return `${INFERENCE_API_BASE}${path}`
  return path
}

function buildUrl(path: string, query?: CustomerRequestOptions['query']): string {
  path = resolveApiPath(path)
  if (!query) return path
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue
    params.set(key, String(value))
  }
  const qs = params.toString()
  return qs ? `${path}?${qs}` : path
}

/**
 * Perform an authenticated JSON request against a same-origin Inferxe API path
 * (proxied by Vite / the hosting layer). Resolves with the parsed JSON body.
 */
export async function customerRequest<T>(path: string, options: CustomerRequestOptions = {}): Promise<T> {
  const session = await ensureFreshSession()
  const token = session?.token?.trim()
  if (!token) {
    throw new CustomerApiError('unauthenticated', defaultMessage('unauthenticated'))
  }

  const headers: Record<string, string> = {
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
  }
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'

  let response: Response
  try {
    response = await fetch(buildUrl(path, options.query), {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    })
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') throw err
    throw new CustomerApiError('network', defaultMessage('network'))
  }

  let body: unknown = null
  const text = await response.text().catch(() => '')
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = null
    }
  }

  if (!response.ok) {
    const kind = kindForStatus(response.status)
    throw new CustomerApiError(kind, serverMessage(body) ?? defaultMessage(kind), response.status)
  }
  if (body === null) {
    throw new CustomerApiError('invalid_response', defaultMessage('invalid_response'), response.status)
  }
  return body as T
}
