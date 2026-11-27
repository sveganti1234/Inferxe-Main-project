import '../../tests/support/networkGuard.mjs'  // test isolation guard: must stay the first import (tests/testSafety.test.mjs checks)
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { Readable } from 'node:stream'
import test from 'node:test'
import { createAdminAuthMiddleware, verifyAdminToken } from '../adminAuth.js'
import { hashPassword } from '../adminPassword.js'

// Admin login hardening, against the database-backed admin auth (Supabase admin_users + Argon2):
// no hardcoded admin emails or backdoor passwords, login disabled until a strong session secret is
// configured, and repeated failures from one IP are rate limited. Fake req/res and an in-memory
// Supabase double only: no server, no network.
delete process.env.ADMIN_SESSION_SECRET
// supabaseCustomerService.js loads backend/.env on import (via adminAuth.js) and fills unset or empty values, so point the
// Supabase settings at a closed local port instead of deleting them: nothing can reach a real project.
process.env.SUPABASE_URL = 'http://127.0.0.1:9'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-disabled'
delete process.env.SUPABASE_SECRET_KEY

const SECRET = 'test-only-admin-signing-secret-with-adequate-length'
const ADMIN_EMAIL = 'owner@example.test'
const ADMIN_PASSWORD = 'Correct-Horse-Battery-Staple-42'
// Verifying an Argon2 hash needs crypto.argon2Sync (Node >= 24.7); older runtimes answer 503.
const ARGON2_SKIP = typeof crypto.argon2Sync === 'function' ? false : 'needs crypto.argon2Sync (Node >= 24.7)'

function mockSupabase(adminRows = []) {
  const tables = { admin_users: adminRows, admin_sessions: [], audit_logs: [] }
  return {
    tables,
    from(name) {
      const st = { op: 'select', filters: [], payload: null }
      const run = async (single) => {
        const rows = tables[name] || []
        if (st.op === 'insert') {
          const record = { id: crypto.randomUUID(), created_at: new Date().toISOString(), ...st.payload }
          rows.push(record)
          return { data: record, error: null }
        }
        const hits = rows.filter((r) => st.filters.every(([f, v]) => String(r[f]) === String(v)))
        if (st.op === 'update') {
          hits.forEach((r) => Object.assign(r, st.payload))
          return { data: hits, error: null }
        }
        return { data: single ? hits[0] || null : hits, error: null }
      }
      const builder = {
        select() { return builder },
        insert(payload) { st.op = 'insert'; st.payload = payload; return builder },
        update(payload) { st.op = 'update'; st.payload = payload; return builder },
        eq(field, value) { st.filters.push([field, value]); return builder },
        is() { return builder },
        order() { return builder },
        limit() { return builder },
        maybeSingle() { return run(true) },
        single() { return run(true) },
        then(resolve, reject) { return run(false).then(resolve, reject) },
      }
      return builder
    },
  }
}

function adminRow(passwordHash = 'not-used-before-password-check') {
  return {
    id: crypto.randomUUID(), email: ADMIN_EMAIL, password_hash: passwordHash, role: 'admin',
    is_active: true, session_version: 1, created_at: '2026-01-01T00:00:00.000Z', last_login: null,
  }
}

let ipCounter = 0
function login(middleware, body, ip = `10.0.0.${++ipCounter}`) {
  const req = Readable.from([JSON.stringify(body)])
  Object.assign(req, {
    method: 'POST', url: '/api/admin/login',
    headers: { 'content-type': 'application/json' }, socket: { remoteAddress: ip },
  })
  const res = {
    statusCode: 200, headers: {}, body: '',
    setHeader(n, v) { this.headers[n.toLowerCase()] = v },
    getHeader(n) { return this.headers[n.toLowerCase()] },
    writeHead(c, h = {}) { this.statusCode = c; Object.assign(this.headers, h) },
    end(chunk = '') { this.body += chunk },
  }
  return middleware(req, res, () => {}).then(() => ({ status: res.statusCode, json: JSON.parse(res.body || '{}') }))
}

