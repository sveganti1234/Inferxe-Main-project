/**
 * Super Admin & Platform Administrator Accounts Store
 * ===================================================
 * Synchronizes live platform administrator accounts directly from the backend
 * Supabase-backed endpoints (`/api/superadmin/admins`, `/api/superadmin/admins/status`).
 * All hardcoded placeholder/demo administrator accounts have been removed.
 */
import { fetchSuperadminAdmins, type SuperadminAdminRecord } from './authStore'

export type AdminRole =
  | 'super_admin'
  | 'admin'
  | 'infrastructure_admin'
  | 'billing_admin'
  | 'support_admin'
  | 'security_auditor'
  | (string & {})

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
  super_admin: {
    title: 'Super Admin',
    description: 'Full platform governance, admin account lifecycle, and unrestricted access.',
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
  infrastructure_admin: {
    title: 'Infrastructure Admin',
    description: 'GPU fleet orchestration, sovereign cluster nodes, topology, and hardware health.',
    badgeClass: 'chip--cyan',
    color: '#06b6d4',
    permissionsSummary: ['GPU Node Fleet', 'NVLink & Pod Orchestration', 'Capacity & Maintenance', 'Cluster SLAs'],
  },
  billing_admin: {
    title: 'Billing Admin',
    description: 'FinOps management, wallet credit balances, invoicing, and provider payout approvals.',
    badgeClass: 'chip--amber',
    color: '#f59e0b',
    permissionsSummary: ['Wallet Reserves', 'Spend Caps & Overrides', 'Provider Payouts', 'Financial Reports'],
  },
  support_admin: {
    title: 'Support Admin',
    description: 'Customer onboarding assistance, model catalog access, and workspace triage.',
    badgeClass: 'chip--purple',
    color: '#a855f7',
    permissionsSummary: ['Customer Account Triage', 'Model Quota Grants', 'SSH Key Assistance', 'Ticket Escalations'],
  },
  security_auditor: {
    title: 'Security Auditor',
    description: 'Compliance verification, cryptographic key audits, and platform activity logs.',
    badgeClass: 'chip--red',
    color: '#ef4444',
    permissionsSummary: ['Audit Logs Read-Only', 'Compliance Reviews', 'MFA Status Audits', 'Security Telemetry'],
  },
}

