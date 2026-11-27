// @ts-nocheck
import crypto from 'node:crypto'
import { getSupabaseAdminClient } from '../lib/supabase.js'

const ADMIN_SAFE_COLUMNS = 'id, email, role, is_active, session_version, created_at, updated_at, last_login'
const ADMIN_SAFE_COLUMNS_LEGACY = 'id, email, is_active, session_version, created_at, updated_at, last_login'
const ADMIN_AUTH_COLUMNS = `${ADMIN_SAFE_COLUMNS}, password_hash`
const ADMIN_AUTH_COLUMNS_LEGACY = `${ADMIN_SAFE_COLUMNS_LEGACY}, password_hash`
const ALLOWED_ROLES = new Set(['admin', 'superadmin'])
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

// Canonical Platform Permissions Registry across 10 core modules
export const CANONICAL_PERMISSIONS = [
  // 1. Dashboard Overview
  { id: 'dashboard:view', name: 'View Dashboard Overview', category: 'Dashboard' },
  // 2. User Management
  { id: 'users:view', name: 'View User Directory', category: 'User Management' },
  { id: 'users:manage', name: 'Manage User Accounts & Policies', category: 'User Management' },
  // 3. Admin Account Management
  { id: 'admin:accounts:view', name: 'View Platform Administrators', category: 'Admin Management' },
  { id: 'admin:accounts:manage', name: 'Manage Administrator Accounts', category: 'Admin Management' },
  // 4. Role Management
  { id: 'admin:roles:view', name: 'View RBAC Role Directory', category: 'Role Management' },
  { id: 'admin:roles:manage', name: 'Manage Platform Roles', category: 'Role Management' },
  // 5. Permission Management
  { id: 'admin:permissions:view', name: 'View Platform Permissions', category: 'Permission Management' },
  { id: 'admin:permissions:manage', name: 'Govern Platform Permissions', category: 'Permission Management' },
  // 6. Audit Logs
  { id: 'audit:logs:view', name: 'Access Security Audit Logs', category: 'Audit & Security' },
  // 7. Activity Monitoring
  { id: 'activity:monitoring:view', name: 'View Activity & Sessions', category: 'Audit & Security' },
  // 8. API Keys
  { id: 'api:keys:view', name: 'Inspect Platform API Keys', category: 'API & Networking' },
  { id: 'api:keys:manage', name: 'Revoke API Credentials', category: 'API & Networking' },
  // 9. SSH Keys
  { id: 'ssh:keys:view', name: 'Inspect SSH Public Keys', category: 'Security & Access' },
  { id: 'ssh:keys:manage', name: 'Manage & Revoke SSH Keys', category: 'Security & Access' },
  // 10. Notebook Management
  { id: 'notebooks:view', name: 'Inspect Notebook Sessions', category: 'Workloads & Compute' },
  { id: 'notebooks:manage', name: 'Manage Notebook Allocations', category: 'Workloads & Compute' },
  // Supporting GPU & Billing Telemetry
  { id: 'infra:nodes:view', name: 'View GPU Fleet & Topology', category: 'GPU Infrastructure' },
  { id: 'infra:workloads:view', name: 'Inspect Model Workloads', category: 'GPU Infrastructure' },
  { id: 'infra:telemetry:view', name: 'Real-Time Hardware Telemetry', category: 'GPU Infrastructure' },
  { id: 'billing:invoices:view', name: 'View Billing & Settlements', category: 'FinOps & Billing' },
]

