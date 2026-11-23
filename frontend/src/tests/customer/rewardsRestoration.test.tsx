import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import RewardsPage from '../../features/customer/pages/RewardsPage'
import { WorkspaceProvider } from '../../features/customer/data/WorkspaceContext'
import type { CustomerWorkspace } from '../../features/customer/data/types'
import { ensureFreshSession, getSession } from '../../lib/authStore'

vi.mock('../../lib/authStore', () => ({
  ensureFreshSession: vi.fn(),
  getSession: vi.fn(),
}))

const MOCK_WORKSPACE: CustomerWorkspace = {
  profile: {
    user_id: 'cust-101',
    full_name: 'Veganti Sahith',
    email: 'veganti@inferxe.com',
    username: 'vegantisa',
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
  wallet_accounts: [],
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

describe('Customer Rewards & Discounts Restoration (image19.png)', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.mocked(getSession).mockReturnValue({
      user: {
        id: 'cust-101',
        email: 'veganti@inferxe.com',
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

  async function renderRewards(initialUrl = '/dashboard/app/rewards') {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={[initialUrl]}>
          <WorkspaceProvider initialWorkspace={MOCK_WORKSPACE}>
            <Routes>
              <Route path="/dashboard/app/rewards" element={<RewardsPage />} />
              <Route path="/dashboard/app" element={<div>Overview Mock</div>} />
              <Route path="/dashboard/app/checkout" element={<div>Checkout Mock</div>} />
            </Routes>
          </WorkspaceProvider>
        </MemoryRouter>,
      )
    })
    await flush()
  }

  it('renders breadcrumb, page title, description, and backlink', async () => {
    await renderRewards()
    const text = container.textContent ?? ''

    expect(text).toContain('Customer Portal / Rewards & Discounts')
    expect(text).toContain('Rewards & Discounts')
    expect(text).toContain('Referral discounts, coupon codes and creator trial codes.')
    expect(text).toContain('Back to overview')
    expect(text).toContain('Refer friends, earn checkout discounts, and redeem creator codes for a 1-hour trial.')
  })

  it('renders top stat cards for Friends joined and Referral discount earned', async () => {
    await renderRewards()
    const text = container.textContent ?? ''

    expect(text).toContain('Friends joined')
    expect(text).toContain('0')
    expect(text).toContain('Demo counter')
    expect(text).toContain('Referral discount earned')
    expect(text).toContain('0%')
    expect(text).toContain('5% per friend, max 30%')
  })

  it('renders Your referral card with generated referral code and link', async () => {
    await renderRewards()
    const text = container.textContent ?? ''

    expect(text).toContain('Your referral')
    expect(text).toContain('/signup?ref=REF-VEGAN15')
    expect(text).toContain('Friends get FRIEND15 (15% off) at checkout')
    expect(text).toContain('Copy code REF-VEGAN15')
    expect(text).toContain('Simulate friend joining')
  })

  it('increments friends joined and discount earned when Simulate friend joining is clicked', async () => {
    await renderRewards()

    const simulateBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Simulate friend joining'),
    )
    expect(simulateBtn).toBeDefined()

    await act(async () => {
      simulateBtn?.click()
    })
    await flush()

    let text = container.textContent ?? ''
    expect(text).toContain('1')
    expect(text).toContain('5%')

    // Click again
    await act(async () => {
      simulateBtn?.click()
    })
    await flush()

    text = container.textContent ?? ''
    expect(text).toContain('2')
    expect(text).toContain('10%')
  })

  it('redeems creator code YOUTUBE1HR and displays success message', async () => {
    await renderRewards()

    const creatorInput = container.querySelector('.cx-creator-input') as HTMLInputElement
    const redeemBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Redeem code'),
    )
    expect(creatorInput).toBeDefined()
    expect(redeemBtn).toBeDefined()

    const setInputValue = (input: HTMLInputElement, val: string) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, val)
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    }

    await act(async () => {
      setInputValue(creatorInput, 'YOUTUBE1HR')
    })
    await act(async () => {
      redeemBtn?.click()
    })
    await flush()

    const text = container.textContent ?? ''
    expect(text).toContain('code accepted — 1-hour trial started!')
    expect(text).toContain('Redeemed: YOUTUBE1HR')
  })

  it('shows error for invalid creator code', async () => {
    await renderRewards()

    const creatorInput = container.querySelector('.cx-creator-input') as HTMLInputElement
    const redeemBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Redeem code'),
    )

    const setInputValue = (input: HTMLInputElement, val: string) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, val)
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    }

    await act(async () => {
      setInputValue(creatorInput, 'FAKECODE123')
    })
    await act(async () => {
      redeemBtn?.click()
    })
    await flush()

    const text = container.textContent ?? ''
    expect(text).toContain('Invalid creator code')
  })

  it('renders Available coupon codes table with INFERXE10, LAUNCH50, and FRIEND15', async () => {
    await renderRewards()
    const text = container.textContent ?? ''

    expect(text).toContain('Available coupon codes')
    expect(text).toContain('Apply at Checkout →')
    expect(text).toContain('INFERXE10')
    expect(text).toContain('10% off')
    expect(text).toContain('Standard')
    expect(text).toContain('LAUNCH50')
    expect(text).toContain('₹500 off')
    expect(text).toContain('Launch')
    expect(text).toContain('FRIEND15')
    expect(text).toContain('15% off')
    expect(text).toContain('Referral (friend of a user)')
  })
})