export function getAdminRoleMeta(role: string): {
  title: string
  description: string
  badgeClass: string
  color: string
  permissionsSummary: string[]
} {
  if (ADMIN_ROLE_METADATA[role]) {
    return ADMIN_ROLE_METADATA[role]
  }
  const formatted = role
    .replace(/^custom_/, '')
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
  return {
    title: formatted || 'Custom Role',
    description: 'Custom platform RBAC role.',
    badgeClass: 'chip--emerald',
    color: '#10b981',
    permissionsSummary: ['Custom Assigned Capabilities'],
  }
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
  const now = Date.now()
  const offset = (ms: number) => new Date(now - ms).toISOString()

  return [
    {
      id: 'act-01',
      adminId: 'adm-001',
      adminName: 'Bhumireddy Sahith',
      adminEmail: 'bhumireddy@inferxe.com',
      action: 'Simulated Prototype Invitation Issued',
      category: 'Admin Accounts',
      targetResource: 'ananya.rao@inferxe.com (Billing Admin)',
      severity: 'info',
      timestamp: '25m ago',
      isoTimestamp: offset(25 * 60 * 1000),
      description: 'Generated demonstration Supabase Auth invitation token for new financial controller.',
      previousValue: 'None (Unregistered)',
      newValue: 'ananya.rao@inferxe.com [Role: billing_admin, Status: invited]',
      source: 'Super Admin Portal',
      ipAddress: '103.21.144.62 (Bengaluru, IN)',
      isDemo: true,
    },
    {
      id: 'act-02',
      adminId: 'adm-003',
      adminName: 'Vikram Malhotra',
      adminEmail: 'vikram.malhotra@inferxe.com',
      action: 'Reallocated GPU Workload Partition',
      category: 'Platform Operations',
      targetResource: 'Node NM1-H100-Rack04',
      severity: 'success',
      timestamp: '1h ago',
      isoTimestamp: offset(60 * 60 * 1000),
      description: 'Migrated 8x SXM5 H100 GPU pods from batch inference pool to priority fine-tuning queue.',
      previousValue: 'Batch Queue (8 pods)',
      newValue: 'Priority Queue (8 pods)',
      source: 'Infrastructure Orchestrator',
      ipAddress: '103.21.144.63 (Bengaluru, IN)',
      isDemo: true,
    },
    {
      id: 'act-03',
      adminId: 'adm-004',
      adminName: 'Priya Sharma',
      adminEmail: 'priya.sharma@inferxe.com',
      action: 'Modified Monthly Spending Ceiling',
      category: 'Platform Operations',
      targetResource: 'Customer Org: Synthesia AI (₹5,00,000)',
      severity: 'warning',
      timestamp: '3h ago',
      isoTimestamp: offset(3 * 60 * 60 * 1000),
      description: 'Approved enterprise overdraft request and raised monthly credit limit from ₹3,00,000 to ₹5,00,000.',
      previousValue: '₹3,00,000',
      newValue: '₹5,00,000',
      source: 'Super Admin Portal',
      ipAddress: '103.21.144.64 (Bengaluru, IN)',
      isDemo: true,
    },
    {
      id: 'act-04',
      adminId: 'adm-001',
      adminName: 'Bhumireddy Sahith',
      adminEmail: 'bhumireddy@inferxe.com',
      action: 'Granted Permission to Role',
      category: 'Permission Changes',
      targetResource: 'Role: Cluster Operator → Perm: infra:telemetry:view',
      severity: 'warning',
      timestamp: '5h ago',
      isoTimestamp: offset(5 * 60 * 60 * 1000),
      description: 'Enabled real-time hardware telemetry access on Cluster Operator role for datacenter thermal monitoring.',
      previousValue: 'Revoked',
      newValue: 'Granted',
      source: 'RBAC Permission Matrix',
      ipAddress: '103.21.144.62 (Bengaluru, IN)',
      isDemo: true,
    },
    {
      id: 'act-05',
      adminId: 'adm-009',
      adminName: 'Devon Vance',
      adminEmail: 'devon.vance@inferxe.com',
      action: 'Generated SOC2 Access Review Snapshot',
      category: 'Security',
      targetResource: 'All Privileged Admin Roles (5 standard, 1 custom)',
      severity: 'info',
      timestamp: '8h ago',
      isoTimestamp: offset(8 * 60 * 60 * 1000),
      description: 'Generated immutable audit checkpoint for quarterly sovereign security compliance review.',
      previousValue: 'None',
      newValue: 'Audit Checkpoint #SOC2-2026-Q1',
      source: 'Compliance Engine',
      ipAddress: '103.21.144.65 (Bengaluru, IN)',
      isDemo: true,
    },
    {
      id: 'act-06',
      adminId: 'adm-002',
      adminName: 'Alex Chen',
      adminEmail: 'alex.chen@inferxe.com',
      action: 'Simulated Token Revocation Test',
      category: 'Security',
      targetResource: 'rohan.mehta@inferxe.com',
      severity: 'critical',
      timestamp: '1d ago',
      isoTimestamp: offset(26 * 60 * 60 * 1000),
      description: 'Terminated all active API tokens and browser sessions following account suspension drill.',
      previousValue: 'Active Sessions: 3',
      newValue: 'All Sessions Terminated (Revoked)',
      source: 'Security Boundary Agent',
      ipAddress: '103.21.144.61 (Bengaluru, IN)',
      isDemo: true,
    },
    {
      id: 'act-07',
      adminId: 'adm-007',
      adminName: 'Neha Deshmukh',
      adminEmail: 'neha.deshmukh@inferxe.com',
      action: 'Applied Warm Pool Scale Policy',
      category: 'Platform Operations',
      targetResource: 'L40S Sovereign Inference Nodes (Zone IN-WEST-1)',
      severity: 'success',
      timestamp: '1d ago',
      isoTimestamp: offset(30 * 60 * 60 * 1000),
      description: 'Increased pre-warmed sovereign inference standby nodes from 4 to 8 ahead of scheduled customer batch job.',
      previousValue: 'Standby: 4 nodes',
      newValue: 'Standby: 8 nodes',
      source: 'Autoscaler Daemon',
      ipAddress: '103.21.144.66 (Bengaluru, IN)',
      isDemo: true,
    },
    {
      id: 'act-08',
      adminId: 'adm-001',
      adminName: 'Bhumireddy Sahith',
      adminEmail: 'bhumireddy@inferxe.com',
      action: 'Created Custom RBAC Role',
      category: 'Role Management',
      targetResource: 'Role: Cluster Operator (custom_cluster_operator)',
      severity: 'info',
      timestamp: '2d ago',
      isoTimestamp: offset(48 * 60 * 60 * 1000),
      description: 'Provisioned specialized telemetry and node monitor role for sovereign datacenter field technicians.',
      previousValue: 'Non-existent',
      newValue: 'Cluster Operator (4 permissions)',
      source: 'Super Admin Portal',
      ipAddress: '103.21.144.62 (Bengaluru, IN)',
      isDemo: true,
    },
    {
      id: 'act-09',
      adminId: 'adm-009',
      adminName: 'Devon Vance',
      adminEmail: 'devon.vance@inferxe.com',
      action: 'Enforced Hardware MFA Policy',
      category: 'Security',
      targetResource: 'All Platform Administrators (@inferxe.com)',
      severity: 'critical',
      timestamp: '3d ago',
      isoTimestamp: offset(72 * 60 * 60 * 1000),
      description: 'Strict FIDO2 WebAuthn hardware security keys required on all administrative logins.',
      previousValue: 'Software TOTP Allowed',
      newValue: 'FIDO2 / WebAuthn Hardware Keys Mandatory',
      source: 'Auth Policy Controller',
      ipAddress: '103.21.144.65 (Bengaluru, IN)',
      isDemo: true,
    },
    {
      id: 'act-10',
      adminId: 'adm-001',
      adminName: 'Bhumireddy Sahith',
      adminEmail: 'bhumireddy@inferxe.com',
      action: 'Updated Account Status to inactive',
      category: 'Admin Accounts',
      targetResource: 'rohan.mehta@inferxe.com (Support Admin)',
      severity: 'warning',
      timestamp: '3d ago',
      isoTimestamp: offset(75 * 60 * 60 * 1000),
      description: 'Temporary administrative suspension pending routine credential and laptop rotation.',
      previousValue: 'Status: active',
      newValue: 'Status: inactive',
      source: 'Super Admin Portal',
      ipAddress: '103.21.144.62 (Bengaluru, IN)',
      isDemo: true,
    },
    {
      id: 'act-11',
      adminId: 'adm-002',
      adminName: 'Alex Chen',
      adminEmail: 'alex.chen@inferxe.com',
      action: 'Rotated Fabric TLS Certificates',
      category: 'Security',
      targetResource: 'RoCE Fabric Interconnect Cluster (Mumbai Zone A)',
      severity: 'success',
      timestamp: '5d ago',
      isoTimestamp: offset(120 * 60 * 60 * 1000),
      description: 'Successfully re-keyed mutual TLS mTLS certificates for all 64 NVLink switches without traffic drop.',
      previousValue: 'Cert Exp: 2026-02-28',
      newValue: 'Cert Exp: 2027-02-28',
      source: 'PKI Certificate Authority',
      ipAddress: '103.21.144.61 (Bengaluru, IN)',
      isDemo: true,
    },
    {
      id: 'act-12',
      adminId: 'adm-004',
      adminName: 'Priya Sharma',
      adminEmail: 'priya.sharma@inferxe.com',
      action: 'Approved Compute Provider Settlement',
      category: 'Platform Operations',
      targetResource: 'Batch #SETTLE-2026-03A (₹48,20,000)',
      severity: 'success',
      timestamp: '6d ago',
      isoTimestamp: offset(144 * 60 * 60 * 1000),
      description: 'Disbursement batch authorized for Tier-1 datacenter partners hosting sovereign H100 pods.',
      previousValue: 'Pending Approval',
      newValue: 'Settled & Transferred',
      source: 'FinOps Settlement Ledger',
      ipAddress: '103.21.144.64 (Bengaluru, IN)',
      isDemo: true,
    },
    {
      id: 'act-13',
      adminId: 'adm-001',
      adminName: 'Bhumireddy Sahith',
      adminEmail: 'bhumireddy@inferxe.com',
      action: 'Updated Role Permission Matrix',
      category: 'Permission Changes',
      targetResource: 'Role: Security Auditor',
      severity: 'info',
      timestamp: '8d ago',
      isoTimestamp: offset(192 * 60 * 60 * 1000),
      description: 'Mapped new platform permission "api:keys:view" to Security Auditor role.',
      previousValue: '6 permissions',
      newValue: '7 permissions',
      source: 'RBAC Engine',
      ipAddress: '103.21.144.62 (Bengaluru, IN)',
      isDemo: true,
    },
    {
      id: 'act-14',
      adminId: 'adm-001',
      adminName: 'Bhumireddy Sahith',
      adminEmail: 'bhumireddy@inferxe.com',
      action: 'Provisioned Administrator Account',
      category: 'Admin Accounts',
      targetResource: 'devon.vance@inferxe.com (Security Auditor)',
      severity: 'info',
      timestamp: '12d ago',
      isoTimestamp: offset(288 * 60 * 60 * 1000),
      description: 'Onboarded Lead Security Auditor with perimeter compliance and audit privileges.',
      previousValue: 'None',
      newValue: 'devon.vance@inferxe.com [Role: security_auditor]',
      source: 'Super Admin Portal',
      ipAddress: '103.21.144.62 (Bengaluru, IN)',
      isDemo: true,
    },
  ]
}

