import { updatePassword, signOut, fetchAuthSession } from 'aws-amplify/auth'

export type PortalRole = 'customer' | 'admin' | 'superadmin'
export type UserRole = 'customer' | 'provider' | 'admin' | 'superadmin' | 'super_admin' | 'developer' | 'viewer'

export interface AuthSession {
  token: string
  user: {
    id: string
    fullName: string
    email: string
    username: string
    role: string
    organization?: string
    permissions?: string[]
  }
  expiresAt: number
}

const AUTH_STORAGE_KEY = 'inferxe_auth_session'

/* ── JWT helpers (client-side claims check only; the backend must verify signatures) ── */
export interface JwtClaims {
  sub?: string
  email?: string
  exp?: number
  iat?: number
  name?: string
  'cognito:username'?: string
  'cognito:groups'?: string[]
  [key: string]: unknown
}

export function decodeJwt(token: string): JwtClaims | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const json = decodeURIComponent(
      atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
        .split('')
        .map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
        .join(''),
    )
    return JSON.parse(json) as JwtClaims
  } catch {
    return null
  }
}

export function isJwtExpired(token: string, skewSeconds = 30): boolean {
  const claims = decodeJwt(token)
  if (!claims?.exp) return false
  return Date.now() / 1000 >= claims.exp - skewSeconds
}

/* ── AWS Cognito app client (sign-in, sign-up and refresh go through Amplify, SRP) ──
   Used here only for client-side token plausibility checks. */
const COGNITO_REGION = (import.meta.env.VITE_COGNITO_REGION as string | undefined) || 'ap-south-1'
const COGNITO_CLIENT_ID =
  (import.meta.env.VITE_COGNITO_CLIENT_ID as string | undefined) || '334trhnhmim8v42gq4bgk7umst'


/* ── Client-side session plausibility checks ──
   These checks only screen out legacy fake sessions (e.g. `ix-customer-*`) and tokens that
   were obviously not issued for this app. They do NOT verify signatures: every backend
   service remains the authority on whether a token is genuine. */
const COGNITO_USER_POOL_ID =
  (import.meta.env.VITE_COGNITO_USER_POOL_ID as string | undefined) ||
  (import.meta.env.VITE_COGNITO_AUTHORITY as string | undefined)?.split('/').pop() ||
  'ap-south-1_cYw1QjgbQ'
// A Cognito user pool id is prefixed with its region (e.g. "ap-south-1_abc123").
const COGNITO_POOL_REGION = COGNITO_USER_POOL_ID.split('_')[0] || COGNITO_REGION
const COGNITO_ISSUER = `https://cognito-idp.${COGNITO_POOL_REGION}.amazonaws.com/${COGNITO_USER_POOL_ID}`

/** Tokens minted by the removed client-side fallbacks. Never a real credential. */
export function isLegacyFakeToken(token: string | null | undefined): boolean {
  const value = (token || '').trim()
  return value.startsWith('ix-') || value === 'admin-dev-token'
}

/**
 * True when the token decodes to a Cognito ID token for this user pool and app client
 * (issuer, audience, token_use and subject). Expiry is checked separately by callers.
 */
export function isPlausibleCognitoIdToken(token: string | null | undefined): boolean {
  if (!token || isLegacyFakeToken(token)) return false
  const claims = decodeJwt(token)
  if (!claims) return false
  return (
    claims.token_use === 'id' &&
    claims.iss === COGNITO_ISSUER &&
    claims.aud === COGNITO_CLIENT_ID &&
    typeof claims.sub === 'string' &&
    claims.sub.length > 0
  )
}

/** True when the token decodes to an administrator session token issued by the admin auth server. */
function isPlausibleAdminSessionToken(token: string | null | undefined): boolean {
  if (!token || isLegacyFakeToken(token)) return false
  const claims = decodeJwt(token)
  return Boolean(claims && (claims.role === 'admin' || claims.role === 'superadmin') && typeof claims.exp === 'number')
}

/** Structural check for a stored session; customer sessions must carry a Cognito ID token. */
export function isPlausibleSession(session: AuthSession | null | undefined): session is AuthSession {
  if (!session || typeof session !== 'object' || typeof session.token !== 'string' || !session.user) return false
  if (isLegacyFakeToken(session.token)) return false
  return isAdminPortalRole(session.user.role)
    ? isPlausibleAdminSessionToken(session.token)
    : isPlausibleCognitoIdToken(session.token)
}


export interface CustomerProfile {
  id: string
  fullName: string
  email: string
  username: string
  role: UserRole
  status: string
  organization?: string | null
  organizationId: string | null
}

export async function syncCustomerProfile(
  idToken: string,
  extraProfile?: { organization?: string },
): Promise<CustomerProfile> {
  const payload =
    extraProfile && typeof extraProfile.organization === 'string' && extraProfile.organization.trim()
      ? { organization: extraProfile.organization.trim() }
      : {}
  let message = 'Your customer profile could not be synchronized. Please try again.'
  try {
    const response = await fetch('/api/customer/profile/sync', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${idToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    })
    const result = await response.json().catch(() => ({}))
    if (response.ok && result.ok && result.profile) {
      return result.profile as CustomerProfile
    }
    if (typeof result.error === 'string' && result.error) message = result.error
  } catch (err) {
    console.warn('[customer-auth] Profile sync request failed:', (err as { name?: string })?.name || 'Error')
  }

  // No profile from the server means no sign-in: never build one from token claims, and drop the Cognito
  // tokens so nothing is left that looks like a customer session.
  await signOutCurrentUser()
  throw Object.assign(new Error(message), { name: 'ProfileSyncError' })
}

export function getPortalRole(role?: string): PortalRole {
  if (!role) return 'customer'
  const r = role.toLowerCase().trim()
  if (r === 'superadmin' || r === 'super_admin') return 'superadmin'
  if (r === 'admin') return 'admin'
  return 'customer'
}

/** Administrator portal roles (admin and superadmin) share the admin session handling. */
export function isAdminPortalRole(role?: string): boolean {
  return getPortalRole(role) !== 'customer'
}

/**
 * Check whether a token is a development bypass token (ix-*) that should not be accepted
 * in live authenticated flows.
 */
export function isDevelopmentBypassToken(token?: string | null): boolean {
  return typeof token === 'string' && (token.trim().startsWith('ix-') || token.trim() === 'admin-dev-token')
}

