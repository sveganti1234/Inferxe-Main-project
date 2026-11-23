import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import SettingsPage, {
  SETTINGS_STORAGE_KEY,
  DEFAULT_WORKSPACE_SETTINGS,
} from '../../features/customer/pages/SettingsPage'
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
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(DEFAULT_WORKSPACE_SETTINGS))
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

const renderSettings = async () => {
  await act(async () => {
    root?.render(
      <MemoryRouter initialEntries={['/dashboard/app/settings']}>
        <WorkspaceProvider loader={async () => mockWorkspace}>
          <Routes>
            <Route path="/dashboard/app/settings" element={<SettingsPage />} />
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

describe('Workspace Settings & Quotas Restoration', () => {
  it('renders breadcrumb, page header, description, and backlink', async () => {
    await renderSettings()

    const breadcrumb = host.querySelector('.cx-page-breadcrumb')
    expect(breadcrumb?.textContent).toContain('Customer Portal')
    expect(breadcrumb?.textContent).toContain('Settings & Quotas')

    const header = host.querySelector('.cx-page-header')
    expect(header?.textContent).toContain('Settings & Quotas')
    expect(header?.textContent).toContain(
      'Configure demo preferences, quotas and workspace details.',
    )

    const backLink = header?.querySelector('a')
    expect(backLink?.textContent).toContain('Back to overview')
    expect(backLink?.getAttribute('href')).toBe('/dashboard/app')
  })

  it('renders Workspace Preferences & Security card with inputs and checkboxes', async () => {
    await renderSettings()

    expect(host.textContent).toContain('Workspace Preferences & Security')
    expect(host.textContent).toContain('Local settings')
    expect(host.textContent).toContain('Monthly Spending Limit (₹)')
    expect(host.textContent).toContain('Allowed API CORS Origins')
    expect(host.textContent).toContain('Spending & Over-quota Notifications')
    expect(host.textContent).toContain('Weekly Summary Telemetry Report')
    expect(host.textContent).toContain('Users Directory')

    const limitInput = host.querySelector('#cx-monthly-limit') as HTMLInputElement
    expect(limitInput).toBeTruthy()
    expect(limitInput.value).toBe('10000')

    const corsInput = host.querySelector('#cx-cors-origins') as HTMLInputElement
    expect(corsInput).toBeTruthy()
    expect(corsInput.value).toContain('https://app.novatech.ai')

    const saveBtn = host.querySelector('.cx-save-prefs-btn') as HTMLButtonElement
    expect(saveBtn).toBeTruthy()
    expect(saveBtn.textContent).toContain('Save Preferences')
  })

  it('saves updated preferences to localStorage and displays success notice', async () => {
    await renderSettings()

    const limitInput = host.querySelector('#cx-monthly-limit') as HTMLInputElement
    await act(async () => {
      setInputValue(limitInput, '25000')
    })

    const saveBtn = host.querySelector('.cx-save-prefs-btn') as HTMLButtonElement
    await act(async () => {
      saveBtn.click()
    })

    expect(host.textContent).toContain('Workspace preferences saved successfully.')

    const stored = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || '{}')
    expect(stored.spendingLimit).toBe('25000')
  })

  it('renders Change Account Password card with checklist and required badges', async () => {
    await renderSettings()

    expect(host.textContent).toContain('Change Account Password')
    expect(host.textContent).toContain('Default Credentials')
    expect(host.textContent).toContain('Current Password')
    expect(host.textContent).toContain('Required')
    expect(host.textContent).toContain('New Password')
    expect(host.textContent).toContain('Confirm New Password')

    expect(host.textContent).toContain('At least 8 characters long')
    expect(host.textContent).toContain('Includes at least one number (0-9) or symbol')
    expect(host.textContent).toContain('New password and confirmation match')

    const updateBtn = host.querySelector('.cx-update-pwd-btn') as HTMLButtonElement
    expect(updateBtn).toBeTruthy()
    expect(updateBtn.textContent).toMatch(/Update password/i)
  })

  it('validates password fields and requirements dynamically', async () => {
    await renderSettings()

    const currentInput = host.querySelector('#cx-settings-pwd-current') as HTMLInputElement
    const newInput = host.querySelector('#cx-settings-pwd-new') as HTMLInputElement
    const confirmInput = host.querySelector('#cx-settings-pwd-confirm') as HTMLInputElement

    await act(async () => {
      setInputValue(currentInput, 'OldPass123!')
      setInputValue(newInput, 'SecretPass99!')
      setInputValue(confirmInput, 'SecretPass99!')
    })

    const checklist = host.querySelector('.cx-pwd-checklist')
    const validItems = checklist?.querySelectorAll('.is-valid')
    expect(validItems?.length).toBe(3)
  })

  it('maintains profile and organization display for test compatibility', async () => {
    await renderSettings()

    const nameInput = host.querySelector('input[autocomplete="name"]') as HTMLInputElement
    expect(nameInput).toBeTruthy()
    expect(nameInput.value).toBe('Vegantisahith')

    expect(host.textContent).toContain('Customer Workspace')
    expect(host.textContent).toContain('Default limits')
  })
})