export const DEFAULT_ADMIN_ACTIVITIES: AdminActivityLog[] = generateDefaultAdminActivities()

export const DEFAULT_SECURITY_EVENTS: AdminSecurityEvent[] = [
  {
    id: 'sec-1',
    eventType: 'Hardware MFA Authentication Verification',
    actor: 'bhumireddy@inferxe.com',
    ipAddress: '103.21.144.62 (Bengaluru, IN)',
    location: 'Corporate HQ Gateway',
    status: 'allowed',
    timestamp: 'Sample Event · 14m ago',
    details: 'Demonstration FIDO2 WebAuthn hardware token verification test.',
    isDemo: true,
  },
  {
    id: 'sec-2',
    eventType: 'Inactive Account Access Boundary Check',
    actor: 'rohan.mehta@inferxe.com',
    ipAddress: '49.207.182.11 (Mumbai, IN)',
    location: 'Public Endpoint',
    status: 'blocked',
    timestamp: 'Sample Event · 2h ago',
    details: 'Demonstration test: Access denied as expected for suspended administrative account.',
    isDemo: true,
  },
  {
    id: 'sec-3',
    eventType: 'Cryptographic Key Rotation Simulated Probe',
    actor: 'devon.vance@inferxe.com',
    ipAddress: '103.21.144.65 (Bengaluru, IN)',
    location: 'Corporate HQ Gateway',
    status: 'allowed',
    timestamp: 'Sample Event · 4h ago',
    details: 'Demonstration routine periodic session credential refresh verification.',
    isDemo: true,
  },
  {
    id: 'sec-4',
    eventType: 'Perimeter Rate Limiting Probe',
    actor: 'probe-test@security-sim.internal',
    ipAddress: '185.220.101.5 (Simulated Tor Exit)',
    location: 'External Boundary',
    status: 'blocked',
    timestamp: 'Sample Event · 6h ago',
    details: 'Demonstration probe: Threshold exceeded, perimeter rate-limiting triggered.',
    isDemo: true,
  },
  {
    id: 'sec-5',
    eventType: 'Sovereign Node Telemetry Authorization',
    actor: 'vikram.malhotra@inferxe.com',
    ipAddress: '103.21.144.63 (Bengaluru, IN)',
    location: 'Corporate HQ Gateway',
    status: 'allowed',
    timestamp: 'Sample Event · 7h ago',
    details: 'Demonstration test: Direct SSH tunnel authorization verified via MeitY sovereign policy.',
    isDemo: true,
  },
]

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

