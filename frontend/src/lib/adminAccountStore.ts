/**
 * Super Admin & Platform Administrator Accounts Store
 * ===================================================
 * Synchronizes live platform administrator accounts directly from the backend
 * Supabase-backed endpoints (`/api/superadmin/admins`, `/api/superadmin/admins/status`).
 * All hardcoded placeholder/demo administrator accounts have been removed.
 */
import { fetchSuperadminAdmins, fetchSuperadminActivity, type SuperadminAdminRecord } from './authStore'

export type AdminRole =
  | 'super_admin'
  | 'superadmin'
  | 'admin'

export type AdminStatus = 'active' | 'inactive' | 'invited'

export interface AdminAccount {
  id: string
  fullName: string
  email: string
  role: AdminRole
  status: AdminStatus
  department: string
  createdAt: string
  lastActiveAt: string
  avatarInitials: string
  avatarGradient: string
  phone?: string
  notes?: string
  sessionVersion?: number
  isSuperAdmin?: boolean
  isDemo?: boolean
}

export type ActivityCategory =
  | 'Admin Accounts'
  | 'Role Management'
  | 'Permission Changes'
  | 'Security'
  | 'Platform Operations'

export type ActivitySeverity = 'info' | 'warning' | 'critical' | 'success'

export interface AdminActivityLog {
  id: string
  adminId: string
  adminName: string
  adminEmail: string
  action: string
  category: ActivityCategory
  targetResource: string
  severity: ActivitySeverity
  timestamp: string
  isoTimestamp: string
  description?: string
  previousValue?: string
  newValue?: string
  source?: string
  ipAddress?: string
  userAgent?: string
  targetType?: string
  targetId?: string
  details?: Record<string, unknown>
  isDemo?: boolean
}

export interface AdminSecurityEvent {
  id: string
  eventType: string
  actor: string
  ipAddress: string
  location: string
  status: 'allowed' | 'blocked' | 'flagged'
  timestamp: string
  details: string
  isDemo?: boolean
}

export const ADMIN_ROLE_METADATA: Record<
  AdminRole,
  {
    title: string
    description: string
    badgeClass: string
    color: string
    permissionsSummary: string[]
  }
> = {
  superadmin: {
    title: 'Super Admin',
    description: 'Full platform governance, admin account lifecycle, and unrestricted access (Protected Role).',
    badgeClass: 'chip--lime',
    color: '#50e396',
    permissionsSummary: ['Full Platform Control', 'Manage Admin Accounts', 'RBAC & Key Access', 'Global Overrides'],
  },
  super_admin: {
    title: 'Super Admin',
    description: 'Full platform governance, admin account lifecycle, and unrestricted access (Protected Role).',
    badgeClass: 'chip--lime',
    color: '#50e396',
    permissionsSummary: ['Full Platform Control', 'Manage Admin Accounts', 'RBAC & Key Access', 'Global Overrides'],
  },
  admin: {
    title: 'Admin',
    description: 'Standard platform administrator with operational console access and no Super Admin privileges.',
    badgeClass: 'chip--cyan',
    color: '#06b6d4',
    permissionsSummary: ['Admin Console', 'Customer Management', 'Users Directory', 'Provider Operations'],
  },
}

export function getAdminRoleMeta(role: string): {
  title: string
  description: string
  badgeClass: string
  color: string
  permissionsSummary: string[]
} {
  const clean = String(role || '').trim().toLowerCase()
  if (clean === 'superadmin' || clean === 'super_admin') {
    return ADMIN_ROLE_METADATA.super_admin
  }
  return ADMIN_ROLE_METADATA.admin
}

// All hardcoded placeholder/demo administrators have been removed.
// Administrator records are loaded exclusively from the backend Supabase database.
export const DEFAULT_ADMIN_ACCOUNTS: AdminAccount[] = []

function isLegacyDemoAccount(account: AdminAccount | null | undefined): boolean {
  if (!account || typeof account !== 'object') return true
  if (account.isDemo === true) return true
  const id = String(account.id || '').trim()
  if (!id || id.startsWith('adm-')) return true
  return false
}

