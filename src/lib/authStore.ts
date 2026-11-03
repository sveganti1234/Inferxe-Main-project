import type { UserRecord } from '../types/dashboard'
import { loadUsers } from './userStore'
import { updatePassword } from 'aws-amplify/auth'

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
const COGNITO_REGION = import.meta.env.VITE_COGNITO_REGION as string | undefined
const COGNITO_CLIENT_ID = import.meta.env.VITE_COGNITO_CLIENT_ID as string | undefined

export const cognitoEnabled = Boolean(COGNITO_REGION && COGNITO_CLIENT_ID)

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

function sessionFromCognitoToken(idToken: string, fallbackEmail: string, fallbackRole: string): AuthSession {
  const claims = decodeJwt(idToken) || {}
  const groups = claims['cognito:groups'] || []
  const role = groups.includes('admin') ? 'admin' : fallbackRole
  const email = claims.email || fallbackEmail
  return {
    token: idToken,
    user: {
      id: claims.sub || `usr_${Math.random().toString(36).substring(2, 8)}`,
      fullName: claims.name || email.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      email,
      username: claims['cognito:username'] || email.split('@')[0],
      role,
    },
    expiresAt: claims.exp ? claims.exp * 1000 : Date.now() + 60 * 60 * 1000,
  }
}

async function cognitoLogin(email: string, password: string, role: string): Promise<{ ok: boolean; session?: AuthSession; error?: string }> {
  const r = await cognitoCall<{ AuthenticationResult?: { IdToken: string } }>('InitiateAuth', {
    AuthFlow: 'USER_PASSWORD_AUTH',
    AuthParameters: { USERNAME: email.trim(), PASSWORD: password },
  })
  if (!r.ok || !r.data?.AuthenticationResult?.IdToken) {
    return { ok: false, error: r.error || 'Additional Cognito challenge required (MFA / new password).' }
  }
  const session = sessionFromCognitoToken(r.data.AuthenticationResult.IdToken, email.trim(), role)
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

export function getSession(): AuthSession | null {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY)
    if (!raw) return null
    const session = JSON.parse(raw) as AuthSession
    if ((session.expiresAt && Date.now() > session.expiresAt) || (session.token.split('.').length === 3 && isJwtExpired(session.token))) {
      localStorage.removeItem(AUTH_STORAGE_KEY)
      return null
    }
    return session
  } catch {
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
    localStorage.removeItem(AUTH_STORAGE_KEY)
    window.dispatchEvent(new Event('inferxe_auth_change'))
  } catch (err) {
    console.error('Failed to clear auth session', err)
  }
}