export async function syncAdminAccountsFromBackend(): Promise<{
  ok: boolean
  accounts: AdminAccount[]
  error?: string
}> {
  const result = await fetchSuperadminAdmins()
  if (!result.ok || !result.admins) {
    return {
      ok: false,
      accounts: getAdminAccounts(),
      error: result.error || 'Failed to load administrator accounts from backend.',
    }
  }
  const mapped = result.admins.map(mapBackendAdminToAccount)
  saveAdminAccounts(mapped)
  return { ok: true, accounts: mapped }
}

export function resetToDefaultAccounts(): AdminAccount[] {
  saveAdminAccounts([])
  return []
}

export function getAdminActivities(): AdminActivityLog[] {
  const stored = getStored<AdminActivityLog[]>(ACTIVITIES_STORAGE_KEY, [])
  if (!stored || stored.length === 0 || !stored[0]?.category) {
    const fresh = generateDefaultAdminActivities()
    setStored(ACTIVITIES_STORAGE_KEY, fresh)
    return fresh
  }
  return stored
}

export function saveAdminActivities(activities: AdminActivityLog[]): void {
  setStored(ACTIVITIES_STORAGE_KEY, activities)
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('inferxe_admin_activities_change'))
  }
}

export function resetToDefaultActivities(): AdminActivityLog[] {
  const fresh = generateDefaultAdminActivities()
  saveAdminActivities(fresh)
  return fresh
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
    super_admin: 0,
    admin: 0,
    infrastructure_admin: 0,
    billing_admin: 0,
    support_admin: 0,
    security_auditor: 0,
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
