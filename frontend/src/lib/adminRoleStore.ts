/**
 * Super Admin & Platform RBAC Role Store (Phase 2.1 Development)
 * =============================================================
 * Manages standard and custom role definitions, permission matrices,
 * and role-to-administrator mappings for the Inferxe platform.
 * 
 * Persistence: Local prototype storage (`localStorage`) in Phase 2.1.
 * Integrates with `adminAccountStore.ts` for administrator assignments.
 */

import { getAdminAccounts, logAdminActivity, type AdminAccount } from './adminAccountStore'

export type PermissionCategory =
  | 'GPU Infrastructure'
  | 'FinOps & Billing'
  | 'Customer & Workspaces'
  | 'Security & Compliance'
  | 'Administration & RBAC'
  | 'API & Networking'

export interface RolePermission {
  id: string
  name: string
  description: string
  category: PermissionCategory
}

export interface AdminRoleDefinition {
  id: string
  name: string
  description: string
  isStandard: boolean
  permissions: string[] // Array of permission IDs
  color: string
  badgeClass: string
  createdAt: string
  updatedAt: string
  isDemo?: boolean
}

export interface CreateRoleInput {
  name: string
  description: string
  permissions: string[]
  color?: string
}

export interface UpdateRoleInput {
  name?: string
  description?: string
  permissions?: string[]
  color?: string
}

// ── Complete Platform Permission Matrix (25 Permissions across 6 Categories) ──
export const PLATFORM_PERMISSIONS: RolePermission[] = [
  // 1. GPU Infrastructure (5)
  {
    id: 'infra:nodes:view',
    name: 'View GPU Fleet & Topology',
    description: 'Inspect sovereign GPU clusters, node states, NVLink connectivity, and fabric health.',
    category: 'GPU Infrastructure',
  },
  {
    id: 'infra:nodes:manage',
    name: 'Manage Cluster Nodes',
    description: 'Provision, drain, cordon, restart, and apply firmware maintenance on GPU nodes.',
    category: 'GPU Infrastructure',
  },
  {
    id: 'infra:workloads:view',
    name: 'Inspect Model Workloads',
    description: 'View active LLM training pods, batch inference queues, and compute allocations.',
    category: 'GPU Infrastructure',
  },
  {
    id: 'infra:workloads:manage',
    name: 'Schedule & Preempt Workloads',
    description: 'Prioritize, terminate, reschedule, and balance workloads across cluster nodes.',
    category: 'GPU Infrastructure',
  },
  {
    id: 'infra:telemetry:view',
    name: 'Real-Time Hardware Telemetry',
    description: 'Access low-level thermal curves, power draw, RoCE packet loss, and sensor telemetry.',
    category: 'GPU Infrastructure',
  },

  // 2. FinOps & Billing (4)
  {
    id: 'billing:invoices:view',
    name: 'View Billing & Settlements',
    description: 'Inspect customer billing statements, consumption logs, and financial settlement ledgers.',
    category: 'FinOps & Billing',
  },
  {
    id: 'billing:credits:manage',
    name: 'Adjust Wallet Credits & Caps',
    description: 'Grant wallet credits, configure overdraft thresholds, and apply promotional discounts.',
    category: 'FinOps & Billing',
  },
  {
    id: 'billing:payouts:approve',
    name: 'Approve Provider Payouts',
    description: 'Authorize compute provider revenue payouts and review disbursement batches.',
    category: 'FinOps & Billing',
  },
  {
    id: 'billing:pricing:configure',
    name: 'Configure GPU Pricing Tiers',
    description: 'Define spot, on-demand, and reserved hourly rates for H100, L40S, and A100 instances.',
    category: 'FinOps & Billing',
  },

  // 3. Customer & Workspaces (4)
  {
    id: 'customers:accounts:view',
    name: 'View Customer Organizations',
    description: 'Browse enterprise tenant directory, customer accounts, and workspace metadata.',
    category: 'Customer & Workspaces',
  },
  {
    id: 'customers:accounts:manage',
    name: 'Manage Customer Workspaces',
    description: 'Suspend, reactivate, or modify quota allocations for customer workspaces.',
    category: 'Customer & Workspaces',
  },
  {
    id: 'customers:models:grant',
    name: 'Grant Model Catalog Access',
    description: 'Provision private weights, gated HuggingFace models, and specialized LLM checkpoints.',
    category: 'Customer & Workspaces',
  },
  {
    id: 'customers:support:triage',
    name: 'Customer Support Triage',
    description: 'Inspect customer session logs, API errors, and diagnose customer infrastructure issues.',
    category: 'Customer & Workspaces',
  },

  // 4. Security & Compliance (4)
  {
    id: 'security:audit:view',
    name: 'Access Platform Audit Logs',
    description: 'Read-only access to immutable security audit trails and administrator activity logs.',
    category: 'Security & Compliance',
  },
  {
    id: 'security:keys:rotate',
    name: 'Manage Keys & Secrets',
    description: 'Rotate cryptographic TLS certificates, internal RPC tokens, and service credentials.',
    category: 'Security & Compliance',
  },
  {
    id: 'security:mfa:enforce',
    name: 'Enforce MFA & Auth Policies',
    description: 'Audit administrator authentication factors, session timeouts, and IP whitelists.',
    category: 'Security & Compliance',
  },
  {
    id: 'security:policies:manage',
    name: 'Configure Sovereign Boundaries',
    description: 'Define geographic isolation rules, strict network egress, and tenancy partitions.',
    category: 'Security & Compliance',
  },

  // 5. Administration & RBAC (5)
  {
    id: 'admin:accounts:view',
    name: 'View Platform Administrators',
    description: 'Inspect @inferxe.com administrator roster, departments, and active statuses.',
    category: 'Administration & RBAC',
  },
  {
    id: 'admin:accounts:manage',
    name: 'Manage Administrator Accounts',
    description: 'Invite, provision, suspend, reactivate, or permanently delete platform administrators.',
    category: 'Administration & RBAC',
  },
  {
    id: 'admin:roles:view',
    name: 'View RBAC Role Directory',
    description: 'Inspect standard and custom platform roles and their assigned permission mappings.',
    category: 'Administration & RBAC',
  },
  {
    id: 'admin:roles:manage',
    name: 'Manage Custom RBAC Roles',
    description: 'Author, customize, duplicate, and delete custom role templates and permissions.',
    category: 'Administration & RBAC',
  },
  {
    id: 'admin:platform:override',
    name: 'Global Governance Overrides',
    description: 'Execute emergency cluster lockouts, maintenance windows, and root system overrides.',
    category: 'Administration & RBAC',
  },

  // 6. API & Networking (3)
  {
    id: 'api:keys:view',
    name: 'Inspect Platform API Keys',
    description: 'View active API tokens, rate limit tiers, and developer gateway usage metrics.',
    category: 'API & Networking',
  },
  {
    id: 'api:keys:revoke',
    name: 'Revoke Leaked API Credentials',
    description: 'Immediately revoke compromised API keys and invalidate active token sessions.',
    category: 'API & Networking',
  },
  {
    id: 'network:topology:view',
    name: 'View Network Fabric Topology',
    description: 'Inspect InfiniBand subnet managers, RoCEv2 switches, and edge peering points.',
    category: 'API & Networking',
  },
]

