// @ts-nocheck
import crypto from 'node:crypto'
import { getSupabaseAdminClient } from '../lib/supabase.js'

const ADMIN_SAFE_COLUMNS = 'id, email, role, is_active, session_version, created_at, updated_at, last_login'
const ADMIN_SAFE_COLUMNS_LEGACY = 'id, email, is_active, session_version, created_at, updated_at, last_login'
const ADMIN_AUTH_COLUMNS = `${ADMIN_SAFE_COLUMNS}, password_hash`
const ADMIN_AUTH_COLUMNS_LEGACY = `${ADMIN_SAFE_COLUMNS_LEGACY}, password_hash`
const ALLOWED_ROLES = new Set(['admin', 'superadmin'])

// Confirmed pre-migration primary Super Admin identity (used strictly when migration 004
// has not yet added the `role` column to `public.admin_users`).
export const PRIMARY_SUPERADMIN_ID = 'd9a494cb-1e8d-4bca-8142-19687fa9138b'
export const PRIMARY_SUPERADMIN_EMAIL = 'admin@inferxe.com'

export const DEFAULT_ADMIN_SESSION_TTL_SECONDS = 12 * 60 * 60 // 12 hours

let loggedMissingRoleColumnWarning = false

function resolveSupabaseClient(injectedClient) {
  if (injectedClient !== undefined) {
    if (!injectedClient) {
      throw new Error('Supabase client is not configured.')
    }
    return injectedClient
  }
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

  const result = await selectSingleAdminRow(supabase, {
    columns: ADMIN_AUTH_COLUMNS,
    legacyColumns: ADMIN_AUTH_COLUMNS_LEGACY,
    filterField: 'email',
    filterValue: normalizedEmail,
  })

  if (result.error) {
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

  const result = await selectSingleAdminRow(supabase, {
    columns: ADMIN_SAFE_COLUMNS,
    legacyColumns: ADMIN_SAFE_COLUMNS_LEGACY,
    filterField: 'id',
    filterValue: adminId,
  })

  if (result.error) {
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

  const insertResult = await supabase
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

  if (insertResult.error || !insertResult.data) {
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
    logStoreError('verifyAdminSessionRecord(query)', err)
    return {
      valid: false,
      statusCode: 503,
      error: 'Administrator session verification service is temporarily unavailable.',
    }
  }

  if (sessionResult.error || adminResult.error) {
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
    return { valid: false, statusCode: 403, error: 'Invalid administrator role configuration.' }
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

  return {
    valid: true,
    statusCode: 200,
    admin: sanitizeAdminUser(admin),
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

export async function recordAdminAuditLog(
  { action, targetType, targetId, details = {} },
  supabaseClient,
) {
  try {
    const supabase = resolveSupabaseClient(supabaseClient)
    const result = await supabase.from('audit_logs').insert({
      action: String(action || 'admin.event'),
      target_type: String(targetType || 'admin_user'),
      target_id: targetId ? String(targetId) : null,
      details,
    })
    return !result.error
  } catch {
    return false
  }
}

export async function createDeveloperAdminAccount(
  { email, passwordHash, actorAdmin, ipAddress },
  supabaseClient,
) {
  const normalizedEmail = String(email || '').trim().toLowerCase()
  const supabase = resolveSupabaseClient(supabaseClient)

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
      },
    },
    supabase,
  )

  return createdAdmin
}

export async function setAdminAccountActiveStatus(
  { adminId, isActive, reason = '', actorAdmin, ipAddress },
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
      },
    },
    supabase,
  )

  return updatedAdmin
}

export async function listAdminAuditLogs(
  { limit = 50, offset = 0, category = '', search = '' } = {},
  supabaseClient,
) {
  const supabase = resolveSupabaseClient(supabaseClient)
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200)
  const safeOffset = Math.max(Number(offset) || 0, 0)

  const result = await supabase
    .from('audit_logs')
    .select('id, action, target_type, target_id, details, created_at')
    .order('created_at', { ascending: false })
    .range(safeOffset, safeOffset + safeLimit - 1)

  if (result.error) {
    logStoreError('listAdminAuditLogs', result.error)
    const err = new Error('Unable to load audit logs.')
    err.statusCode = 503
    err.cause = result.error
    throw err
  }

  let logs = (result.data || []).map((row) => {
    const details = row.details && typeof row.details === 'object' ? row.details : {}
    const derivedCategory = String(row.action || '').split('.')[0] || row.target_type || 'security'
    return {
      id: row.id,
      action: row.action,
      category: details.category || derivedCategory,
      target_type: row.target_type,
      target_id: row.target_id,
      admin_email: details.actor_email || details.administrator_email || details.email || 'system',
      ip_address: details.ip_address || '',
      details,
      created_at: row.created_at,
    }
  })

  if (category && category !== 'all') {
    const cat = String(category).toLowerCase()
    logs = logs.filter((entry) => String(entry.category || '').toLowerCase() === cat)
  }

  if (search) {
    const q = String(search).toLowerCase()
    logs = logs.filter((entry) =>
      String(entry.action || '').toLowerCase().includes(q) ||
      String(entry.admin_email || '').toLowerCase().includes(q) ||
      String(entry.target_id || '').toLowerCase().includes(q) ||
      JSON.stringify(entry.details || {}).toLowerCase().includes(q),
    )
  }

  return { logs, total: logs.length }
}

export async function listAdminSessionHistory(
  { limit = 50, offset = 0, email = '' } = {},
  supabaseClient,
) {
  const supabase = resolveSupabaseClient(supabaseClient)
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200)
  const safeOffset = Math.max(Number(offset) || 0, 0)

  const [sessionsResult, adminsPrimary] = await Promise.all([
    supabase
      .from('admin_sessions')
      .select('id, admin_user_id, session_version, expires_at, created_at, revoked_at')
      .order('created_at', { ascending: false })
      .range(safeOffset, safeOffset + safeLimit - 1),
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

  let sessions = (sessionsResult.data || []).map((row) => {
    const owner = adminMap.get(String(row.admin_user_id))
    const isExpired = Number.isFinite(Date.parse(row.expires_at)) && Date.parse(row.expires_at) <= nowMs
    const status = row.revoked_at ? 'revoked' : isExpired ? 'expired' : 'active'
    return {
      id: row.id,
      admin_user_id: row.admin_user_id,
      admin_email: owner?.email || 'unknown',
      role: owner?.role || 'admin',
      session_version: row.session_version,
      created_at: row.created_at,
      expires_at: row.expires_at,
      revoked_at: row.revoked_at,
      status,
    }
  })

  if (email) {
    const clean = String(email).trim().toLowerCase()
    sessions = sessions.filter((item) => item.admin_email.toLowerCase() === clean)
  }

  return { sessions, total: sessions.length }
}
