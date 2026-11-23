import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import OrdersPage from '../../features/customer/pages/OrdersPage'
import { WorkspaceProvider } from '../../features/customer/data/WorkspaceContext'
import type { CustomerWorkspace, Order } from '../../features/customer/data/types'
import { ensureFreshSession, getSession } from '../../lib/authStore'

vi.mock('../../lib/authStore', () => ({
  ensureFreshSession: vi.fn(),
  getSession: vi.fn(),
}))

const MOCK_ORDERS: Order[] = [
  {
    id: 'ord_1',
    user_id: 'cust-101',
    organization_id: 'org_test',
    deployment_id: 'dep_1',
    order_number: 'ORD-8492',
    item_name: 'Qwen 2.5 7B · 1x NVIDIA L4',
    provider_name: 'Yotta NM1 (Mumbai)',
    order_date: '2026-10-10T14:30:00Z',
    duration_minutes: 1440,
    total_cost: 1440,
    currency: 'INR',
    status: 'running',
    details: {
      gpu_model: '1x NVIDIA L4',
      workload: 'Qwen 2.5 7B',
      datacenter: 'Yotta NM1 (Mumbai)',
      specs: '24GB VRAM · 300 GB/s · PCIe Gen 4',
      start_date: '10 Oct 2026, 14:30',
      end_date: '11 Oct 2026, 14:30',
      duration: '24 hours',
      estimated_cost: '₹1,440',
      actual_cost: '₹1,440',
      payment_method: 'Prepaid Wallet',
      payment_status: 'Active Debit',
      transaction_id: 'TX-1048',
      invoice_number: 'INV-2026-08492',
    },
    created_at: '2026-10-10T14:30:00Z',
    updated_at: '2026-10-10T14:30:00Z',
  },
  {
    id: 'ord_2',
    user_id: 'cust-101',
    organization_id: 'org_test',
    deployment_id: 'dep_2',
    order_number: 'ORD-8431',
    item_name: 'Llama 3.1 8B · 1x NVIDIA L40S',
    provider_name: 'E2E Cloud (Noida)',
    order_date: '2026-10-08T09:15:00Z',
    duration_minutes: 720,
    total_cost: 1200,
    currency: 'INR',
    status: 'completed',
    details: {
      gpu_model: '1x NVIDIA L40S',
      workload: 'Llama 3.1 8B',
      datacenter: 'E2E Cloud (Noida)',
      specs: '48GB VRAM · 864 GB/s · Ada Lovelace',
      start_date: '08 Oct 2026, 09:15',
      end_date: '08 Oct 2026, 21:15',
      duration: '12 hours',
      estimated_cost: '₹1,200',
      actual_cost: '₹1,200',
      payment_method: 'Prepaid Wallet',
      payment_status: 'Paid & Settled',
      transaction_id: 'TX-1032',
      invoice_number: 'INV-2026-08431',
    },
    created_at: '2026-10-08T09:15:00Z',
    updated_at: '2026-10-08T21:15:00Z',
  },
  {
    id: 'ord_3',
    user_id: 'cust-101',
    organization_id: 'org_test',
    deployment_id: null,
    order_number: 'ORD-8390',
    item_name: 'DeepSeek R1 671B · 8x NVIDIA H100',
    provider_name: 'CtrlS Datacenters (Hyderabad)',
    order_date: '2026-10-04T16:00:00Z',
    duration_minutes: 240,
    total_cost: 8800,
    currency: 'INR',
    status: 'completed',
    details: {
      gpu_model: '8x NVIDIA H100',
      workload: 'DeepSeek R1 671B',
      datacenter: 'CtrlS Datacenters (Hyderabad)',
      specs: '640GB SXM5 · 3.35 TB/s · NVLink 4',
      start_date: '04 Oct 2026, 16:00',
      end_date: '04 Oct 2026, 20:00',
      duration: '4 hours',
      estimated_cost: '₹8,800',
      actual_cost: '₹8,800',
      payment_method: 'Prepaid Wallet',
      payment_status: 'Paid & Settled',
      transaction_id: 'TX-1011',
      invoice_number: 'INV-2026-08390',
    },
    created_at: '2026-10-04T16:00:00Z',
    updated_at: '2026-10-04T20:00:00Z',
  },
  {
    id: 'ord_4',
    user_id: 'cust-101',
    organization_id: 'org_test',
    deployment_id: null,
    order_number: 'ORD-8312',
    item_name: 'Mistral 7B · 1x NVIDIA L4',
    provider_name: 'Yotta NM1 (Mumbai)',
    order_date: '2026-10-01T11:00:00Z',
    duration_minutes: 480,
    total_cost: 480,
    currency: 'INR',
    status: 'cancelled',
    details: {
      gpu_model: '1x NVIDIA L4',
      workload: 'Mistral 7B',
      datacenter: 'Yotta NM1 (Mumbai)',
      specs: '24GB VRAM · 300 GB/s · PCIe Gen 4',
      start_date: '01 Oct 2026, 11:00',
      end_date: '01 Oct 2026, 11:05',
      duration: '8 hours (Cancelled after 5m)',
      estimated_cost: '₹480',
      actual_cost: '₹0',
      payment_method: 'Prepaid Wallet',
      payment_status: 'Refunded',
      transaction_id: 'TX-998',
      invoice_number: 'INV-2026-08312',
    },
    created_at: '2026-10-01T11:00:00Z',
    updated_at: '2026-10-01T11:05:00Z',
  },
  {
    id: 'ord_5',
    user_id: 'cust-101',
    organization_id: 'org_test',
    deployment_id: null,
    order_number: 'ORD-8201',
    item_name: 'CodeQwen 7B · 1x NVIDIA L40S',
    provider_name: 'Sify Infinit (Chennai)',
    order_date: '2026-09-25T08:00:00Z',
    duration_minutes: 4320,
    total_cost: 7200,
    currency: 'INR',
    status: 'archived',
    details: {
      gpu_model: '1x NVIDIA L40S',
      workload: 'CodeQwen 7B',
      datacenter: 'Sify Infinit (Chennai)',
      specs: '48GB VRAM · 864 GB/s · Ada Lovelace',
      start_date: '25 Sep 2026, 08:00',
      end_date: '28 Sep 2026, 08:00',
      duration: '72 hours',
      estimated_cost: '₹7,200',
      actual_cost: '₹7,200',
      payment_method: 'Prepaid Wallet',
      payment_status: 'Paid & Archived',
      transaction_id: 'TX-942',
      invoice_number: 'INV-2026-08201',
    },
    created_at: '2026-09-25T08:00:00Z',
    updated_at: '2026-09-28T08:00:00Z',
  },
]

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
  orders: MOCK_ORDERS,
  usage_records: [],
  wallet: null,
  wallet_transactions: [],
  api_keys: [],
  ssh_public_keys: [],
  notifications: [],
  order_reviews: [],
  notebook_sessions: [],
  inference_requests: [],
  customer_plans: [],
}

