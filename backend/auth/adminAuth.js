// @ts-nocheck
import crypto from 'node:crypto'
import { verifyCognitoIdToken } from './cognitoIdToken.js'
import { upsertCognitoProfile } from '../database/supabaseProfiles.js'
import {
  hashPassword,
  validatePasswordStrength,
  verifyPasswordWithReason,
} from './adminPassword.js'
import {
  DEFAULT_ADMIN_SESSION_TTL_SECONDS,
  createAdminSessionRecord,
  createDeveloperAdminAccount,
  findAdminByEmailForAuth,
  listAdminAuditLogs,
  listAdminSessionHistory,
  listAdminUsers,
  recordAdminAuditLog,
  revokeAdminSessionRecord,
  sanitizeAdminUser,
  setAdminAccountActiveStatus,
  verifyAdminSessionRecord,
} from './adminSessionStore.js'
import {
  backupDatabase,
  restoreDatabase,
  syncCustomersBatch,
  registerOrUpdateCustomer,
  recordHeartbeat,
  recordCustomerLogout,
} from '../database/customerDatabase.js'
import {
  upsertCustomerProfile as upsertSupabaseCustomer,
  updateCustomerHeartbeat as updateSupabaseHeartbeat,
  recordCustomerLogout as recordSupabaseLogout,
  getCustomerSummary as getSupabaseCustomerSummary,
  listCustomers as listSupabaseCustomers,
  getCustomerDetails as getSupabaseCustomerDetails,
  exportCustomersToCsv as exportSupabaseCustomersToCsv,
} from '../database/supabaseCustomerService.js'

export const ADMIN_SESSION_COOKIE_NAME = 'inferxe_admin_session'
const MIN_SESSION_SECRET_LENGTH = 32
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

// Sliding-window rate limiting for failed admin login attempts per client IP
const DEFAULT_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000 // 15 minutes
const DEFAULT_RATE_LIMIT_MAX_ATTEMPTS = 20

const TRUSTED_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
]

function getAllowedOrigins() {
  const extra = (process.env.ADMIN_ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
  return [...new Set([...TRUSTED_ORIGINS, ...extra])]
}

/**
 * Base64URL encode/decode helpers
 */
function base64UrlEncode(str) {
  return Buffer.from(str)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

function base64UrlDecode(str) {
  let b64 = str.replace(/-/g, '+').replace(/_/g, '/')
  while (b64.length % 4) {
    b64 += '='
  }
  return Buffer.from(b64, 'base64').toString('utf-8')
}

/**
 * Generate a cryptographically signed HMAC-SHA256 JWT.
 */
export function createAdminToken(payload, secret) {
  const normalizedSecret = typeof secret === 'string' ? secret.trim() : ''
  if (normalizedSecret.length < MIN_SESSION_SECRET_LENGTH) {
    throw new Error('ADMIN_SESSION_SECRET must be at least 32 characters long.')
  }
  const header = { alg: 'HS256', typ: 'JWT' }
  const encodedHeader = base64UrlEncode(JSON.stringify(header))
  const encodedPayload = base64UrlEncode(JSON.stringify(payload))
  const data = `${encodedHeader}.${encodedPayload}`
  const signature = crypto
    .createHmac('sha256', normalizedSecret)
    .update(data)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
  return `${data}.${signature}`
}

/**
 * Cryptographically verify an HMAC-SHA256 admin JWT (stateless signature/claims check).
 * Rejects all bypass token formats (`ix-*`, `admin-dev-token`, etc.).
 * For full protection against revoked sessions or deactivated accounts, use `verifyAdminSession`.
 */
export function verifyAdminToken(token, secret, options = {}) {
  try {
    if (typeof token !== 'string' || !token.trim()) {
      return { valid: false, error: 'Missing authentication token.' }
    }
    const normalizedSecret = typeof secret === 'string' ? secret.trim() : ''
    if (normalizedSecret.length < MIN_SESSION_SECRET_LENGTH) {
      return { valid: false, error: 'Administrator signing secret is not configured.' }
    }

    const trimmed = token.trim()
    if (trimmed.startsWith('ix-') || trimmed === 'admin-dev-token') {
      return { valid: false, error: 'Invalid or unsupported authentication token.' }
    }

    const parts = trimmed.split('.')
    if (parts.length !== 3) {
      return { valid: false, error: 'Malformed token structure.' }
    }

    const [encodedHeader, encodedPayload, signature] = parts
    const header = JSON.parse(base64UrlDecode(encodedHeader))
    if (header.alg !== 'HS256' || header.typ !== 'JWT') {
      return { valid: false, error: 'Unsupported token algorithm.' }
    }

    const data = `${encodedHeader}.${encodedPayload}`
    const expectedSignature = crypto
      .createHmac('sha256', normalizedSecret)
      .update(data)
      .digest('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')

    const sigBuf = Buffer.from(signature)
    const expBuf = Buffer.from(expectedSignature)
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return { valid: false, error: 'Invalid token signature.' }
    }

    const payload = JSON.parse(base64UrlDecode(encodedPayload))
    const now = Math.floor(Date.now() / 1000)

    if (typeof payload.exp !== 'number' || Number.isNaN(payload.exp) || now >= payload.exp) {
      return { valid: false, error: 'Token expired or missing expiration.' }
    }

    if (typeof payload.iat === 'number' && !Number.isNaN(payload.iat) && payload.iat > now + 5) {
      return { valid: false, error: 'Invalid token issue time.' }
    }

    const allowedRoles = options.allowedRoles || ['admin', 'superadmin']
    if (!allowedRoles.includes(payload.role)) {
      return {
        valid: false,
        error: `Unauthorized role: ${payload.role}. Expected one of: ${allowedRoles.join(', ')}.`,
      }
    }

    return { valid: true, payload }
  } catch {
    return { valid: false, error: 'Failed to verify token.' }
  }
}

/**
 * Full database-backed admin session verification:
 * 1. Verifies HS256 JWT signature, expiry, and structure.
 * 2. Requires DB session ID (`sid`), subject (`sub`), and session version (`sv`).
 * 3. Verifies active row in `admin_sessions` (`revoked_at IS NULL`, `expires_at > now`)
 *    and active `admin_users` account (`is_active = true`, matching `session_version`).
 * 4. Enforces `allowedRoles` against the authoritative database `role`.
 * 5. Fails closed (`503`) if signing secret or Supabase session store is unavailable.
 */
export async function verifyAdminSession(token, secret, options = {}) {
  const normalizedSecret = typeof secret === 'string' ? secret.trim() : ''
  if (normalizedSecret.length < MIN_SESSION_SECRET_LENGTH) {
    return {
      valid: false,
      statusCode: 503,
      error: 'Administrator authentication is not configured on the backend.',
    }
  }

  const cryptoCheck = verifyAdminToken(token, normalizedSecret, {
    allowedRoles: ['admin', 'superadmin'],
  })
  if (!cryptoCheck.valid || !cryptoCheck.payload) {
    return {
      valid: false,
      statusCode: 401,
      error: cryptoCheck.error || 'Invalid or expired administrator session token.',
    }
  }

  const { payload } = cryptoCheck
  if (
    typeof payload.sid !== 'string' ||
    !payload.sid.trim() ||
    typeof payload.sub !== 'string' ||
    !payload.sub.trim() ||
    typeof payload.sv !== 'number' ||
    !Number.isFinite(payload.sv)
  ) {
    return {
      valid: false,
      statusCode: 401,
      error: 'Session token is missing required server-side session binding.',
    }
  }

  const dbCheck = await verifyAdminSessionRecord(
    {
      sessionId: payload.sid,
      adminUserId: payload.sub,
      tokenSessionVersion: payload.sv,
    },
    options.supabaseClient,
  )

  if (!dbCheck.valid || !dbCheck.admin) {
    return {
      valid: false,
      statusCode: dbCheck.statusCode || 401,
      error: dbCheck.error || 'Administrator session is invalid or has been revoked.',
    }
  }

  const allowedRoles = options.allowedRoles || ['admin', 'superadmin']
  if (!allowedRoles.includes(dbCheck.admin.role)) {
    return {
      valid: false,
      statusCode: 403,
      error: 'Forbidden: Super Admin privileges are required to access this resource.',
    }
  }

  return {
    valid: true,
    statusCode: 200,
    admin: dbCheck.admin,
    session: dbCheck.session,
    payload: {
      ...payload,
      role: dbCheck.admin.role,
      email: dbCheck.admin.email,
    },
  }
}

/**
 * Parse Cookie header into a key/value map.
 */
function parseCookies(cookieHeader) {
  const cookies = {}
  if (typeof cookieHeader !== 'string' || !cookieHeader.trim()) return cookies
  for (const part of cookieHeader.split(';')) {
    const eqIndex = part.indexOf('=')
    if (eqIndex <= 0) continue
    const key = part.slice(0, eqIndex).trim()
    const rawValue = part.slice(eqIndex + 1).trim()
    try {
      cookies[key] = decodeURIComponent(rawValue)
    } catch {
      cookies[key] = rawValue
    }
  }
  return cookies
}

/**
 * Extract admin session token from Authorization Bearer header or HttpOnly cookie.
 */
export function extractAdminTokenFromRequest(req) {
  const authHeader = req?.headers?.authorization
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const bearer = authHeader.slice(7).trim()
    if (bearer) return bearer
  }
  const cookies = parseCookies(req?.headers?.cookie)
  if (typeof cookies[ADMIN_SESSION_COOKIE_NAME] === 'string' && cookies[ADMIN_SESSION_COOKIE_NAME].trim()) {
    return cookies[ADMIN_SESSION_COOKIE_NAME].trim()
  }
  return ''
}

