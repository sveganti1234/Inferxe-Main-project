import { CognitoJwtVerifier } from 'aws-jwt-verify'
import { getSupabaseAdminClient } from '../lib/supabase.js'
import { registerOrUpdateCustomer } from '../database/customerDatabase.js'
import { upsertCustomerProfile } from '../database/supabaseCustomerService.js'

const MAX_BODY_BYTES = 16 * 1024
let verifier
let verifierConfig

function getCognitoVerifier() {
  const userPoolId = (process.env.AWS_COGNITO_USER_POOL_ID || process.env.COGNITO_USER_POOL_ID || process.env.VITE_COGNITO_USER_POOL_ID || '').trim()
  const clientId = (process.env.AWS_COGNITO_CLIENT_ID || process.env.COGNITO_CLIENT_ID || process.env.VITE_COGNITO_CLIENT_ID || '').trim()

  if (!userPoolId || !clientId) {
    throw new Error('AWS_COGNITO_USER_POOL_ID and AWS_COGNITO_CLIENT_ID must be configured on the backend.')
  }

  const config = `${userPoolId}:${clientId}`
  if (!verifier || verifierConfig !== config) {
    verifier = CognitoJwtVerifier.create({
      userPoolId,
      tokenUse: 'id',
      clientId,
    })
    verifierConfig = config
  }

  return verifier
}

function sendJson(res, statusCode, data) {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(data))
}

async function readJsonBody(req) {
  let body = ''
  for await (const chunk of req) {
    body += chunk
    if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) {
      const error = new Error('Payload too large.')
      error.statusCode = 413
      throw error
    }
  }

  if (!body.trim()) return {}
  try {
    return JSON.parse(body)
  } catch {
    const error = new Error('Request body must be valid JSON.')
    error.statusCode = 400
    throw error
  }
}

function getBearerToken(req) {
  const header = req.headers.authorization
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return null
  return header.slice(7).trim() || null
}

export async function verifyCognitoIdToken(token) {
  if (!token || token.split('.').length !== 3) {
    throw new Error('A valid Cognito ID token is required.')
  }

  const payload = await getCognitoVerifier().verify(token)
  if (typeof payload.sub !== 'string' || !payload.sub) {
    throw new Error('The Cognito ID token has no subject.')
  }
  const isEmailVerified =
    payload.email_verified === true ||
    payload.email_verified === 'true' ||
    (payload.email_verified !== false && payload.email_verified !== 'false' && payload['cognito:user_status'] === 'CONFIRMED')
  if (typeof payload.email !== 'string' || !payload.email || !isEmailVerified) {
    throw new Error('A verified email address is required on the Cognito account.')
  }

  return payload
}

async function syncProfile(req, res) {
  const token = getBearerToken(req)
  if (!token) {
    return sendJson(res, 401, { ok: false, error: 'A Cognito ID token is required.' })
  }

  let claims
  try {
    claims = await verifyCognitoIdToken(token)
  } catch (error) {
    console.warn('[customer-auth] Cognito ID token rejected:', error.message)
    return sendJson(res, 401, { ok: false, error: 'Customer authentication could not be verified.' })
  }

  try {
    const existing = await getSupabaseAdminClient()
      .from('profiles')
      .select('user_id, full_name, email, username, role, status, organization_id')
      .eq('user_id', claims.sub)
      .maybeSingle()

    if (existing.error) throw existing.error
    if (existing.data?.status === 'suspended') {
      return sendJson(res, 403, { ok: false, error: 'This account has been suspended.' })
    }
    if (existing.data?.role === 'admin') {
      return sendJson(res, 403, { ok: false, error: 'Use the separate administrator sign-in.' })
    }

    const email = claims.email.trim().toLowerCase()
    const fullName = (typeof claims.name === 'string' && claims.name.trim()) ||
      (typeof claims.preferred_username === 'string' && claims.preferred_username.trim()) ||
      email.split('@')[0]
    const username = (typeof claims['cognito:username'] === 'string' && claims['cognito:username']) ||
      email.split('@')[0]

    // Safely parse request body for optional customer profile attributes (e.g. organization entered during signup)
    let body = {}
    try {
      body = await readJsonBody(req)
    } catch (parseErr) {
      console.warn('[customer-auth] Could not parse request body for syncProfile:', parseErr?.message)
    }
    const explicitOrg = typeof body?.organization === 'string' && body.organization.trim()
      ? body.organization.trim()
      : null

    const customerRecord = await upsertCustomerProfile({
      cognito_sub: claims.sub,
      full_name: fullName,
      email,
      phone_number: claims.phone_number || null,
      organization: explicitOrg,
      isLogin: true,
      claims,
    })

    // Keep SQLite customer database in sync for Customer Management dashboard
    try {
      registerOrUpdateCustomer({
        cognito_sub: claims.sub,
        full_name: fullName,
        email,
        phone_number: claims.phone_number || null,
        organization: customerRecord.organization || null,
        role: customerRecord.role || 'customer',
        account_status: customerRecord.account_status || 'active',
        isLogin: true,
      })
    } catch (sqliteErr) {
      console.warn('[customer-auth] SQLite update warning:', sqliteErr?.message)
    }

    return sendJson(res, 200, {
      ok: true,
      profile: {
        id: customerRecord.cognito_sub,
        fullName: customerRecord.full_name,
        email: customerRecord.email,
        username: username || customerRecord.email.split('@')[0],
        role: customerRecord.role,
        status: customerRecord.account_status,
        organization: customerRecord.organization || null,
        organizationId: null,
      },
    })
  } catch (error) {
    console.error('[customer-auth] Profile synchronization failed:', error.message)
    return sendJson(res, 503, { ok: false, error: 'Customer profile synchronization is unavailable.' })
  }
}

export function createCustomerAuthMiddleware() {
  return async function customerAuthMiddleware(req, res, next) {
    const path = (req.url || '/').split('?')[0]
    if (path !== '/api/customer/profile/sync' || req.method !== 'POST') return next()

    try {
      return await syncProfile(req, res)
    } catch (error) {
      console.error('[customer-auth] Request failed:', error.message)
      return sendJson(res, error.statusCode || 500, {
        ok: false,
        error: error.statusCode ? error.message : 'Customer authentication request failed.',
      })
    }
  }
}

export async function authenticateCognitoRequest(req) {
  const token = getBearerToken(req)
  if (!token) throw new Error('A Cognito ID token is required.')
  return verifyCognitoIdToken(token)
}

export async function checkSupabaseConnection() {
  const { error } = await getSupabaseAdminClient().from('profiles').select('user_id').limit(1)
  if (error) throw error
  return true
}

export async function readCustomerJsonBody(req) {
  return readJsonBody(req)
}

export { sendJson as sendCustomerJson }
