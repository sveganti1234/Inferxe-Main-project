/**
 * Route migration helpers (Stage 7). Pure functions used by CustomerEntryRedirect and
 * LegacyWorkspaceRedirect: customers land in the native console; only the explicit, guarded
 * /dashboard/legacy route still serves the old Verdelo iframe.
 *
 * Old customer entry points (`/dashboard/customer`, `/dashboard/customer/<tab>`,
 * `/dashboard/customer?tab=<tab>`) were served by the Verdelo iframe. After cutover:
 *   - overview, settings and help have a native equivalent in the console;
 *   - the Verdelo finance tabs (cards, payments, insights, budgets, goals, household) have none,
 *     so those deep links keep working through the guarded legacy route.
 */
import { CUSTOMER_HOME_PATH } from './home'
import { CONSOLE_BASE } from './navigation'

export { CUSTOMER_HOME_PATH }

export const LEGACY_BASE = '/dashboard/legacy'

/** Verdelo tabs that exist only in the old dashboard. */
export const LEGACY_ONLY_TABS = ['cards', 'payments', 'insights', 'budgets', 'goals', 'household'] as const

const NATIVE_TABS: Record<string, string> = {
  overview: CONSOLE_BASE,
  profile: `${CONSOLE_BASE}/profile`,
  settings: `${CONSOLE_BASE}/settings`,
  help: `${CONSOLE_BASE}/help`,
}

/** Tab names are matched against a fixed allow-list; anything else falls back to the overview. */
function requestedTab(pathname: string, search: string): string {
  const fromQuery = new URLSearchParams(search).get('tab')
  const fromPath = pathname.replace(/^\/dashboard\/customer\/?/, '').split('/')[0]
  const raw = (fromQuery || fromPath || 'overview').trim().toLowerCase()
  return /^[a-z0-9-]{1,32}$/.test(raw) ? raw : 'overview'
}

/**
 * Where a request for the old customer dashboard should go after the cutover.
 * Returns an in-app path (never an absolute URL), so it cannot be used as an open redirect.
 */
export function resolveLegacyCustomerTarget(pathname: string, search: string): string {
  const tab = requestedTab(pathname, search)
  if ((LEGACY_ONLY_TABS as readonly string[]).includes(tab)) return `${LEGACY_BASE}?tab=${tab}`
  return NATIVE_TABS[tab] ?? CONSOLE_BASE
}

/**
 * Old customer workspace pages (/dashboard/<page>) and their native console equivalents.
 * Anything not listed goes to the console home. Never an external URL.
 */
const LEGACY_WORKSPACE_PAGES: Record<string, string> = {
  gpus: 'gpus',
  models: 'models',
  deployments: 'deployments',
  wishlist: 'wishlist',
  orders: 'orders',
  'api-keys': 'api-keys',
  analytics: 'usage',
  usage: 'usage',
  billing: 'billing',
  wallet: 'billing',
  checkout: 'checkout',
  payments: 'checkout',
  rewards: 'rewards',
  discounts: 'rewards',
  notifications: 'notifications',
  profile: 'profile',
  organization: 'profile',
  settings: 'settings',
  help: 'help',
  playground: 'playground',
  notebooks: 'developer',
  'ssh-keys': 'ssh-keys',
  ssh: 'ssh-keys',
  developer: 'developer',
}

export function resolveLegacyWorkspaceTarget(pathname: string): string {
  const page = pathname.replace(/^\/dashboard\/?/, '').split('/')[0].toLowerCase()
  const section = LEGACY_WORKSPACE_PAGES[page]
  return section ? `${CONSOLE_BASE}/${section}` : CONSOLE_BASE
}
