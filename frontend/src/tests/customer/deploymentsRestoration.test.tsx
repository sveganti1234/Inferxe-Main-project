import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import DeploymentsPage from '../../features/customer/pages/DeploymentsPage'
import { clearResourceCache } from '../../features/customer/data/resourceCache'
import type { GpuDeployment, GpuOffering } from '../../features/customer/data/serviceClients'
import { ensureFreshSession, getSession } from '../../lib/authStore'

vi.mock('../../lib/authStore', () => ({
  ensureFreshSession: vi.fn(),
  getSession: vi.fn(),
}))

const dep = (over: Partial<GpuDeployment>): GpuDeployment => ({
  id: 'dep-id',
  name: 'dep',
  model_name: 'Model',
  gpu_id: 'l4',
  gpu_model: 'NVIDIA L4',
  provider_id: 'mock',
  provider_instance_id: 'mock-inst-1',
  region: 'in-south-1',
  status: 'running',
  hourly_rate: 41,
  currency: 'INR',
  endpoint_url: null,
  ssh: null,
  ssh_key_ids: [],
  error_message: null,
  started_at: null,
  stopped_at: null,
  created_at: '2026-02-01T09:30:00Z',
  ...over,
})

const DEPLOYMENTS: GpuDeployment[] = [
  dep({
    id: 'dep-h100-prod',
    name: 'llama3-70b-v1',
    model_name: 'Llama 3.1 70B Instruct',
    gpu_model: 'NVIDIA H100 SXM5',
    region: 'Mumbai, IN',
    hourly_rate: 100,
    endpoint_url: 'http://10.244.1.42:8000/v1',
    ssh: { host: '10.244.1.42', port: 2222, username: 'ubuntu', command: 'ssh -p 2222 ubuntu@10.244.1.42' },
  }),
  dep({
    id: 'dep-l4-test',
    name: 'mistral-7b-v0.2',
    model_name: 'Mistral 7B Instruct v0.3',
    gpu_model: 'NVIDIA L4',
    region: 'Hyderabad, IN',
    hourly_rate: 60,
  }),
  dep({
    id: 'dep-a100-qwen',
    name: 'qwen2.5-32b-endpoint',
    model_name: 'Qwen2.5 32B Instruct',
    gpu_model: 'NVIDIA A100',
    region: 'Chennai, IN',
    status: 'provisioning',
    hourly_rate: 210,
  }),
]

const OFFERINGS: Partial<GpuOffering>[] = [
  { gpu_id: 'l4', name: 'NVIDIA L4 Tensor Core', provider_id: 'mock', vram_gb: 24, hourly_price_inr: 41, pricing_type: 'on_demand', region: 'in-south-1', available_quantity: 16, is_available: true },
  { gpu_id: 'l40s', name: 'NVIDIA L40S Tensor Core', provider_id: 'mock', vram_gb: 48, hourly_price_inr: 118, pricing_type: 'on_demand', region: 'in-south-1', available_quantity: 24, is_available: true },
]

const SSH_KEYS = [
  { id: 'key-1', name: 'laptop', public_key: 'ssh-ed25519 AAAA', fingerprint: 'SHA256:abc', key_type: 'ssh-ed25519', created_at: '2026-01-01T00:00:00Z' },
]

type Call = { method: string; url: string; body: unknown }
let calls: Call[] = []
let deploymentsResponse: GpuDeployment[] = DEPLOYMENTS
let createResponse: { status: number; body: unknown } = { status: 201, body: DEPLOYMENTS[1] }

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

let root: Root | null = null
let host: HTMLDivElement

