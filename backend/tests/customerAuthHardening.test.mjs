import './support/networkGuard.mjs'  // test isolation guard: must stay the first import (tests/testSafety.test.mjs checks)
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

// Regression tests for the customer authentication remediation:
//  - no customer login through the admin endpoint (former hardcoded credentials), no HS256 customer identities;
//  - customer context fails closed when Supabase is unavailable (no fabricated identity or organization);
//  - sign-in profile sync never re-keys or inherits another identity's profile, and never silently
//    changes inactive / pending / suspended status.
// Supabase REST and Cognito are stubbed; nothing leaves the process.

const SECRET = 'test-only-admin-signing-secret-with-adequate-length'
process.env.SUPABASE_URL = 'http://127.0.0.1:9'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only-service-key'
process.env.ADMIN_SESSION_SECRET = SECRET
process.env.COGNITO_USER_POOL_ID = 'ap-south-1_TestPool1'
process.env.COGNITO_CLIENT_ID = 'test-client-id'
delete process.env.CUSTOMER_EMAIL
delete process.env.CUSTOMER_PASSWORD
// Successful profile syncs mirror the customer into SQLite: keep that in a temporary file, never the dev database.
const sqliteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inferxe-auth-hardening-'))
process.env.CUSTOMER_DB_PATH = path.join(sqliteDir, 'customers.db')

const { createAdminAuthMiddleware, createAdminToken } = await import('../auth/adminAuth.js')
const { hashPassword } = await import('../auth/adminPassword.js')
const { authenticateCognitoRequest, createCustomerAuthMiddleware } = await import('../auth/customerAuth.js')
const { getCustomerContext, createSupabaseApiMiddleware } = await import('../api/supabaseApi.js')
const { upsertCustomerProfile } = await import('../database/supabaseCustomerService.js')

const { closeDatabase, getDatabasePath } = await import('../database/customerDatabase.js')
test.after(() => {
  try { closeDatabase() } catch {}
  fs.rmSync(sqliteDir, { recursive: true, force: true })
})

test('0. customer SQLite writes go to an isolated temporary database', () => {
  assert.equal(path.dirname(getDatabasePath()), sqliteDir)
})

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const ARGON2_SKIP = typeof crypto.argon2Sync === 'function' ? false : 'needs crypto.argon2Sync (Node >= 24.7)'

function mockAdminStore(tables) {
  return {
    from(name) {
      const st = { op: 'select', filters: [], payload: null }
      const run = async (single) => {
        const rows = (tables[name] ||= [])
        if (st.op === 'insert') {
          const record = { id: crypto.randomUUID(), created_at: new Date().toISOString(), ...st.payload }
          rows.push(record)
          return { data: record, error: null }
        }
        const hits = rows.filter((r) => st.filters.every(([f, v]) => String(r[f]) === String(v)))
        if (st.op === 'update') { hits.forEach((r) => Object.assign(r, st.payload)); return { data: hits, error: null } }
        return { data: single ? hits[0] || null : hits, error: null }
      }
      const b = {
        select() { return b }, insert(p) { st.op = 'insert'; st.payload = p; return b },
        update(p) { st.op = 'update'; st.payload = p; return b }, eq(f, v) { st.filters.push([f, v]); return b },
        is() { return b }, order() { return b }, limit() { return b },
        maybeSingle() { return run(true) }, single() { return run(true) }, then(res, rej) { return run(false).then(res, rej) },
      }
      return b
    },
  }
}

function call(mw, method, url, { body, token } = {}) {
  const req = Readable.from(body ? [JSON.stringify(body)] : [])
  Object.assign(req, {
    method, url, socket: { remoteAddress: `10.7.0.${Math.floor(Math.random() * 200) + 1}` },
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  })
  const res = {
    statusCode: 200, headers: {}, body: '',
    setHeader(n, v) { this.headers[n.toLowerCase()] = v }, getHeader(n) { return this.headers[n.toLowerCase()] },
    writeHead(c, h = {}) { this.statusCode = c; Object.assign(this.headers, h) }, end(chunk = '') { this.body += chunk },
  }
  return Promise.resolve(mw(req, res, () => { res.statusCode = 404 })).then(() => ({ status: res.statusCode, json: JSON.parse(res.body || '{}') }))
}