// ── 5 Protected Standard Roles ─────────────────────────────────────────
export const STANDARD_ROLES: AdminRoleDefinition[] = [
  {
    id: 'super_admin',
    name: 'Super Admin',
    description: 'Full platform governance, admin account lifecycle, and unrestricted access.',
    isStandard: true,
    color: '#50e396',
    badgeClass: 'chip--lime',
    permissions: PLATFORM_PERMISSIONS.map((p) => p.id),
    createdAt: '2026-01-15T00:00:00Z',
    updatedAt: '2026-01-15T00:00:00Z',
    isDemo: true,
  },
  {
    id: 'infrastructure_admin',
    name: 'Infrastructure Admin',
    description: 'GPU fleet orchestration, sovereign cluster nodes, topology, and hardware health.',
    isStandard: true,
    color: '#06b6d4',
    badgeClass: 'chip--cyan',
    permissions: [
      'infra:nodes:view',
      'infra:nodes:manage',
      'infra:workloads:view',
      'infra:workloads:manage',
      'infra:telemetry:view',
      'network:topology:view',
      'api:keys:view',
      'admin:accounts:view',
    ],
    createdAt: '2026-01-15T00:00:00Z',
    updatedAt: '2026-01-15T00:00:00Z',
    isDemo: true,
  },
  {
    id: 'billing_admin',
    name: 'Billing Admin',
    description: 'FinOps management, wallet credit balances, invoicing, and provider payout approvals.',
    isStandard: true,
    color: '#f59e0b',
    badgeClass: 'chip--amber',
    permissions: [
      'billing:invoices:view',
      'billing:credits:manage',
      'billing:payouts:approve',
      'billing:pricing:configure',
      'customers:accounts:view',
      'admin:accounts:view',
    ],
    createdAt: '2026-01-15T00:00:00Z',
    updatedAt: '2026-01-15T00:00:00Z',
    isDemo: true,
  },
  {
    id: 'support_admin',
    name: 'Support Admin',
    description: 'Customer onboarding assistance, model catalog access, and workspace triage.',
    isStandard: true,
    color: '#a855f7',
    badgeClass: 'chip--purple',
    permissions: [
      'customers:accounts:view',
      'customers:accounts:manage',
      'customers:models:grant',
      'customers:support:triage',
      'infra:workloads:view',
      'infra:nodes:view',
      'admin:accounts:view',
    ],
    createdAt: '2026-01-15T00:00:00Z',
    updatedAt: '2026-01-15T00:00:00Z',
    isDemo: true,
  },
  {
    id: 'security_auditor',
    name: 'Security Auditor',
    description: 'Compliance verification, cryptographic key audits, and platform activity logs.',
    isStandard: true,
    color: '#ef4444',
    badgeClass: 'chip--red',
    permissions: [
      'security:audit:view',
      'security:keys:rotate',
      'security:mfa:enforce',
      'security:policies:manage',
      'admin:accounts:view',
      'admin:roles:view',
      'api:keys:view',
    ],
    createdAt: '2026-01-15T00:00:00Z',
    updatedAt: '2026-01-15T00:00:00Z',
    isDemo: true,
  },
]

