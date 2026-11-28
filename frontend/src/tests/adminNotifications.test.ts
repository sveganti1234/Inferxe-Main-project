import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  fetchAdminNotifications,
  fetchAdminUnreadCount,
  markAdminNotificationRead,
  markAllAdminNotificationsRead,
  updateAdminGpuPrice,
  createAdminGpuListing,
  toUiNotification,
  type AdminNotificationItem,
} from '../lib/adminNotificationService'
import * as authStore from '../lib/authStore'

const mockFetch = vi.fn()
const SERVER_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhZG1pbl8xMjMiLCJyb2xlIjoiYWRtaW4iLCJleHAiOjQxMDI0NDQ4MDB9.sig'

function respond(status: number, body: unknown) {
  mockFetch.mockResolvedValueOnce(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  )
}

describe('Admin Notification Service', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    vi.stubGlobal('fetch', mockFetch)
    vi.restoreAllMocks()
    localStorage.clear()
  })

  describe('fetchAdminNotifications', () => {
    it('returns error and ok: false if not logged in', async () => {
      vi.spyOn(authStore, 'getSession').mockReturnValue(null)
      const res = await fetchAdminNotifications()
      expect(res.ok).toBe(false)
      expect(res.error).toContain('Unauthenticated')
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('fetches notifications with Bearer token when admin is logged in', async () => {
      vi.spyOn(authStore, 'getSession').mockReturnValue({
        token: SERVER_TOKEN,
        user: { id: 'admin_123', email: 'admin@inferxe.com', role: 'admin' },
        expiresAt: Date.now() + 100000,
      })

      const mockItems: AdminNotificationItem[] = [
        {
          id: 'notif_1',
          user_id: 'admin_123',
          notification_type: 'SYSTEM_ALERT',
          title: 'High GPU Temperature',
          message: 'Node A100-01 exceeds 85C',
          is_read: false,
          created_at: new Date().toISOString(),
        },
      ]

      respond(200, {
        items: mockItems,
        total: 1,
        unread_count: 1,
      })

      const res = await fetchAdminNotifications({ limit: 10, unread_only: true })
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/notifications?unread_only=true&limit=10&offset=0'),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: `Bearer ${SERVER_TOKEN}`,
          }),
        })
      )
      expect(res.ok).toBe(true)
      expect(res.data?.items).toHaveLength(1)
      expect(res.data?.items[0].title).toBe('High GPU Temperature')
      expect(res.data?.unread_count).toBe(1)
    })

    it('handles backend error gracefully without throwing', async () => {
      vi.spyOn(authStore, 'getSession').mockReturnValue({
        token: SERVER_TOKEN,
        user: { id: 'admin_123', email: 'admin@inferxe.com', role: 'admin' },
        expiresAt: Date.now() + 100000,
      })

      mockFetch.mockRejectedValueOnce(new Error('Network error'))
      const res = await fetchAdminNotifications()
      expect(res.ok).toBe(false)
      expect(res.error).toBe('Network error')
    })
  })

  describe('fetchAdminUnreadCount', () => {
    it('returns unreadCount: 0 and ok: false when not authenticated', async () => {
      vi.spyOn(authStore, 'getSession').mockReturnValue(null)
      const res = await fetchAdminUnreadCount()
      expect(res.ok).toBe(false)
      expect(res.unreadCount).toBe(0)
    })

    it('fetches unread count from /api/notifications/unread-count', async () => {
      vi.spyOn(authStore, 'getSession').mockReturnValue({
        token: SERVER_TOKEN,
        user: { id: 'admin_123', email: 'admin@inferxe.com', role: 'admin' },
        expiresAt: Date.now() + 100000,
      })

      respond(200, { unread_count: 7 })

      const res = await fetchAdminUnreadCount()
      expect(res.ok).toBe(true)
      expect(res.unreadCount).toBe(7)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/notifications/unread-count'),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: `Bearer ${SERVER_TOKEN}`,
          }),
        })
      )
    })
  })

  describe('markAdminNotificationRead and markAllAdminNotificationsRead', () => {
    it('marks a single notification as read and dispatches change event', async () => {
      vi.spyOn(authStore, 'getSession').mockReturnValue({
        token: SERVER_TOKEN,
        user: { id: 'admin_123', email: 'admin@inferxe.com', role: 'admin' },
        expiresAt: Date.now() + 100000,
      })

      const eventSpy = vi.fn()
      window.addEventListener('inferxe_notifications_change', eventSpy)

      respond(200, { ok: true, id: 'notif_1', read: true })

      const res = await markAdminNotificationRead('notif_1')
      expect(res.ok).toBe(true)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/notifications/notif_1/read'),
        expect.objectContaining({
          method: 'PATCH',
          headers: expect.objectContaining({
            Authorization: `Bearer ${SERVER_TOKEN}`,
          }),
        })
      )
      expect(eventSpy).toHaveBeenCalled()
      window.removeEventListener('inferxe_notifications_change', eventSpy)
    })

    it('marks all notifications as read and dispatches change event', async () => {
      vi.spyOn(authStore, 'getSession').mockReturnValue({
        token: SERVER_TOKEN,
        user: { id: 'admin_123', email: 'admin@inferxe.com', role: 'admin' },
        expiresAt: Date.now() + 100000,
      })

      const eventSpy = vi.fn()
      window.addEventListener('inferxe_notifications_change', eventSpy)

      respond(200, { ok: true, marked_read: 5 })

      const res = await markAllAdminNotificationsRead()
      expect(res.ok).toBe(true)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/notifications/read-all'),
        expect.objectContaining({
          method: 'PATCH',
          headers: expect.objectContaining({
            Authorization: `Bearer ${SERVER_TOKEN}`,
          }),
        })
      )
      expect(eventSpy).toHaveBeenCalled()
      window.removeEventListener('inferxe_notifications_change', eventSpy)
    })
  })

  describe('updateAdminGpuPrice', () => {
    it('returns error and ok: false when not logged in', async () => {
      vi.spyOn(authStore, 'getSession').mockReturnValue(null)
      const res = await updateAdminGpuPrice('gpu-104', 300)
      expect(res.ok).toBe(false)
      expect(res.error).toContain('Unauthenticated')
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('validates gpuId and price', async () => {
      vi.spyOn(authStore, 'getSession').mockReturnValue({
        token: SERVER_TOKEN,
        user: { id: 'admin_123', email: 'admin@inferxe.com', role: 'admin' },
        expiresAt: Date.now() + 100000,
      })

      const emptyIdRes = await updateAdminGpuPrice('', 300)
      expect(emptyIdRes.ok).toBe(false)
      expect(emptyIdRes.error).toContain('GPU ID is required')

      const invalidPriceRes = await updateAdminGpuPrice('gpu-104', -10)
      expect(invalidPriceRes.ok).toBe(false)
      expect(invalidPriceRes.error).toContain('valid number greater than 0')
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('updates price successfully, passes Bearer token and dispatches notification event', async () => {
      vi.spyOn(authStore, 'getSession').mockReturnValue({
        token: SERVER_TOKEN,
        user: { id: 'admin_123', email: 'admin@inferxe.com', role: 'admin' },
        expiresAt: Date.now() + 100000,
      })

      const eventSpy = vi.fn()
      window.addEventListener('inferxe_notifications_change', eventSpy)

      respond(200, {
        status: 'success',
        message: 'Updated NVIDIA H100 SXM5 price to ₹300',
        old_price: 275.0,
        new_price: 300.0,
        notifications_created: 1,
        admin_notifications_created: 1,
      })

      const res = await updateAdminGpuPrice('gpu-104', 300, {
        idempotencyKey: 'idem_test_123',
      })

      expect(res.ok).toBe(true)
      expect(res.data?.status).toBe('success')
      expect(res.data?.new_price).toBe(300.0)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/notifications/price-update'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: `Bearer ${SERVER_TOKEN}`,
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify({
            gpu_id: 'gpu-104',
            new_price: 300,
            idempotency_key: 'idem_test_123',
          }),
        })
      )
      expect(eventSpy).toHaveBeenCalled()
      window.removeEventListener('inferxe_notifications_change', eventSpy)
    })

    it('handles backend error response gracefully', async () => {
      vi.spyOn(authStore, 'getSession').mockReturnValue({
        token: SERVER_TOKEN,
        user: { id: 'admin_123', email: 'admin@inferxe.com', role: 'admin' },
        expiresAt: Date.now() + 100000,
      })

      respond(400, { detail: 'GPU model not eligible for price adjustment' })

      const res = await updateAdminGpuPrice('gpu-104', 300)
      expect(res.ok).toBe(false)
      expect(res.error).toBe('GPU model not eligible for price adjustment')
    })

    it('handles network failure without throwing', async () => {
      vi.spyOn(authStore, 'getSession').mockReturnValue({
        token: SERVER_TOKEN,
        user: { id: 'admin_123', email: 'admin@inferxe.com', role: 'admin' },
        expiresAt: Date.now() + 100000,
      })

      mockFetch.mockRejectedValueOnce(new Error('Connection reset by peer'))

      const res = await updateAdminGpuPrice('gpu-104', 300)
      expect(res.ok).toBe(false)
      expect(res.error).toBe('Connection reset by peer')
    })

    it('supports duplicate avoidance and noop responses cleanly', async () => {
      vi.spyOn(authStore, 'getSession').mockReturnValue({
        token: SERVER_TOKEN,
        user: { id: 'admin_123', email: 'admin@inferxe.com', role: 'admin' },
        expiresAt: Date.now() + 100000,
      })

      respond(200, {
        status: 'skipped',
        message: 'Duplicate price update event ignored.',
        event_id: 'evt_dup_999',
      })

      const res = await updateAdminGpuPrice('gpu-104', 300, { idempotencyKey: 'idem_dup_test' })
      expect(res.ok).toBe(true)
      expect(res.data?.status).toBe('skipped')
      expect(res.data?.message).toContain('Duplicate price update')
    })
  })

  describe('createAdminGpuListing', () => {
    it('returns error and ok: false when not logged in', async () => {
      vi.spyOn(authStore, 'getSession').mockReturnValue(null)
      const res = await createAdminGpuListing({ name: 'NVIDIA L4', price: 60 })
      expect(res.ok).toBe(false)
      expect(res.error).toContain('Unauthenticated')
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('validates name and price client-side', async () => {
      vi.spyOn(authStore, 'getSession').mockReturnValue({
        token: SERVER_TOKEN,
        user: { id: 'admin_123', email: 'admin@inferxe.com', role: 'admin' },
        expiresAt: Date.now() + 100000,
      })

      const emptyNameRes = await createAdminGpuListing({ name: '', price: 60 })
      expect(emptyNameRes.ok).toBe(false)
      expect(emptyNameRes.error).toContain('GPU Name / Model is required')

      const invalidPriceRes = await createAdminGpuListing({ name: 'NVIDIA L4', price: 0 })
      expect(invalidPriceRes.ok).toBe(false)
      expect(invalidPriceRes.error).toContain('valid number greater than 0')
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('creates listing, passes Bearer token and dispatches notification refresh', async () => {
      vi.spyOn(authStore, 'getSession').mockReturnValue({
        token: SERVER_TOKEN,
        user: { id: 'admin_123', email: 'admin@inferxe.com', role: 'admin' },
        expiresAt: Date.now() + 100000,
      })

      const eventSpy = vi.fn()
      window.addEventListener('inferxe_notifications_change', eventSpy)

      respond(200, {
        status: 'success',
        message: "New GPU listing 'NVIDIA L4' added to inventory.",
        listing: {
          id: 'gpu-new-1',
          name: 'NVIDIA L4',
          gpu_model: 'L4',
          gpu: 'L4',
          vram: '24 GB',
          region: 'Hyderabad, IN',
          price: 60,
          quantity: 4,
          currency: 'INR',
          billing_unit: 'hr',
          status: 'Available',
          updated_at: new Date().toISOString(),
        },
        admin_notifications_created: 1,
      })

      const res = await createAdminGpuListing({
        name: 'NVIDIA L4',
        gpu_model: 'L4',
        vram: '24 GB',
        region: 'Hyderabad, IN',
        price: 60,
        quantity: 4,
        idempotency_key: 'idem_create_test_1',
      })

      expect(res.ok).toBe(true)
      expect(res.data?.status).toBe('success')
      expect(res.data?.listing?.id).toBe('gpu-new-1')
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/notifications/gpu-listing'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: `Bearer ${SERVER_TOKEN}`,
            'Content-Type': 'application/json',
          }),
        })
      )
      expect(eventSpy).toHaveBeenCalled()
      window.removeEventListener('inferxe_notifications_change', eventSpy)
    })
  })

  describe('toUiNotification', () => {
    it('correctly maps AdminNotificationItem to UI shape', () => {
      const apiItem: AdminNotificationItem = {
        id: 'item_1',
        user_id: 'admin_123',
        notification_type: 'GPU_OFFLINE',
        title: 'GPU Worker Node Disconnected',
        message: 'Worker cluster-us-east-1 went offline',
        is_read: false,
        created_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      }

      const uiItem = toUiNotification(apiItem)
      expect(uiItem.id).toBe('item_1')
      expect(uiItem.title).toBe('GPU Worker Node Disconnected')
      expect(uiItem.detail).toBe('Worker cluster-us-east-1 went offline')
      expect(uiItem.type).toBe('GPU_OFFLINE')
      expect(uiItem.read).toBe(false)
      expect(uiItem.time).toBeDefined()
    })
  })
})
