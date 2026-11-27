/**
 * supabaseCustomerService.js
 * ===========================
 * Centralized Supabase PostgreSQL Customer Service for Inferxe.
 * Single source of truth for Customer Profiles, Activity, and Presence across all laptops.
 *
 * Uses the canonical `public.profiles` table with zero duplication of identities.
 * Fully compatible with existing RAG chat history, multi-tenancy, and organization relations.
 */

import { loadBackendEnv } from '../auth/envLoader.js'
import { assertExternalTargetAllowed, isTestRun } from '../lib/testSafety.js'
import { isLocalMockSupabaseEnabled, LOCAL_MOCK_SUPABASE_URL } from '../lib/supabase.js'
import { isAdminDevFallbackEnabled } from '../auth/adminSessionStore.js'
import {
  recordSessionHeartbeat,
  removeSession,
  hasOtherActiveSessionsDb,
  cleanExpiredSessionsDb,
  listOnlineSessionKeysDb,
  getCustomerDetails as getCustomerDetailsDb,
  registerOrUpdateCustomer,
} from './customerDatabase.js'

loadBackendEnv()

// Configurable thresholds with production-tested defaults: 2 minutes online window, 5 days inactivity threshold
const ACTIVITY_ONLINE_THRESHOLD_MS =
  (parseInt(process.env.CUSTOMER_ONLINE_WINDOW_SECONDS, 10) || 120) * 1000
const ACTIVITY_ACTIVE_THRESHOLD_MS =
  (parseInt(process.env.CUSTOMER_INACTIVITY_THRESHOLD_DAYS, 10) || 5) * 24 * 60 * 60 * 1000

// In-memory active multi-session registry: Map<customerSubOrEmail, Map<sessionId, lastSeenTimestampMs>>
const activeCustomerSessions = new Map()

export function registerCustomerSession(customerKey, sessionId, extra = {}) {
  if (!customerKey || !sessionId) return
  const cleanKey = String(customerKey).trim().toLowerCase()
  if (!activeCustomerSessions.has(cleanKey)) {
    activeCustomerSessions.set(cleanKey, new Map())
  }
  activeCustomerSessions.get(cleanKey).set(String(sessionId).trim(), Date.now())

  // Persist to SQLite for restart survival
  try {
    recordSessionHeartbeat({
      session_id: sessionId,
      cognito_sub: extra.cognito_sub || (cleanKey.includes('@') ? null : cleanKey),
      email: extra.email || (cleanKey.includes('@') ? cleanKey : null),
    })
  } catch {}
}

export function removeCustomerSession(customerKey, sessionId) {
  if (!customerKey) return false
  const cleanKey = String(customerKey).trim().toLowerCase()
  const sessions = activeCustomerSessions.get(cleanKey)
  if (sessions) {
    if (sessionId) {
      sessions.delete(String(sessionId).trim())
    } else {
      sessions.clear()
    }
  }

  // Remove from SQLite
  try {
    removeSession({
      session_id: sessionId,
      cognito_sub: cleanKey.includes('@') ? null : cleanKey,
      email: cleanKey.includes('@') ? cleanKey : null,
    })
  } catch {}
  return true
}

export function hasOtherActiveSessions(customerKey, excludedSessionId, onlineWindowMs = ACTIVITY_ONLINE_THRESHOLD_MS) {
  if (!customerKey) return false
  const cleanKey = String(customerKey).trim().toLowerCase()

  // 1. Check in-memory session registry
  const sessions = activeCustomerSessions.get(cleanKey)
  if (sessions && sessions.size > 0) {
    const now = Date.now()
    for (const [id, lastSeen] of sessions.entries()) {
      if (excludedSessionId && id === String(excludedSessionId).trim()) {
        continue
      }
      if (now - lastSeen <= onlineWindowMs) {
        return true
      }
    }
  }

  // 2. Persistent check against SQLite (survives backend restarts)
  try {
    const hasInDb = hasOtherActiveSessionsDb({
      cognito_sub: cleanKey.includes('@') ? null : cleanKey,
      email: cleanKey.includes('@') ? cleanKey : null,
      excluded_session_id: excludedSessionId,
      windowMs: onlineWindowMs,
    })
    if (hasInDb) return true
  } catch {}

  return false
}

export function isCustomerOnlineSession(customerKey) {
  return hasOtherActiveSessions(customerKey, null)
}

export function cleanExpiredSessions(olderThanMs = 24 * 60 * 60 * 1000) {
  const now = Date.now()
  for (const [key, map] of activeCustomerSessions.entries()) {
    for (const [sessionId, lastSeen] of map.entries()) {
      if (now - lastSeen > olderThanMs) {
        map.delete(sessionId)
      }
    }
    if (map.size === 0) {
      activeCustomerSessions.delete(key)
    }
  }

  try {
    cleanExpiredSessionsDb(olderThanMs)
  } catch {}
}

function getSupabaseConfig() {
  const useMock = isLocalMockSupabaseEnabled()
  const url = (useMock ? LOCAL_MOCK_SUPABASE_URL : (process.env.SUPABASE_URL || '')).trim()
  const key = (
    useMock
      ? 'local-mock-service-key'
      : (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '')
  ).trim()
  if (!url || !key) {
    throw new Error('Supabase configuration missing (SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY).')
  }
  assertExternalTargetAllowed(url, 'Supabase customer service')
  return { url: url.replace(/\/$/, ''), key }
}

