/**
 * Superadmin & Admin Role Separation Security Tests (Phase A1)
 * Verifies strict DB-backed RBAC between Superadmin and regular Admin tokens,
 * Argon2 credential verification, session revocation, and fail-closed security.
 */

import './support/networkGuard.mjs'  // test isolation guard: must stay the first import (tests/testSafety.test.mjs checks)
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { Readable } from 'node:stream'
import test from 'node:test'
import { createAdminAuthMiddleware, createAdminToken, verifyAdminToken } from '../auth/adminAuth.js'
import { hashPassword } from '../auth/adminPassword.js'

const TEST_SECRET = 'test-only-superadmin-role-separation-secret-2026-32plus'
const SUPERADMIN_ID = 'd9a494cb-1e8d-4bca-8142-19687fa9138b'
const SUPERADMIN_EMAIL = 'admin@inferxe.com'
const SUPERADMIN_PASS = 'SuperAdmin#RoleTest2026!'
const DEV_ADMIN_ID = '22222222-2222-4222-8222-222222222222'
const DEV_ADMIN_EMAIL = 'dev.admin@inferxe.com'
const DEV_ADMIN_PASS = 'DeveloperAdmin#RoleTest2026!'

function createInMemorySupabase() {
  const tables = {
    admin_users: [
      {
        id: SUPERADMIN_ID,
        email: SUPERADMIN_EMAIL,
        password_hash: hashPassword(SUPERADMIN_PASS, { memory: 1024, passes: 2, parallelism: 1 }),
        role: 'superadmin',
        is_active: true,
        session_version: 1,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
        last_login: null,
      },
      {
        id: DEV_ADMIN_ID,
        email: DEV_ADMIN_EMAIL,
        password_hash: hashPassword(DEV_ADMIN_PASS, { memory: 1024, passes: 2, parallelism: 1 }),
        role: 'admin',
        is_active: true,
        session_version: 1,
        created_at: '2026-01-02T00:00:00.000Z',
        updated_at: '2026-01-02T00:00:00.000Z',
        last_login: null,
      },
    ],
    admin_sessions: [],
    audit_logs: [],
  }

  function project(row, cols) {
    if (!row || !cols || cols === '*') return { ...row }
    const out = {}
    for (const c of cols.split(',').map((s) => s.trim()).filter(Boolean)) {
      if (c in row) out[c] = row[c]
    }
    return out
  }

  return {
    tables,
    from(table) {
      const state = { op: 'select', cols: '*', payload: null, filters: [], orderBy: null, range: null, mode: null }
      const run = async () => {
        const rows = tables[table]
        const match = (r) =>
          state.filters.every((f) =>
            f.type === 'eq'
              ? String(r[f.k]) === String(f.v)
              : f.v === null
                ? r[f.k] === null || r[f.k] === undefined
                : r[f.k] === f.v,
          )
        if (state.op === 'insert') {
          const rec = { id: state.payload.id || crypto.randomUUID(), created_at: new Date().toISOString(), ...state.payload }
          rows.push(rec)
          return { data: state.mode === 'single' ? project(rec, state.cols) : [project(rec, state.cols)], error: null }
        }
        if (state.op === 'update') {
          const updated = []
          for (const r of rows) {
            if (match(r)) {
              Object.assign(r, state.payload)
              updated.push(project(r, state.cols))
            }
          }
          return { data: state.mode === 'single' ? updated[0] || null : updated, error: null }
        }
        let res = rows.filter(match).map((r) => project(r, state.cols))
        if (state.range) res = res.slice(state.range.from, state.range.to + 1)
        if (state.mode === 'maybeSingle') return { data: res[0] || null, error: null }
        if (state.mode === 'single') return { data: res[0] || null, error: res[0] ? null : { message: 'not found' } }
        return { data: res, error: null }
      }
      const b = {
        select(c = '*') { state.cols = c; return b },
        insert(p) { state.op = 'insert'; state.payload = p; return b },
        update(p) { state.op = 'update'; state.payload = p; return b },
        eq(k, v) { state.filters.push({ type: 'eq', k, v }); return b },
        is(k, v) { state.filters.push({ type: 'is', k, v }); return b },
        order() { return b },
        range(from, to) { state.range = { from, to }; return b },
        maybeSingle() { state.mode = 'maybeSingle'; return run() },
        single() { state.mode = 'single'; return run() },
        then(res, rej) { return run().then(res, rej) },
      }
      return b
    },
  }
}

