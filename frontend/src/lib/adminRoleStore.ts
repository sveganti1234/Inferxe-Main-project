/**
 * Super Admin & Platform RBAC Role Store (Phase 2.1 Development)
 * =============================================================
 * Manages standard and custom role definitions, permission matrices,
 * and role-to-administrator mappings for the Inferxe platform.
 * 
 * Persistence: Local prototype storage (`localStorage`) in Phase 2.1.
 * Integrates with `adminAccountStore.ts` for administrator assignments.
 */

import { getAdminAccounts, type AdminAccount } from './adminAccountStore'

export type PermissionCategory =
  | 'Dashboard'
  | 'User Management'
  | 'Admin Management'
  | 'Role Management'
  | 'Permission Management'
  | 'Audit & Security'
  | 'API & Networking'
  | 'Security & Access'
  | 'Workloads & Compute'
  | 'GPU Infrastructure'
  | 'FinOps & Billing'
  | 'Customer & Workspaces'
  | 'Security & Compliance'
  | 'Administration & RBAC'

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

// ── Complete Platform Permission Matrix (21 Canonical Permissions across Core Modules) ──
export const PLATFORM_PERMISSIONS: RolePermission[] = [
  // 1. Dashboard Overview
  {
    id: 'dashboard:view',
    name: 'View Dashboard Overview',
    description: 'Access platform overview dashboards, system health summaries, and operational analytics.',
    category: 'Dashboard',
  },

  // 2. User Management
  {
    id: 'users:view',
    name: 'View User Directory',
    description: 'Browse enterprise tenant directory, customer accounts, access policies, and workspace metadata.',
    category: 'User Management',
  },
  {
    id: 'users:manage',
    name: 'Manage User Accounts & Policies',
    description: 'Invite, provision, suspend, reactivate customer accounts, and configure spending or model access policies.',
    category: 'User Management',
  },

  // 3. Admin Account Management (Super Admin only)
  {
    id: 'admin:accounts:view',
    name: 'View Platform Administrators',
    description: 'Inspect @inferxe.com administrator roster, active statuses, session versions, and account metadata.',
    category: 'Admin Management',
  },
  {
    id: 'admin:accounts:manage',
    name: 'Manage Administrator Accounts',
    description: 'Provision, rotate credentials, activate, suspend, or delete platform administrator accounts.',
    category: 'Admin Management',
  },

  // 4. Role Management (Super Admin only)
  {
    id: 'admin:roles:view',
    name: 'View RBAC Role Directory',
    description: 'Inspect platform roles (superadmin, admin) and their assigned permission mappings.',
    category: 'Role Management',
  },
  {
    id: 'admin:roles:manage',
    name: 'Manage Platform Roles',
    description: 'Govern platform role definitions, immutability rules, and role constraints.',
    category: 'Role Management',
  },

  // 5. Permission Management (Super Admin only)
  {
    id: 'admin:permissions:view',
    name: 'View Platform Permissions',
    description: 'Inspect granular platform permissions matrix, role assignments, and impact analysis.',
    category: 'Permission Management',
  },
  {
    id: 'admin:permissions:manage',
    name: 'Govern Platform Permissions',
    description: 'Manage canonical platform permission definitions and authorization bindings.',
    category: 'Permission Management',
  },

  // 6. Audit Logs & Activity Monitoring (Super Admin only)
  {
    id: 'audit:logs:view',
    name: 'Access Security Audit Logs',
    description: 'Read-only access to immutable security audit trails, credential rotation events, and administrative actions.',
    category: 'Audit & Security',
  },
  {
    id: 'activity:monitoring:view',
    name: 'View Activity & Sessions',
    description: 'Inspect administrator authentication history, active database sessions, and real-time security events.',
    category: 'Audit & Security',
  },

  // 7. API Keys
  {
    id: 'api:keys:view',
    name: 'Inspect Platform API Keys',
    description: 'View active API tokens, developer gateway usage metrics, rate limit tiers, and token lifetimes.',
    category: 'API & Networking',
  },
  {
    id: 'api:keys:manage',
    name: 'Revoke API Credentials',
    description: 'Immediately revoke compromised or leaked API keys across developer workspaces.',
    category: 'API & Networking',
  },

  // 8. SSH Keys
  {
    id: 'ssh:keys:view',
    name: 'Inspect SSH Public Keys',
    description: 'View registered SSH public keys, fingerprints, and cluster bastion access bindings.',
    category: 'Security & Access',
  },
  {
    id: 'ssh:keys:manage',
    name: 'Manage & Revoke SSH Keys',
    description: 'Revoke expired or compromised SSH public keys from cluster access gates.',
    category: 'Security & Access',
  },

  // 9. Notebook Management
  {
    id: 'notebooks:view',
    name: 'Inspect Notebook Sessions',
    description: 'View active Jupyter notebook instances, GPU pod allocations, and session runtimes.',
    category: 'Workloads & Compute',
  },
  {
    id: 'notebooks:manage',
    name: 'Manage Notebook Allocations',
    description: 'Terminate, restart, or reconfigure notebook compute allocations and storage mounts.',
    category: 'Workloads & Compute',
  },

  // 10. GPU Infrastructure & FinOps Telemetry
  {
    id: 'infra:nodes:view',
    name: 'View GPU Fleet & Topology',
    description: 'Inspect sovereign GPU clusters, node states, NVLink connectivity, and fabric health.',
    category: 'GPU Infrastructure',
  },
  {
    id: 'infra:workloads:view',
    name: 'Inspect Model Workloads',
    description: 'View active LLM training pods, batch inference queues, and compute allocations.',
    category: 'GPU Infrastructure',
  },
  {
    id: 'infra:telemetry:view',
    name: 'Real-Time Hardware Telemetry',
    description: 'Access low-level thermal curves, power draw, RoCE packet loss, and sensor telemetry.',
    category: 'GPU Infrastructure',
  },
  {
    id: 'billing:invoices:view',
    name: 'View Billing & Settlements',
    description: 'Inspect customer billing statements, consumption logs, and financial settlement ledgers.',
    category: 'FinOps & Billing',
  },
]