let root: Root | null = null
let host: HTMLDivElement

beforeEach(() => {
  vi.mocked(ensureFreshSession).mockResolvedValue({
    token: 'valid-test-token',
    user: { id: 'cust-101', fullName: 'Manya Sri', email: 'manya@inferxe.com', username: 'manya', role: 'customer' },
    expiresAt: Date.now() + 3600000,
  })
  vi.mocked(getSession).mockReturnValue({
    token: 'valid-test-token',
    user: { id: 'cust-101', fullName: 'Manya Sri', email: 'manya@inferxe.com', username: 'manya', role: 'customer' },
    expiresAt: Date.now() + 3600000,
  })
})

afterEach(() => {
  if (root) act(() => root!.unmount())
  root = null
  document.body.replaceChildren()
})

async function flush(times = 5) {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 15))
    })
  }
}

async function renderOrders(ws: CustomerWorkspace = MOCK_WORKSPACE, route = '/dashboard/app/orders') {
  host = document.createElement('div')
  document.body.appendChild(host)
  await act(async () => {
    root = createRoot(host)
    root.render(
      <MemoryRouter initialEntries={[route]}>
        <WorkspaceProvider loader={() => Promise.resolve(ws)}>
          <Routes>
            <Route path="/dashboard/app/orders" element={<OrdersPage />} />
          </Routes>
        </WorkspaceProvider>
      </MemoryRouter>,
    )
  })
  await flush()
}

