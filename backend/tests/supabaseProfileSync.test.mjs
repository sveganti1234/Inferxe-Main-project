import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import test from 'node:test'
import { verifyCognitoIdToken } from '../auth/cognitoIdToken.js'
import { upsertCognitoProfile } from '../database/supabaseProfiles.js'
import { createAdminAuthMiddleware } from '../auth/adminAuth.js'

function encodeBase64Url(value) {
  return Buffer.from(value).toString('base64url')
}

function createSignedToken(privateKey, claims, kid = 'test-key') {
  const header = encodeBase64Url(JSON.stringify({ alg: 'RS256', kid }))
  const payload = encodeBase64Url(JSON.stringify(claims))
  const signingInput = `${header}.${payload}`
  const signature = crypto.sign('RSA-SHA256', Buffer.from(signingInput), privateKey).toString('base64url')
  return `${signingInput}.${signature}`
}

const poolId = 'ap-south-1_testpool'
const clientId = 'test-client'
const issuer = `https://cognito-idp.ap-south-1.amazonaws.com/${poolId}`

test('verifies a Cognito ID token signature, issuer, client and expiration', async () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
  const jwk = publicKey.export({ format: 'jwk' })
  const nowSeconds = Math.floor(Date.now() / 1000)
  const claims = {
    iss: issuer,
    aud: clientId,
    token_use: 'id',
    sub: 'cognito-sub-123',
    email: 'verified@example.test',
    email_verified: true,
    name: 'Verified Customer',
    exp: nowSeconds + 300,
    iat: nowSeconds,
  }
  const token = createSignedToken(privateKey, claims)
  const fetchImpl = async () => new Response(JSON.stringify({
    keys: [{ ...jwk, kid: 'test-key', kty: 'RSA' }],
  }), { status: 200 })

  const verified = await verifyCognitoIdToken(`Bearer ${token}`, {
    userPoolId: poolId,
    clientId,
    fetchImpl,
    nowSeconds,
  })
  assert.equal(verified.sub, claims.sub)
  assert.equal(verified.email_verified, true)

  const invalid = await verifyCognitoIdToken(`Bearer ${createSignedToken(privateKey, {
    ...claims,
    aud: 'another-client',
  })}`, {
    userPoolId: poolId,
    clientId,
    fetchImpl,
    nowSeconds,
  })
  assert.equal(invalid, null)

  const { privateKey: unrelatedPrivateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
  const invalidSignature = await verifyCognitoIdToken(
    `Bearer ${createSignedToken(unrelatedPrivateKey, claims)}`,
    { userPoolId: poolId, clientId, fetchImpl, nowSeconds },
  )
  assert.equal(invalidSignature, null)
})

