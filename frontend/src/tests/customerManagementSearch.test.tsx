import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'

// Admin customer list with server-side pagination: the page requests one page at a time, search is debounced,
// an older, slower response can never overwrite newer results, and the summary cards are not re-fetched on
// every search/page change.
vi.mock('../components/dashboard/DashboardLayout', () => ({ DashboardLayout: ({ children }: { children: ReactNode }) => <div>{children}</div> }))
vi.mock('../lib/customerService', () => ({
  fetchCustomers: vi.fn(),
  fetchCustomerSummary: vi.fn(async () => ({})),
  fetchCustomerDetails: vi.fn(),
  createDatabaseBackup: vi.fn(),
  exportCustomersCsv: vi.fn(),
  syncCognitoCustomers: vi.fn(),
}))

import CustomerManagement from '../pages/dashboard/CustomerManagement'
import { fetchCustomers, fetchCustomerSummary } from '../lib/customerService'

type Page = Awaited<ReturnType<typeof fetchCustomers>>
type Params = Parameters<typeof fetchCustomers>[0]
const mockFetch = vi.mocked(fetchCustomers)
const mockSummary = vi.mocked(fetchCustomerSummary)
const page = (name: string, pg = 1, totalPages = 1) => ({
  customers: [{ id: name, customer_id: name, cognito_sub: name, full_name: name, email: `${name}@example.test` }],
  pagination: { totalPages, total: totalPages * 20, page: pg, limit: 20 },
}) as unknown as Page

async function until(check: () => boolean, ms = 3000) {
  const end = Date.now() + ms
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out')
    await act(async () => { await new Promise((r) => setTimeout(r, 25)) })
  }
}
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 400)) })

function type(el: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}
function choose(el: HTMLSelectElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(el, value)
  el.dispatchEvent(new Event('change', { bubbles: true }))
}

// jsdom has no IntersectionObserver (used by the page's animated counters).
globalThis.IntersectionObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() { return [] }
} as unknown as typeof IntersectionObserver

let host: HTMLDivElement
let root: Root
const calls = () => mockFetch.mock.calls.map(([args]) => args as Params)
const searches = () => calls().map((c) => c.search)
const searchBox = () => host.querySelector<HTMLInputElement>('input[placeholder="Search by name, email, ID, org..."]')!
const button = (label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!
const tab = (text: string) => [...host.querySelectorAll('button')].find((b) => (b.textContent || '').includes(text))!
const shows = (text: string) => (host.textContent || '').includes(text)

beforeEach(async () => {
  mockFetch.mockReset()
  mockSummary.mockClear()
  mockFetch.mockImplementation(async (p) => page('row', p.page || 1, 5))
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root.render(<MemoryRouter><CustomerManagement /></MemoryRouter>))
  await until(() => mockFetch.mock.calls.length === 1)
})

afterEach(async () => {
  if (root) {
    await act(async () => root.unmount())
    root = undefined as any
  }
  if (host) {
    host.remove()
    host = undefined as any
  }
})

describe('admin customer list (server-side pagination)', () => {
  it('requests one page with the default contract', () => {
    expect(calls()[0]).toMatchObject({ page: 1, limit: 20, search: '', sortBy: 'registration_date', sortOrder: 'desc', accountType: 'real' })
  })

  it('sends one request per typing pause, not one per keystroke', async () => {
    for (const value of ['a', 'al', 'ali', 'alic', 'alice']) await act(async () => type(searchBox(), value))
    await until(() => searches().includes('alice'))
    await settle()
    expect(searches()).toEqual(['', 'alice'])
  })

  it('ignores a slower response from an earlier search', async () => {
    let resolveSlow!: (v: Page) => void
    mockFetch.mockImplementationOnce(() => new Promise<Page>((r) => { resolveSlow = r }))  // "bob": slow
    await act(async () => type(searchBox(), 'bob'))
    await until(() => searches().includes('bob'))

    mockFetch.mockResolvedValueOnce(page('carol-result'))  // "carol": fast
    await act(async () => type(searchBox(), 'carol'))
    await until(() => shows('carol-result'))

    await act(async () => resolveSlow(page('bob-result')))
    expect(shows('bob-result')).toBe(false)
    expect(shows('carol-result')).toBe(true)
  })

  it('page navigation fetches only the requested page; a new search goes back to page 1', async () => {
    await act(async () => button('Next page').click())
    await until(() => calls().some((c) => c.page === 2))
    expect(calls().at(-1)).toMatchObject({ page: 2, search: '' })

    await act(async () => type(searchBox(), 'dave'))
    await until(() => searches().includes('dave'))
    expect(calls().at(-1)).toMatchObject({ page: 1, search: 'dave' })

    await act(async () => type(searchBox(), ''))  // clearing restores the unfiltered list
    await until(() => calls().at(-1)!.search === '' && calls().length >= 4)
    expect(calls().at(-1)).toMatchObject({ page: 1, search: '' })
  })

  it('sorting is sent to the server and resets to page 1', async () => {
    await act(async () => button('Next page').click())
    await until(() => calls().some((c) => c.page === 2))
    await act(async () => choose(host.querySelector<HTMLSelectElement>('select.dash-input')!, 'full_name:asc'))
    await until(() => calls().at(-1)!.sortBy === 'full_name')
    expect(calls().at(-1)).toMatchObject({ sortBy: 'full_name', sortOrder: 'asc', page: 1 })
  })

  it('pagination controls follow the server: last page disables Next, a clamped page is adopted', async () => {
    mockFetch.mockImplementation(async () => page('last', 1, 1))  // the list shrank to one page
    await act(async () => button('Next page').click())  // server says page 2 no longer exists: serves page 1 of 1
    await until(() => shows('last'))
    await settle()
    expect(button('Next page').disabled).toBe(true)
    expect(host.textContent).toContain('Page 1 of 1')
  })

  it('summary cards are fetched per account tab, not per search or page change', async () => {
    await until(() => mockSummary.mock.calls.length === 1)
    await act(async () => type(searchBox(), 'erin'))
    await until(() => searches().includes('erin'))
    await act(async () => button('Next page').click())
    await settle()
    expect(mockSummary).toHaveBeenCalledTimes(1)

    await act(async () => tab('Test Accounts').click())
    await until(() => mockSummary.mock.calls.length === 2)
    expect(mockSummary.mock.calls.at(-1)![0]).toBe('test')
    expect(calls().at(-1)).toMatchObject({ accountType: 'test', page: 1 })
  })
})