function getAuthHeaders(serviceRoleKey) {
  const trimmed = String(serviceRoleKey).trim()
  const headers = {
    apikey: trimmed,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
  if (!trimmed.startsWith('sb_secret_')) {
    headers.Authorization = `Bearer ${trimmed}`
  }
  return headers
}

/**
 * Compute dynamic customer activity status based on real-time presence.
 */
export function computeActivityStatus(arg1, arg2, arg3) {
  let lastActiveAt = null
  let lastLoginAt = null
  let lastSeenAt = null
  let accountStatus = 'active'

  if (typeof arg1 === 'object' && arg1 !== null) {
    // Called with profile object: computeActivityStatus(profileRow)
    lastActiveAt = arg1.last_active_at || null
    lastLoginAt = arg1.last_login_at || null
    lastSeenAt = arg1.last_seen_at || null
    accountStatus = arg1.status || arg1.account_status || 'active'
  } else if (typeof arg2 === 'string' && (arg2 === 'active' || arg2 === 'suspended' || arg2 === 'inactive')) {
    // Called as computeActivityStatus(lastActiveOrTimestamp, accountStatus)
    lastActiveAt = arg1
    lastLoginAt = null
    lastSeenAt = arg1
    accountStatus = arg2
  } else {
    // Called as computeActivityStatus(lastActiveAt, lastSeenAt, accountStatus)
    lastActiveAt = arg1
    lastLoginAt = null
    lastSeenAt = arg2
    accountStatus = arg3 || 'active'
  }

  if (accountStatus === 'suspended') {
    return 'Suspended'
  }

  const now = Date.now()
  const seenTime = lastSeenAt ? new Date(lastSeenAt).getTime() : 0
  const activeTime = lastActiveAt ? new Date(lastActiveAt).getTime() : 0
  const loginTime = lastLoginAt ? new Date(lastLoginAt).getTime() : 0

  // 1. ONLINE: Recent heartbeat presence within the configured online window (120 seconds)
  if (seenTime > 0 && !isNaN(seenTime) && now - seenTime <= ACTIVITY_ONLINE_THRESHOLD_MS) {
    return 'Online'
  }

  // 2. ACTIVE: Not currently online, but genuine last_active_at or last_login_at exists within 5 days
  const genuineActivityTime = Math.max(
    !isNaN(activeTime) ? activeTime : 0,
    !isNaN(loginTime) ? loginTime : 0
  )

  if (genuineActivityTime > 0 && now - genuineActivityTime <= ACTIVITY_ACTIVE_THRESHOLD_MS) {
    return 'Active'
  }

  // 3. INACTIVE: Never had login/session activity OR last activity was beyond the inactivity threshold
  return 'Inactive'
}

/**
 * Conservative classification for synthetic test accounts created by automated fixtures.
 * Requires verified synthetic user ID prefixes or known test fixture identities.
 * Does NOT classify a customer as a test account solely based on email domain without a verified test identity.
 */
export function isTestCustomer(profile) {
  if (!profile) return false
  const userId = String(profile.user_id || profile.cognito_sub || '').trim()
  const email = String(profile.email || '').trim().toLowerCase()

  // 1. Verified synthetic test user ID prefixes generated by automated test fixtures
  const isSyntheticUserId =
    userId.startsWith('cust_wallet_') ||
    userId.startsWith('test-new-sub-') ||
    userId.startsWith('sub-test-') ||
    userId.startsWith('test_user_') ||
    userId.startsWith('idem_') ||
    userId.startsWith('iso_')

  // 2. Known test fixture identities: test domain paired with verified test ID prefix
  const isVerifiedTestFixture =
    (email.endsWith('@test.ai') && (userId.startsWith('cust_') || userId.startsWith('idem_') || userId.startsWith('iso_'))) ||
    (email.endsWith('@example.com') && (userId.startsWith('test') || email.startsWith('test_user_')))

  return Boolean(isSyntheticUserId || isVerifiedTestFixture)
}

/**
 * Format a raw Supabase profile row into the standardized CustomerRecord contract.
 */
export function formatCustomerRecord(row) {
  const now = new Date().toISOString()
  const lastLogin = row.last_login_at || null
  const regDate = row.created_at || null
  const isOnlineInMem = isCustomerOnlineSession(row.user_id) || isCustomerOnlineSession(row.email)

  // Genuine authenticated activity: actual last_active_at from DB only
  const lastActive = row.last_active_at || null

  // Heartbeat presence: only genuine heartbeat if online in memory or if customer has had genuine activity
  const lastSeen = isOnlineInMem
    ? now
    : (row.last_seen_at !== undefined && row.last_seen_at !== null
        ? (row.last_active_at || row.last_login_at ? row.last_seen_at : null)
        : (row.last_active_at || null))

  const activityStatus = computeActivityStatus({
    ...row,
    last_active_at: lastActive,
    last_login_at: lastLogin,
    last_seen_at: lastSeen,
  })
  const isTest = isTestCustomer(row)

  return {
    customer_id: `cst_${row.user_id.slice(0, 16)}`,
    cognito_sub: row.user_id,
    full_name: row.full_name || 'Customer',
    email: row.email,
    phone_number: row.phone_number || null,
    organization: row.organization || null,
    role: row.role || 'customer',
    registration_date: regDate,
    last_login_at: lastLogin,
    last_active_at: lastActive,
    last_heartbeat_at: (row.last_active_at || row.last_login_at) ? (lastSeen || null) : null,
    account_status: (row.status === 'suspended' ? 'suspended' : 'active'),
    activity_status: activityStatus,
    login_count: typeof row.login_count === 'number' && !isNaN(row.login_count) ? row.login_count : 0,
    is_test_account: isTest,
    created_at: regDate,
    updated_at: row.updated_at || null,
  }
}

/**
 * Resolves the display username for a customer profile safely.
 * Never uses internal machine usernames (e.g. claims['cognito:username']).
 * Uses preferred_username if explicitly provided and valid,
 * otherwise preserves an existing friendly username, or falls back to
 * full_name or email-based username for new accounts.
 */
export function resolveCustomerUsername({ existingProfile = null, claims = {}, email = '', fullName = '' } = {}) {
  // 1. Explicit, valid preferred_username from Cognito claims
  if (typeof claims?.preferred_username === 'string' && claims.preferred_username.trim()) {
    const preferred = claims.preferred_username.trim()
    if (!/^user_[a-f0-9]{16,}$/i.test(preferred)) {
      return preferred
    }
  }

  // 2. Preserve existing friendly username if already established
  if (existingProfile && typeof existingProfile.username === 'string') {
    const existing = existingProfile.username.trim()
    if (existing && !/^user_[a-f0-9]{16,}$/i.test(existing)) {
      return existing
    }
  }

  // 3. Fallback to fullName if friendly
  if (fullName && typeof fullName === 'string' && fullName.trim()) {
    const cleanName = fullName.trim()
    if (!/^user_[a-f0-9]{16,}$/i.test(cleanName)) {
      return cleanName
    }
  }

  // 4. Sensible fallback to email prefix for new accounts
  const cleanEmail = (email || '').trim().toLowerCase()
  if (cleanEmail && cleanEmail.includes('@')) {
    return cleanEmail.split('@')[0]
  }

  return 'customer'
}

/** Error carrying an HTTP status for the sign-in profile sync (e.g. 409 link refused, 503 lookup unavailable). */
function profileLinkError(message, statusCode, code) {
  return Object.assign(new Error(message), { statusCode, code })
}

/**
 * Audit a refused customer profile link: console (structured) and the audit_logs table when reachable.
 * Identifiers only (Cognito subjects); never emails, names, tokens or secrets.
 */
async function auditProfileLink({ outcome, reason, cognitoSub, existingUserId }) {
  const details = { outcome, reason, cognito_sub: cognitoSub, existing_user_id: existingUserId }
  console.warn('[customer-profile-link]', JSON.stringify(details))
  try {
    const { url, key } = getSupabaseConfig()
    await fetch(`${url}/rest/v1/audit_logs`, {
      method: 'POST',
      headers: { ...getAuthHeaders(key), Prefer: 'return=minimal' },
      body: JSON.stringify({ action: `customer.profile_link.${outcome}`, target_type: 'profile', target_id: existingUserId || null, details }),
    })
  } catch {
    // Audit storage is best effort; the console record above always exists.
  }
}

/**
 * Upsert customer profile in Supabase PostgreSQL upon Cognito registration or login.
 * Safely handles both baseline schema and extended schema.
 * Bulletproof against duplicate email constraints and preserves foreign-key integrity.
 */
export async function upsertCustomerProfile({
  cognito_sub,
  full_name,
  email,
  phone_number = null,
  organization = null,
  isLogin = false,
  claims = {},
}) {
  if (!cognito_sub || !email) {
    throw new Error('Customer identity requires both cognito_sub and email.')
  }

  const { url, key } = getSupabaseConfig()
  const cleanEmail = email.trim().toLowerCase()
  const cleanFullName = (full_name || cleanEmail.split('@')[0]).trim()
  const nowIso = new Date().toISOString()

  // 1. First check if profile already exists by user_id
  let existingProfile = null
  const lookupRows = async (filter) => {
    let lookupRes
    try {
      lookupRes = await fetch(`${url}/rest/v1/profiles?${filter}&select=*`, { headers: getAuthHeaders(key) })
    } catch (err) {
      console.warn('[supabaseCustomerService] Profile lookup failed:', err.message)
    }
    if (!lookupRes || !lookupRes.ok) {
      if (!isTestRun() && (isAdminDevFallbackEnabled() || isLocalMockSupabaseEnabled())) {
        const localCustomer = getCustomerDetailsDb(cognito_sub) || getCustomerDetailsDb(cleanEmail)
        if (localCustomer) {
          return [{
            user_id: localCustomer.cognito_sub || cognito_sub,
            full_name: localCustomer.full_name,
            email: localCustomer.email,
            username: localCustomer.username || localCustomer.email.split('@')[0],
            role: localCustomer.role || 'customer',
            status: localCustomer.account_status || 'active',
            organization: localCustomer.organization || null,
            organization_id: null,
            login_count: localCustomer.login_count || 1,
            last_login_at: localCustomer.last_login_at || null,
            last_active_at: localCustomer.last_active_at || null,
          }]
        }
        return []
      }
      throw profileLinkError('Customer profile service is temporarily unavailable.', 503, 'PROFILE_LOOKUP_UNAVAILABLE')
    }
    const rows = await lookupRes.json()
    return Array.isArray(rows) ? rows : []
  }
  existingProfile = (await lookupRows(`user_id=eq.${encodeURIComponent(cognito_sub)}`))[0] || null

  // 2. No profile for this Cognito subject: the email must not belong to another identity's profile.
  //    A verified email alone is not proof of owning an existing profile (deleted/recreated accounts, reassigned
  //    mailboxes), and its related data cannot be moved atomically here, so such profiles are never re-keyed or
  //    inherited. Resolving a genuine identity change is an admin-mediated process.
  if (!existingProfile) {
    const byEmail = (await lookupRows(`email=eq.${encodeURIComponent(cleanEmail)}`))[0] || null
    if (byEmail && byEmail.user_id !== cognito_sub) {
      await auditProfileLink({
        outcome: 'refused',
        reason: byEmail.role && byEmail.role !== 'customer' ? 'email_belongs_to_non_customer_profile' : 'email_belongs_to_other_identity',
        cognitoSub: cognito_sub,
        existingUserId: byEmail.user_id,
      })
      throw profileLinkError(
        'This email address is already linked to a different sign-in. Please contact Inferxe support.',
        409,
        'PROFILE_LINK_REFUSED',
      )
    }
    existingProfile = byEmail
  }

  const currentCount =
    typeof existingProfile?.login_count === 'number' && !isNaN(existingProfile.login_count)
      ? existingProfile.login_count
      : 0

  // Avoid duplicate login updates when the same authentication event is retried
  const lastAuthTimeSec = existingProfile?.last_login_at
    ? Math.floor(new Date(existingProfile.last_login_at).getTime() / 1000)
    : 0
  const isDuplicateAuthEvent = Boolean(
    isLogin &&
    claims?.auth_time &&
    lastAuthTimeSec > 0 &&
    claims.auth_time === lastAuthTimeSec
  )
  const shouldIncrement = isLogin && !isDuplicateAuthEvent
  const newLoginCount = currentCount + (shouldIncrement ? 1 : 0)

  const username = resolveCustomerUsername({
    existingProfile,
    claims,
    email: cleanEmail,
    fullName: cleanFullName,
  })

  // Existing status is kept (inactive, suspended and pending are never silently changed), except that an
  // admin-invited profile (pending, created with this Cognito subject) becomes active on its owner's sign-in.
  const profileStatus = !existingProfile
    ? 'active'
    : existingProfile.status === 'pending' && isLogin && existingProfile.user_id === cognito_sub
      ? 'active'
      : existingProfile.status || 'active'

  // Full extended payload
  const extendedPayload = {
    user_id: cognito_sub,
    full_name: cleanFullName,
    email: cleanEmail,
    username,
    role: existingProfile?.role || 'customer',
    status: profileStatus,
    auth_provider: 'cognito',
    updated_at: nowIso,
    login_count: newLoginCount,
    last_login_at: isLogin ? nowIso : (existingProfile?.last_login_at || null),
    last_active_at: isLogin ? nowIso : (existingProfile?.last_active_at || null),
    last_seen_at: isLogin ? nowIso : (existingProfile?.last_seen_at || null),
  }

  if (phone_number) extendedPayload.phone_number = phone_number

  // Strictly preserve existing organization if a subsequent login does not supply a new one.
  // Never overwrite a valid existing organization with NULL, whitespace, or empty string.
  const cleanOrg =
    typeof organization === 'string' && organization.trim().length > 0
      ? organization.trim()
      : (existingProfile?.organization || null)
  if (cleanOrg) {
    extendedPayload.organization = cleanOrg
  }

  // Baseline payload (if migration 004 has not yet been applied to Supabase)
  const baselinePayload = {
    user_id: cognito_sub,
    full_name: cleanFullName,
    email: cleanEmail,
    username,
    role: existingProfile?.role || 'customer',
    status: profileStatus,
    auth_provider: 'cognito',
    last_active_at: isLogin ? nowIso : (existingProfile?.last_active_at || null),
    updated_at: nowIso,
  }

  let res = null
  try {
    if (existingProfile) {
      // If profile already exists, PATCH to update and avoid duplicate email constraint failures
      const targetId = existingProfile.user_id || cognito_sub
      const patchUrl = `${url}/rest/v1/profiles?user_id=eq.${encodeURIComponent(targetId)}`
      res = await fetch(patchUrl, {
        method: 'PATCH',
        headers: {
          ...getAuthHeaders(key),
          Prefer: 'return=representation',
        },
        body: JSON.stringify(extendedPayload),
      })

      if (!res.ok) {
        const errorBody = await res.json().catch(() => ({}))
        if (errorBody.code === 'PGRST204' || res.status === 400) {
          res = await fetch(patchUrl, {
            method: 'PATCH',
            headers: {
              ...getAuthHeaders(key),
              Prefer: 'return=representation',
            },
            body: JSON.stringify(baselinePayload),
          })
        }
      }
    } else {
      // Brand new customer: POST to insert
      const insertUrl = `${url}/rest/v1/profiles`
      res = await fetch(insertUrl, {
        method: 'POST',
        headers: {
          ...getAuthHeaders(key),
          Prefer: 'return=representation',
        },
        body: JSON.stringify(extendedPayload),
      })

      if (!res.ok) {
        const errorBody = await res.json().catch(() => ({}))
        if (errorBody.code === 'PGRST204' || res.status === 400) {
          res = await fetch(insertUrl, {
            method: 'POST',
            headers: {
              ...getAuthHeaders(key),
              Prefer: 'return=representation',
            },
            body: JSON.stringify(baselinePayload),
          })
        }
      }
    }
  } catch (fetchErr) {
    console.warn('[supabaseCustomerService] Profile save request failed:', fetchErr.message)
  }

  if (!res || !res.ok) {
    if (!isTestRun() && (isAdminDevFallbackEnabled() || isLocalMockSupabaseEnabled())) {
      try {
        registerOrUpdateCustomer({
          cognito_sub,
          full_name: cleanFullName,
          email: cleanEmail,
          phone_number,
          organization: cleanOrg,
          role: 'customer',
          account_status: profileStatus,
          isLogin,
        })
      } catch (localErr) {
        console.warn('[supabaseCustomerService] Local SQLite customer save warning:', localErr.message)
      }
      return {
        cognito_sub,
        full_name: cleanFullName,
        email: cleanEmail,
        username,
        role: 'customer',
        account_status: profileStatus,
        status: profileStatus,
        organization: cleanOrg || 'Personal Workspace',
        organization_id: null,
      }
    }
    const text = res ? await res.text().catch(() => '') : 'Network unavailable'
    throw new Error(`Failed to upsert Supabase profile: HTTP ${res?.status || 503} - ${text}`)
  }

  // Return only what the database confirms it stored (never the request payload): a PATCH matching no row
  // or an unreadable response is a failed sync.
  const data = await res.json().catch(() => null)
  const savedRow = Array.isArray(data) ? data[0] : null
  if (!savedRow?.user_id || savedRow.user_id !== cognito_sub) {
    throw new Error('Supabase did not return the saved customer profile.')
  }
  return formatCustomerRecord(savedRow)
}

/**
 * Update customer heartbeat / presence timestamp (last_seen_at).
 * Throttled to avoid excessive database writes while customer is active.
 */
export async function updateCustomerHeartbeat({ cognito_sub, email, session_id }) {
  if (!cognito_sub && !email) {
    throw new Error('Heartbeat requires cognito_sub or email.')
  }

  // Register session presence in memory for multi-device support
  if (session_id) {
    if (cognito_sub) registerCustomerSession(cognito_sub, session_id, { cognito_sub, email })
    if (email) registerCustomerSession(email, session_id, { cognito_sub, email })
  }

  const { url, key } = getSupabaseConfig()
  const nowIso = new Date().toISOString()
  const filter = cognito_sub
    ? `user_id=eq.${encodeURIComponent(cognito_sub)}`
    : `email=eq.${encodeURIComponent(email.trim().toLowerCase())}`

  // Try updating last_seen_at + last_active_at
  let res = await fetch(`${url}/rest/v1/profiles?${filter}`, {
    method: 'PATCH',
    headers: {
      ...getAuthHeaders(key),
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      last_seen_at: nowIso,
      last_active_at: nowIso,
      updated_at: nowIso,
    }),
  })

  // If last_seen_at doesn't exist yet, update last_active_at
  if (!res.ok) {
    res = await fetch(`${url}/rest/v1/profiles?${filter}`, {
      method: 'PATCH',
      headers: {
        ...getAuthHeaders(key),
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        last_active_at: nowIso,
        updated_at: nowIso,
      }),
    })
  }

  return res.ok
}

