import { updatePassword, signOut, fetchAuthSession } from 'aws-amplify/auth'

export type PortalRole = 'customer' | 'admin'
export type UserRole = 'customer' | 'provider' | 'admin' | 'developer' | 'viewer'

export interface AuthSession {
  token: string
  user: {
    id: string
    fullName: string
    email: string
    username: string
    role: string
    organization?: string
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
  return Boolean(claims && claims.role === 'admin' && typeof claims.exp === 'number')
}

/** Structural check for a stored session; customer sessions must carry a Cognito ID token. */
export function isPlausibleSession(session: AuthSession | null | undefined): session is AuthSession {
  if (!session || typeof session !== 'object' || typeof session.token !== 'string' || !session.user) return false
  if (isLegacyFakeToken(session.token)) return false
  return getPortalRole(session.user.role) === 'admin'
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
  organizationId: string | null
}

export async function syncCustomerProfile(idToken: string): Promise<CustomerProfile> {
  try {
    const response = await fetch('/api/customer/profile/sync', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${idToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: '{}',
    })
    const result = await response.json().catch(() => ({}))
    if (response.ok && result.ok && result.profile) {
      return result.profile as CustomerProfile
    }
  } catch (err) {
    console.warn('[customer-auth] Profile sync network call failed, falling back to token claims:', err)
  }

  const claims = decodeJwt(idToken) || {}
  const email = (claims.email as string) || ''
  // cognito:username is a generated id (cust_…) for self-registered customers, so it is never a display name.
  const name = (claims.name as string)?.trim() || email.split('@')[0] || 'Customer'
  const username = (claims['cognito:username'] as string) || email.split('@')[0] || 'customer'
  return {
    id: (claims.sub as string) || `usr_cog_${Math.random().toString(36).substring(2, 9)}`,
    fullName: name,
    email,
    username,
    role: 'customer',
    status: 'active',
    organizationId: null,
  }
}

export function getPortalRole(role?: string): PortalRole {
  if (!role) return 'customer'
  const r = role.toLowerCase().trim()
  if (r === 'admin' || r === 'super_admin') return 'admin'
  return 'customer'
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
    if (getPortalRole(session.user.role) === 'admin') removeSessionRecord()
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
}

function isNetworkError(err: unknown): boolean {
  const name = (err as { name?: unknown })?.name
  const message = String((err as { message?: unknown })?.message || '')
  return name === 'NetworkError' || (err instanceof TypeError && /fetch|network/i.test(message))
}

let refreshInFlight: Promise<AuthSession | null> | null = null

/** Ask Amplify for the current Cognito session; Amplify refreshes expired tokens with its refresh token. */
async function refreshCustomerSession(stored: AuthSession): Promise<AuthSession | null> {
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
  if (getPortalRole(stored.user.role) === 'admin') return Promise.resolve(getSession())
  if (!isSessionExpired(stored, REFRESH_SKEW_SECONDS)) return Promise.resolve(stored)
  if (!refreshInFlight) {
    refreshInFlight = refreshCustomerSession(stored).finally(() => {
      refreshInFlight = null
    })
  }
  return refreshInFlight
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
  const isAdmin = stored ? getPortalRole(stored.user.role) === 'admin' : false
  // Remove the application session first so nothing looks authenticated while sign-out runs.
  removeSessionRecord()
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
  session?: AuthSession
  error?: string
}

/**
 * Validate submitted credentials against the backend admin authentication endpoint.
 * Credentials are verified exclusively on the server side.
 */
export async function loginAdminBackend(
  email: string,
  password: string,
): Promise<AdminLoginResult> {
  const cleanEmail = email.trim().toLowerCase()

  try {
    const res = await fetch(`${ADMIN_API_BASE}/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ email: cleanEmail, password }),
    })

    const data = await res.json().catch(() => ({}))

    if (data.isAdmin === true) {
      if (res.ok && data.ok && data.token && data.user) {
        const session: AuthSession = {
          token: data.token,
          user: data.user,
          expiresAt: data.expiresAt || Date.now() + 7 * 24 * 60 * 60 * 1000,
        }
        saveSession(session)
        return { ok: true, isAdmin: true, session }
      }
      // The server recognised an administrator account but rejected the credentials.
      return {
        ok: false,
        isAdmin: true,
        error:
          (typeof data.error === 'string' && data.error) ||
          'Incorrect email or password. Please verify your credentials and try again.',
      }
    }

    if (data.isAdmin === false) {
      return { ok: false, isAdmin: false }
    }
  } catch (err) {
    console.error('Admin backend login request failed:', err)
  }

  // The admin authentication server was unreachable or returned an unexpected response.
  // Never authenticate locally: administrator-looking emails get an explicit error, and
  // everyone else continues to AWS Cognito sign-in.
  if (isAdministratorEmail(cleanEmail)) {
    return {
      ok: false,
      isAdmin: true,
      error: 'The administrator sign-in service is unavailable. Please try again shortly.',
    }
  }

  return { ok: false, isAdmin: false }
}

/**
 * Validate an active admin session token with the backend server.
 */
export async function verifyAdminSessionServer(token: string): Promise<boolean> {
  if (!token) return false
  try {
    const res = await fetch(`${ADMIN_API_BASE}/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ token }),
    })

    if (!res.ok) return false
    const data = await res.json().catch(() => ({}))
    return Boolean(data.ok && data.valid)
  } catch {
    return false
  }
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
