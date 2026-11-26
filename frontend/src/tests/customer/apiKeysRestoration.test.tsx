import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import ApiKeysPage from '../../features/customer/pages/ApiKeysPage'
import {
  API_KEYS_STORAGE_KEY,
  DEFAULT_DEMO_API_KEYS,
  listApiKeys,
  getLocalApiKeys,
  saveLocalApiKeys,
  type ApiKeyView,
} from '../../features/customer/data/apiKeys'
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
  localStorage.clear()
  localStorage.setItem(API_KEYS_STORAGE_KEY, JSON.stringify(DEFAULT_DEMO_API_KEYS))
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

const renderApiKeys = async () => {
  await act(async () => {
    root?.render(
      <MemoryRouter initialEntries={['/dashboard/app/api-keys']}>
        <WorkspaceProvider loader={async () => mockWorkspace}>
          <Routes>
            <Route path="/dashboard/app/api-keys" element={<ApiKeysPage />} />
          </Routes>
        </WorkspaceProvider>
      </MemoryRouter>,
    )
  })
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20))
  })
}

function setInputValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto =
    el instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
  setter?.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
}

describe('API Keys & JWT Tokens Feature', () => {
  it('renders breadcrumb, page header, description, and backlink', async () => {
    await renderApiKeys()

    const breadcrumb = host.querySelector('.cx-page-breadcrumb')
    expect(breadcrumb?.textContent).toContain('Customer Portal')
    expect(breadcrumb?.textContent).toContain('API Keys & JWT Tokens')

    const header = host.querySelector('.cx-page-header')
    expect(header?.textContent).toContain('API Keys & JWT Tokens')
    expect(header?.textContent).toContain(
      'Create and manage demo API keys and inspect simulated JWT bearer tokens.',
    )

    const backLink = header?.querySelector('a')
    expect(backLink?.textContent).toContain('Back to overview')
    expect(backLink?.getAttribute('href')).toBe('/dashboard/app')
  })

  it('renders API Credentials toolbar with Create Demo Key button', async () => {
    await renderApiKeys()

    const toolbar = host.querySelector('.cx-api-toolbar')
    expect(toolbar?.textContent).toContain('API Credentials')
    expect(toolbar?.textContent).toContain(
      'Generate and manage authentication tokens for client applications and OpenAI SDK callers.',
    )

    const addBtn = toolbar?.querySelector('.cx-add-key-btn')
    expect(addBtn?.textContent).toContain('Create Demo Key')
  })

  it('displays issued demo keys with key label, secret token, issued date, and active status', async () => {
    await renderApiKeys()

    const card = host.querySelector('.cx-api-card')
    expect(card?.textContent).toContain('Issued API Keys')
    expect(card?.textContent).toContain('2 active')

    // Key 1: Production Backend API
    expect(card?.textContent).toContain('Production Backend API')
    expect(card?.textContent).toContain('key-1')
    expect(card?.textContent).toContain('inf_demo_live_••••••••')
    expect(card?.textContent).toContain('01 Oct 2026')

    // Key 2: Staging Evaluation Key
    expect(card?.textContent).toContain('Staging Evaluation Key')
    expect(card?.textContent).toContain('key-2')
    expect(card?.textContent).toContain('inf_demo_test_••••••••')
    expect(card?.textContent).toContain('06 Oct 2026')

    const activePills = card?.querySelectorAll('.cx-pill--success')
    expect(activePills?.length).toBeGreaterThanOrEqual(2)
  })

  it('copies key token to clipboard and shows feedback banner', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, {
      clipboard: { writeText: writeTextMock },
    })

    await renderApiKeys()

    const copyBtn = host.querySelector('.cx-key-copy-btn') as HTMLButtonElement
    expect(copyBtn).toBeTruthy()

    await act(async () => {
      copyBtn.click()
    })

    expect(writeTextMock).toHaveBeenCalledWith('inf_demo_live_9a8b7c6d5e4f3a2b1c0d8e7f6a5b4c3d')

    const feedback = host.querySelector('.cx-alert--success')
    expect(feedback?.textContent).toContain('copied to clipboard')
  })

  it('opens modal to create demo key, validates input, reveals secret, and adds key to list', async () => {
    await renderApiKeys()

    const createBtn = host.querySelector('.cx-add-key-btn') as HTMLButtonElement
    await act(async () => {
      createBtn.click()
    })

    const dialog = document.body.querySelector('.cx-dialog')
    expect(dialog?.textContent).toContain('Create Demo Key')

    const nameInput = dialog?.querySelector('input[placeholder="Production Backend API"]') as HTMLInputElement
    expect(nameInput).toBeTruthy()

    await act(async () => {
      setInputValue(nameInput, 'Inference Microservice Key')
    })

    const submitBtn = dialog?.querySelector('button[type="submit"]') as HTMLButtonElement
    await act(async () => {
      submitBtn.click()
    })

    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })

    // Reveal dialog should be open with full secret
    const revealDialog = document.body.querySelector('.cx-dialog')
    expect(revealDialog?.textContent).toContain('Copy your new API key')
    expect(revealDialog?.textContent).toContain('Inference Microservice Key')

    // Check acknowledgement and click Done
    const checkbox = revealDialog?.querySelector('input[type="checkbox"]') as HTMLInputElement
    await act(async () => {
      checkbox.click()
    })

    const doneBtn = revealDialog?.querySelector('.cx-dialog__foot button') as HTMLButtonElement
    await act(async () => {
      doneBtn.click()
    })

    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })

    // Now key should appear in list
    const card = host.querySelector('.cx-api-card')
    expect(card?.textContent).toContain('Inference Microservice Key')
    expect(card?.textContent).toContain('3 active')
  })

  it('opens confirmation modal and revokes key, updating active count and persisting to localStorage', async () => {
    await renderApiKeys()

    const revokeBtn = host.querySelector('.cx-key-revoke-btn') as HTMLButtonElement
    expect(revokeBtn).toBeTruthy()

    await act(async () => {
      revokeBtn.click()
    })

    const confirmDialog = document.body.querySelector('.cx-dialog')
    expect(confirmDialog?.textContent).toContain('Revoke')
    expect(confirmDialog?.textContent).toContain('Production Backend API')

    const confirmBtn = confirmDialog?.querySelector('button.cx-btn--danger') as HTMLButtonElement
    expect(confirmBtn).toBeTruthy()
    await act(async () => {
      confirmBtn.click()
    })

    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })

    const card = host.querySelector('.cx-api-card')
    expect(card?.textContent).toContain('1 active')

    const stored = JSON.parse(localStorage.getItem(API_KEYS_STORAGE_KEY) || '[]')
    const revoked = stored.find((k: ApiKeyView) => k.id === 'key-1')
    expect(revoked.active).toBe(false)
  })

  it('gracefully falls back to demo keys when backend authentication fails', async () => {
    const keys = await listApiKeys()
    expect(keys.length).toBe(2)
    expect(keys[0].name).toBe('Production Backend API')
    expect(keys[1].name).toBe('Staging Evaluation Key')
  })

  it('renders quick start section with curl and python instructions', async () => {
    await renderApiKeys()

    const quickstart = host.querySelector('[aria-labelledby="cx-quickstart-title"]')
    expect(quickstart?.textContent).toContain('Quick start')
    expect(quickstart?.textContent).toContain('POST /api/v1/inference')
    expect(quickstart?.textContent).toContain('INFERXE_API_KEY')
  })
})