export function mapBackendAdminToAccount(record: SuperadminAdminRecord): AdminAccount {
  const isSuper = record.role === 'superadmin'
  const role: AdminRole = isSuper ? 'super_admin' : 'admin'
  const email = String(record.email || '').trim().toLowerCase()
  const fullName = String(record.full_name || '').trim() || (isSuper ? 'Inferxe Super Admin' : email.split('@')[0] || 'Administrator')
  const initials =
    fullName
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => part[0])
      .join('')
      .substring(0, 2)
      .toUpperCase() || (isSuper ? 'SA' : 'AD')
  const isActive = record.is_active !== undefined ? Boolean(record.is_active) : record.status === 'active'
  const status: AdminStatus = isActive ? 'active' : 'inactive'

  return {
    id: String(record.id),
    fullName,
    email,
    role,
    status,
    department: isSuper ? 'Platform Governance' : 'Platform Operations',
    createdAt: record.created_at || new Date().toISOString(),
    lastActiveAt: record.last_login ? formatRelativeTime(record.last_login) : 'Never signed in',
    avatarInitials: initials,
    avatarGradient: isSuper
      ? 'linear-gradient(135deg, #50e396, #0e3820)'
      : 'linear-gradient(135deg, #06b6d4, #083344)',
    notes: isSuper
      ? 'Primary Super Admin account (protected).'
      : 'Database-backed platform administrator (role: admin).',
    sessionVersion: Number(record.session_version || 1),
    isSuperAdmin: isSuper,
    isDemo: false,
  }
}

export function formatRelativeTime(isoString: string): string {
  try {
    const then = new Date(isoString).getTime()
    const now = Date.now()
    const diffSec = Math.floor((now - then) / 1000)
    if (diffSec < 60) return 'Just now'
    const diffMin = Math.floor(diffSec / 60)
    if (diffMin < 60) return `${diffMin}m ago`
    const diffHours = Math.floor(diffMin / 60)
    if (diffHours < 24) return `${diffHours}h ago`
    const diffDays = Math.floor(diffHours / 24)
    if (diffDays === 1) return 'Yesterday'
    if (diffDays < 30) return `${diffDays}d ago`
    return new Date(isoString).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch {
    return 'Recently'
  }
}

export function generateDefaultAdminActivities(): AdminActivityLog[] {
  return []
}

export const DEFAULT_ADMIN_ACTIVITIES: AdminActivityLog[] = []

export const DEFAULT_SECURITY_EVENTS: AdminSecurityEvent[] = []

const STORAGE_KEY = 'inferxe_live_admin_accounts_v3'
const LEGACY_STORAGE_KEYS = ['inferxe_dev_admin_accounts_v2', 'inferxe_super_admin_accounts_v1']
const ACTIVITIES_STORAGE_KEY = 'inferxe_dev_admin_activities_v3'

function purgeLegacyLocalAdminCaches(): void {
  try {
    for (const legacyKey of LEGACY_STORAGE_KEYS) {
      localStorage.removeItem(legacyKey)
    }
  } catch {
    /* storage unavailable */
  }
}

function getStored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function setStored<T>(key: string, data: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(data))
  } catch {
    /* storage unavailable */
  }
}

export function getAdminAccounts(): AdminAccount[] {
  purgeLegacyLocalAdminCaches()
  const stored = getStored<AdminAccount[]>(STORAGE_KEY, [])
  if (!Array.isArray(stored)) return []
  const liveOnly = stored.filter((acc) => !isLegacyDemoAccount(acc))
  if (liveOnly.length !== stored.length) {
    setStored(STORAGE_KEY, liveOnly)
  }
  return liveOnly
}

export function saveAdminAccounts(accounts: AdminAccount[]): void {
  purgeLegacyLocalAdminCaches()
  const liveOnly = accounts.filter((acc) => !isLegacyDemoAccount(acc))
  setStored(STORAGE_KEY, liveOnly)
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('inferxe_admin_accounts_change'))
  }
}

let syncInFlight: Promise<{ ok: boolean; accounts: AdminAccount[]; error?: string }> | null = null
let lastSyncTimestamp = 0
const SYNC_CACHE_TTL_MS = 20000 // 20s TTL