test('former hardcoded admin emails are not admin accounts', async () => {
  const mw = createAdminAuthMiddleware({ supabaseClient: mockSupabase([adminRow()]), sessionSecret: SECRET })
  for (const email of ['admin@inferxe.com', 'alex.chen@inferxe.internal', 'bhumireddy@inferxe.com']) {
    const { status, json } = await login(mw, { email, password: 'admin123' })
    assert.equal(status, 200, email)
    assert.equal(json.ok, false)
    assert.equal(json.isAdmin, false, email)
    assert.equal(json.token, undefined)
  }
})

test('no committed defaults: an admin account cannot sign in until a session secret is configured', async () => {
  const mw = createAdminAuthMiddleware({ supabaseClient: mockSupabase([adminRow()]), sessionSecret: '' })
  const { status, json } = await login(mw, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
  assert.equal(status, 503)
  assert.equal(json.code, 'ADMIN_AUTH_NOT_CONFIGURED')
  assert.equal(json.token, undefined)
})

test('short session secret keeps login disabled', async () => {
  const mw = createAdminAuthMiddleware({ supabaseClient: mockSupabase([adminRow()]), sessionSecret: 'too-short' })
  const { status, json } = await login(mw, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
  assert.equal(status, 503)
  assert.equal(json.code, 'ADMIN_AUTH_NOT_CONFIGURED')
})

test('configured credentials sign in and yield a valid admin token', { skip: ARGON2_SKIP }, async () => {
  const hash = hashPassword(ADMIN_PASSWORD, { memory: 1024, passes: 2, parallelism: 1 })
  const mw = createAdminAuthMiddleware({ supabaseClient: mockSupabase([adminRow(hash)]), sessionSecret: SECRET })
  const { status, json } = await login(mw, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
  assert.equal(status, 200)
  assert.equal(verifyAdminToken(json.token, SECRET).valid, true)
})

test('former hardcoded backdoor passwords are rejected', { skip: ARGON2_SKIP }, async () => {
  const hash = hashPassword(ADMIN_PASSWORD, { memory: 1024, passes: 2, parallelism: 1 })
  const mw = createAdminAuthMiddleware({ supabaseClient: mockSupabase([adminRow(hash)]), sessionSecret: SECRET })
  for (const password of ['admin123', 'admin', 'Admin@123', 'Qwerty@123', 'Inferxe@2026']) {
    const { status } = await login(mw, { email: ADMIN_EMAIL, password })
    assert.equal(status, 401, password)
  }
})

test('repeated failures from one IP are rate limited, other IPs are not', { skip: ARGON2_SKIP }, async () => {
  const hash = hashPassword(ADMIN_PASSWORD, { memory: 1024, passes: 2, parallelism: 1 })
  const mw = createAdminAuthMiddleware({
    supabaseClient: mockSupabase([adminRow(hash)]), sessionSecret: SECRET, rateLimitMaxAttempts: 5,
  })
  const ip = '192.0.2.77'
  for (let i = 0; i < 5; i++) {
    assert.equal((await login(mw, { email: ADMIN_EMAIL, password: 'wrong' }, ip)).status, 401)
  }
  // Even the correct password is refused while rate limited.
  assert.equal((await login(mw, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD }, ip)).status, 429)
  assert.equal((await login(mw, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD }, '192.0.2.78')).status, 200)
})

test('failures against one admin do not lock other admins out behind a shared proxy address', { skip: ARGON2_SKIP }, async () => {
  const hash = hashPassword(ADMIN_PASSWORD, { memory: 1024, passes: 2, parallelism: 1 })
  const other = { ...adminRow(hash), id: crypto.randomUUID(), email: 'second@example.test' }
  const mw = createAdminAuthMiddleware({
    supabaseClient: mockSupabase([adminRow(hash), other]), sessionSecret: SECRET, rateLimitMaxAttempts: 5,
  })
  const proxy = '10.200.0.1' // every request arrives from the Render proxy's address
  for (let i = 0; i < 5; i++) {
    assert.equal((await login(mw, { email: ADMIN_EMAIL, password: 'wrong' }, proxy)).status, 401)
  }
  assert.equal((await login(mw, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD }, proxy)).status, 429, 'the targeted account stays limited')
  assert.equal((await login(mw, { email: 'second@example.test', password: ADMIN_PASSWORD }, proxy)).status, 200, 'other admins can still sign in')
})