/** Stub Supabase REST for the profiles table: rows keyed by user_id; records every request. */
function stubProfiles(initialRows, { failLookups = false } = {}) {
  const rows = initialRows.map((r) => ({ ...r }))
  const calls = []
  const real = globalThis.fetch
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input))
    const method = init.method || 'GET'
    const body = init.body ? JSON.parse(init.body) : null
    calls.push({ method, path: url.pathname, query: url.search, body })
    const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
    if (url.pathname === '/rest/v1/audit_logs') return new Response(null, { status: 201 })
    if (url.pathname !== '/rest/v1/profiles') return json({ message: 'unexpected table' }, 404)
    const eq = (field) => url.searchParams.get(field)?.replace(/^eq\./, '')
    if (method === 'GET') {
      if (failLookups) return json({ message: 'unavailable' }, 500)
      const byId = eq('user_id'), byEmail = eq('email')
      return json(rows.filter((r) => (byId ? r.user_id === byId : true) && (byEmail ? r.email === byEmail : true)))
    }
    if (method === 'PATCH') {
      const target = rows.find((r) => r.user_id === eq('user_id'))
      if (target) Object.assign(target, body)
      return json(target ? [target] : [])
    }
    if (method === 'POST') { rows.push(body); return json([body], 201) }
    return json({}, 405)
  }
  return { rows, calls, writes: () => calls.filter((c) => c.method !== 'GET' && c.path === '/rest/v1/profiles'), restore: () => { globalThis.fetch = real } }
}

const customer = (over = {}) => ({
  user_id: 'sub-owner-1', email: 'owner@example.test', full_name: 'Owner', username: 'owner', role: 'customer',
  status: 'active', login_count: 1, created_at: '2026-01-01T00:00:00.000Z', ...over,
})
const signIn = (over = {}) => upsertCustomerProfile({ cognito_sub: 'sub-owner-1', email: 'owner@example.test', full_name: 'Owner', isLogin: true, claims: {}, ...over })

// ── 1. Former hardcoded customer credentials ────────────────────────────────────────────────────

test('1. the admin login endpoint never issues customer tokens (former CUSTOMER_EMAIL/CUSTOMER_PASSWORD backdoor)', async () => {
  const mw = createAdminAuthMiddleware({ supabaseClient: mockAdminStore({}), sessionSecret: SECRET })
  // Bait configuration the removed branch would have honoured. The leaked password is deliberately not
  // repeated in the repository; test 5 proves the branch and its defaults are gone from the source.
  process.env.CUSTOMER_EMAIL = 'bait-customer@example.test'
  process.env.CUSTOMER_PASSWORD = 'Bait-Password-123!'
  try {
    for (const [email, password] of [['bait-customer@example.test', 'Bait-Password-123!']]) {
      const { json } = await call(mw, 'POST', '/api/admin/login', { body: { email, password } })
      assert.equal(json.token, undefined, email)
      assert.equal(json.ok, false)
      assert.notEqual(json.isCustomer, true)
    }
  } finally {
    delete process.env.CUSTOMER_EMAIL
    delete process.env.CUSTOMER_PASSWORD
  }
})

// ── 2/3. Customer identities only from verified Cognito ID tokens ───────────────────────────────

const bearerReq = (token) => ({ headers: { authorization: `Bearer ${token}` } })

test('2. customer endpoints reject HS256 tokens signed with the admin session secret', async () => {
  const customerLike = createAdminToken({ sub: 'customer-sub-1', email: 'x@example.test', role: 'customer',
    iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 }, SECRET)
  const adminLike = createAdminToken({ sub: 'adm-1', sid: 's1', sv: 1, role: 'admin',
    iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 }, SECRET)
  for (const token of [customerLike, adminLike]) {
    await assert.rejects(authenticateCognitoRequest(bearerReq(token)))
    const { status } = await call(createSupabaseApiMiddleware(), 'GET', '/api/customer/workspace', { token })
    assert.equal(status, 401)
  }
})