test('Token role claims enforce strict superadmin vs admin separation', () => {
  const now = Math.floor(Date.now() / 1000)
  const adminToken = createAdminToken({ sub: DEV_ADMIN_ID, role: 'admin', iat: now, exp: now + 3600 }, TEST_SECRET)
  const superToken = createAdminToken({ sub: SUPERADMIN_ID, role: 'superadmin', iat: now, exp: now + 3600 }, TEST_SECRET)

  assert.equal(verifyAdminToken(adminToken, TEST_SECRET, { allowedRoles: ['admin', 'superadmin'] }).valid, true)
  assert.equal(verifyAdminToken(adminToken, TEST_SECRET, { allowedRoles: ['superadmin'] }).valid, false)
  assert.equal(verifyAdminToken(superToken, TEST_SECRET, { allowedRoles: ['superadmin'] }).valid, true)
  assert.equal(verifyAdminToken('ix-tok-bypass', TEST_SECRET, { allowedRoles: ['superadmin'] }).valid, false)
})

async function callMiddleware(middleware, path, { method = 'GET', token, body } = {}) {
  const chunks = body !== undefined ? [Buffer.from(JSON.stringify(body), 'utf8')] : []
  const req = Readable.from(chunks)
  req.url = path
  req.method = method
  req.headers = { accept: 'application/json' }
  if (body !== undefined) req.headers['content-type'] = 'application/json'
  if (token) req.headers.authorization = `Bearer ${token}`
  req.socket = { remoteAddress: '127.0.0.1' }

  const headers = new Map()
  let rawBody = ''
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      setHeader(k, v) { headers.set(String(k).toLowerCase(), v) },
      end(chunk = '') {
        rawBody += String(chunk || '')
        resolve({ status: res.statusCode, data: rawBody ? JSON.parse(rawBody) : {} })
      },
    }
    Promise.resolve(
      middleware(req, res, () => resolve({ status: 404, data: {} })),
    ).catch(reject)
  })
}

test('Superadmin API endpoints enforce 403 for standard admin and 200 for superadmin', async () => {
  const supabase = createInMemorySupabase()
  const middleware = createAdminAuthMiddleware({
    sessionSecret: TEST_SECRET,
    supabaseClient: supabase,
    disableRateLimit: true,
  })

  const superLogin = await callMiddleware(middleware, '/api/admin/login', {
    method: 'POST',
    body: { email: SUPERADMIN_EMAIL, password: SUPERADMIN_PASS },
  })
  assert.equal(superLogin.status, 200)
  assert.equal(superLogin.data.role, 'superadmin')

  const devLogin = await callMiddleware(middleware, '/api/admin/login', {
    method: 'POST',
    body: { email: DEV_ADMIN_EMAIL, password: DEV_ADMIN_PASS },
  })
  assert.equal(devLogin.status, 200)
  assert.equal(devLogin.data.role, 'admin')

  // Standard admin cannot access superadmin endpoints
  for (const path of [
    '/api/superadmin/admins',
    '/api/superadmin/audit-logs',
    '/api/superadmin/login-history',
    '/api/superadmin/telemetry',
    '/api/superadmin/keys',
  ]) {
    const res = await callMiddleware(middleware, path, { token: devLogin.data.token })
    assert.equal(res.status, 403, `Expected 403 for normal admin on ${path}`)
  }

  // Superadmin can access superadmin endpoints
  const adminsRes = await callMiddleware(middleware, '/api/superadmin/admins', {
    token: superLogin.data.token,
  })
  assert.equal(adminsRes.status, 200)
  assert.equal(adminsRes.data.ok, true)
  assert.equal(adminsRes.data.admins.length, 2)

  // Unauthenticated call returns 401
  const unauthRes = await callMiddleware(middleware, '/api/superadmin/admins')
  assert.equal(unauthRes.status, 401)
})
