import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import HelpPage from '../../features/customer/pages/HelpPage'
import { WorkspaceProvider } from '../../features/customer/data/WorkspaceContext'
import type { CustomerWorkspace } from '../../features/customer/data/types'

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
  inference_requests: [],
}

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let host: HTMLDivElement

beforeEach(() => {
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

const renderHelp = async () => {
  await act(async () => {
    root?.render(
      <MemoryRouter initialEntries={['/dashboard/app/help']}>
        <WorkspaceProvider loader={async () => mockWorkspace}>
          <Routes>
            <Route path="/dashboard/app/help" element={<HelpPage />} />
          </Routes>
        </WorkspaceProvider>
      </MemoryRouter>,
    )
  })
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20))
  })
}

function setInputValue(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  setter?.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
}

describe('FAQ & Support Hub (Chatbot and Help) Restoration', () => {
  it('renders breadcrumb, page header, description, and backlink', async () => {
    await renderHelp()

    const breadcrumb = host.querySelector('.cx-page-breadcrumb')
    expect(breadcrumb?.textContent).toContain('Customer Portal')
    expect(breadcrumb?.textContent).toContain('FAQ & Support Hub')

    const header = host.querySelector('.cx-page-header')
    expect(header?.textContent).toContain('FAQ & Support Hub')
    expect(header?.textContent).toContain(
      'Frequently asked questions, architecture guidelines, and support.',
    )

    const backLink = header?.querySelector('a')
    expect(backLink?.textContent).toContain('Back to overview')
    expect(backLink?.getAttribute('href')).toBe('/dashboard/app')
  })

  it('renders Section Toolbar with OpenAI SDK Docs button', async () => {
    await renderHelp()

    const toolbar = host.querySelector('.cx-faq-toolbar')
    expect(toolbar?.textContent).toContain('Frequently Asked Questions & Support Hub')
    expect(toolbar?.textContent).toContain(
      'Technical architecture, pricing guarantees, hardware specifications, and API documentation.',
    )

    const docBtn = toolbar?.querySelector('.cx-faq-doc-btn')
    expect(docBtn?.textContent).toContain('OpenAI SDK Docs')
  })

  it('renders category tabs and search input', async () => {
    await renderHelp()

    const searchInput = host.querySelector('input[type="search"]') as HTMLInputElement
    expect(searchInput).toBeTruthy()
    expect(searchInput.placeholder).toBe('Search FAQ keywords...')

    const categoryTabs = host.querySelectorAll('.cx-faq-cat-pill')
    const labels = [...categoryTabs].map((t) => t.textContent)
    expect(labels).toContain('All Categories')
    expect(labels).toContain('Hardware')
    expect(labels).toContain('Billing')
    expect(labels).toContain('Deployments')
    expect(labels).toContain('APIs')
  })

  it('renders reference questions and toggles accordion items', async () => {
    await renderHelp()

    expect(host.textContent).toContain('How does Inferxe ensure sovereign GPU compute for Indian enterprises?')
    expect(host.textContent).toContain('Which GPU models are available for deployment?')
    expect(host.textContent).toContain('How does demo wallet billing and trial time work?')
    expect(host.textContent).toContain('Are there discount coupons available?')
    expect(host.textContent).toContain('Can I deploy custom weights from Hugging Face or private registries?')
    expect(host.textContent).toContain('Is the API compatible with the standard OpenAI Python SDK?')

    // First question is open by default
    expect(host.textContent).toContain('Tier-IV MeitY-empanelled datacenters located physically in Mumbai')

    // Find second question button and click it to expand
    const buttons = [...host.querySelectorAll<HTMLButtonElement>('.cx-faq__btn')]
    const gpuBtn = buttons.find((b) => b.textContent?.includes('Which GPU models are available'))
    expect(gpuBtn).toBeTruthy()

    await act(async () => {
      gpuBtn?.click()
    })

    // Now answer 2 is visible
    expect(host.textContent).toContain('NVIDIA L4 (24GB Ada), L40S (48GB Ada), A100 (80GB SXM4)')
  })

  it('filters questions by category pill', async () => {
    await renderHelp()

    const categoryTabs = [...host.querySelectorAll<HTMLButtonElement>('.cx-faq-cat-pill')]
    const hardwareTab = categoryTabs.find((t) => t.textContent === 'Hardware')
    expect(hardwareTab).toBeTruthy()

    await act(async () => {
      hardwareTab?.click()
    })

    expect(host.textContent).toContain('Which GPU models are available for deployment?')
  })

  it('filters questions by search query', async () => {
    await renderHelp()

    const searchInput = host.querySelector('input[type="search"]') as HTMLInputElement
    await act(async () => {
      setInputValue(searchInput, 'coupons')
    })

    expect(host.textContent).toContain('Are there discount coupons available?')
  })

  it('dispatches inferxe_open_bot window event when clicking Open the assistant', async () => {
    const listener = vi.fn()
    window.addEventListener('inferxe_open_bot', listener)

    await renderHelp()

    const botBtn = host.querySelector('.cx-faq-open-bot-btn') as HTMLButtonElement
    expect(botBtn).toBeTruthy()

    await act(async () => {
      botBtn.click()
    })

    expect(listener).toHaveBeenCalledTimes(1)
    window.removeEventListener('inferxe_open_bot', listener)
  })
})