test('3. invalid Cognito tokens cannot create or update a customer profile', async () => {
  let saved = 0
  const mw = createCustomerAuthMiddleware({ saveCustomerProfile: async () => { saved++ } })
  const forgedRs256 = `${Buffer.from('{"alg":"RS256","kid":"k"}').toString('base64url')}.${Buffer.from('{"sub":"victim","email":"v@example.test","email_verified":true,"token_use":"id"}').toString('base64url')}.c2ln`
  for (const token of [undefined, 'not-a-jwt', forgedRs256, createAdminToken({ sub: 'x', exp: Math.floor(Date.now() / 1000) + 60 }, SECRET)]) {
    const { status } = await call(mw, 'POST', '/api/customer/profile/sync', { token, body: {} })
    assert.equal(status, 401)
  }
  assert.equal(saved, 0)
})

// ── 4/5. Fail closed, no fabricated defaults ────────────────────────────────────────────────────

test('4. Supabase unavailability yields 503, never a fabricated customer context', async () => {
  const saved = process.env.SUPABASE_URL
  process.env.SUPABASE_URL = 'ftp://127.0.0.1:9'  // the admin client factory rejects it
  try {
    const claims = { sub: 'sub-x', email: 'x@example.test', role: 'admin' }
    await assert.rejects(getCustomerContext({ headers: {} }, { authenticate: async () => claims }), (err) => err.statusCode === 503)
  } finally { process.env.SUPABASE_URL = saved }
})

test('5. no hardcoded customer identity, credentials or fabricated organization remain', () => {
  const files = ['backend/api/supabaseApi.js', 'backend/auth/adminAuth.js', 'backend/auth/customerAuth.js',
    'frontend/src/lib/authStore.ts', 'frontend/src/pages/Login.tsx']
  for (const rel of files) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8')
    for (const banned of ['sahith490522mnp', 'cust_sahith', 'org_sahith_dev', 'c1030d2a', 'CUSTOMER_PASSWORD', 'CUSTOMER_EMAIL',
      'getDevWorkspace', 'isDevFallback']) {
      assert.ok(!src.includes(banned), `${rel} still contains ${banned}`)
    }
    assert.ok(!/isCustomer/.test(src), `${rel} still has the isCustomer login result`)  // isCustomerRoute is routing
  }
})

// ── 6-11. Profile linking ───────────────────────────────────────────────────────────────────────

test('6. an inactive profile stays inactive on sign-in sync', async () => {
  const db = stubProfiles([customer({ status: 'inactive' })])
  try {
    await signIn()
    assert.equal(db.rows[0].status, 'inactive')
  } finally { db.restore() }
})

test('7. pending profiles are only activated by their own invited identity signing in', async () => {
  let db = stubProfiles([customer({ status: 'pending' })])
  try {
    await signIn({ isLogin: false })
    assert.equal(db.rows[0].status, 'pending', 'no activation without a sign-in')
    await signIn()
    assert.equal(db.rows[0].status, 'active', 'admin-invited profile, same Cognito subject')
  } finally { db.restore() }
  db = stubProfiles([customer({ user_id: 'sub-invited', status: 'pending' })])
  try {
    await assert.rejects(signIn(), (err) => err.statusCode === 409)
    assert.equal(db.rows[0].status, 'pending')
    assert.equal(db.writes().length, 0)
  } finally { db.restore() }
})

test('8. a suspended profile stays suspended', async () => {
  const db = stubProfiles([customer({ status: 'suspended' })])
  try {
    const record = await signIn()
    assert.equal(db.rows[0].status, 'suspended')
    assert.equal(record.account_status, 'suspended')
  } finally { db.restore() }
})