async function setValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

describe('Customer Orders & Purchase History Restoration', () => {
  it('renders page heading, description, backlink, and New Compute Order button', async () => {
    await renderOrders(MOCK_WORKSPACE)
    const text = document.body.textContent ?? ''

    expect(text).toContain('Orders & Cost History')
    expect(text).toContain('Track active, completed, and archived compute orders.')
    expect(text).toContain('Back to overview')

    const newOrderLinks = Array.from(document.querySelectorAll('a')).filter((a) =>
      a.textContent?.includes('New Compute Order'),
    )
    expect(newOrderLinks.length).toBeGreaterThan(0)
    expect(newOrderLinks[0].getAttribute('href')).toBe('/dashboard/app/gpus')
  })

  it('displays section subtitle and all 5 status filter tabs with accurate counts', async () => {
    await renderOrders(MOCK_WORKSPACE)
    const text = document.body.textContent ?? ''

    expect(text).toContain('Orders & Compute History')
    expect(text).toContain(
      'Track historical and active GPU instance reservations, durations, and estimated expenditures.',
    )

    // Tabs: All 5, Running 1, Completed 2, Cancelled 1, Archived 1
    const tabs = Array.from(document.querySelectorAll('[role="tab"]'))
    expect(tabs.length).toBe(5)
    expect(tabs.map((t) => t.textContent?.trim())).toEqual([
      'All 5',
      'Running 1',
      'Completed 2',
      'Cancelled 1',
      'Archived 1',
    ])
  })

  it('renders table columns and records corresponding to the old reference screenshot', async () => {
    await renderOrders(MOCK_WORKSPACE)
    const text = document.body.textContent ?? ''

    // Table Headers
    const ths = Array.from(document.querySelectorAll('th')).map((t) => t.textContent?.trim())
    expect(ths).toContain('Order ID')
    expect(ths).toContain('Workload / Hardware')
    expect(ths).toContain('Datacenter Facility')
    expect(ths).toContain('Order Date')
    expect(ths).toContain('Duration')
    expect(ths).toContain('Estimated Cost')
    expect(ths).toContain('Status')
    expect(ths).toContain('Action')

    // Records from image4.png
    expect(text).toContain('ORD-8492')
    expect(text).toContain('Qwen 2.5 7B · 1x NVIDIA L4')
    expect(text).toContain('Yotta NM1 (Mumbai)')
    expect(text).toContain('24 hours')
    expect(text).toContain('₹1,440')
    expect(text).toContain('Running')

    expect(text).toContain('ORD-8431')
    expect(text).toContain('Llama 3.1 8B · 1x NVIDIA L40S')
    expect(text).toContain('E2E Cloud (Noida)')
    expect(text).toContain('12 hours')
    expect(text).toContain('₹1,200')
    expect(text).toContain('Completed')

    expect(text).toContain('ORD-8390')
    expect(text).toContain('DeepSeek R1 671B · 8x NVIDIA H100')
    expect(text).toContain('CtrlS Datacenters (Hyderabad)')
    expect(text).toContain('4 hours')
    expect(text).toContain('₹8,800')

    expect(text).toContain('ORD-8312')
    expect(text).toContain('Mistral 7B · 1x NVIDIA L4')
    expect(text).toContain('Cancelled')

    expect(text).toContain('ORD-8201')
    expect(text).toContain('CodeQwen 7B · 1x NVIDIA L40S')
    expect(text).toContain('Sify Infinit (Chennai)')
    expect(text).toContain('Archived')
  })

  it('filters rows when clicking status tabs without reloading the page', async () => {
    await renderOrders(MOCK_WORKSPACE)
    expect(document.body.textContent).toContain('ORD-8492')
    expect(document.body.textContent).toContain('ORD-8431')

    // Click 'Running' tab
    const runningTab = Array.from(document.querySelectorAll('[role="tab"]')).find((t) =>
      t.textContent?.includes('Running'),
    )
    expect(runningTab).toBeTruthy()
    await act(async () => {
      runningTab!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await flush()

    let text = document.body.textContent ?? ''
    expect(text).toContain('ORD-8492')
    expect(text).not.toContain('ORD-8431')
    expect(text).not.toContain('ORD-8390')
    expect(text).not.toContain('ORD-8312')
    expect(text).not.toContain('ORD-8201')

    // Click 'Completed' tab
    const completedTab = Array.from(document.querySelectorAll('[role="tab"]')).find((t) =>
      t.textContent?.includes('Completed'),
    )
    expect(completedTab).toBeTruthy()
    await act(async () => {
      completedTab!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await flush()

    text = document.body.textContent ?? ''
    expect(text).not.toContain('ORD-8492')
    expect(text).toContain('ORD-8431')
    expect(text).toContain('ORD-8390')
    expect(text).not.toContain('ORD-8312')

    // Click 'Archived' tab
    const archivedTab = Array.from(document.querySelectorAll('[role="tab"]')).find((t) =>
      t.textContent?.includes('Archived'),
    )
    expect(archivedTab).toBeTruthy()
    await act(async () => {
      archivedTab!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await flush()

    text = document.body.textContent ?? ''
    expect(text).toContain('ORD-8201')
    expect(text).not.toContain('ORD-8492')
  })

  it('filters rows via search input', async () => {
    await renderOrders(MOCK_WORKSPACE)
    expect(document.body.textContent).toContain('ORD-8492')

    const searchInput = document.querySelector<HTMLInputElement>('input.cx-search-input')!
    expect(searchInput).toBeTruthy()

    await setValue(searchInput, 'DeepSeek')
    await flush()

    const text = document.body.textContent ?? ''
    expect(text).toContain('ORD-8390')
    expect(text).toContain('DeepSeek R1 671B')
    expect(text).not.toContain('ORD-8492')
    expect(text).not.toContain('ORD-8431')
  })

  it('opens View Details modal with hardware configuration and payment details', async () => {
    await renderOrders(MOCK_WORKSPACE)

    const viewBtn = document.querySelector('button[aria-label="View Details for ORD-8492"]') as HTMLElement
    expect(viewBtn).toBeTruthy()

    await act(async () => {
      viewBtn.click()
    })
    await flush()

    const text = document.body.textContent ?? ''
    expect(text).toContain('Order Details · ORD-8492')
    expect(text).toContain('24GB VRAM · 300 GB/s · PCIe Gen 4')
    expect(text).toContain('Prepaid Wallet')
    expect(text).toContain('TX-1048')
    expect(text).toContain('Active Debit')
    expect(text).toContain('Yotta NM1 (Mumbai)')
  })

  it('opens Tax Invoice modal for completed orders', async () => {
    await renderOrders(MOCK_WORKSPACE)

    const viewBtn = document.querySelector('button[aria-label="View Details for ORD-8431"]') as HTMLElement
    expect(viewBtn).toBeTruthy()

    await act(async () => {
      viewBtn.click()
    })
    await flush()

    const invoiceBtn = Array.from(document.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('View Tax Invoice'),
    ) as HTMLElement
    expect(invoiceBtn).toBeTruthy()

    await act(async () => {
      invoiceBtn.click()
    })
    await flush()

    const text = document.body.textContent ?? ''
    expect(text).toContain('TAX INVOICE')
    expect(text).toContain('INFERXE COMPUTE PLATFORM')
    expect(text).toContain('Total Paid (INR)')
    expect(text).toContain('₹1,200')
    expect(text).toContain('INV-2026-08431')
  })
})