export async function syncAdminAccountsFromBackend(force = false): Promise<{
  ok: boolean
  accounts: AdminAccount[]
  error?: string
}> {
  if (!force && Date.now() - lastSyncTimestamp < SYNC_CACHE_TTL_MS) {
    const existing = getAdminAccounts()
    if (existing.length > 0) {
      return { ok: true, accounts: existing }
    }
  }

  if (!force && syncInFlight) {
    return syncInFlight
  }

  syncInFlight = (async () => {
    try {
      const result = await fetchSuperadminAdmins(force)
      if (!result.ok || !result.admins) {
        return {
          ok: false,
          accounts: getAdminAccounts(),
          error: result.error || 'Failed to load administrator accounts from backend.',
        }
      }
      const mapped = result.admins.map(mapBackendAdminToAccount)
      saveAdminAccounts(mapped)
      lastSyncTimestamp = Date.now()
      return { ok: true, accounts: mapped }
    } finally {
      syncInFlight = null
    }
  })()

  return syncInFlight
}

export function resetToDefaultAccounts(): AdminAccount[] {
  saveAdminAccounts([])
  return []
}

export function getAdminActivities(): AdminActivityLog[] {
  const stored = getStored<AdminActivityLog[]>(ACTIVITIES_STORAGE_KEY, [])
  if (!stored || !Array.isArray(stored)) {
    return []
  }
  const real = stored.filter((a) => !a.isDemo && !a.id.startsWith('act-'))
  if (real.length !== stored.length) {
    setStored(ACTIVITIES_STORAGE_KEY, real)
  }
  return real
}

export function saveAdminActivities(activities: AdminActivityLog[]): void {
  setStored(ACTIVITIES_STORAGE_KEY, activities)
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('inferxe_admin_activities_change'))
  }
}

export function resetToDefaultActivities(): AdminActivityLog[] {
  saveAdminActivities([])
  return []
}

export async function syncAdminActivitiesFromBackend(): Promise<{
  ok: boolean
  activities: AdminActivityLog[]
  error?: string
}> {
  const result = await fetchSuperadminActivity({ limit: 100 })
  if (!result.ok || !result.activities) {
    return {
      ok: false,
      activities: getAdminActivities(),
      error: result.error || 'Failed to load activities from backend.',
    }
  }
  const mapped: AdminActivityLog[] = result.activities.map((a: any) => ({
    id: String(a.id),
    adminId: String(a.adminId || a.details?.actor_admin_id || ''),
    adminName: String(a.adminName || a.details?.actor_name || a.adminEmail?.split('@')[0] || 'Administrator'),
    adminEmail: String(a.adminEmail || a.admin_email || 'system'),
    action: String(a.action || 'admin.action'),
    category: (a.category as ActivityCategory) || 'Platform Operations',
    targetResource: String(a.targetResource || a.target_id || a.target_type || ''),
    severity: (a.severity as ActivitySeverity) || 'info',
    timestamp: a.timestamp || formatRelativeTime(a.created_at || a.isoTimestamp),
    isoTimestamp: a.isoTimestamp || a.created_at || new Date().toISOString(),
    description: a.description || undefined,
    previousValue: a.previousValue || undefined,
    newValue: a.newValue || undefined,
    source: a.source || 'Super Admin Portal',
    ipAddress: a.ipAddress || a.ip_address || '',
    userAgent: a.userAgent || a.user_agent || '',
    targetType: a.target_type || a.targetType || '',
    targetId: a.target_id || a.targetId || '',
    details: a.details || {},
    isDemo: false,
  }))
  if (mapped.length > 0) {
    saveAdminActivities(mapped)
  }
  return { ok: true, activities: mapped.length > 0 ? mapped : getAdminActivities() }
}

