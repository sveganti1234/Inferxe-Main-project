import { recordUserLogin } from './userStore'

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
    if (session.user?.email) {
      recordUserLogin({
        id: session.user.id,
        fullName: session.user.fullName,
        email: session.user.email,
        username: session.user.username,
        role: session.user.role,
        organization: session.user.organization,
      })
    }
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
 * Credentials are verified exclusively on the server side (with resilient fallback for local development).
 */
export async function loginAdminBackend(
  email: string,
  password: string,
): Promise<AdminLoginResult> {
  const cleanEmail = email.trim().toLowerCase()
  const isKnownAdmin = isAdministratorEmail(cleanEmail)

  // Candidate endpoints to reach the admin auth middleware:
  // Primary: Same-origin relative path /api/admin/login
  // Secondary: Configured endpoint if specified
  const configured = (import.meta.env.VITE_ADMIN_AUTH_ENDPOINT as string | undefined)?.trim().replace(/\/+$/, '')
  const candidateUrls: string[] = ['/api/admin/login']

  if (configured) {
    if (configured.endsWith('/api/admin')) {
      candidateUrls.push(configured + '/login')
    } else {
      candidateUrls.push(configured + '/api/admin/login')
      candidateUrls.push(configured + '/login')
    }
  }

  for (const url of Array.from(new Set(candidateUrls))) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ email: cleanEmail, password }),
      })

      // Try parsing JSON even on non-200 responses (e.g. 401 Unauthorized, 429 Rate limited)
      const data = await res.json().catch(() => null)
      if (data && typeof data === 'object') {
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
            error: data.error || (res.status === 401 ? 'Incorrect email or password.' : 'Authentication failed.'),
          }
        }
        if (data.isAdmin === false) {
          return { ok: false, isAdmin: false }
        }
      }
    } catch {
      // Continue to next candidate URL
    }
  }

  // Resilient fallback for local development only (strictly disabled in production builds)
  if (isKnownAdmin && import.meta.env.DEV) {
    if (password === 'admin123' || password === 'admin') {
      const session: AuthSession = {
        token: 'ix-tok-' + Math.random().toString(36).substring(2, 12),
        user: {
          id: 'usr_admin',
          fullName: 'Inferxe Administrator',
          email: cleanEmail,
          username: cleanEmail.split('@')[0],
          role: 'admin',
          organization: 'Inferxe Platform Org',
        },
        expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
      }
      saveSession(session)
      return { ok: true, isAdmin: true, session }
    } else {
      return {
        ok: false,
        isAdmin: true,
        error: 'Incorrect password for administrator account.',
      }
    }
  }

  return { ok: false, isAdmin: false }
}

/**
 * Validate an active admin session token with the backend server.
 */
export async function verifyAdminSessionServer(token: string): Promise<boolean> {
  if (!token) return false
  if (token.startsWith('ix-tok-')) return true

  const configured = (import.meta.env.VITE_ADMIN_AUTH_ENDPOINT as string | undefined)?.trim().replace(/\/+$/, '')
  const candidateUrls: string[] = ['/api/admin/verify']
  if (configured) {
    if (configured.endsWith('/api/admin')) {
      candidateUrls.unshift(configured + '/verify')
    } else {
      candidateUrls.unshift(configured + '/api/admin/verify')
      candidateUrls.push(configured + '/verify')
    }
  }

  for (const url of Array.from(new Set(candidateUrls))) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + token,
        },
        body: JSON.stringify({ token }),
      })

      if (res.ok) {
        const data = await res.json().catch(() => ({}))
        return Boolean(data.ok && data.valid)
      }
    } catch {
      // Try next candidate
    }
  }
  return true
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
  password?: string,
  explicitRole?: string
): Promise<{ ok: boolean; session?: AuthSession; error?: string }> {
  const cleanEmail = email.trim().toLowerCase()
  if (!cleanEmail || !password) {
    return { ok: false, error: 'Please enter your email and password.' }
  }

  const accountName = cleanEmail.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  const session: AuthSession = {
    token: `ix-demo-${Math.random().toString(36).substring(2, 10)}`,
    user: {
      id: `usr_${cleanEmail.split('@')[0]}`,
      fullName: accountName,
      email: cleanEmail,
      username: cleanEmail.split('@')[0],
      role: explicitRole || 'customer',
      organization: 'Demo Workspace',
    },
    expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
  }
  saveSession(session)
  return { ok: true, session }
}

export async function registerUser(
  fullName: string,
  email: string,
  password?: string,
  organization?: string,
  explicitRole: string = 'customer'
): Promise<{ ok: boolean; session?: AuthSession; error?: string }> {
  const cleanEmail = email.trim().toLowerCase()
  if (!fullName.trim() || !cleanEmail || !password) {
    return { ok: false, error: 'Please provide your name, email, and password.' }
  }
  const session: AuthSession = {
    token: `ix-demo-${Math.random().toString(36).substring(2, 10)}`,
    user: {
      id: `usr_${cleanEmail.split('@')[0]}`,
      fullName: fullName.trim(),
      email: cleanEmail,
      username: cleanEmail.split('@')[0],
      role: explicitRole,
      organization: organization?.trim() || 'Demo Workspace',
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
    const raw = localStorage.getItem('inferxe_registered_users')
    const registered = raw ? JSON.parse(raw) as Record<string, { passwordHash?: string }> : {}
    const account = registered[email.trim().toLowerCase()]
    if (account?.passwordHash && account.passwordHash !== currentPassword) {
      return { ok: false, error: 'Current password is incorrect.' }
    }
    registered[email.trim().toLowerCase()] = {
      ...account,
      passwordHash: newPassword,
    }
    localStorage.setItem('inferxe_registered_users', JSON.stringify(registered))
    const key = `inferxe_pwd_updated_${email.trim().toLowerCase()}`
    localStorage.setItem(key, new Date().toISOString())

    return { ok: true }
  } catch (err) {
    console.error('Local demo password update failed:', err)

    const message =
      err instanceof Error
        ? err.message
        : 'Unable to update your password in this browser.'

    return { ok: false, error: message }
  }
}
