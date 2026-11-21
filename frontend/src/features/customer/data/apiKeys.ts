/**
 * Console adapter over the existing `lib/apiKeyService` (8001 `/api/v1/api-keys`).
 *
 * The service returns `{ ok, unauthorized?, error? }`; this adapter turns failures into
 * `CustomerApiError` so pages share the same error handling. The raw secret returned on
 * creation is passed straight to the caller and is never logged, cached or persisted here.
 */
import {
  createBackendApiKey,
  fetchBackendApiKeys,
  revokeBackendApiKey,
  type BackendApiKey,
} from '../../../lib/apiKeyService'
import { CustomerApiError } from './http'

export type ApiKeyEnvironment = 'live' | 'test'

export interface ApiKeyView {
  id: string
  name: string
  prefix: string
  environment: ApiKeyEnvironment
  active: boolean
  createdAt: string | null
  lastUsedAt: string | null
  revokedAt: string | null
}

export const API_KEY_NAME_MAX = 100

function messageOf(error: unknown, fallback: string): string {
  if (typeof error === 'string' && error.trim()) return error.trim()
  if (Array.isArray(error)) {
    const first = error[0] as { msg?: unknown } | undefined
    if (first && typeof first.msg === 'string') return first.msg
  }
  return fallback
}

function toError(result: { unauthorized?: boolean; error?: unknown }, fallback: string): CustomerApiError {
  const message = messageOf(result.error, fallback)
  if (result.unauthorized) return new CustomerApiError('unauthenticated', message, 401)
  if (/unreachable/i.test(message)) return new CustomerApiError('unavailable', message)
  return new CustomerApiError('server', message)
}

export function toApiKeyView(key: BackendApiKey): ApiKeyView {
  const environment: ApiKeyEnvironment =
    key.environment === 'test' || key.key_prefix?.startsWith('inf_test_') ? 'test' : 'live'
  return {
    id: key.id,
    name: key.name,
    prefix: key.key_prefix ?? '',
    environment,
    active: Boolean(key.is_active) && !key.revoked_at,
    createdAt: key.created_at ?? null,
    lastUsedAt: key.last_used_at ?? null,
    revokedAt: key.revoked_at ?? null,
  }
}

/** Active keys first, then newest first. */
export function sortApiKeys(keys: ApiKeyView[]): ApiKeyView[] {
  return [...keys].sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1
    return (Date.parse(b.createdAt ?? '') || 0) - (Date.parse(a.createdAt ?? '') || 0)
  })
}

export async function listApiKeys(): Promise<ApiKeyView[]> {
  const result = await fetchBackendApiKeys()
  if (!result.ok) throw toError(result, 'Your API keys could not be loaded.')
  return sortApiKeys((result.keys ?? []).map(toApiKeyView))
}

export async function createApiKey(
  name: string,
  environment: ApiKeyEnvironment,
): Promise<{ key: ApiKeyView; secret: string }> {
  const trimmed = name.trim()
  if (!trimmed || trimmed.length > API_KEY_NAME_MAX) {
    throw new CustomerApiError('bad_request', `Key name must be between 1 and ${API_KEY_NAME_MAX} characters.`)
  }
  const result = await createBackendApiKey(trimmed, environment)
  if (!result.ok || !result.data?.api_key) throw toError(result, 'The API key could not be created.')
  const { api_key: secret, ...rest } = result.data
  return {
    secret,
    key: toApiKeyView({
      id: rest.id,
      name: rest.name,
      key_prefix: rest.key_prefix,
      environment: rest.environment === 'test' ? 'test' : 'live',
      is_active: true,
      created_at: rest.created_at,
      last_used_at: null,
      revoked_at: null,
    }),
  }
}

export async function revokeApiKey(id: string): Promise<void> {
  const result = await revokeBackendApiKey(id)
  if (!result.ok) throw toError(result, 'The API key could not be revoked.')
}
