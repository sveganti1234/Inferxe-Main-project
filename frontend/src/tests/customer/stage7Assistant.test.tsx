/**
 * Stage 7 prerequisites:
 *  - the assistant chat panel is genuinely VISIBLE when opened (not merely present in the DOM),
 *  - the launcher stays visible on public pages and is retired only inside the console,
 *  - the console topbar Assistant button opens the panel, which can then be closed,
 *  - the customer-facing assistant copy no longer promises unsupported features,
 *  - the console honours the existing VITE_* API base overrides.
 *
 * jsdom applies the real stylesheets (bot.css + customer.css) so computed display/visibility
 * reflect the production cascade. @media rules are not evaluated by jsdom, so these checks cover
 * the base (desktop) cascade; the mobile fixed-position panel was verified in a real browser.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
// Node built-ins have no type declarations in this project (no @types/node); vite.config.ts does the same.
// @ts-ignore
import { readFileSync } from 'node:fs'
// @ts-ignore
import { fileURLToPath } from 'node:url'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ensureFreshSession, getSession } from '../../lib/authStore'
import CustomerApp from '../../features/customer/CustomerApp'
import { GlobalBotCompanion } from '../../components/bot/GlobalBotCompanion'
import { CUSTOMER_QUICK_PROMPTS, getInitialMessagesForScope } from '../../lib/chatStore'
import { emptyWorkspace, jsonResponse, workspaceEnvelope } from './fixtures'
import { preloadCustomerPages } from './preloadPages'

beforeAll(preloadCustomerPages)

vi.mock('../../lib/authStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/authStore')>()),
  ensureFreshSession: vi.fn(),
  getSession: vi.fn(),
  signOutCurrentUser: vi.fn(async () => {}),
}))

const SESSION = {
  token: 'header.payload.signature',
  expiresAt: Date.now() + 3_600_000,
  user: { id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', fullName: 'Ada', email: 'ada@example.test', username: 'ada', role: 'customer' },
}
const mockFetch = vi.mocked(globalThis.fetch)

// Read the real stylesheets from disk: vitest replaces CSS imports (even ?raw) with an empty string.
const readCss = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const botCss = readCss('../../styles/bot.css')
const consoleCss = readCss('../../features/customer/styles/customer.css')

let styleEl: HTMLStyleElement
let root: Root | null = null
let host: HTMLDivElement

beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  }))
  Element.prototype.scrollIntoView = vi.fn()
  vi.mocked(ensureFreshSession).mockResolvedValue(SESSION)
  vi.mocked(getSession).mockReturnValue(SESSION)
  mockFetch.mockReset()
  mockFetch.mockImplementation(async (input) => {
    const path = new URL(String(input), 'http://localhost').pathname
    if (path === '/api/customer/workspace') return jsonResponse(200, workspaceEnvelope(emptyWorkspace()))
    if (path === '/api/notifications/unread-count') return jsonResponse(200, { unread_count: 0 })
    if (path === '/api/v1/health') return jsonResponse(200, { status: 'ok', nvidia_provider: 'configured' })
    return jsonResponse(404, {})
  })
  styleEl = document.createElement('style')
  styleEl.textContent = `${botCss}\n${consoleCss}`
  document.head.appendChild(styleEl)
})

afterEach(() => {
  if (root) act(() => root!.unmount())
  root = null
  styleEl.remove()
  document.body.replaceChildren()
  document.body.className = ''
})

async function flush(times = 6) {
  for (let i = 0; i < times; i++) await act(async () => { await new Promise((r) => setTimeout(r, 10)) })
}
async function mount(node: React.ReactNode) {
  host = document.createElement('div')
  document.body.appendChild(host)
  await act(async () => {
    root = createRoot(host)
    root.render(node)
  })
  await flush()
}
const consoleTree = () => (
  <MemoryRouter initialEntries={['/dashboard/app/help']}>
    <Routes><Route path="/dashboard/app/*" element={<CustomerApp />} /></Routes>
    <GlobalBotCompanion />
  </MemoryRouter>
)
const publicTree = (path = '/contact') => (
  <MemoryRouter initialEntries={[path]}>
    <GlobalBotCompanion />
  </MemoryRouter>
)

/** Rendered, not merely in the DOM: no element up the tree is display:none / hidden / visibility:hidden / opacity:0. */
function isVisible(el: Element | null): boolean {
  for (let node: Element | null = el; node; node = node.parentElement) {
    const cs = getComputedStyle(node)
    if ((node as HTMLElement).hidden || cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false
  }
  return !!el
}
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"][aria-label="Inferxe AI Chat Window"]')
const launcher = () => document.querySelector<HTMLElement>('.bot-chat-launcher')
const topbarAssistant = () => document.querySelector<HTMLButtonElement>('.cx-topbar__assistant')
const openFromLauncher = () => click(launcher())
async function click(el: Element | null | undefined) {
  expect(el, 'element to click').toBeTruthy()
  await act(async () => { (el as HTMLElement).click() })
  await flush(3)
}

describe('assistant visibility', () => {
  it('loaded the real stylesheets (a silent empty import would make every check below vacuous)', () => {
    expect(botCss.length).toBeGreaterThan(1000)
    expect(consoleCss).toContain('Floating assistant: the ghost launcher is shown in the console too')
    expect(consoleCss).not.toMatch(/cx-console-active[^{]*\.bot-chat-(launcher|wrapper)[^{]*\{[^}]*display:\s*none/)
    expect((styleEl.sheet as CSSStyleSheet).cssRules.length).toBeGreaterThan(100)
  })

  it('keeps the floating launcher visible on public pages', async () => {
    await mount(publicTree('/contact'))
    expect(document.body.classList.contains('cx-console-active')).toBe(false)
    expect(isVisible(launcher())).toBe(true)
    expect(dialog()).toBeNull()
  })

  it('opens a VISIBLE chat panel from the public launcher', async () => {
    await mount(publicTree('/'))
    await click(launcher())
    expect(dialog()).not.toBeNull()
    expect(isVisible(dialog())).toBe(true)
    expect(isVisible(dialog()!.querySelector('input'))).toBe(true)
  })

  it('shows the floating ghost launcher in the console (no topbar chat button) and it opens a VISIBLE panel', async () => {
    await mount(consoleTree())
    expect(document.body.classList.contains('cx-console-active')).toBe(true)
    expect(isVisible(launcher())).toBe(true) // the original floating assistant is back in the console
    await click(launcher())
    expect(isVisible(dialog())).toBe(true)
    expect(isVisible(dialog()!.querySelector('input'))).toBe(true)
    expect(topbarAssistant()).toBeNull() // the duplicate topbar chat button is gone
  })

  it('closes the console panel and can reopen it from the launcher', async () => {
    await mount(consoleTree())
    await openFromLauncher()
    expect(isVisible(dialog())).toBe(true)
    await click(document.querySelector('[aria-label="Close chat"]'))
    expect(dialog()).toBeNull()
    await openFromLauncher()
    expect(isVisible(dialog())).toBe(true)
  })

  it('closes the console panel with Escape', async () => {
    await mount(consoleTree())
    await openFromLauncher()
    expect(dialog()).not.toBeNull()
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    await flush(3)
    expect(dialog()).toBeNull()
  })

  it('keeps the launcher after leaving the console', async () => {
    await mount(consoleTree())
    expect(isVisible(launcher())).toBe(true)
    act(() => root!.unmount())
    root = null
    document.body.replaceChildren()
    await mount(publicTree('/pricing'))
    expect(document.body.classList.contains('cx-console-active')).toBe(false)
    expect(isVisible(launcher())).toBe(true)
  })

  it('the visibility check really detects a hidden panel (guards against the Stage 5 regression)', async () => {
    const bad = document.createElement('style')
    bad.textContent = 'body.cx-console-active .bot-chat-wrapper { display: none; }'
    document.head.appendChild(bad)
    await mount(consoleTree())
    await openFromLauncher()
    expect(dialog()).not.toBeNull() // present in the DOM...
    expect(isVisible(dialog())).toBe(false) // ...but not visible: the old bug, now detectable
    bad.remove()
  })
})

describe('assistant copy makes no unsupported promises', () => {
  const text = [...getInitialMessagesForScope('customer').map((m) => m.text), ...CUSTOMER_QUICK_PROMPTS].join(' \n ')

  it('welcome message and quick prompts do not promise top-ups, deployments or OpenAI compatibility', () => {
    expect(text).not.toMatch(/top.?up|add funds|prepaid|launch instances|openai/i)
    expect(text).not.toMatch(/check my wallet balance/i)
    expect(getInitialMessagesForScope('customer')[0].text).toMatch(/not available yet/i)
  })

  it('the stored demo wallet no longer produces a balance claim', () => {
    localStorage.setItem('inferxe_demo_wallet_balance_v1', JSON.stringify(1))
    expect(text).not.toMatch(/₹/)
  })
})

describe('console API base URLs', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('stays same-origin by default', async () => {
    const { resolveApiPath } = await import('../../features/customer/data/http')
    expect(resolveApiPath('/api/wallet/balance')).toBe('/api/wallet/balance')
    expect(resolveApiPath('/api/customer/workspace')).toBe('/api/customer/workspace')
  })

  it('routes notifications and wallet through VITE_NOTIFICATIONS_API_ENDPOINT, leaving /api/customer same-origin', async () => {
    vi.stubEnv('VITE_NOTIFICATIONS_API_ENDPOINT', 'https://notifications.example.test/')
    vi.resetModules()
    const { resolveApiPath } = await import('../../features/customer/data/http')
    expect(resolveApiPath('/api/wallet/balance')).toBe('https://notifications.example.test/api/wallet/balance')
    expect(resolveApiPath('/api/notifications/unread-count')).toBe('https://notifications.example.test/api/notifications/unread-count')
    expect(resolveApiPath('/api/customer/workspace')).toBe('/api/customer/workspace')
  })

  it('checks inference health on VITE_INFERENCE_API_ENDPOINT, the same host the playground posts to', async () => {
    vi.stubEnv('VITE_INFERENCE_API_ENDPOINT', 'https://inference.example.test')
    vi.resetModules()
    const calls: string[] = []
    mockFetch.mockImplementation(async (input) => {
      calls.push(String(input))
      return jsonResponse(200, { status: 'ok', nvidia_provider: 'configured' })
    })
    const { fetchInferenceHealth } = await import('../../features/customer/data/serviceClients')
    await fetchInferenceHealth()
    expect(calls).toEqual(['https://inference.example.test/api/v1/health'])
  })
})
