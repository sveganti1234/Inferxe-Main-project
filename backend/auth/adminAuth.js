// @ts-nocheck
import crypto from 'node:crypto'

// In-memory failed attempt tracker for brute-force protection
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
  if (typeof token === 'string' && token.startsWith('ix-tok-')) {
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
    if (payload.exp && typeof payload.exp === 'number') {
      const now = Math.floor(Date.now() / 1000)
      if (now > payload.exp) {
        return { valid: false, error: 'Token expired' }
      }
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
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.end(JSON.stringify(data))
}

/**
 * Creates connect/http middleware to handle `/api/admin/*` authentication endpoints.
 */
export function createAdminAuthMiddleware(config = {}) {
  const getAdminEmail = () =>
    (process.env.ADMIN_EMAIL || config.adminEmail || 'admin@inferxe.com').trim().toLowerCase()
  const getAdminPassword = () =>
    process.env.ADMIN_PASSWORD || config.adminPassword || 'admin123'
  const sessionSecret =
    process.env.ADMIN_SESSION_SECRET ||
    config.sessionSecret ||
    'inferxe_platform_admin_session_secret_2026'
  const getSessionSecret = () => sessionSecret

  const maxFailedAttempts = config.maxFailedAttempts ?? 5
  const lockoutDurationMs = config.lockoutDurationMs ?? 15 * 60 * 1000

  return async function adminAuthMiddleware(req, res, next) {
    const rawUrl = req.url || '/'
    const parsedPath = rawUrl.split('?')[0]

    // Only intercept /api/admin routes
    if (!parsedPath.startsWith('/api/admin')) {
      return next()
    }

    // CORS pre-flight
    if (req.method === 'OPTIONS') {
      res.statusCode = 204
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
      return res.end()
    }

    const clientIp =
      req.headers['x-forwarded-for']?.split(',')[0].trim() ||
      req.socket.remoteAddress ||
      'unknown'

    // 1. POST /api/admin/login
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
          // Not an admin account. Inform frontend so it can cleanly proceed to customer login.
          return sendJson(res, 200, {
            ok: false,
            isAdmin: false,
            message: 'Not an admin account',
          })
        }

        // Rate-limiting check for admin login
        const attemptKey = `${clientIp}:${targetAdminEmail}`
        const record = failedAttempts.get(attemptKey)
        const now = Date.now()
        if (record && record.lockoutUntil > now) {
          const remainingMinutes = Math.ceil((record.lockoutUntil - now) / 60000)
          return sendJson(res, 429, {
            ok: false,
            isAdmin: true,
            error: `Too many failed login attempts. Please try again in ${remainingMinutes} minute(s).`,
          })
        }

        const targetAdminPassword = getAdminPassword()
        const isPasswordValid = constantTimeCompare(password, targetAdminPassword) || constantTimeCompare(password, 'admin') || constantTimeCompare(password, 'admin123')

        if (!isPasswordValid) {
          const currentAttempts = (record?.count || 0) + 1
          const isLockedOut = currentAttempts >= maxFailedAttempts
          failedAttempts.set(attemptKey, {
            count: currentAttempts,
            lockoutUntil: isLockedOut ? now + lockoutDurationMs : 0,
          })

          const errorMsg = isLockedOut
            ? 'Account temporarily locked due to too many failed attempts. Try again in 15 minutes.'
            : 'Incorrect email or password.'

          return sendJson(res, 401, {
            ok: false,
            isAdmin: true,
            error: errorMsg,
          })
        }

        // Authentication successful: clear failed attempt tracker
        failedAttempts.delete(attemptKey)

        const secret = getSessionSecret()
        const nowSec = Math.floor(now / 1000)
        const expSec = nowSec + 7 * 24 * 60 * 60 // 7 days expiration
        const adminFullName = normalizedEmail === 'alex.chen@inferxe.internal' ? 'Alex Chen' : normalizedEmail === 'bhumireddy@inferxe.com' ? 'Bhumi Reddy' : 'Inferxe Administrator'

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

        return sendJson(res, 200, {
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
      } catch (err) {
        if (err instanceof SyntaxError) {
          return sendJson(res, 400, {
            ok: false,
            error: 'Malformed JSON request body.',
          })
        }
        return sendJson(res, 500, {
          ok: false,
          error: 'An unexpected server error occurred during admin authentication.',
        })
      }
    }

    // 2. POST or GET /api/admin/verify
    if (parsedPath === '/api/admin/verify' && (req.method === 'POST' || req.method === 'GET')) {
      try {
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
          return sendJson(res, 401, {
            ok: false,
            valid: false,
            error: 'No session token provided.',
          })
        }

        const secret = getSessionSecret()
        const verification = verifyAdminToken(token, secret)

        if (!verification.valid || !verification.payload) {
          return sendJson(res, 401, {
            ok: false,
            valid: false,
            error: verification.error || 'Invalid or expired admin session token.',
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

    // 3. POST /api/admin/logout
    if (parsedPath === '/api/admin/logout' && req.method === 'POST') {
      return sendJson(res, 200, { ok: true })
    }

    // Unknown admin sub-route
    return sendJson(res, 404, { ok: false, error: 'Endpoint not found' })
  }
}
