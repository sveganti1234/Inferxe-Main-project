/**
 * Admin customer-management summary: a missing, null or malformed summary must not crash the page.
 * Missing/null summary or a failed request shows the error banner; missing counts render as 0, never invented numbers.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../components/dashboard/DashboardLayout', () => ({ DashboardLayout: ({ children }: { children: ReactNode }) => <div>{children}</div> }))

import CustomerManagement from '../pages/dashboard/CustomerManagement'
import { fetchCustomerSummary } from '../lib/customerService'
import { jsonResponse } from './customer/fixtures'

const mockFetch = vi.mocked(globalThis.fetch)
const emptyList = { ok: true, customers: [], pagination: { total: 0, page: 1, limit: 20, totalPages: 0 } }
globalThis.IntersectionObserver ??= class { observe() {} unobserve() {} disconnect() {} takeRecords() { return [] } } as unknown as typeof IntersectionObserver

function serve(summaryStatus: number, summaryBody: unknown) {
  mockFetch.mockReset()
  mockFetch.mockImplementation(async (input) => {
    const path = String(input).split('?')[0]
    if (path === '/api/admin/customers/summary') return jsonResponse(summaryStatus, summaryBody)
    if (path === '/api/admin/customers') return jsonResponse(200, emptyList)
    return jsonResponse(404, { ok: false })
  })
}

describe('fetchCustomerSummary', () => {
  it.each([
    ['missing summary', { ok: true }],
    ['null summary', { ok: true, summary: null }],
  ])('%s is reported as an error', async (_label, body) => {
    serve(200, body)
    await expect(fetchCustomerSummary('real')).rejects.toThrow('Customer summary is unavailable.')
  })

  it('a valid summary is returned; missing or invalid counts become 0', async () => {
    serve(200, { ok: true, summary: { total: 26, total_real: 7, online: 2, active: 'x', inactive: -1, onlineTrackingAvailable: true } })
    expect(await fetchCustomerSummary('real')).toMatchObject({ total: 26, total_real: 7, online: 2, active: 0, inactive: 0, onlineTrackingAvailable: true })
    serve(200, { ok: true, summary: {} })
    expect(await fetchCustomerSummary()).toMatchObject({ total: 0, online: 0, active: 0, inactive: 0, total_real: undefined })
  })

  it('an API failure throws', async () => {
    serve(500, { ok: false, error: 'boom' })
    await expect(fetchCustomerSummary('real')).rejects.toThrow('Failed to load customer summary')
  })
})

describe('CustomerManagement page with a bad summary', () => {
  let host: HTMLDivElement
  let root: Root
  beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
  afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren() })

  async function render() {
    await act(async () => root.render(<MemoryRouter><CustomerManagement /></MemoryRouter>))
    for (let i = 0; i < 40; i++) await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    return host.textContent || ''
  }

  it.each([
    ['missing summary', 200, { ok: true }, 'Customer summary is unavailable.'],
    ['null summary', 200, { ok: true, summary: null }, 'Customer summary is unavailable.'],
    ['API failure', 500, { ok: false }, 'Failed to load customer summary'],
  ])('%s shows the error banner instead of crashing', async (_label, status, body, message) => {
    serve(status, body)
    const text = await render()
    expect(text).toContain('Real Customers')
    expect(text).toContain(message)
    expect(text).not.toMatch(/Real Customers\s*7/)
  })

  it('an empty summary renders zeros, not invented counts', async () => {
    serve(200, { ok: true, summary: {} })
    const text = await render()
    expect(text).toContain('Real Customers')
    expect(text).not.toContain('Customer summary is unavailable.')
    expect(text).not.toMatch(/Customers\s*(7|26)|Test Accounts\s*19/)
  })
})