export function logAdminActivity(
  entry: Omit<AdminActivityLog, 'id' | 'timestamp' | 'isoTimestamp'> & {
    id?: string
    timestamp?: string
    isoTimestamp?: string
  }
): AdminActivityLog {
  const isoTimestamp = entry.isoTimestamp || new Date().toISOString()
  const timestamp = entry.timestamp || formatRelativeTime(isoTimestamp)
  const id = entry.id || `act-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`

  const newLog: AdminActivityLog = {
    id,
    adminId: entry.adminId || 'adm-001',
    adminName: entry.adminName || 'Bhumireddy Sahith',
    adminEmail: entry.adminEmail || 'bhumireddy@inferxe.com',
    action: entry.action,
    category: entry.category,
    targetResource: entry.targetResource,
    severity: entry.severity,
    timestamp,
    isoTimestamp,
    description: entry.description,
    previousValue: entry.previousValue,
    newValue: entry.newValue,
    source: entry.source || 'Super Admin Portal',
    ipAddress: entry.ipAddress || '103.21.144.62 (Bengaluru, IN)',
    isDemo: entry.isDemo ?? false,
  }

  const current = getAdminActivities()
  const updated = [newLog, ...current]
  saveAdminActivities(updated)
  return newLog
}

export function getAdminSecurityEvents(): AdminSecurityEvent[] {
  return DEFAULT_SECURITY_EVENTS
}

export interface NewAdminInput {
  fullName: string
  email: string
  role: AdminRole
  department?: string
  status?: AdminStatus
  notes?: string
}

export type CreateAdminInput = NewAdminInput

export function createAdminAccount(input: NewAdminInput): { ok: boolean; account?: AdminAccount; error?: string } {
  const fullName = input.fullName.trim()
  const email = input.email.trim().toLowerCase()

  if (!fullName) {
    return { ok: false, error: 'Full name is required.' }
  }

  // Strict company domain validation
  if (!email.endsWith('@inferxe.com')) {
    return { ok: false, error: 'Platform administrator accounts must use an official @inferxe.com company email address.' }
  }

  const existing = getAdminAccounts()
  if (existing.some((a) => a.email.toLowerCase() === email)) {
    return { ok: false, error: 'An administrator account with this company email already exists.' }
  }

  const initials = fullName
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .substring(0, 2)
    .toUpperCase() || 'AD'

  const roleMeta = getAdminRoleMeta(input.role)
  const newAccount: AdminAccount = {
    id: `adm-${Date.now().toString(36).substring(2, 7)}`,
    fullName,
    email,
    role: input.role,
    status: input.status || 'invited',
    department: input.department?.trim() || 'Platform Administration',
    createdAt: new Date().toISOString(),
    lastActiveAt: input.status === 'active' ? 'Just now' : 'Pending invitation',
    avatarInitials: initials,
    avatarGradient: `linear-gradient(135deg, ${roleMeta.color}, #08140d)`,
    notes: input.notes?.trim() || 'Invited platform administrator.',
  }

  const updated = [newAccount, ...existing]
  saveAdminAccounts(updated)

  // Append to activity log
  logAdminActivity({
    adminId: 'adm-001',
    adminName: 'Bhumireddy Sahith',
    adminEmail: 'bhumireddy@inferxe.com',
    action: input.status === 'active' ? 'Provisioned Administrator Account' : 'Issued Invitation Link',
    category: 'Admin Accounts',
    targetResource: `${email} (${roleMeta.title})`,
    severity: 'info',
    description: `Created platform administrator account for ${fullName} with ${roleMeta.title} role.`,
    previousValue: 'None (Unregistered)',
    newValue: `${email} [Status: ${input.status || 'invited'}]`,
    source: 'Super Admin Portal',
    ipAddress: '103.21.144.62 (Bengaluru, IN)',
  })

  return { ok: true, account: newAccount }
}