/**
 * Immediately record customer logout by setting last_seen_at to past so status becomes Offline.
 */
export async function recordCustomerLogout({ cognito_sub, email, session_id }) {
  if (!cognito_sub && !email) return false

  // Deregister this specific device session
  if (cognito_sub) removeCustomerSession(cognito_sub, session_id)
  if (email) removeCustomerSession(email, session_id)

  // MULTIPLE SESSIONS: If customer still has another active device/tab session, do NOT mark customer offline!
  const hasOtherSession =
    hasOtherActiveSessions(cognito_sub, session_id) ||
    hasOtherActiveSessions(email, session_id)

  if (hasOtherSession) {
    return true
  }

  const { url, key } = getSupabaseConfig()
  // Backdate last_seen_at beyond the online window so status becomes Offline immediately
  const pastIso = new Date(Date.now() - (ACTIVITY_ONLINE_THRESHOLD_MS + 60 * 1000)).toISOString()
  const filter = cognito_sub
    ? `user_id=eq.${encodeURIComponent(cognito_sub)}`
    : `email=eq.${encodeURIComponent(email.trim().toLowerCase())}`

  const res = await fetch(`${url}/rest/v1/profiles?${filter}`, {
    method: 'PATCH',
    headers: {
      ...getAuthHeaders(key),
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      last_seen_at: pastIso,
      updated_at: new Date().toISOString(),
    }),
  }).catch(() => null)

  return Boolean(res && res.ok)
}

