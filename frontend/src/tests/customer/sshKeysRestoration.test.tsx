import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import SshKeysPage, { SSH_STORAGE_KEY, DEFAULT_DEMO_SSH_KEYS } from '../../features/customer/pages/SshKeysPage'
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
  localStorage.setItem(SSH_STORAGE_KEY, JSON.stringify(DEFAULT_DEMO_SSH_KEYS))
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

const renderSshKeys = async () => {
  await act(async () => {
    root?.render(
      <MemoryRouter initialEntries={['/dashboard/app/ssh-keys']}>
        <WorkspaceProvider loader={async () => mockWorkspace}>
          <Routes>
            <Route path="/dashboard/app/ssh-keys" element={<SshKeysPage />} />
          </Routes>
        </WorkspaceProvider>
      </MemoryRouter>
    )
  })
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20))
  })
}

function setInputValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
  setter?.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
}

describe('SSH Public Keys Vault Feature', () => {
  it('renders breadcrumb, page header, description, and backlink', async () => {
    await renderSshKeys()

    const breadcrumb = host.querySelector('.cx-page-breadcrumb')
    expect(breadcrumb?.textContent).toContain('Customer Portal')
    expect(breadcrumb?.textContent).toContain('SSH Public Keys')

    const header = host.querySelector('.cx-page-header')
    expect(header?.querySelector('h1')?.textContent).toBe('SSH Public Keys')
    expect(header?.textContent).toContain('Configure demo SSH credentials for compute cluster access.')

    const backlink = header?.querySelector('a')
    expect(backlink?.textContent).toContain('Back to overview')
    expect(backlink?.getAttribute('href')).toBe('/dashboard/app')
  })

  it('renders section toolbar and sovereign security notice', async () => {
    await renderSshKeys()

    const toolbar = host.querySelector('.cx-ssh-toolbar')
    expect(toolbar).not.toBeNull()
    expect(toolbar?.querySelector('h2')?.textContent).toBe('SSH Public Keys Vault')
    expect(toolbar?.textContent).toContain(
      'Register public keys to enable secure terminal and container shell pairing with dedicated GPU nodes.'
    )

    const notice = host.querySelector('.cx-ssh-notice')
    expect(notice?.textContent).toContain('Sovereign Security Notice:')
    expect(notice?.textContent).toContain('Never upload private keys.')
  })

  it('renders registered public keys table with default demo keys', async () => {
    await renderSshKeys()

    const table = host.querySelector('.cx-ssh-table')
    expect(table).not.toBeNull()

    const rows = host.querySelectorAll('.cx-ssh-table tbody tr')
    expect(rows.length).toBe(2)

    // Row 1: Workstation ed25519
    expect(rows[0].textContent).toContain('Workstation ed25519')
    expect(rows[0].textContent).toContain('ssh-1')
    expect(rows[0].textContent).toContain('SHA256:7mP4e2x9...yK9')
    expect(rows[0].textContent).toContain('02 Oct 2026')

    // Row 2: CI/CD Deployer key
    expect(rows[1].textContent).toContain('CI/CD Deployer key')
    expect(rows[1].textContent).toContain('ssh-2')
    expect(rows[1].textContent).toContain('SHA256:3aF8x11q...9wQ')
    expect(rows[1].textContent).toContain('08 Oct 2026')

    // Counter badge
    expect(host.querySelector('.cx-ssh-table-head')?.textContent).toContain('2 keys')
  })

  it('copies key to clipboard when Copy action is clicked', async () => {
    await renderSshKeys()

    const copyBtn = host.querySelectorAll('.cx-ssh-btn--copy')[0] as HTMLButtonElement
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, {
      clipboard: { writeText },
    })

    await act(async () => {
      copyBtn.click()
    })

    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining('ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIO')
    )
    expect(host.textContent).toContain('Public SSH key for "Workstation ed25519" copied to clipboard.')
  })

  it('opens registration modal, validates input, and adds new public key', async () => {
    await renderSshKeys()

    const addBtn = host.querySelector('.cx-add-ssh-btn') as HTMLButtonElement
    await act(async () => {
      addBtn.click()
    })

    // Modal is opened
    expect(host.querySelector('.cx-ssh-modal-panel')).not.toBeNull()
    expect(host.textContent).toContain('Register Public SSH Key')

    const nameInput = host.querySelector('#cx-ssh-name-input') as HTMLInputElement
    const keyInput = host.querySelector('#cx-ssh-key-input') as HTMLTextAreaElement
    const submitBtn = host.querySelector('.cx-ssh-modal-actions button[type="submit"]') as HTMLButtonElement

    // Try private key (should be rejected)
    await act(async () => {
      setInputValue(nameInput, 'My Key')
      setInputValue(keyInput, '-----BEGIN OPENSSH PRIVATE KEY-----')
      submitBtn.click()
    })

    expect(host.textContent).toContain('Private keys are strictly forbidden.')

    // Enter valid public key
    await act(async () => {
      setInputValue(keyInput, 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGitHubTestKey123 user@inferxe')
      submitBtn.click()
    })

    expect(host.textContent).toContain('Successfully registered public SSH key "My Key".')
    const rows = host.querySelectorAll('.cx-ssh-table tbody tr')
    expect(rows.length).toBe(3)
    expect(rows[0].textContent).toContain('My Key')
  })

  it('opens remove dialog and deletes an SSH key on confirmation', async () => {
    await renderSshKeys()

    const removeBtn = host.querySelectorAll('.cx-ssh-btn--remove')[0] as HTMLButtonElement
    await act(async () => {
      removeBtn.click()
    })

    // Confirm dialog is open
    expect(host.textContent).toContain('Remove SSH Key')
    expect(host.textContent).toContain('Are you sure you want to remove public key Workstation ed25519')

    // Click confirm delete
    const confirmBtn = host.querySelector('.cx-ssh-modal-actions button.cx-btn--danger') as HTMLButtonElement
    await act(async () => {
      confirmBtn.click()
    })

    expect(host.textContent).toContain('Removed SSH key "Workstation ed25519".')
    const rows = host.querySelectorAll('.cx-ssh-table tbody tr')
    expect(rows.length).toBe(1)
    expect(rows[0].textContent).toContain('CI/CD Deployer key')
    expect(host.querySelector('.cx-ssh-table-head')?.textContent).toContain('1 key')
  })
})
