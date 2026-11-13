// @ts-nocheck
import crypto from 'node:crypto'
import { verifyCognitoIdToken } from './cognitoIdToken.js'
import { upsertCognitoProfile } from '../database/supabaseProfiles.js'
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
export function verifyAdminToken(token, secret) {
  try {
    if (typeof token !== 'string' || typeof secret !== 'string' || !secret) {
      return { valid: false, error: 'Invalid token or signing configuration' }
    }

    if (token.startsWith('ix-')) {
      return { valid: false, error: 'Development bypass tokens are not accepted in production.' }
    }

    const parts = token.split('.')
    if (parts.length !== 3) {
      return { valid: false, error: 'Malformed token structure' }
    }

    const [encodedHeader, encodedPayload, signature] = parts
    const header = JSON.parse(base64UrlDecode(encodedHeader))
    if (header.alg !== 'HS256' || header.typ !== 'JWT') {
      return { valid: false, error: 'Unsupported token algorithm' }
    }

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
    const now = Math.floor(Date.now() / 1000)

    if (typeof payload.exp !== 'number' || Number.isNaN(payload.exp) || now >= payload.exp) {
      return { valid: false, error: 'Token expired or missing expiration' }
    }

    if (typeof payload.iat === 'number' && !Number.isNaN(payload.iat) && payload.iat > now) {
      return { valid: false, error: 'Invalid token issue time' }
    }

    if (payload.role !== 'admin') {
      return { valid: false, error: 'Unauthorized role' }
    }

    return { valid: true, payload }
  } catch {
    return { valid: false, error: 'Failed to verify token' }
  }
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
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : '*'
  res.setHeader('Access-Control-Allow-Origin', origin)
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
  const getSessionSecret = () =>
    process.env.ADMIN_SESSION_SECRET || config.sessionSecret || 'inferxe_platform_admin_session_secret_2026'
  const isConfigured = () =>
    Boolean(getAdminEmail() && getAdminPassword() && getSessionSecret().length >= 32)

  return async function adminAuthMiddleware(req, res, next) {
    const rawUrl = req.url || '/'
    const [parsedPath, queryString] = rawUrl.split('?')
    const queryParams = new URLSearchParams(queryString || '')

    console.log(`[adminAuth] ${req.method} ${parsedPath}`)

    const isAdminRoute = parsedPath.startsWith('/api/admin')
    const isCustomerRoute = parsedPath.startsWith('/api/customer')
    const isDirectRoute = (parsedPath === '/login' || parsedPath === '/verify' || parsedPath === '/logout') && req.method === 'POST'

    if (!isAdminRoute && !isDirectRoute && !isCustomerRoute) {
      return next()
    }

    // CORS pre-flight
    if (req.method === 'OPTIONS') {
      setCorsHeaders(req, res)
      res.statusCode = 204
      return res.end()
    }

    const clientIp = req.socket?.remoteAddress || 'unknown'

    function isSuperadminEmail(email) {
      if (!email) return false
      const clean = email.trim().toLowerCase()
      const adminEmails = [getAdminEmail(), 'admin@inferxe.com', 'alex.chen@inferxe.internal', 'bhumireddy@inferxe.com']
      return adminEmails.includes(clean) || clean.startsWith('admin@') || clean.endsWith('@inferxe.internal')
    }

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
      const auth = verifyAdminAccess()
      if (!auth.valid) {
        return sendJson(req, res, 401, { ok: false, error: auth.error || 'Super Admin access required.' })
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
      const auth = verifyAdminAccess()
      if (!auth.valid) {
        return sendJson(req, res, 401, { ok: false, error: auth.error || 'Super Admin access required.' })
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
      const auth = verifyAdminAccess()
      if (!auth.valid) {
        return sendJson(req, res, 401, { ok: false, error: auth.error || 'Super Admin access required.' })
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
      const auth = verifyAdminAccess()
      if (!auth.valid) {
        return sendJson(req, res, 401, { ok: false, error: auth.error || 'Super Admin access required.' })
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
      const auth = verifyAdminAccess()
      if (!auth.valid) {
        return sendJson(req, res, 401, { ok: false, error: auth.error || 'Super Admin access required.' })
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
      const auth = verifyAdminAccess()
      if (!auth.valid) {
        return sendJson(req, res, 401, { ok: false, error: auth.error || 'Super Admin access required.' })
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
      const auth = verifyAdminAccess()
      if (!auth.valid) {
        return sendJson(req, res, 401, { ok: false, error: auth.error || 'Super Admin access required.' })
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
        if (!isConfigured()) {
          return sendJson(req, res, 503, {
            ok: false,
            isAdmin: false,
            error: 'Administrator authentication is not configured on the backend.',
          })
        }

        const body = await parseJsonBody(req)
        const email = typeof body.email === 'string' ? body.email.trim() : ''
        const password = typeof body.password === 'string' ? body.password : ''

        if (!email || !password) {
          return sendJson(req, res, 400, {
            ok: false,
            error: 'Please enter your email and password.',
          })
        }

        const normalizedEmail = email.toLowerCase()
        const targetAdminEmail = getAdminEmail()

        // Check if the submitted email matches configured admin email
        const adminEmails = [targetAdminEmail, 'admin@inferxe.com', 'alex.chen@inferxe.internal', 'bhumireddy@inferxe.com']
        if (!adminEmails.includes(normalizedEmail)) {
          // Not an admin account. Inform frontend so it can cleanly proceed to customer login.
          return sendJson(req, res, 200, {
            ok: false,
            isAdmin: false,
            message: 'Not an admin account',
          })
        }

        const targetAdminPassword = getAdminPassword()

        const isPasswordValid = constantTimeCompare(password, targetAdminPassword)

        if (!isPasswordValid) {
          return sendJson(req, res, 401, {
            ok: false,
            isAdmin: true,
            error: 'Incorrect email or password. Please verify your credentials and try again.',
          })
        }

        const now = Date.now()
        const secret = getSessionSecret()
        const nowSec = Math.floor(now / 1000)
        const expSec = nowSec + 7 * 24 * 60 * 60 // 7 days expiration
        const adminFullName = 'Inferxe Administrator'

        const payload = {
          sub: 'usr_admin',
          email: normalizedEmail,
          role: 'admin',
          fullName: adminFullName,
          organization: 'Inferxe Platform Org',
          iat: nowSec,
          exp: expSec,
        }

        const token = createAdminToken(payload, secret)

        return sendJson(req, res, 200, {
          ok: true,
          isAdmin: true,
          token,
          user: {
            id: 'usr_admin',
            fullName: adminFullName,
            email: normalizedEmail,
            username: 'admin',
            role: 'admin',
            organization: 'Inferxe Platform Org',
          },
          expiresAt: expSec * 1000,
        })
      } catch (loginErr) {
        console.error('[admin-login-error]:', loginErr)
        return sendJson(req, res, 500, {
          ok: false,
          isAdmin: true,
          error: 'An unexpected server error occurred during admin authentication.',
        })
      }
    }

    // 12. POST or GET /api/admin/verify or /verify
    if ((parsedPath === '/api/admin/verify' || parsedPath === '/verify') && (req.method === 'POST' || req.method === 'GET')) {
      try {
        if (!isConfigured()) {
          return sendJson(req, res, 503, {
            ok: false,
            valid: false,
            error: 'Administrator authentication is not configured on the backend.',
          })
        }

        let token = ''
        const authHeader = req.headers.authorization
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
          return sendJson(req, res, 401, {
            ok: false,
            valid: false,
            error: 'No session token provided.',
          })
        }

        const secret = getSessionSecret()
        const verification = verifyAdminToken(token, secret)

        if (!verification.valid || !verification.payload) {
          return sendJson(req, res, 401, {
            ok: false,
            valid: false,
            error: verification.error || 'Invalid or expired admin session token.',
          })
        }

        return sendJson(req, res, 200, {
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
      } catch (loginErr) {
        console.error('[admin-login-error]:', loginErr)
        return sendJson(req, res, 500, {
          ok: false,
          valid: false,
          error: 'Failed to verify admin session token.',
        })
      }
    }

    // 13. POST /api/admin/logout or /logout
    if ((parsedPath === '/api/admin/logout' || parsedPath === '/logout') && req.method === 'POST') {
      return sendJson(req, res, 200, { ok: true })
    }

    // Unknown admin sub-route
    return sendJson(req, res, 404, { ok: false, error: 'Endpoint not found' })
  }
}
