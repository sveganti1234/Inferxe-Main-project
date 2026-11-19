/**
 * Live, read-only signals displayed by the console shell:
 * - unread notification count (8002), refreshed when the window regains focus
 * - inference service availability (8001 public health endpoint)
 * Failures leave the signal unknown (null) — the shell never shows a guessed value.
 */
import { createContext, useContext, useEffect } from 'react'
import { fetchInferenceHealth, fetchUnreadNotificationCount } from '../data/serviceClients'
import { useAsyncResource } from '../data/useAsyncResource'

export interface ConsoleSignals {
  unreadCount: number | null
  inferenceAvailable: boolean | null
  inferenceChecked: boolean
}

export function useConsoleSignals(): ConsoleSignals {
  const unread = useAsyncResource(fetchUnreadNotificationCount)
  const health = useAsyncResource(fetchInferenceHealth)

  const refreshUnread = unread.refresh
  useEffect(() => {
    const onFocus = () => refreshUnread()
    window.addEventListener('focus', onFocus)
    window.addEventListener('inferxe_notifications_change', onFocus)
    return () => {
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('inferxe_notifications_change', onFocus)
    }
  }, [refreshUnread])

  return {
    unreadCount: unread.state.status === 'ready' ? unread.state.data : null,
    inferenceAvailable: health.state.status === 'ready' ? health.state.data.inferenceAvailable : null,
    inferenceChecked: health.state.status !== 'loading',
  }
}

const UNKNOWN_SIGNALS: ConsoleSignals = { unreadCount: null, inferenceAvailable: null, inferenceChecked: false }

/** Signals loaded once by the shell and shared with pages (avoids duplicate requests). */
export const ConsoleSignalsContext = createContext<ConsoleSignals>(UNKNOWN_SIGNALS)

export function useSharedConsoleSignals(): ConsoleSignals {
  return useContext(ConsoleSignalsContext)
}
