import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import { CustomerApiError, defaultMessage } from './http'
import { isRefreshing, markRefreshing, readCache, subscribeRefreshing, writeCache } from './resourceCache'

export type ResourceState<T> =
  | { status: 'loading'; data: T | null; error: null }
  | { status: 'ready'; data: T; error: null }
  | { status: 'error'; data: T | null; error: CustomerApiError }

export interface AsyncResource<T> {
  state: ResourceState<T>
  /** Re-run the loader; keeps the previous data visible while reloading. */
  refresh: () => void
  lastUpdated: number | null
}

function toApiError(err: unknown): CustomerApiError {
  if (err instanceof CustomerApiError) return err
  return new CustomerApiError('invalid_response', defaultMessage('invalid_response'))
}

/**
 * Minimal data-loading hook: runs `loader` on mount and on `refresh()`, aborts stale
 * requests, and exposes loading / ready / error states. `enabled=false` skips loading.
 *
 * `cacheKey` (optional) shows the last result for this user/workspace immediately while the
 * request runs (state stays `loading`, with data), so revisiting a page doesn't flash skeletons.
 * The request always runs; if it fails the state is `error` — cached data is never presented
 * as current. See resourceCache.ts for the isolation rules.
 */
export function useAsyncResource<T>(
  loader: (signal: AbortSignal) => Promise<T>,
  options: { enabled?: boolean; cacheKey?: string } = {},
): AsyncResource<T> {
  const enabled = options.enabled ?? true
  const cacheKey = options.cacheKey
  const [state, setState] = useState<ResourceState<T>>(() => ({
    status: 'loading',
    data: cacheKey ? readCache<T>(cacheKey) : null,
    error: null,
  }))
  const [lastUpdated, setLastUpdated] = useState<number | null>(null)
  const [nonce, setNonce] = useState(0)
  const loaderRef = useRef(loader)
  loaderRef.current = loader
  const refreshToken = useId()

  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    setState((prev) => ({ status: 'loading', data: prev.data, error: null }))
    // Only a reload that is showing earlier data counts as "refreshing" (skeletons show otherwise).
    const showingData = cacheKey ? readCache<T>(cacheKey) !== null : false
    if (showingData) markRefreshing(refreshToken, true)
    loaderRef.current(controller.signal).then(
      (data) => {
        if (controller.signal.aborted) return
        if (cacheKey) writeCache(cacheKey, data)
        setState({ status: 'ready', data, error: null })
        setLastUpdated(Date.now())
      },
      (err: unknown) => {
        if (controller.signal.aborted || (err as { name?: string })?.name === 'AbortError') return
        setState((prev) => ({ status: 'error', data: prev.data, error: toApiError(err) }))
      },
    ).finally(() => markRefreshing(refreshToken, false))
    return () => {
      controller.abort()
      markRefreshing(refreshToken, false)
    }
  }, [enabled, nonce, cacheKey, refreshToken])

  const refresh = useCallback(() => setNonce((n) => n + 1), [])
  return { state, refresh, lastUpdated }
}

/** True while any cached resource is re-fetching behind visible content (shell indicator). */
export function useResourceRefreshing(): boolean {
  return useSyncExternalStore(subscribeRefreshing, isRefreshing, () => false)
}
