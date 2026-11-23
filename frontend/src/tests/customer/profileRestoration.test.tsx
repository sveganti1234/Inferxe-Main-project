import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import ProfilePage from '../../features/customer/pages/ProfilePage'
import { WorkspaceProvider } from '../../features/customer/data/WorkspaceContext'
import type { CustomerWorkspace } from '../../features/customer/data/types'
import * as serviceClients from '../../features/customer/data/serviceClients'
import * as authStore from '../../lib/authStore'

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
}

let root: Root | null = null
let host: HTMLDivElement

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  vi.spyOn(authStore, 'getSession').mockReturnValue({
    token: 'mock-token',
    user: {
      id: 'usr-1',
      email: 'vegantisahith@gmail.com',
      fullName: 'Vegantisahith',
      role: 'customer',
      organization: 'Customer Workspace',
    } as any,
  } as any)
  vi.spyOn(authStore, 'ensureFreshSession').mockResolvedValue(true as any)
})

afterEach(() => {
  if (root) {
    act(() => root?.unmount())
    root = null
  }
  host.remove()
  vi.restoreAllMocks()
})

const renderProfile = async () => {
  await act(async () => {
    root?.render(
      <MemoryRouter initialEntries={['/dashboard/app/profile']}>
        <WorkspaceProvider loader={async () => mockWorkspace}>
          <Routes>
            <Route path="/dashboard/app/profile" element={<ProfilePage />} />
            <Route path="/dashboard/app" element={<div>Overview Mock</div>} />
          </Routes>
        </WorkspaceProvider>
      </MemoryRouter>
    )
  })
}

describe('Customer User Profile & Organization Restoration (media_1795407667415_67fe490d.jpg)', () => {
  it('renders breadcrumbs, page header, description, and backlink', async () => {
    await renderProfile()

    expect(host.textContent).toContain('Customer Portal')
    expect(host.textContent).toContain('User Profile & Organization')
    expect(host.textContent).toContain('Manage your personal account details, avatar, and role.')

    const backLink = host.querySelector('a[href="/dashboard/app"]')
    expect(backLink).not.toBeNull()
    expect(backLink?.textContent).toContain('Back to overview')
  })

  it('renders section toolbar with Inspect JWT Session Token button', async () => {
    await renderProfile()

    expect(host.textContent).toContain('Profile & Security Settings')
    expect(host.textContent).toContain('Manage identity credentials, change account password, tenant organization settings, and inspect security tokens.')

    const jwtBtn = host.querySelector('.cx-inspect-jwt-btn')
    expect(jwtBtn).not.toBeNull()
    expect(jwtBtn?.textContent).toContain('Inspect JWT Session Token')
  })

  it('renders Profile Credentials card with avatar, SSO email, and roles', async () => {
    await renderProfile()

    expect(host.textContent).toContain('Profile Credentials')
    expect(host.textContent).toContain('Verified Tenant')
    expect(host.querySelector('.cx-profile-avatar')?.textContent).toBe('VE')
    expect(host.querySelector('.cx-sso-badge')?.textContent).toBe('Managed by SSO')
    expect(host.textContent).toContain('Primary work email is governed by corporate SSO authentication.')
    const roleInput = host.querySelector('#cx-prof-role') as HTMLInputElement
    expect(roleInput?.value).toBe('Customer Tenant / Infrastructure Operator')
  })

  it('updates avatar initials dynamically when typing full name and submits updates', async () => {
    const updateSpy = vi.spyOn(serviceClients, 'updateDisplayName').mockResolvedValue('Ada Lovelace')
    const saveSessionSpy = vi.spyOn(authStore, 'saveSession').mockImplementation(() => {})

    await renderProfile()

    const nameInput = host.querySelector('#cx-prof-fullname') as HTMLInputElement
    expect(nameInput).not.toBeNull()

    // Change name
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set?.call(nameInput, 'Ada Lovelace')
      nameInput.dispatchEvent(new Event('input', { bubbles: true }))
      nameInput.dispatchEvent(new Event('change', { bubbles: true }))
    })

    expect(host.querySelector('.cx-profile-avatar')?.textContent).toBe('AL')

    const saveBtn = host.querySelector('.cx-profile-form button[type="submit"]') as HTMLButtonElement
    await act(async () => {
      saveBtn.click()
    })

    expect(updateSpy).toHaveBeenCalledWith('Ada Lovelace')
    expect(saveSessionSpy).toHaveBeenCalled()
    expect(host.textContent).toContain('User profile and organization preferences updated.')
  })

  it('renders Change Account Password card with checklist and eye toggle', async () => {
    await renderProfile()

    expect(host.textContent).toContain('Change Account Password')
    expect(host.textContent).toContain('At least 8 characters long')
    expect(host.textContent).toContain('Includes at least one number (0-9) or symbol')
    expect(host.textContent).toContain('New password and confirmation match')

    const currentPwdInput = host.querySelector('#cx-pwd-current') as HTMLInputElement
    expect(currentPwdInput.type).toBe('password')

    const toggleBtn = host.querySelectorAll('.cx-input-tool-btn')[0] as HTMLButtonElement
    await act(async () => {
      toggleBtn.click()
    })
    expect(currentPwdInput.type).toBe('text')
  })

  it('renders Sovereign Tenant Security & Enclave Status card', async () => {
    await renderProfile()

    expect(host.textContent).toContain('Sovereign Tenant Security & Enclave Status')
    expect(host.textContent).toContain('Local Enclave')
    expect(host.textContent).toContain('Two-Factor Authentication (TOTP) Enabled')
    expect(host.textContent).toContain('Zero Cross-Border Data Transfer Enforced')
    expect(host.textContent).toContain('OpenAI Drop-In SDK Gateway Paired')
    expect(host.textContent).toContain('Demo profile credentials and authentication tokens are secured in local client storage.')
  })

  it('opens and closes the JWT Session Token Inspector modal and copies token', async () => {
    const copySpy = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, {
      clipboard: { writeText: copySpy },
    })

    await renderProfile()

    const jwtBtn = host.querySelector('.cx-inspect-jwt-btn') as HTMLButtonElement
    await act(async () => {
      jwtBtn.click()
    })

    expect(host.textContent).toContain('JWT Session Token Inspector')
    expect(host.textContent).toContain('Header (Algorithm & Token Type)')
    expect(host.textContent).toContain('Payload (Claims & Scopes)')
    expect(host.textContent).toContain('Frontend Transparency Disclosure:')

    const copyBtn = host.querySelector('.cx-modal-foot button') as HTMLButtonElement
    await act(async () => {
      copyBtn.click()
    })
    expect(copySpy).toHaveBeenCalled()

    const closeBtn = host.querySelector('.cx-modal-head button') as HTMLButtonElement
    await act(async () => {
      closeBtn.click()
    })
    expect(host.textContent).not.toContain('JWT Session Token Inspector')
  })
})
