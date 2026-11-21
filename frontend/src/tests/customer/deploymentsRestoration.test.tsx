import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import DeploymentsPage from '../../features/customer/pages/DeploymentsPage'
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
    full_name: 'Manya Sri',
    email: 'manya@inferxe.com',
    username: 'manya',
    avatar_path: null,
    role: 'customer',
    status: 'active',
    organization_id: null,
  },
  organizations: [],
  organization_members: [],
  user_access_policies: [],
  gpu_providers: [],
  gpu_listings: [],
  saved_gpu_listings: [],
  deployments: [
    {
      id: 'dep-h100-prod',
      user_id: 'cust-101',
      organization_id: null,
      listing_id: 'list-1',
      name: 'llama3-70b-v1',
      model_name: 'Llama 3.1 70B Instruct',
      gpu_model: 'NVIDIA H100 SXM5',
      region: 'Mumbai, IN',
      status: 'running',
      hourly_rate: 100,
      currency: 'INR',
      endpoint_url: 'https://llama3-70b-v1.endpoints.inferxe.com/v1',
      started_at: '2026-02-01T10:00:00Z',
      stopped_at: null,
      metadata: null,
      created_at: '2026-02-01T09:30:00Z',
      updated_at: '2026-02-01T10:00:00Z',
    },
    {
      id: 'dep-l4-test',
      user_id: 'cust-101',
      organization_id: null,
      listing_id: 'list-2',
      name: 'mistral-7b-v0.2',
      model_name: 'Mistral 7B Instruct v0.3',
      gpu_model: 'NVIDIA L4',
      region: 'Hyderabad, IN',
      status: 'running',
      hourly_rate: 60,
      currency: 'INR',
      endpoint_url: 'https://mistral-7b.endpoints.inferxe.com/v1',
      started_at: '2026-02-02T12:00:00Z',
      stopped_at: null,
      metadata: null,
      created_at: '2026-02-02T11:45:00Z',
      updated_at: '2026-02-02T12:00:00Z',
    },
    {
      id: 'dep-a100-qwen',
      user_id: 'cust-101',
      organization_id: null,
      listing_id: 'list-3',
      name: 'qwen2.5-32b-endpoint',
      model_name: 'Qwen2.5 32B Instruct',
      gpu_model: 'NVIDIA A100',
      region: 'Chennai, IN',
      status: 'provisioning',
      hourly_rate: 210,
      currency: 'INR',
      endpoint_url: 'https://qwen32b.endpoints.inferxe.com/v1',
      started_at: null,
      stopped_at: null,
      metadata: null,
      created_at: '2026-02-03T08:00:00Z',
      updated_at: '2026-02-03T08:00:00Z',
    },
  ],
  orders: [],
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

