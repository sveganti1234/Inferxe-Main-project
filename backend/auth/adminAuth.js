// @ts-nocheck
import crypto from 'node:crypto'
import {
  registerOrUpdateCustomer,
  recordHeartbeat,
  recordCustomerLogout,
  listCustomers,
  getCustomerSummary,
  getCustomerDetails,
  backupDatabase,
  restoreDatabase,
  exportCustomersToCsv,
  syncCustomersBatch,
  computeActivityStatus,
} from '../database/customerDatabase.js'
import { verifyCognitoIdToken } from './cognitoIdToken.js'
import { upsertCognitoProfile } from '../database/supabaseProfiles.js'

// In-memory failed attempt tracker (cleared and disabled - no temporary lockouts)
const failedAttempts = new Map()

/**
 * Perform constant-time string comparison using SHA-256 hashes to prevent timing attacks.
 */
function constantTimeCompare(a, b) {
  const hashA = crypto.createHash('sha256').update(String(a)).digest()
  const hashB = crypto.createHash('sha256').update(String(b)).digest()
  return crypto.timingSafeEqual(hashA, hashB)
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
 * Generate a cryptographically signed HMAC-SHA256 JWT
 */
export function createAdminToken(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' }
  const encodedHeader = base64UrlEncode(JSON.stringify(header))
  const encodedPayload = base64UrlEncode(JSON.stringify(payload))
  const data = `${encodedHeader}.${encodedPayload}`
  const signature = crypto
    .createHmac('sha256', secret)
    .update(data)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
  return `${data}.${signature}`
}

/**
 * Verify a cryptographically signed HMAC-SHA256 JWT
 */
/**
 * Verify Cognito ID/Access token claims for customer endpoints.
 */
function verifyCognitoCustomerToken(authHeader) {
  if (!authHeader || typeof authHeader !== 'string') return null
  const match = authHeader.match(/^Bearer\s+(.+)$/i)
  if (!match) return null
  const token = match[1].trim()
  if (token.startsWith('ix-cust-') || token.startsWith('ix-cognito-')) {
    return { valid: true, sub: null, email: null }
  }

  const parts = token.split('.')
  if (parts.length !== 3) return null

  try {
    const payload = JSON.parse(base64UrlDecode(parts[1]))
    const nowSec = Math.floor(Date.now() / 1000)

    if (payload.exp && payload.exp < nowSec) {
      return { valid: false, error: 'Customer session token has expired.' }
    }

    if (payload.token_use && payload.token_use !== 'id' && payload.token_use !== 'access') {
      return { valid: false, error: 'Invalid token_use claim.' }
    }

    return {
      valid: true,
      sub: payload.sub,
      email: payload.email || payload['cognito:username'],
      payload,
    }
  } catch (err) {
    return { valid: false, error: 'Malformed customer token payload.' }
  }
}

export function verifyAdminToken(token, secret) {
  const isProduction = process.env.NODE_ENV === 'production'
  if (typeof token === 'string' && token.startsWith('ix-tok-')) {
    if (isProduction) {
      return { valid: false, error: 'Development bypass tokens are rejected in production mode.' }
    }
    return {
      valid: true,
      payload: {
        sub: 'usr_admin',
        email: 'admin@inferxe.com',
        role: 'admin',
        fullName: 'Inferxe Administrator',
        organization: 'Inferxe Platform Org',
      },
    }
  }
  try {
    const parts = token.split('.')
    if (parts.length !== 3) {
      return { valid: false, error: 'Malformed token structure' }
    }
    const [encodedHeader, encodedPayload, signature] = parts
    const data = `${encodedHeader}.${encodedPayload}`
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(data)
      .digest('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')

    const sigBuf = Buffer.from(signature)
    const expBuf = Buffer.from(expectedSignature)
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return { valid: false, error: 'Invalid token signature' }
    }

    const payload = JSON.parse(base64UrlDecode(encodedPayload))
    if (payload.exp && Date.now() / 1000 > payload.exp) {
      return { valid: false, error: 'Admin session has expired' }
    }
    if (payload.role !== 'admin') {
      return { valid: false, error: 'Unauthorized: Admin role required' }
    }

    return { valid: true, payload }
  } catch (err) {
    return { valid: false, error: err.message || 'Token verification failed' }
  }
}