// ── Initial Prototype Custom Roles ──────────────────────────────────────
export const DEFAULT_CUSTOM_ROLES: AdminRoleDefinition[] = [
  {
    id: 'custom_cluster_operator',
    name: 'Cluster Operator',
    description: 'Specialized telemetry and node monitor role for datacenter operations without financial or customer billing access.',
    isStandard: false,
    color: '#10b981',
    badgeClass: 'chip--emerald',
    permissions: [
      'infra:nodes:view',
      'infra:workloads:view',
      'infra:telemetry:view',
      'network:topology:view',
    ],
    createdAt: '2026-02-15T10:00:00Z',
    updatedAt: '2026-02-15T10:00:00Z',
    isDemo: true,
  },
]

const CUSTOM_ROLES_STORAGE_KEY = 'inferxe_dev_custom_roles_v1'

function getStoredCustomRoles(): AdminRoleDefinition[] {
  try {
    const raw = localStorage.getItem(CUSTOM_ROLES_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) return parsed
    }
  } catch {
    // Fallback to default
  }
  return DEFAULT_CUSTOM_ROLES
}

function saveCustomRoles(roles: AdminRoleDefinition[]): void {
  try {
    localStorage.setItem(CUSTOM_ROLES_STORAGE_KEY, JSON.stringify(roles))
  } catch {
    // Ignore localStorage write failures in sandboxed contexts
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('inferxe_admin_roles_change'))
  }
}

// ── Public Store API ──────────────────────────────────────────────────

export function getAllPermissions(): RolePermission[] {
  return PLATFORM_PERMISSIONS
}

export function getPermissionCategories(): PermissionCategory[] {
  return [
    'GPU Infrastructure',
    'FinOps & Billing',
    'Customer & Workspaces',
    'Security & Compliance',
    'Administration & RBAC',
    'API & Networking',
  ]
}

export function getStandardRoles(): AdminRoleDefinition[] {
  return STANDARD_ROLES
}

export function getCustomRoles(): AdminRoleDefinition[] {
  return getStoredCustomRoles()
}

export function getAllRoles(): AdminRoleDefinition[] {
  return [...STANDARD_ROLES, ...getStoredCustomRoles()]
}

export function getRoleById(id: string): AdminRoleDefinition | undefined {
  return getAllRoles().find((r) => r.id === id)
}

/**
 * Returns all administrator accounts assigned to a specific role.
 */
export function getRoleAssignedAdmins(roleId: string): AdminAccount[] {
  const accounts = getAdminAccounts()
  return accounts.filter((a) => a.role === roleId)
}

/**
 * Returns summary stats for the Role Management dashboard.
 */
export function getRoleSummaryStats() {
  const allRoles = getAllRoles()
  const customRoles = getCustomRoles()
  const accounts = getAdminAccounts()

  const totalRoles = allRoles.length
  const standardRolesCount = STANDARD_ROLES.length
  const customRolesCount = customRoles.length

  // Total administrators assigned to any role
  const totalAssignedAdmins = accounts.length

  return {
    totalRoles,
    standardRolesCount,
    customRolesCount,
    totalAssignedAdmins,
  }
}

