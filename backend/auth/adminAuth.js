// @ts-nocheck
import crypto from 'node:crypto'

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
    if (typeof payload.exp !== 'number' || now >= payload.exp) {
      return { valid: false, error: 'Token expired or missing expiration' }
    }
    if (typeof payload.iat !== 'number' || payload.iat > now) {
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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, X-Requested-With')
  res.setHeader('Access-Control-Max-Age', '600')
  res.setHeader('Vary', 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers')
}

function sendJson(req, res, statusCode, data) {
  res.statusCode = statusCode
  setCorsHeaders(req, res)
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(data))
}

/**
 * Creates connect/http middleware to handle `/api/admin/*` authentication endpoints.
 */
export function createAdminAuthMiddleware(config = {}) {
  const getAdminEmail = () =>
    (process.env.ADMIN_EMAIL || config.adminEmail || '').trim().toLowerCase()
  const getAdminPassword = () => process.env.ADMIN_PASSWORD || config.adminPassword || ''
  const getSessionSecret = () => process.env.ADMIN_SESSION_SECRET || config.sessionSecret || ''
  const isConfigured = () =>
    Boolean(getAdminEmail() && getAdminPassword() && getSessionSecret().length >= 32)

  return async function adminAuthMiddleware(req, res, next) {
    const rawUrl = req.url || '/'
    const parsedPath = rawUrl.split('?')[0]

    // Only intercept /api/admin routes
    if (!parsedPath.startsWith('/api/admin')) {
      return next()
    }

    // CORS pre-flight
    if (req.method === 'OPTIONS') {
      setCorsHeaders(req, res)
      res.statusCode = 204
      return res.end()
    }

    const clientIp = req.socket.remoteAddress || 'unknown'

    // 1. POST /api/admin/login
    if (parsedPath === '/api/admin/login' && req.method === 'POST') {
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
        if (normalizedEmail !== targetAdminEmail) {
          // Not an admin account. Inform frontend so it can cleanly proceed to customer login.
          return sendJson(req, res, 200, {
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
      } catch {
        return sendJson(req, res, 500, {
          ok: false,
          error: 'An unexpected server error occurred during admin authentication.',
        })
      }
    }

    // 2. POST or GET /api/admin/verify
    if (parsedPath === '/api/admin/verify' && (req.method === 'POST' || req.method === 'GET')) {
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
      } catch {
        return sendJson(req, res, 500, {
          ok: false,
          valid: false,
          error: 'Failed to verify admin session token.',
        })
      }
    }

    // 3. POST /api/admin/logout
    if (parsedPath === '/api/admin/logout' && req.method === 'POST') {
      return sendJson(req, res, 200, { ok: true })
    }

    // Unknown admin sub-route
    return sendJson(req, res, 404, { ok: false, error: 'Endpoint not found' })
  }
}
