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

/* ── AWS Cognito (USER_PASSWORD_AUTH over the public Cognito IDP endpoint) ──
   Enabled when VITE_COGNITO_REGION and VITE_COGNITO_CLIENT_ID are set. */
const COGNITO_REGION = (import.meta.env.VITE_COGNITO_REGION as string | undefined) || 'ap-south-1'
const COGNITO_CLIENT_ID =
  (import.meta.env.VITE_COGNITO_CLIENT_ID as string | undefined) || '334trhnhmim8v42gq4bgk7umst'

export const cognitoEnabled = Boolean(COGNITO_CLIENT_ID)

async function cognitoCall<T>(target: string, body: Record<string, unknown>): Promise<{ ok: boolean; data?: T; error?: string }> {
  try {
    const res = await fetch(`https://cognito-idp.${COGNITO_REGION}.amazonaws.com/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-amz-json-1.1',
        'X-Amz-Target': `AWSCognitoIdentityProviderService.${target}`,
      },
      body: JSON.stringify({ ClientId: COGNITO_CLIENT_ID, ...body }),
    })
    const data = await res.json()
    if (!res.ok) return { ok: false, error: (data as { message?: string }).message || 'Cognito request failed.' }
    return { ok: true, data: data as T }
  } catch {
    return { ok: false, error: 'Unable to reach AWS Cognito.' }
  }
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
  extraProfile?: { organization?: string }
): Promise<CustomerProfile> {
  const payload =
    extraProfile && typeof extraProfile.organization === 'string' && extraProfile.organization.trim()
      ? { organization: extraProfile.organization.trim() }
      : {}

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
    console.warn('[customer-auth] Backend profile sync returned error, falling back to ID token claims:', result?.error)
  } catch (err) {
    console.warn('[customer-auth] Backend profile sync unreachable, falling back to ID token claims:', err)
  }

  // Graceful fallback to verified Cognito ID token claims
  const claims = decodeJwt(idToken) || {}
  const email = (claims.email as string) || ''
  const fullName =
    (claims.name as string) ||
    (claims.preferred_username as string) ||
    (claims['cognito:username'] as string) ||
    email.split('@')[0] ||
    'Customer'
  const username =
    (claims['cognito:username'] as string) ||
    (claims.preferred_username as string) ||
    email.split('@')[0] ||
    'customer'
  const role = (claims['cognito:groups']?.includes('admin') ? 'admin' : 'customer') as UserRole

  return {
    id: (claims.sub as string) || `usr_cog_${Math.random().toString(36).substring(2, 9)}`,
    fullName,
    email,
    username,
    role,
    status: 'active',
    organization: payload.organization || null,
    organizationId: null,
  }
}

function sessionFromProfile(idToken: string, profile: CustomerProfile): AuthSession {
  const claims = decodeJwt(idToken)
  return {
    token: idToken,
    user: {
      id: profile.id,
      fullName: profile.fullName,
      email: profile.email,
      username: profile.username,
      role: profile.role,
      organization: profile.organization || undefined,
    },
    expiresAt: claims?.exp ? claims.exp * 1000 : 0,
  }
}

async function cognitoLogin(email: string, password: string): Promise<{ ok: boolean; session?: AuthSession; error?: string }> {
  const r = await cognitoCall<{ AuthenticationResult?: { IdToken: string } }>('InitiateAuth', {
    AuthFlow: 'USER_PASSWORD_AUTH',
    AuthParameters: { USERNAME: email.trim(), PASSWORD: password },
  })
  if (!r.ok || !r.data?.AuthenticationResult?.IdToken) {
    return { ok: false, error: r.error || 'Additional Cognito challenge required (MFA / new password).' }
  }
  let session: AuthSession
  try {
    const profile = await syncCustomerProfile(r.data.AuthenticationResult.IdToken)
    session = sessionFromProfile(r.data.AuthenticationResult.IdToken, profile)
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Customer profile synchronization failed.',
    }
  }
  saveSession(session)
  return { ok: true, session }
}

export function emailToCognitoUsername(email: string): string {
  const clean = email.trim().toLowerCase()
  return clean.replace(/@/g, '_at_').replace(/[^a-zA-Z0-9_]/g, '_')
}

async function cognitoRegister(fullName: string, email: string, password: string): Promise<{ ok: boolean; error?: string }> {
  const cleanEmail = email.trim().toLowerCase()
  const username = emailToCognitoUsername(cleanEmail)
  const preferredUsername =
    cleanEmail.split('@')[0].replace(/[^a-zA-Z0-9_.-]/g, '') ||
    fullName.trim().replace(/\s+/g, '_') ||
    'user'

  const r = await cognitoCall('SignUp', {
    Username: username,
    Password: password,
    UserAttributes: [
      { Name: 'email', Value: cleanEmail },
      { Name: 'name', Value: fullName.trim() },
      { Name: 'preferred_username', Value: preferredUsername },
    ],
  })
  return r.ok ? { ok: true } : { ok: false, error: r.error }
}

export function getPortalRole(role?: string): PortalRole {
  if (!role) return 'customer'
  const r = role.toLowerCase().trim()
  if (r === 'superadmin' || r === 'super_admin') return 'superadmin'
  if (r === 'admin') return 'admin'
  return 'customer'
}

export function getCognitoTokenFromStorage(): string | null {
  try {
    // 1. Check inferxe_auth_session directly
    const raw = localStorage.getItem(AUTH_STORAGE_KEY)
    if (raw) {
      const session = JSON.parse(raw) as AuthSession
      if (session.token && !isJwtExpired(session.token, 10)) {
        return session.token
      }
    }

    // 2. Scan localStorage for Amplify Cognito ID token or access token
    const clientId = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_COGNITO_CLIENT_ID) || '334trhnhmim8v42gq4bgk7umst'
    const lastUser = localStorage.getItem(`CognitoIdentityServiceProvider.${clientId}.LastAuthUser`)
    if (lastUser) {
      const idToken = localStorage.getItem(`CognitoIdentityServiceProvider.${clientId}.${lastUser}.idToken`)
      if (idToken && !isJwtExpired(idToken, 10)) {
        return idToken
      }
      const accessToken = localStorage.getItem(`CognitoIdentityServiceProvider.${clientId}.${lastUser}.accessToken`)
      if (accessToken && !isJwtExpired(accessToken, 10)) {
        return accessToken
      }
    }

    // 3. Fallback scan across all localStorage keys for any active unexpired Cognito ID token
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && key.startsWith('CognitoIdentityServiceProvider.') && key.endsWith('.idToken')) {
        const val = localStorage.getItem(key)
        if (val && !isJwtExpired(val, 10)) {
          return val
        }
      }
    }

    // 4. Return session token if present (admin or demo tokens)
    if (raw) {
      const session = JSON.parse(raw) as AuthSession
      if (session.token) {
        return session.token
      }
    }
  } catch {
    // ignore
  }
  return null
}

export function getSession(): AuthSession | null {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY)
    if (!raw) {
      // Check if Amplify has an active Cognito token in localStorage
      const ampToken = getCognitoTokenFromStorage()
      if (ampToken) {
        const claims = decodeJwt(ampToken)
        if (claims) {
          const freshSession: AuthSession = {
            token: ampToken,
            user: {
              id: claims.sub || 'usr_customer',
              fullName: claims.name || (claims.email ? claims.email.split('@')[0] : 'Customer'),
              email: claims.email || '',
              username: (claims['cognito:username'] as string) || (claims.email ? claims.email.split('@')[0] : 'customer'),
              role: 'customer',
              organization: 'Customer Workspace',
            },
            expiresAt: (claims.exp ? claims.exp * 1000 : Date.now() + 3600 * 1000),
          }
          saveSession(freshSession)
          return freshSession
        }
      }
      return null
    }

    const session = JSON.parse(raw) as AuthSession
    const isExpired = (session.expiresAt && Date.now() > session.expiresAt) || (session.token.split('.').length === 3 && isJwtExpired(session.token))
    if (isExpired) {
      // Attempt to recover fresh token from Amplify
      const ampToken = getCognitoTokenFromStorage()
      if (ampToken && ampToken !== session.token) {
        session.token = ampToken
        const claims = decodeJwt(ampToken)
        if (claims?.exp) session.expiresAt = claims.exp * 1000
        saveSession(session)
        return session
      }
      localStorage.removeItem(AUTH_STORAGE_KEY)
      return null
    }

    return session
  } catch {
    return null
  }
}

/**
 * Refresh customer authentication session using AWS Amplify's Cognito token refresh.
 * Automatically obtains fresh ID & access tokens using the refresh token.
 */
export async function refreshCustomerSession(forceRefresh = false): Promise<AuthSession | null> {
  try {
    const authSession = await fetchAuthSession({ forceRefresh })
    const idToken = authSession.tokens?.idToken?.toString()
    if (!idToken) {
      return null
    }

    const claims = decodeJwt(idToken)
    if (!claims) return null

    let currentSession: AuthSession | null = null
    try {
      const raw = localStorage.getItem(AUTH_STORAGE_KEY)
      if (raw) currentSession = JSON.parse(raw) as AuthSession
    } catch {}

    const expMs = claims.exp ? claims.exp * 1000 : Date.now() + 3600 * 1000
    const refreshedSession: AuthSession = {
      token: idToken,
      user: {
        id: claims.sub || currentSession?.user?.id || 'usr_customer',
        fullName:
          claims.name ||
          (typeof claims.preferred_username === 'string' && claims.preferred_username) ||
          currentSession?.user?.fullName ||
          (claims.email ? claims.email.split('@')[0] : 'Customer'),
        email: claims.email || currentSession?.user?.email || '',
        username:
          (claims['cognito:username'] as string) ||
          (claims.preferred_username as string) ||
          currentSession?.user?.username ||
          (claims.email ? claims.email.split('@')[0] : 'customer'),
        role: currentSession?.user?.role || 'customer',
        organization: currentSession?.user?.organization || 'Customer Workspace',
      },
      expiresAt: expMs,
    }

    saveSession(refreshedSession)
    return refreshedSession
  } catch (err) {
    console.warn('[authStore] Token refresh via Amplify unavailable:', err)
    return null
  }
}

export function saveSession(session: AuthSession): void {
  try {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session))
    window.dispatchEvent(new Event('inferxe_auth_change'))
  } catch (err) {
    console.error('Failed to save auth session', err)
  }
}

export function clearSession(): void {
  try {
    signOut().catch(() => {})
  } catch {}

  try {
    // 1. Remove standard Inferxe session storage key
    localStorage.removeItem(AUTH_STORAGE_KEY)

    // 2. Clear all Amplify / Cognito token entries from localStorage to prevent session resurrection
    const localKeysToRemove: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (
        key &&
        (key.startsWith('CognitoIdentityServiceProvider') ||
          key.startsWith('amplify') ||
          key.startsWith('inferxe_auth') ||
          key.includes('LastAuthUser') ||
          key.includes('.idToken') ||
          key.includes('.accessToken') ||
          key.includes('.refreshToken'))
      ) {
        localKeysToRemove.push(key)
      }
    }
    for (const key of localKeysToRemove) {
      try {
        localStorage.removeItem(key)
      } catch {}
    }

    // 3. Clear all Amplify / Cognito token entries from sessionStorage
    const sessionKeysToRemove: string[] = []
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i)
      if (
        key &&
        (key.startsWith('CognitoIdentityServiceProvider') ||
          key.startsWith('amplify') ||
          key.startsWith('inferxe_auth') ||
          key.includes('LastAuthUser') ||
          key.includes('.idToken') ||
          key.includes('.accessToken') ||
          key.includes('.refreshToken'))
      ) {
        sessionKeysToRemove.push(key)
      }
    }
    for (const key of sessionKeysToRemove) {
      try {
        sessionStorage.removeItem(key)
      } catch {}
    }

    window.dispatchEvent(new Event('inferxe_auth_change'))
  } catch (err) {
    console.error('Failed to clear auth session', err)
  }
}

export async function performSignOut(redirectUrl = '/'): Promise<void> {
  const currentSession = getSession()
  const portalRole = getPortalRole(currentSession?.user?.role)

  if (portalRole === 'admin' || portalRole === 'superadmin') {
    try {
      await fetch(`${ADMIN_API_BASE}/logout`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(currentSession?.token ? { Authorization: `Bearer ${currentSession.token}` } : {}),
        },
      }).catch(() => {})
    } catch {}
  }

  try {
    await signOut().catch(() => {})
  } catch {}
  clearSession()
  if (typeof window !== 'undefined') {
    window.location.replace(redirectUrl)
  }
}

const ADMIN_API_BASE =
  (import.meta.env.VITE_ADMIN_AUTH_ENDPOINT as string | undefined)?.replace(/\/$/, '') ||
  '/api/admin'

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
        const session: AuthSession = {
          token: data.token,
          user: data.user,
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
      return {
        ok: false,
        isAdmin: false,
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
    return {
      ok: false,
      isAdmin: false,
      backendError: true,
      error: 'Unable to reach the administrator authentication backend.',
    }
  }

  return { ok: false, isAdmin: false }
}

/**
 * Validate an active admin session against the backend database-backed session store
 * and return the authoritative server user record (including role).
 */
export async function verifyAdminSessionWithDetails(token: string): Promise<AdminVerifyResult> {
  if (!token || token.startsWith('ix-') || token === 'admin-dev-token') {
    return { valid: false }
  }

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
      return { valid: false }
    }

    const data = await res.json().catch(() => ({}))
    if (!data.ok || !data.valid || !data.user) {
      return { valid: false }
    }

    const currentSession = getSession()
    if (currentSession && currentSession.token === token) {
      const serverUser = data.user as AuthUser
      if (
        currentSession.user.role !== serverUser.role ||
        currentSession.user.email !== serverUser.email ||
        currentSession.user.id !== serverUser.id
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

    return { valid: true, user: data.user as AuthUser }
  } catch {
    return { valid: false }
  }
}

/**
 * Validate an active admin session token with the backend server.
 */
export async function verifyAdminSessionServer(token: string): Promise<boolean> {
  const result = await verifyAdminSessionWithDetails(token)
  return result.valid
}

export async function loginUser(
  email: string,
  _password?: string,
  _explicitRole?: string
): Promise<{ ok: boolean; session?: AuthSession; error?: string }> {
  if (cognitoEnabled && _password) {
    return cognitoLogin(email, _password)
  }
  return {
    ok: false,
    error: 'AWS Cognito authentication is required. Please sign in with valid credentials.',
  }
}

export async function registerUser(
  fullName: string,
  email: string,
  _password?: string,
  _organization?: string,
  _explicitRole: string = 'customer'
): Promise<{ ok: boolean; session?: AuthSession; error?: string }> {
  if (cognitoEnabled && _password) {
    const r = await cognitoRegister(fullName, email, _password)
    if (!r.ok) return { ok: false, error: r.error }
    return { ok: false, error: 'Account created. Check your email for the Cognito verification code, confirm it, then sign in.' }
  }
  return {
    ok: false,
    error: 'AWS Cognito registration is required.',
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

/**
 * ────────────────────────────────────────────────────────────────
 * Superadmin API Client Layer
 * ────────────────────────────────────────────────────────────────
 */

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
  }
}

export interface SuperadminKeyRecord {
  id: string
  name: string
  type: 'API Key' | 'SSH Key'
  owner_email: string
  owner_name: string
  role: string
  prefix: string
  created_at: string
  last_used?: string
  status: 'active' | 'revoked'
  fingerprint?: string
  rate_limit?: string
}

function getSuperadminAuthHeaders(): HeadersInit {
  const session = getSession()
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
  }
}

export async function fetchSuperadminAdmins(): Promise<{ ok: boolean; admins?: SuperadminAdminRecord[]; error?: string }> {
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
    return { ok: true, admins: data.admins || [] }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to fetch admin accounts.' }
  }
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
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to update admin account status.' }
  }
}

export async function fetchSuperadminAuditLogs(params?: {
  category?: string
  search?: string
  limit?: number
  offset?: number
}): Promise<{ ok: boolean; logs?: SuperadminAuditLog[]; total?: number; error?: string }> {
  try {
    const q = new URLSearchParams()
    if (params?.category) q.set('category', params.category)
    if (params?.search) q.set('search', params.search)
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
    return { ok: true, logs: data.logs || [], total: data.total || 0 }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to fetch audit logs.' }
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

export async function fetchSuperadminKeys(): Promise<{ ok: boolean; keys?: SuperadminKeyRecord[]; error?: string }> {
  try {
    const res = await fetch('/api/superadmin/keys', {
      credentials: 'include',
      headers: getSuperadminAuthHeaders(),
    })
    const data = await res.json()
    if (!res.ok) {
      return { ok: false, error: data.error || `HTTP ${res.status}` }
    }
    return { ok: true, keys: data.keys || [] }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to fetch keys.' }
  }
}

export async function revokeSuperadminKey(
  keyId: string,
  keyType: 'api' | 'ssh',
  reason?: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch('/api/superadmin/keys/revoke', {
      method: 'POST',
      credentials: 'include',
      headers: getSuperadminAuthHeaders(),
      body: JSON.stringify({ key_id: keyId, key_type: keyType, reason }),
    })
    const data = await res.json()
    if (!res.ok) {
      return { ok: false, error: data.error || `HTTP ${res.status}` }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to revoke key.' }
  }
}