beforeEach(() => {
  const session = {
    token: 'valid-test-token',
    user: { id: 'cust-101', fullName: 'Manya Sri', email: 'manya@inferxe.com', username: 'manya', role: 'customer' },
    expiresAt: Date.now() + 3600000,
  }
  vi.mocked(ensureFreshSession).mockResolvedValue(session as never)
  vi.mocked(getSession).mockReturnValue(session as never)
  clearResourceCache()
  calls = []
  deploymentsResponse = DEPLOYMENTS
  createResponse = { status: 201, body: DEPLOYMENTS[1] }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : null })
      if (url.endsWith('/api/v1/gpu/offerings')) return json(200, { success: true, offerings: OFFERINGS })
      if (url.endsWith('/api/v1/ssh-keys')) return json(200, { success: true, keys: SSH_KEYS })
      if (url.endsWith('/api/v1/gpu/deployments') && method === 'GET') return json(200, { success: true, deployments: deploymentsResponse })
      if (url.endsWith('/api/v1/gpu/deployments') && method === 'POST') return json(createResponse.status, createResponse.body)
      const action = url.match(/\/api\/v1\/gpu\/deployments\/([^/]+)(?:\/(stop|resume))?$/)
      if (action) {
        const status = action[2] === 'stop' ? 'stopped' : action[2] === 'resume' ? 'running' : 'terminated'
        return json(200, dep({ id: action[1], status }))
      }
      return json(404, { detail: 'not mocked' })
    }),
  )
})

afterEach(() => {
  if (root) act(() => root!.unmount())
  root = null
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

async function flush(times = 5) {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 15))
    })
  }
}