test('9. admin and other non-customer profiles are never re-linked through customer sign-in', async () => {
  for (const role of ['admin', 'provider', 'developer']) {
    const db = stubProfiles([customer({ user_id: 'adm-profile', role })])
    try {
      await assert.rejects(signIn(), (err) => err.statusCode === 409 && err.code === 'PROFILE_LINK_REFUSED')
      assert.equal(db.writes().length, 0)
      assert.equal(db.rows[0].user_id, 'adm-profile')
      assert.equal(db.rows[0].role, role)
    } finally { db.restore() }
  }
})

test('10. a different Cognito subject cannot inherit an existing customer profile (audited without the email)', async () => {
  const db = stubProfiles([customer({ user_id: 'sub-original', status: 'active' })])
  const logs = []
  const warn = console.warn
  console.warn = (...args) => logs.push(args.join(' '))
  try {
    await assert.rejects(signIn({ cognito_sub: 'sub-attacker' }), (err) => err.statusCode === 409)
    assert.equal(db.writes().length, 0)
    assert.equal(db.rows[0].user_id, 'sub-original')
    const audit = db.calls.find((c) => c.path === '/rest/v1/audit_logs')
    assert.ok(audit && audit.body.action === 'customer.profile_link.refused')
    const recorded = JSON.stringify(audit.body) + logs.join('\n')
    assert.ok(recorded.includes('sub-attacker') && recorded.includes('sub-original'))
    assert.ok(!recorded.includes('owner@example.test'), 'no email in audit records')
  } finally { console.warn = warn; db.restore() }
})

test('11. profile lookup failures stop the sign-in sync without writing anything', async () => {
  const db = stubProfiles([customer()], { failLookups: true })
  try {
    await assert.rejects(signIn(), (err) => err.statusCode === 503)
    assert.equal(db.writes().length, 0)
  } finally { db.restore() }
})

test('11b. sign-in sync returns the refusal instead of a fallback profile', async () => {
  const claims = { sub: 'sub-attacker', email: 'owner@example.test', email_verified: true, token_use: 'id' }
  const conflict = Object.assign(new Error('linked elsewhere'), { statusCode: 409, code: 'PROFILE_LINK_REFUSED' })
  const mw = createCustomerAuthMiddleware({
    verifyToken: async () => claims,
    getSupabaseClient: async () => mockAdminStore({ profiles: [] }),
    saveCustomerProfile: async () => { throw conflict },
  })
  const { status, json } = await call(mw, 'POST', '/api/customer/profile/sync', { token: 'a.b.c', body: {} })
  assert.equal(status, 409)
  assert.equal(json.ok, false)
  assert.equal(json.profile, undefined)
})

const syncMiddleware = (saveCustomerProfile, sub = 'sub-ok') => createCustomerAuthMiddleware({
  verifyToken: async () => ({ sub, email: 'ok@example.test', email_verified: true, token_use: 'id', name: 'Claims Name' }),
  getSupabaseClient: async () => mockAdminStore({ profiles: [] }),
  ...(saveCustomerProfile ? { saveCustomerProfile } : {}),
})

test('11c. an unexpected profile-sync exception fails the sign-in with a safe error and no profile', async () => {
  const errors = console.error
  console.error = () => {}
  try {
    const { status, json } = await call(syncMiddleware(async () => { throw new Error('internal: duplicate key value violates "profiles_email_key"') }),
      'POST', '/api/customer/profile/sync', { token: 'a.b.c', body: {} })
    assert.equal(status, 500)
    assert.equal(json.ok, false)
    assert.equal(json.code, 'PROFILE_SYNC_FAILED')
    assert.equal(json.profile, undefined)
    assert.ok(!JSON.stringify(json).includes('internal'), 'no internal error text in the response')
  } finally { console.error = errors }
})