test('loads Cognito verification settings from the frontend Vite environment names', async () => {
  const vitePoolId = 'ap-south-1_viteconfigpool'
  const viteIssuer = `https://cognito-idp.ap-south-1.amazonaws.com/${vitePoolId}`
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
  const jwk = publicKey.export({ format: 'jwk' })
  const nowSeconds = Math.floor(Date.now() / 1000)
  const claims = {
    iss: viteIssuer,
    aud: clientId,
    token_use: 'id',
    sub: 'cognito-sub-vite-config',
    exp: nowSeconds + 300,
    iat: nowSeconds,
  }
  const token = createSignedToken(privateKey, claims)
  const fetchImpl = async () => new Response(JSON.stringify({
    keys: [{ ...jwk, kid: 'test-key', kty: 'RSA' }],
  }), { status: 200 })
  const envNames = [
    'AWS_COGNITO_USER_POOL_ID',
    'COGNITO_USER_POOL_ID',
    'VITE_COGNITO_USER_POOL_ID',
    'AWS_COGNITO_CLIENT_ID',
    'COGNITO_CLIENT_ID',
    'VITE_COGNITO_CLIENT_ID',
    'AWS_REGION',
    'COGNITO_REGION',
    'VITE_COGNITO_REGION',
  ]
  const previousValues = new Map(envNames.map((name) => [name, process.env[name]]))

  try {
    for (const name of envNames) delete process.env[name]
    process.env.VITE_COGNITO_USER_POOL_ID = vitePoolId
    process.env.VITE_COGNITO_CLIENT_ID = clientId
    process.env.VITE_COGNITO_REGION = 'ap-south-1'

    const verified = await verifyCognitoIdToken(`Bearer ${token}`, {
      fetchImpl,
      nowSeconds,
    })

    assert.equal(verified.sub, claims.sub)
  } finally {
    for (const [name, value] of previousValues) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
})

test('upserts only profile fields from the verified Cognito subject', async () => {
  let request
  await upsertCognitoProfile({
    sub: 'cognito-sub-123',
    email: 'CUSTOMER@example.test',
    name: 'Verified Customer',
    preferred_username: 'verified-customer',
  }, {
    supabaseUrl: 'https://supabase.example.test',
    serviceRoleKey: 'server-only-key',
    fetchImpl: async (url, options) => {
      request = { url: String(url), options }
      return new Response(null, { status: 204 })
    },
  })

  assert.equal(request.url, 'https://supabase.example.test/rest/v1/profiles?on_conflict=user_id')
  assert.equal(request.options.method, 'POST')
  assert.equal(request.options.headers.apikey, 'server-only-key')
  assert.equal(request.options.headers.Prefer, 'resolution=merge-duplicates,return=minimal')
  assert.deepEqual(JSON.parse(request.options.body), {
    user_id: 'cognito-sub-123',
    full_name: 'Verified Customer',
    email: 'customer@example.test',
    username: 'verified-customer',
  })
})

test('rejects profile writes without a Cognito subject or email', async () => {
  await assert.rejects(
    upsertCognitoProfile({ sub: 'cognito-sub-123' }, {
      supabaseUrl: 'https://supabase.example.test',
      serviceRoleKey: 'server-only-key',
      fetchImpl: async () => assert.fail('Supabase must not be called for invalid claims'),
    }),
    /subject or email/,
  )
})

test('profile sync endpoint requires a verified Cognito identity and upserts its sub', async () => {
  let upsertedClaims
  const middleware = createAdminAuthMiddleware({
    verifyCognitoIdToken: async (authorization) =>
      authorization === 'Bearer valid-id-token'
        ? { sub: 'cognito-sub-123', email: 'verified@example.test', email_verified: true }
        : null,
    upsertCognitoProfile: async (claims) => {
      upsertedClaims = claims
    },
  })

  async function send(authorization) {
    let responseBody = ''
    const response = {
      headers: {},
      setHeader(name, value) {
        this.headers[name] = value
      },
      end(body = '') {
        responseBody = body
      },
    }
    await middleware({
      url: '/api/customer/profile/sync',
      method: 'POST',
      headers: authorization ? { authorization } : {},
    }, response, () => assert.fail('Profile route must be handled by the middleware'))
    return { status: response.statusCode, data: JSON.parse(responseBody) }
  }

  const denied = await send()
  assert.equal(denied.status, 401)
  assert.equal(upsertedClaims, undefined)

  const unverifiedMiddleware = createAdminAuthMiddleware({
    verifyCognitoIdToken: async () => ({
      sub: 'cognito-sub-unverified',
      email: 'unverified@example.test',
      email_verified: false,
    }),
    upsertCognitoProfile: async () => assert.fail('Unverified customers must not be upserted'),
  })
  const unverifiedResponse = {
    setHeader() {},
    end(body) {
      this.body = body
    },
  }
  await unverifiedMiddleware({
    url: '/api/customer/profile/sync',
    method: 'POST',
    headers: { authorization: 'Bearer unverified-token' },
  }, unverifiedResponse, () => assert.fail('Profile route must be handled by the middleware'))
  assert.equal(unverifiedResponse.statusCode, 403)

  const accepted = await send('Bearer valid-id-token')
  assert.equal(accepted.status, 200)
  assert.equal(accepted.data.ok, true)
  assert.equal(upsertedClaims.sub, 'cognito-sub-123')
})