// ── Platform Roles: Strictly Two Roles Supported (superadmin and admin) ──
export const STANDARD_ROLES: AdminRoleDefinition[] = [
  {
    id: 'superadmin',
    name: 'Super Admin',
    description: 'Full platform governance, admin account lifecycle, and unrestricted access.',
    isStandard: true,
    color: '#50e396',
    badgeClass: 'chip--lime',
    permissions: PLATFORM_PERMISSIONS.map((p) => p.id),
    createdAt: '2026-01-15T00:00:00Z',
    updatedAt: '2026-01-15T00:00:00Z',
  },
  {
    id: 'admin',
    name: 'Admin',
    description: 'Standard platform administrator with access to operational dashboards, telemetry, and platform services.',
    isStandard: true,
    color: '#06b6d4',
    badgeClass: 'chip--cyan',
    permissions: [
      'dashboard:view',
      'users:view',
      'users:manage',
      'api:keys:view',
      'ssh:keys:view',
      'notebooks:view',
      'infra:nodes:view',
      'infra:workloads:view',
      'infra:telemetry:view',
      'billing:invoices:view',
    ],
    createdAt: '2026-01-15T00:00:00Z',
    updatedAt: '2026-01-15T00:00:00Z',
  },
]

// Custom roles are not supported under the platform's two-role architecture
export const DEFAULT_CUSTOM_ROLES: AdminRoleDefinition[] = []

const CUSTOM_ROLES_STORAGE_KEY = 'inferxe_dev_custom_roles_v1'

function getStoredCustomRoles(): AdminRoleDefinition[] {
  // Enforce zero custom roles under the strict two-role policy
  try {
    localStorage.removeItem(CUSTOM_ROLES_STORAGE_KEY)
  } catch {
    // Ignore localStorage failures
  }
  return []
}

function saveCustomRoles(_roles: AdminRoleDefinition[]): void {
  // No-op under the strict two-role policy
  try {
    localStorage.removeItem(CUSTOM_ROLES_STORAGE_KEY)
  } catch {
    // Ignore localStorage failures
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
    'Dashboard',
    'User Management',
    'Admin Management',
    'Role Management',
    'Permission Management',
    'Audit & Security',
    'API & Networking',
    'Security & Access',
    'Workloads & Compute',
    'GPU Infrastructure',
    'FinOps & Billing',
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
  if (id === 'superadmin' || id === 'super_admin') {
    return STANDARD_ROLES.find((r) => r.id === 'superadmin' || r.id === 'super_admin')
  }
  return getAllRoles().find((r) => r.id === id)
}

/**
 * Returns all administrator accounts assigned to a specific role.
 */
export function getRoleAssignedAdmins(roleId: string): AdminAccount[] {
  const accounts = getAdminAccounts()
  const isSuper = roleId === 'superadmin' || roleId === 'super_admin'
  return accounts.filter((a) => {
    if (isSuper) {
      return a.isSuperAdmin || a.role === 'superadmin' || a.role === 'super_admin'
    }
    return !a.isSuperAdmin && a.role === 'admin'
  })
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
 * Create a new custom role. Prohibited under two-role policy.
 */
export function createCustomRole(_input: CreateRoleInput): {
  ok: boolean
  role?: AdminRoleDefinition
  error?: string
} {
  return {
    ok: false,
    error: 'The platform strictly enforces a two-role architecture ("superadmin" and "admin"). Custom roles cannot be created.',
  }
}

/**
 * Update an existing custom role. Prohibited under two-role policy.
 */
export function updateCustomRole(
  _id: string,
  _updates: UpdateRoleInput
): { ok: boolean; role?: AdminRoleDefinition; error?: string } {
  return {
    ok: false,
    error: 'Standard platform roles ("superadmin" and "admin") are immutable and custom roles cannot be modified.',
  }
}

/**
 * Delete a custom role. Prohibited under two-role policy.
 */
export function deleteCustomRole(_id: string): {
  ok: boolean
  deletedRole?: AdminRoleDefinition
  error?: string
  assignedAdmins?: AdminAccount[]
} {
  return {
    ok: false,
    error: 'Standard platform roles ("superadmin" and "admin") cannot be deleted.',
  }
}

/**
 * Reset custom roles to seed default.
 */
export function resetToDefaultRoles(): void {
  saveCustomRoles([])
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
 * Prohibited under two-role policy.
 */
export function toggleCustomRolePermission(
  _roleId: string,
  _permissionId: string
): { ok: boolean; role?: AdminRoleDefinition; error?: string } {
  return {
    ok: false,
    error: 'Platform permissions are strictly governed by the standard "superadmin" and "admin" roles and cannot be modified.',
  }
}

/**
 * Set full list of permissions for a custom role.
 * Prohibited under two-role policy.
 */
export function setCustomRolePermissions(
  _roleId: string,
  _permissions: string[]
): { ok: boolean; role?: AdminRoleDefinition; error?: string } {
  return {
    ok: false,
    error: 'Platform permissions are strictly governed by the standard "superadmin" and "admin" roles and cannot be modified.',
  }
}