/**
 * Create a new custom role.
 */
export function createCustomRole(input: CreateRoleInput): {
  ok: boolean
  role?: AdminRoleDefinition
  error?: string
} {
  const trimmedName = input.name.trim()
  if (!trimmedName || trimmedName.length < 2) {
    return { ok: false, error: 'Role name must be at least 2 characters.' }
  }

  const allRoles = getAllRoles()
  if (allRoles.some((r) => r.name.toLowerCase() === trimmedName.toLowerCase())) {
    return { ok: false, error: `A role named "${trimmedName}" already exists. Role names must be unique.` }
  }

  if (!input.permissions || input.permissions.length === 0) {
    return { ok: false, error: 'Please select at least one permission for this role.' }
  }

  const roleId = `custom_${trimmedName.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${Date.now().toString(36).substring(2, 6)}`
  const color = input.color || '#10b981'

  const newRole: AdminRoleDefinition = {
    id: roleId,
    name: trimmedName,
    description: input.description.trim() || 'Custom platform role.',
    isStandard: false,
    permissions: input.permissions,
    color,
    badgeClass: 'chip--emerald',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    isDemo: true,
  }

  const customRoles = getCustomRoles()
  saveCustomRoles([...customRoles, newRole])

  // Log activity
  logAdminActivity({
    adminId: 'adm-001',
    adminName: 'Bhumireddy Sahith',
    adminEmail: 'bhumireddy@inferxe.com',
    action: 'Created Custom RBAC Role',
    category: 'Role Management',
    targetResource: `Role: ${newRole.name} (${newRole.id})`,
    severity: 'info',
    description: `Created new custom role "${newRole.name}" with ${newRole.permissions.length} granular permissions.`,
    previousValue: 'Non-existent',
    newValue: `${newRole.name} (${newRole.permissions.length} permissions)`,
    source: 'Super Admin Portal',
    ipAddress: '103.21.144.62 (Bengaluru, IN)',
  })

  return { ok: true, role: newRole }
}

/**
 * Update an existing custom role.
 */
export function updateCustomRole(
  id: string,
  updates: UpdateRoleInput
): { ok: boolean; role?: AdminRoleDefinition; error?: string } {
  const standardRole = STANDARD_ROLES.find((r) => r.id === id)
  if (standardRole) {
    return { ok: false, error: 'Standard platform roles are protected and cannot be edited or renamed.' }
  }

  const customRoles = getCustomRoles()
  const index = customRoles.findIndex((r) => r.id === id)
  if (index === -1) {
    return { ok: false, error: 'Custom role not found.' }
  }

  const current = customRoles[index]
  const prevName = current.name
  const prevPermsCount = current.permissions.length

  if (updates.name) {
    const trimmedName = updates.name.trim()
    if (trimmedName.length < 2) {
      return { ok: false, error: 'Role name must be at least 2 characters.' }
    }
    const allRoles = getAllRoles()
    const duplicate = allRoles.some(
      (r) => r.id !== id && r.name.toLowerCase() === trimmedName.toLowerCase()
    )
    if (duplicate) {
      return { ok: false, error: `A role named "${trimmedName}" already exists.` }
    }
    current.name = trimmedName
  }

  if (updates.description !== undefined) {
    current.description = updates.description.trim()
  }

  if (updates.permissions) {
    if (updates.permissions.length === 0) {
      return { ok: false, error: 'A role must contain at least one permission.' }
    }
    current.permissions = updates.permissions
  }

  if (updates.color) {
    current.color = updates.color
  }

  current.updatedAt = new Date().toISOString()
  customRoles[index] = current
  saveCustomRoles(customRoles)

  // Log activity
  logAdminActivity({
    adminId: 'adm-001',
    adminName: 'Bhumireddy Sahith',
    adminEmail: 'bhumireddy@inferxe.com',
    action: 'Updated Custom Role Configuration',
    category: 'Role Management',
    targetResource: `Role: ${current.name} (${current.id})`,
    severity: 'warning',
    description: `Modified custom role "${current.name}" properties and permissions.`,
    previousValue: `Name: ${prevName}, Permissions: ${prevPermsCount}`,
    newValue: `Name: ${current.name}, Permissions: ${current.permissions.length}`,
    source: 'Super Admin Portal',
    ipAddress: '103.21.144.62 (Bengaluru, IN)',
  })

  return { ok: true, role: current }
}

