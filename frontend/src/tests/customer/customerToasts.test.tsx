import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { CustomerToastViewport } from '../../features/customer/ui/CustomerToast'
import * as serviceClients from '../../features/customer/data/serviceClients'
import type { NotificationItem } from '../../features/customer/data/types'

let root: Root | null = null
let host: HTMLDivElement

beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
  vi.restoreAllMocks()
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  if (root) act(() => root!.unmount())
  root = null
  document.body.replaceChildren()
  sessionStorage.clear()
  vi.useRealTimers()
})

function makeNotification(overrides: Partial<NotificationItem> = {}): NotificationItem {
  return {
    id: `notif_${Math.random().toString(36).slice(2, 9)}`,
    title: 'Notification Title',
    detail: 'Notification detail description',
    message: 'Notification detail description',
    notification_type: 'SECURITY_KEY',
    is_read: false,
    created_at: new Date().toISOString(),
    ...overrides,
  }
}

async function flush(times = 6) {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })
  }
}

describe('Customer Portal Real-Time Notification Toasts', () => {
  it('does not display toasts for pre-existing notifications on initial load/refresh', async () => {
    const existing = [
      makeNotification({ id: 'old-1', title: 'Old Key Created' }),
      makeNotification({ id: 'old-2', title: 'Old Topup' }),
    ]

    vi.spyOn(serviceClients, 'fetchNotifications').mockResolvedValue({
      total: 2,
      unread_count: 2,
      items: existing,
    })

    await act(async () => {
      root = createRoot(host)
      root.render(<CustomerToastViewport userId="customer_alice" />)
    })
    await flush()

    // No toast cards should be rendered on initial load
    const toasts = host.querySelectorAll('[data-testid="customer-toast"]')
    expect(toasts.length).toBe(0)
  })

  it('displays a toast popup when a new notification arrives', async () => {
    const initialItems = [makeNotification({ id: 'init-1', title: 'Initial' })]
    const fetchSpy = vi.spyOn(serviceClients, 'fetchNotifications')

    // Initial sync
    fetchSpy.mockResolvedValueOnce({
      total: 1,
      unread_count: 1,
      items: initialItems,
    })

    await act(async () => {
      root = createRoot(host)
      root.render(<CustomerToastViewport userId="customer_alice" />)
    })
    await flush()
    expect(host.querySelectorAll('[data-testid="customer-toast"]').length).toBe(0)

    // Now a new notification arrives (e.g. API key created)
    const newNotif = makeNotification({
      id: 'new-key-1',
      title: 'API Key Created',
      detail: 'A new API key "Bot Key" was successfully generated.',
      notification_type: 'SECURITY_KEY',
    })

    fetchSpy.mockResolvedValueOnce({
      total: 2,
      unread_count: 2,
      items: [newNotif, ...initialItems],
    })

    // Announce notification change
    await act(async () => {
      window.dispatchEvent(new Event('inferxe_notifications_change'))
    })
    await flush()

    // Exactly 1 new toast rendered
    const toasts = host.querySelectorAll('[data-testid="customer-toast"]')
    expect(toasts.length).toBe(1)
    expect(toasts[0]?.getAttribute('data-notification-id')).toBe('new-key-1')
    expect(toasts[0]?.textContent).toContain('API Key Created')
    expect(toasts[0]?.textContent).toContain('A new API key "Bot Key"')
  })

  it('supports various notification types with correct tone styling', async () => {
    const fetchSpy = vi.spyOn(serviceClients, 'fetchNotifications')

    fetchSpy.mockResolvedValueOnce({ total: 0, unread_count: 0, items: [] })

    await act(async () => {
      root = createRoot(host)
      root.render(<CustomerToastViewport userId="customer_alice" />)
    })
    await flush()

    // New warning notification (GPU deployment failed)
    const failedNotif = makeNotification({
      id: 'deploy-fail-1',
      title: 'GPU Deployment Failed',
      detail: 'Insufficient compute resources in region.',
      notification_type: 'GPU_DEPLOYMENT_FAILED',
    })

    fetchSpy.mockResolvedValueOnce({
      total: 1,
      unread_count: 1,
      items: [failedNotif],
    })

    await act(async () => {
      window.dispatchEvent(new Event('inferxe_notifications_change'))
    })
    await flush()

    const toast = host.querySelector('[data-testid="customer-toast"]')
    expect(toast).toBeTruthy()
    expect(toast?.classList.contains('cx-toast--warning')).toBe(true)
    expect(toast?.textContent).toContain('GPU Deployment Failed')
  })

  it('manually dismisses toast when close button is clicked', async () => {
    const fetchSpy = vi.spyOn(serviceClients, 'fetchNotifications')

    fetchSpy.mockResolvedValueOnce({ total: 0, unread_count: 0, items: [] })

    await act(async () => {
      root = createRoot(host)
      root.render(<CustomerToastViewport userId="customer_alice" />)
    })
    await flush()

    const notif = makeNotification({ id: 'dismiss-me', title: 'Recharge Complete' })
    fetchSpy.mockResolvedValueOnce({ total: 1, unread_count: 1, items: [notif] })

    await act(async () => {
      window.dispatchEvent(new Event('inferxe_notifications_change'))
    })
    await flush()

    expect(host.querySelectorAll('[data-testid="customer-toast"]').length).toBe(1)

    // Click close button
    const closeBtn = host.querySelector<HTMLButtonElement>('.cx-toast__close')
    expect(closeBtn).toBeTruthy()
    await act(async () => {
      closeBtn?.click()
    })
    await flush()

    expect(host.querySelectorAll('[data-testid="customer-toast"]').length).toBe(0)
  })

  it('prevents duplicate toasts when notification change event fires multiple times', async () => {
    const fetchSpy = vi.spyOn(serviceClients, 'fetchNotifications')

    fetchSpy.mockResolvedValueOnce({ total: 0, unread_count: 0, items: [] })

    await act(async () => {
      root = createRoot(host)
      root.render(<CustomerToastViewport userId="customer_alice" />)
    })
    await flush()

    const notif = makeNotification({ id: 'single-toast-id', title: 'Top-Up ₹1,000' })
    fetchSpy.mockResolvedValue({ total: 1, unread_count: 1, items: [notif] })

    // Fire event 3 times rapidly
    await act(async () => {
      window.dispatchEvent(new Event('inferxe_notifications_change'))
      window.dispatchEvent(new Event('inferxe_notifications_change'))
      window.dispatchEvent(new Event('inferxe_notifications_change'))
    })
    await flush()

    // Exactly 1 toast, never duplicates
    const toasts = host.querySelectorAll('[data-testid="customer-toast"]')
    expect(toasts.length).toBe(1)
  })

  it('isolates seen notification state per customer userId', async () => {
    const fetchSpy = vi.spyOn(serviceClients, 'fetchNotifications')
    fetchSpy.mockResolvedValue({ total: 0, unread_count: 0, items: [] })

    // Render for Alice
    await act(async () => {
      root = createRoot(host)
      root.render(<CustomerToastViewport userId="alice@example.com" />)
    })
    await flush()

    // Check Alice session key in sessionStorage
    expect(sessionStorage.getItem('inferxe_seen_notifications_alice_example_com')).toBeTruthy()
    expect(sessionStorage.getItem('inferxe_seen_notifications_bob_example_com')).toBeNull()

    // Switch to Bob
    await act(async () => {
      root?.render(<CustomerToastViewport userId="bob@example.com" />)
    })
    await flush()

    expect(sessionStorage.getItem('inferxe_seen_notifications_bob_example_com')).toBeTruthy()
  })
})