const EMPTY_WORKSPACE: CustomerWorkspace = {
  ...MOCK_WORKSPACE,
  deployments: [],
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

async function renderDeployments(ws: CustomerWorkspace = MOCK_WORKSPACE, route = '/dashboard/app/deployments') {
  host = document.createElement('div')
  document.body.appendChild(host)
  await act(async () => {
    root = createRoot(host)
    root.render(
      <MemoryRouter initialEntries={[route]}>
        <WorkspaceProvider loader={() => Promise.resolve(ws)}>
          <Routes>
            <Route path="/dashboard/app/deployments" element={<DeploymentsPage />} />
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

describe('Customer Deployments Restoration', () => {
  it('renders all four summary cards with accurate calculations', async () => {
    await renderDeployments(MOCK_WORKSPACE)
    const text = document.body.textContent ?? ''

    // Card 1: TOTAL DEPLOYMENTS
    expect(text).toContain('TOTAL DEPLOYMENTS')
    expect(text).toContain('3')

    // Card 2: RUNNING ENDPOINTS
    expect(text).toContain('RUNNING ENDPOINTS')
    expect(text).toContain('2')

    // Card 3: PROVISIONING
    expect(text).toContain('PROVISIONING')
    expect(text).toContain('1')

    // Card 4: HOURLY SPEND (100 + 60 = 160)
    expect(text).toContain('HOURLY SPEND')
    expect(text).toContain('₹160/hr')
  })

  it('renders the deployment table with all 7 columns matching the old reference', async () => {
    await renderDeployments(MOCK_WORKSPACE)
    const text = document.body.textContent ?? ''

    // Header & Toolbar
    expect(text).toContain('Deployments')
    expect(text).toContain('Manage your model endpoints and deployment lifecycle.')
    expect(text).toContain('Back to overview')
    expect(text).toContain('Model Deployments')

    // Columns: ENDPOINT NAME, MODEL, GPU, REGION, RATE, STATUS, ACTIONS
    expect(text).toContain('ENDPOINT NAME')
    expect(text).toContain('MODEL')
    expect(text).toContain('GPU')
    expect(text).toContain('REGION')
    expect(text).toContain('RATE')
    expect(text).toContain('STATUS')

    // Data verification
    expect(text).toContain('llama3-70b-v1')
    expect(text).toContain('Llama 3.1 70B Instruct')
    expect(text).toContain('NVIDIA H100 SXM5')
    expect(text).toContain('Mumbai, IN')
    expect(text).toContain('₹100/hr')
    expect(text).toContain('Running')

    expect(text).toContain('mistral-7b-v0.2')
    expect(text).toContain('Mistral 7B Instruct v0.3')
    expect(text).toContain('NVIDIA L4')
    expect(text).toContain('Hyderabad, IN')
    expect(text).toContain('₹60/hr')

    expect(text).toContain('qwen2.5-32b-endpoint')
    expect(text).toContain('Provisioning')

    // Action buttons
    expect(document.querySelector('button[aria-label="Stop deployment llama3-70b-v1"]')).toBeTruthy()
    expect(document.querySelector('button[aria-label="Restart deployment llama3-70b-v1"]')).toBeTruthy()
    expect(document.querySelector('button[aria-label="View details for llama3-70b-v1"]')).toBeTruthy()
    expect(document.querySelector('button[aria-label="Delete deployment llama3-70b-v1"]')).toBeTruthy()
  })

  it('filters deployments using search input', async () => {
    await renderDeployments(MOCK_WORKSPACE)
    const searchInput = document.querySelector('input[placeholder*="Search by name"]') as HTMLInputElement
    expect(searchInput).toBeTruthy()

    // Filter by model
    await setValue(searchInput, 'Mistral')
    await flush()

    expect(document.body.textContent).toContain('mistral-7b-v0.2')
    expect(document.body.textContent).not.toContain('llama3-70b-v1')
    expect(document.body.textContent).not.toContain('qwen2.5-32b')
  })

  it('filters deployments using status filter pills', async () => {
    await renderDeployments(MOCK_WORKSPACE)

    // Click Provisioning filter
    const provisioningBtn = [...document.querySelectorAll('button.cx-deploy-pill-btn')].find((b) =>
      b.textContent?.includes('Provisioning'),
    ) as HTMLElement
    expect(provisioningBtn).toBeTruthy()

    await act(async () => {
      provisioningBtn.click()
    })
    await flush()

    expect(document.body.textContent).toContain('qwen2.5-32b-endpoint')
    expect(document.body.textContent).not.toContain('llama3-70b-v1')
    expect(document.body.textContent).not.toContain('mistral-7b-v0.2')
  })

  it('opens Deployment Details dialog when clicking details button', async () => {
    await renderDeployments(MOCK_WORKSPACE)
    const detailsBtn = document.querySelector('button[aria-label="View details for llama3-70b-v1"]') as HTMLElement
    expect(detailsBtn).toBeTruthy()

    await act(async () => {
      detailsBtn.click()
    })
    await flush()

    // Dialog content
    expect(document.body.textContent).toContain('DEPLOYMENT ID')
    expect(document.body.textContent).toContain('ENDPOINT URL')
    expect(document.body.textContent).toContain('https://llama3-70b-v1.endpoints.inferxe.com/v1')
    expect(document.body.textContent).toContain('QUICK START (cURL)')
  })

  it('pre-populates New Deployment dialog when routed with query parameters', async () => {
    await renderDeployments(
      MOCK_WORKSPACE,
      '/dashboard/app/deployments?model=NVIDIA%20L40S&region=Mumbai,%20IN&action=new',
    )

    // Modal should be open
    expect(document.body.textContent).toContain('Deploy New Model Endpoint')
    expect(document.body.textContent).toContain('Estimated Hourly Burn:')
  })

  it('shows proper empty state when 0 deployment records exist', async () => {
    await renderDeployments(EMPTY_WORKSPACE)
    expect(document.body.textContent).toContain('No deployment records')
    expect(document.body.textContent).toContain('You have not deployed any model endpoints yet')
    expect(document.querySelector('button[aria-label="New deployment"]')).toBeTruthy()
  })
})
