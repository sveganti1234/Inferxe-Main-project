/**
 * In-memory page-data cache (stale-while-revalidate) for the customer console.
 *
 * Isolation rules:
 *  - Entries are scoped to the signed-in user (session user id) and workspace (organization id).
 *    A different user, a sign-out (no session) or a different workspace empties the whole cache
 *    before anything can be read, so one account's data is never shown to another.
 *  - Memory only: nothing is written to localStorage/sessionStorage; a page reload starts empty.
 * The cache only shortens the time to first paint: callers always re-fetch, and a failed
 * re-fetch is reported as an error (see useAsyncResource), never hidden behind cached data.
 */
import { getSession } from '../../../lib/authStore'

const entries = new Map<string, { data: unknown; at: number }>()
let scopeUser: string | null = null
let scopeWorkspace: string | null = null

const refreshing = new Set<string>()
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((l) => l())

export function clearResourceCache(): void {
  entries.clear()
  if (refreshing.size) {
    refreshing.clear()
    notify()
  }
}

function sessionUser(): string | null {
  try {
    return getSession()?.user?.id || null
  } catch {
    return null
  }
}

/** Re-check the scope; any change of user empties the cache. Returns the current user or null. */
function currentUser(): string | null {
  const user = sessionUser()
  if (user !== scopeUser) {
    clearResourceCache()
    scopeUser = user
    scopeWorkspace = null
  }
  return user
}

/** Called when the workspace (organization) is known; switching workspace empties the cache. */
export function setCacheWorkspace(workspaceId: string | null): void {
  currentUser()
  if (scopeWorkspace !== null && workspaceId !== scopeWorkspace) clearResourceCache()
  scopeWorkspace = workspaceId
}

function scopedKey(key: string): string | null {
  const user = currentUser()
  return user ? `${user}|${key}` : null
}

export function readCache<T>(key: string): T | null {
  const k = scopedKey(key)
  return k && entries.has(k) ? (entries.get(k)!.data as T) : null
}

export function writeCache<T>(key: string, data: T): void {
  const k = scopedKey(key)
  if (k) entries.set(k, { data, at: Date.now() })
}

/* ── Refresh tracking (drives the shell's subtle "refreshing" indicator) ── */

export function markRefreshing(token: string, active: boolean): void {
  const had = refreshing.has(token)
  if (active) refreshing.add(token)
  else refreshing.delete(token)
  if (had !== active) notify()
}

export function subscribeRefreshing(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const isRefreshing = (): boolean => refreshing.size > 0

// Sign-out / account switch: the auth store emits this whenever the session record changes.
if (typeof window !== 'undefined') {
  const onAuthChange = () => {
    if (sessionUser() !== scopeUser) currentUser()
  }
  window.addEventListener('inferxe_auth_change', onAuthChange)
  window.addEventListener('storage', onAuthChange)
}
