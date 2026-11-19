import { describe, it, expect } from 'vitest'
import { CUSTOMER_HOME_PATH, LEGACY_BASE, LEGACY_ONLY_TABS, resolveLegacyCustomerTarget, resolveLegacyWorkspaceTarget } from '../../features/customer/routing'
import { CONSOLE_BASE } from '../../features/customer/navigation'

describe('legacy customer URL mapping (used at cutover)', () => {
  const go = (path: string, search = '') => resolveLegacyCustomerTarget(path, search)

  it('sends the bare entry and the overview to the console', () => {
    expect(go('/dashboard/customer')).toBe('/dashboard/app')
    expect(go('/dashboard/customer/')).toBe('/dashboard/app')
    expect(go('/dashboard/customer', '?tab=overview')).toBe('/dashboard/app')
    expect(go('/dashboard/customer/overview')).toBe('/dashboard/app')
  })

  it('maps settings and help to their native pages, from the query or the path', () => {
    expect(go('/dashboard/customer', '?tab=settings')).toBe('/dashboard/app/settings')
    expect(go('/dashboard/customer/help')).toBe('/dashboard/app/help')
  })

  it('keeps every Verdelo-only tab working through the legacy route', () => {
    for (const tab of LEGACY_ONLY_TABS) {
      expect(go('/dashboard/customer', `?tab=${tab}`)).toBe(`${LEGACY_BASE}?tab=${tab}`)
      expect(go(`/dashboard/customer/${tab}`)).toBe(`${LEGACY_BASE}?tab=${tab}`)
    }
  })

  it('prefers ?tab= over the path, like the old workspace did', () => {
    expect(go('/dashboard/customer/cards', '?tab=settings')).toBe('/dashboard/app/settings')
  })

  it('falls back to the console for unknown or hostile values and never produces an external URL', () => {
    for (const tab of ['nope', '../../evil', 'https://evil.example', '//evil.example', 'javascript:alert(1)', '%2F%2Fevil', 'a'.repeat(100), '']) {
      const target = go('/dashboard/customer', `?tab=${encodeURIComponent(tab)}`)
      expect(target.startsWith('/dashboard/')).toBe(true)
      expect(target).not.toMatch(/\/\/|:/)
      expect(target).toBe('/dashboard/app')
    }
  })
})

describe('customer home and legacy workspace mapping', () => {
  it('keeps the customer home path in sync with the console base', () => {
    expect(CUSTOMER_HOME_PATH).toBe('/dashboard/app')
    expect(CUSTOMER_HOME_PATH).toBe(CONSOLE_BASE)
  })

  it('maps old /dashboard/<page> workspace paths to console sections, defaulting to the console home', () => {
    expect(resolveLegacyWorkspaceTarget('/dashboard/gpus')).toBe('/dashboard/app/gpus')
    expect(resolveLegacyWorkspaceTarget('/dashboard/wallet')).toBe('/dashboard/app/billing')
    expect(resolveLegacyWorkspaceTarget('/dashboard/analytics')).toBe('/dashboard/app/usage')
    expect(resolveLegacyWorkspaceTarget('/dashboard/api-keys/extra')).toBe('/dashboard/app/api-keys')
    expect(resolveLegacyWorkspaceTarget('/dashboard/unknown')).toBe('/dashboard/app')
    expect(resolveLegacyWorkspaceTarget('/dashboard')).toBe('/dashboard/app')
    expect(resolveLegacyWorkspaceTarget('/dashboard/%2F%2Fevil')).toBe('/dashboard/app')
  })
})