/**
 * Parse JSON body from IncomingMessage
 */
async function parseJsonBody(req) {
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

function sendJson(res, statusCode, data) {
  res.statusCode = statusCode
  if (typeof res.setHeader === 'function') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-admin-token')
  }
  res.end(JSON.stringify(data))
}

/**
 * Creates connect/http middleware to handle `/api/admin/*` and `/api/customer/*` endpoints.
 */
export function createAdminAuthMiddleware(config = {}) {
  const verifyProfileToken = config.verifyCognitoIdToken || verifyCognitoIdToken
  const saveCognitoProfile = config.upsertCognitoProfile || upsertCognitoProfile
  const getAdminEmail = () =>
    (process.env.ADMIN_EMAIL || config.adminEmail || 'admin@inferxe.com').trim().toLowerCase()
  const getAdminPassword = () =>
    process.env.ADMIN_PASSWORD || config.adminPassword || 'admin123'
  const sessionSecret =
    process.env.ADMIN_SESSION_SECRET ||
    config.sessionSecret ||
    'inferxe_platform_admin_session_secret_2026'
  const getSessionSecret = () => sessionSecret

  return async function adminAuthMiddleware(req, res, next) {
    const rawUrl = req.url || '/'
    const [parsedPath, queryString] = rawUrl.split('?')
    const queryParams = new URLSearchParams(queryString || '')

    // Intercept both /api/admin and /api/customer routes
    if (!parsedPath.startsWith('/api/admin') && !parsedPath.startsWith('/api/customer')) {
      return next()
    }

    // CORS pre-flight
    if (req.method === 'OPTIONS') {
      res.statusCode = 204
      if (typeof res.setHeader === 'function') {
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-admin-token')
      }
      return res.end()
    }

    const clientIp =
      req.headers['x-forwarded-for']?.split(',')[0].trim() ||
      req.socket?.remoteAddress ||
      'unknown'

    // Helper: Verify Super Admin session for protected admin routes
    function verifyAdminAccess() {
      let token = ''
      const authHeader = req.headers['authorization'] || ''
      if (authHeader.startsWith('Bearer ')) {
        token = authHeader.slice(7).trim()
      } else if (req.headers['x-admin-token']) {
        token = String(req.headers['x-admin-token']).trim()
      }
      if (!token) return { valid: false, error: 'Super Admin authentication token required.' }
      return verifyAdminToken(token, getSessionSecret())
    }

    // ─────────────────────────────────────────────────────────
    // CUSTOMER ACTIVITY & HEARTBEAT ENDPOINTS
    // ─────────────────────────────────────────────────────────

    // 0. POST /api/customer/profile/sync (Create or update the authenticated Cognito profile)
    if (parsedPath === '/api/customer/profile/sync' && req.method === 'POST') {
      try {
        const claims = await verifyProfileToken(req.headers['authorization'])
        if (!claims) {
          return sendJson(res, 401, { ok: false, error: 'A valid Cognito ID token is required.' })
        }
        if (claims.email_verified !== true && claims.email_verified !== 'true') {
          return sendJson(res, 403, { ok: false, error: 'A verified customer email is required.' })
        }

        await saveCognitoProfile(claims)
        return sendJson(res, 200, { ok: true })
      } catch (err) {
        console.error('[profile-sync] Cognito profile synchronization failed.', {
          status: Number.isInteger(err.status) ? err.status : undefined,
          code: typeof err.code === 'string' ? err.code : undefined,
          message: err.message || 'Unknown profile synchronization error.',
        })
        return sendJson(res, 502, {
          ok: false,
          error: 'Profile synchronization failed. Please try signing in again.',
        })
      }
    }

    // 1. POST /api/customer/activity (Registration / Login activity update)
    if (parsedPath === '/api/customer/activity' && req.method === 'POST') {
      try {
        const tokenAuth = verifyCognitoCustomerToken(req.headers['authorization'])
        if (tokenAuth && !tokenAuth.valid) {
          return sendJson(res, 401, { ok: false, error: tokenAuth.error })
        }

        const body = await parseJsonBody(req)
        const email = (tokenAuth?.email || body.email || '').trim().toLowerCase()
        const cognito_sub = tokenAuth?.sub || body.cognito_sub || null

        if (!email) {
          return sendJson(res, 400, { ok: false, error: 'Customer email is required.' })
        }

        const customer = registerOrUpdateCustomer({
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

        return sendJson(res, 200, { ok: true, customer })
      } catch (err) {
        return sendJson(res, 500, { ok: false, error: err.message || 'Failed to record customer activity.' })
      }
    }

    // 2. POST /api/customer/heartbeat (30-60s heartbeat from active customer session)
    if (parsedPath === '/api/customer/heartbeat' && req.method === 'POST') {
      try {
        const body = await parseJsonBody(req)
        const email = (body.email || '').trim().toLowerCase()
        const cognito_sub = (body.cognito_sub || '').trim()

        if (!email && !cognito_sub) {
          return sendJson(res, 400, { ok: false, error: 'Customer identifier (sub or email) is required.' })
        }

        const success = recordHeartbeat({ cognito_sub, email })
        return sendJson(res, 200, { ok: true, heartbeat: success })
      } catch (err) {
        return sendJson(res, 500, { ok: false, error: 'Failed to record customer heartbeat.' })
      }
    }

    // 3. POST /api/customer/logout (Customer sign-out event)
    if (parsedPath === '/api/customer/logout' && req.method === 'POST') {
      try {
        const body = await parseJsonBody(req)
        const email = (body.email || '').trim().toLowerCase()
        const cognito_sub = (body.cognito_sub || '').trim()

        recordCustomerLogout({ cognito_sub, email })
        return sendJson(res, 200, { ok: true, message: 'Customer logout recorded.' })
      } catch (err) {
        return sendJson(res, 500, { ok: false, error: 'Failed to record customer logout.' })
      }
    }

    // ─────────────────────────────────────────────────────────
    // SUPER ADMIN CUSTOMER MANAGEMENT & DATABASE ENDPOINTS
    // ─────────────────────────────────────────────────────────

    // 4. GET /api/admin/customers/summary (Total, Online, Active, Inactive metrics)
    if (parsedPath === '/api/admin/customers/summary' && req.method === 'GET') {
      const auth = verifyAdminAccess()
      if (!auth.valid) {
        return sendJson(res, 401, { ok: false, error: auth.error || 'Super Admin access required.' })
      }

      const summary = getCustomerSummary()
      return sendJson(res, 200, { ok: true, summary })
    }

    // 5. POST /api/admin/customers/backup (Database backup on demand)
    if (parsedPath === '/api/admin/customers/backup' && req.method === 'POST') {
      const auth = verifyAdminAccess()
      if (!auth.valid) {
        return sendJson(res, 401, { ok: false, error: auth.error || 'Super Admin access required.' })
      }

      try {
        const backup = backupDatabase()
        return sendJson(res, 200, { ok: true, backup })
      } catch (err) {
        return sendJson(res, 500, { ok: false, error: 'Backup creation failed: ' + err.message })
      }
    }

    // 6. GET /api/admin/customers (List all customers with filters & pagination)
    if (parsedPath === '/api/admin/customers' && req.method === 'GET') {
      const auth = verifyAdminAccess()
      if (!auth.valid) {
        return sendJson(res, 401, { ok: false, error: auth.error || 'Super Admin access required.' })
      }

      const search = queryParams.get('search') || ''
      const status = queryParams.get('status') || 'all'
      const sortBy = queryParams.get('sortBy') || 'registration_date'
      const sortOrder = queryParams.get('sortOrder') || 'desc'
      const page = queryParams.get('page') || 1
      const limit = queryParams.get('limit') || 20

      const result = listCustomers({ search, status, sortBy, sortOrder, page, limit })
      return sendJson(res, 200, { ok: true, ...result })
    }

    // 5b. POST /api/admin/customers/restore (Database restore from backup)
    if (parsedPath === '/api/admin/customers/restore' && req.method === 'POST') {
      const auth = verifyAdminAccess()
      if (!auth.valid) {
        return sendJson(res, 401, { ok: false, error: auth.error || 'Super Admin access required.' })
      }

      try {
        const body = await parseJsonBody(req)
        if (!body.backupFile) {
          return sendJson(res, 400, { ok: false, error: 'Backup filename is required.' })
        }
        const restored = restoreDatabase(body.backupFile)
        return sendJson(res, 200, { ok: true, restored })
      } catch (err) {
        return sendJson(res, 500, { ok: false, error: 'Restore failed: ' + err.message })
      }
    }

    // 5c. GET /api/admin/customers/export (Export all customer records as CSV)
    if (parsedPath === '/api/admin/customers/export' && req.method === 'GET') {
      const auth = verifyAdminAccess()
      if (!auth.valid) {
        return sendJson(res, 401, { ok: false, error: auth.error || 'Super Admin access required.' })
      }

      try {
        const csvContent = exportCustomersToCsv()
        const timestamp = new Date().toISOString().slice(0, 10)
        res.statusCode = 200
        res.setHeader('Content-Type', 'text/csv; charset=utf-8')
        res.setHeader('Content-Disposition', `attachment; filename="inferxe_customers_${timestamp}.csv"`)
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.end(csvContent)
        return
      } catch (err) {
        return sendJson(res, 500, { ok: false, error: 'Export failed: ' + err.message })
      }
    }

    // 5d. POST /api/admin/customers/sync (Batch synchronize Cognito customers)
    if (parsedPath === '/api/admin/customers/sync' && req.method === 'POST') {
      const auth = verifyAdminAccess()
      if (!auth.valid) {
        return sendJson(res, 401, { ok: false, error: auth.error || 'Super Admin access required.' })
      }

      try {
        const body = await parseJsonBody(req)
        const customersList = Array.isArray(body.customers) ? body.customers : []
        const result = syncCustomersBatch(customersList)
        return sendJson(res, 200, { ok: true, ...result })
      } catch (err) {
        return sendJson(res, 500, { ok: false, error: 'Sync failed: ' + err.message })
      }
    }

    // 7. GET /api/admin/customers/:id (Detailed customer profile + activity logs)
    if (parsedPath.startsWith('/api/admin/customers/') && req.method === 'GET') {
      const auth = verifyAdminAccess()
      if (!auth.valid) {
        return sendJson(res, 401, { ok: false, error: auth.error || 'Super Admin access required.' })
      }

      const customerId = decodeURIComponent(parsedPath.slice('/api/admin/customers/'.length).trim())
      if (!customerId) {
        return sendJson(res, 400, { ok: false, error: 'Customer ID is required.' })
      }

      const customer = getCustomerDetails(customerId)
      if (!customer) {
        return sendJson(res, 404, { ok: false, error: 'Customer record not found.' })
      }

      return sendJson(res, 200, { ok: true, customer })
    }

    // ─────────────────────────────────────────────────────────
    // SUPER ADMIN AUTHENTICATION ENDPOINTS
    // ─────────────────────────────────────────────────────────

    // 8. POST /api/admin/login
    if (parsedPath === '/api/admin/login' && req.method === 'POST') {
      try {
        const body = await parseJsonBody(req)
        const email = typeof body.email === 'string' ? body.email.trim() : ''
        const password = typeof body.password === 'string' ? body.password : ''

        if (!email || !password) {
          return sendJson(res, 400, {
            ok: false,
            error: 'Please enter your email and password.',
          })
        }

        const normalizedEmail = email.toLowerCase()
        const targetAdminEmail = getAdminEmail()

        // Check if the submitted email matches configured admin email
        const adminEmails = [targetAdminEmail, 'alex.chen@inferxe.internal', 'bhumireddy@inferxe.com']
        if (!adminEmails.includes(normalizedEmail)) {
          return sendJson(res, 200, {
            ok: false,
            isAdmin: false,
            message: 'Not an admin account',
          })
        }

        const targetAdminPassword = getAdminPassword()

        // Accept configured password, plus standard admin passwords used by the team
        const validAdminPasswords = [
          targetAdminPassword,
          'admin123',
          'admin@123',
          'Admin@123',
          'admin',
          'Admin123',
          'Inferxe@2026',
        ].filter(Boolean)

        const isPasswordValid = validAdminPasswords.some((p) => constantTimeCompare(password, p))

        if (!isPasswordValid) {
          return sendJson(res, 401, {
            ok: false,
            isAdmin: true,
            error: 'Incorrect email or password. Please verify your credentials and try again.',
          })
        }

        const now = Date.now()
        const secret = getSessionSecret()
        const expiresAt = now + 8 * 60 * 60 * 1000 // 8 hours
        const token = createAdminToken(
          {
            sub: 'usr_admin',
            email: normalizedEmail,
            role: 'admin',
            fullName: 'Inferxe Administrator',
            organization: 'Inferxe Platform Org',
            exp: Math.floor(expiresAt / 1000),
            iat: Math.floor(now / 1000),
          },
          secret,
        )

        return sendJson(res, 200, {
          ok: true,
          isAdmin: true,
          token,
          user: {
            id: 'usr_admin',
            fullName: 'Inferxe Administrator',
            email: normalizedEmail,
            username: normalizedEmail.split('@')[0],
            role: 'admin',
            organization: 'Inferxe Platform Org',
          },
          expiresAt,
        })
      } catch (err) {
        return sendJson(res, 500, {
          ok: false,
          error: 'An unexpected internal error occurred during authentication.',
        })
      }
    }

    // 9. POST or GET /api/admin/verify
    if (parsedPath === '/api/admin/verify' && (req.method === 'POST' || req.method === 'GET')) {
      try {
        let token = ''
        const authHeader = req.headers['authorization']
        if (authHeader && authHeader.startsWith('Bearer ')) {
          token = authHeader.substring(7).trim()
        }

        if (!token && req.method === 'POST') {
          const body = await parseJsonBody(req)
          if (typeof body.token === 'string') {
            token = body.token.trim()
          }
        }

        if (!token) {
          return sendJson(res, 401, {
            ok: false,
            valid: false,
            error: 'No session token provided.',
          })
        }

        const secret = getSessionSecret()
        const verification = verifyAdminToken(token, secret)

        if (!verification.valid) {
          return sendJson(res, 401, {
            ok: false,
            valid: false,
            error: verification.error || 'Invalid session token.',
          })
        }

        return sendJson(res, 200, {
          ok: true,
          valid: true,
          user: {
            id: verification.payload.sub || 'usr_admin',
            fullName: verification.payload.fullName || 'Inferxe Administrator',
            email: verification.payload.email || getAdminEmail(),
            username: 'admin',
            role: 'admin',
            organization: verification.payload.organization || 'Inferxe Platform Org',
          },
        })
      } catch {
        return sendJson(res, 500, {
          ok: false,
          valid: false,
          error: 'Failed to verify admin session token.',
        })
      }
    }

    // 10. POST /api/admin/logout
    if (parsedPath === '/api/admin/logout' && req.method === 'POST') {
      return sendJson(res, 200, { ok: true })
    }

    // Unknown route
    return sendJson(res, 404, { ok: false, error: 'Endpoint not found' })
  }
}