async function renderDeployments(route = '/dashboard/app/deployments') {
  host = document.createElement('div')
  document.body.appendChild(host)
  await act(async () => {
    root = createRoot(host)
    root.render(
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route path="/dashboard/app/deployments" element={<DeploymentsPage />} />
        </Routes>
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

const click = async (el: Element | null) => {
  expect(el).toBeTruthy()
  await act(async () => {
    ;(el as HTMLElement).click()
  })
  await flush()
}

const buttonByText = (text: string) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(text)) ?? null

describe('Customer Deployments (GPU provider API)', () => {
  it('renders all four summary cards with accurate calculations', async () => {
    await renderDeployments()
    const text = document.body.textContent ?? ''
    expect(text).toContain('TOTAL DEPLOYMENTS')
    expect(text).toContain('RUNNING ENDPOINTS')
    expect(text).toContain('PROVISIONING')
    expect(text).toContain('HOURLY SPEND')
    expect(text).toContain('₹160/hr') // running only: 100 + 60
    expect(calls[0]).toMatchObject({ method: 'GET' })
    expect(calls[0].url).toMatch(/\/api\/v1\/gpu\/deployments$/)
  })

  it('renders the deployment table with real lifecycle actions', async () => {
    await renderDeployments()
    const text = document.body.textContent ?? ''
    for (const s of ['ENDPOINT NAME', 'MODEL', 'GPU', 'REGION', 'RATE', 'STATUS']) expect(text).toContain(s)
    expect(text).toContain('llama3-70b-v1')
    expect(text).toContain('NVIDIA H100 SXM5')
    expect(text).toContain('₹100/hr')
    expect(text).toContain('qwen2.5-32b-endpoint')
    expect(text).toContain('Provisioning')

    expect(document.querySelector('button[aria-label="Stop deployment llama3-70b-v1"]')).toBeTruthy()
    expect(document.querySelector('button[aria-label="Restart deployment llama3-70b-v1"]')).toBeNull()
    expect(document.querySelector('button[aria-label="Terminate deployment llama3-70b-v1"]')).toBeTruthy()
  })

  it('filters deployments using search input and status pills', async () => {
    await renderDeployments()
    await setValue(document.querySelector('input[placeholder*="Search by name"]') as HTMLInputElement, 'Mistral')
    await flush()
    expect(document.body.textContent).toContain('mistral-7b-v0.2')
    expect(document.body.textContent).not.toContain('llama3-70b-v1')

    await setValue(document.querySelector('input[placeholder*="Search by name"]') as HTMLInputElement, '')
    await click([...document.querySelectorAll('button.cx-deploy-pill-btn')].find((b) => b.textContent?.includes('Provisioning')) ?? null)
    expect(document.body.textContent).toContain('qwen2.5-32b-endpoint')
    expect(document.body.textContent).not.toContain('mistral-7b-v0.2')
  })

  it('shows the real endpoint and SSH command in the details dialog', async () => {
    await renderDeployments()
    await click(document.querySelector('button[aria-label="View details for llama3-70b-v1"]'))
    const text = document.body.textContent ?? ''
    expect(text).toContain('http://10.244.1.42:8000/v1')
    expect(text).toContain('ssh -p 2222 ubuntu@10.244.1.42')
    expect(text).toContain('QUICK START (cURL)')
    expect(text).not.toContain('endpoints.inferxe.com') // no invented URLs
  })

  it('launches with server-priced offering, selected SSH key and an idempotency key (no client price)', async () => {
    await renderDeployments('/dashboard/app/deployments?gpu=NVIDIA%20L40S')
    expect(document.body.textContent).toContain('Deploy New Model Endpoint')
    expect(document.body.textContent).toContain('₹118/hr') // pre-selected L40S offering price

    await click(document.querySelector('.cx-check input[type="checkbox"]'))
    await click(buttonByText('Deploy Endpoint'))

    const post = calls.find((c) => c.method === 'POST' && c.url.endsWith('/api/v1/gpu/deployments'))!
    expect(post.body).toMatchObject({ gpu_id: 'l40s', provider_id: 'mock', ssh_key_ids: ['key-1'] })
    expect((post.body as Record<string, unknown>).idempotency_key).toEqual(expect.any(String))
    expect(post.body).not.toHaveProperty('hourly_rate')
    expect(document.body.textContent).toContain('launched')
  })

  it('shows the provider failure message and keeps the dialog open', async () => {
    createResponse = { status: 502, body: { detail: { message: 'The GPU provider returned an error.', deployment: DEPLOYMENTS[2] } } }
    await renderDeployments('/dashboard/app/deployments?action=new')
    await click(buttonByText('Deploy Endpoint'))
    expect(document.body.textContent).toContain('The GPU provider returned an error.')
    expect(document.body.textContent).toContain('Deploy New Model Endpoint')
  })

  it('keeps the idempotency key after a gateway error and replaces it after a refusal', async () => {
    const keys = () =>
      calls
        .filter((c) => c.method === 'POST' && c.url.endsWith('/api/v1/gpu/deployments'))
        .map((c) => (c.body as Record<string, unknown>).idempotency_key)
    createResponse = { status: 504, body: { detail: 'The GPU provider did not respond in time.' } }
    await renderDeployments('/dashboard/app/deployments?action=new')
    await click(buttonByText('Deploy Endpoint'))
    await click(buttonByText('Deploy Endpoint'))
    createResponse = { status: 409, body: { detail: 'The requested GPU is not available right now.' } }
    await click(buttonByText('Deploy Endpoint'))
    await click(buttonByText('Deploy Endpoint'))
    const [first, retry, refused, afterRefusal] = keys()
    expect(retry).toBe(first)
    expect(refused).toBe(first)
    expect(afterRefusal).not.toBe(first)
  })

  it('reports a retried launch that returns a failed record as an error', async () => {
    createResponse = { status: 201, body: { ...DEPLOYMENTS[2], status: 'failed' } }
    await renderDeployments('/dashboard/app/deployments?action=new')
    await click(buttonByText('Deploy Endpoint'))
    expect(document.body.textContent).toContain('could not be launched')
    expect(document.body.textContent).toContain('Deploy New Model Endpoint')
  })

  it('stops and terminates through the provider API', async () => {
    await renderDeployments()
    await click(document.querySelector('button[aria-label="Stop deployment llama3-70b-v1"]'))
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/api/v1/gpu/deployments/dep-h100-prod/stop'))).toBe(true)

    await click(document.querySelector('button[aria-label="Terminate deployment llama3-70b-v1"]'))
    await click(buttonByText('Terminate deployment'))
    expect(calls.some((c) => c.method === 'DELETE' && c.url.endsWith('/api/v1/gpu/deployments/dep-h100-prod'))).toBe(true)
  })

  it('shows proper empty state when there are no deployments', async () => {
    deploymentsResponse = []
    await renderDeployments()
    expect(document.body.textContent).toContain('No deployment records')
    expect(document.querySelector('button[aria-label="New deployment"]')).toBeTruthy()
  })
})
