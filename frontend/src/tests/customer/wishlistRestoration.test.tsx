import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import WishlistPage from '../../features/customer/pages/WishlistPage'
import { WorkspaceProvider } from '../../features/customer/data/WorkspaceContext'
import type { CustomerWorkspace } from '../../features/customer/data/types'
import { WISHLIST_STORAGE_KEY, DEFAULT_WISHLIST_IDS } from '../../features/customer/data/marketplace'

const mockWorkspace: CustomerWorkspace = {
  customer: {
    id: 'cust-1',
    name: 'Vegantisahith',
    email: 'vegantisahith@gmail.com',
    status: 'active',
  },
  profile: {
    id: 'prof-1',
    customer_id: 'cust-1',
    user_id: 'usr-1',
    full_name: 'Vegantisahith',
    email: 'vegantisahith@gmail.com',
    avatar_url: null,
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
  organizations: [
    {
      id: 'org-1',
      name: 'Customer Workspace',
      slug: 'cust-ws',
      status: 'active',
      billing_email: 'vegantisahith@gmail.com',
      created_at: '2026-01-01T00:00:00Z',
    },
  ],
  wallet_accounts: [{ id: 'w-1', balance: 10000, currency: 'INR' }],
  deployments: [],
  instances: [],
  user_access_policies: [],
  gpu_providers: [],
  saved_gpu_listings: [],
  gpu_listings: [],
}

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let host: HTMLDivElement

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem(WISHLIST_STORAGE_KEY, JSON.stringify(DEFAULT_WISHLIST_IDS))
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  if (root) {
    act(() => root?.unmount())
    root = null
  }
  host.remove()
  vi.restoreAllMocks()
})

const renderWishlist = async () => {
  await act(async () => {
    root?.render(
      <MemoryRouter initialEntries={['/dashboard/app/wishlist']}>
        <WorkspaceProvider loader={async () => mockWorkspace}>
          <Routes>
            <Route path="/dashboard/app/wishlist" element={<WishlistPage />} />
          </Routes>
        </WorkspaceProvider>
      </MemoryRouter>
    )
  })
  // Give state updates time to complete
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20))
  })
}

describe('Saved Hardware Wishlist Feature', () => {
  it('renders breadcrumb, page header, description, and back link', async () => {
    await renderWishlist()

    const breadcrumb = host.querySelector('.cx-page-breadcrumb')
    expect(breadcrumb?.textContent).toContain('Customer Portal')
    expect(breadcrumb?.textContent).toContain('Saved Hardware Wishlist')

    const header = host.querySelector('.cx-page-header')
    expect(header?.querySelector('h1')?.textContent).toBe('Saved Hardware Wishlist')
    expect(header?.textContent).toContain('Review your bookmarked GPU listings for quick deployment.')

    const backLink = header?.querySelector('a')
    expect(backLink?.textContent).toContain('Back to overview')
    expect(backLink?.getAttribute('href')).toBe('/dashboard/app')
  })

  it('renders section toolbar with Browse Marketplace button', async () => {
    await renderWishlist()

    const toolbar = host.querySelector('.cx-wishlist-toolbar')
    expect(toolbar).not.toBeNull()
    expect(toolbar?.querySelector('h2')?.textContent).toBe('Saved Hardware Wishlist')
    expect(toolbar?.textContent).toContain('Bookmarked GPU instances saved for instant comparison and deployment.')

    const browseBtn = toolbar?.querySelector('a.cx-browse-mkt-btn')
    expect(browseBtn?.textContent).toContain('Browse Marketplace')
    expect(browseBtn?.getAttribute('href')).toBe('/dashboard/app/gpus')
  })

  it('renders default saved GPU cards (L40S and H100 SXM5) with specs and pricing', async () => {
    await renderWishlist()

    const cards = host.querySelectorAll('.cx-wishlist-card')
    expect(cards.length).toBe(2)

    // First card: NVIDIA L40S
    const card1 = cards[0]
    expect(card1.querySelector('.cx-wishlist-card__title')?.textContent).toBe('NVIDIA L40S')
    expect(card1.querySelector('.cx-wishlist-card__sub')?.textContent).toContain('48 GB VRAM')
    expect(card1.querySelector('.cx-wishlist-card__sub')?.textContent).toContain('Mumbai, IN')
    expect(card1.textContent).toContain('8 GPUs')
    expect(card1.textContent).toContain('₹100/hr')
    expect(card1.textContent).toContain('Available')

    // Second card: NVIDIA H100 SXM5
    const card2 = cards[1]
    expect(card2.querySelector('.cx-wishlist-card__title')?.textContent).toBe('NVIDIA H100 SXM5')
    expect(card2.querySelector('.cx-wishlist-card__sub')?.textContent).toContain('80 GB VRAM')
    expect(card2.querySelector('.cx-wishlist-card__sub')?.textContent).toContain('Mumbai, IN')
    expect(card2.textContent).toContain('8 GPUs')
    expect(card2.textContent).toContain('₹275/hr')

    // Action buttons
    expect(card1.querySelector('.cx-wishlist-btn-deploy')?.textContent).toContain('Select & Deploy →')
    expect(card1.querySelector('.cx-wishlist-btn-remove')?.textContent).toBe('Remove')
  })

  it('handles item removal and transitions to empty state when all removed', async () => {
    await renderWishlist()

    let cards = host.querySelectorAll('.cx-wishlist-card')
    expect(cards.length).toBe(2)

    // Click remove on the first card
    const removeBtn1 = cards[0].querySelector('.cx-wishlist-btn-remove') as HTMLButtonElement
    await act(async () => {
      removeBtn1.click()
    })

    // Check alert message and remaining cards
    expect(host.textContent).toContain('Removed NVIDIA L40S from your wishlist.')
    cards = host.querySelectorAll('.cx-wishlist-card')
    expect(cards.length).toBe(1)
    expect(cards[0].querySelector('.cx-wishlist-card__title')?.textContent).toBe('NVIDIA H100 SXM5')

    // Click heart button on the second card to remove it
    const heartBtn = cards[0].querySelector('.cx-wishlist-heart-btn') as HTMLButtonElement
    await act(async () => {
      heartBtn.click()
    })

    // Should now show empty state
    expect(host.querySelectorAll('.cx-wishlist-card').length).toBe(0)
    expect(host.querySelector('.cx-wishlist-empty-card')).not.toBeNull()
    expect(host.textContent).toContain('Your Wishlist is Empty')
    expect(host.textContent).toContain('Browse the GPU Marketplace and click the heart icon on any instance card to bookmark it.')

    const exploreLink = host.querySelector('.cx-wishlist-empty a')
    expect(exploreLink?.textContent).toContain('Explore GPU Marketplace')
    expect(exploreLink?.getAttribute('href')).toBe('/dashboard/app/gpus')
  })

  it('shows empty state immediately if initial wishlist is empty', async () => {
    localStorage.setItem(WISHLIST_STORAGE_KEY, JSON.stringify([]))
    await renderWishlist()

    expect(host.querySelectorAll('.cx-wishlist-card').length).toBe(0)
    expect(host.querySelector('.cx-wishlist-empty-card')).not.toBeNull()
    expect(host.textContent).toContain('Your Wishlist is Empty')
  })
})