export const ROLE_PERMISSIONS_FALLBACK = {
  superadmin: CANONICAL_PERMISSIONS.map((p) => p.id),
  admin: [
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
}

export async function getPermissionsForRole(role, supabaseClient) {
  const cleanRole = String(role || '').trim().toLowerCase()
  if (!ALLOWED_ROLES.has(cleanRole)) return new Set()

  try {
    const supabase = resolveSupabaseClient(supabaseClient)
    const result = await supabase
      .from('admin_role_permissions')
      .select('permission_id')
      .eq('role', cleanRole)

    if (!result.error && Array.isArray(result.data) && result.data.length > 0) {
      return new Set(result.data.map((r) => r.permission_id).filter(Boolean))
    }
  } catch {
    // Fail-safe fallback to authoritative in-code registry
  }

  return new Set(ROLE_PERMISSIONS_FALLBACK[cleanRole] || [])
}

export async function hasPermission(role, permissionId, supabaseClient) {
  const cleanRole = String(role || '').trim().toLowerCase()
  if (cleanRole === 'superadmin') return true
  if (cleanRole !== 'admin') return false

  const permissions = await getPermissionsForRole(cleanRole, supabaseClient)
  return permissions.has(permissionId)
}

export async function checkAdminPermission(
  { role, permissionId, actorAdmin, ipAddress, userAgent, path, method },
  supabaseClient,
) {
  const permitted = await hasPermission(role, permissionId, supabaseClient)
  if (permitted) {
    return { ok: true }
  }

  // Record blocked violation in audit_logs
  try {
    const supabase = resolveSupabaseClient(supabaseClient)
    await recordAdminAuditLog(
      {
        action: 'security.permission_violation.blocked',
        targetType: 'permission',
        targetId: permissionId,
        details: {
          actor_admin_id: actorAdmin?.id || null,
          actor_email: actorAdmin?.email || null,
          role: role || 'unauthenticated',
          required_permission: permissionId,
          path: path || null,
          method: method || null,
          ip_address: ipAddress || 'unknown',
          user_agent: userAgent || null,
          reason: `Access denied: Administrator role "${role}" lacks required permission "${permissionId}".`,
        },
      },
      supabase,
    )
  } catch (auditErr) {
    console.error('[AdminSessionStore] Failed to write permission violation audit log:', auditErr)
  }

  return {
    ok: false,
    status: 403,
    code: 'PERMISSION_DENIED',
    error: `Forbidden: Administrator role "${role}" lacks required permission "${permissionId}".`,
  }
}

// Confirmed pre-migration primary Super Admin identity (used strictly when migration 004
// has not yet added the `role` column to `public.admin_users`).
export const PRIMARY_SUPERADMIN_ID = 'd9a494cb-1e8d-4bca-8142-19687fa9138b'
export const PRIMARY_SUPERADMIN_EMAIL = 'admin@inferxe.com'

export const DEFAULT_ADMIN_SESSION_TTL_SECONDS = 12 * 60 * 60 // 12 hours

let loggedMissingRoleColumnWarning = false

function resolveSupabaseClient(injectedClient) {
  if (injectedClient) return injectedClient
  return getSupabaseAdminClient()
}

const devSessionStore = new Map()
let devAdminPasswordHash = null

/**
 * In-memory admin store for local development without Supabase. Off by default: it must be enabled
 * explicitly (ADMIN_DEV_FALLBACK=true), outside production, with an explicit ADMIN_PASSWORD. Otherwise a
 * missing/misconfigured Supabase client fails closed (503) instead of opening a hardcoded-admin login.
 */
export function isAdminDevFallbackEnabled() {
  return (
    String(process.env.ADMIN_DEV_FALLBACK || '').trim().toLowerCase() === 'true' &&
    process.env.NODE_ENV !== 'production' &&
    Boolean(String(process.env.ADMIN_PASSWORD || '').trim())
  )
}

async function getDevAdminPasswordHash() {
  if (!devAdminPasswordHash) {
    const { hashPassword } = await import('./adminPassword.js')
    devAdminPasswordHash = await hashPassword(process.env.ADMIN_PASSWORD)
  }
  return devAdminPasswordHash
}

async function findAdminByEmailDevFallback(normalizedEmail) {
  const primaryAdmin = (process.env.ADMIN_EMAIL || 'admin@inferxe.com').trim().toLowerCase()
  const isAdmin =
    normalizedEmail === PRIMARY_SUPERADMIN_EMAIL ||
    normalizedEmail === 'superadmin@inferxe.com' ||
    normalizedEmail === 'bhumireddy@inferxe.com' ||
    normalizedEmail === primaryAdmin

  let localAdmin = null
  try {
    const { getAdminUserByEmail } = await import('../database/customerDatabase.js')
    localAdmin = getAdminUserByEmail(normalizedEmail)
  } catch {}

  if (!isAdmin && !localAdmin) {
    return null
  }

  const role = localAdmin?.role || (
    normalizedEmail === PRIMARY_SUPERADMIN_EMAIL ||
    normalizedEmail === 'superadmin@inferxe.com' ||
    normalizedEmail === 'bhumireddy@inferxe.com'
      ? 'superadmin'
      : 'admin'
  )
  const fullName = localAdmin?.full_name || (role === 'superadmin' ? 'Inferxe Super Admin' : 'Inferxe Administrator')
  const hash = await getDevAdminPasswordHash()

  return {
    id: localAdmin?.id || PRIMARY_SUPERADMIN_ID,
    email: normalizedEmail,
    fullName,
    full_name: fullName,
    role,
    is_active: localAdmin?.status ? localAdmin.status === 'active' : true,
    status: 'active',
    session_version: 1,
    password_hash: hash,
    organization: 'Inferxe Platform Org',
    created_at: localAdmin?.created_at || new Date().toISOString(),
    updated_at: localAdmin?.created_at || new Date().toISOString(),
    last_login: localAdmin?.last_login || null,
  }
}

export function isMissingRoleColumnError(error) {
  if (!error || typeof error !== 'object') return false
  const code = String(error.code || '').trim().toUpperCase()
  const message = String(error.message || '')
  const details = String(error.details || '')
  const combined = `${message} ${details}`

  if (code === '42703' && /\brole\b/i.test(combined)) {
    return true
  }
  if (code === 'PGRST204' && /\brole\b/i.test(combined)) {
    return true
  }
  return (
    /column\s+(?:[a-z0-9_."]+\.)?role\s+does not exist/i.test(combined) ||
    /could not find the ['"]role['"] column/i.test(combined)
  )
}

function logMissingRoleColumnOnce() {
  if (loggedMissingRoleColumnWarning) return
  loggedMissingRoleColumnWarning = true
  console.warn(
    '[admin-auth] Supabase `admin_users.role` column not found yet (migration 004_admin_users_role_and_sessions.sql pending). ' +
    'Using strict pre-migration fallback: only confirmed Super Admin ID d9a494cb-1e8d-4bca-8142-19687fa9138b (admin@inferxe.com) resolves as superadmin.',
  )
}

function logStoreError(context, error) {
  const code = error?.code || error?.status || 'unknown'
  const constraint = error?.constraint ? ` constraint=${String(error.constraint).slice(0, 80)}` : ''
  const message = String(error?.message || 'Database error').slice(0, 200)
  console.error(`[admin-auth] ${context} failed (code=${code}${constraint}): ${message}`)
}

/**
 * Classify PostgreSQL / PostgREST errors from `admin_users` inserts so that
 * only actual email uniqueness violations map to HTTP 409 DUPLICATE_ADMIN_EMAIL.
 * Never exposes raw constraint names, table internals, or secrets in `message`.
 */
export function classifyAdminInsertError(error) {
  const code = String(error?.code || '').trim().toUpperCase()
  const constraint = String(error?.constraint || '').trim().toLowerCase()
  const message = String(error?.message || '')
  const details = String(error?.details || '')
  const hint = String(error?.hint || '')
  const combined = `${constraint} ${message} ${details} ${hint}`

  const isUniqueViolation =
    code === '23505' ||
    /duplicate key value violates unique constraint|violates unique constraint/i.test(combined)

  if (isUniqueViolation) {
    // Legacy single-active-account index (`admin_users_one_active_shared_account`)
    if (
      constraint === 'admin_users_one_active_shared_account' ||
      /admin_users_one_active_shared_account/i.test(combined) ||
      /key\s*\(\s*is_active\s*\)\s*=\s*\(\s*(?:t|true)\s*\)/i.test(combined)
    ) {
      return {
        statusCode: 503,
        code: 'ADMIN_SCHEMA_MIGRATION_REQUIRED',
        message:
          'Administrator creation is temporarily unavailable because the database schema currently restricts accounts to a single active administrator. Apply the pending admin schema migration before creating additional administrators.',
      }
    }

    // Single-active-Super-Admin partial unique index (`admin_users_one_active_superadmin`)
    if (
      constraint === 'admin_users_one_active_superadmin' ||
      /admin_users_one_active_superadmin/i.test(combined) ||
      /key\s*\(\s*role\s*\)\s*=\s*\(\s*superadmin\s*\)/i.test(combined)
    ) {
      return {
        statusCode: 403,
        code: 'SUPERADMIN_ALREADY_EXISTS',
        message: 'Only one active Super Admin account is permitted.',
      }
    }

    // Actual email uniqueness violation (`admin_users_email_lower_unique` / `admin_users_email_key`)
    const isEmailConstraint =
      /email/i.test(constraint) ||
      /admin_users_email(?:_lower)?_(?:unique|key)/i.test(combined) ||
      /key\s*\(\s*(?:lower\(\s*)?email(?:\s*\))?\s*\)\s*=/i.test(combined)

    if (isEmailConstraint) {
      return {
        statusCode: 409,
        code: 'DUPLICATE_ADMIN_EMAIL',
        message: 'An administrator account with this email already exists.',
      }
    }

    // Any other SQLSTATE 23505 (e.g., primary key or non-email constraint) must NOT be misclassified as duplicate email
    return {
      statusCode: 503,
      code: 'ADMIN_CREATE_FAILED',
      message: 'Unable to create developer administrator account.',
    }
  }

  return {
    statusCode: 503,
    code: 'ADMIN_CREATE_FAILED',
    message: 'Unable to create developer administrator account.',
  }
}

/**
 * Resolve effective role for an `admin_users` row.
 * - Post-migration (`hasRoleColumn=true`): strictly uses DB `row.role`.
 * - Pre-migration (`hasRoleColumn=false`): ONLY the confirmed primary Super Admin row
 *   (`id === d9a494cb-1e8d-4bca-8142-19687fa9138b` AND `email === admin@inferxe.com`)
 *   resolves to `superadmin`; all other accounts strictly default to `admin`.
 */
export function resolveAdminRoleFromRow(row, { hasRoleColumn = true } = {}) {
  if (!row || typeof row !== 'object') return null
  if (hasRoleColumn) {
    return ALLOWED_ROLES.has(row.role) ? row.role : null
  }
  const id = String(row.id || '').trim().toLowerCase()
  const email = String(row.email || '').trim().toLowerCase()
  if (id === PRIMARY_SUPERADMIN_ID && email === PRIMARY_SUPERADMIN_EMAIL) {
    return 'superadmin'
  }
  return 'admin'
}

function attachResolvedRole(row, { hasRoleColumn }) {
  if (!row) return null
  return {
    ...row,
    role: resolveAdminRoleFromRow(row, { hasRoleColumn }),
  }
}

function deriveDisplayName(email, role) {
  const cleanEmail = String(email || '').trim().toLowerCase()
  if (role === 'superadmin' && cleanEmail === PRIMARY_SUPERADMIN_EMAIL) {
    return 'Inferxe Super Admin'
  }
  const localPart = cleanEmail.split('@')[0] || 'administrator'
  const words = localPart
    .replace(/[._-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
  return words.length ? words.join(' ') : 'Inferxe Administrator'
}

export function formatRelativeTime(dateString) {
  if (!dateString) return 'Never'
  const date = new Date(dateString)
  if (Number.isNaN(date.getTime())) return 'Unknown'
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return date.toISOString().slice(0, 10)
}

export function deriveEventCategoryAndSeverity(action, details = {}) {
  const act = String(action || '').toLowerCase()
  let category = 'Platform Operations'
  let severity = 'info'

  if (act.startsWith('superadmin.admin.')) {
    category = 'Admin Accounts'
    if (act.includes('created')) {
      severity = 'success'
    } else if (act.includes('deleted')) {
      severity = 'critical'
    } else if (act.includes('deactivated')) {
      severity = 'warning'
    } else if (act.includes('activated')) {
      severity = 'info'
    } else if (act.includes('updated')) {
      severity = details.password_updated ? 'warning' : 'info'
    }
  } else if (act.includes('role') || act.includes('role_violation')) {
    category = 'Role Management'
    severity = act.includes('violation') || act.includes('blocked') ? 'critical' : 'warning'
  } else if (act.includes('permission')) {
    category = 'Permission Changes'
    severity = act.includes('violation') || act.includes('blocked') ? 'critical' : 'info'
  } else if (
    act.startsWith('admin.login.') ||
    act === 'admin.logout' ||
    act.startsWith('admin.session.') ||
    act.startsWith('security.') ||
    act.startsWith('superadmin.key.') ||
    act.includes('password') ||
    act.startsWith('superadmin.password.')
  ) {
    category = 'Security'
    if (
      act.includes('failed') ||
      act.includes('blocked_inactive') ||
      act.includes('revoked') ||
      act.includes('password')
    ) {
      severity = 'warning'
    } else if (act.includes('violation') || act.includes('critical')) {
      severity = 'critical'
    } else if (act.includes('success')) {
      severity = 'success'
    } else {
      severity = 'info'
    }
  }

  return { category, severity }
}

export function deriveEventDescription(action, details = {}, targetResource = '') {
  if (details.reason) return details.reason
  if (details.description) return details.description
  const act = String(action || '')
  switch (act) {
    case 'admin.login.success':
      return `Successful administrative authentication from ${details.ip_address || 'unknown IP'}`
    case 'admin.login.failed':
      return `Failed administrative login attempt for ${details.email || targetResource || 'unknown account'}`
    case 'admin.login.blocked_inactive':
      return `Sign-in blocked for deactivated administrator account ${details.email || targetResource}`
    case 'admin.logout':
      return 'Administrator signed out and invalidated session'
    case 'admin.session.revoked':
      return `Administrator session revoked by Super Admin (${details.reason || 'Manual revocation'})`
    case 'superadmin.admin.created':
      return `New administrator account created for ${details.created_email || targetResource}`
    case 'superadmin.admin.updated':
      return `Administrator account details updated for ${details.target_email || targetResource}`
    case 'superadmin.admin.activated':
      return `Administrator account activated: ${details.target_email || targetResource}`
    case 'superadmin.admin.deactivated':
      return `Administrator account deactivated: ${details.target_email || targetResource}`
    case 'superadmin.admin.deleted':
      return `Administrator account permanently deleted: ${details.deleted_email || targetResource}`
    case 'superadmin.password.reset_cli':
      return `Super Admin credential reset via CLI tool for ${details.email || details.target_email || targetResource} (session version incremented to ${details.session_version || 'new version'})`
    case 'security.role_violation.blocked':
      return `Privilege escalation or unauthorized role modification blocked for ${details.target_email || targetResource}`
    case 'security.permission_violation.blocked':
      return `Unauthorized access attempt blocked: missing permission ${details.required_permission || 'unauthorized'}`
    case 'superadmin.key.revoked':
      return `Cryptographic credential or API key revoked: ${targetResource}`
    default:
      return `Administrative action: ${act}`
  }
}

/**
 * Strip sensitive columns (especially password_hash) and shape a consistent admin user object.
 */
export function sanitizeAdminUser(row) {
  if (!row || typeof row !== 'object') return null
  const email = String(row.email || '').trim().toLowerCase()
  const role = ALLOWED_ROLES.has(row.role) ? row.role : 'admin'
  const isActive = Boolean(row.is_active)
  const displayName = deriveDisplayName(email, role)

  return {
    id: String(row.id),
    email,
    username: email.split('@')[0] || 'admin',
    fullName: displayName,
    full_name: displayName,
    role,
    is_active: isActive,
    status: isActive ? 'active' : 'inactive',
    session_version: Number(row.session_version || 1),
    organization: 'Inferxe Platform Org',
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    last_login: row.last_login || null,
  }
}

async function selectSingleAdminRow(supabase, { columns, legacyColumns, filterField, filterValue }) {
  const primary = await supabase
    .from('admin_users')
    .select(columns)
    .eq(filterField, filterValue)
    .maybeSingle()

  if (!primary.error) {
    return { data: attachResolvedRole(primary.data, { hasRoleColumn: true }), error: null, hasRoleColumn: true }
  }

  if (isMissingRoleColumnError(primary.error)) {
    logMissingRoleColumnOnce()
    const fallback = await supabase
      .from('admin_users')
      .select(legacyColumns)
      .eq(filterField, filterValue)
      .maybeSingle()

    if (!fallback.error) {
      return { data: attachResolvedRole(fallback.data, { hasRoleColumn: false }), error: null, hasRoleColumn: false }
    }
    return { data: null, error: fallback.error, hasRoleColumn: false }
  }

  return { data: null, error: primary.error, hasRoleColumn: true }
}

export async function findAdminByEmailForAuth(email, supabaseClient) {
  const normalizedEmail = String(email || '').trim().toLowerCase()
  if (!normalizedEmail) return null
  let supabase
  try {
    supabase = resolveSupabaseClient(supabaseClient)
  } catch (err) {
    if (!supabaseClient && isAdminDevFallbackEnabled()) {
      return findAdminByEmailDevFallback(normalizedEmail)
    }
    throw err
  }

  let result
  try {
    result = await selectSingleAdminRow(supabase, {
      columns: ADMIN_AUTH_COLUMNS,
      legacyColumns: ADMIN_AUTH_COLUMNS_LEGACY,
      filterField: 'email',
      filterValue: normalizedEmail,
    })
  } catch (err) {
    if (!supabaseClient && isAdminDevFallbackEnabled()) {
      return findAdminByEmailDevFallback(normalizedEmail)
    }
    logStoreError('findAdminByEmailForAuth(query)', err)
    const storeErr = new Error('Administrator authentication store is temporarily unavailable.')
    storeErr.statusCode = 503
    storeErr.cause = err
    throw storeErr
  }

  if (result.error) {
    if (!supabaseClient && isAdminDevFallbackEnabled()) {
      return findAdminByEmailDevFallback(normalizedEmail)
    }
    logStoreError('findAdminByEmailForAuth', result.error)
    const err = new Error('Administrator authentication store is temporarily unavailable.')
    err.statusCode = 503
    err.cause = result.error
    throw err
  }
  return result.data || null
}

export async function findAdminByIdSafe(adminId, supabaseClient) {
  if (!adminId) return null
  let supabase
  try {
    supabase = resolveSupabaseClient(supabaseClient)
  } catch (err) {
    if (!supabaseClient && isAdminDevFallbackEnabled()) {
      return {
        id: adminId,
        email: PRIMARY_SUPERADMIN_EMAIL,
        role: 'superadmin',
        is_active: true,
        full_name: 'Inferxe Super Admin',
        session_version: 1,
      }
    }
    throw err
  }

  let result
  try {
    result = await selectSingleAdminRow(supabase, {
      columns: ADMIN_SAFE_COLUMNS,
      legacyColumns: ADMIN_SAFE_COLUMNS_LEGACY,
      filterField: 'id',
      filterValue: adminId,
    })
  } catch (err) {
    if (!supabaseClient && isAdminDevFallbackEnabled()) {
      return {
        id: adminId,
        email: PRIMARY_SUPERADMIN_EMAIL,
        role: 'superadmin',
        is_active: true,
        full_name: 'Inferxe Super Admin',
        session_version: 1,
      }
    }
    logStoreError('findAdminByIdSafe(query)', err)
    const storeErr = new Error('Administrator store is temporarily unavailable.')
    storeErr.statusCode = 503
    storeErr.cause = err
    throw storeErr
  }

  if (result.error) {
    if (!supabaseClient && isAdminDevFallbackEnabled()) {
      return {
        id: adminId,
        email: PRIMARY_SUPERADMIN_EMAIL,
        role: 'superadmin',
        is_active: true,
        full_name: 'Inferxe Super Admin',
        session_version: 1,
      }
    }
    logStoreError('findAdminByIdSafe', result.error)
    const err = new Error('Administrator store is temporarily unavailable.')
    err.statusCode = 503
    err.cause = result.error
    throw err
  }
  return result.data || null
}

export async function createAdminSessionRecord(
  { adminUserId, sessionVersion, ttlSeconds = DEFAULT_ADMIN_SESSION_TTL_SECONDS },
  supabaseClient,
) {
  let supabase
  try {
    supabase = resolveSupabaseClient(supabaseClient)
  } catch (err) {
    if (!supabaseClient && isAdminDevFallbackEnabled()) {
      const nowMs = Date.now()
      const nowIso = new Date(nowMs).toISOString()
      const expiresAtMs = nowMs + ttlSeconds * 1000
      const expiresAtIso = new Date(expiresAtMs).toISOString()
      const sessionId = crypto.randomUUID()
      devSessionStore.set(sessionId, {
        id: sessionId,
        admin_user_id: adminUserId,
        session_version: Number(sessionVersion || 1),
        expires_at: expiresAtIso,
        expiresAtMs,
        created_at: nowIso,
        revoked_at: null,
      })
      return {
        sessionId,
        expiresAt: expiresAtIso,
        expiresAtMs,
        expiresAtSec: Math.floor(expiresAtMs / 1000),
        expiresAtIso,
      }
    }
    throw err
  }
  const nowMs = Date.now()
  const nowIso = new Date(nowMs).toISOString()
  const expiresAtMs = nowMs + ttlSeconds * 1000
  const expiresAtIso = new Date(expiresAtMs).toISOString()
  const sessionId = crypto.randomUUID()

  let insertResult
  try {
    insertResult = await supabase
      .from('admin_sessions')
      .insert({
        id: sessionId,
        admin_user_id: adminUserId,
        session_version: Number(sessionVersion),
        expires_at: expiresAtIso,
        revoked_at: null,
      })
      .select('id, admin_user_id, session_version, expires_at, created_at, revoked_at')
      .single()
  } catch (err) {
    if (!supabaseClient && isAdminDevFallbackEnabled()) {
      devSessionStore.set(sessionId, {
        id: sessionId,
        admin_user_id: adminUserId,
        session_version: Number(sessionVersion || 1),
        expires_at: expiresAtIso,
        expiresAtMs,
        created_at: nowIso,
        revoked_at: null,
      })
      return {
        sessionId,
        expiresAt: expiresAtIso,
        expiresAtMs,
        expiresAtSec: Math.floor(expiresAtMs / 1000),
        expiresAtIso,
      }
    }
    logStoreError('createAdminSessionRecord(query)', err)
    const storeErr = new Error('Unable to create administrator session.')
    storeErr.statusCode = 503
    storeErr.cause = err
    throw storeErr
  }

  if (insertResult.error || !insertResult.data) {
    if (!supabaseClient && isAdminDevFallbackEnabled()) {
      devSessionStore.set(sessionId, {
        id: sessionId,
        admin_user_id: adminUserId,
        session_version: Number(sessionVersion || 1),
        expires_at: expiresAtIso,
        expiresAtMs,
        created_at: nowIso,
        revoked_at: null,
      })
      return {
        sessionId,
        expiresAt: expiresAtIso,
        expiresAtMs,
        expiresAtSec: Math.floor(expiresAtMs / 1000),
        expiresAtIso,
      }
    }
    logStoreError('createAdminSessionRecord', insertResult.error)
    const err = new Error('Unable to create administrator session.')
    err.statusCode = 503
    err.cause = insertResult.error
    throw err
  }

  // Best-effort update of last_login timestamp without changing password_hash or session_version
  try {
    await supabase
      .from('admin_users')
      .update({ last_login: nowIso, updated_at: nowIso })
      .eq('id', adminUserId)
  } catch {
    // Non-fatal; session creation succeeded
  }

  return {
    sessionId: String(insertResult.data.id),
    expiresAtMs,
    expiresAtSec: Math.floor(expiresAtMs / 1000),
    expiresAtIso,
  }
}

export async function verifyAdminSessionRecord(
  { sessionId, adminUserId, tokenSessionVersion },
  supabaseClient,
) {
  if (!sessionId || !adminUserId || tokenSessionVersion === undefined || tokenSessionVersion === null) {
    return { valid: false, statusCode: 401, error: 'Missing required session claims.' }
  }

  let supabase
  try {
    supabase = resolveSupabaseClient(supabaseClient)
  } catch (err) {
    if (!supabaseClient && isAdminDevFallbackEnabled()) {
      const devSession = devSessionStore.get(sessionId)
      if (!devSession) {
        return { valid: false, statusCode: 401, error: 'Administrator session not found.' }
      }
      if (devSession && devSession.revoked_at) {
        return { valid: false, statusCode: 401, error: 'Administrator session has been revoked.' }
      }
      if (devSession && devSession.expiresAtMs && devSession.expiresAtMs <= Date.now()) {
        return { valid: false, statusCode: 401, error: 'Administrator session has expired.' }
      }
      return {
        valid: true,
        statusCode: 200,
        admin: {
          id: adminUserId,
          email: PRIMARY_SUPERADMIN_EMAIL,
          role: 'superadmin',
          is_active: true,
          full_name: 'Inferxe Super Admin',
          session_version: 1,
        },
        session: {
          id: sessionId,
          admin_user_id: adminUserId,
          session_version: 1,
          expires_at: devSession ? devSession.expires_at : new Date(Date.now() + 12 * 3600 * 1000).toISOString(),
        },
      }
    }
    logStoreError('verifyAdminSessionRecord(config)', err)
    return { valid: false, statusCode: 503, error: 'Administrator session store is not configured.' }
  }

  let sessionResult
  let adminResult
  try {
    ;[sessionResult, adminResult] = await Promise.all([
      supabase
        .from('admin_sessions')
        .select('id, admin_user_id, session_version, expires_at, created_at, revoked_at')
        .eq('id', sessionId)
        .maybeSingle(),
      selectSingleAdminRow(supabase, {
        columns: ADMIN_SAFE_COLUMNS,
        legacyColumns: ADMIN_SAFE_COLUMNS_LEGACY,
        filterField: 'id',
        filterValue: adminUserId,
      }),
    ])
  } catch (err) {
    if (!supabaseClient && isAdminDevFallbackEnabled()) {
      const devSession = devSessionStore.get(sessionId)
      if (devSession) {
        if (devSession.revoked_at) {
          return { valid: false, statusCode: 401, error: 'Administrator session has been revoked.' }
        }
        if (devSession.expiresAtMs && devSession.expiresAtMs <= Date.now()) {
          return { valid: false, statusCode: 401, error: 'Administrator session has expired.' }
        }
        return {
          valid: true,
          statusCode: 200,
          admin: {
            id: adminUserId,
            email: PRIMARY_SUPERADMIN_EMAIL,
            role: 'superadmin',
            is_active: true,
            full_name: 'Inferxe Super Admin',
            session_version: 1,
            permissions: CANONICAL_PERMISSIONS.map((p) => p.id),
          },
          session: {
            id: sessionId,
            admin_user_id: adminUserId,
            session_version: 1,
            expires_at: devSession.expires_at,
          },
        }
      }
    }
    logStoreError('verifyAdminSessionRecord(query)', err)
    return {
      valid: false,
      statusCode: 503,
      error: 'Administrator session verification service is temporarily unavailable.',
    }
  }

  if (sessionResult.error || adminResult.error) {
    if (!supabaseClient && isAdminDevFallbackEnabled()) {
      const devSession = devSessionStore.get(sessionId)
      if (devSession) {
        if (devSession.revoked_at) {
          return { valid: false, statusCode: 401, error: 'Administrator session has been revoked.' }
        }
        if (devSession.expiresAtMs && devSession.expiresAtMs <= Date.now()) {
          return { valid: false, statusCode: 401, error: 'Administrator session has expired.' }
        }
        return {
          valid: true,
          statusCode: 200,
          admin: {
            id: adminUserId,
            email: PRIMARY_SUPERADMIN_EMAIL,
            role: 'superadmin',
            is_active: true,
            full_name: 'Inferxe Super Admin',
            session_version: 1,
            permissions: CANONICAL_PERMISSIONS.map((p) => p.id),
          },
          session: {
            id: sessionId,
            admin_user_id: adminUserId,
            session_version: 1,
            expires_at: devSession.expires_at,
          },
        }
      }
    }
    logStoreError('verifyAdminSessionRecord(result)', sessionResult.error || adminResult.error)
    return {
      valid: false,
      statusCode: 503,
      error: 'Administrator session verification service is temporarily unavailable.',
    }
  }

  const session = sessionResult.data
  const admin = adminResult.data

  if (!session) {
    return { valid: false, statusCode: 401, error: 'Administrator session not found.' }
  }

  if (String(session.admin_user_id) !== String(adminUserId)) {
    return { valid: false, statusCode: 401, error: 'Administrator session ownership mismatch.' }
  }

  if (session.revoked_at !== null && session.revoked_at !== undefined) {
    return { valid: false, statusCode: 401, error: 'Administrator session has been revoked.' }
  }

  const expiresAtMs = Date.parse(session.expires_at)
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
    return { valid: false, statusCode: 401, error: 'Administrator session has expired.' }
  }

  if (!admin) {
    return { valid: false, statusCode: 401, error: 'Administrator account no longer exists.' }
  }

  if (!admin.is_active) {
    return {
      valid: false,
      statusCode: 401,
      error: 'Your administrator account has been deactivated.',
    }
  }

  if (!ALLOWED_ROLES.has(admin.role)) {
    return { valid: false, statusCode: 403, code: 'INVALID_ROLE', error: 'Invalid administrator role configuration.' }
  }

  const currentVersion = Number(admin.session_version)
  if (
    !Number.isFinite(currentVersion) ||
    Number(session.session_version) !== currentVersion ||
    Number(tokenSessionVersion) !== currentVersion
  ) {
    return {
      valid: false,
      statusCode: 401,
      error: 'Administrator session has been invalidated. Please sign in again.',
    }
  }

  const permissions = Array.from(await getPermissionsForRole(admin.role, supabase))

  return {
    valid: true,
    statusCode: 200,
    admin: {
      ...sanitizeAdminUser(admin),
      permissions,
    },
    session,
  }
}

export async function revokeAdminSessionRecord(sessionId, adminUserId, supabaseClient) {
  if (!sessionId) return { revoked: false }
  let supabase
  try {
    supabase = resolveSupabaseClient(supabaseClient)
  } catch (err) {
    if (!supabaseClient && isAdminDevFallbackEnabled()) {
      const dev = devSessionStore.get(sessionId)
      if (dev) dev.revoked_at = new Date().toISOString()
      return { revoked: true }
    }
    throw err
  }
  const nowIso = new Date().toISOString()

  let query = supabase
    .from('admin_sessions')
    .update({ revoked_at: nowIso })
    .eq('id', sessionId)

  if (adminUserId) {
    query = query.eq('admin_user_id', adminUserId)
  }

  const result = await query.is('revoked_at', null)
  if (result.error) {
    logStoreError('revokeAdminSessionRecord', result.error)
    const err = new Error('Unable to revoke administrator session.')
    err.statusCode = 503
    err.cause = result.error
    throw err
  }
  return { revoked: true }
}

export async function revokeAllSessionsForAdmin(adminUserId, supabaseClient) {
  if (!adminUserId) return
  const supabase = resolveSupabaseClient(supabaseClient)
  const nowIso = new Date().toISOString()

  const result = await supabase
    .from('admin_sessions')
    .update({ revoked_at: nowIso })
    .eq('admin_user_id', adminUserId)
    .is('revoked_at', null)

  if (result.error) {
    logStoreError('revokeAllSessionsForAdmin', result.error)
    const err = new Error('Unable to revoke active administrator sessions.')
    err.statusCode = 503
    err.cause = result.error
    throw err
  }
}

export async function listAdminUsers(supabaseClient) {
  let supabase
  try {
    supabase = resolveSupabaseClient(supabaseClient)
  } catch (err) {
    if (!supabaseClient && isAdminDevFallbackEnabled()) {
      try {
        const { getAllAdminUsers } = await import('../database/customerDatabase.js')
        return getAllAdminUsers().map((a) => ({
          id: a.id,
          email: a.email,
          fullName: a.full_name,
          full_name: a.full_name,
          role: a.role || 'superadmin',
          is_active: a.status === 'active',
          status: a.status || 'active',
          created_at: a.created_at,
          last_login: a.last_login,
        }))
      } catch {
        return [
          {
            id: PRIMARY_SUPERADMIN_ID,
            email: PRIMARY_SUPERADMIN_EMAIL,
            fullName: 'Inferxe Super Admin',
            full_name: 'Inferxe Super Admin',
            role: 'superadmin',
            is_active: true,
            status: 'active',
            created_at: new Date().toISOString(),
            last_login: null,
          },
        ]
      }
    }
    throw err
  }
  let result = await supabase
    .from('admin_users')
    .select(ADMIN_SAFE_COLUMNS)
    .order('created_at', { ascending: true })
  let hasRoleColumn = true

  if (result.error && isMissingRoleColumnError(result.error)) {
    logMissingRoleColumnOnce()
    hasRoleColumn = false
    result = await supabase
      .from('admin_users')
      .select(ADMIN_SAFE_COLUMNS_LEGACY)
      .order('created_at', { ascending: true })
  }

  if (result.error) {
    if (!supabaseClient && isAdminDevFallbackEnabled()) {
      try {
        const { getAllAdminUsers } = await import('../database/customerDatabase.js')
        return getAllAdminUsers().map((a) => ({
          id: a.id,
          email: a.email,
          fullName: a.full_name,
          full_name: a.full_name,
          role: a.role || 'superadmin',
          is_active: a.status === 'active',
          status: a.status || 'active',
          created_at: a.created_at,
          last_login: a.last_login,
        }))
      } catch {
        return [
          {
            id: PRIMARY_SUPERADMIN_ID,
            email: PRIMARY_SUPERADMIN_EMAIL,
            fullName: 'Inferxe Super Admin',
            full_name: 'Inferxe Super Admin',
            role: 'superadmin',
            is_active: true,
            status: 'active',
            created_at: new Date().toISOString(),
            last_login: null,
          },
        ]
      }
    }
    logStoreError('listAdminUsers', result.error)
    const err = new Error('Unable to load administrator accounts.')
    err.statusCode = 503
    err.cause = result.error
    throw err
  }

  return (result.data || [])
    .map((row) => attachResolvedRole(row, { hasRoleColumn }))
    .map(sanitizeAdminUser)
}

export function sanitizeAuditDetails(details) {
  if (!details || typeof details !== 'object') return {}
  const cleaned = {}
  for (const [key, val] of Object.entries(details)) {
    const k = key.toLowerCase()
    // Skip any sensitive credential keys
    if (
      k.includes('password') ||
      k.includes('secret') ||
      k.includes('token') ||
      k.includes('authorization') ||
      k.includes('cookie')
    ) {
      if (k === 'password_updated' || k === 'password_reset') {
        cleaned[key] = Boolean(val)
      }
      continue
    }
    // If value is a string, scrub argon2 hashes or token prefixes
    if (typeof val === 'string') {
      if (val.startsWith('$argon2') || val.startsWith('ix-tok') || val.startsWith('Bearer ')) {
        continue
      }
    }
    cleaned[key] = val
  }
  return cleaned
}

export async function recordAdminAuditLog(
  { action, targetType, targetId, details = {}, actorUserId },
  supabaseClient,
) {
  try {
    const supabase = resolveSupabaseClient(supabaseClient)
    const effectiveActorUserId = actorUserId || details.actor_admin_id || details.admin_id || null
    const cleanedDetails = sanitizeAuditDetails(details)
    const insertPayload = {
      action: String(action || 'admin.event'),
      target_type: String(targetType || 'admin_user'),
      target_id: targetId ? String(targetId) : null,
      details: cleanedDetails,
    }
    if (effectiveActorUserId && typeof effectiveActorUserId === 'string' && effectiveActorUserId.length > 10) {
      insertPayload.actor_user_id = effectiveActorUserId
    }
    const result = await supabase.from('audit_logs').insert(insertPayload)
    return !result.error
  } catch {
    return false
  }
}

export async function createDeveloperAdminAccount(
  { email, passwordHash, role = 'admin', actorAdmin, ipAddress, userAgent },
  supabaseClient,
) {
  const normalizedEmail = String(email || '').trim().toLowerCase()
  const cleanRole = String(role || 'admin').trim().toLowerCase()
  const supabase = resolveSupabaseClient(supabaseClient)

  if (cleanRole !== 'admin') {
    await recordAdminAuditLog(
      {
        action: 'security.role_violation.blocked',
        targetType: 'admin_user',
        targetId: normalizedEmail || 'unknown',
        details: {
          actor_admin_id: actorAdmin?.id,
          actor_email: actorAdmin?.email,
          attempted_role: cleanRole,
          reason: 'Unauthorized attempt to assign non-admin role during administrator creation.',
          ip_address: ipAddress || 'unknown',
          user_agent: userAgent || 'unknown',
        },
      },
      supabase,
    )
    const err = new Error('The platform supports only "superadmin" and "admin" roles. Creating accounts with other roles or promoting to Super Admin is prohibited.')
    err.statusCode = 403
    err.code = 'ROLE_MODIFICATION_PROHIBITED'
    throw err
  }

  const existing = await supabase
    .from('admin_users')
    .select('id, email')
    .eq('email', normalizedEmail)
    .maybeSingle()

  if (existing.error) {
    logStoreError('createDeveloperAdminAccount(lookup)', existing.error)
    const err = new Error('Unable to verify administrator email uniqueness.')
    err.statusCode = 503
    err.code = 'ADMIN_LOOKUP_FAILED'
    err.cause = existing.error
    throw err
  }

  if (existing.data) {
    const err = new Error('An administrator account with this email already exists.')
    err.statusCode = 409
    err.code = 'DUPLICATE_ADMIN_EMAIL'
    throw err
  }

  const nowIso = new Date().toISOString()
  let hasRoleColumn = true
  let insertResult = await supabase
    .from('admin_users')
    .insert({
      email: normalizedEmail,
      password_hash: passwordHash,
      role: 'admin',
      is_active: true,
      session_version: 1,
      created_at: nowIso,
      updated_at: nowIso,
    })
    .select(ADMIN_SAFE_COLUMNS)
    .single()

  if (insertResult.error && isMissingRoleColumnError(insertResult.error)) {
    logMissingRoleColumnOnce()
    hasRoleColumn = false
    insertResult = await supabase
      .from('admin_users')
      .insert({
        email: normalizedEmail,
        password_hash: passwordHash,
        is_active: true,
        session_version: 1,
        created_at: nowIso,
        updated_at: nowIso,
      })
      .select(ADMIN_SAFE_COLUMNS_LEGACY)
      .single()
  }

  if (insertResult.error || !insertResult.data) {
    const classified = classifyAdminInsertError(insertResult.error)
    if (classified.code !== 'DUPLICATE_ADMIN_EMAIL') {
      logStoreError('createDeveloperAdminAccount(insert)', insertResult.error)
    }
    const err = new Error(classified.message)
    err.statusCode = classified.statusCode
    err.code = classified.code
    err.cause = insertResult.error
    throw err
  }

  const createdAdmin = sanitizeAdminUser(attachResolvedRole(insertResult.data, { hasRoleColumn }))

  await recordAdminAuditLog(
    {
      action: 'superadmin.admin.created',
      targetType: 'admin_user',
      targetId: createdAdmin.id,
      details: {
        actor_admin_id: actorAdmin.id,
        actor_email: actorAdmin.email,
        created_email: createdAdmin.email,
        assigned_role: 'admin',
        ip_address: ipAddress || 'unknown',
        user_agent: userAgent || 'unknown',
      },
    },
    supabase,
  )

  return createdAdmin
}

export async function setAdminAccountActiveStatus(
  { adminId, isActive, reason = '', actorAdmin, ipAddress, userAgent },
  supabaseClient,
) {
  const supabase = resolveSupabaseClient(supabaseClient)
  const target = await findAdminByIdSafe(adminId, supabase)

  if (!target) {
    const err = new Error('Administrator account not found.')
    err.statusCode = 404
    throw err
  }

  if (String(target.id) === String(actorAdmin.id) && !isActive) {
    const err = new Error('You cannot deactivate your own active Super Admin account.')
    err.statusCode = 400
    throw err
  }

  if (target.role === 'superadmin') {
    const err = new Error('Super Admin account status cannot be modified through this endpoint.')
    err.statusCode = 403
    throw err
  }

  const nowIso = new Date().toISOString()
  const currentVersion = Number(target.session_version || 1)
  const nextSessionVersion = isActive ? currentVersion : currentVersion + 1

  let updateResult = await supabase
    .from('admin_users')
    .update({
      is_active: Boolean(isActive),
      session_version: nextSessionVersion,
      updated_at: nowIso,
    })
    .eq('id', target.id)
    .select(ADMIN_SAFE_COLUMNS)
    .single()
  let hasRoleColumn = true

  if (updateResult.error && isMissingRoleColumnError(updateResult.error)) {
    logMissingRoleColumnOnce()
    hasRoleColumn = false
    updateResult = await supabase
      .from('admin_users')
      .update({
        is_active: Boolean(isActive),
        session_version: nextSessionVersion,
        updated_at: nowIso,
      })
      .eq('id', target.id)
      .select(ADMIN_SAFE_COLUMNS_LEGACY)
      .single()
  }

  if (updateResult.error || !updateResult.data) {
    logStoreError('setAdminAccountActiveStatus', updateResult.error)
    const err = new Error('Unable to update administrator account status.')
    err.statusCode = 503
    err.cause = updateResult.error
    throw err
  }

  if (!isActive) {
    await revokeAllSessionsForAdmin(target.id, supabase)
  }

  const updatedAdmin = sanitizeAdminUser(attachResolvedRole(updateResult.data, { hasRoleColumn }))

  await recordAdminAuditLog(
    {
      action: isActive ? 'superadmin.admin.activated' : 'superadmin.admin.deactivated',
      targetType: 'admin_user',
      targetId: updatedAdmin.id,
      details: {
        actor_admin_id: actorAdmin.id,
        actor_email: actorAdmin.email,
        target_email: updatedAdmin.email,
        is_active: Boolean(isActive),
        session_version: updatedAdmin.session_version,
        reason: String(reason || '').trim() || undefined,
        ip_address: ipAddress || 'unknown',
        user_agent: userAgent || 'unknown',
      },
    },
    supabase,
  )

  return updatedAdmin
}

export async function updateAdminAccountDetails(
  { adminId, email, passwordHash, role, isActive, reason = '', actorAdmin, ipAddress, userAgent },
  supabaseClient,
) {
  const supabase = resolveSupabaseClient(supabaseClient)
  const target = await findAdminByIdSafe(adminId, supabase)

  if (!target) {
    const err = new Error('Administrator account not found.')
    err.statusCode = 404
    err.code = 'ADMIN_NOT_FOUND'
    throw err
  }

  // Super Admin protection: Cannot modify primary Super Admin through this endpoint
  if (
    String(target.id).toLowerCase() === PRIMARY_SUPERADMIN_ID.toLowerCase() ||
    String(target.email).trim().toLowerCase() === PRIMARY_SUPERADMIN_EMAIL.toLowerCase() ||
    target.role === 'superadmin'
  ) {
    const err = new Error('Super Admin account cannot be modified through this endpoint.')
    err.statusCode = 403
    err.code = 'SUPERADMIN_PROTECTED'
    throw err
  }

  // Self-modification protection: Prevent Super Admin from modifying their own account via this endpoint
  if (actorAdmin && String(target.id) === String(actorAdmin.id)) {
    const err = new Error('You cannot modify your own administrator account through this endpoint.')
    err.statusCode = 400
    err.code = 'CANNOT_MODIFY_SELF'
    throw err
  }

  // Privilege escalation protection: Reject any attempt to assign role !== 'admin'
  if (role !== undefined && role !== null) {
    const cleanRole = String(role).trim().toLowerCase()
    if (cleanRole !== 'admin') {
      await recordAdminAuditLog(
        {
          action: 'security.role_violation.blocked',
          targetType: 'admin_user',
          targetId: target.id,
          details: {
            actor_admin_id: actorAdmin?.id,
            actor_email: actorAdmin?.email,
            target_email: target.email,
            attempted_role: cleanRole,
            reason: 'Unauthorized attempt to modify administrator role or escalate privileges to superadmin.',
            ip_address: ipAddress || 'unknown',
            user_agent: userAgent || 'unknown',
          },
        },
        supabase,
      )
      const err = new Error('The platform supports only "superadmin" and "admin" roles. Privilege escalation to Super Admin or assigning other roles is prohibited.')
      err.statusCode = 403
      err.code = 'ROLE_MODIFICATION_PROHIBITED'
      throw err
    }
  }

  const updates = {}
  let credentialsOrStatusChanged = false

  // Validate and handle email update
  if (email !== undefined && email !== null) {
    const normalizedEmail = String(email).trim().toLowerCase()
    if (!normalizedEmail || !EMAIL_REGEX.test(normalizedEmail) || normalizedEmail.length > 254) {
      const err = new Error('A valid developer email address is required.')
      err.statusCode = 400
      err.code = 'INVALID_EMAIL'
      throw err
    }

    if (normalizedEmail !== String(target.email).trim().toLowerCase()) {
      // Check for email collision
      const existing = await supabase
        .from('admin_users')
        .select('id, email')
        .eq('email', normalizedEmail)
        .maybeSingle()

      if (existing.error) {
        logStoreError('updateAdminAccountDetails(lookup)', existing.error)
        const err = new Error('Unable to verify administrator email uniqueness.')
        err.statusCode = 503
        err.code = 'ADMIN_LOOKUP_FAILED'
        err.cause = existing.error
        throw err
      }

      if (existing.data && String(existing.data.id) !== String(target.id)) {
        const err = new Error('An administrator account with this email already exists.')
        err.statusCode = 409
        err.code = 'DUPLICATE_ADMIN_EMAIL'
        throw err
      }

      updates.email = normalizedEmail
      credentialsOrStatusChanged = true
    }
  }

  // Handle password update
  if (passwordHash) {
    updates.password_hash = passwordHash
    credentialsOrStatusChanged = true
  }

  // Handle status update
  if (isActive !== undefined && isActive !== null) {
    const boolActive = Boolean(isActive)
    if (boolActive !== Boolean(target.is_active)) {
      updates.is_active = boolActive
      if (!boolActive) {
        credentialsOrStatusChanged = true
      }
    }
  }

  const currentVersion = Number(target.session_version || 1)
  const nextSessionVersion = credentialsOrStatusChanged ? currentVersion + 1 : currentVersion
  if (credentialsOrStatusChanged) {
    updates.session_version = nextSessionVersion
  }
  updates.updated_at = new Date().toISOString()

  let updateResult = await supabase
    .from('admin_users')
    .update(updates)
    .eq('id', target.id)
    .select(ADMIN_SAFE_COLUMNS)
    .single()
  let hasRoleColumn = true

  if (updateResult.error && isMissingRoleColumnError(updateResult.error)) {
    logMissingRoleColumnOnce()
    hasRoleColumn = false
    updateResult = await supabase
      .from('admin_users')
      .update(updates)
      .eq('id', target.id)
      .select(ADMIN_SAFE_COLUMNS_LEGACY)
      .single()
  }

  if (updateResult.error || !updateResult.data) {
    const classified = classifyAdminInsertError(updateResult.error)
    if (classified.code !== 'DUPLICATE_ADMIN_EMAIL') {
      logStoreError('updateAdminAccountDetails(update)', updateResult.error)
    }
    const err = new Error(classified.message || 'Unable to update administrator account details.')
    err.statusCode = classified.statusCode || 503
    err.code = classified.code || 'ADMIN_UPDATE_FAILED'
    err.cause = updateResult.error
    throw err
  }

  // When credentials change or account is deactivated, revoke all active sessions
  if (credentialsOrStatusChanged) {
    await revokeAllSessionsForAdmin(target.id, supabase)
  }

  const updatedAdmin = sanitizeAdminUser(attachResolvedRole(updateResult.data, { hasRoleColumn }))

  await recordAdminAuditLog(
    {
      action: 'superadmin.admin.updated',
      targetType: 'admin_user',
      targetId: updatedAdmin.id,
      details: {
        actor_admin_id: actorAdmin?.id,
        actor_email: actorAdmin?.email,
        target_email: updatedAdmin.email,
        previous_email: target.email,
        email_changed: Boolean(updates.email && updates.email !== target.email),
        password_updated: Boolean(updates.password_hash),
        status_changed: updates.is_active !== undefined,
        is_active: updatedAdmin.is_active,
        session_version: updatedAdmin.session_version,
        reason: String(reason || '').trim() || undefined,
        ip_address: ipAddress || 'unknown',
        user_agent: userAgent || 'unknown',
      },
    },
    supabase,
  )

  return updatedAdmin
}

export async function deleteAdminAccountSafe(
  { adminId, reason = '', actorAdmin, ipAddress, userAgent },
  supabaseClient,
) {
  const supabase = resolveSupabaseClient(supabaseClient)
  const target = await findAdminByIdSafe(adminId, supabase)

  if (!target) {
    const err = new Error('Administrator account not found.')
    err.statusCode = 404
    err.code = 'ADMIN_NOT_FOUND'
    throw err
  }

  // Super Admin protection: Cannot delete primary Super Admin
  if (
    String(target.id).toLowerCase() === PRIMARY_SUPERADMIN_ID.toLowerCase() ||
    String(target.email).trim().toLowerCase() === PRIMARY_SUPERADMIN_EMAIL.toLowerCase() ||
    target.role === 'superadmin'
  ) {
    const err = new Error('Super Admin account cannot be deleted.')
    err.statusCode = 403
    err.code = 'SUPERADMIN_PROTECTED'
    throw err
  }

  // Self-deletion protection: Prevent Super Admin from deleting their own account
  if (actorAdmin && String(target.id) === String(actorAdmin.id)) {
    const err = new Error('You cannot delete your own administrator account.')
    err.statusCode = 400
    err.code = 'CANNOT_DELETE_SELF'
    throw err
  }

  // Invalidate all active sessions first
  await revokeAllSessionsForAdmin(target.id, supabase)

  // Record audit log BEFORE deleting user row to guarantee full audit trail preservation
  await recordAdminAuditLog(
    {
      action: 'superadmin.admin.deleted',
      targetType: 'admin_user',
      targetId: target.id,
      details: {
        actor_admin_id: actorAdmin?.id,
        actor_email: actorAdmin?.email,
        deleted_admin_id: target.id,
        deleted_email: target.email,
        deleted_role: target.role || 'admin',
        reason: String(reason || '').trim() || 'Deleted by Super Admin',
        ip_address: ipAddress || 'unknown',
        user_agent: userAgent || 'unknown',
      },
    },
    supabase,
  )

  // Delete the admin_users row
  const deleteResult = await supabase
    .from('admin_users')
    .delete()
    .eq('id', target.id)

  if (deleteResult.error) {
    logStoreError('deleteAdminAccountSafe(delete)', deleteResult.error)
    const err = new Error('Unable to delete administrator account.')
    err.statusCode = 503
    err.code = 'ADMIN_DELETE_FAILED'
    err.cause = deleteResult.error
    throw err
  }

  return {
    success: true,
    deletedAdmin: {
      id: target.id,
      email: target.email,
      role: target.role || 'admin',
    },
  }
}

export async function listAdminAuditLogs(
  {
    limit = 50,
    offset = 0,
    category = '',
    search = '',
    admin = '',
    action = '',
    severity = '',
    dateRange = '',
    startDate = '',
    endDate = '',
    sortBy = 'newest',
  } = {},
  supabaseClient,
) {
  const supabase = resolveSupabaseClient(supabaseClient)
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200)
  const safeOffset = Math.max(Number(offset) || 0, 0)

  const result = await supabase
    .from('audit_logs')
    .select('id, action, target_type, target_id, details, created_at')
    .order('created_at', { ascending: false })

  if (result.error) {
    logStoreError('listAdminAuditLogs', result.error)
    const err = new Error('Unable to load audit logs.')
    err.statusCode = 503
    err.cause = result.error
    throw err
  }

  const rawRows = result.data || []
  const allLogs = rawRows.map((row) => {
    const details = row.details && typeof row.details === 'object' ? row.details : {}
    const { category: derivedCat, severity: derivedSev } = deriveEventCategoryAndSeverity(row.action, details)
    const effectiveCategory = details.category || derivedCat
    const effectiveSeverity = details.severity || derivedSev
    const actorEmail = details.actor_email || details.administrator_email || details.email || 'system'
    const targetResource = details.target_email || details.deleted_email || details.created_email || row.target_id || row.target_type || ''
    const description = details.description || details.reason || deriveEventDescription(row.action, details, targetResource)

    return {
      id: row.id,
      action: row.action,
      category: effectiveCategory,
      severity: effectiveSeverity,
      target_type: row.target_type,
      target_id: row.target_id,
      targetResource,
      adminId: details.actor_admin_id || details.admin_id || '',
      adminName: details.actor_name || deriveDisplayName(actorEmail, details.role),
      adminEmail: actorEmail,
      admin_email: actorEmail,
      ipAddress: details.ip_address || '',
      ip_address: details.ip_address || '',
      userAgent: details.user_agent || '',
      user_agent: details.user_agent || '',
      description,
      previousValue: details.previous_value || details.previousValue || undefined,
      newValue: details.new_value || details.newValue || undefined,
      source: details.source || 'Super Admin Portal',
      timestamp: formatRelativeTime(row.created_at),
      isoTimestamp: row.created_at,
      created_at: row.created_at,
      details,
    }
  })

  // Global KPI statistics across all events
  const totalEvents = allLogs.length
  const nowMs = Date.now()
  const oneDayMs = 24 * 60 * 60 * 1000
  const eventsToday = allLogs.filter((entry) => {
    const time = new Date(entry.isoTimestamp).getTime()
    return Number.isFinite(time) && nowMs - time <= oneDayMs
  }).length
  const uniqueActors = new Set(allLogs.map((entry) => entry.adminEmail.toLowerCase())).size
  const criticalCount = allLogs.filter((entry) => entry.severity === 'critical').length
  const warningCount = allLogs.filter((entry) => entry.severity === 'warning').length
  const successCount = allLogs.filter((entry) => entry.severity === 'success').length
  const infoCount = allLogs.filter((entry) => entry.severity === 'info').length

  const stats = {
    totalEvents,
    eventsToday,
    uniqueActors,
    criticalCount,
    warningCount,
    successCount,
    infoCount,
  }

  // Filter application
  let filtered = allLogs

  if (category && category !== 'all') {
    const cat = String(category).trim().toLowerCase()
    filtered = filtered.filter((entry) => String(entry.category || '').toLowerCase() === cat)
  }

  if (severity && severity !== 'all') {
    const sev = String(severity).trim().toLowerCase()
    filtered = filtered.filter((entry) => String(entry.severity || '').toLowerCase() === sev)
  }

  if (admin && admin !== 'all') {
    const adm = String(admin).trim().toLowerCase()
    filtered = filtered.filter((entry) =>
      entry.adminEmail.toLowerCase() === adm ||
      entry.adminId.toLowerCase() === adm
    )
  }

  if (action && action !== 'all') {
    const act = String(action).trim().toLowerCase()
    filtered = filtered.filter((entry) => entry.action.toLowerCase().includes(act))
  }

  if (dateRange && dateRange !== 'all') {
    filtered = filtered.filter((entry) => {
      const actTime = new Date(entry.isoTimestamp).getTime()
      if (!Number.isFinite(actTime)) return true
      const diffMs = nowMs - actTime
      if (dateRange === 'today') return diffMs <= oneDayMs
      if (dateRange === '7days') return diffMs <= 7 * oneDayMs
      if (dateRange === '30days') return diffMs <= 30 * oneDayMs
      return true
    })
  }

  if (startDate) {
    const startMs = new Date(startDate).getTime()
    if (Number.isFinite(startMs)) {
      filtered = filtered.filter((entry) => {
        const time = new Date(entry.isoTimestamp).getTime()
        return Number.isFinite(time) && time >= startMs
      })
    }
  }

  if (endDate) {
    const endMs = new Date(endDate).getTime()
    if (Number.isFinite(endMs)) {
      filtered = filtered.filter((entry) => {
        const time = new Date(entry.isoTimestamp).getTime()
        return Number.isFinite(time) && time <= endMs
      })
    }
  }

  if (search) {
    const q = String(search).trim().toLowerCase()
    filtered = filtered.filter((entry) =>
      entry.action.toLowerCase().includes(q) ||
      entry.adminName.toLowerCase().includes(q) ||
      entry.adminEmail.toLowerCase().includes(q) ||
      entry.targetResource.toLowerCase().includes(q) ||
      (entry.target_id && String(entry.target_id).toLowerCase().includes(q)) ||
      (entry.target_type && String(entry.target_type).toLowerCase().includes(q)) ||
      entry.description.toLowerCase().includes(q) ||
      entry.id.toLowerCase().includes(q)
    )
  }

  // Sorting: newest (default), oldest, severity
  if (sortBy === 'oldest') {
    filtered.sort((a, b) => new Date(a.isoTimestamp).getTime() - new Date(b.isoTimestamp).getTime())
  } else if (sortBy === 'severity') {
    const severityRank = { critical: 4, warning: 3, info: 2, success: 1 }
    filtered.sort((a, b) => (severityRank[b.severity] || 0) - (severityRank[a.severity] || 0))
  } else {
    // Default newest
    filtered.sort((a, b) => new Date(b.isoTimestamp).getTime() - new Date(a.isoTimestamp).getTime())
  }

  const total = filtered.length
  const paginated = filtered.slice(safeOffset, safeOffset + safeLimit)

  return {
    activities: paginated,
    logs: paginated,
    total,
    stats,
  }
}

export async function listAdminSessionHistory(
  { limit = 50, offset = 0, email = '', status = '', search = '' } = {},
  supabaseClient,
) {
  const supabase = resolveSupabaseClient(supabaseClient)
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200)
  const safeOffset = Math.max(Number(offset) || 0, 0)

  const [sessionsResult, adminsPrimary] = await Promise.all([
    supabase
      .from('admin_sessions')
      .select('id, admin_user_id, session_version, expires_at, created_at, revoked_at')
      .order('created_at', { ascending: false }),
    supabase
      .from('admin_users')
      .select('id, email, role, is_active'),
  ])

  let adminsResult = adminsPrimary
  let hasRoleColumn = true
  if (adminsPrimary.error && isMissingRoleColumnError(adminsPrimary.error)) {
    logMissingRoleColumnOnce()
    hasRoleColumn = false
    adminsResult = await supabase
      .from('admin_users')
      .select('id, email, is_active')
  }

  if (sessionsResult.error || adminsResult.error) {
    logStoreError('listAdminSessionHistory', sessionsResult.error || adminsResult.error)
    const err = new Error('Unable to load administrator session history.')
    err.statusCode = 503
    throw err
  }

  const adminMap = new Map(
    (adminsResult.data || []).map((row) => [
      String(row.id),
      attachResolvedRole(row, { hasRoleColumn }),
    ]),
  )
  const nowMs = Date.now()

  const allSessions = (sessionsResult.data || []).map((row) => {
    const owner = adminMap.get(String(row.admin_user_id))
    const isExpired = Number.isFinite(Date.parse(row.expires_at)) && Date.parse(row.expires_at) <= nowMs
    const sessionStatus = row.revoked_at ? 'revoked' : isExpired ? 'expired' : 'active'
    return {
      id: row.id,
      admin_user_id: row.admin_user_id,
      admin_email: owner?.email || 'unknown',
      admin_name: owner ? deriveDisplayName(owner.email, owner.role) : 'Administrator',
      role: owner?.role || 'admin',
      session_version: row.session_version,
      created_at: row.created_at,
      expires_at: row.expires_at,
      revoked_at: row.revoked_at,
      status: sessionStatus,
    }
  })

  const activeCount = allSessions.filter((s) => s.status === 'active').length
  const expiredCount = allSessions.filter((s) => s.status === 'expired').length
  const revokedCount = allSessions.filter((s) => s.status === 'revoked').length

  let filtered = allSessions

  if (email && email !== 'all') {
    const cleanEmail = String(email).trim().toLowerCase()
    filtered = filtered.filter((item) => item.admin_email.toLowerCase() === cleanEmail)
  }

  if (status && status !== 'all') {
    const cleanStatus = String(status).trim().toLowerCase()
    filtered = filtered.filter((item) => item.status.toLowerCase() === cleanStatus)
  }

  if (search) {
    const q = String(search).trim().toLowerCase()
    filtered = filtered.filter((item) =>
      item.admin_email.toLowerCase().includes(q) ||
      item.admin_name.toLowerCase().includes(q) ||
      item.id.toLowerCase().includes(q) ||
      item.role.toLowerCase().includes(q)
    )
  }

  const total = filtered.length
  const paginated = filtered.slice(safeOffset, safeOffset + safeLimit)

  return {
    sessions: paginated,
    total,
    totalCount: allSessions.length,
    activeCount,
    expiredCount,
    revokedCount,
  }
}

export async function revokeAdminSessionById(
  { sessionId, actorAdmin, reason = 'Revoked by Super Admin', ipAddress, userAgent },
  supabaseClient,
) {
  if (!sessionId) {
    const err = new Error('Session ID is required.')
    err.statusCode = 400
    throw err
  }
  const supabase = resolveSupabaseClient(supabaseClient)
  const nowIso = new Date().toISOString()

  // 1. Fetch session to find the target owner
  const sessionRes = await supabase
    .from('admin_sessions')
    .select('id, admin_user_id, session_version, expires_at, revoked_at, created_at')
    .eq('id', sessionId)
    .maybeSingle()

  if (sessionRes.error) {
    logStoreError('revokeAdminSessionById(lookup)', sessionRes.error)
    const err = new Error('Unable to lookup session.')
    err.statusCode = 503
    throw err
  }

  const session = sessionRes.data
  if (!session) {
    const err = new Error('Administrator session record not found.')
    err.statusCode = 404
    throw err
  }

  if (session.revoked_at) {
    return { revoked: true, alreadyRevoked: true, sessionId }
  }

  // 2. Fetch owner details for audit log
  let targetEmail = 'unknown'
  let targetRole = 'admin'
  try {
    const adminRes = await supabase
      .from('admin_users')
      .select('id, email, role')
      .eq('id', session.admin_user_id)
      .maybeSingle()
    if (adminRes.data) {
      targetEmail = adminRes.data.email
      targetRole = adminRes.data.role || 'admin'
    }
  } catch {}

  // 3. Revoke session
  const updateRes = await supabase
    .from('admin_sessions')
    .update({ revoked_at: nowIso })
    .eq('id', sessionId)
    .is('revoked_at', null)

  if (updateRes.error) {
    logStoreError('revokeAdminSessionById(update)', updateRes.error)
    const err = new Error('Unable to revoke administrator session.')
    err.statusCode = 503
    throw err
  }

  // 4. Record audit log
  await recordAdminAuditLog(
    {
      action: 'admin.session.revoked',
      targetType: 'admin_session',
      targetId: sessionId,
      details: {
        actor_admin_id: actorAdmin?.id,
        actor_email: actorAdmin?.email,
        target_admin_id: session.admin_user_id,
        target_email: targetEmail,
        target_role: targetRole,
        session_id: sessionId,
        reason: String(reason || '').trim() || 'Revoked by Super Admin',
        ip_address: ipAddress || 'unknown',
        user_agent: userAgent || 'unknown',
      },
    },
    supabase,
  )

  return { revoked: true, sessionId, targetEmail }
}

/**
 * Super Admin Dashboard Overview - Real Supabase Statistics
 * Aggregates accurate platform metrics across Admin Users, Customer Profiles,
 * Admin Sessions, Audit Logs, Organizations, and API Keys.
 */
export async function getSuperadminDashboardOverview(supabaseClient) {
  const supabase = resolveSupabaseClient(supabaseClient)
  const nowMs = Date.now()
  const oneDayMs = 24 * 60 * 60 * 1000
  const sevenDaysMs = 7 * oneDayMs
  const thirtyDaysMs = 30 * oneDayMs

  // Query Supabase tables in parallel with fail-safe async error handling
  const [
    adminsRes,
    sessionsRes,
    auditLogsRes,
    profilesRes,
    orgsRes,
    apiKeysRes,
  ] = await Promise.all([
    (async () => {
      try {
        return await supabase
          .from('admin_users')
          .select('id, email, role, is_active, created_at, last_login')
      } catch (err) {
        return { data: null, error: err }
      }
    })(),
    (async () => {
      try {
        return await supabase
          .from('admin_sessions')
          .select('id, admin_user_id, session_version, expires_at, revoked_at, created_at')
          .order('created_at', { ascending: false })
      } catch (err) {
        return { data: null, error: err }
      }
    })(),
    (async () => {
      try {
        return await supabase
          .from('audit_logs')
          .select('id, action, target_type, target_id, details, created_at')
          .order('created_at', { ascending: false })
      } catch (err) {
        return { data: null, error: err }
      }
    })(),
    (async () => {
      try {
        return await supabase
          .from('profiles')
          .select('user_id, email, full_name, role, status, created_at, last_active_at, last_seen_at')
          .neq('role', 'admin')
      } catch (err) {
        return { data: null, error: err }
      }
    })(),
    (async () => {
      try {
        return await supabase
          .from('organizations')
          .select('id, status', { count: 'exact' })
      } catch (err) {
        return { data: null, count: 0, error: err }
      }
    })(),
    (async () => {
      try {
        return await supabase
          .from('api_keys')
          .select('id, status, revoked_at, expires_at', { count: 'exact' })
      } catch (err) {
        return { data: null, count: 0, error: err }
      }
    })(),
  ])

  // Track unavailable metrics from any failed Supabase query
  const unavailableMetrics = []
  if (adminsRes.error) unavailableMetrics.push('adminStats')
  if (profilesRes.error) unavailableMetrics.push('customerStats')
  if (sessionsRes.error) unavailableMetrics.push('sessionStats')
  if (auditLogsRes.error) unavailableMetrics.push('activityStats', 'securityStats')
  if (orgsRes.error) unavailableMetrics.push('organizationStats')
  if (apiKeysRes.error) unavailableMetrics.push('apiKeyStats')

  // 1. Admin Statistics (admin_users)
  const hasRoleCol = !adminsRes.error
  const adminRows = (adminsRes.data || []).map((row) => attachResolvedRole(row, { hasRoleColumn: hasRoleCol }))
  const totalAdmins = adminRows.length
  const activeAdmins = adminRows.filter((a) => Boolean(a.is_active)).length
  const inactiveAdmins = adminRows.filter((a) => !a.is_active).length
  const superadminCount = adminRows.filter((a) => a.role === 'superadmin').length
  const standardAdminCount = adminRows.filter((a) => a.role === 'admin').length

  // 2. Customer Statistics (profiles)
  // Reconciled active/inactive classification: NULL, missing, inactive, suspended -> inactive
  const profileRows = profilesRes.data || []
  const totalCustomers = profileRows.length
  const isCustomerActive = (p) => {
    if (!p) return false
    const status = typeof p.status === 'string' ? p.status.trim().toLowerCase() : ''
    if (status === 'suspended' || status === 'inactive' || status === 'banned' || status === 'disabled') {
      return false
    }
    if (status === 'active') return true
    if (p.is_active === true) return true
    return false
  }
  const activeCustomers = profileRows.filter(isCustomerActive).length
  const inactiveCustomers = totalCustomers - activeCustomers
  const onlineCustomers = profileRows.filter((p) => {
    if (!p.last_seen_at && !p.last_active_at) return false
    const lastTime = new Date(p.last_seen_at || p.last_active_at).getTime()
    return Number.isFinite(lastTime) && nowMs - lastTime <= 2 * 60 * 1000
  }).length

  const registeredToday = profileRows.filter((p) => {
    const t = new Date(p.created_at).getTime()
    return Number.isFinite(t) && nowMs - t <= oneDayMs
  }).length

  const registered7d = profileRows.filter((p) => {
    const t = new Date(p.created_at).getTime()
    return Number.isFinite(t) && nowMs - t <= sevenDaysMs
  }).length

  const registered30d = profileRows.filter((p) => {
    const t = new Date(p.created_at).getTime()
    return Number.isFinite(t) && nowMs - t <= thirtyDaysMs
  }).length

  // Daily registrations timeline for last 7 days
  const dailyRegistrations = []
  for (let i = 6; i >= 0; i--) {
    const dayStart = new Date(nowMs - i * oneDayMs)
    dayStart.setUTCHours(0, 0, 0, 0)
    const dayEnd = new Date(dayStart.getTime() + oneDayMs)
    const dateStr = dayStart.toISOString().slice(0, 10)
    const count = profileRows.filter((p) => {
      const t = new Date(p.created_at).getTime()
      return Number.isFinite(t) && t >= dayStart.getTime() && t < dayEnd.getTime()
    }).length
    dailyRegistrations.push({ date: dateStr, count })
  }

  // 3. Activity Overview (audit_logs & admin_sessions)
  const rawAuditLogs = auditLogsRes.data || []
  const totalActivities = rawAuditLogs.length
  const activitiesToday = rawAuditLogs.filter((l) => {
    const t = new Date(l.created_at).getTime()
    return Number.isFinite(t) && nowMs - t <= oneDayMs
  }).length

  const successfulLogins = rawAuditLogs.filter((l) => l.action === 'admin.login.success').length
  const failedLogins = rawAuditLogs.filter((l) => l.action === 'admin.login.failed').length
  const recentSessionRevocations = rawAuditLogs.filter((l) => l.action === 'admin.session.revoked').length

  const mappedActivities = rawAuditLogs.map((row) => {
    const details = row.details && typeof row.details === 'object' ? row.details : {}
    const { category, severity } = deriveEventCategoryAndSeverity(row.action, details)
    const actorEmail = details.actor_email || details.administrator_email || details.email || 'system'
    const targetResource = details.target_email || details.deleted_email || details.created_email || row.target_id || row.target_type || ''
    const description = details.description || details.reason || deriveEventDescription(row.action, details, targetResource)

    return {
      id: row.id,
      action: row.action,
      category: details.category || category,
      severity: details.severity || severity,
      adminName: details.actor_name || deriveDisplayName(actorEmail, details.role),
      adminEmail: actorEmail,
      targetResource,
      description,
      ipAddress: details.ip_address || '',
      userAgent: details.user_agent || '',
      timestamp: formatRelativeTime(row.created_at),
      isoTimestamp: row.created_at,
      details,
    }
  })

  // 4. Security Overview (admin_sessions & audit_logs)
  const sessionRows = sessionsRes.data || []
  const activeSessions = sessionRows.filter((s) => !s.revoked_at && Date.parse(s.expires_at) > nowMs).length
  const revokedSessions = sessionRows.filter((s) => Boolean(s.revoked_at)).length

  const blockedActions = rawAuditLogs.filter((l) => {
    const act = String(l.action || '').toLowerCase()
    return act.includes('blocked') || act.includes('violation')
  }).length

  const securityEvents = mappedActivities
    .filter((a) => {
      const act = a.action.toLowerCase()
      return (
        a.category === 'Security' ||
        act.startsWith('security.') ||
        act.includes('blocked') ||
        act.includes('violation') ||
        act.includes('failed') ||
        act.includes('revoked')
      )
    })
    .slice(0, 6)

  // 5. Platform Overview (Excluding GPU per scope requirements)
  // Reconciled with FastAPI :8001 API key status and revocation logic
  const isApiKeyActive = (k) => {
    if (!k) return false
    const status = typeof k.status === 'string' ? k.status.trim().toLowerCase() : ''
    if (status !== 'active') return false
    if (k.revoked_at) return false
    if (k.expires_at) {
      const exp = Date.parse(k.expires_at)
      if (!isNaN(exp) && exp <= nowMs) return false
    }
    return true
  }

  const totalOrganizations = orgsRes.error ? null : (orgsRes.count ?? (orgsRes.data ? orgsRes.data.length : 0))
  const totalApiKeys = apiKeysRes.error ? null : (apiKeysRes.count ?? (apiKeysRes.data ? apiKeysRes.data.length : 0))
  const activeApiKeys = apiKeysRes.error ? null : (apiKeysRes.data || []).filter(isApiKeyActive).length

  return {
    unavailableMetrics,
    adminStats: {
      available: !adminsRes.error,
      total: totalAdmins,
      active: activeAdmins,
      inactive: inactiveAdmins,
      superadminCount,
      standardAdminCount,
      roleDistribution: {
        superadmin: superadminCount,
        admin: standardAdminCount,
      },
    },
    customerStats: {
      available: !profilesRes.error,
      total: totalCustomers,
      active: activeCustomers,
      inactive: inactiveCustomers,
      online: onlineCustomers,
      registrations: {
        today: registeredToday,
        last7Days: registered7d,
        last30Days: registered30d,
        daily: dailyRegistrations,
      },
    },
    activityStats: {
      available: !auditLogsRes.error,
      totalActivities,
      activitiesToday,
      successfulLogins,
      failedLogins,
      recentSessionRevocations,
      recentActivities: mappedActivities.slice(0, 6),
    },
    securityStats: {
      available: !sessionsRes.error && !auditLogsRes.error,
      failedLoginAttempts: failedLogins,
      blockedActions,
      activeSessions,
      revokedSessions,
      recentSecurityEvents: securityEvents,
    },
    platformStats: {
      organizationsAvailable: !orgsRes.error,
      apiKeysAvailable: !apiKeysRes.error,
      totalOrganizations: totalOrganizations ?? 0,
      totalApiKeys: totalApiKeys ?? 0,
      activeApiKeys: activeApiKeys ?? 0,
    },
  }
}
