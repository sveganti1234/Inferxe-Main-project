import { CognitoJwtVerifier } from 'aws-jwt-verify'
import { getSupabaseAdminClient, isLocalMockSupabaseEnabled } from '../lib/supabase.js'
import { registerOrUpdateCustomer, getCustomerDetails } from '../database/customerDatabase.js'
import { upsertCustomerProfile } from '../database/supabaseCustomerService.js'
import { isAdminDevFallbackEnabled } from './adminSessionStore.js'
import { isTestRun } from '../lib/testSafety.js'

const MAX_BODY_BYTES = 16 * 1024
let verifier
let verifierConfig

function getCognitoVerifier() {
  const userPoolId = (
    process.env.COGNITO_USER_POOL_ID ||
    process.env.AWS_COGNITO_USER_POOL_ID ||
    process.env.VITE_COGNITO_USER_POOL_ID ||
    ''
  ).trim()
  const clientId = (
    process.env.COGNITO_CLIENT_ID ||
    process.env.AWS_COGNITO_CLIENT_ID ||
    process.env.VITE_COGNITO_CLIENT_ID ||
    ''
  ).trim()

  if (!userPoolId || !clientId) {
    throw new Error(
  'COGNITO_USER_POOL_ID and COGNITO_CLIENT_ID (or AWS_COGNITO_* equivalents) must be configured on the backend.'
)
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

  if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
    return null
  }

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

const PROFILE_SYNC_FAILED = {
  ok: false,
  code: 'PROFILE_SYNC_FAILED',
  error: 'Your customer profile could not be synchronized. Please try again or contact Inferxe support.',
}

async function syncProfile(
  req,
  res,
  {
    verifyToken = verifyCognitoIdToken,
    getSupabaseClient = getSupabaseAdminClient,
    // Write path (Supabase REST via supabaseCustomerService); injectable like the dependencies above.
    saveCustomerProfile = upsertCustomerProfile,
  } = {}
) {
  const token = getBearerToken(req)

  if (!token) {
    return sendJson(res, 401, {
      ok: false,
      error: 'A Cognito ID token is required.',
    })
  }

  let claims

  try {
    claims = await verifyToken(token)
  } catch (error) {
    console.warn(
      '[customer-auth] Cognito ID token rejected:',
      error.message
    )

    return sendJson(res, 401, {
      ok: false,
      error: 'Customer authentication could not be verified.',
    })
  }

  try {
    let existing = null
    try {
      const supabase = await getSupabaseClient()
      existing = await supabase
        .from('profiles')
        .select(
          'user_id, full_name, email, username, role, status, organization_id'
        )
        .eq('user_id', claims.sub)
        .maybeSingle()
    } catch (fetchErr) {
      console.warn('[customer-auth] Supabase profiles fetch exception:', fetchErr?.message)
    }

    if (existing?.error) {
      console.warn('[customer-auth] Supabase profiles query error:', existing.error?.message)
      if (!isTestRun() && (isAdminDevFallbackEnabled() || isLocalMockSupabaseEnabled())) {
        const localCustomer = getCustomerDetails(claims.sub) || getCustomerDetails(claims.email)
        if (localCustomer) {
          existing = {
            data: {
              user_id: localCustomer.cognito_sub || claims.sub,
              full_name: localCustomer.full_name,
              email: localCustomer.email,
              username: localCustomer.username || localCustomer.email.split('@')[0],
              role: localCustomer.role || 'customer',
              status: localCustomer.account_status || 'active',
              organization_id: null,
            },
            error: null,
          }
        }
      } else {
        throw existing.error
      }
    }

    // Block inactive or suspended accounts.
    if (
      existing.data?.status === 'suspended' ||
      existing.data?.status === 'inactive'
    ) {
      return sendJson(res, 403, {
        ok: false,
        error: 'This account is not active.',
      })
    }

    // Admins must use the separate administrator sign-in.
    if (existing.data?.role === 'admin') {
      return sendJson(res, 403, {
        ok: false,
        error: 'Use the separate administrator sign-in.',
      })
    }

    const email = claims.email.trim().toLowerCase()

    const fullName =
      (typeof claims.name === 'string' && claims.name.trim()) ||
      (typeof claims.preferred_username === 'string' &&
        claims.preferred_username.trim()) ||
      email.split('@')[0]

    const username =
      (typeof claims['cognito:username'] === 'string' &&
        claims['cognito:username']) ||
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

    let customerRecord = null
    try {
      customerRecord = await saveCustomerProfile({
        cognito_sub: claims.sub,
        full_name: fullName,
        email,
        phone_number: claims.phone_number || null,
        organization: explicitOrg,
        isLogin: true,
        claims,
      })
    } catch (err) {
      // A refused profile link (409) or an unavailable profile store (503) ends the sign-in: the customer
      // must not proceed with an identity that is not, or cannot be, bound to their own profile.
      if (err?.statusCode === 409 || err?.statusCode === 503) {
        return sendJson(res, err.statusCode, { ok: false, code: err.code, error: err.message })
      }
      console.error('[customer-auth] upsertCustomerProfile error:', err?.message)
      return sendJson(res, 500, PROFILE_SYNC_FAILED)
    }

    // Only a saved profile bound to this Cognito subject completes sign-in; token claims never stand in for it.
    if (!customerRecord?.cognito_sub || customerRecord.cognito_sub !== claims.sub) {
      console.error('[customer-auth] Profile synchronization returned no profile for this subject.')
      return sendJson(res, 500, PROFILE_SYNC_FAILED)
    }

    // Keep SQLite customer database in sync for Customer Management dashboard
    try {
      registerOrUpdateCustomer({
        cognito_sub: claims.sub,
        full_name: fullName,
        email,
        phone_number: claims.phone_number || null,
        organization: customerRecord.organization || explicitOrg || null,
        role: customerRecord.role,
        account_status: customerRecord.account_status,
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
        username: username || email.split('@')[0],
        role: customerRecord.role,
        status: customerRecord.account_status,
        organization: customerRecord.organization || null,
        organizationId: customerRecord.organization_id || null,
      },
    })
  } catch (error) {
    console.error(
      '[customer-auth] Profile synchronization failed:',
      error.message
    )

    if (!isTestRun() && (isAdminDevFallbackEnabled() || isLocalMockSupabaseEnabled())) {
      try {
        const email = claims.email.trim().toLowerCase()
        const fullName =
          (typeof claims.name === 'string' && claims.name.trim()) ||
          (typeof claims.preferred_username === 'string' && claims.preferred_username.trim()) ||
          email.split('@')[0]
        const username =
          (typeof claims['cognito:username'] === 'string' && claims['cognito:username']) ||
          email.split('@')[0]

        registerOrUpdateCustomer({
          cognito_sub: claims.sub,
          full_name: fullName,
          email,
          phone_number: claims.phone_number || null,
          role: 'customer',
          account_status: 'active',
          isLogin: true,
        })

        return sendJson(res, 200, {
          ok: true,
          profile: {
            id: claims.sub,
            fullName,
            email,
            username,
            role: 'customer',
            status: 'active',
            organization: 'Personal Workspace',
            organizationId: null,
          },
        })
      } catch (fallbackErr) {
        console.error('[customer-auth] Local fallback error:', fallbackErr?.message)
      }
    }

    return sendJson(res, 503, {
      ok: false,
      error: 'Customer profile synchronization is unavailable.',
    })
  }
}

export function createCustomerAuthMiddleware(dependencies = {}) {
  return async function customerAuthMiddleware(req, res, next) {
    const path = (req.url || '/').split('?')[0]

    if (
      path !== '/api/customer/profile/sync' ||
      req.method !== 'POST'
    ) {
      return next()
    }

    try {
      return await syncProfile(req, res, dependencies)
    } catch (error) {
      console.error('[customer-auth] Request failed:', error.message)

      return sendJson(res, error.statusCode || 500, {
        ok: false,
        error: error.statusCode
          ? error.message
          : 'Customer authentication request failed.',
      })
    }
  }
}

export async function authenticateCognitoRequest(req) {
  const token = getBearerToken(req)

  if (!token) {
    throw new Error('A Cognito ID token is required.')
  }

  // Customers are identified only by a verified Cognito ID token. No other token type (e.g. HS256 tokens
  // signed with the admin session secret) is ever accepted as a customer identity.
  return verifyCognitoIdToken(token)
}

export async function checkSupabaseConnection() {
  const { error } = await getSupabaseAdminClient()
    .from('profiles')
    .select('user_id')
    .limit(1)

  if (error) throw error

  return true
}

export async function readCustomerJsonBody(req) {
  return readJsonBody(req)
}

export { sendJson as sendCustomerJson }
