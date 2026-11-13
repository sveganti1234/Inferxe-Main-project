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
import {
  recordSessionHeartbeat,
  removeSession,
  hasOtherActiveSessionsDb,
  cleanExpiredSessionsDb,
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
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('Supabase configuration missing (SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY).')
  }
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

/**
 * Check foreign-key dependencies across known Supabase tables before modifying an existing user_id.
 * Returns an object of { [tableName]: count } for any dependent records found.
 */
export async function checkForeignKeyDependencies(userId) {
  if (!userId) return {}
  const { url, key } = getSupabaseConfig()
  const tables = [
    'organization_members',
    'chat_history',
    'api_keys',
    'ssh_public_keys',
    'notebook_sessions',
    'wallet_accounts',
    'document_metadata',
  ]
  const references = {}
  for (const table of tables) {
    try {
      const res = await fetch(
        `${url}/rest/v1/${table}?user_id=eq.${encodeURIComponent(userId)}&select=user_id&limit=1`,
        { headers: getAuthHeaders(key) },
      )
      if (res.ok) {
        const rows = await res.json()
        if (Array.isArray(rows) && rows.length > 0) {
          references[table] = rows.length
        }
      }
    } catch {
      // Table might not exist or column might differ, ignore gracefully
    }
  }
  return references
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
  try {
    const lookupRes = await fetch(`${url}/rest/v1/profiles?user_id=eq.${encodeURIComponent(cognito_sub)}&select=*`, {
      headers: getAuthHeaders(key),
    })
    if (lookupRes.ok) {
      const rows = await lookupRes.json()
      if (Array.isArray(rows) && rows.length > 0) {
        existingProfile = rows[0]
      }
    }
  } catch (err) {
    console.warn('[supabaseCustomerService] Lookup warning by user_id:', err.message)
  }

  // 2. If not found by user_id, check by email to resolve previously registered / seeded customers
  if (!existingProfile) {
    try {
      const emailLookupRes = await fetch(`${url}/rest/v1/profiles?email=eq.${encodeURIComponent(cleanEmail)}&select=*`, {
        headers: getAuthHeaders(key),
      })
      if (emailLookupRes.ok) {
        const rows = await emailLookupRes.json()
        if (Array.isArray(rows) && rows.length > 0) {
          const profileByEmail = rows[0]
          const oldUserId = profileByEmail.user_id

          if (oldUserId && oldUserId !== cognito_sub) {
            // Check foreign-key dependencies before changing user_id
            const foreignDeps = await checkForeignKeyDependencies(oldUserId)
            if (Object.keys(foreignDeps).length > 0) {
              console.log(`[supabaseCustomerService] Cascading foreign keys for user ${oldUserId}:`, foreignDeps)
              for (const depTable of Object.keys(foreignDeps)) {
                try {
                  await fetch(`${url}/rest/v1/${depTable}?user_id=eq.${encodeURIComponent(oldUserId)}`, {
                    method: 'PATCH',
                    headers: getAuthHeaders(key),
                    body: JSON.stringify({ user_id: cognito_sub }),
                  })
                } catch (cascadeErr) {
                  console.warn(`[supabaseCustomerService] Cascade error on ${depTable}:`, cascadeErr.message)
                }
              }
            }

            // Safely update the profile user_id to match the new Cognito sub
            try {
              await fetch(`${url}/rest/v1/profiles?user_id=eq.${encodeURIComponent(oldUserId)}`, {
                method: 'PATCH',
                headers: getAuthHeaders(key),
                body: JSON.stringify({ user_id: cognito_sub }),
              })
              profileByEmail.user_id = cognito_sub
            } catch (updateIdErr) {
              console.warn('[supabaseCustomerService] Profile user_id update error:', updateIdErr.message)
            }
          }
          existingProfile = profileByEmail
        }
      }
    } catch (err) {
      console.warn('[supabaseCustomerService] Lookup warning by email:', err.message)
    }
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

  // Full extended payload
  const extendedPayload = {
    user_id: cognito_sub,
    full_name: cleanFullName,
    email: cleanEmail,
    username,
    role: existingProfile?.role || 'customer',
    status: existingProfile?.status === 'suspended' ? 'suspended' : 'active',
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
    status: existingProfile?.status === 'suspended' ? 'suspended' : 'active',
    auth_provider: 'cognito',
    last_active_at: isLogin ? nowIso : (existingProfile?.last_active_at || null),
    updated_at: nowIso,
  }

  let res
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

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Failed to upsert Supabase profile: HTTP ${res.status} - ${text}`)
  }

  const data = await res.json().catch(() => [extendedPayload])
  const savedRow = Array.isArray(data) && data.length > 0 ? data[0] : extendedPayload
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

/**
 * Fetch dynamic summary metrics for Super Admin dashboard cards.
 */
export async function getCustomerSummary({ accountType = 'all' } = {}) {
  const { url, key } = getSupabaseConfig()
  const res = await fetch(`${url}/rest/v1/profiles?select=*`, {
    headers: getAuthHeaders(key),
  })

  if (!res.ok) {
    throw new Error(`Failed to fetch customer summary: HTTP ${res.status}`)
  }

  const profiles = await res.json()
  // Exclude internal Superadmin from all customer calculations
  const customerRows = profiles.filter((p) => p.role !== 'admin' && p.user_id !== 'usr_admin')

  const total = customerRows.length
  const total_real = customerRows.filter((r) => !isTestCustomer(r)).length
  const total_test = customerRows.filter((r) => isTestCustomer(r)).length

  let filteredRows = customerRows
  if (accountType === 'real') {
    filteredRows = customerRows.filter((r) => !isTestCustomer(r))
  } else if (accountType === 'test') {
    filteredRows = customerRows.filter((r) => isTestCustomer(r))
  }

  let online = 0
  let active = 0
  let inactive = 0
  let suspended = 0

  for (const row of filteredRows) {
    const isOnlineInMem = isCustomerOnlineSession(row.user_id) || isCustomerOnlineSession(row.email)
    const lastSeen = isOnlineInMem
      ? new Date().toISOString()
      : (row.last_seen_at && (row.last_active_at || row.last_login_at) ? row.last_seen_at : null)
    const lastActive = row.last_active_at || null
    const lastLogin = row.last_login_at || null
    const status = computeActivityStatus({
      ...row,
      last_active_at: lastActive,
      last_login_at: lastLogin,
      last_seen_at: lastSeen,
    })
    if (status === 'Suspended' || row.status === 'suspended') {
      suspended++
    } else if (status === 'Online') {
      online++
    } else if (status === 'Active') {
      active++
    } else {
      inactive++
    }
  }

  return {
    total,
    total_real,
    total_test,
    active_count: filteredRows.length,
    online,
    active,
    inactive,
    suspended,
  }
}

/**
 * Fetch paginated, filtered, and sorted customer records for the Admin table.
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
  const { url, key } = getSupabaseConfig()
  const res = await fetch(`${url}/rest/v1/profiles?select=*`, {
    headers: getAuthHeaders(key),
  })

  if (!res.ok) {
    throw new Error(`Failed to list customers: HTTP ${res.status}`)
  }

  const profiles = await res.json()
  // Exclude Superadmin from customer list
  let records = profiles
    .filter((p) => p.role !== 'admin' && p.user_id !== 'usr_admin')
    .map(formatCustomerRecord)

  // 1. Account type filter (real / test / all)
  if (accountType === 'real') {
    records = records.filter((c) => !c.is_test_account)
  } else if (accountType === 'test') {
    records = records.filter((c) => c.is_test_account)
  }

  // 2. Search filter
  if (search && search.trim()) {
    const q = search.trim().toLowerCase()
    records = records.filter(
      (c) =>
        c.full_name.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        c.cognito_sub.toLowerCase().includes(q) ||
        c.customer_id.toLowerCase().includes(q) ||
        (c.organization && c.organization.toLowerCase().includes(q))
    )
  }

  // 3. Activity / Account Status filter
  if (status && status !== 'all') {
    const target = status.toLowerCase()
    records = records.filter((c) => {
      if (target === 'online') return c.activity_status === 'Online'
      if (target === 'active') return c.activity_status === 'Active'
      if (target === 'inactive') return c.activity_status === 'Inactive'
      if (target === 'suspended') return c.account_status === 'suspended'
      return true
    })
  }

  // 4. Sorting
  const isAsc = sortOrder.toLowerCase() === 'asc'
  records.sort((a, b) => {
    let valA = a.registration_date
    let valB = b.registration_date

    if (sortBy === 'last_active' || sortBy === 'last_seen') {
      valA = a.last_active_at || ''
      valB = b.last_active_at || ''
    } else if (sortBy === 'last_login') {
      valA = a.last_login_at || ''
      valB = b.last_login_at || ''
    } else if (sortBy === 'full_name') {
      valA = a.full_name.toLowerCase()
      valB = b.full_name.toLowerCase()
      return isAsc ? valA.localeCompare(valB) : valB.localeCompare(valA)
    }

    const timeA = new Date(valA).getTime() || 0
    const timeB = new Date(valB).getTime() || 0
    return isAsc ? timeA - timeB : timeB - timeA
  })

  // 5. Pagination
  const total = records.length
  const totalPages = Math.max(1, Math.ceil(total / limit))
  const currentPage = Math.max(1, Math.min(page, totalPages))
  const offset = (currentPage - 1) * limit
  const paginated = records.slice(offset, offset + limit)

  return {
    ok: true,
    customers: paginated,
    pagination: {
      total,
      page: currentPage,
      limit,
      totalPages,
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
export async function exportCustomersToCsv({ accountType = 'all' } = {}) {
  const { customers } = await listCustomers({ limit: 10000, page: 1, accountType })
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
