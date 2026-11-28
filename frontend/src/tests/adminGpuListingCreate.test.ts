import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createAdminGpuListing,
  type GpuListingCreateResponse,
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

describe('GPU Listing Creation Notification Integration Tests', () => {
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

  it('1. Successfully calls POST /api/notifications/gpu-listing and dispatches notification refresh', async () => {
    const eventSpy = vi.fn()
    window.addEventListener('inferxe_notifications_change', eventSpy)

    const expectedResponse: GpuListingCreateResponse = {
      status: 'success',
      message: "New GPU listing 'NVIDIA L4' added to inventory.",
      listing: {
        id: 'gpu-new-101',
        name: 'NVIDIA L4',
        gpu_model: 'L4',
        gpu: 'L4',
        vram: '24 GB',
        region: 'Hyderabad, IN',
        price: 60.0,
        quantity: 4,
        currency: 'INR',
        billing_unit: 'hr',
        status: 'Available',
        updated_at: new Date().toISOString(),
      },
      admin_notifications_created: 1,
    }
    mockJsonResponse(200, expectedResponse)

    const result = await createAdminGpuListing({
      name: 'NVIDIA L4',
      gpu_model: 'L4',
      vram: '24 GB',
      region: 'Hyderabad, IN',
      price: 60.0,
      quantity: 4,
      idempotency_key: 'idem_create_l4_101',
    })

    expect(result.ok).toBe(true)
    expect(result.data?.status).toBe('success')
    expect(result.data?.listing?.id).toBe('gpu-new-101')
    expect(result.data?.admin_notifications_created).toBe(1)

    // Verify endpoint, method, headers and payload
    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [calledUrl, calledInit] = mockFetch.mock.calls[0]
    expect(calledUrl).toContain('/api/notifications/gpu-listing')
    expect(calledInit.method).toBe('POST')
    expect(calledInit.headers).toEqual(
      expect.objectContaining({
        Authorization: `Bearer ${TEST_ADMIN_TOKEN}`,
        'Content-Type': 'application/json',
      })
    )

    const parsedBody = JSON.parse(calledInit.body)
    expect(parsedBody).toEqual({
      name: 'NVIDIA L4',
      gpu_model: 'L4',
      vram: '24 GB',
      region: 'Hyderabad, IN',
      price: 60,
      quantity: 4,
      currency: 'INR',
      billing_unit: 'hr',
      idempotency_key: 'idem_create_l4_101',
    })

    // Verify notification refresh event was dispatched
    expect(eventSpy).toHaveBeenCalled()
    window.removeEventListener('inferxe_notifications_change', eventSpy)
  })

  it('2. Handles backend API failure cleanly without crashing or dispatching refresh', async () => {
    const eventSpy = vi.fn()
    window.addEventListener('inferxe_notifications_change', eventSpy)

    mockJsonResponse(500, { detail: 'Database transaction rolled back: foreign key constraint failed' })

    const result = await createAdminGpuListing({
      name: 'NVIDIA H100',
      price: 250,
      quantity: 2,
    })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('Database transaction rolled back')
    expect(result.data).toBeUndefined()

    // On failure, inferxe_notifications_change should NOT be dispatched
    expect(eventSpy).not.toHaveBeenCalled()
    window.removeEventListener('inferxe_notifications_change', eventSpy)
  })

  it('3. Preserves idempotency key across retry attempts to prevent duplicate listings and notifications', async () => {
    const sharedIdemKey = 'gpu_create_l4_retry_key_001'

    // First attempt fails with network error
    mockFetch.mockRejectedValueOnce(new Error('Network error'))
    const attempt1 = await createAdminGpuListing({
      name: 'NVIDIA L4',
      price: 60,
      idempotency_key: sharedIdemKey,
    })
    expect(attempt1.ok).toBe(false)

    // Second retry attempt with same idempotency key succeeds with skipped/duplicate
    mockJsonResponse(200, {
      status: 'skipped',
      message: 'Duplicate listing creation event ignored.',
      event_id: 'evt_dup_001',
    })
    const attempt2 = await createAdminGpuListing({
      name: 'NVIDIA L4',
      price: 60,
      idempotency_key: sharedIdemKey,
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

  it('4. Rejects request client-side if name is empty or price is non-positive', async () => {
    const emptyNameRes = await createAdminGpuListing({
      name: '',
      price: 100,
    })
    expect(emptyNameRes.ok).toBe(false)
    expect(emptyNameRes.error).toContain('GPU Name / Model is required')

    const invalidPriceRes = await createAdminGpuListing({
      name: 'NVIDIA L4',
      price: -5,
    })
    expect(invalidPriceRes.ok).toBe(false)
    expect(invalidPriceRes.error).toContain('valid number greater than 0')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('5. Rejects request client-side if admin session is missing', async () => {
    vi.spyOn(authStore, 'getSession').mockReturnValue(null)

    const result = await createAdminGpuListing({
      name: 'NVIDIA L4',
      price: 60,
    })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('Unauthenticated')
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