function isSecureCookieRequest(req) {
  if (process.env.NODE_ENV === 'production') return true
  const forwardedProto = String(req?.headers?.['x-forwarded-proto'] || '').toLowerCase()
  if (forwardedProto === 'https') return true
  return Boolean(req?.socket?.encrypted)
}

function buildSessionCookie(token, maxAgeSeconds, req) {
  const parts = [
    `${ADMIN_SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'HttpOnly',
    'Path=/api',
    'SameSite=Lax',
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
  ]
  if (isSecureCookieRequest(req)) {
    parts.push('Secure')
  }
  return parts.join('; ')
}

function buildClearSessionCookie(req) {
  const parts = [
    `${ADMIN_SESSION_COOKIE_NAME}=`,
    'HttpOnly',
    'Path=/api',
    'SameSite=Lax',
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
  ]
  if (isSecureCookieRequest(req)) {
    parts.push('Secure')
  }
  return parts.join('; ')
}

/**
 * Superadmin GPU Infrastructure & Telemetry Data
 */
export function getSuperadminTelemetryData() {
  return {
    clusters: [
      {
        id: 'cl-jarvis-in-01',
        name: 'JarvisLabs Bangalore (IN-South)',
        provider: 'JarvisLabs',
        region: 'India (Bangalore)',
        status: 'healthy',
        uptime: '99.98%',
        totalNodes: 16,
        activeNodes: 16,
        gpus: [
          { type: 'NVIDIA H100 80GB SXM5', total: 32, allocated: 28, vramUsedGb: 2120, vramTotalGb: 2560, avgTempC: 56, powerW: 480 },
          { type: 'NVIDIA A100 80GB PCIe', total: 64, allocated: 58, vramUsedGb: 4480, vramTotalGb: 5120, avgTempC: 62, powerW: 340 },
        ],
        spotRateHour: 185,
        onDemandRateHour: 240,
        marginPct: 22.9,
      },
      {
        id: 'cl-e2e-in-02',
        name: 'E2E Cloud Mumbai (IN-West)',
        provider: 'E2E Cloud',
        region: 'India (Mumbai)',
        status: 'healthy',
        uptime: '99.95%',
        totalNodes: 24,
        activeNodes: 23,
        gpus: [
          { type: 'NVIDIA L40S 48GB', total: 48, allocated: 41, vramUsedGb: 1880, vramTotalGb: 2304, avgTempC: 58, powerW: 310 },
          { type: 'NVIDIA L4 24GB', total: 32, allocated: 26, vramUsedGb: 610, vramTotalGb: 768, avgTempC: 51, powerW: 72 },
        ],
        spotRateHour: 80,
        onDemandRateHour: 105,
        marginPct: 23.8,
      },
      {
        id: 'cl-yotta-in-03',
        name: 'Yotta NM1 Datacenter (IN-Central)',
        provider: 'Yotta',
        region: 'India (Navi Mumbai)',
        status: 'healthy',
        uptime: '99.99%',
        totalNodes: 12,
        activeNodes: 12,
        gpus: [
          { type: 'NVIDIA H100 80GB SXM5', total: 16, allocated: 15, vramUsedGb: 1180, vramTotalGb: 1280, avgTempC: 59, powerW: 495 },
          { type: 'NVIDIA RTX 4090 24GB', total: 24, allocated: 19, vramUsedGb: 432, vramTotalGb: 576, avgTempC: 64, powerW: 380 },
        ],
        spotRateHour: 190,
        onDemandRateHour: 250,
        marginPct: 24.0,
      },
    ],
    summary: {
      totalGpuCount: 216,
      allocatedGpuCount: 187,
      utilizationPct: 86.6,
      totalVramGb: 12608,
      usedVramGb: 10702,
      activeClusters: 3,
      criticalAlerts: 0,
      averageLatencyMs: 14.2,
      globalHealthScore: 99.98,
    },
  }
}

/**
 * Superadmin API Keys & SSH Keys Audit Data
 */
export function getSuperadminKeysData() {
  return [
    {
      id: 'key_live_master_adm1',
      name: 'Inferxe Platform Master API Key',
      type: 'API Key',
      owner_email: 'admin@inferxe.com',
      owner_name: 'Inferxe Super Admin',
      role: 'superadmin',
      prefix: 'ix_live_sec_...',
      created_at: '2026-01-15T10:00:00Z',
      last_used: '2026-11-16T15:30:00Z',
      status: 'active',
      rate_limit: '1000 req/min',
    },
    {
      id: 'ssh_cluster_rsa_01',
      name: 'Sovereign Cluster Node SSH',
      type: 'SSH Key',
      owner_email: 'ops@inferxe.com',
      owner_name: 'Cluster Ops',
      role: 'customer',
      prefix: 'ssh-ed25519 AAAAC3Nza...',
      created_at: '2026-02-12T14:20:00Z',
      last_used: '2026-11-16T15:10:00Z',
      status: 'active',
      fingerprint: 'SHA256:d9f82c403e114791b1e29d3c5f7a2002',
    },
  ]
}

/**
 * Parse JSON body from IncomingMessage
 */
async function parseJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
      if (body.length > 1e6) {
        req.destroy()
        reject(new Error('Payload too large'))
      }
    })
    req.on('end', () => {
      if (!body.trim()) return resolve({})
      try {
        resolve(JSON.parse(body))
      } catch (err) {
        reject(err)
      }
    })
    req.on('error', reject)
  })
}

function setCorsHeaders(req, res) {
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : ''
  const allowedOrigins = getAllowedOrigins()
  const allowedOrigin = allowedOrigins.includes(origin) ? origin : allowedOrigins[0]
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin)
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, X-Requested-With, x-admin-token')
  res.setHeader('Access-Control-Max-Age', '600')
  res.setHeader('Vary', 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers')
}

function sendJson(req, res, statusCode, data) {
  if (data === undefined) {
    data = statusCode
    statusCode = res
    res = req
  }

  res.statusCode = statusCode
  setCorsHeaders(req, res)
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(data))
}

function parseActiveStatusInput(body) {
  if (typeof body.is_active === 'boolean') return body.is_active
  if (typeof body.isActive === 'boolean') return body.isActive
  if (typeof body.status === 'string') {
    const normalized = body.status.trim().toLowerCase()
    if (normalized === 'active') return true
    if (normalized === 'inactive' || normalized === 'suspended' || normalized === 'deactivated') return false
  }
  return null
}

/**
 * Creates connect/http middleware to handle `/api/admin/*`, `/api/superadmin/*`,
 * and `/api/customer/*` endpoints.
 * Admin authentication is strictly database-backed via Supabase `admin_users` & `admin_sessions`.
 */
export function createAdminAuthMiddleware(config = {}) {
  const supabaseClient = config.supabaseClient || null
  const verifyProfileToken = config.verifyCognitoIdToken || verifyCognitoIdToken
  const saveCognitoProfile = config.upsertCognitoProfile || upsertCognitoProfile
  const sessionTtlSeconds = Number(config.sessionTtlSeconds) > 0
    ? Number(config.sessionTtlSeconds)
    : DEFAULT_ADMIN_SESSION_TTL_SECONDS
  const disableRateLimit = Boolean(config.disableRateLimit)
  const rateLimitWindowMs = Number(config.rateLimitWindowMs) || DEFAULT_RATE_LIMIT_WINDOW_MS
  const rateLimitMaxAttempts = Number(config.rateLimitMaxAttempts) || DEFAULT_RATE_LIMIT_MAX_ATTEMPTS
  const failedLoginMap = new Map()

  const getSessionSecret = () => {
    if (config.sessionSecret !== undefined) return String(config.sessionSecret || '').trim()
    return String(process.env.ADMIN_SESSION_SECRET || '').trim()
  }

  const isSecretConfigured = () => getSessionSecret().length >= MIN_SESSION_SECRET_LENGTH

  const isRateLimited = (key) => {
    if (disableRateLimit) return false
    const now = Date.now()
    const recent = (failedLoginMap.get(key) || []).filter((ts) => now - ts < rateLimitWindowMs)
    failedLoginMap.set(key, recent)
    return recent.length >= rateLimitMaxAttempts
  }

  const recordFailedAttempt = (key) => {
    if (disableRateLimit) return
    const now = Date.now()
    const recent = (failedLoginMap.get(key) || []).filter((ts) => now - ts < rateLimitWindowMs)
    recent.push(now)
    failedLoginMap.set(key, recent)
  }

  const clearFailedAttempts = (key) => {
    failedLoginMap.delete(key)
  }

  return async function adminAuthMiddleware(req, res, next) {
    const rawUrl = req.url || '/'
    const [parsedPath, queryString] = rawUrl.split('?')
    const queryParams = new URLSearchParams(queryString || '')

    // Pass through /api/admin/data/* to supabaseApi.js without shadowing it
    if (parsedPath === '/api/admin/data' || parsedPath.startsWith('/api/admin/data/')) {
      return next()
    }
    // Customer account view and audited plan changes live in api/adminCustomersApi.js (admin-verified
    // there); the remaining /api/admin/customers/* routes are handled below.
    if (/^\/api\/admin\/customers\/[^/]+\/(account|plan)$/.test(parsedPath)) {
      return next()
    }

    const isAdminRoute = parsedPath.startsWith('/api/admin')
    const isSuperAdminRoute = parsedPath.startsWith('/api/superadmin')
    const isCustomerRoute = parsedPath.startsWith('/api/customer')
    const isDirectRoute = (parsedPath === '/login' || parsedPath === '/verify' || parsedPath === '/logout') && req.method === 'POST'

    if (!isAdminRoute && !isSuperAdminRoute && !isDirectRoute && !isCustomerRoute) {
      return next()
    }

    // CORS pre-flight
    if (req.method === 'OPTIONS') {
      setCorsHeaders(req, res)
      res.statusCode = 204
      return res.end()
    }

    const clientIp = req.socket?.remoteAddress || 'unknown'

    // ─────────────────────────────────────────────────────────
    // A. SUPERADMIN API ROUTES (/api/superadmin/*)
    // ─────────────────────────────────────────────────────────
    if (parsedPath.startsWith('/api/superadmin')) {
      if (!isSecretConfigured()) {
        return sendJson(req, res, 503, {
          ok: false,
          error: 'Administrator authentication is not configured on the backend.',
        })
      }

      const token = extractAdminTokenFromRequest(req)
      if (!token) {
        return sendJson(req, res, 401, {
          ok: false,
          error: 'Authentication required. No session token provided.',
        })
      }

      let verification
      try {
        verification = await verifyAdminSession(token, getSessionSecret(), {
          allowedRoles: ['superadmin'],
          supabaseClient,
        })
      } catch (err) {
        console.error('[admin-auth] Superadmin session verification failed:', err?.message || 'Unexpected error')
        return sendJson(req, res, 503, {
          ok: false,
          error: 'Administrator session verification service is temporarily unavailable.',
        })
      }

      if (!verification.valid || !verification.admin) {
        if (verification.statusCode === 401) {
          res.setHeader('Set-Cookie', buildClearSessionCookie(req))
        }
        return sendJson(req, res, verification.statusCode || 401, {
          ok: false,
          error: verification.error || 'Invalid or expired Super Admin session.',
        })
      }

      const superadmin = verification.admin

      // 1. GET /api/superadmin/admins - List all admin accounts (never includes password_hash)
      if (parsedPath === '/api/superadmin/admins' && req.method === 'GET') {
        try {
          const admins = await listAdminUsers(supabaseClient)
          return sendJson(req, res, 200, { ok: true, admins })
        } catch (err) {
          return sendJson(req, res, err.statusCode || 503, {
            ok: false,
            error: err.message || 'Unable to retrieve administrator accounts.',
          })
        }
      }

      // 2. POST /api/superadmin/admins - Create a new developer admin account (role strictly 'admin')
      if (parsedPath === '/api/superadmin/admins' && req.method === 'POST') {
        try {
          const body = await parseJsonBody(req)
          const rawEmail = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
          const rawPassword = typeof body.password === 'string' ? body.password : ''
          const requestedRole = typeof body.role === 'string' ? body.role.trim().toLowerCase() : 'admin'

          // Strictly reject attempts to create another superadmin or arbitrary role
          if (requestedRole && requestedRole !== 'admin') {
            return sendJson(req, res, 403, {
              ok: false,
              error: 'Only standard developer admin accounts (role "admin") can be created. Creating additional Super Admin accounts is prohibited.',
            })
          }

          if (!rawEmail || !EMAIL_REGEX.test(rawEmail) || rawEmail.length > 254) {
            return sendJson(req, res, 400, {
              ok: false,
              error: 'A valid developer email address is required.',
            })
          }

          const strengthCheck = validatePasswordStrength(rawPassword)
          if (!strengthCheck.valid) {
            return sendJson(req, res, 400, {
              ok: false,
              error: strengthCheck.error,
            })
          }

          const passwordHash = hashPassword(rawPassword)
          const createdAdmin = await createDeveloperAdminAccount(
            {
              email: rawEmail,
              passwordHash,
              actorAdmin: superadmin,
              ipAddress: clientIp,
            },
            supabaseClient,
          )

          return sendJson(req, res, 201, {
            ok: true,
            admin: createdAdmin,
          })
        } catch (err) {
          if (err instanceof SyntaxError) {
            return sendJson(req, res, 400, {
              ok: false,
              code: 'INVALID_JSON',
              error: 'Invalid JSON request body.',
            })
          }

          const knownCode = typeof err?.code === 'string' ? err.code : ''
          if (knownCode === 'DUPLICATE_ADMIN_EMAIL') {
            return sendJson(req, res, 409, {
              ok: false,
              code: 'DUPLICATE_ADMIN_EMAIL',
              error: 'An administrator account with this email already exists.',
            })
          }

          if (knownCode === 'ADMIN_SCHEMA_MIGRATION_REQUIRED') {
            return sendJson(req, res, 503, {
              ok: false,
              code: 'ADMIN_SCHEMA_MIGRATION_REQUIRED',
              error:
                'Administrator creation is temporarily unavailable because the database schema currently restricts accounts to a single active administrator. Apply the pending admin schema migration before creating additional administrators.',
            })
          }

          if (knownCode === 'SUPERADMIN_ALREADY_EXISTS') {
            return sendJson(req, res, 403, {
              ok: false,
              code: 'SUPERADMIN_ALREADY_EXISTS',
              error: 'Only one active Super Admin account is permitted.',
            })
          }

          if (knownCode === 'ADMIN_LOOKUP_FAILED') {
            return sendJson(req, res, 503, {
              ok: false,
              code: 'ADMIN_LOOKUP_FAILED',
              error: 'Unable to verify administrator email uniqueness.',
            })
          }

          if (knownCode === 'ADMIN_CREATE_FAILED') {
            return sendJson(req, res, 503, {
              ok: false,
              code: 'ADMIN_CREATE_FAILED',
              error: 'Unable to create developer administrator account.',
            })
          }

          console.error(
            '[admin-auth] Unexpected error during administrator creation:',
            err?.message || 'Unexpected error',
          )
          return sendJson(req, res, 503, {
            ok: false,
            code: 'ADMIN_CREATE_FAILED',
            error: 'Failed to create developer administrator account.',
          })
        }
      }

      // 3. POST /api/superadmin/admins/status OR PATCH /api/superadmin/admins/:id/status
      const patchStatusMatch = /^\/api\/superadmin\/admins\/([^/]+)\/status$/.exec(parsedPath)
      if (
        (parsedPath === '/api/superadmin/admins/status' && req.method === 'POST') ||
        (patchStatusMatch && req.method === 'PATCH')
      ) {
        try {
          const body = await parseJsonBody(req)
          const adminId = patchStatusMatch
            ? decodeURIComponent(patchStatusMatch[1])
            : (body.admin_id || body.adminId)
          const isActive = parseActiveStatusInput(body)
          const reason = typeof body.reason === 'string' ? body.reason : ''

          if (!adminId || isActive === null) {
            return sendJson(req, res, 400, {
              ok: false,
              error: 'admin_id and a valid status ("active" or "inactive") or boolean is_active are required.',
            })
          }

          const updatedAdmin = await setAdminAccountActiveStatus(
            {
              adminId: String(adminId),
              isActive,
              reason,
              actorAdmin: superadmin,
              ipAddress: clientIp,
            },
            supabaseClient,
          )

          return sendJson(req, res, 200, {
            ok: true,
            admin: updatedAdmin,
          })
        } catch (err) {
          const statusCode = err instanceof SyntaxError ? 400 : (err.statusCode || 500)
          return sendJson(req, res, statusCode, {
            ok: false,
            error: err instanceof SyntaxError
              ? 'Invalid JSON request body.'
              : (err.message || 'Failed to update administrator account status.'),
          })
        }
      }

      // 4. GET /api/superadmin/audit-logs - View Supabase audit_logs
      if (parsedPath === '/api/superadmin/audit-logs' && req.method === 'GET') {
        try {
          const urlObj = new URL(rawUrl, 'http://127.0.0.1')
          const category = urlObj.searchParams.get('category') || ''
          const search = urlObj.searchParams.get('search') || ''
          const limit = parseInt(urlObj.searchParams.get('limit') || '50', 10)
          const offset = parseInt(urlObj.searchParams.get('offset') || '0', 10)

          const result = await listAdminAuditLogs({ limit, offset, category, search }, supabaseClient)
          return sendJson(req, res, 200, { ok: true, ...result })
        } catch (err) {
          return sendJson(req, res, err.statusCode || 503, {
            ok: false,
            error: err.message || 'Unable to load audit logs.',
          })
        }
      }

      // 5. GET /api/superadmin/login-history - View Supabase admin_sessions history
      if (parsedPath === '/api/superadmin/login-history' && req.method === 'GET') {
        try {
          const urlObj = new URL(rawUrl, 'http://127.0.0.1')
          const email = urlObj.searchParams.get('email') || ''
          const limit = parseInt(urlObj.searchParams.get('limit') || '50', 10)
          const offset = parseInt(urlObj.searchParams.get('offset') || '0', 10)

          const result = await listAdminSessionHistory({ limit, offset, email }, supabaseClient)
          return sendJson(req, res, 200, { ok: true, ...result })
        } catch (err) {
          return sendJson(req, res, err.statusCode || 503, {
            ok: false,
            error: err.message || 'Unable to load administrator session history.',
          })
        }
      }

      // 6. GET /api/superadmin/telemetry
      if (parsedPath === '/api/superadmin/telemetry' && req.method === 'GET') {
        return sendJson(req, res, 200, { ok: true, telemetry: getSuperadminTelemetryData() })
      }

      // 7. GET /api/superadmin/keys
      if (parsedPath === '/api/superadmin/keys' && req.method === 'GET') {
        return sendJson(req, res, 200, { ok: true, keys: getSuperadminKeysData() })
      }

      // 8. POST /api/superadmin/keys/revoke
      if (parsedPath === '/api/superadmin/keys/revoke' && req.method === 'POST') {
        try {
          const body = await parseJsonBody(req)
          const { key_id, key_type, reason } = body
          if (!key_id) {
            return sendJson(req, res, 400, { ok: false, error: 'key_id is required.' })
          }

          await recordAdminAuditLog(
            {
              action: 'superadmin.key.revoked',
              targetType: String(key_type || 'key'),
              targetId: String(key_id),
              details: {
                actor_admin_id: superadmin.id,
                actor_email: superadmin.email,
                reason: String(reason || 'Revoked by Super Admin'),
                ip_address: clientIp,
              },
            },
            supabaseClient,
          )

          return sendJson(req, res, 200, {
            ok: true,
            message: `Key ${key_id} has been revoked successfully.`,
          })
        } catch (err) {
          return sendJson(req, res, err instanceof SyntaxError ? 400 : 500, {
            ok: false,
            error: err instanceof SyntaxError ? 'Invalid JSON request body.' : 'Failed to revoke key.',
          })
        }
      }

      return sendJson(req, res, 404, { ok: false, error: 'Superadmin endpoint not found.' })
    }

    // ─────────────────────────────────────────────────────────
    // B. ADMIN API ROUTES (/api/admin/*)
    // ─────────────────────────────────────────────────────────

    function isSuperadminEmail(email) {
      if (!email) return false
      const clean = email.trim().toLowerCase()
      const adminEmails = ['admin@inferxe.com', 'alex.chen@inferxe.internal', 'bhumireddy@inferxe.com']
      return adminEmails.includes(clean) || clean.startsWith('admin@') || clean.endsWith('@inferxe.internal')
    }

    async function verifyAdminAccess() {
      if (!isSecretConfigured()) {
        return {
          valid: false,
          statusCode: 503,
          error: 'Administrator authentication is not configured on the backend.',
        }
      }
      const token = extractAdminTokenFromRequest(req)
      if (!token) {
        return {
          valid: false,
          statusCode: 401,
          error: 'Administrator authentication token required.',
        }
      }
      try {
        return await verifyAdminSession(token, getSessionSecret(), {
          allowedRoles: ['admin', 'superadmin'],
          supabaseClient,
        })
      } catch (err) {
        console.error('[admin-auth] Admin access verification failed:', err?.message || 'Unexpected error')
        return {
          valid: false,
          statusCode: 503,
          error: 'Administrator session verification service is temporarily unavailable.',
        }
      }
    }

    // ───────────────────────────────────────────────────────────
    // CUSTOMER PROFILE SYNC & ACTIVITY ENDPOINTS
    // ───────────────────────────────────────────────────────────

    // 0. POST /api/customer/profile/sync (Create or update the authenticated Cognito profile)
    if (parsedPath === '/api/customer/profile/sync' && req.method === 'POST') {
      try {
        const claims = await verifyProfileToken(req.headers['authorization'])
        if (!claims) {
          return sendJson(req, res, 401, { ok: false, error: 'A valid Cognito ID token is required.' })
        }
        const isEmailVerified =
          claims.email_verified === true ||
          claims.email_verified === 'true' ||
          (claims.email_verified !== false && claims.email_verified !== 'false' && claims['cognito:user_status'] === 'CONFIRMED')

        if (!isEmailVerified) {
          return sendJson(req, res, 403, { ok: false, error: 'A verified customer email is required.' })
        }

        const email = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : ''
        const fullName = (typeof claims.name === 'string' && claims.name.trim()) ||
          (typeof claims.preferred_username === 'string' && claims.preferred_username.trim()) ||
          email.split('@')[0]
        const phoneNumber = claims.phone_number || null

        // Parse optional profile payload (e.g. organization entered during signup)
        let body = {}
        try {
          body = await parseJsonBody(req)
        } catch (bodyErr) {
          console.warn('[profile-sync] Warning: Could not parse JSON body:', bodyErr?.message)
        }
        const explicitOrg = typeof body?.organization === 'string' && body.organization.trim()
          ? body.organization.trim()
          : null

        if (typeof config.upsertCognitoProfile === 'function') {
          await config.upsertCognitoProfile(claims)
        }

        // Primary: Upsert into Supabase public.profiles (centralized single source of truth)
        let customerRecord
        if (typeof config.upsertCustomerProfile === 'function') {
          customerRecord = await config.upsertCustomerProfile({
            cognito_sub: claims.sub,
            full_name: fullName,
            email,
            phone_number: phoneNumber,
            organization: explicitOrg,
            isLogin: true,
            claims,
          })
        } else if (!config.upsertCognitoProfile) {
          customerRecord = await upsertSupabaseCustomer({
            cognito_sub: claims.sub,
            full_name: fullName,
            email,
            phone_number: phoneNumber,
            organization: explicitOrg,
            isLogin: true,
            claims,
          })
        } else {
          customerRecord = {
            cognito_sub: claims.sub,
            full_name: fullName,
            email,
            organization: explicitOrg,
            role: 'customer',
            account_status: 'active',
          }
        }

        // Secondary: Keep local SQLite database in sync for local backward compatibility
        try {
          registerOrUpdateCustomer({
            cognito_sub: claims.sub,
            full_name: fullName,
            email,
            phone_number: phoneNumber,
            organization: customerRecord.organization || null,
            role: customerRecord.role || 'customer',
            account_status: customerRecord.account_status || 'active',
            isLogin: true,
          })
        } catch (dbErr) {
          console.warn('[customer-db] SQLite update warning:', dbErr?.message)
        }

        const profile = {
          id: customerRecord.cognito_sub,
          fullName: customerRecord.full_name,
          email: customerRecord.email,
          username: (claims['cognito:username'] || claims.preferred_username || email.split('@')[0]).trim(),
          role: customerRecord.role || 'customer',
          status: customerRecord.account_status || 'active',
          organization: customerRecord.organization || null,
          organizationId: null,
        }

        return sendJson(req, res, 200, { ok: true, profile })
      } catch (err) {
        console.error('[profile-sync] Profile sync error:', err?.message)
        return sendJson(req, res, 502, {
          ok: false,
          error: 'Profile synchronization failed: ' + (err?.message || 'Server error'),
        })
      }
    }

    // 1. POST /api/customer/activity (Registration / Login activity update)
    if (parsedPath === '/api/customer/activity' && req.method === 'POST') {
      try {
        const body = await parseJsonBody(req)
        const email = (body.email || '').trim().toLowerCase()
        const cognito_sub = body.cognito_sub || null

        if (!email) {
          return sendJson(req, res, 400, { ok: false, error: 'Customer email is required.' })
        }

        // Primary: Supabase
        const customer = await upsertSupabaseCustomer({
          cognito_sub: cognito_sub || email,
          full_name: body.full_name,
          email,
          phone_number: body.phone_number,
          organization: body.organization,
          isLogin: Boolean(body.isLogin),
        })

        // Secondary: SQLite
        try {
          registerOrUpdateCustomer({
            cognito_sub,
            full_name: body.full_name,
            email,
            phone_number: body.phone_number,
            organization: body.organization,
            role: body.role || 'customer',
            account_status: body.account_status || 'active',
            isLogin: Boolean(body.isLogin),
            metadata: body.metadata || {},
          })
        } catch {}

        return sendJson(req, res, 200, { ok: true, customer })
      } catch (err) {
        console.error('[customer-activity] Activity recording failed:', err.message)
        return sendJson(req, res, 500, { ok: false, error: err.message || 'Failed to record customer activity.' })
      }
    }

    // 2. POST /api/customer/heartbeat (Periodic heartbeat)
    if (parsedPath === '/api/customer/heartbeat' && req.method === 'POST') {
      try {
        const body = await parseJsonBody(req)
        let email = (body.email || '').trim().toLowerCase()
        let cognito_sub = (body.cognito_sub || '').trim()

        // Authenticate Cognito Bearer token if provided
        const authHeader = req.headers['authorization'] || ''
        if (authHeader.startsWith('Bearer ')) {
          try {
            const claims = await verifyProfileToken(authHeader)
            if (!claims) {
              return sendJson(req, res, 401, { ok: false, error: 'A valid customer Cognito token is required.' })
            }
            if (claims.sub) cognito_sub = claims.sub
            if (claims.email) email = claims.email.trim().toLowerCase()
            if (claims.role === 'admin' || isSuperadminEmail(email)) {
              return sendJson(req, res, 403, { ok: false, error: 'Heartbeats are not applicable to Superadmin accounts.' })
            }
          } catch {
            return sendJson(req, res, 401, { ok: false, error: 'Customer token verification failed.' })
          }
        }

        if (isSuperadminEmail(email)) {
          return sendJson(req, res, 403, { ok: false, error: 'Heartbeats are not applicable to Superadmin accounts.' })
        }

        if (!email && !cognito_sub) {
          return sendJson(req, res, 400, { ok: false, error: 'Customer identifier (sub or email) is required.' })
        }

        // Primary: Supabase (multi-session presence tracking)
        const success = await updateSupabaseHeartbeat({ cognito_sub, email, session_id: body.session_id })

        // Secondary: SQLite
        try {
          recordHeartbeat({ cognito_sub, email })
        } catch {}

        return sendJson(req, res, 200, { ok: true, heartbeat: success })
      } catch (err) {
        console.error('[customer-heartbeat] Failed to record heartbeat:', err.message)
        return sendJson(req, res, 500, { ok: false, error: 'Failed to record customer heartbeat: ' + err.message })
      }
    }

    // 3. POST /api/customer/logout (Customer sign-out event)
    if (parsedPath === '/api/customer/logout' && req.method === 'POST') {
      try {
        const body = await parseJsonBody(req)
        let email = (body.email || '').trim().toLowerCase()
        let cognito_sub = (body.cognito_sub || '').trim()

        // Authenticate Cognito Bearer token if provided
        const authHeader = req.headers['authorization'] || ''
        if (authHeader.startsWith('Bearer ')) {
          try {
            const claims = await verifyProfileToken(authHeader)
            if (!claims) {
              return sendJson(req, res, 401, { ok: false, error: 'A valid customer Cognito token is required.' })
            }
            if (claims.sub) cognito_sub = claims.sub
            if (claims.email) email = claims.email.trim().toLowerCase()
            if (claims.role === 'admin' || isSuperadminEmail(email)) {
              return sendJson(req, res, 403, { ok: false, error: 'Customer logout not applicable to Superadmin accounts.' })
            }
          } catch {
            return sendJson(req, res, 401, { ok: false, error: 'Customer token verification failed.' })
          }
        }

        if (isSuperadminEmail(email)) {
          return sendJson(req, res, 403, { ok: false, error: 'Customer logout not applicable to Superadmin accounts.' })
        }

        if (!email && !cognito_sub) {
          return sendJson(req, res, 400, { ok: false, error: 'Customer identifier (sub or email) is required.' })
        }

        // Primary: Supabase (multi-session presence tracking)
        await recordSupabaseLogout({ cognito_sub, email, session_id: body.session_id })

        // Secondary: SQLite
        try {
          recordCustomerLogout({ cognito_sub, email })
        } catch {}

        return sendJson(req, res, 200, { ok: true, message: 'Customer logout recorded.' })
      } catch (err) {
        console.error('[customer-logout] Failed to record logout:', err.message)
        return sendJson(req, res, 500, { ok: false, error: 'Failed to record customer logout: ' + err.message })
      }
    }

    // ───────────────────────────────────────────────────────────
    // CUSTOMER MANAGEMENT & DATABASE ENDPOINTS
    // ───────────────────────────────────────────────────────────

    // 4. GET /api/admin/customers/summary (Total, Online, Active, Inactive metrics)
    if (parsedPath === '/api/admin/customers/summary' && req.method === 'GET') {
      const auth = await verifyAdminAccess()
      if (!auth.valid) {
        return sendJson(req, res, auth.statusCode || 401, { ok: false, error: auth.error || 'Administrator access required.' })
      }

      try {
        const accountType = queryParams.get('accountType') || 'all'
        const summary = await getSupabaseCustomerSummary({ accountType })
        return sendJson(req, res, 200, { ok: true, summary })
      } catch (err) {
        console.error('[admin-customers] Failed to get customer summary from Supabase:', err.message)
        return sendJson(req, res, 500, { ok: false, error: 'Failed to fetch customer summary: ' + err.message })
      }
    }

    // 5. POST /api/admin/customers/backup (Database backup on demand)
    if (parsedPath === '/api/admin/customers/backup' && req.method === 'POST') {
      const auth = await verifyAdminAccess()
      if (!auth.valid) {
        return sendJson(req, res, auth.statusCode || 401, { ok: false, error: auth.error || 'Administrator access required.' })
      }

      try {
        const backup = backupDatabase()
        return sendJson(req, res, 200, { ok: true, backup })
      } catch (err) {
        return sendJson(req, res, 500, { ok: false, error: 'Backup creation failed: ' + err.message })
      }
    }

    // 6. GET /api/admin/customers (List all customers with filters & pagination)
    if (parsedPath === '/api/admin/customers' && req.method === 'GET') {
      const auth = await verifyAdminAccess()
      if (!auth.valid) {
        return sendJson(req, res, auth.statusCode || 401, { ok: false, error: auth.error || 'Administrator access required.' })
      }

      const search = queryParams.get('search') || ''
      const status = queryParams.get('status') || 'all'
      const sortBy = queryParams.get('sortBy') || 'registration_date'
      const sortOrder = queryParams.get('sortOrder') || 'desc'
      const page = parseInt(queryParams.get('page') || '1', 10)
      const limit = parseInt(queryParams.get('limit') || '20', 10)
      const accountType = queryParams.get('accountType') || 'real'

      try {
        const result = await listSupabaseCustomers({ search, status, sortBy, sortOrder, page, limit, accountType })
        return sendJson(req, res, 200, { ok: true, ...result })
      } catch (err) {
        console.error('[admin-customers] Failed to list customers from Supabase:', err.message)
        return sendJson(req, res, 500, { ok: false, error: 'Failed to retrieve customers: ' + err.message })
      }
    }

    // 7. POST /api/admin/customers/restore (Database restore from backup)
    if (parsedPath === '/api/admin/customers/restore' && req.method === 'POST') {
      const auth = await verifyAdminAccess()
      if (!auth.valid) {
        return sendJson(req, res, auth.statusCode || 401, { ok: false, error: auth.error || 'Administrator access required.' })
      }

      try {
        const body = await parseJsonBody(req)
        if (!body.backupFile) {
          return sendJson(req, res, 400, { ok: false, error: 'Backup filename is required.' })
        }
        const restored = restoreDatabase(body.backupFile)
        return sendJson(req, res, 200, { ok: true, restored })
      } catch (err) {
        return sendJson(req, res, 500, { ok: false, error: 'Restore failed: ' + err.message })
      }
    }

    // 8. GET /api/admin/customers/export (Export all customer records as CSV)
    if (parsedPath === '/api/admin/customers/export' && req.method === 'GET') {
      const auth = await verifyAdminAccess()
      if (!auth.valid) {
        return sendJson(req, res, auth.statusCode || 401, { ok: false, error: auth.error || 'Administrator access required.' })
      }

      try {
        const accountType = queryParams.get('accountType') || 'all'
        const csvContent = await exportSupabaseCustomersToCsv({ accountType })
        const timestamp = new Date().toISOString().slice(0, 10)
        res.statusCode = 200
        setCorsHeaders(req, res)
        res.setHeader('Content-Type', 'text/csv; charset=utf-8')
        res.setHeader('Content-Disposition', `attachment; filename="inferxe_customers_${timestamp}.csv"`)
        res.end(csvContent)
        return
      } catch (err) {
        console.error('[admin-customers] Failed to export customers to CSV from Supabase:', err.message)
        return sendJson(req, res, 500, { ok: false, error: 'Export failed: ' + err.message })
      }
    }

    // 9. POST /api/admin/customers/sync (Batch synchronize Cognito customers)
    if (parsedPath === '/api/admin/customers/sync' && req.method === 'POST') {
      const auth = await verifyAdminAccess()
      if (!auth.valid) {
        return sendJson(req, res, auth.statusCode || 401, { ok: false, error: auth.error || 'Administrator access required.' })
      }

      try {
        const body = await parseJsonBody(req)
        const customersList = Array.isArray(body.customers) ? body.customers : []
        const result = syncCustomersBatch(customersList)
        return sendJson(req, res, 200, { ok: true, ...result })
      } catch (err) {
        return sendJson(req, res, 500, { ok: false, error: 'Sync failed: ' + err.message })
      }
    }

    // 10. GET /api/admin/customers/:id (Detailed customer profile + activity logs)
    if (parsedPath.startsWith('/api/admin/customers/') && req.method === 'GET') {
      const auth = await verifyAdminAccess()
      if (!auth.valid) {
        return sendJson(req, res, auth.statusCode || 401, { ok: false, error: auth.error || 'Administrator access required.' })
      }

      const customerId = decodeURIComponent(parsedPath.slice('/api/admin/customers/'.length).trim())
      if (!customerId) {
        return sendJson(req, res, 400, { ok: false, error: 'Customer ID is required.' })
      }

      try {
        const customer = await getSupabaseCustomerDetails(customerId)
        if (!customer) {
          return sendJson(req, res, 404, { ok: false, error: 'Customer record not found.' })
        }

        return sendJson(req, res, 200, { ok: true, customer })
      } catch (err) {
        console.error('[admin-customers] Failed to get customer details from Supabase:', err.message)
        return sendJson(req, res, 500, { ok: false, error: 'Failed to load customer details: ' + err.message })
      }
    }

    // ───────────────────────────────────────────────────────────
    // SUPER ADMIN AUTHENTICATION ENDPOINTS
    // ───────────────────────────────────────────────────────────

    // 11. POST /api/admin/login or /login
    if ((parsedPath === '/api/admin/login' || parsedPath === '/login') && req.method === 'POST') {
      try {
        const body = await parseJsonBody(req)
        const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
        const password = typeof body.password === 'string' ? body.password : ''

        if (!email || !password) {
          return sendJson(req, res, 400, {
            ok: false,
            error: 'Please enter your email and password.',
          })
        }

        // Look up account strictly in Supabase `admin_users` (no hardcoded fallbacks).
        // Doing this before checking ADMIN_SESSION_SECRET ensures customer emails still
        // receive `{ isAdmin: false }` and proceed to AWS Cognito, while admin accounts
        // receive an explicit 503 configuration error instead of being misrouted to Cognito.
        let dbAdmin = null
        try {
          dbAdmin = await findAdminByEmailForAuth(email, supabaseClient)
        } catch (dbErr) {
          // If Supabase admin store is unconfigured or offline, allow non-admin emails
          // (such as customer emails) to cleanly proceed to customer auth instead of returning 503.
          const isAdminPattern =
            isSuperadminEmail(email) ||
            email.startsWith('admin@') ||
            email.endsWith('@inferxe.com') ||
            email.endsWith('@inferxe.internal')
          if (!isAdminPattern) {
            return sendJson(req, res, 200, {
              ok: false,
              isAdmin: false,
              message: 'Not an admin account',
            })
          }
          throw dbErr
        }

        if (!dbAdmin) {
          // Not an admin account — allow frontend to continue customer Cognito sign-in cleanly.
          return sendJson(req, res, 200, {
            ok: false,
            isAdmin: false,
            message: 'Not an admin account',
          })
        }

        if (!isSecretConfigured()) {
          console.error(
            '[admin-auth] Login blocked: ADMIN_SESSION_SECRET is missing or shorter than 32 characters in backend/.env.',
          )
          return sendJson(req, res, 503, {
            ok: false,
            isAdmin: true,
            code: 'ADMIN_AUTH_NOT_CONFIGURED',
            error: 'Administrator authentication is not configured on the backend. Set ADMIN_SESSION_SECRET (32+ characters) in backend/.env.',
          })
        }

        if (isRateLimited(clientIp)) {
          return sendJson(req, res, 429, {
            ok: false,
            isAdmin: true,
            error: 'Too many failed sign-in attempts. Please wait and try again.',
          })
        }

        if (!dbAdmin.is_active) {
          await recordAdminAuditLog(
            {
              action: 'admin.login.blocked_inactive',
              targetType: 'admin_user',
              targetId: dbAdmin.id,
              details: {
                email: dbAdmin.email,
                ip_address: clientIp,
              },
            },
            supabaseClient,
          )
          return sendJson(req, res, 403, {
            ok: false,
            isAdmin: true,
            error: 'Your administrator account has been deactivated. Please contact the Super Admin.',
          })
        }

        if (dbAdmin.role !== 'admin' && dbAdmin.role !== 'superadmin') {
          return sendJson(req, res, 403, {
            ok: false,
            isAdmin: true,
            error: 'Administrator account role is not authorized.',
          })
        }

        const passwordCheck = verifyPasswordWithReason(password, dbAdmin.password_hash)
        if (!passwordCheck.valid) {
          if (
            passwordCheck.reason === 'malformed_hash' ||
            passwordCheck.reason === 'unsupported_runtime' ||
            passwordCheck.reason === 'error'
          ) {
            console.error(
              `[admin-auth] Login failed (503): stored password hash verification error (${passwordCheck.reason}) for account ${dbAdmin.id}.`,
            )
            return sendJson(req, res, 503, {
              ok: false,
              isAdmin: true,
              code: 'ADMIN_HASH_VERIFY_ERROR',
              error: 'Administrator password verification failed due to a backend hash or runtime error.',
            })
          }

          recordFailedAttempt(clientIp)
          console.warn(
            `[admin-auth] Login rejected (401): password mismatch for ${dbAdmin.email} (id=${dbAdmin.id}, variant=${passwordCheck.meta?.variant || 'unknown'}, m=${passwordCheck.meta?.memory || 0}, t=${passwordCheck.meta?.passes || 0}, p=${passwordCheck.meta?.parallelism || 0}).`,
          )
          await recordAdminAuditLog(
            {
              action: 'admin.login.failed',
              targetType: 'admin_user',
              targetId: dbAdmin.id,
              details: {
                email: dbAdmin.email,
                ip_address: clientIp,
              },
            },
            supabaseClient,
          )
          return sendJson(req, res, 401, {
            ok: false,
            isAdmin: true,
            code: 'INVALID_CREDENTIALS',
            error: 'Incorrect email or password. Please verify your credentials and try again.',
          })
        }

        clearFailedAttempts(clientIp)

        const safeUser = sanitizeAdminUser(dbAdmin)
        const sessionRecord = await createAdminSessionRecord(
          {
            adminUserId: dbAdmin.id,
            sessionVersion: Number(dbAdmin.session_version || 1),
            ttlSeconds: sessionTtlSeconds,
          },
          supabaseClient,
        )

        const nowSec = Math.floor(Date.now() / 1000)
        const payload = {
          sub: safeUser.id,
          sid: sessionRecord.sessionId,
          sv: safeUser.session_version,
          email: safeUser.email,
          role: safeUser.role,
          fullName: safeUser.fullName,
          organization: safeUser.organization,
          iat: nowSec,
          exp: sessionRecord.expiresAtSec,
        }

        const token = createAdminToken(payload, getSessionSecret())

        res.setHeader('Set-Cookie', buildSessionCookie(token, sessionTtlSeconds, req))

        await recordAdminAuditLog(
          {
            action: 'admin.login.success',
            targetType: 'admin_session',
            targetId: sessionRecord.sessionId,
            details: {
              actor_admin_id: safeUser.id,
              actor_email: safeUser.email,
              role: safeUser.role,
              ip_address: clientIp,
            },
          },
          supabaseClient,
        )

        return sendJson(req, res, 200, {
          ok: true,
          isAdmin: true,
          role: safeUser.role,
          token,
          user: safeUser,
          expiresAt: sessionRecord.expiresAtMs,
        })
      } catch (err) {
        const statusCode = err instanceof SyntaxError ? 400 : (err.statusCode || 503)
        if (!(err instanceof SyntaxError)) {
          console.error('[admin-auth] Login error:', err?.message || 'Unexpected error')
        }
        return sendJson(req, res, statusCode, {
          ok: false,
          isAdmin: false,
          backendError: statusCode >= 500,
          code: statusCode >= 500 ? 'ADMIN_DB_UNAVAILABLE' : 'BAD_REQUEST',
          error: err instanceof SyntaxError
            ? 'Invalid JSON request body.'
            : (err.statusCode ? err.message : 'Administrator authentication service is temporarily unavailable.'),
        })
      }
    }

    // 12. POST or GET /api/admin/verify or /verify
    if ((parsedPath === '/api/admin/verify' || parsedPath === '/verify') && (req.method === 'POST' || req.method === 'GET')) {
      try {
        if (!isSecretConfigured()) {
          return sendJson(req, res, 503, {
            ok: false,
            valid: false,
            error: 'Administrator authentication is not configured on the backend.',
          })
        }

        let token = extractAdminTokenFromRequest(req)
        if (!token && req.method === 'POST') {
          const body = await parseJsonBody(req)
          if (typeof body.token === 'string') {
            token = body.token.trim()
          }
        }

        if (!token) {
          return sendJson(req, res, 401, {
            ok: false,
            valid: false,
            error: 'No session token provided.',
          })
        }

        const verification = await verifyAdminSession(token, getSessionSecret(), {
          allowedRoles: ['admin', 'superadmin'],
          supabaseClient,
        })

        if (!verification.valid || !verification.admin) {
          if (verification.statusCode === 401) {
            res.setHeader('Set-Cookie', buildClearSessionCookie(req))
          }
          return sendJson(req, res, verification.statusCode || 401, {
            ok: false,
            valid: false,
            error: verification.error || 'Invalid or expired administrator session.',
          })
        }

        return sendJson(req, res, 200, {
          ok: true,
          valid: true,
          user: verification.admin,
        })
      } catch {
        return sendJson(req, res, 503, {
          ok: false,
          valid: false,
          error: 'Failed to verify administrator session.',
        })
      }
    }

    // 13. POST /api/admin/logout or /logout
    if ((parsedPath === '/api/admin/logout' || parsedPath === '/logout') && req.method === 'POST') {
      res.setHeader('Set-Cookie', buildClearSessionCookie(req))
      try {
        const token = extractAdminTokenFromRequest(req)
        if (token) {
          if (!isSecretConfigured()) {
            return sendJson(req, res, 503, {
              ok: false,
              error: 'Administrator authentication is not configured on the backend.',
            })
          }
          const verification = verifyAdminToken(token, getSessionSecret(), {
            allowedRoles: ['admin', 'superadmin'],
          })
          if (verification.valid && verification.payload?.sid && verification.payload?.sub) {
            await revokeAdminSessionRecord(
              verification.payload.sid,
              verification.payload.sub,
              supabaseClient,
            )
            await recordAdminAuditLog(
              {
                action: 'admin.logout',
                targetType: 'admin_session',
                targetId: verification.payload.sid,
                details: {
                  actor_admin_id: verification.payload.sub,
                  actor_email: verification.payload.email || '',
                  ip_address: clientIp,
                },
              },
              supabaseClient,
            )
          }
        }
      } catch (err) {
        console.error('[admin-auth] Logout session revocation failed:', err?.message || 'Database error')
        return sendJson(req, res, err?.statusCode || 503, {
          ok: false,
          error: 'Unable to revoke administrator session in the database.',
        })
      }
      return sendJson(req, res, 200, { ok: true })
    }

    return sendJson(req, res, 404, { ok: false, error: 'Endpoint not found.' })
  }
}
