import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import UsagePage from '../../features/customer/pages/UsagePage'
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
  deployments: [
    {
      id: 'dep-1',
      customer_id: 'cust-1',
      gpu_model: 'L4',
      status: 'running',
      created_at: '2026-01-01T00:00:00Z',
      hourly_cost: 80,
    } as any,
    {
      id: 'dep-2',
      customer_id: 'cust-1',
      gpu_model: 'L40S',
      status: 'running',
      created_at: '2026-01-01T00:00:00Z',
      hourly_cost: 80,
    } as any,
    {
      id: 'dep-3',
      customer_id: 'cust-1',
      gpu_model: 'A100',
      status: 'stopped',
      created_at: '2026-01-01T00:00:00Z',
      hourly_cost: 160,
    } as any,
  ],
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

const renderUsage = async () => {
  await act(async () => {
    root?.render(
      <MemoryRouter initialEntries={['/dashboard/app/usage']}>
        <WorkspaceProvider loader={async () => mockWorkspace}>
          <Routes>
            <Route path="/dashboard/app/usage" element={<UsagePage />} />
          </Routes>
        </WorkspaceProvider>
      </MemoryRouter>
    )
  })
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20))
  })
}

describe('Usage & Analytics Data & Telemetry Restoration', () => {
  it('renders breadcrumb, page title, description, and backlink', async () => {
    await renderUsage()

    const breadcrumb = host.querySelector('.cx-page-breadcrumb')
    expect(breadcrumb?.textContent).toContain('Customer Portal')
    expect(breadcrumb?.textContent).toContain('Usage & Analytics')

    const header = host.querySelector('.cx-page-header')
    expect(header?.querySelector('h1')?.textContent).toBe('Usage & Analytics')
    expect(header?.textContent).toContain('Review illustrative request, token, latency and spend metrics.')

    const backlink = header?.querySelector('a')
    expect(backlink?.textContent).toContain('Back to overview')
    expect(backlink?.getAttribute('href')).toBe('/dashboard/app')
  })

  it('renders section toolbar with title and time filter pills', async () => {
    await renderUsage()

    const toolbar = host.querySelector('.cx-analytics-toolbar')
    expect(toolbar).not.toBeNull()
    expect(toolbar?.querySelector('h2')?.textContent).toBe('Usage & Analytics')
    expect(toolbar?.textContent).toContain('Review real-time inference telemetry, token volumes, TTFT latencies and spend.')

    const pills = host.querySelectorAll('.cx-analytics-pill')
    expect(pills.length).toBe(3)
    expect(pills[0].textContent).toBe('Last 24 Hours')
    expect(pills[1].textContent).toBe('Last 7 Days')
    expect(pills[2].textContent).toBe('Last 30 Days')
    expect(pills[0].classList.contains('is-active')).toBe(true)
  })

  it('renders top 4 metrics for Last 24 Hours by default', async () => {
    await renderUsage()

    const metrics = host.querySelectorAll('.cx-analytics-grid--4 .cx-analytics-metric')
    expect(metrics.length).toBe(4)

    // Total Requests
    expect(metrics[0].textContent).toContain('Total Requests')
    expect(metrics[0].textContent).toContain('128.4k')
    expect(metrics[0].textContent).toContain('+12.8% vs previous period')

    // Tokens Processed
    expect(metrics[1].textContent).toContain('Tokens Processed')
    expect(metrics[1].textContent).toContain('8.62M')
    expect(metrics[1].textContent).toContain('+8.2% token throughput')

    // Median Latency
    expect(metrics[2].textContent).toContain('Median Latency')
    expect(metrics[2].textContent).toContain('184 ms')
    expect(metrics[2].textContent).toContain('0.42s P95 TTFT')

    // Estimated Spend
    expect(metrics[3].textContent).toContain('Estimated Spend')
    expect(metrics[3].textContent).toContain('₹4,820')
    expect(metrics[3].textContent).toContain('Inference runtime budget')
  })

  it('updates metrics and throughput profile when switching time ranges', async () => {
    await renderUsage()

    const pills = host.querySelectorAll('.cx-analytics-pill')

    // Switch to Last 7 Days
    await act(async () => {
      ;(pills[1] as HTMLButtonElement).click()
    })

    const metrics7d = host.querySelectorAll('.cx-analytics-grid--4 .cx-analytics-metric')
    expect(metrics7d[0].textContent).toContain('892.1k')
    expect(metrics7d[1].textContent).toContain('60.4M')
    expect(metrics7d[3].textContent).toContain('₹31,400')
    expect(host.textContent).toContain('7D window')

    // Switch to Last 30 Days
    await act(async () => {
      ;(pills[2] as HTMLButtonElement).click()
    })

    const metrics30d = host.querySelectorAll('.cx-analytics-grid--4 .cx-analytics-metric')
    expect(metrics30d[0].textContent).toContain('3.62M')
    expect(metrics30d[1].textContent).toContain('241.8M')
    expect(metrics30d[3].textContent).toContain('₹1,24,600')
    expect(host.textContent).toContain('30D window')
  })

  it('renders Request Throughput Profile and Workload Breakdown', async () => {
    await renderUsage()

    expect(host.textContent).toContain('Request Throughput Profile')
    expect(host.textContent).toContain('Workload Breakdown')

    // Workload items
    expect(host.textContent).toContain('Prompt Input Tokens')
    expect(host.textContent).toContain('68%')
    expect(host.textContent).toContain('Generated Output Tokens')
    expect(host.textContent).toContain('44%')
    expect(host.textContent).toContain('GPU Runtime Utilization')
    expect(host.textContent).toContain('78%')
    expect(host.textContent).toContain('Successful Requests (200 OK)')
    expect(host.textContent).toContain('99%')
  })

  it('renders second stat row for running models, wallet time left, and free trial', async () => {
    await renderUsage()

    const statRow3 = host.querySelectorAll('.cx-analytics-grid--3 .cx-analytics-metric')
    expect(statRow3.length).toBe(3)

    // Running models
    expect(statRow3[0].textContent).toContain('Running models')
    expect(statRow3[0].textContent).toContain('2')
    expect(statRow3[0].textContent).toContain('3 total deployments')

    // Wallet time left
    expect(statRow3[1].textContent).toContain('Wallet time left')
    expect(statRow3[1].textContent).toContain('62h 30m')
    expect(statRow3[1].textContent).toContain('₹10,000 at ₹160/hr burn')

    // Free trial left
    expect(statRow3[2].textContent).toContain('Free trial left')
    expect(statRow3[2].textContent).toContain('Not started')
    expect(statRow3[2].textContent).toContain('1-hour sandbox')
  })

  it('renders GPU temperature and GPU usage 24h utilization curve', async () => {
    await renderUsage()

    expect(host.textContent).toContain('Existing models & GPU temperature')
    expect(host.textContent).toContain('Qwen2.5-7B-Instruct · L4')
    expect(host.textContent).toContain('61°C')
    expect(host.textContent).toContain('Llama-3.1-8B-Instruct · L40S')
    expect(host.textContent).toContain('53°C')

    expect(host.textContent).toContain('GPU usage - last 24h')
    expect(host.textContent).toContain('% utilization')
    expect(host.querySelector('.cx-analytics-graph')).not.toBeNull()
    expect(host.textContent).toContain('24h ago')
    expect(host.textContent).toContain('12h')
    expect(host.textContent).toContain('now')
  })
})
