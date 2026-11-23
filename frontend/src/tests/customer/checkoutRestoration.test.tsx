import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import CheckoutPage from '../../features/customer/pages/CheckoutPage'
import { WorkspaceProvider } from '../../features/customer/data/WorkspaceContext'
import type { CustomerWorkspace } from '../../features/customer/data/types'
import { ensureFreshSession, getSession } from '../../lib/authStore'
import * as serviceClients from '../../features/customer/data/serviceClients'

vi.mock('../../lib/authStore', () => ({
  ensureFreshSession: vi.fn(),
  getSession: vi.fn(),
}))

const MOCK_WORKSPACE: CustomerWorkspace = {
  profile: {
    user_id: 'cust-101',
    full_name: 'Manya Sri',
    email: 'manya@inferxe.com',
    username: 'manya',
    avatar_path: null,
    role: 'customer',
    status: 'active',
    organization_id: 'org_test',
  },
  organizations: [],
  organization_members: [],
  user_access_policies: [],
  gpu_providers: [],
  gpu_listings: [],
  saved_gpu_listings: [],
  deployments: [],
  orders: [],
  usage_records: [],
  wallet_accounts: [
    {
      id: 'wa-1',
      user_id: 'cust-101',
      organization_id: 'org_test',
      balance: 10000,
      currency: 'INR',
      status: 'active',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
  ],
  wallet_transactions: [],
  api_keys: [],
  ssh_public_keys: [],
  notifications: [],
  order_reviews: [],
  notebook_sessions: [],
  inference_requests: [],
  customer_plans: [],
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 30))