// ── Server-side customer list and summary ─────────────────────────────────────────────────────────
// Filtering, search, sorting, pagination and counts run in Postgres (PostgREST), so an admin page view
// downloads one page of rows plus count-only responses, never the whole profiles table. The rules mirror
// formatCustomerRecord / computeActivityStatus / isTestCustomer. Filters are built as a small tree
// ({and|or: [...]}, {not: node}, [column, op, value]) and rendered to PostgREST syntax; every comparison on
// a nullable column is null-safe so negations (Active / Inactive) never drop rows through SQL NULL logic.

export const CUSTOMER_PAGE_SIZE_MAX = 100

/** Escape LIKE metacharacters so user input matches literally (PostgREST maps `*` to `%`). */
const likeLiteral = (value) => String(value).replace(/[\\%_]/g, (c) => '\\' + c)
const notNullAndGte = (col, iso) => ({ and: [[col, 'notnull'], [col, 'gte', iso]] })

/** isTestCustomer() as a filter. */
export const TEST_ACCOUNT_FILTER = {
  or: [
    ['user_id', 'like', 'cust\\_wallet\\_*'],
    ['user_id', 'like', 'test-new-sub-*'],
    ['user_id', 'like', 'sub-test-*'],
    ['user_id', 'like', 'test\\_user\\_*'],
    ['user_id', 'like', 'idem\\_*'],
    ['user_id', 'like', 'iso\\_*'],
    { and: [['email', 'ilike', '*@test.ai'], { or: [['user_id', 'like', 'cust\\_*'], ['user_id', 'like', 'idem\\_*'], ['user_id', 'like', 'iso\\_*']] }] },
    { and: [['email', 'ilike', '*@example.com'], { or: [['user_id', 'like', 'test*'], ['email', 'ilike', 'test\\_user\\_*']] }] },
  ],
}