const ADMIN_API_BASE =
  (import.meta.env.VITE_ADMIN_AUTH_ENDPOINT as string | undefined)?.replace(/\/$/, '') ||
  '/api/admin'

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
  try {
    const res = await fetch(`${ADMIN_API_BASE}/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ email: email.trim(), password }),
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
        error: data.error || 'Incorrect email or password.',
      }
    }

    return { ok: false, isAdmin: false }
  } catch (err) {
    console.error('Admin backend login request failed:', err)
    return {
      ok: false,
      isAdmin: false,
      error: 'Unable to reach backend authentication service.',
    }
  }
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

export function switchRole(targetRole: PortalRole): AuthSession {
  let user: AuthSession['user']
  if (targetRole === 'admin') {
    user = {
      id: 'usr_demo_admin',
      fullName: 'Bhumi Reddy',
      email: 'bhumireddy@inferxe.com',
      username: 'bhumireddy',
      role: 'admin',
      organization: 'Inferxe Platform Org',
    }
  } else {
    user = {
      id: 'usr_demo_customer',
      fullName: 'Priya Sharma',
      email: 'priya.s@novatech.ai',
      username: 'priya.ml',
      role: 'customer',
      organization: 'NovaTech AI Systems',
    }
  }

  const session: AuthSession = {
    token: `ix-tok-${Math.random().toString(36).substring(2, 10)}`,
    user,
    expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
  }

  saveSession(session)
  return session
}

export async function loginUser(
  email: string,
  _password?: string,
  explicitRole?: string
): Promise<{ ok: boolean; session?: AuthSession; error?: string }> {
  // AWS Cognito (when configured)
  if (cognitoEnabled && _password) {
    return cognitoLogin(email, _password, explicitRole || 'customer')
  }

  // If backend endpoint is configured, try calling it
  const endpoint = import.meta.env.VITE_AUTH_API_ENDPOINT
  if (endpoint) {
    try {
      const res = await fetch(`${endpoint}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: _password, role: explicitRole }),
      })
      if (res.ok) {
        const data = await res.json()
        const session: AuthSession = {
          token: data.token || `ix-tok-${Math.random().toString(36).substring(2)}`,
          user: data.user || {
            id: 'usr_admin',
            fullName: 'Bhumi Reddy',
            email,
            username: email.split('@')[0],
            role: explicitRole || 'admin',
          },
          expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
        }
        saveSession(session)
        return { ok: true, session }
      }
    } catch {
      // Fallback to local session on network failure
    }
  }

  // Simulated latency
  await new Promise((r) => setTimeout(r, 600))

  // If a custom password has been saved for this user, verify it
  const storedPwd = localStorage.getItem(`inferxe_pwd_${email.trim().toLowerCase()}`)
  if (storedPwd && _password && _password !== storedPwd) {
    return { ok: false, error: 'Incorrect password. Please verify your credentials.' }
  }

  // Find user in store or infer role
  const users = loadUsers()
  const matched = users.find((u: UserRecord) => u.email.toLowerCase() === email.trim().toLowerCase())

  let resolvedRole = explicitRole
  if (!resolvedRole) {
    if (matched) {
      resolvedRole = matched.role
    } else if (email.toLowerCase().includes('admin')) {
      resolvedRole = 'admin'
    } else if (email.toLowerCase().includes('provider') || email.toLowerCase().includes('yotta')) {
      resolvedRole = 'provider'
    } else {
      resolvedRole = 'customer'
    }
  }

  const sessionUser = matched
    ? {
        id: matched.id,
        fullName: matched.fullName,
        email: matched.email,
        username: matched.username,
        role: resolvedRole,
        organization: 'Enterprise Sovereign Mesh',
      }
    : {
        id: `usr_${Math.random().toString(36).substring(2, 8)}`,
        fullName:
          resolvedRole === 'admin'
            ? 'Bhumi Reddy'
            : resolvedRole === 'provider'
            ? 'Anil Mehta'
            : email.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        email: email.trim(),
        username: email.split('@')[0],
        role: resolvedRole,
        organization: resolvedRole === 'provider' ? 'Yotta Sovereign Infrastructure' : 'NovaTech AI Systems',
      }

  const session: AuthSession = {
    token: `ix-tok-${Math.random().toString(36).substring(2, 10)}`,
    user: sessionUser,
    expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
  }

  saveSession(session)
  return { ok: true, session }
}

export async function registerUser(
  fullName: string,
  email: string,
  _password?: string,
  _organization?: string,
  explicitRole: string = 'customer'
): Promise<{ ok: boolean; session?: AuthSession; error?: string }> {
  // AWS Cognito sign-up (the user confirms their email, then signs in)
  if (cognitoEnabled && _password) {
    const r = await cognitoRegister(fullName, email, _password)
    if (!r.ok) return { ok: false, error: r.error }
    return { ok: false, error: 'Account created. Check your email for the Cognito verification code, confirm it, then sign in.' }
  }

  const endpoint = import.meta.env.VITE_AUTH_API_ENDPOINT
  if (endpoint) {
    try {
      const res = await fetch(`${endpoint}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullName, email, password: _password, organization: _organization, role: explicitRole }),
      })
      if (res.ok) {
        const data = await res.json()
        const session: AuthSession = {
          token: data.token || `ix-tok-${Math.random().toString(36).substring(2)}`,
          user: data.user || {
            id: `usr_${Math.random().toString(36).substring(2, 8)}`,
            fullName,
            email,
            username: email.split('@')[0],
            role: explicitRole,
            organization: _organization,
          },
          expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
        }
        saveSession(session)
        return { ok: true, session }
      }
    } catch {
      // Fallback to local
    }
  }

  await new Promise((r) => setTimeout(r, 700))

  const session: AuthSession = {
    token: `ix-tok-${Math.random().toString(36).substring(2, 10)}`,
    user: {
      id: `usr_${Math.random().toString(36).substring(2, 8)}`,
      fullName: fullName.trim(),
      email: email.trim(),
      username: email.split('@')[0],
      role: explicitRole,
      organization: _organization || 'NovaTech AI Systems',
    },
    expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
  }

  saveSession(session)
  return { ok: true, session }
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
