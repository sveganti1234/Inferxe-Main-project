/**
 * Customer Toast Notification Hook
 * =================================
 * Observes customer notifications from the notification service and manages real-time
 * bottom-right toast popups for newly arrived notifications.
 *
 * Guarantees:
 * - Shows toasts only for NEW notifications arriving after initial page load / refresh.
 * - Deduplicates: never fires duplicate toasts for the same notification ID.
 * - Auto-dismisses each toast after 5 seconds with manual close option.
 * - Isolated per authenticated customer ID.
 * - Zero impact on existing notification bell, unread count badge, or history list.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { fetchNotifications } from '../data/serviceClients'
import type { NotificationItem } from '../data/types'
import { notificationVisual } from './notificationVisuals'

export interface CustomerToastItem {
  id: string
  title: string
  message: string
  tone: 'success' | 'warning' | 'info' | 'neutral'
  icon: ReactNode
  createdAt: number
}

const TOAST_DURATION_MS = 5000
const POLL_INTERVAL_MS = 12000
const MAX_VISIBLE_TOASTS = 3

function getSessionSeenKey(userId?: string | null): string {
  const safeId = (userId || 'default_customer').replace(/[^a-zA-Z0-9_-]/g, '_')
  return `inferxe_seen_notifications_${safeId}`
}

function loadSeenIdsFromSession(userId?: string | null): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = sessionStorage.getItem(getSessionSeenKey(userId))
    if (raw) {
      const arr = JSON.parse(raw)
      if (Array.isArray(arr)) return new Set(arr)
    }
  } catch {
    // sessionStorage unavailable
  }
  return new Set()
}

function saveSeenIdsToSession(userId: string | null | undefined, set: Set<string>): void {
  if (typeof window === 'undefined') return
  try {
    const arr = Array.from(set).slice(-200) // keep last 200 IDs
    sessionStorage.setItem(getSessionSeenKey(userId), JSON.stringify(arr))
  } catch {
    // storage failed
  }
}

export function useCustomerNotificationToasts(userId?: string | null) {
  const [toasts, setToasts] = useState<CustomerToastItem[]>([])
  const seenIdsRef = useRef<Set<string>>(loadSeenIdsFromSession(userId))
  const initializedRef = useRef<boolean>(false)
  const isFetchingRef = useRef<boolean>(false)
  const timersRef = useRef<Map<string, number>>(new Map())

  // Dismiss a toast by ID
  const dismissToast = useCallback((id: string) => {
    const timer = timersRef.current.get(id)
    if (timer) {
      window.clearTimeout(timer)
      timersRef.current.delete(id)
    }
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  // Add a new toast and schedule its 5-second auto-dismiss
  const addToast = useCallback((item: NotificationItem) => {
    const id = item.id
    if (!id || seenIdsRef.current.has(id)) return

    seenIdsRef.current.add(id)
    saveSeenIdsToSession(userId, seenIdsRef.current)

    const visual = notificationVisual(item.notification_type)
    const title = item.title?.trim() || visual.label || 'Notification'
    const message = (item.detail || item.message || '').trim()

    const newToast: CustomerToastItem = {
      id,
      title,
      message,
      tone: visual.tone,
      icon: visual.icon,
      createdAt: Date.now(),
    }

    setToasts((prev) => {
      const filtered = prev.filter((t) => t.id !== id)
      return [newToast, ...filtered].slice(0, MAX_VISIBLE_TOASTS)
    })

    // Auto-dismiss after 5 seconds
    const timer = window.setTimeout(() => {
      dismissToast(id)
    }, TOAST_DURATION_MS)
    timersRef.current.set(id, timer)
  }, [dismissToast, userId])

  // Sync notifications from backend
  const checkNewNotifications = useCallback(async () => {
    if (isFetchingRef.current) return
    isFetchingRef.current = true

    try {
      const page = await fetchNotifications({ limit: 15 })
      const items = page.items || []

      if (!initializedRef.current) {
        // Initial sync on mount/refresh: mark all existing notifications as seen
        items.forEach((item) => {
          if (item.id) seenIdsRef.current.add(item.id)
        })
        saveSeenIdsToSession(userId, seenIdsRef.current)
        initializedRef.current = true
      } else {
        // Subsequent sync: only trigger toasts for genuinely new notifications
        for (const item of items) {
          if (item.id && !seenIdsRef.current.has(item.id)) {
            addToast(item)
          }
        }
      }
    } catch {
      // Background check failed; fail silently without interrupting UX
    } finally {
      isFetchingRef.current = false
    }
  }, [addToast, userId])

  // Reset when user identity changes
  useEffect(() => {
    seenIdsRef.current = loadSeenIdsFromSession(userId)
    initializedRef.current = false
    setToasts([])
    timersRef.current.forEach((t) => window.clearTimeout(t))
    timersRef.current.clear()

    // Trigger initial sync
    void checkNewNotifications()
  }, [userId, checkNewNotifications])

  // Listen to platform notifications change event and focus
  useEffect(() => {
    const handleEvent = () => {
      void checkNewNotifications()
    }

    window.addEventListener('inferxe_notifications_change', handleEvent)
    window.addEventListener('focus', handleEvent)

    // Periodic poll
    const interval = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return
      void checkNewNotifications()
    }, POLL_INTERVAL_MS)

    return () => {
      window.removeEventListener('inferxe_notifications_change', handleEvent)
      window.removeEventListener('focus', handleEvent)
      window.clearInterval(interval)
    }
  }, [checkNewNotifications])

  // Cleanup all timers on unmount
  useEffect(() => {
    const timers = timersRef.current
    return () => {
      timers.forEach((t) => window.clearTimeout(t))
      timers.clear()
    }
  }, [])

  return {
    toasts,
    dismissToast,
  }
}
