// Security regression tests for /api/customer/activity, /heartbeat and /logout (backend/auth/adminAuth.js).
// The customer must be derived from a verified Cognito ID token, never from email/cognito_sub in the body.
// Hermetic: test RSA key + in-memory JWKS, recording stubs for the Supabase presence/profile store,
// a temporary SQLite file, and no Supabase credentials in the environment.
import './support/networkGuard.mjs'  // test isolation guard: must stay the first import (tests/testSafety.test.mjs checks)
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

// supabaseCustomerService.js loads backend/.env on import and fills unset or empty values, so point the
// Supabase settings at a closed local port instead of deleting them: nothing can reach a real project.
process.env.SUPABASE_URL = 'http://127.0.0.1:9'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-disabled'
delete process.env.SUPABASE_SECRET_KEY
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inferxe-presence-'))
process.env.CUSTOMER_DB_PATH = path.join(tmpDir, 'customers.db')

const { createAdminAuthMiddleware, createAdminToken } = await import('../auth/adminAuth.js')
const { registerOrUpdateCustomer, getDatabase, closeDatabase } = await import('../database/customerDatabase.js')

const poolId = 'ap-south-1_testpool'
const clientId = 'test-client'
const issuer = `https://cognito-idp.ap-south-1.amazonaws.com/${poolId}`
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
const { privateKey: attackerKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwk = publicKey.export({ format: 'jwk' })
const fetchJwks = async () => new Response(JSON.stringify({ keys: [{ ...jwk, kid: 'k1', kty: 'RSA' }] }), { status: 200 })

function sign(claims, key = privateKey) {
  const enc = (v) => Buffer.from(JSON.stringify(v)).toString('base64url')
  const input = `${enc({ alg: 'RS256', kid: 'k1' })}.${enc(claims)}`
  return `${input}.${crypto.sign('RSA-SHA256', Buffer.from(input), key).toString('base64url')}`
}

function idToken(overrides = {}) {
  const now = Math.floor(Date.now() / 1000)
  return sign({
    iss: issuer, aud: clientId, token_use: 'id', sub: 'sub-alice', email: 'alice@example.test',
    email_verified: true, iat: now - 10, exp: now + 3600, ...overrides,
  })
}

const ALICE = { cognito_sub: 'sub-alice', email: 'alice@example.test' }
const VICTIM = { cognito_sub: 'sub-bob', email: 'bob@example.test' }

function setup(extra = {}) {
  const calls = { upsert: [], heartbeat: [], logout: [] }
  const middleware = createAdminAuthMiddleware({
    userPoolId: poolId,
    clientId,
    fetchImpl: fetchJwks,
    upsertCustomerProfile: async (args) => { calls.upsert.push(args); return { ...args } },
    updateCustomerHeartbeat: async (args) => { calls.heartbeat.push(args); return true },
    recordCustomerLogout: async (args) => { calls.logout.push(args); return true },
    ...extra,
  })
  async function call(url, { token, body = {} } = {}) {
    const req = {
      url, method: 'POST', body,
      headers: token ? { authorization: `Bearer ${token}` } : {},
      socket: { remoteAddress: '127.0.0.1' },
    }
    let status = 200
    let raw = ''
    const res = {
      get statusCode() { return status }, set statusCode(v) { status = v },
      setHeader() {}, getHeader() {}, writeHead(c) { status = c }, end(b = '') { raw += b },
    }
    await middleware(req, res, () => { status = 404 })
    return { status, json: raw ? JSON.parse(raw) : {} }
  }
  return { calls, call }
}

const ENDPOINTS = ['/api/customer/activity', '/api/customer/heartbeat', '/api/customer/logout']
const noStoreCalls = (calls) => calls.upsert.length + calls.heartbeat.length + calls.logout.length === 0

test('unauthenticated requests are rejected and touch nothing', async () => {
  const { calls, call } = setup()
  for (const url of ENDPOINTS) {
    const r = await call(url, { body: { ...ALICE, session_id: 's1', isLogin: true } })
    assert.equal(r.status, 401, url)
    assert.equal(r.json.ok, false)
  }
  assert.ok(noStoreCalls(calls))
})

test('a forged email/cognito_sub without a token cannot act for another customer', async () => {
  const { calls, call } = setup()
  for (const url of ENDPOINTS) {
    assert.equal((await call(url, { body: { ...VICTIM, full_name: 'Pwned' } })).status, 401, url)
  }
  assert.ok(noStoreCalls(calls))
})

test('expired, wrong-audience, wrong-issuer, forged-signature and malformed tokens are rejected', async () => {
  const { calls, call } = setup()
  const now = Math.floor(Date.now() / 1000)
  const bad = {
    expired: idToken({ exp: now - 60, iat: now - 3600 }),
    wrongAudience: idToken({ aud: 'other-client' }),
    wrongIssuer: idToken({ iss: 'https://cognito-idp.ap-south-1.amazonaws.com/ap-south-1_other' }),
    accessToken: idToken({ token_use: 'access' }),
    forgedSignature: sign({ iss: issuer, aud: clientId, token_use: 'id', sub: 'sub-bob', iat: now, exp: now + 3600 }, attackerKey),
    malformed: 'not-a-jwt',
  }
  for (const [name, token] of Object.entries(bad)) {
    for (const url of ENDPOINTS) {
      assert.equal((await call(url, { token })).status, 401, `${name} ${url}`)
    }
  }
  assert.ok(noStoreCalls(calls))
})

test('a valid token acts only for its own customer, whatever identity the body names', async () => {
  const { calls, call } = setup()
  const token = idToken()
  const body = { ...VICTIM, session_id: 'tab-1', isLogin: true }

  assert.equal((await call('/api/customer/heartbeat', { token, body })).status, 200)
  assert.deepEqual(calls.heartbeat, [{ ...ALICE, session_id: 'tab-1' }])

  assert.equal((await call('/api/customer/logout', { token, body })).status, 200)
  assert.deepEqual(calls.logout, [{ ...ALICE, session_id: 'tab-1' }])  // only Alice's tab session is closed

  assert.equal((await call('/api/customer/activity', { token, body })).status, 200)
  assert.equal(calls.upsert.length, 1)
  assert.equal(calls.upsert[0].cognito_sub, ALICE.cognito_sub)
  assert.equal(calls.upsert[0].email, ALICE.email)
  assert.equal(calls.upsert[0].isLogin, true)
})

test('admin session tokens cannot use customer endpoints', async () => {
  const { calls, call } = setup()
  const now = Math.floor(Date.now() / 1000)
  const adminToken = createAdminToken(
    { sub: 'adm-1', sid: 'sess-1', sv: 1, role: 'superadmin', email: 'admin@inferxe.com', iat: now, exp: now + 600 },
    'test-only-admin-signing-secret-with-adequate-length',
  )
  for (const url of ENDPOINTS) {
    assert.equal((await call(url, { token: adminToken, body: ALICE })).status, 401, url)
  }
  assert.ok(noStoreCalls(calls))
})

test('Cognito accounts flagged as admin or using a superadmin email are refused with 403', async () => {
  const { calls, call } = setup()
  for (const token of [idToken({ role: 'admin' }), idToken({ sub: 'sub-adm', email: 'admin@inferxe.com' })]) {
    for (const url of ENDPOINTS) {
      assert.equal((await call(url, { token })).status, 403, url)
    }
  }
  assert.ok(noStoreCalls(calls))
})

test('activity cannot change role or reactivate a suspended account', async () => {
  registerOrUpdateCustomer({
    cognito_sub: 'sub-carol', email: 'carol@example.test', role: 'customer', account_status: 'suspended',
  })
  const { calls, call } = setup()
  const token = idToken({ sub: 'sub-carol', email: 'carol@example.test' })
  const r = await call('/api/customer/activity', {
    token, body: { role: 'admin', account_status: 'active', full_name: 'Carol', isLogin: true },
  })
  assert.equal(r.status, 200)
  assert.equal(calls.upsert[0].role, undefined)
  assert.equal(calls.upsert[0].account_status, undefined)
  const row = getDatabase().prepare('SELECT role, account_status FROM customers WHERE cognito_sub = ?').get('sub-carol')
  assert.equal(row.role, 'customer')
  assert.equal(row.account_status, 'suspended')
})

test('verifier outage is a 503 and store errors are not echoed to the client', async () => {
  const outage = setup({ verifyCognitoIdToken: async () => { throw new Error('jwks fetch failed') } })
  assert.equal((await outage.call('/api/customer/heartbeat', { token: idToken() })).status, 503)
  assert.ok(noStoreCalls(outage.calls))

  const failing = setup({
    updateCustomerHeartbeat: async () => { throw new Error('internal db detail: relation profiles') },
  })
  const r = await failing.call('/api/customer/heartbeat', { token: idToken() })
  assert.equal(r.status, 500)
  assert.ok(!JSON.stringify(r.json).includes('internal db detail'))
})

test.after(() => {
  try { closeDatabase() } catch {}
  fs.rmSync(tmpDir, { recursive: true, force: true })
})
