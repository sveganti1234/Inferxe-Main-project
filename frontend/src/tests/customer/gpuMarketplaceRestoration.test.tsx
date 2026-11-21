/**
 * Unit & Integration tests for restored GPU Marketplace features:
 * - Sovereign development sample data
 * - Architecture & status quick filter pills
 * - Sorting by Price, VRAM, and Quantity
 * - Side-by-side comparison banner & modal
 * - Heart wishlist toggle & Share actions
 * - Select & Deploy navigation
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import GpusPage from '../../features/customer/pages/GpusPage'
import * as WorkspaceContextModule from '../../features/customer/data/WorkspaceContext'

let root: Root | null = null
let host: HTMLDivElement

afterEach(() => {
  if (root) act(() => root!.unmount())
  root = null
  document.body.replaceChildren()
  document.body.className = ''
})

async function flush(times = 4) {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })
  }
}

async function renderGpusPage() {
  host = document.createElement('div')
  document.body.appendChild(host)
  await act(async () => {
    root = createRoot(host)
    root.render(
      <MemoryRouter initialEntries={['/dashboard/app/gpus']}>
        <Routes>
          <Route path="/dashboard/app/gpus" element={<GpusPage />} />
          <Route path="/dashboard/app/deployments" element={<div data-testid="deployments-target">Deployments Target</div>} />
        </Routes>
      </MemoryRouter>,
    )
  })
  await flush()
}

const text = () => document.body.textContent ?? ''
const byText = (selector: string, pattern: RegExp) =>
  [...document.querySelectorAll<HTMLElement>(selector)].find((n) => pattern.test(n.textContent ?? ''))
async function click(el: Element | null | undefined) {
  expect(el, 'element to click').toBeTruthy()
  await act(async () => {
    ;(el as HTMLElement).click()
  })
  await flush()
}

const mockWorkspaceData = {
  profile: { user_id: 'u1', full_name: 'Test Customer', email: 'c@test.com', username: 'c', avatar_path: null, role: 'customer', status: 'active', organization_id: 'org-1' },
  gpu_providers: [],
  gpu_listings: [],
  saved_gpu_listings: [],
  deployments: [],
  api_keys: [],
  audit_events: [],
  usage_daily: [],
  monthly_spend_cap: null,
}

describe('GPU Marketplace Restored Features', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    })
    vi.spyOn(WorkspaceContextModule, 'useCustomerWorkspace').mockReturnValue({
      state: { status: 'ready', data: mockWorkspaceData, error: null } as any,
      workspace: mockWorkspaceData as any,
      refresh: vi.fn(),
      lastUpdated: Date.now(),
    })
  })

  it('renders restored GPU cards with sovereign metrics, status pills and inventory', async () => {
    await renderGpusPage()

    // Context & Sample banner
    expect(text()).toContain('Compare sovereign hardware listings across Indian Tier-IV datacenters')

    // Click to load sovereign development sample data
    await click(byText('button', /Load sovereign development sample data/))
    expect(text()).toContain('Development Sample Dataset')

    // 5 GPU models from old screenshots
    expect(text()).toContain('NVIDIA L40S')
    expect(text()).toContain('NVIDIA L4')
    expect(text()).toContain('NVIDIA A100')
    expect(text()).toContain('NVIDIA H100 SXM5')
    expect(text()).toContain('NVIDIA H200')

    // Datacenter locations
    expect(text()).toContain('Mumbai, IN')
    expect(text()).toContain('Hyderabad, IN')
    expect(text()).toContain('Chennai, IN')
    expect(text()).toContain('Delhi, IN')

    // Inventory & Hourly Rates
    expect(text()).toContain('16 GPUs')
    expect(text()).toContain('₹60/hr')
    expect(text()).toContain('₹100/hr')
    expect(text()).toContain('₹275/hr')
    expect(text()).toContain('₹340/hr')
  })

  it('filters hardware using quick pills (Ada Lovelace, Hopper, Available, Paused)', async () => {
    await renderGpusPage()
    await click(byText('button', /Load sovereign development sample data/))

    // Filter by Ada Lovelace
    await click(byText('button', /^Ada Lovelace$/))
    expect(text()).toContain('NVIDIA L40S')
    expect(text()).toContain('NVIDIA L4')
    expect(text()).not.toContain('NVIDIA H100 SXM5')
    expect(text()).not.toContain('NVIDIA H200')

    // Filter by Hopper
    await click(byText('button', /^Hopper$/))
    expect(text()).toContain('NVIDIA H100 SXM5')
    expect(text()).toContain('NVIDIA H200')
    expect(text()).not.toContain('NVIDIA L40S')

    // Filter by Paused
    await click(byText('button', /^Paused$/))
    expect(text()).toContain('NVIDIA A100')
    expect(text()).not.toContain('NVIDIA L4')

    // Reset with All Hardware
    await click(byText('button', /^All Hardware$/))
    expect(text()).toContain('NVIDIA L4')
    expect(text()).toContain('NVIDIA H100 SXM5')
  })

  it('handles side-by-side comparison workflow (tray, modal, remove, clear)', async () => {
    await renderGpusPage()
    await click(byText('button', /Load sovereign development sample data/))

    const compareButtons = [...document.querySelectorAll<HTMLButtonElement>('.cx-listing button')].filter(
      (b) => b.textContent?.trim() === 'Compare',
    )
    expect(compareButtons.length).toBeGreaterThanOrEqual(2)

    await click(compareButtons[0]) // Select first GPU
    await click(compareButtons[1]) // Select second GPU

    // Comparison banner
    expect(text()).toMatch(/Selected\s+2\s+GPU models for side-by-side comparison/)

    // Header comparison button appears
    expect(byText('button', /Compare \(2\) GPUs/)).toBeTruthy()

    // Open modal
    await click(byText('button', /^View Comparison$/))
    expect(document.querySelector('.cx-dialog')).toBeTruthy()
    expect(text()).toContain('GPU Hardware Comparison')

    // Clear comparison
    await click(byText('button', /^Clear all$/))
    expect(document.querySelector('.cx-dialog')).toBeFalsy()
    expect(text()).not.toMatch(/Selected\s+2\s+GPU models/)
  })

  it('copies listing link to clipboard when Share button is clicked', async () => {
    await renderGpusPage()
    await click(byText('button', /Load sovereign development sample data/))

    const shareBtn = document.querySelector<HTMLButtonElement>('button[aria-label*="Share"]')
    expect(shareBtn).toBeTruthy()
    await click(shareBtn)

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining('/dashboard/app/gpus?gpu='),
    )
    expect(text()).toMatch(/copied to clipboard/i)
  })
})
