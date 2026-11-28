import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  updateAdminGpuPrice,
  type PriceUpdateResponse,
} from '../lib/adminNotificationService'
import * as authStore from '../lib/authStore'

const mockFetch = vi.fn()
const TEST_ADMIN_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhZG1pbl91c3JfMDAxIiwicm9sZSI6ImFkbWluIiwiZXhwIjo0MTAyNDQ0ODAwfQ.test_sig'

function mockJsonResponse(status: number, body: unknown) {
  mockFetch.mockResolvedValueOnce(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  )
}

describe('GPU Price Update Notification Integration Tests', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    vi.stubGlobal('fetch', mockFetch)
    vi.restoreAllMocks()
    localStorage.clear()

    vi.spyOn(authStore, 'getSession').mockReturnValue({
      token: TEST_ADMIN_TOKEN,
      user: { id: 'admin_usr_001', email: 'admin@inferxe.com', role: 'admin' },
      expiresAt: Date.now() + 3600000,
    })
  })

  it('1. Successfully calls POST /api/notifications/price-update and dispatches notification refresh', async () => {
    const eventSpy = vi.fn()
    window.addEventListener('inferxe_notifications_change', eventSpy)

    const expectedResponse: PriceUpdateResponse = {
      status: 'success',
      message: 'Updated NVIDIA H100 SXM5 price to ₹290',
      old_price: 275.0,
      new_price: 290.0,
      notifications_created: 3,
      admin_notifications_created: 1,
    }
    mockJsonResponse(200, expectedResponse)

    const result = await updateAdminGpuPrice('gpu-104', 290, {
      idempotencyKey: 'gpu_price_gpu-104_290_12345678',
    })

    expect(result.ok).toBe(true)
    expect(result.data).toEqual(expectedResponse)
    expect(result.data?.new_price).toBe(290)

    // Verify endpoint, method, headers and payload
    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [calledUrl, calledInit] = mockFetch.mock.calls[0]
    expect(calledUrl).toContain('/api/notifications/price-update')
    expect(calledInit.method).toBe('POST')
    expect(calledInit.headers).toEqual(
      expect.objectContaining({
        Authorization: `Bearer ${TEST_ADMIN_TOKEN}`,
        'Content-Type': 'application/json',
      })
    )

    const parsedBody = JSON.parse(calledInit.body)
    expect(parsedBody).toEqual({
      gpu_id: 'gpu-104',
      new_price: 290,
      idempotency_key: 'gpu_price_gpu-104_290_12345678',
    })

    // Verify notification refresh event was dispatched
    expect(eventSpy).toHaveBeenCalled()
    window.removeEventListener('inferxe_notifications_change', eventSpy)
  })

  it('2. Handles backend API failure cleanly without crashing or dispatching refresh', async () => {
    const eventSpy = vi.fn()
    window.addEventListener('inferxe_notifications_change', eventSpy)

    mockJsonResponse(500, { detail: 'Database pool connection timed out' })

    const result = await updateAdminGpuPrice('gpu-104', 320)

    expect(result.ok).toBe(false)
    expect(result.error).toBe('Database pool connection timed out')
    expect(result.data).toBeUndefined()

    // On failure, inferxe_notifications_change should NOT be dispatched
    expect(eventSpy).not.toHaveBeenCalled()
    window.removeEventListener('inferxe_notifications_change', eventSpy)
  })

  it('3. Preserves idempotency key across retry attempts to prevent duplicate notifications', async () => {
    const sharedIdemKey = 'gpu_price_gpu-104_300_retry_1'

    // First attempt fails with network error
    mockFetch.mockRejectedValueOnce(new Error('Failed to fetch'))
    const attempt1 = await updateAdminGpuPrice('gpu-104', 300, {
      idempotencyKey: sharedIdemKey,
    })
    expect(attempt1.ok).toBe(false)

    // Second retry attempt with same idempotency key succeeds
    mockJsonResponse(200, {
      status: 'skipped',
      message: 'Duplicate price update event ignored.',
      event_id: 'evt_dup_001',
    })
    const attempt2 = await updateAdminGpuPrice('gpu-104', 300, {
      idempotencyKey: sharedIdemKey,
    })
    expect(attempt2.ok).toBe(true)
    expect(attempt2.data?.status).toBe('skipped')

    // Both calls must have passed the exact same idempotency_key
    expect(mockFetch).toHaveBeenCalledTimes(2)
    const body1 = JSON.parse(mockFetch.mock.calls[0][1].body)
    const body2 = JSON.parse(mockFetch.mock.calls[1][1].body)
    expect(body1.idempotency_key).toBe(sharedIdemKey)
    expect(body2.idempotency_key).toBe(sharedIdemKey)
  })

  it('4. Rejects request client-side if admin session is missing or price is non-positive', async () => {
    vi.spyOn(authStore, 'getSession').mockReturnValue(null)

    const result = await updateAdminGpuPrice('gpu-104', 300)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('Unauthenticated')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('5. Rejects invalid price or missing gpuId client-side without calling fetch', async () => {
    const invalidPrice = await updateAdminGpuPrice('gpu-101', -50)
    expect(invalidPrice.ok).toBe(false)
    expect(invalidPrice.error).toContain('greater than 0')

    const zeroPrice = await updateAdminGpuPrice('gpu-101', 0)
    expect(zeroPrice.ok).toBe(false)
    expect(zeroPrice.error).toContain('greater than 0')

    const emptyGpu = await updateAdminGpuPrice('', 150)
    expect(emptyGpu.ok).toBe(false)
    expect(emptyGpu.error).toContain('GPU ID is required')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('6. Handles HTTP 405 Method Not Allowed error response cleanly', async () => {
    mockJsonResponse(405, { detail: 'Method Not Allowed' })

    const result = await updateAdminGpuPrice('gpu-101', 120)
    expect(result.ok).toBe(false)
    expect(result.error).toBe('Method Not Allowed')
    expect(result.data).toBeUndefined()
  })

  it('7. Ensures price update error handling reports clear error message for flash title', async () => {
    mockJsonResponse(400, { detail: 'Price must be greater than zero' })

    const result = await updateAdminGpuPrice('gpu-101', 50)
    expect(result.ok).toBe(false)
    expect(result.error).toBe('Price must be greater than zero')
  })

  it('8. Verifies price update exclusively calls /api/notifications/price-update and never /api/notifications/gpu-listing', async () => {
    mockJsonResponse(200, {
      status: 'success',
      gpu_id: 'gpu-101',
      new_price: 360,
      notifications_created: 10,
      admin_notifications_created: 1,
    })

    const result = await updateAdminGpuPrice('gpu-101', 360)
    expect(result.ok).toBe(true)
    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [calledUrl] = mockFetch.mock.calls[0]
    expect(calledUrl).toContain('/api/notifications/price-update')
    expect(calledUrl).not.toContain('/api/notifications/gpu-listing')
  })

  it('9. Verifies error handling distinguishes price update failure from add listing failure', async () => {
    mockJsonResponse(500, { detail: 'Internal server error during price update' })

    const result = await updateAdminGpuPrice('gpu-101', 360)
    expect(result.ok).toBe(false)
    // The error string is preserved for flash('Failed to update GPU price', result.error)
    expect(result.error).toBe('Internal server error during price update')
  })
})