const CUSTOMERS_ONLY = { and: [['role', 'neq', 'admin'], ['user_id', 'neq', 'usr_admin']] }

/** Customer keys with a live session on this server (memory registry + SQLite), as matched by isCustomerOnlineSession. */
export function listOnlineCustomerKeys(nowMs = Date.now()) {
  const ids = new Set()
  const emails = new Set()
  const add = (key) => {
    if (!key) return
    const clean = String(key).trim().toLowerCase()
    if (clean) (clean.includes('@') ? emails : ids).add(clean)
  }
  for (const [key, sessions] of activeCustomerSessions.entries()) {
    for (const lastSeen of sessions.values()) {
      if (nowMs - lastSeen <= ACTIVITY_ONLINE_THRESHOLD_MS) {
        add(key)
        break
      }
    }
  }
  for (const row of listOnlineSessionKeysDb(ACTIVITY_ONLINE_THRESHOLD_MS)) {
    add(row.cognito_sub)
    add(row.email)
  }
  return { ids: [...ids], emails: [...emails] }
}

function onlineFilter(nowMs, presence) {
  const cutoff = new Date(nowMs - ACTIVITY_ONLINE_THRESHOLD_MS).toISOString()
  const live = [
    ...(presence.ids.length ? [['user_id', 'in', presence.ids]] : []),
    ...presence.emails.map((email) => ['email', 'ilike', likeLiteral(email)]), // case-insensitive equality
  ]
  return {
    or: [
      // Heartbeat presence counts only for customers with genuine activity (formatCustomerRecord).
      { and: [notNullAndGte('last_seen_at', cutoff), { or: [['last_active_at', 'notnull'], ['last_login_at', 'notnull']] }] },
      { and: [['last_seen_at', 'null'], notNullAndGte('last_active_at', cutoff)] },
      ...live,
    ],
  }
}