/**
 * Resolve the authenticated portal role from the active session for client-side UI rendering.
 * Prefers the signed JWT `role` claim (for backend-issued HS256/Argon2id Admin/Superadmin tokens)
 * and falls back to `session.user.role`, never trusting UI display names or dev preview toggles.
 *
 * SECURITY NOTICE:
 * Client-side decoded JWT claims and local session records are strictly NON-AUTHORITATIVE
 * optimistic hints for UI presentation (badges, layout controls, navigation menus).
 * Access control and Super Admin privilege authorization MUST always depend on successful
 * server-side DB-backed session & role verification via `verifyAdminSessionWithDetails()`.
 */
export function getAuthenticatedPortalRole(session: AuthSession | null = getSession()): PortalRole {
  if (!session) return 'customer'
  if (session.token && !isDevelopmentBypassToken(session.token)) {
    const claims = decodeJwt(session.token)
    if (claims && typeof claims.role === 'string' && claims.role.trim()) {
      return getPortalRole(claims.role)
    }
  }
  return getPortalRole(session.user?.role)
}

/* ── Session storage ──
   `inferxe_auth_session` is the single application session record. It is created only by an
   explicit sign-in (Cognito or the admin auth server) and refreshed only through Amplify
   (`ensureFreshSession`). Leftover Amplify tokens never recreate a session on their own. */

/** Seconds before expiry at which a customer ID token is proactively refreshed. */
const REFRESH_SKEW_SECONDS = 60

function emitAuthChange(): void {
  try {
    window.dispatchEvent(new Event('inferxe_auth_change'))
  } catch {
    // ignore (non-browser environment)
  }
}

/** Remove only the Inferxe session record. */
function removeSessionRecord(): void {
  try {
    localStorage.removeItem(AUTH_STORAGE_KEY)
  } catch {
    // ignore
  }
  emitAuthChange()
}

/** Read the stored session if it is structurally plausible (expired or not). Invalid records are removed. */
function readStoredSession(): AuthSession | null {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(AUTH_STORAGE_KEY)
  } catch {
    return null
  }
  if (!raw) return null
  let stored: AuthSession | null = null
  try {
    stored = JSON.parse(raw) as AuthSession
  } catch {
    stored = null
  }
  if (!isPlausibleSession(stored)) {
    // Legacy fake (`ix-*`) or malformed session: remove only the Inferxe session record.
    removeSessionRecord()
    return null
  }
  return stored
}

function isSessionExpired(session: AuthSession, skewSeconds = 0): boolean {
  if (session.expiresAt && Date.now() > session.expiresAt - skewSeconds * 1000) return true
  return isJwtExpired(session.token, skewSeconds)
}

/**
 * Synchronous view of the current session: the stored record, only while its token is unexpired.
 * An expired customer record is kept (not returned) so `ensureFreshSession` can refresh it
 * through Amplify; an expired administrator record is removed (admin tokens cannot be refreshed).
 */
export function getSession(): AuthSession | null {
  const session = readStoredSession()
  if (!session) return null
  if (isSessionExpired(session)) {
    if (isAdminPortalRole(session.user.role)) removeSessionRecord()
    return null
  }
  return session
}

/** The current session's token (customers: a Cognito ID token; never an access token). */
export function getCognitoTokenFromStorage(): string | null {
  return getSession()?.token ?? null
}

export function saveSession(session: AuthSession): void {
  try {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session))
    emitAuthChange()
  } catch (err) {
    console.error('Failed to save auth session', err)
  }
}

/** Remove the Inferxe session record only. Use `signOutCurrentUser()` for a user-initiated sign-out. */
export function clearSession(): void {
  removeSessionRecord()
  clearAdminAuthCaches()
}

function isNetworkError(err: unknown): boolean {
  const name = (err as { name?: unknown })?.name
  const message = String((err as { message?: unknown })?.message || '')
  return name === 'NetworkError' || (err instanceof TypeError && /fetch|network/i.test(message))
}

let refreshInFlight: Promise<AuthSession | null> | null = null

/** Ask Amplify for the current Cognito session; Amplify refreshes expired tokens with its refresh token. */
async function refreshStoredCustomerSession(stored: AuthSession): Promise<AuthSession | null> {
  try {
    let tokens = (await fetchAuthSession()).tokens
    let idToken = tokens?.idToken?.toString()
    if (idToken && isJwtExpired(idToken, REFRESH_SKEW_SECONDS)) {
      tokens = (await fetchAuthSession({ forceRefresh: true })).tokens
      idToken = tokens?.idToken?.toString()
    }
    // Only an ID token is acceptable here — an access token is never substituted.
    if (!idToken || !isPlausibleCognitoIdToken(idToken) || isJwtExpired(idToken, 10)) {
      throw Object.assign(new Error('No valid Cognito ID token is available.'), { name: 'NoValidIdToken' })
    }
    // The Amplify session must belong to the same Cognito user as the stored session.
    const freshClaims = decodeJwt(idToken)
    const storedClaims = decodeJwt(stored.token)
    if (!freshClaims?.sub || freshClaims.sub !== storedClaims?.sub) {
      throw Object.assign(new Error('Cognito session belongs to a different user.'), { name: 'SessionUserMismatch' })
    }
    const refreshed: AuthSession = {
      ...stored,
      token: idToken,
      expiresAt: typeof freshClaims.exp === 'number' ? freshClaims.exp * 1000 : stored.expiresAt,
    }
    saveSession(refreshed)
    return refreshed
  } catch (err) {
    // Never log token values: the error name is enough to diagnose.
    const name = (err as { name?: string })?.name || 'Error'
    if (isNetworkError(err)) {
      // Temporary connectivity problem: keep the record so a later attempt can refresh it.
      console.warn('[auth] Cognito session refresh unavailable (network):', name)
      return null
    }
    console.warn('[auth] Cognito session refresh failed; signing out locally:', name)
    removeSessionRecord()
    return null
  }
}

/**
 * Authoritative async session accessor used before every authenticated request and by route guards.
 * - Customer: returns a session whose Cognito ID token is valid, refreshing it through Amplify when
 *   it is expired or about to expire. Concurrent callers share a single refresh.
 * - Administrator: returns the admin session while unexpired (the admin server verifies it).
 */