/**
 * Delete a custom role.
 * STRICT RULE: Prevents deletion of standard roles or any role currently assigned to administrators.
 */
export function deleteCustomRole(id: string): {
  ok: boolean
  deletedRole?: AdminRoleDefinition
  error?: string
  assignedAdmins?: AdminAccount[]
} {
  const standardRole = STANDARD_ROLES.find((r) => r.id === id)
  if (standardRole) {
    return { ok: false, error: 'Standard platform roles cannot be deleted.' }
  }

  const assignedAdmins = getRoleAssignedAdmins(id)
  if (assignedAdmins.length > 0) {
    return {
      ok: false,
      error: `Cannot delete role "${id}": Assigned to ${assignedAdmins.length} active administrator(s). Please reassign them first in Admin Accounts.`,
      assignedAdmins,
    }
  }

  const customRoles = getCustomRoles()
  const index = customRoles.findIndex((r) => r.id === id)
  if (index === -1) {
    return { ok: false, error: 'Custom role was not found or already deleted.' }
  }

  const [deletedRole] = customRoles.splice(index, 1)
  saveCustomRoles(customRoles)

  // Log activity
  logAdminActivity({
    adminId: 'adm-001',
    adminName: 'Bhumireddy Sahith',
    adminEmail: 'bhumireddy@inferxe.com',
    action: 'Deleted Custom RBAC Role',
    category: 'Role Management',
    targetResource: `Role: ${deletedRole.name} (${deletedRole.id})`,
    severity: 'critical',
    description: `Deleted custom role "${deletedRole.name}". Verified 0 active administrators assigned.`,
    previousValue: `${deletedRole.name} (${deletedRole.permissions.length} permissions)`,
    newValue: 'Permanently Deleted',
    source: 'Super Admin Portal',
    ipAddress: '103.21.144.62 (Bengaluru, IN)',
  })

  return { ok: true, deletedRole }
}

/**
 * Reset custom roles to seed default.
 */
export function resetToDefaultRoles(): void {
  saveCustomRoles(DEFAULT_CUSTOM_ROLES)
}

/**
 * Formats a permission count label.
 */
export function formatPermissionCount(count: number): string {
  return `${count} ${count === 1 ? 'Permission' : 'Permissions'}`
}

/**
 * Safe role display metadata fallback for any role ID (standard or custom).
 */
export function getRoleDisplayInfo(roleId: string): {
  title: string
  description: string
  color: string
  badgeClass: string
  isStandard: boolean
} {
  const role = getRoleById(roleId)
  if (role) {
    return {
      title: role.name,
      description: role.description,
      color: role.color,
      badgeClass: role.badgeClass || 'chip--lime',
      isStandard: role.isStandard,
    }
  }

  // Graceful fallback for formatted role IDs
  const fallbackTitle = roleId
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')

  return {
    title: fallbackTitle,
    description: 'Configured platform role.',
    color: '#94a3b8',
    badgeClass: 'chip--gray',
    isStandard: false,
  }
}

/**
 * Returns all roles (standard and custom) granting a specific permission.
 */
export function getRolesForPermission(permissionId: string): AdminRoleDefinition[] {
  return getAllRoles().filter((r) => r.permissions.includes(permissionId))
}

export interface PermissionImpactData {
  permission: RolePermission
  roles: AdminRoleDefinition[]
  standardRoles: AdminRoleDefinition[]
  customRoles: AdminRoleDefinition[]
  affectedAdmins: AdminAccount[]
  affectedAdminsCount: number
}

/**
 * Calculates impact analysis for a specific platform permission.
 * Includes roles granting it and all administrators indirectly granted access.
 */
export function getPermissionImpact(permissionId: string): PermissionImpactData | undefined {
  const perm = PLATFORM_PERMISSIONS.find((p) => p.id === permissionId)
  if (!perm) return undefined

  const roles = getRolesForPermission(permissionId)
  const standardRoles = roles.filter((r) => r.isStandard)
  const customRoles = roles.filter((r) => !r.isStandard)

  const roleIds = new Set(roles.map((r) => r.id))
  const accounts = getAdminAccounts()
  const affectedAdmins = accounts.filter((acc) => roleIds.has(acc.role))

  return {
    permission: perm,
    roles,
    standardRoles,
    customRoles,
    affectedAdmins,
    affectedAdminsCount: affectedAdmins.length,
  }
}

/**
 * Summary statistics for the Permission Management module (Phase 2.2).
 */