/** Activity status filter: 'online' | 'active' | 'inactive' | 'suspended' (anything else: no filter). */
export function activityStatusFilter(status, nowMs, presence) {
  const target = String(status || '').toLowerCase()
  if (target === 'suspended') return ['status', 'eq', 'suspended']
  const notSuspended = ['status', 'neq', 'suspended']
  const online = onlineFilter(nowMs, presence)
  if (target === 'online') return { and: [notSuspended, online] }
  const activeCutoff = new Date(nowMs - ACTIVITY_ACTIVE_THRESHOLD_MS).toISOString()
  const recent = { or: [notNullAndGte('last_active_at', activeCutoff), notNullAndGte('last_login_at', activeCutoff)] }
  if (target === 'active') return { and: [notSuspended, { not: online }, recent] }
  if (target === 'inactive') return { and: [notSuspended, { not: online }, { not: recent }] }
  return null
}

function accountTypeFilter(accountType) {
  if (accountType === 'real') return { not: TEST_ACCOUNT_FILTER }
  if (accountType === 'test') return TEST_ACCOUNT_FILTER
  return null
}

/** Same matches as the former in-memory search: name, email, Cognito sub, organization, customer id (`cst_` + 16 chars of sub). */
export function customerSearchFilter(search) {
  const q = String(search || '').trim().toLowerCase().replace(/\*/g, '')
  if (!q) return null
  if ('cst_'.includes(q)) return null // every customer id contains it
  const contains = `*${likeLiteral(q)}*`
  const anyOf = [['full_name', 'ilike', contains], ['email', 'ilike', contains], ['user_id', 'ilike', contains], ['organization', 'ilike', contains]]
  for (const prefix of ['cst_', 'st_', 't_', '_']) {
    const rest = q.slice(prefix.length)
    if (q.startsWith(prefix) && rest.length <= 16) anyOf.push(['user_id', 'ilike', `${likeLiteral(rest)}*`])
  }
  return { or: anyOf }
}

