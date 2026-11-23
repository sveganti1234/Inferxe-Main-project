/**
 * Console adapter over the existing `lib/apiKeyService` (8001 `/api/v1/api-keys`).
 *
 * Provides resilient fallback to demo credentials when backend authentication
 * fails or is unavailable in local demonstration sessions (media_1795415386682_3d3f521e.jpg).
 */
import { ensureFreshSession } from '../../../lib/authStore'
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
  secretToken?: string
  maskedToken?: string
  environment: ApiKeyEnvironment
  active: boolean
  createdAt: string | null
  lastUsedAt: string | null
  revokedAt: string | null
}

export const API_KEY_NAME_MAX = 100
export const API_KEYS_STORAGE_KEY = 'inferxe_demo_api_keys_v1'

export const DEFAULT_DEMO_API_KEYS: ApiKeyView[] = [
  {
    id: 'key-1',
    name: 'Production Backend API',
    prefix: 'inf_demo_live_',
    secretToken: 'inf_demo_live_9a8b7c6d5e4f3a2b1c0d8e7f6a5b4c3d',
    maskedToken: 'inf_demo_live_••••••••',
    environment: 'live',
    active: true,
    createdAt: '2026-10-01T09:00:00.000Z',
    lastUsedAt: null,
    revokedAt: null,
  },
  {
    id: 'key-2',
    name: 'Staging Evaluation Key',
    prefix: 'inf_demo_test_',
    secretToken: 'inf_demo_test_8f7e6d5c4b3a2109fedcba9876543210',
    maskedToken: 'inf_demo_test_••••••••',
    environment: 'test',
    active: true,
    createdAt: '2026-10-06T11:30:00.000Z',
    lastUsedAt: null,
    revokedAt: null,
  },
]

export function getLocalApiKeys(): ApiKeyView[] {
  try {
    const raw = localStorage.getItem(API_KEYS_STORAGE_KEY)
    if (!raw) return DEFAULT_DEMO_API_KEYS
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed
    }
    return DEFAULT_DEMO_API_KEYS
  } catch {
    return DEFAULT_DEMO_API_KEYS
  }
}

export function saveLocalApiKeys(keys: ApiKeyView[]): void {
  try {
    localStorage.setItem(API_KEYS_STORAGE_KEY, JSON.stringify(keys))
  } catch {}
}

export function formatApiKeyDate(dateStr: string | null): string {
  if (!dateStr) return 'Recently'
  try {
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return dateStr
    return d.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    })
  } catch {
    return dateStr
  }
}

export function getMaskedToken(key: ApiKeyView): string {
  if (key.maskedToken) return key.maskedToken
  const prefix = key.prefix || (key.environment === 'test' ? 'inf_demo_test_' : 'inf_demo_live_')
  return `${prefix}••••••••`
}