export function updateAdminAccount(
  id: string,
  updates: Partial<Pick<AdminAccount, 'fullName' | 'role' | 'status' | 'department' | 'notes'>>
): { ok: boolean; account?: AdminAccount; error?: string } {
  if (id === 'adm-001' && updates.status && updates.status !== 'active') {
    return { ok: false, error: 'The primary Super Admin account cannot be deactivated or suspended.' }
  }

  const accounts = getAdminAccounts()
  const index = accounts.findIndex((a) => a.id === id)
  if (index === -1) {
    return { ok: false, error: 'Administrator account was not found.' }
  }

  const current = accounts[index]
  const updatedAccount: AdminAccount = {
    ...current,
    ...updates,
  }

  accounts[index] = updatedAccount
  saveAdminAccounts(accounts)

  // Append to activity log
  const updatedRoleMeta = getAdminRoleMeta(updatedAccount.role)
  logAdminActivity({
    adminId: 'adm-001',
    adminName: 'Bhumireddy Sahith',
    adminEmail: 'bhumireddy@inferxe.com',
    action: updates.status ? `Updated Account Status to ${updates.status}` : 'Updated Administrator Privileges',
    category: 'Admin Accounts',
    targetResource: `${current.email} (${updatedRoleMeta.title})`,
    severity: updates.status === 'inactive' ? 'warning' : 'info',
    description: `Updated profile details for administrator ${current.fullName} (${current.email}).`,
    previousValue: `Role: ${current.role}, Status: ${current.status}`,
    newValue: `Role: ${updatedAccount.role}, Status: ${updatedAccount.status}`,
    source: 'Super Admin Portal',
    ipAddress: '103.21.144.62 (Bengaluru, IN)',
  })

  return { ok: true, account: updatedAccount }
}

export function setAdminStatus(
  id: string,
  status: AdminStatus
): { ok: boolean; account?: AdminAccount; error?: string } {
  if (id === 'adm-001' && status !== 'active') {
    return { ok: false, error: 'The primary Super Admin account cannot be deactivated.' }
  }
  return updateAdminAccount(id, { status })
}

export function toggleAdminStatus(id: string): { ok: boolean; account?: AdminAccount; error?: string } {
  if (id === 'adm-001') {
    return { ok: false, error: 'The primary Super Admin account cannot be deactivated.' }
  }
  const accounts = getAdminAccounts()
  const account = accounts.find((a) => a.id === id)
  if (!account) return { ok: false, error: 'Administrator account not found.' }

  const nextStatus: AdminStatus = account.status === 'active' ? 'inactive' : 'active'
  return updateAdminAccount(id, { status: nextStatus })
}

export function deleteAdminAccount(
  id: string
): { ok: boolean; deletedAccount?: AdminAccount; error?: string } {
  if (id === 'adm-001') {
    return { ok: false, error: 'The primary Super Admin account cannot be deleted.' }
  }

  const accounts = getAdminAccounts()
  const index = accounts.findIndex((a) => a.id === id)
  if (index === -1) {
    return { ok: false, error: 'Administrator account was not found or has already been deleted.' }
  }

  const [deletedAccount] = accounts.splice(index, 1)
  saveAdminAccounts(accounts)

  // Append to activity log
  logAdminActivity({
    adminId: 'adm-001',
    adminName: 'Bhumireddy Sahith',
    adminEmail: 'bhumireddy@inferxe.com',
    action: 'Deleted Administrator Account',
    category: 'Admin Accounts',
    targetResource: `${deletedAccount.fullName} (${deletedAccount.email})`,
    severity: 'critical',
    description: `Permanently removed administrator account ${deletedAccount.fullName} (${deletedAccount.email}) from platform registry.`,
    previousValue: `Active Record: ${deletedAccount.email}`,
    newValue: 'Permanently Deleted',
    source: 'Super Admin Portal',
    ipAddress: '103.21.144.62 (Bengaluru, IN)',
  })

  return { ok: true, deletedAccount }
}

export function getAdminSummaryStats() {
  const accounts = getAdminAccounts()
  const total = accounts.length
  const active = accounts.filter((a) => a.status === 'active').length
  const inactive = accounts.filter((a) => a.status === 'inactive').length
  const pending = accounts.filter((a) => a.status === 'invited').length

  const roleDistribution: Record<AdminRole, number> = {
    superadmin: 0,
    super_admin: 0,
    admin: 0,
  }

  accounts.forEach((a) => {
    if (roleDistribution[a.role] !== undefined) {
      roleDistribution[a.role] += 1
    }
  })

  return {
    total,
    active,
    inactive,
    pending,
    roleDistribution,
  }
}
