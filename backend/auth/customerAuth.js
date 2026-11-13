
import { CognitoJwtVerifier } from 'aws-jwt-verify'
import { getSupabaseAdminClient } from '../lib/supabase.js'

const MAX_BODY_BYTES = 16 * 1024
let verifier
let verifierConfig

function getCognitoVerifier() {
  const userPoolId =
    (process.env.COGNITO_USER_POOL_ID || process.env.AWS_COGNITO_USER_POOL_ID)?.trim()
  const clientId =
    (process.env.COGNITO_CLIENT_ID || process.env.AWS_COGNITO_CLIENT_ID)?.trim()

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

  if (
    typeof payload.email !== 'string' ||
    !payload.email ||
    payload.email_verified !== true
  ) {
    throw new Error(
      'A verified email address is required on the Cognito account.'
    )
  }

  return payload
}

async function syncProfile(
  req,
  res,
  {
    verifyToken = verifyCognitoIdToken,
    getSupabaseClient = getSupabaseAdminClient,
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
    const supabase = await getSupabaseClient()

    // Check whether this customer already has a profile.
    const existing = await supabase
      .from('profiles')
      .select(
        'user_id, full_name, email, username, role, status, organization_id'
      )
      .eq('user_id', claims.sub)
      .maybeSingle()

    if (existing.error) {
      throw existing.error
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

    // Create or synchronize the profile and organization atomically.
    let profile = null
    if (typeof supabase.rpc === 'function') {
      const { data, error } = await supabase.rpc(
        'sync_customer_profile',
        {
          p_user_id: claims.sub,
          p_full_name: fullName,
          p_email: email,
          p_username: username,
        }
      )

      if (error) {
        if (error.code === '23505') {
          return sendJson(res, 409, {
            ok: false,
            error: 'This email is already linked to another account.',
          })
        }

        throw error
      }

      profile = data
    } else if (typeof supabase.from === 'function') {
      // Fallback: direct table upsert if RPC is unavailable in client/mock
      const { data, error } = await supabase
        .from('profiles')
        .upsert({
          user_id: claims.sub,
          full_name: fullName,
          email,
          username,
        })
        .select()
        .single()

      if (error) {
        if (error.code === '23505') {
          return sendJson(res, 409, {
            ok: false,
            error: 'This email is already linked to another account.',
          })
        }
        throw error
      }

      profile = data
    }

    if (!profile) {
      throw new Error(
        'Customer profile synchronization returned no profile.'
      )
    }

    return sendJson(res, 200, {
      ok: true,
      profile: {
        id: profile.user_id,
        fullName: profile.full_name,
        email: profile.email,
        username:
          profile.username || profile.email.split('@')[0],
        role: profile.role,
        status: profile.status,
        organizationId: profile.organization_id,
      },
    })
  } catch (error) {
    console.error(
      '[customer-auth] Profile synchronization failed:',
      error.message
    )

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