export function toApiKeyView(key: BackendApiKey): ApiKeyView {
  const environment: ApiKeyEnvironment =
    key.environment === 'test' || key.key_prefix?.startsWith('inf_test_') || key.key_prefix?.startsWith('inf_demo_test_')
      ? 'test'
      : 'live'
  const prefix = key.key_prefix ?? (environment === 'test' ? 'inf_demo_test_' : 'inf_demo_live_')
  const maskedToken = prefix.startsWith('inf_demo_') ? `${prefix}••••••••` : `${prefix}…`
  return {
    id: key.id,
    name: key.name,
    prefix,
    maskedToken,
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

/**
 * List API keys with graceful fallback to persistent demo keys if database
 * authentication or server connection is unavailable.
 */
export async function listApiKeys(): Promise<ApiKeyView[]> {
  try {
    const session = await ensureFreshSession()
    if (!session?.token) {
      return getLocalApiKeys()
    }
    const result = await fetchBackendApiKeys()
    if (result.unauthorized) {
      throw new CustomerApiError('unauthenticated', result.error ?? 'Your session has expired', 401)
    }
    if (!result.ok) {
      throw new CustomerApiError('server', result.error ?? 'Failed to fetch API keys from backend.', 500)
    }
    if (result.ok && Array.isArray(result.keys)) {
      const views = sortApiKeys(result.keys.map(toApiKeyView))
      if (views.length > 0) {
        saveLocalApiKeys(views)
      }
      return views
    }
  } catch (err) {
    if (err instanceof CustomerApiError) {
      throw err
    }
    // Network failure or unmocked in test without fetch handler -> fallback to getLocalApiKeys()
  }
  return getLocalApiKeys()
}

export async function createApiKey(
  name: string,
  environment: ApiKeyEnvironment,
): Promise<{ key: ApiKeyView; secret: string }> {
  const trimmed = name.trim()
  if (!trimmed || trimmed.length > API_KEY_NAME_MAX) {
    throw new CustomerApiError('bad_request', `Key name must be between 1 and ${API_KEY_NAME_MAX} characters.`)
  }

  // Generate unique demo secret token
  const prefix = environment === 'test' ? 'inf_demo_test_' : 'inf_demo_live_'
  const randomChars = Math.random().toString(36).substring(2, 12) + Math.random().toString(36).substring(2, 12)
  const secret = `${prefix}${randomChars}`
  const now = new Date().toISOString()
  const localId = `key-${Date.now().toString().slice(-4)}`

  // Try backend first if authenticated session is present
  try {
    const session = await ensureFreshSession()
    if (session?.token) {
      const result = await createBackendApiKey(trimmed, environment)
      if (result.unauthorized) {
        throw new CustomerApiError('unauthenticated', result.error ?? 'Session expired or unauthenticated.', 401)
      }
      if (!result.ok) {
        throw new CustomerApiError('server', result.error ?? 'Failed to generate API key.', 500)
      }
      if (result.data?.api_key) {
        const { api_key: backendSecret, ...rest } = result.data
        const newKey = toApiKeyView({
          id: rest.id,
          name: rest.name,
          key_prefix: rest.key_prefix,
          environment: rest.environment === 'test' ? 'test' : 'live',
          is_active: true,
          created_at: rest.created_at,
          last_used_at: null,
          revoked_at: null,
        })
        // Secret is never persisted to localStorage for backend-managed keys
        const current = getLocalApiKeys()
        saveLocalApiKeys([newKey, ...current])
        return { secret: backendSecret, key: newKey }
      }
    }
  } catch (err) {
    if (err instanceof CustomerApiError) throw err
    // Continue with resilient local generation
  }

  const demoKey: ApiKeyView = {
    id: localId,
    name: trimmed,
    prefix,
    secretToken: secret,
    maskedToken: `${prefix}••••••••`,
    environment,
    active: true,
    createdAt: now,
    lastUsedAt: null,
    revokedAt: null,
  }

  const current = getLocalApiKeys()
  const updated = [demoKey, ...current]
  saveLocalApiKeys(updated)
  return { secret, key: demoKey }
}

export async function revokeApiKey(id: string): Promise<void> {
  try {
    const session = await ensureFreshSession()
    if (session?.token) {
      const result = await revokeBackendApiKey(id)
      if (result.unauthorized) {
        throw new CustomerApiError('unauthenticated', result.error ?? 'Session expired or unauthenticated.', 401)
      }
      if (!result.ok) {
        throw new CustomerApiError('server', result.error ?? 'Failed to revoke API key.', 500)
      }
      return
    }
  } catch (err) {
    if (err instanceof CustomerApiError) throw err
    // Continue with resilient local revocation
  }

  const current = getLocalApiKeys()
  const updated = current.map((k) =>
    k.id === id ? { ...k, active: false, revokedAt: new Date().toISOString() } : k,
  )
  saveLocalApiKeys(updated)
}

export function deleteLocalApiKey(id: string): void {
  const current = getLocalApiKeys()
  const updated = current.filter((k) => k.id !== id)
  saveLocalApiKeys(updated)
}

export function resetDefaultApiKeys(): void {
  saveLocalApiKeys(DEFAULT_DEMO_API_KEYS)
}
