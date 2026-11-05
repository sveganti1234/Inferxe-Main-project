/**
 * Centralized Multi-User Notification Store & Polling Manager for Inferxe.
 * Manages PostgreSQL-backed notifications, unread badges, user isolation,
 * and real-time polling (~10s) with duplicate-toast prevention.
 */

import { getSession } from './authStore'

export interface ServerNotification {
  id: string
  user_id: string
  title: string
  message: string
  notification_type: string
  is_read: boolean
  metadata?: Record<string, any>
  related_entity_id?: string
  created_at: string
  read_at?: string
}

export interface ToastAlert {
  id: string
  title: string
  message: string
  type: string
}

type NotificationSubscriber = () => void

class CentralizedNotificationManager {
  private notifications: ServerNotification[] = []
  private unreadCount = 0
  private currentUserId: string | null = null
  private pollingTimer: number | null = null
  private subscribers = new Set<NotificationSubscriber>()
  private seenIds = new Set<string>()
  private activeToast: ToastAlert | null = null
  private toastDismissTimer: number | null = null
  private isFetching = false

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', (e) => {
        if (e.key === 'inferxe_auth_session') {
          this.handleAuthChange()
        }
      })
      // Periodic auth check to start/stop polling
      window.setInterval(() => this.checkSession(), 3000)
    }
  }

  public subscribe(cb: NotificationSubscriber): () => void {
    this.subscribers.add(cb)
    // Start polling if not already started
    this.checkSession()
    return () => {
      this.subscribers.delete(cb)
    }
  }

  private notifySubscribers() {
    this.subscribers.forEach((cb) => {
      try {
        cb()
      } catch (err) {
        console.error('Error in notification subscriber:', err)
      }
    })
    try {
      window.dispatchEvent(new CustomEvent('inferxe_notifications_updated'))
    } catch {}
  }

  public getState() {
    return {
      notifications: this.notifications,
      unreadCount: this.unreadCount,
      activeToast: this.activeToast,
    }
  }

  public dismissToast() {
    if (this.toastDismissTimer) {
      window.clearTimeout(this.toastDismissTimer)
      this.toastDismissTimer = null
    }
    this.activeToast = null
    this.notifySubscribers()
  }

  private triggerToast(notif: ServerNotification) {
    if (this.toastDismissTimer) {
      window.clearTimeout(this.toastDismissTimer)
    }
    this.activeToast = {
      id: notif.id,
      title: notif.title,
      message: notif.message,
      type: notif.notification_type,
    }
    this.notifySubscribers()

    // Auto-dismiss after 5.5 seconds
    this.toastDismissTimer = window.setTimeout(() => {
      this.activeToast = null
      this.notifySubscribers()
    }, 5500)
  }

  public checkSession() {
    const session = getSession()
    const sessionUserId = session?.user?.id || null

    if (sessionUserId !== this.currentUserId) {
      this.currentUserId = sessionUserId
      this.notifications = []
      this.unreadCount = 0
      this.seenIds.clear()
      this.activeToast = null

      if (this.pollingTimer) {
        window.clearInterval(this.pollingTimer)
        this.pollingTimer = null
      }

      if (sessionUserId && session?.token) {
        this.fetchNotifications(true)
        // Single centralized polling timer: exactly every 10 seconds
        this.pollingTimer = window.setInterval(() => {
          this.fetchNotifications(false)
        }, 10000)
      } else {
        this.notifySubscribers()
      }
    }
  }

  public handleAuthChange() {
    this.checkSession()
  }

  public async fetchNotifications(isInitial = false): Promise<void> {
    const session = getSession()
    if (!session || !session.token) {
      if (this.currentUserId) {
        this.currentUserId = null
        this.notifications = []
        this.unreadCount = 0
        this.notifySubscribers()
      }
      return
    }

    if (this.isFetching) return
    this.isFetching = true

    try {
      const res = await fetch('/api/notifications?limit=60', {
        headers: {
          Authorization: `Bearer ${session.token}`,
          Accept: 'application/json',
        },
      })

      if (res.status === 401) {
        // Token invalid or expired
        return
      }

      if (!res.ok) {
        return
      }

      const data = await res.json()
      const newItems: ServerNotification[] = data.items || []
      const newUnread: number = typeof data.unread_count === 'number' ? data.unread_count : 0

      // Detect newly arrived unread notifications to trigger toast
      if (!isInitial) {
        for (const item of newItems) {
          if (!this.seenIds.has(item.id) && !item.is_read) {
            this.triggerToast(item)
            break // show one toast at a time
          }
        }
      }

      // Track all seen IDs
      newItems.forEach((n) => this.seenIds.add(n.id))

      this.notifications = newItems
      this.unreadCount = newUnread
      this.notifySubscribers()
    } catch (err) {
      // Network or backend unavailable
    } finally {
      this.isFetching = false
    }
  }

  public async markAsRead(notificationId: string): Promise<boolean> {
    const session = getSession()
    if (!session?.token) return false

    // Optimistic UI update
    this.notifications = this.notifications.map((n) =>
      n.id === notificationId ? { ...n, is_read: true } : n
    )
    this.unreadCount = Math.max(0, this.unreadCount - 1)
    this.notifySubscribers()

    try {
      const res = await fetch(`/api/notifications/${notificationId}/read`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${session.token}`,
          'Content-Type': 'application/json',
        },
      })
      if (res.ok) {
        return true
      }
    } catch {}
    // Re-sync on failure
    this.fetchNotifications(false)
    return false
  }

  public async markAllAsRead(): Promise<boolean> {
    const session = getSession()
    if (!session?.token) return false

    // Optimistic UI update
    this.notifications = this.notifications.map((n) => ({ ...n, is_read: true }))
    this.unreadCount = 0
    this.notifySubscribers()

    try {
      const res = await fetch('/api/notifications/read-all', {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${session.token}`,
          'Content-Type': 'application/json',
        },
      })
      if (res.ok) {
        return true
      }
    } catch {}
    this.fetchNotifications(false)
    return false
  }

  public async deleteNotification(notificationId: string): Promise<boolean> {
    const session = getSession()
    if (!session?.token) return false

    const target = this.notifications.find((n) => n.id === notificationId)
    this.notifications = this.notifications.filter((n) => n.id !== notificationId)
    if (target && !target.is_read) {
      this.unreadCount = Math.max(0, this.unreadCount - 1)
    }
    this.notifySubscribers()

    try {
      const res = await fetch(`/api/notifications/${notificationId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${session.token}`,
        },
      })
      if (res.ok) {
        return true
      }
    } catch {}
    this.fetchNotifications(false)
    return false
  }
}

export const notificationManager = new CentralizedNotificationManager()