export function ensureFreshSession(): Promise<AuthSession | null> {
  const stored = readStoredSession()
  if (!stored) return Promise.resolve(null)
  if (isAdminPortalRole(stored.user.role)) return Promise.resolve(getSession())
  if (!isSessionExpired(stored, REFRESH_SKEW_SECONDS)) return Promise.resolve(stored)
  if (!refreshInFlight) {
    refreshInFlight = refreshStoredCustomerSession(stored).finally(() => {
      refreshInFlight = null
    })
  }
  return refreshInFlight
}

/**
 * Refresh the signed-in customer's Cognito ID token through Amplify (shared with ensureFreshSession).
 * Only an existing customer session is refreshed, and only for the same Cognito user: leftover Amplify
 * tokens never create a session on their own. `forceRefresh` is accepted for API compatibility.
 */
export async function refreshCustomerSession(_forceRefresh = false): Promise<AuthSession | null> {
  const stored = readStoredSession()
  if (!stored || isAdminPortalRole(stored.user.role)) return null
  return refreshStoredCustomerSession(stored)
}

/** Remove Amplify's persisted tokens for this app client (used only if Amplify sign-out failed). */
function clearAmplifyTokenStore(): void {
  try {
    const prefix = `CognitoIdentityServiceProvider.${COGNITO_CLIENT_ID}.`
    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && key.startsWith(prefix)) keys.push(key)
    }
    keys.forEach((key) => localStorage.removeItem(key))
  } catch {
    // ignore
  }
}

/**
 * Complete sign-out for the current user. Always ends with no Inferxe session, even if a step fails.
 * - Customers: awaits Amplify `signOut()` (clears Cognito tokens); if it fails, Amplify's stored
 *   tokens for this app client are removed so they cannot be reused.
 * - Administrators: notifies the admin auth server; Cognito sign-out is not involved.
 */
