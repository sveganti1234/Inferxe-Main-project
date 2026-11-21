import crypto from 'node:crypto'

const jwksCache = new Map()
const JWKS_CACHE_DURATION_MS = 60 * 60 * 1000

function decodeBase64Url(value) {
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

async function getJwks(jwksUrl, fetchImpl) {
  const cached = jwksCache.get(jwksUrl)
  if (cached && cached.expiresAt > Date.now()) return cached.keys

  const response = await fetchImpl(jwksUrl, { headers: { Accept: 'application/json' } })
  if (!response.ok) throw new Error(`Cognito signing keys could not be loaded (${response.status}).`)

  const data = await response.json()
  if (!Array.isArray(data.keys)) throw new Error('Cognito signing keys response was invalid.')

  jwksCache.set(jwksUrl, {
    keys: data.keys,
    expiresAt: Date.now() + JWKS_CACHE_DURATION_MS,
  })
  return data.keys
}

export async function verifyCognitoIdToken(
  authorizationHeader,
  {
    userPoolId =
      process.env.AWS_COGNITO_USER_POOL_ID ||
      process.env.COGNITO_USER_POOL_ID ||
      process.env.VITE_COGNITO_USER_POOL_ID,
    clientId =
      process.env.AWS_COGNITO_CLIENT_ID ||
      process.env.COGNITO_CLIENT_ID ||
      process.env.VITE_COGNITO_CLIENT_ID,
    region =
      process.env.AWS_REGION ||
      process.env.COGNITO_REGION ||
      process.env.VITE_COGNITO_REGION,
    fetchImpl = globalThis.fetch,
    nowSeconds = Math.floor(Date.now() / 1000),
  } = {},
) {
  const match = typeof authorizationHeader === 'string'
    ? authorizationHeader.match(/^Bearer\s+([^\s]+)$/i)
    : null
  if (!match) return null

  if (!userPoolId || !clientId) {
    throw new Error('Cognito token verification is not configured.')
  }

  const poolRegion = userPoolId.split('_')[0]
  const cognitoRegion = region || poolRegion
  if (poolRegion !== cognitoRegion) {
    throw new Error('Cognito token verification region does not match the user pool.')
  }

  const token = match[1]
  const parts = token.split('.')
  if (parts.length !== 3) return null

  let header
  let claims
  try {
    header = JSON.parse(decodeBase64Url(parts[0]).toString('utf8'))
    claims = JSON.parse(decodeBase64Url(parts[1]).toString('utf8'))
  } catch {
    return null
  }

  if (header.alg !== 'RS256' || typeof header.kid !== 'string') return null

  const issuer = `https://cognito-idp.${cognitoRegion}.amazonaws.com/${userPoolId}`
  if (
    claims.iss !== issuer ||
    claims.aud !== clientId ||
    claims.token_use !== 'id' ||
    typeof claims.sub !== 'string' ||
    !claims.sub ||
    typeof claims.exp !== 'number' ||
    claims.exp <= nowSeconds ||
    typeof claims.iat !== 'number' ||
    claims.iat > nowSeconds + 60
  ) {
    return null
  }

  const jwksUrl = `${issuer}/.well-known/jwks.json`
  let keys = await getJwks(jwksUrl, fetchImpl)
  let signingKey = keys.find((key) => key.kid === header.kid && key.kty === 'RSA')

  if (!signingKey) {
    jwksCache.delete(jwksUrl)
    keys = await getJwks(jwksUrl, fetchImpl)
    signingKey = keys.find((key) => key.kid === header.kid && key.kty === 'RSA')
  }
  if (!signingKey) return null

  try {
    const publicKey = crypto.createPublicKey({ key: signingKey, format: 'jwk' })
    const signature = decodeBase64Url(parts[2])
    const validSignature = crypto.verify(
      'RSA-SHA256',
      Buffer.from(`${parts[0]}.${parts[1]}`),
      publicKey,
      signature,
    )
    return validSignature ? claims : null
  } catch {
    return null
  }
}