test('11d. a sync that returns no profile, or another identity\'s profile, never falls back to token claims', async () => {
  const errors = console.error
  console.error = () => {}
  try {
    for (const result of [undefined, null, {}, { cognito_sub: 'sub-someone-else', email: 'x@example.test', role: 'customer', account_status: 'active' }]) {
      const { status, json } = await call(syncMiddleware(async () => result), 'POST', '/api/customer/profile/sync', { token: 'a.b.c', body: {} })
      assert.equal(status, 500, JSON.stringify(result))
      assert.equal(json.profile, undefined)
      assert.ok(!JSON.stringify(json).includes('Claims Name'))
    }
  } finally { console.error = errors }
})

test('11e. a profile lookup failure during sign-in returns 503 through the endpoint, without a profile or writes', async () => {
  const db = stubProfiles([], { failLookups: true })
  const warn = console.warn
  console.warn = () => {}
  try {
    const { status, json } = await call(syncMiddleware(), 'POST', '/api/customer/profile/sync', { token: 'a.b.c', body: {} })
    assert.equal(status, 503)
    assert.equal(json.code, 'PROFILE_LOOKUP_UNAVAILABLE')
    assert.equal(json.profile, undefined)
    assert.equal(db.writes().length, 0)
  } finally { console.warn = warn; db.restore() }
})

test('11f. the profile service returns only what the database confirms it saved, never the request payload', async () => {
  for (const writeReply of [() => new Response('[]', { status: 200 }), () => new Response('not json', { status: 200 })]) {
    const db = stubProfiles([customer()])
    const stubbed = globalThis.fetch
    globalThis.fetch = async (input, init = {}) => (init.method === 'PATCH' ? writeReply() : stubbed(input, init))
    try {
      await assert.rejects(signIn(), /did not return the saved customer profile/)
    } finally { db.restore() }
  }
})

// ── 12/13. Legitimate flows still work ──────────────────────────────────────────────────────────

test('12. a valid Cognito customer: first sign-in creates the profile, later sign-ins update it', async () => {
  const db = stubProfiles([])
  try {
    const created = await signIn({ cognito_sub: 'sub-new', email: 'new@example.test' })
    assert.equal(created.cognito_sub, 'sub-new')
    assert.equal(db.rows[0].status, 'active')
    assert.equal(db.writes()[0].method, 'POST')
    await signIn({ cognito_sub: 'sub-new', email: 'new@example.test' })
    assert.equal(db.writes()[1].method, 'PATCH')
    assert.equal(db.rows.length, 1)
  } finally { db.restore() }

  const claims = { sub: 'sub-ok', email: 'ok@example.test', email_verified: true, token_use: 'id', name: 'OK' }
  const mw = createCustomerAuthMiddleware({
    verifyToken: async () => claims,
    getSupabaseClient: async () => mockAdminStore({ profiles: [] }),
    saveCustomerProfile: async (p) => ({ cognito_sub: p.cognito_sub, email: p.email, full_name: 'Stored Name', role: 'customer', account_status: 'active' }),
  })
  const { status, json } = await call(mw, 'POST', '/api/customer/profile/sync', { token: 'a.b.c', body: {} })
  assert.equal(status, 200)
  assert.equal(json.ok, true)
  assert.equal(json.profile.id, 'sub-ok')
  assert.equal(json.profile.fullName, 'Stored Name', 'profile comes from the saved record')
})

test('13. a database-backed admin still signs in through the admin endpoint', { skip: ARGON2_SKIP }, async () => {
  const password = 'Correct-Horse-Battery-Staple-42'
  const tables = { admin_users: [{ id: crypto.randomUUID(), email: 'ops@example.test', role: 'admin', is_active: true, session_version: 1,
    password_hash: hashPassword(password, { memory: 1024, passes: 2, parallelism: 1 }), created_at: '2026-01-01T00:00:00.000Z', last_login: null }],
  admin_sessions: [], audit_logs: [] }
  const mw = createAdminAuthMiddleware({ supabaseClient: mockAdminStore(tables), sessionSecret: SECRET })
  const { status, json } = await call(mw, 'POST', '/api/admin/login', { body: { email: 'ops@example.test', password } })
  assert.equal(status, 200, JSON.stringify(json))
  assert.equal(json.isAdmin, true)
  assert.ok(json.token)
})