export function getPermissionSummaryStats() {
  const allRoles = getAllRoles()
  const customRoles = getCustomRoles()
  const totalPermissions = PLATFORM_PERMISSIONS.length
  const totalCategories = getPermissionCategories().length

  const assignedPermissions = PLATFORM_PERMISSIONS.filter((p) =>
    allRoles.some((r) => r.permissions.includes(p.id))
  )
  const unassignedPermissions = PLATFORM_PERMISSIONS.filter((p) =>
    !allRoles.some((r) => r.permissions.includes(p.id))
  )

  const customAssignedPermissions = PLATFORM_PERMISSIONS.filter((p) =>
    customRoles.some((r) => r.permissions.includes(p.id))
  )

  return {
    totalPermissions,
    totalCategories,
    assignedCount: assignedPermissions.length,
    unassignedCount: unassignedPermissions.length,
    customAssignedCount: customAssignedPermissions.length,
  }
}

/**
 * Quick toggle a single permission on or off for a custom role.
 */
export function toggleCustomRolePermission(
  roleId: string,
  permissionId: string
): { ok: boolean; role?: AdminRoleDefinition; error?: string } {
  const standard = STANDARD_ROLES.find((r) => r.id === roleId)
  if (standard) {
    return { ok: false, error: 'Standard platform roles are immutable and cannot be modified.' }
  }

  const customRoles = getCustomRoles()
  const index = customRoles.findIndex((r) => r.id === roleId)
  if (index === -1) {
    return { ok: false, error: 'Custom role not found.' }
  }

  const role = { ...customRoles[index] }
  const currentPerms = new Set(role.permissions)
  const wasGranted = currentPerms.has(permissionId)

  if (wasGranted) {
    if (currentPerms.size <= 1) {
      return { ok: false, error: 'A role must contain at least one permission.' }
    }
    currentPerms.delete(permissionId)
  } else {
    currentPerms.add(permissionId)
  }

  role.permissions = Array.from(currentPerms)
  role.updatedAt = new Date().toISOString()
  customRoles[index] = role
  saveCustomRoles(customRoles)

  // Log activity
  logAdminActivity({
    adminId: 'adm-001',
    adminName: 'Bhumireddy Sahith',
    adminEmail: 'bhumireddy@inferxe.com',
    action: wasGranted ? 'Revoked Permission from Role' : 'Granted Permission to Role',
    category: 'Permission Changes',
    targetResource: `Role: ${role.name} → Perm: ${permissionId}`,
    severity: 'warning',
    description: `${wasGranted ? 'Revoked' : 'Granted'} permission "${permissionId}" on custom role "${role.name}".`,
    previousValue: wasGranted ? 'Granted' : 'Revoked',
    newValue: wasGranted ? 'Revoked' : 'Granted',
    source: 'RBAC Permission Matrix',
    ipAddress: '103.21.144.62 (Bengaluru, IN)',
  })

  return { ok: true, role }
}

/**
 * Set full list of permissions for a custom role.
 */
export function setCustomRolePermissions(
  roleId: string,
  permissions: string[]
): { ok: boolean; role?: AdminRoleDefinition; error?: string } {
  const standard = STANDARD_ROLES.find((r) => r.id === roleId)
  if (standard) {
    return { ok: false, error: 'Standard platform roles are immutable and cannot be modified.' }
  }

  if (!permissions || permissions.length === 0) {
    return { ok: false, error: 'Please select at least one permission for this role.' }
  }

  const customRoles = getCustomRoles()
  const index = customRoles.findIndex((r) => r.id === roleId)
  if (index === -1) {
    return { ok: false, error: 'Custom role not found.' }
  }

  const role = { ...customRoles[index] }
  const prevCount = role.permissions.length
  role.permissions = permissions
  role.updatedAt = new Date().toISOString()
  customRoles[index] = role
  saveCustomRoles(customRoles)

  // Log activity
  logAdminActivity({
    adminId: 'adm-001',
    adminName: 'Bhumireddy Sahith',
    adminEmail: 'bhumireddy@inferxe.com',
    action: 'Updated Role Permission Matrix',
    category: 'Permission Changes',
    targetResource: `Role: ${role.name} (${permissions.length} perms)`,
    severity: 'warning',
    description: `Updated permissions for custom role "${role.name}" (${permissions.length} total granted).`,
    previousValue: `${prevCount} permissions`,
    newValue: `${permissions.length} permissions`,
    source: 'RBAC Permission Assignment Modal',
    ipAddress: '103.21.144.62 (Bengaluru, IN)',
  })

  return { ok: true, role }
}