describe('Customer Payment & Checkout Restoration (image6.png)', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.mocked(getSession).mockReturnValue({
      user: {
        id: 'cust-101',
        email: 'manya@inferxe.com',
        user_metadata: { role: 'customer' },
      },
      token: 'fake-jwt',
      claims: { sub: 'cust-101', role: 'customer' },
    } as any)
    vi.mocked(ensureFreshSession).mockResolvedValue(true)

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    vi.restoreAllMocks()
  })

  async function renderCheckout(initialUrl = '/dashboard/app/checkout') {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={[initialUrl]}>
          <WorkspaceProvider initialWorkspace={MOCK_WORKSPACE}>
            <Routes>
              <Route path="/dashboard/app/checkout" element={<CheckoutPage />} />
              <Route path="/dashboard/app" element={<div>Overview Mock</div>} />
              <Route path="/dashboard/app/orders" element={<div>Orders Mock</div>} />
            </Routes>
          </WorkspaceProvider>
        </MemoryRouter>,
      )
    })
    await flush()
  }

  it('renders page heading, description, backlink, and View Orders History button', async () => {
    await renderCheckout()
    const text = container.textContent ?? ''

    expect(text).toContain('Payment & Checkout')
    expect(text).toContain('Simulated payment processing with demo coupon discounts.')
    expect(text).toContain('Back to overview')
    expect(text).toContain('Payment & Checkout Simulation')
    expect(text).toContain('Configure dedicated compute duration, apply promotional discount coupons, and simulate reservation.')
    expect(text).toContain('View Orders History')
  })

  it('renders Hardware Configuration card with select, durations, coupon, and payment methods', async () => {
    await renderCheckout()
    const text = container.textContent ?? ''

    expect(text).toContain('Hardware Configuration')
    expect(text).toContain('Demo checkout')
    expect(text).toContain('Select GPU Listing')
    expect(text).toContain('Reservation Duration (Hours)')
    expect(text).toContain('4')
    expect(text).toContain('12')
    expect(text).toContain('24')
    expect(text).toContain('72')
    expect(text).toContain('Promotional Coupon / Discount Code')
    expect(text).toContain('Apply Code')
    expect(text).toContain('Payment Method')
    expect(text).toContain('Prepaid Wallet Balance')
    expect(text).toContain('Available Credits: ₹10,000')
    expect(text).toContain('Corporate Credit Card')
    expect(text).toContain('•••• •••• •••• 4092 (Simulated)')
  })

  it('renders Order Cost Summary card with selected hardware, base compute rate, tax, and total', async () => {
    await renderCheckout()
    const text = container.textContent ?? ''

    expect(text).toContain('Order Cost Summary')
    expect(text).toContain('INR Breakdown')
    expect(text).toContain('Selected Hardware')
    expect(text).toContain('NVIDIA L40S (48 GB)')
    expect(text).toContain('24 Hours Reservation')
    expect(text).toContain('Base Compute Rate (₹100 × 24h)')
    expect(text).toContain('₹2,400')
    expect(text).toContain('CGST + SGST (18%)')
    expect(text).toContain('+₹432')
    expect(text).toContain('Total Amount Payable')
    expect(text).toContain('₹2,832')
    expect(text).toContain('Simulated checkout. No real currency is transferred.')
    expect(text).toContain('Pay & Reserve (₹2,832)')
  })

  it('updates duration selection and recalculates costs when a duration pill is clicked', async () => {
    await renderCheckout()

    const pills = container.querySelectorAll('.cx-checkout-duration-pill')
    expect(pills.length).toBe(4)

    // Click 12 Hours pill
    const twelveHourPill = pills[1] as HTMLButtonElement
    expect(twelveHourPill.textContent).toContain('12')
    await act(async () => {
      twelveHourPill.click()
    })
    await flush()

    const text = container.textContent ?? ''
    expect(text).toContain('12 Hours Reservation')
    expect(text).toContain('Base Compute Rate (₹100 × 12h)')
    expect(text).toContain('₹1,200')
    expect(text).toContain('+₹216') // 18% of 1200
    expect(text).toContain('Total Amount Payable')
    expect(text).toContain('₹1,416')
    expect(text).toContain('Pay & Reserve (₹1,416)')
  })

  it('applies promo coupon INFERXE10 (10% discount) and updates total amount payable', async () => {
    await renderCheckout()

    const couponInput = container.querySelector('.cx-coupon-input') as HTMLInputElement
    const applyBtn = container.querySelector('.cx-coupon-form button[type="submit"]') as HTMLButtonElement

    const setInputValue = (input: HTMLInputElement, val: string) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, val)
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    }

    await act(async () => {
      setInputValue(couponInput, 'INFERXE10')
    })

    await act(async () => {
      applyBtn.click()
    })
    await flush()

    const text = container.textContent ?? ''
    expect(text).toContain('Coupon INFERXE10 applied')
    expect(text).toContain('10% off')
    expect(text).toContain('Promotional Discount (INFERXE10)')
    expect(text).toContain('−₹240') // 10% of 2400
    // Taxable = 2160, 18% Tax = 389, Total = 2549
    expect(text).toContain('₹2,549')
    expect(text).toContain('Pay & Reserve (₹2,549)')
  })

  it('displays error for invalid coupon code', async () => {
    await renderCheckout()

    const couponInput = container.querySelector('.cx-coupon-input') as HTMLInputElement
    const applyBtn = container.querySelector('.cx-coupon-form button[type="submit"]') as HTMLButtonElement

    const setInputValue = (input: HTMLInputElement, val: string) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, val)
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    }

    await act(async () => {
      setInputValue(couponInput, 'INVALIDCODE')
    })

    await act(async () => {
      applyBtn.click()
    })
    await flush()

    const text = container.textContent ?? ''
    expect(text).toContain('Invalid or expired coupon code')
  })

  it('submits Pay & Reserve, calls createOrder, and displays order confirmation receipt', async () => {
    const createOrderSpy = vi.spyOn(serviceClients, 'createOrder').mockResolvedValue({
      id: 'ord_simulated',
      order_number: 'ORD-8599',
    })

    await renderCheckout()

    const payBtn = container.querySelector('.cx-checkout-pay-btn') as HTMLButtonElement
    await act(async () => {
      payBtn.click()
    })

    // Advance timers for simulated settlement
    await act(async () => {
      await new Promise((r) => setTimeout(r, 800))
    })
    await flush()

    expect(createOrderSpy).toHaveBeenCalled()
    const text = container.textContent ?? ''
    expect(text).toContain('Confirmed!')
    expect(text).toContain('Your reservation is now active')
    expect(text).toContain('View in Orders & Cost History')
    expect(text).toContain('Reserve Another')
  })
})
