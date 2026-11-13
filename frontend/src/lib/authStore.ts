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
  if (!response.ok || !result.ok) {
    throw new Error(result.error || 'Unable to synchronize your customer profile.')
  }

  if (result.profile) {
    return result.profile as CustomerProfile
  }

  // Graceful fallback from verified Cognito claims if profile envelope is omitted
  const claims = decodeJwt(idToken)
  if (claims?.sub) {
    const email = typeof claims.email === 'string' ? claims.email : ''
    const fullName =
      (typeof claims.name === 'string' && claims.name) ||
      (typeof claims.preferred_username === 'string' && claims.preferred_username) ||
      (email ? email.split('@')[0] : 'Customer')
    const username =
      (typeof claims['cognito:username'] === 'string' && claims['cognito:username']) ||
      (typeof claims.preferred_username === 'string' && claims.preferred_username) ||
      (email ? email.split('@')[0] : 'customer')
    return {
      id: claims.sub,
      fullName,
      email,
      username,
      role: 'customer',
      status: 'active',
      organization: payload.organization || null,
      organizationId: null,
    }
  }

  throw new Error(result.error || 'Unable to synchronize your customer profile.')
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

async function cognitoRegister(fullName: string, email: string, password: string): Promise<{ ok: boolean; error?: string }> {
  const r = await cognitoCall('SignUp', {
    Username: email.trim(),
    Password: password,
    UserAttributes: [
      { Name: 'email', Value: email.trim() },
      { Name: 'name', Value: fullName.trim() },
    ],
  })
  return r.ok ? { ok: true } : { ok: false, error: r.error }
}

export function getPortalRole(role?: string): PortalRole {
  if (!role) return 'customer'
  const r = role.toLowerCase().trim()
  if (r === 'admin' || r === 'super_admin') return 'admin'
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
    localStorage.removeItem(AUTH_STORAGE_KEY)
    window.dispatchEvent(new Event('inferxe_auth_change'))
  } catch (err) {
    console.error('Failed to clear auth session', err)
  }
}

function getAdminApiEndpoints(subpath: string): string[] {
  const normalized = subpath.startsWith('/') ? subpath : `/${subpath}`
  const endpoints: string[] = []

  // Same-origin endpoint (handled directly by Vite dev server middleware or reverse proxy)
  const sameOrigin = `/api/admin${normalized}`
  endpoints.push(sameOrigin)

  // Configured standalone endpoint (if specified and distinct)
  const configured = (import.meta.env.VITE_ADMIN_AUTH_ENDPOINT as string | undefined)?.trim().replace(/\/$/, '')
  if (configured) {
    const base = configured.endsWith('/api/admin') ? configured : `${configured}/api/admin`
    const ext = `${base}${normalized}`
    if (!endpoints.includes(ext)) {
      endpoints.push(ext)
    }
  }

  return endpoints
}

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
 * Tries the same-origin /api/admin endpoint first (embedded in Vite dev server / reverse proxy),
 * with graceful fallback to the configured standalone admin server if defined.
 * Credentials are verified exclusively on the server side.
 */
export async function loginAdminBackend(
  email: string,
  password: string,
): Promise<AdminLoginResult> {
  const cleanEmail = email.trim().toLowerCase()
  const isAdminCandidate = isAdministratorEmail(cleanEmail)
  const endpoints = getAdminApiEndpoints('/login')

  let connectionError = false

  for (const endpoint of endpoints) {
    try {
      const res = await fetch(endpoint, {
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
        return {
          ok: false,
          isAdmin: true,
          error: data.error || 'Incorrect email or password. Please verify your credentials and try again.',
        }
      }

      if (data.isAdmin === false) {
        return { ok: false, isAdmin: false, error: data.error || data.message }
      }

      if (data.error && typeof data.error === 'string') {
        return {
          ok: false,
          isAdmin: Boolean(data.isAdmin ?? isAdminCandidate),
          error: data.error,
        }
      }
    } catch (err) {
      console.warn(`Admin login request to ${endpoint} failed:`, err)
      connectionError = true
    }
  }

  if (isAdminCandidate) {
    return {
      ok: false,
      isAdmin: true,
      error: connectionError
        ? 'Authentication service is unreachable. Please verify your server is running.'
        : 'Incorrect email or password. Please verify your credentials and try again.',
    }
  }

  return { ok: false, isAdmin: false }
}

/**
 * Validate an active admin session token with the backend server.
 */
export async function verifyAdminSessionServer(token: string): Promise<boolean> {
  if (!token) return false
  const endpoints = getAdminApiEndpoints('/verify')

  for (const endpoint of endpoints) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ token }),
      })

      if (!res.ok) continue
      const data = await res.json().catch(() => ({}))
      if (typeof data.valid === 'boolean') {
        return data.valid
      }
    } catch {
      // try next candidate endpoint
    }
  }

  return false
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