export async function signOutCurrentUser(): Promise<void> {
  const stored = readStoredSession()
  const isAdmin = stored ? isAdminPortalRole(stored.user.role) : false
  // Remove the application session first so nothing looks authenticated while sign-out runs.
  removeSessionRecord()
  clearAdminAuthCaches()
  // Signed-in assistant history is stored under fixed keys (chatStore SCOPE_STORAGE_KEYS; not imported to
  // avoid a circular import), so it must not survive for the next person on this browser.
  try {
    localStorage.removeItem('inferxe_chat_history_customer_v1')
    localStorage.removeItem('inferxe_chat_history_admin_v1')
  } catch {
    // storage unavailable: nothing persisted
  }
  if (isAdmin && stored) {
    try {
      await fetch(`${ADMIN_API_BASE}/logout`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${stored.token}` },
        body: '{}',
      })
    } catch {
      // The admin token is already discarded locally; the server endpoint is best-effort.
    }
    return
  }
  try {
    await signOut()
  } catch (err) {
    console.warn('[auth] Cognito sign-out failed; clearing local Cognito tokens:', (err as { name?: string })?.name || 'Error')
    clearAmplifyTokenStore()
  } finally {
    removeSessionRecord()
  }
}

let signingOutForRedirect = false

/** True while `performSignOut()` is clearing the session and about to replace `window.location`. */
export function isSigningOutRedirect(): boolean {
  return signingOutForRedirect
}

/** Sign out (see signOutCurrentUser) and leave the page with a history replace. */
export async function performSignOut(redirectUrl = '/'): Promise<void> {
  signingOutForRedirect = true
  try {
    await signOutCurrentUser()
    if (typeof window !== 'undefined') window.location.replace(redirectUrl)
  } finally {
    signingOutForRedirect = false
  }
}

const ADMIN_API_BASE =
  (import.meta.env.VITE_ADMIN_AUTH_ENDPOINT as string | undefined)?.replace(/\/$/, '') ||
  '/api/admin'

export const ADMIN_EMAILS = [
  'admin@inferxe.com',
  'alex.chen@inferxe.internal',
  'bhumireddy@inferxe.com',
]

export function isAdministratorEmail(email: string): boolean {
  if (!email) return false
  const clean = email.trim().toLowerCase()
  return (
    ADMIN_EMAILS.includes(clean) ||
    clean.startsWith('admin@') ||
    clean.endsWith('@inferxe.internal')
  )
}

export interface AdminLoginResult {
  ok: boolean
  isAdmin: boolean
  backendError?: boolean
  statusCode?: number
  code?: string
  session?: AuthSession
  error?: string
}

export type AuthUser = AuthSession['user']

export interface AdminVerifyResult {
  valid: boolean
  user?: AuthUser
}

/**
 * Validate submitted credentials against the backend admin authentication endpoint.
 * Credentials are verified exclusively on the server side against Supabase `admin_users`
 * with Argon2 password verification and DB-backed `admin_sessions`.
 */
export async function loginAdminBackend(
  email: string,
  password: string,
): Promise<AdminLoginResult> {
  const cleanEmail = email.trim().toLowerCase()

  try {
    const res = await fetch(`${ADMIN_API_BASE}/login`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ email: cleanEmail, password }),
    })

    const data = await res.json().catch(() => ({}))

    if (data.isAdmin === true) {
      if (res.ok && data.ok && data.token && data.user) {
        const permissions = Array.isArray(data.permissions)
          ? data.permissions
          : (Array.isArray(data.user?.permissions) ? data.user.permissions : undefined)
        const session: AuthSession = {
          token: data.token,
          user: {
            ...data.user,
            permissions,
          },
          expiresAt: data.expiresAt || Date.now() + 12 * 60 * 60 * 1000,
        }
        saveSession(session)
        return { ok: true, isAdmin: true, statusCode: res.status, session }
      }
      if (!res.ok) {
        return {
          ok: false,
          isAdmin: true,
          backendError: res.status >= 500,
          statusCode: res.status,
          code: typeof data.code === 'string' ? data.code : undefined,
          error:
            data.error ||
            (res.status >= 500
              ? 'Administrator authentication service is temporarily unavailable.'
              : 'Incorrect email or password. Please verify your credentials and try again.'),
        }
      }
    }

    if (res.ok && data.isAdmin === false) {
      return { ok: false, isAdmin: false, statusCode: res.status }
    }

    if (!res.ok) {
      const isAdminCandidate = isAdministratorEmail(cleanEmail)
      if (!isAdminCandidate) {
        return { ok: false, isAdmin: false, statusCode: res.status }
      }
      return {
        ok: false,
        isAdmin: true,
        backendError: res.status >= 500 || Boolean(data.backendError),
        statusCode: res.status,
        code: typeof data.code === 'string' ? data.code : undefined,
        error:
          data.error ||
          'Administrator authentication service is currently unavailable. Please check backend configuration.',
      }
    }
  } catch (err) {
    console.error('Admin backend login request failed:', err)
    const isAdminCandidate = isAdministratorEmail(cleanEmail)
    return {
      ok: false,
      isAdmin: isAdminCandidate,
      backendError: isAdminCandidate,
      error: isAdminCandidate ? 'Unable to reach the administrator authentication backend.' : undefined,
    }
  }

  // Not an admin account: the caller continues with customer sign-in. There is deliberately no
  // client-side admin fallback: admin access is granted only by the backend.
  return { ok: false, isAdmin: false }
}

interface AdminVerifyCacheEntry {
  result: AdminVerifyResult
  timestamp: number
}
const adminVerifyCache = new Map<string, AdminVerifyCacheEntry>()
const adminVerifyInFlight = new Map<string, Promise<AdminVerifyResult>>()

/**
 * Check if the provided admin token was authoritatively verified by the backend
 * within the given freshness window (default: 30 seconds).
 */
export function isSessionVerifiedRecently(token?: string | null, maxAgeMs = 30000): boolean {
  if (!token) return false
  const entry = adminVerifyCache.get(token)
  if (!entry) return false
  return Date.now() - entry.timestamp < maxAgeMs && entry.result.valid === true
}

/**
 * Validate an active admin session against the backend database-backed session store
 * and return the authoritative server user record (including role and permissions).
 * Includes automatic in-flight promise deduplication and short TTL caching.
 */
export async function verifyAdminSessionWithDetails(token: string, force = false): Promise<AdminVerifyResult> {
  if (!token || token.startsWith('ix-') || token === 'admin-dev-token') {
    return { valid: false }
  }

  if (!force) {
    const cached = adminVerifyCache.get(token)
    if (cached && Date.now() - cached.timestamp < 30000 && cached.result.valid) {
      return cached.result
    }
    const inFlight = adminVerifyInFlight.get(token)
    if (inFlight) {
      return inFlight
    }
  }

  const fetchPromise = (async (): Promise<AdminVerifyResult> => {
    try {
      const res = await fetch(`${ADMIN_API_BASE}/verify`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ token }),
      })

      if (!res.ok) {
        adminVerifyCache.delete(token)
        return { valid: false }
      }

      const data = await res.json().catch(() => ({}))
      if (!data.ok || !data.valid || !data.user) {
        adminVerifyCache.delete(token)
        return { valid: false }
      }

      const serverUser = data.user as AuthUser
      if (Array.isArray(data.permissions) && !serverUser.permissions) {
        serverUser.permissions = data.permissions
      }

      const currentSession = getSession()
      if (currentSession && currentSession.token === token) {
        if (
          currentSession.user.role !== serverUser.role ||
          currentSession.user.email !== serverUser.email ||
          currentSession.user.id !== serverUser.id ||
          JSON.stringify(currentSession.user.permissions) !== JSON.stringify(serverUser.permissions)
        ) {
          saveSession({
            ...currentSession,
            user: {
              ...currentSession.user,
              ...serverUser,
            },
          })
        }
      }

      const verifyResult: AdminVerifyResult = { valid: true, user: serverUser }
      adminVerifyCache.set(token, { result: verifyResult, timestamp: Date.now() })
      return verifyResult
    } catch {
      adminVerifyCache.delete(token)
      return { valid: false }
    } finally {
      adminVerifyInFlight.delete(token)
    }
  })()

  adminVerifyInFlight.set(token, fetchPromise)
  return fetchPromise
}

/**
 * Check whether the active administrator session has a specific permission.
 * Super Admin accounts always return true. Standard admins evaluate against user.permissions.
 */
export function hasPermission(permissionId: string): boolean {
  const session = getSession()
  if (!session?.user) return false
  const role = String(session.user.role || '').toLowerCase().trim()
  if (role === 'superadmin' || role === 'super_admin') return true
  if (role !== 'admin') return false

  const perms = session.user.permissions
  if (Array.isArray(perms)) {
    return perms.includes(permissionId)
  }

  // Fallback to canonical operational permissions if permissions array not populated
  const adminDefaultPermissions = [
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
  ]
  return adminDefaultPermissions.includes(permissionId)
}

/**
 * Validate an active admin session token with the backend server.
 */
export async function verifyAdminSessionServer(token: string): Promise<boolean> {
  const result = await verifyAdminSessionWithDetails(token, true)
  return result.valid
}

export function getUserPasswordLastUpdated(email: string): string | null {
  try {
    return localStorage.getItem(`inferxe_pwd_updated_${email.trim().toLowerCase()}`)
  } catch {
    return null
  }
}

export async function changeUserPassword(
  email: string,
  currentPassword: string,
  newPassword: string
): Promise<{ ok: boolean; error?: string }> {
  if (!email.trim()) {
    return { ok: false, error: 'Unable to identify the signed-in account.' }
  }

  if (!currentPassword) {
    return { ok: false, error: 'Please enter your current password.' }
  }

  if (!newPassword || newPassword.length < 8) {
    return {
      ok: false,
      error: 'New password must contain at least 8 characters.',
    }
  }

  if (currentPassword === newPassword) {
    return {
      ok: false,
      error: 'New password must be different from your current password.',
    }
  }

  try {
    await updatePassword({
      oldPassword: currentPassword,
      newPassword,
    })

    const key = `inferxe_pwd_updated_${email.trim().toLowerCase()}`
    localStorage.setItem(key, new Date().toISOString())

    return { ok: true }
  } catch (err) {
    console.error('Cognito password update failed:', err)

    const message =
      err instanceof Error
        ? err.message
        : 'Unable to update your password.'

    return { ok: false, error: message }
  }
}

export function emailToCognitoUsername(email: string): string {
  const clean = email.trim().toLowerCase()
  return clean.replace(/@/g, '_at_').replace(/[^a-zA-Z0-9_]/g, '_')
}

export interface SuperadminAdminRecord {
  id: string
  email: string
  full_name: string
  role: 'admin' | 'superadmin'
  is_active?: boolean
  status: 'active' | 'inactive' | 'suspended' | 'pending'
  session_version?: number
  created_at: string
  updated_at?: string | null
  last_login?: string | null
  last_ip?: string
  activity_count?: number
}

export interface SuperadminAuditLog {
  id: string
  admin_id?: string
  admin_email: string
  action: string
  category: string
  target_id?: string
  target_type?: string
  details: Record<string, unknown>
  ip_address?: string
  created_at: string
}

export interface SuperadminSessionRecord {
  id: string
  admin_user_id: string
  admin_email: string
  admin_name?: string
  role: string
  session_version: number
  created_at: string
  expires_at: string
  revoked_at?: string | null
  status: 'active' | 'expired' | 'revoked'
}

export interface SuperadminDashboardOverview {
  unavailableMetrics?: string[]
  adminStats: {
    available?: boolean
    total: number
    active: number
    inactive: number
    superadminCount: number
    standardAdminCount: number
    roleDistribution: {
      superadmin: number
      admin: number
    }
  }
  customerStats: {
    available?: boolean
    total: number
    active: number
    inactive: number
    online: number
    registrations: {
      today: number
      last7Days: number
      last30Days: number
      daily: Array<{ date: string; count: number }>
    }
  }
  activityStats: {
    available?: boolean
    totalActivities: number
    activitiesToday: number
    successfulLogins: number
    failedLogins: number
    recentSessionRevocations: number
    recentActivities: Array<{
      id: string
      action: string
      category: string
      severity: string
      adminName: string
      adminEmail: string
      targetResource: string
      description: string
      timestamp: string
      isoTimestamp: string
      details: Record<string, unknown>
    }>
  }
  securityStats: {
    available?: boolean
    failedLoginAttempts: number
    blockedActions: number
    activeSessions: number
    revokedSessions: number
    recentSecurityEvents: Array<{
      id: string
      action: string
      category: string
      severity: string
      adminName: string
      adminEmail: string
      targetResource: string
      description: string
      ipAddress: string
      timestamp: string
      isoTimestamp: string
      details: Record<string, unknown>
    }>
  }
  platformStats: {
    organizationsAvailable?: boolean
    apiKeysAvailable?: boolean
    totalOrganizations: number
    totalApiKeys: number
    activeApiKeys: number
  }
}

export interface SuperadminGpuCluster {
  id: string
  name: string
  provider: string
  region: string
  status: 'healthy' | 'warning' | 'degraded'
  uptime: string
  totalNodes: number
  activeNodes: number
  gpus: Array<{
    type: string
    total: number
    allocated: number
    vramUsedGb: number
    vramTotalGb: number
    avgTempC: number
    powerW: number
  }>
  spotRateHour: number
  onDemandRateHour: number
  marginPct: number
}

export interface SuperadminTelemetryData {
  isConfigured?: boolean
  message?: string
  clusters: SuperadminGpuCluster[]
  summary: {
    totalGpuCount: number
    allocatedGpuCount: number
    utilizationPct: number
    totalVramGb: number
    usedVramGb: number
    activeClusters: number
    criticalAlerts: number
    averageLatencyMs: number
    globalHealthScore: number
  } | null
}

export interface SuperadminKeyRecord {
  id: string
  user_id?: string
  name: string
  type: 'API Key' | 'SSH Key'
  key_type?: 'api' | 'ssh'
  owner_email: string
  owner_name: string
  role: string
  prefix: string
  environment?: 'live' | 'test'
  ssh_algorithm?: string
  created_at: string
  last_used?: string | null
  expires_at?: string | null
  revoked_at?: string | null
  status: 'active' | 'revoked' | 'expired' | 'inactive'
  fingerprint?: string
  usage_count?: number
  failed_count?: number
  rate_limit?: string
}

export interface SuperadminKeySummary {
  total: number
  api_keys: number
  active_api_keys: number
  revoked_api_keys: number
  ssh_keys: number
}

export interface AdminKeyMonitoringSummary extends SuperadminKeySummary {
  expired_api_keys: number
  total_requests: number
  failed_requests: number
  error_rate_pct: number
  active_keys_used_24h: number
  security_alerts_count: number
  high_severity_alerts: number
}

export interface AdminKeySecurityAlert {
  id: string
  severity: 'high' | 'medium' | 'low'
  type: string
  title: string
  detail: string
  key_id: string
  key_name: string
  owner_email: string
  detected_at: string
}

export interface AdminKeyAuditRecord {
  id: string
  action: string
  actor_email: string
  target_id: string
  target_type: string
  key_name?: string | null
  owner_email?: string | null
  reason?: string | null
  revocation_mode?: string | null
  created_at: string
  source: string
}

export interface AdminKeyMonitoringData {
  read_only: boolean
  actor_role?: PortalRole
  keys: SuperadminKeyRecord[]
  summary: AdminKeyMonitoringSummary
  alerts: AdminKeySecurityAlert[]
  audit_records: AdminKeyAuditRecord[]
}

function getSuperadminAuthHeaders(): HeadersInit {
  const session = getSession()
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
  }
}

// ── In-Memory Caches & In-Flight Request Deduplication ────────────────────────

let superadminAdminsCache: { data: SuperadminAdminRecord[]; timestamp: number } | null = null
let adminsInFlight: Promise<{ ok: boolean; admins?: SuperadminAdminRecord[]; error?: string }> | null = null

export function getCachedSuperadminAdmins(): SuperadminAdminRecord[] | null {
  if (superadminAdminsCache && Date.now() - superadminAdminsCache.timestamp < 30000) {
    return superadminAdminsCache.data
  }
  return null
}

export function invalidateSuperadminAdminsCache(): void {
  superadminAdminsCache = null
}

let superadminOverviewCache: { data: SuperadminDashboardOverview; timestamp: number } | null = null
let overviewInFlight: Promise<{ ok: boolean; overview?: SuperadminDashboardOverview; error?: string }> | null = null

export function getCachedSuperadminDashboardOverview(): SuperadminDashboardOverview | null {
  if (superadminOverviewCache && Date.now() - superadminOverviewCache.timestamp < 30000) {
    return superadminOverviewCache.data
  }
  return null
}

export function invalidateSuperadminOverviewCache(): void {
  superadminOverviewCache = null
}

const auditLogsCache = new Map<string, { data: { logs: any[]; total: number; stats?: any }; timestamp: number }>()
const auditLogsInFlight = new Map<string, Promise<any>>()

export function invalidateSuperadminAuditLogsCache(): void {
  auditLogsCache.clear()
}

const activityCache = new Map<string, { data: { activities: any[]; total: number; stats?: any }; timestamp: number }>()
const activityInFlight = new Map<string, Promise<any>>()

export function invalidateSuperadminActivityCache(): void {
  activityCache.clear()
}

const sessionsCache = new Map<string, { data: { sessions: SuperadminSessionRecord[]; total: number; totalCount: number; activeCount: number; expiredCount: number; revokedCount: number }; timestamp: number }>()
const sessionsInFlight = new Map<string, Promise<any>>()

export function invalidateSuperadminSessionsCache(): void {
  sessionsCache.clear()
}

export function clearAdminAuthCaches(): void {
  adminVerifyCache.clear()
  adminVerifyInFlight.clear()
  superadminOverviewCache = null
  overviewInFlight = null
  superadminAdminsCache = null
  adminsInFlight = null
  auditLogsCache.clear()
  auditLogsInFlight.clear()
  activityCache.clear()
  activityInFlight.clear()
  sessionsCache.clear()
  sessionsInFlight.clear()
}

export async function fetchSuperadminAdmins(force = false): Promise<{ ok: boolean; admins?: SuperadminAdminRecord[]; error?: string }> {
  if (!force && superadminAdminsCache && Date.now() - superadminAdminsCache.timestamp < 20000) {
    return { ok: true, admins: superadminAdminsCache.data }
  }
  if (!force && adminsInFlight) {
    return adminsInFlight
  }

  adminsInFlight = (async () => {
    try {
      const res = await fetch('/api/superadmin/admins', {
        cache: 'no-store',
        credentials: 'include',
        headers: getSuperadminAuthHeaders(),
      })
      const data = await res.json()
      if (!res.ok) {
        return { ok: false, error: data.error || `HTTP ${res.status}` }
      }
      const admins = data.admins || []
      superadminAdminsCache = { data: admins, timestamp: Date.now() }
      return { ok: true, admins }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Failed to fetch admin accounts.' }
    } finally {
      adminsInFlight = null
    }
  })()

  return adminsInFlight
}

export async function createDeveloperAdminAccount(input: {
  email: string
  password: string
}): Promise<{
  ok: boolean
  admin?: SuperadminAdminRecord
  statusCode?: number
  code?: string
  isDuplicate?: boolean
  error?: string
}> {
  try {
    const res = await fetch('/api/superadmin/admins', {
      method: 'POST',
      cache: 'no-store',
      credentials: 'include',
      headers: getSuperadminAuthHeaders(),
      body: JSON.stringify({
        email: input.email.trim().toLowerCase(),
        password: input.password,
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      const code = typeof data.code === 'string' ? data.code : undefined
      return {
        ok: false,
        statusCode: res.status,
        code,
        isDuplicate: res.status === 409 || code === 'DUPLICATE_ADMIN_EMAIL',
        error: data.error || `HTTP ${res.status}`,
      }
    }
    invalidateSuperadminAdminsCache()
    invalidateSuperadminOverviewCache()
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('inferxe_notifications_change'))
    }
    return { ok: true, statusCode: res.status, admin: data.admin }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to create developer admin account.' }
  }
}

export async function updateAdminAccountStatus(
  adminId: string,
  status: 'active' | 'inactive' | 'suspended',
  reason?: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch('/api/superadmin/admins/status', {
      method: 'POST',
      credentials: 'include',
      headers: getSuperadminAuthHeaders(),
      body: JSON.stringify({ admin_id: adminId, status, reason }),
    })
    const data = await res.json()
    if (!res.ok) {
      return { ok: false, error: data.error || `HTTP ${res.status}` }
    }
    invalidateSuperadminAdminsCache()
    invalidateSuperadminOverviewCache()
    invalidateSuperadminSessionsCache()
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to update admin account status.' }
  }
}

export async function updateSuperadminAdmin(
  adminId: string,
  updates: {
    email?: string
    password?: string
    is_active?: boolean
    status?: 'active' | 'inactive' | 'suspended'
    reason?: string
  },
): Promise<{
  ok: boolean
  admin?: SuperadminAdminRecord
  statusCode?: number
  code?: string
  isDuplicate?: boolean
  error?: string
}> {
  try {
    const res = await fetch(`/api/superadmin/admins/${encodeURIComponent(adminId)}`, {
      method: 'PATCH',
      cache: 'no-store',
      credentials: 'include',
      headers: getSuperadminAuthHeaders(),
      body: JSON.stringify(updates),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      const code = typeof data.code === 'string' ? data.code : undefined
      return {
        ok: false,
        statusCode: res.status,
        code,
        isDuplicate: res.status === 409 || code === 'DUPLICATE_ADMIN_EMAIL',
        error: data.error || `HTTP ${res.status}`,
      }
    }
    invalidateSuperadminAdminsCache()
    invalidateSuperadminOverviewCache()
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('inferxe_notifications_change'))
    }
    return { ok: true, statusCode: res.status, admin: data.admin }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to update administrator account.' }
  }
}

export async function deleteSuperadminAdmin(
  adminId: string,
  reason?: string,
): Promise<{
  ok: boolean
  statusCode?: number
  error?: string
}> {
  try {
    const res = await fetch(`/api/superadmin/admins/${encodeURIComponent(adminId)}`, {
      method: 'DELETE',
      cache: 'no-store',
      credentials: 'include',
      headers: getSuperadminAuthHeaders(),
      body: JSON.stringify({ reason }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      return {
        ok: false,
        statusCode: res.status,
        error: data.error || `HTTP ${res.status}`,
      }
    }
    invalidateSuperadminAdminsCache()
    invalidateSuperadminOverviewCache()
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('inferxe_notifications_change'))
    }
    return { ok: true, statusCode: res.status }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to delete administrator account.' }
  }
}

export async function fetchSuperadminAuditLogs(
  params?: {
    category?: string
    search?: string
    admin?: string
    action?: string
    severity?: string
    dateRange?: string
    startDate?: string
    endDate?: string
    sortBy?: string
    limit?: number
    offset?: number
  },
  force = false,
): Promise<{
  ok: boolean
  logs?: any[]
  total?: number
  stats?: {
    totalEvents: number
    eventsToday: number
    uniqueActors: number
    criticalCount: number
    warningCount?: number
    successCount?: number
    infoCount?: number
  }
  error?: string
}> {
  const cacheKey = JSON.stringify(params || {})
  if (!force) {
    const cached = auditLogsCache.get(cacheKey)
    if (cached && Date.now() - cached.timestamp < 15000) {
      return { ok: true, ...cached.data }
    }
    const inFlight = auditLogsInFlight.get(cacheKey)
    if (inFlight) {
      return inFlight
    }
  }

  const fetchPromise = (async () => {
    try {
      const q = new URLSearchParams()
      if (params?.category) q.set('category', params.category)
      if (params?.search) q.set('search', params.search)
      if (params?.admin) q.set('admin', params.admin)
      if (params?.action) q.set('action', params.action)
      if (params?.severity) q.set('severity', params.severity)
      if (params?.dateRange) q.set('dateRange', params.dateRange)
      if (params?.startDate) q.set('startDate', params.startDate)
      if (params?.endDate) q.set('endDate', params.endDate)
      if (params?.sortBy) q.set('sortBy', params.sortBy)
      if (params?.limit) q.set('limit', String(params.limit))
      if (params?.offset) q.set('offset', String(params.offset))

      const res = await fetch(`/api/superadmin/audit-logs?${q.toString()}`, {
        credentials: 'include',
        headers: getSuperadminAuthHeaders(),
      })
      const data = await res.json()
      if (!res.ok) {
        return { ok: false, error: data.error || `HTTP ${res.status}` }
      }
      const payload = {
        logs: data.logs || data.activities || [],
        total: data.total || 0,
        stats: data.stats,
      }
      auditLogsCache.set(cacheKey, { data: payload, timestamp: Date.now() })
      return {
        ok: true,
        ...payload,
      }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Failed to fetch audit logs.' }
    } finally {
      auditLogsInFlight.delete(cacheKey)
    }
  })()

  auditLogsInFlight.set(cacheKey, fetchPromise)
  return fetchPromise
}

export async function fetchSuperadminActivity(
  params?: {
    category?: string
    search?: string
    admin?: string
    action?: string
    severity?: string
    dateRange?: string
    startDate?: string
    endDate?: string
    limit?: number
    offset?: number
  },
  force = false,
): Promise<{
  ok: boolean
  activities?: any[]
  total?: number
  stats?: {
    totalEvents: number
    eventsToday: number
    uniqueActors: number
    criticalCount: number
  }
  error?: string
}> {
  const cacheKey = JSON.stringify(params || {})
  if (!force) {
    const cached = activityCache.get(cacheKey)
    if (cached && Date.now() - cached.timestamp < 15000) {
      return { ok: true, ...cached.data }
    }
    const inFlight = activityInFlight.get(cacheKey)
    if (inFlight) {
      return inFlight
    }
  }

  const fetchPromise = (async () => {
    try {
      const q = new URLSearchParams()
      if (params?.category) q.set('category', params.category)
      if (params?.search) q.set('search', params.search)
      if (params?.admin) q.set('admin', params.admin)
      if (params?.action) q.set('action', params.action)
      if (params?.severity) q.set('severity', params.severity)
      if (params?.dateRange) q.set('dateRange', params.dateRange)
      if (params?.startDate) q.set('startDate', params.startDate)
      if (params?.endDate) q.set('endDate', params.endDate)
      if (params?.limit) q.set('limit', String(params.limit))
      if (params?.offset) q.set('offset', String(params.offset))

      const res = await fetch(`/api/superadmin/activity?${q.toString()}`, {
        credentials: 'include',
        headers: getSuperadminAuthHeaders(),
      })
      const data = await res.json()
      if (!res.ok) {
        return { ok: false, error: data.error || `HTTP ${res.status}` }
      }
      const payload = {
        activities: data.activities || [],
        total: data.total || 0,
        stats: data.stats,
      }
      activityCache.set(cacheKey, { data: payload, timestamp: Date.now() })
      return {
        ok: true,
        ...payload,
      }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Failed to fetch activity logs.' }
    } finally {
      activityInFlight.delete(cacheKey)
    }
  })()

  activityInFlight.set(cacheKey, fetchPromise)
  return fetchPromise
}

export async function fetchSuperadminSessions(
  params?: {
    email?: string
    status?: string
    search?: string
    limit?: number
    offset?: number
  },
  force = false,
): Promise<{
  ok: boolean
  sessions?: SuperadminSessionRecord[]
  total?: number
  totalCount?: number
  activeCount?: number
  expiredCount?: number
  revokedCount?: number
  error?: string
}> {
  const cacheKey = JSON.stringify(params || {})
  if (!force) {
    const cached = sessionsCache.get(cacheKey)
    if (cached && Date.now() - cached.timestamp < 15000) {
      return { ok: true, ...cached.data }
    }
    const inFlight = sessionsInFlight.get(cacheKey)
    if (inFlight) {
      return inFlight
    }
  }

  const fetchPromise = (async () => {
    try {
      const q = new URLSearchParams()
      if (params?.email) q.set('email', params.email)
      if (params?.status) q.set('status', params.status)
      if (params?.search) q.set('search', params.search)
      if (params?.limit) q.set('limit', String(params.limit))
      if (params?.offset) q.set('offset', String(params.offset))

      const res = await fetch(`/api/superadmin/sessions?${q.toString()}`, {
        credentials: 'include',
        headers: getSuperadminAuthHeaders(),
      })
      const data = await res.json()
      if (!res.ok) {
        return { ok: false, error: data.error || `HTTP ${res.status}` }
      }
      const payload = {
        sessions: data.sessions || [],
        total: data.total || 0,
        totalCount: data.totalCount || 0,
        activeCount: data.activeCount || 0,
        expiredCount: data.expiredCount || 0,
        revokedCount: data.revokedCount || 0,
      }
      sessionsCache.set(cacheKey, { data: payload, timestamp: Date.now() })
      return {
        ok: true,
        ...payload,
      }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Failed to fetch administrator sessions.' }
    } finally {
      sessionsInFlight.delete(cacheKey)
    }
  })()

  sessionsInFlight.set(cacheKey, fetchPromise)
  return fetchPromise
}

export async function revokeSuperadminSession(
  sessionId: string,
  reason?: string,
): Promise<{ ok: boolean; message?: string; targetEmail?: string; error?: string }> {
  try {
    const res = await fetch(`/api/superadmin/sessions/${encodeURIComponent(sessionId)}/revoke`, {
      method: 'POST',
      credentials: 'include',
      headers: getSuperadminAuthHeaders(),
      body: JSON.stringify({ reason }),
    })
    const data = await res.json()
    if (!res.ok) {
      return { ok: false, error: data.error || `HTTP ${res.status}` }
    }
    invalidateSuperadminSessionsCache()
    invalidateSuperadminActivityCache()
    invalidateSuperadminAuditLogsCache()
    invalidateSuperadminOverviewCache()
    return { ok: true, message: data.message, targetEmail: data.targetEmail }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to revoke administrator session.' }
  }
}

export async function fetchSuperadminTelemetry(): Promise<{ ok: boolean; telemetry?: SuperadminTelemetryData; error?: string }> {
  try {
    const res = await fetch('/api/superadmin/telemetry', {
      credentials: 'include',
      headers: getSuperadminAuthHeaders(),
    })
    const data = await res.json()
    if (!res.ok) {
      return { ok: false, error: data.error || `HTTP ${res.status}` }
    }
    return { ok: true, telemetry: data.telemetry }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to fetch GPU telemetry.' }
  }
}

export async function fetchSuperadminKeys(): Promise<{
  ok: boolean
  keys?: SuperadminKeyRecord[]
  summary?: SuperadminKeySummary
  status?: number
  unauthorized?: boolean
  forbidden?: boolean
  error?: string
}> {
  const session = getSession()
  if (!session?.token || isDevelopmentBypassToken(session.token)) {
    return {
      ok: false,
      status: 401,
      unauthorized: true,
      error: 'A signed Super Admin session is required. Please sign out and sign in again with your Super Admin account.',
    }
  }
  try {
    const res = await fetch('/api/superadmin/keys', {
      credentials: 'include',
      headers: getSuperadminAuthHeaders(),
    })
    const data = await res.json().catch(() => null)
    if (!data || typeof data !== 'object') {
      return {
        ok: false,
        status: res.status,
        unauthorized: res.status === 401,
        forbidden: res.status === 403,
        error: `Unexpected server response (HTTP ${res.status}).`,
      }
    }
    if (!res.ok || data.ok !== true) {
      return {
        ok: false,
        status: res.status,
        unauthorized: res.status === 401,
        forbidden: res.status === 403,
        error: typeof data.error === 'string' ? data.error : `HTTP ${res.status}`,
      }
    }
    if (!Array.isArray(data.keys)) {
      return {
        ok: false,
        status: res.status,
        error: 'Server returned an invalid keys payload.',
      }
    }
    return { ok: true, keys: data.keys, summary: data.summary }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to fetch keys.' }
  }
}

export async function fetchAdminKeyMonitoring(): Promise<{
  ok: boolean
  data?: AdminKeyMonitoringData
  status?: number
  unauthorized?: boolean
  forbidden?: boolean
  error?: string
}> {
  const session = getSession()
  if (!session?.token || isDevelopmentBypassToken(session.token)) {
    return {
      ok: false,
      status: 401,
      unauthorized: true,
      error: 'A verified Admin or Super Admin session is required. Please sign in again to load live key monitoring data.',
    }
  }
  try {
    const res = await fetch('/api/admin/keys', {
      credentials: 'include',
      headers: getSuperadminAuthHeaders(),
    })
    const payload = await res.json().catch(() => null)
    if (!payload || typeof payload !== 'object') {
      return {
        ok: false,
        status: res.status,
        unauthorized: res.status === 401,
        forbidden: res.status === 403,
        error: `Unexpected server response (HTTP ${res.status}).`,
      }
    }
    if (!res.ok || payload.ok !== true) {
      return {
        ok: false,
        status: res.status,
        unauthorized: res.status === 401,
        forbidden: res.status === 403,
        error: typeof payload.error === 'string' ? payload.error : `HTTP ${res.status}`,
      }
    }
    if (!Array.isArray(payload.keys) || !Array.isArray(payload.alerts) || !Array.isArray(payload.audit_records)) {
      return {
        ok: false,
        status: res.status,
        error: 'Server returned an invalid key monitoring payload.',
      }
    }
    return {
      ok: true,
      status: res.status,
      data: {
        read_only: true,
        actor_role:
          typeof payload.actor_role === 'string' ? getPortalRole(payload.actor_role) : undefined,
        keys: payload.keys,
        summary: payload.summary,
        alerts: payload.alerts,
        audit_records: payload.audit_records,
      },
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to fetch key monitoring data.',
    }
  }
}

export async function revokeSuperadminKey(
  keyId: string,
  keyType: 'api' | 'ssh',
  reason?: string,
): Promise<{
  ok: boolean
  status?: number
  message?: string
  detached_sessions?: number
  revocation_mode?: 'status_revoked' | 'permanent_delete'
  error?: string
}> {
  try {
    const res = await fetch('/api/superadmin/keys/revoke', {
      method: 'POST',
      credentials: 'include',
      headers: getSuperadminAuthHeaders(),
      body: JSON.stringify({ key_id: keyId, key_type: keyType, reason }),
    })
    const data = await res.json().catch(() => null)
    if (!data || typeof data !== 'object') {
      return {
        ok: false,
        status: res.status,
        error: `Unexpected server response (HTTP ${res.status}).`,
      }
    }
    if (!res.ok || data.ok !== true) {
      return {
        ok: false,
        status: res.status,
        error: typeof data.error === 'string' ? data.error : `HTTP ${res.status}`,
      }
    }
    invalidateSuperadminOverviewCache()
    return {
      ok: true,
      status: res.status,
      message: typeof data.message === 'string' ? data.message : undefined,
      detached_sessions: typeof data.detached_sessions === 'number' ? data.detached_sessions : undefined,
      revocation_mode: data.revocation_mode,
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to revoke key.' }
  }
}

export async function fetchSuperadminDashboardOverview(force = false): Promise<{
  ok: boolean
  overview?: SuperadminDashboardOverview
  error?: string
}> {
  if (!force && superadminOverviewCache && Date.now() - superadminOverviewCache.timestamp < 20000) {
    return { ok: true, overview: superadminOverviewCache.data }
  }
  if (!force && overviewInFlight) {
    return overviewInFlight
  }

  overviewInFlight = (async () => {
    try {
      const res = await fetch('/api/superadmin/dashboard/overview', {
        credentials: 'include',
        headers: getSuperadminAuthHeaders(),
      })
      const data = await res.json()
      if (!res.ok) {
        return { ok: false, error: data.error || `HTTP ${res.status}` }
      }
      const overview = data.overview
      if (overview) {
        superadminOverviewCache = { data: overview, timestamp: Date.now() }
      }
      return { ok: true, overview }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Failed to load Super Admin dashboard overview.' }
    } finally {
      overviewInFlight = null
    }
  })()

  return overviewInFlight
}