export function buildCustomerFilter({ search = '', status = 'all', accountType = 'all', nowMs = Date.now(), presence = { ids: [], emails: [] } } = {}) {
  return {
    and: [CUSTOMERS_ONLY, accountTypeFilter(accountType), customerSearchFilter(search), activityStatusFilter(status, nowMs, presence)].filter(Boolean),
  }
}

/** Render a filter tree in PostgREST logic-tree syntax. String values are always double-quoted. */
export function renderPostgrestFilter(node) {
  const quote = (v) => `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  if (Array.isArray(node)) {
    const [col, op, value] = node
    if (op === 'null') return `${col}.is.null`
    if (op === 'notnull') return `${col}.not.is.null`
    if (op === 'in') return `${col}.in.(${value.map(quote).join(',')})`
    return `${col}.${op}.${quote(value)}`
  }
  if (node.not) return `not.${renderPostgrestFilter(node.not)}`
  const kind = node.and ? 'and' : 'or'
  return `${kind}(${node[kind].map(renderPostgrestFilter).join(',')})`
}

const SORT_COLUMNS = { registration_date: 'created_at', last_active: 'last_active_at', last_seen: 'last_active_at', last_login: 'last_login_at', full_name: 'full_name' }

export function customerOrder(sortBy, sortOrder) {
  const col = SORT_COLUMNS[sortBy] || 'created_at'
  const asc = String(sortOrder || '').toLowerCase() === 'asc'
  // Missing timestamps sort as the oldest (former behaviour); user_id keeps paging stable on ties.
  const nulls = col === 'full_name' ? '' : asc ? '.nullsfirst' : '.nullslast'
  return `${col}.${asc ? 'asc' : 'desc'}${nulls},user_id.asc`
}

/** Query string for /rest/v1/profiles with the filter as the top-level `and=(...)` parameter. */
export function profilesQuery(filter, extra = {}) {
  const params = new URLSearchParams(extra)
  params.set('and', renderPostgrestFilter(filter).slice('and'.length))
  return params
}

function totalFromContentRange(header) {
  const match = /\/(\d+)$/.exec(String(header || ''))
  return match ? Number(match[1]) : 0
}

async function countProfiles(filter) {
  const { url, key } = getSupabaseConfig()
  const params = profilesQuery(filter, { select: 'user_id' })
  const res = await fetch(`${url}/rest/v1/profiles?${params}`, {
    method: 'HEAD',
    headers: { ...getAuthHeaders(key), Prefer: 'count=exact' },
  })
  if (!res.ok) throw new Error(`Failed to count customers: HTTP ${res.status}`)
  return totalFromContentRange(res.headers.get('content-range'))
}

/** One page of profiles matching `filter`, with the exact total from Content-Range (HTTP 416: offset past the end). */
async function fetchProfilesPage(filter, order, pageSize, pageNumber) {
  const { url, key } = getSupabaseConfig()
  const params = profilesQuery(filter, {
    select: '*',
    order,
    limit: String(pageSize),
    offset: String((pageNumber - 1) * pageSize),
  })
  const res = await fetch(`${url}/rest/v1/profiles?${params}`, {
    headers: { ...getAuthHeaders(key), Prefer: 'count=exact' },
  })
  const total = totalFromContentRange(res.headers.get('content-range'))
  if (res.status === 416) return { rows: [], total }
  if (!res.ok) throw new Error(`Failed to list customers: HTTP ${res.status}`)
  return { rows: await res.json(), total }
}

/**
 * Fetch dynamic summary metrics for Super Admin dashboard cards: count-only queries, no profile rows.
 */
export async function getCustomerSummary({ accountType = 'all' } = {}) {
  const nowMs = Date.now()
  const presence = listOnlineCustomerKeys(nowMs)
  const scope = (status) => buildCustomerFilter({ accountType, status, nowMs, presence })
  const [total, total_real, online, active, suspended] = await Promise.all([
    countProfiles(buildCustomerFilter()),
    countProfiles(buildCustomerFilter({ accountType: 'real' })),
    countProfiles(scope('online')),
    countProfiles(scope('active')),
    countProfiles(scope('suspended')),
  ])
  const total_test = total - total_real
  const active_count = accountType === 'real' ? total_real : accountType === 'test' ? total_test : total
  return {
    total,
    total_real,
    total_test,
    active_count,
    online,
    active,
    inactive: Math.max(0, active_count - online - active - suspended), // the four statuses partition the scope
    suspended,
    onlineTrackingAvailable: true, // heartbeats write profiles.last_seen_at
  }
}

/**
 * Fetch one page of filtered, sorted customer records for the Admin table (one query: rows + exact total).
 */
export async function listCustomers({
  search = '',
  status = 'all',
  sortBy = 'registration_date',
  sortOrder = 'desc',
  page = 1,
  limit = 20,
  accountType = 'all',
} = {}) {
  const pageSize = Math.min(CUSTOMER_PAGE_SIZE_MAX, Math.max(1, Number.parseInt(limit, 10) || 20))
  const requestedPage = Math.max(1, Number.parseInt(page, 10) || 1)
  const nowMs = Date.now()
  const filter = buildCustomerFilter({ search, status, accountType, nowMs, presence: listOnlineCustomerKeys(nowMs) })
  const order = customerOrder(sortBy, sortOrder)
  const fetchPage = (pageNumber) => fetchProfilesPage(filter, order, pageSize, pageNumber)

  let currentPage = requestedPage
  let { rows, total } = await fetchPage(currentPage)
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  if (currentPage > totalPages) {
    // Out-of-range page (e.g. the list shrank): serve the last page, as before.
    currentPage = totalPages
    if (total > 0) ({ rows, total } = await fetchPage(currentPage))
  }

  return {
    ok: true,
    customers: rows.map(formatCustomerRecord),
    pagination: {
      total,
      page: currentPage,
      limit: pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
  }
}

/**
 * Fetch detailed customer profile for the detail drawer.
 */
export async function getCustomerDetails(idOrSub) {
  if (!idOrSub) return null

  const { url, key } = getSupabaseConfig()
  // Clean prefix if passed as cst_...
  const rawSub = idOrSub.startsWith('cst_') ? idOrSub.slice(4) : idOrSub

  const res = await fetch(
    `${url}/rest/v1/profiles?or=(user_id.eq.${encodeURIComponent(idOrSub)},user_id.like.${encodeURIComponent(rawSub)}*,email.eq.${encodeURIComponent(idOrSub)})&select=*`,
    {
      headers: getAuthHeaders(key),
    }
  )

  if (!res.ok) return null
  const rows = await res.json()
  if (!Array.isArray(rows) || rows.length === 0) return null

  const customer = formatCustomerRecord(rows[0])
  return {
    ...customer,
    login_count: customer.login_count,
    previous_logins: customer.last_login_at ? [customer.last_login_at] : [],
    activity_logs: [
      {
        id: `act_${customer.cognito_sub.slice(0, 8)}_reg`,
        customer_id: customer.customer_id,
        event_type: 'registration',
        event_timestamp: customer.registration_date,
        metadata: { source: 'AWS Cognito Central Directory' },
      },
      ...(customer.last_login_at
        ? [
            {
              id: `act_${customer.cognito_sub.slice(0, 8)}_login`,
              customer_id: customer.customer_id,
              event_type: 'login',
              event_timestamp: customer.last_login_at,
              metadata: { client: 'Inferxe Web Client' },
            },
          ]
        : []),
    ],
  }
}

/**
 * Export all customer records as an RFC 4180 CSV string directly from Supabase.
 */
/** Every customer matching the account type, fetched in pages of `chunk` rows (filters still run in the database). */
export async function listAllCustomers({ accountType = 'all', chunk = 1000 } = {}) {
  const filter = buildCustomerFilter({ accountType, presence: listOnlineCustomerKeys() })
  const order = customerOrder('registration_date', 'desc')
  const rows = []
  for (let pageNumber = 1; ; pageNumber++) {
    const { rows: batch, total } = await fetchProfilesPage(filter, order, chunk, pageNumber)
    rows.push(...batch)
    if (batch.length < chunk || rows.length >= total) break
  }
  return rows.map(formatCustomerRecord)
}

export async function exportCustomersToCsv({ accountType = 'all' } = {}) {
  const customers = await listAllCustomers({ accountType })
  const headers = [
    'Customer ID',
    'Cognito Sub',
    'Full Name',
    'Email',
    'Phone Number',
    'Organization',
    'Role',
    'Account Type',
    'Registration Date',
    'Last Login',
    'Last Active',
    'Account Status',
    'Activity Status',
    'Login Count',
  ]

  const escapeCsv = (val) => {
    if (val === null || val === undefined) return ''
    const str = String(val)
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`
    }
    return str
  }

  const rows = [headers.join(',')]
  for (const c of customers) {
    rows.push(
      [
        escapeCsv(c.customer_id),
        escapeCsv(c.cognito_sub),
        escapeCsv(c.full_name),
        escapeCsv(c.email),
        escapeCsv(c.phone_number),
        escapeCsv(c.organization),
        escapeCsv(c.role),
        escapeCsv(c.is_test_account ? 'Test Account' : 'Real Customer'),
        escapeCsv(c.registration_date),
        escapeCsv(c.last_login_at),
        escapeCsv(c.last_active_at),
        escapeCsv(c.account_status),
        escapeCsv(c.activity_status),
        escapeCsv(c.login_count),
      ].join(',')
    )
  }

  return rows.join('\r\n')
}
