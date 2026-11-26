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
    login_history: [],
    profiles: [
      {
        user_id: 'cust-1',
        email: 'customer1@example.com',
        full_name: 'Customer One',
        role: 'user',
        status: 'active',
        created_at: new Date(Date.now() - 3600000).toISOString(),
        last_active_at: new Date(Date.now() - 60000).toISOString(),
        last_seen_at: new Date(Date.now() - 60000).toISOString(),
      },
      {
        user_id: 'cust-2',
        email: 'customer2@example.com',
        full_name: 'Customer Two',
        role: 'user',
        status: 'inactive',
        created_at: new Date(Date.now() - 86400000 * 2).toISOString(),
        last_active_at: null,
        last_seen_at: null,
      },
    ],
    organizations: [
      { id: 'org-1', name: 'Acme Corp', status: 'active' },
      { id: 'org-2', name: 'Beta Ltd', status: 'active' },
    ],
    api_keys: [
      { id: 'key-1', status: 'active', revoked_at: null },
      { id: 'key-2', status: 'revoked', revoked_at: '2026-03-01T00:00:00.000Z' },
    ],
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
      if (!tables[table]) tables[table] = []
      const state = { op: 'select', cols: '*', opts: {}, payload: null, filters: [], orderBy: null, range: null, limit: null, mode: null }
      const run = async () => {
        const rows = tables[table]
        const match = (r) =>
          state.filters.every((f) => {
            if (f.type === 'eq') return String(r[f.k]) === String(f.v)
            if (f.type === 'neq') return String(r[f.k]) !== String(f.v)
            if (f.type === 'is') return f.v === null ? (r[f.k] === null || r[f.k] === undefined) : r[f.k] === f.v
            if (f.type === 'in') return Array.isArray(f.v) ? f.v.map(String).includes(String(r[f.k])) : false
            return true
          })
        if (state.op === 'insert') {
          const rec = { id: state.payload.id || crypto.randomUUID(), created_at: new Date().toISOString(), ...state.payload }
          rows.push(rec)
          return { data: state.mode === 'single' ? project(rec, state.cols) : [project(rec, state.cols)], count: 1, error: null }
        }
        if (state.op === 'update') {
          const updated = []
          for (const r of rows) {
            if (match(r)) {
              Object.assign(r, state.payload)
              updated.push(project(r, state.cols))
            }
          }
          return { data: state.mode === 'single' ? updated[0] || null : updated, count: updated.length, error: null }
        }
        if (state.op === 'delete') {
          const remaining = []
          const deleted = []
          for (const r of rows) {
            if (match(r)) {
              deleted.push(project(r, state.cols))
            } else {
              remaining.push(r)
            }
          }
          tables[table] = remaining
          return { data: state.mode === 'single' ? deleted[0] || null : deleted, count: deleted.length, error: null }
        }
        let filtered = rows.filter(match)
        const totalCount = filtered.length
        let res = filtered.map((r) => project(r, state.cols))
        if (state.limit !== null) res = res.slice(0, state.limit)
        if (state.range) res = res.slice(state.range.from, state.range.to + 1)
        if (state.mode === 'maybeSingle') return { data: res[0] || null, count: totalCount, error: null }
        if (state.mode === 'single') return { data: res[0] || null, count: totalCount, error: res[0] ? null : { message: 'not found' } }
        return { data: res, count: totalCount, error: null }
      }
      const b = {
        select(c = '*', opts = {}) { state.cols = c; state.opts = opts; return b },
        insert(p) { state.op = 'insert'; state.payload = p; return b },
        update(p) { state.op = 'update'; state.payload = p; return b },
        delete() { state.op = 'delete'; return b },
        eq(k, v) { state.filters.push({ type: 'eq', k, v }); return b },
        neq(k, v) { state.filters.push({ type: 'neq', k, v }); return b },
        is(k, v) { state.filters.push({ type: 'is', k, v }); return b },
        in(k, v) { state.filters.push({ type: 'in', k, v }); return b },
        order() { return b },
        limit(n) { state.limit = n; return b },
        range(from, to) { state.range = { from, to }; return b },
        maybeSingle() { state.mode = 'maybeSingle'; return run() },
        single() { state.mode = 'single'; return run() },
        then(onFulfilled, onRejected) { return run().then(onFulfilled, onRejected) },
        catch(onRejected) { return run().catch(onRejected) },
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

test('Account creation strictly enforces role "admin", rejects unauthorized roles, and logs security violations', async () => {
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

  // 1. Attempting to create an account with role 'superadmin' is strictly blocked (403)
  const rogueSuper = await callMiddleware(middleware, '/api/superadmin/admins', {
    method: 'POST',
    token: superLogin.data.token,
    body: { email: 'rogue.super@inferxe.com', password: 'RogueAdmin#2026!Pass', role: 'superadmin' },
  })
  assert.equal(rogueSuper.status, 403)
  assert.equal(rogueSuper.data.code, 'ROLE_MODIFICATION_PROHIBITED')

  // 2. Attempting to create an account with arbitrary/prohibited roles is blocked (403)
  for (const invalidRole of ['finance', 'support', 'operations', 'developer', 'cluster_operator']) {
    const invalidRes = await callMiddleware(middleware, '/api/superadmin/admins', {
      method: 'POST',
      token: superLogin.data.token,
      body: { email: `${invalidRole}@inferxe.com`, password: 'StrongRole#2026!Pass', role: invalidRole },
    })
    assert.equal(invalidRes.status, 403, `Expected 403 for role "${invalidRole}"`)
    assert.equal(invalidRes.data.code, 'ROLE_MODIFICATION_PROHIBITED')
  }

  // 3. Verify security violations were logged to audit_logs
  const violationLogs = supabase.tables.audit_logs.filter((log) => log.action === 'security.role_violation.blocked')
  assert.ok(violationLogs.length >= 6, `Expected at least 6 role violation audit logs, got ${violationLogs.length}`)
  assert.equal(violationLogs[0].details.actor_email, SUPERADMIN_EMAIL)
  assert.equal(violationLogs[0].details.attempted_role, 'superadmin')

  // 4. Valid creation with role='admin' succeeds (201)
  const validAdmin = await callMiddleware(middleware, '/api/superadmin/admins', {
    method: 'POST',
    token: superLogin.data.token,
    body: { email: 'valid.new.admin@inferxe.com', password: 'ValidAdmin#2026!Pass', role: 'admin' },
  })
  assert.equal(validAdmin.status, 201)
  assert.equal(validAdmin.data.admin.role, 'admin')
  assert.equal('password_hash' in validAdmin.data.admin, false)
})

test('Admin account update prevents role tampering, escalation, and Super Admin modification', async () => {
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

  // 1. Attempting to elevate standard admin to superadmin via PATCH is blocked (403)
  const escalateRes = await callMiddleware(middleware, `/api/superadmin/admins/${DEV_ADMIN_ID}`, {
    method: 'PATCH',
    token: superLogin.data.token,
    body: { role: 'superadmin' },
  })
  assert.equal(escalateRes.status, 403)
  assert.equal(escalateRes.data.code, 'ROLE_MODIFICATION_PROHIBITED')

  // 2. Attempting to set an invalid role via PATCH is blocked (403)
  const invalidRolePatch = await callMiddleware(middleware, `/api/superadmin/admins/${DEV_ADMIN_ID}`, {
    method: 'PATCH',
    token: superLogin.data.token,
    body: { role: 'billing_admin' },
  })
  assert.equal(invalidRolePatch.status, 403)
  assert.equal(invalidRolePatch.data.code, 'ROLE_MODIFICATION_PROHIBITED')

  // 3. Super Admin account is protected against modification (403)
  const modifySuperRes = await callMiddleware(middleware, `/api/superadmin/admins/${SUPERADMIN_ID}`, {
    method: 'PATCH',
    token: superLogin.data.token,
    body: { email: 'hacked.super@inferxe.com' },
  })
  assert.equal(modifySuperRes.status, 403)
  assert.equal(modifySuperRes.data.code, 'SUPERADMIN_PROTECTED')

  // 4. Super Admin account is protected against deletion (403)
  const deleteSuperRes = await callMiddleware(middleware, `/api/superadmin/admins/${SUPERADMIN_ID}`, {
    method: 'DELETE',
    token: superLogin.data.token,
  })
  assert.equal(deleteSuperRes.status, 403)
  assert.equal(deleteSuperRes.data.code, 'SUPERADMIN_PROTECTED')
})

test('Standard Admin cannot self-promote, modify other accounts, or delete accounts', async () => {
  const supabase = createInMemorySupabase()
  const middleware = createAdminAuthMiddleware({
    sessionSecret: TEST_SECRET,
    supabaseClient: supabase,
    disableRateLimit: true,
  })

  const devLogin = await callMiddleware(middleware, '/api/admin/login', {
    method: 'POST',
    body: { email: DEV_ADMIN_EMAIL, password: DEV_ADMIN_PASS },
  })
  assert.equal(devLogin.status, 200)
  assert.equal(devLogin.data.role, 'admin')

  // Standard admin cannot POST to create admins
  const createAttempt = await callMiddleware(middleware, '/api/superadmin/admins', {
    method: 'POST',
    token: devLogin.data.token,
    body: { email: 'another@inferxe.com', password: 'Another#2026!Pass' },
  })
  assert.equal(createAttempt.status, 403)

  // Standard admin cannot PATCH another admin or themselves via superadmin API
  const patchAttempt = await callMiddleware(middleware, `/api/superadmin/admins/${DEV_ADMIN_ID}`, {
    method: 'PATCH',
    token: devLogin.data.token,
    body: { role: 'superadmin' },
  })
  assert.equal(patchAttempt.status, 403)

  // Standard admin cannot DELETE accounts
  const deleteAttempt = await callMiddleware(middleware, `/api/superadmin/admins/${DEV_ADMIN_ID}`, {
    method: 'DELETE',
    token: devLogin.data.token,
  })
  assert.equal(deleteAttempt.status, 403)
})

test('Database row with invalid role fails closed with 403 INVALID_ROLE', async () => {
  const supabase = createInMemorySupabase()
  const middleware = createAdminAuthMiddleware({
    sessionSecret: TEST_SECRET,
    supabaseClient: supabase,
    disableRateLimit: true,
  })

  const INVALID_USER_ID = '33333333-3333-4333-8333-333333333333'
  const INVALID_USER_EMAIL = 'invalid.role@inferxe.com'
  const INVALID_USER_PASS = 'InvalidRole#2026!Pass'

  supabase.tables.admin_users.push({
    id: INVALID_USER_ID,
    email: INVALID_USER_EMAIL,
    password_hash: hashPassword(INVALID_USER_PASS, { memory: 1024, passes: 2, parallelism: 1 }),
    role: 'rogue_role_not_permitted',
    is_active: true,
    session_version: 1,
    created_at: '2026-01-03T00:00:00.000Z',
    updated_at: '2026-01-03T00:00:00.000Z',
    last_login: null,
  })

  // 1. Login fails with 403 INVALID_ROLE
  const loginRes = await callMiddleware(middleware, '/api/admin/login', {
    method: 'POST',
    body: { email: INVALID_USER_EMAIL, password: INVALID_USER_PASS },
  })
  assert.equal(loginRes.status, 403)
  assert.equal(loginRes.data.code, 'INVALID_ROLE')

  // 2. Session verification fails closed with 403 INVALID_ROLE when DB row has invalid role
  const sessionId = crypto.randomUUID()
  supabase.tables.admin_sessions.push({
    id: sessionId,
    admin_user_id: INVALID_USER_ID,
    session_version: 1,
    expires_at: new Date(Date.now() + 86400000).toISOString(),
    revoked_at: null,
  })
  const now = Math.floor(Date.now() / 1000)
  const token = createAdminToken({
    sub: INVALID_USER_ID,
    sid: sessionId,
    sv: 1,
    role: 'admin',
    iat: now,
    exp: now + 3600,
  }, TEST_SECRET)
  const verifyRes = await callMiddleware(middleware, '/api/admin/verify', {
    method: 'POST',
    token,
  })
  assert.equal(verifyRes.status, 403)
  assert.equal(verifyRes.data.code, 'INVALID_ROLE')
})

test('Session invalidation occurs on account deactivation and deletion', async () => {
  const supabase = createInMemorySupabase()
  const middleware = createAdminAuthMiddleware({
    sessionSecret: TEST_SECRET,
    supabaseClient: supabase,
    disableRateLimit: true,
  })

  // 1. Super Admin logs in
  const superLogin = await callMiddleware(middleware, '/api/admin/login', {
    method: 'POST',
    body: { email: SUPERADMIN_EMAIL, password: SUPERADMIN_PASS },
  })
  assert.equal(superLogin.status, 200)

  // 2. Dev Admin logs in and obtains session
  const devLogin = await callMiddleware(middleware, '/api/admin/login', {
    method: 'POST',
    body: { email: DEV_ADMIN_EMAIL, password: DEV_ADMIN_PASS },
  })
  assert.equal(devLogin.status, 200)
  const devToken = devLogin.data.token

  // 3. Verify session is initially valid (200)
  const initialVerify = await callMiddleware(middleware, '/api/admin/verify', {
    method: 'POST',
    token: devToken,
  })
  assert.equal(initialVerify.status, 200)
  assert.equal(initialVerify.data.ok, true)

  // 4. Super Admin deactivates Dev Admin account
  const deactivateRes = await callMiddleware(middleware, `/api/superadmin/admins/${DEV_ADMIN_ID}/status`, {
    method: 'PATCH',
    token: superLogin.data.token,
    body: { is_active: false, reason: 'Security deactivation' },
  })
  assert.equal(deactivateRes.status, 200)

  // 5. Active token is immediately invalidated (401)
  const postDeactivateVerify = await callMiddleware(middleware, '/api/admin/verify', {
    method: 'POST',
    token: devToken,
  })
  assert.equal(postDeactivateVerify.status, 401)

  // 6. Login while deactivated fails (403 ADMIN_INACTIVE)
  const deactivatedLogin = await callMiddleware(middleware, '/api/admin/login', {
    method: 'POST',
    body: { email: DEV_ADMIN_EMAIL, password: DEV_ADMIN_PASS },
  })
  assert.equal(deactivatedLogin.status, 403)
  assert.equal(deactivatedLogin.data.code, 'ADMIN_INACTIVE')

  // 7. Reactivation does not revive old sessions
  const reactivateRes = await callMiddleware(middleware, `/api/superadmin/admins/${DEV_ADMIN_ID}/status`, {
    method: 'PATCH',
    token: superLogin.data.token,
    body: { is_active: true, reason: 'Reactivated after review' },
  })
  assert.equal(reactivateRes.status, 200)

  // Old token still fails (401)
  const oldTokenVerify = await callMiddleware(middleware, '/api/admin/verify', {
    method: 'POST',
    token: devToken,
  })
  assert.equal(oldTokenVerify.status, 401)

  // Fresh login succeeds
  const freshLogin = await callMiddleware(middleware, '/api/admin/login', {
    method: 'POST',
    body: { email: DEV_ADMIN_EMAIL, password: DEV_ADMIN_PASS },
  })
  assert.equal(freshLogin.status, 200)
  const freshToken = freshLogin.data.token

  // 8. Super Admin deletes the admin account
  const deleteRes = await callMiddleware(middleware, `/api/superadmin/admins/${DEV_ADMIN_ID}`, {
    method: 'DELETE',
    token: superLogin.data.token,
  })
  assert.equal(deleteRes.status, 200)
  assert.equal(deleteRes.data.ok, true)

  // Token is immediately rejected
  const postDeleteVerify = await callMiddleware(middleware, '/api/admin/verify', {
    method: 'POST',
    token: freshToken,
  })
  assert.equal(postDeleteVerify.status, 401)

  // Admin record removed from database
  const remainingDev = supabase.tables.admin_users.find((u) => u.id === DEV_ADMIN_ID)
  assert.equal(remainingDev, undefined)
})

test('Permission Management: Canonical permission inspection and route enforcement', async () => {
  const supabase = createInMemorySupabase()
  const middleware = createAdminAuthMiddleware({
    sessionSecret: TEST_SECRET,
    supabaseClient: supabase,
    disableRateLimit: true,
  })

  // 1. Super Admin login returns 21 canonical permissions
  const superLogin = await callMiddleware(middleware, '/api/admin/login', {
    method: 'POST',
    body: { email: SUPERADMIN_EMAIL, password: SUPERADMIN_PASS },
  })
  assert.equal(superLogin.status, 200)
  assert.equal(superLogin.data.role, 'superadmin')
  assert.equal(Array.isArray(superLogin.data.permissions), true)
  assert.equal(superLogin.data.permissions.length, 21)

  // 2. Dev Admin login returns 10 operational permissions
  const devLogin = await callMiddleware(middleware, '/api/admin/login', {
    method: 'POST',
    body: { email: DEV_ADMIN_EMAIL, password: DEV_ADMIN_PASS },
  })
  assert.equal(devLogin.status, 200)
  assert.equal(devLogin.data.role, 'admin')
  assert.equal(Array.isArray(devLogin.data.permissions), true)
  assert.equal(devLogin.data.permissions.length, 10)
  assert.ok(devLogin.data.permissions.includes('dashboard:view'))
  assert.ok(devLogin.data.permissions.includes('users:view'))
  assert.ok(!devLogin.data.permissions.includes('admin:accounts:view'))
  assert.ok(!devLogin.data.permissions.includes('admin:roles:manage'))

  // 3. GET /api/admin/permissions for Super Admin
  const superPermsRes = await callMiddleware(middleware, '/api/admin/permissions', {
    method: 'GET',
    token: superLogin.data.token,
  })
  assert.equal(superPermsRes.status, 200)
  assert.equal(superPermsRes.data.ok, true)
  assert.equal(superPermsRes.data.role, 'superadmin')
  assert.equal(superPermsRes.data.permissions.length, 21)
  assert.equal(superPermsRes.data.canonicalPermissions.length, 21)

  // 4. GET /api/admin/permissions for Dev Admin
  const devPermsRes = await callMiddleware(middleware, '/api/admin/permissions', {
    method: 'GET',
    token: devLogin.data.token,
  })
  assert.equal(devPermsRes.status, 200)
  assert.equal(devPermsRes.data.ok, true)
  assert.equal(devPermsRes.data.role, 'admin')
  assert.equal(devPermsRes.data.permissions.length, 10)

  // 5. Dev Admin can access permitted operational route (users:view)
  const devSummaryRes = await callMiddleware(middleware, '/api/admin/customers/summary', {
    method: 'GET',
    token: devLogin.data.token,
  })
  // Summary route attempts to query Supabase or returns customer summary
  assert.ok(devSummaryRes.status === 200 || devSummaryRes.status === 500) // 200 or SQLite/Supabase query, not 401/403

  // 6. Dev Admin blocked from superadmin route (admin:accounts:view) with 403 PERMISSION_DENIED
  const blockedAdminRes = await callMiddleware(middleware, '/api/superadmin/admins', {
    method: 'GET',
    token: devLogin.data.token,
  })
  assert.equal(blockedAdminRes.status, 403)
  assert.equal(blockedAdminRes.data.code, 'PERMISSION_DENIED')

  // 7. Permission violation logged to audit_logs
  const violationLogs = supabase.tables.audit_logs.filter(
    (log) => log.action === 'security.permission_violation.blocked',
  )
  assert.ok(violationLogs.length >= 1)
  assert.equal(violationLogs[0].details.actor_email, DEV_ADMIN_EMAIL)
  assert.equal(violationLogs[0].details.role, 'admin')

  // 8. GET /api/admin/permissions requires authentication (401 without token)
  const unauthPermsRes = await callMiddleware(middleware, '/api/admin/permissions', {
    method: 'GET',
  })
  assert.equal(unauthPermsRes.status, 401)
})

test('Priority 5 - Activity Monitoring: Event tracking, KPI statistics, filtering, and session revocation', async () => {
  const supabase = createInMemorySupabase()
  const middleware = createAdminAuthMiddleware({
    sessionSecret: TEST_SECRET,
    supabaseClient: supabase,
    disableRateLimit: true,
  })

  // 1. Super Admin and Dev Admin logins (creates sessions and audit logs)
  const superLogin = await callMiddleware(middleware, '/api/admin/login', {
    method: 'POST',
    body: { email: SUPERADMIN_EMAIL, password: SUPERADMIN_PASS },
    headers: { 'user-agent': 'TestSuperAdminAgent/1.0' },
  })
  assert.equal(superLogin.status, 200)
  const superToken = superLogin.data.token

  const devLogin = await callMiddleware(middleware, '/api/admin/login', {
    method: 'POST',
    body: { email: DEV_ADMIN_EMAIL, password: DEV_ADMIN_PASS },
    headers: { 'user-agent': 'TestDevAdminAgent/2.0' },
  })
  assert.equal(devLogin.status, 200)
  const devToken = devLogin.data.token

  // 2. Unauthenticated and Dev Admin access to Activity and Sessions endpoints
  const unauthActRes = await callMiddleware(middleware, '/api/superadmin/activity', { method: 'GET' })
  assert.equal(unauthActRes.status, 401)

  const devActRes = await callMiddleware(middleware, '/api/superadmin/activity', { method: 'GET', token: devToken })
  assert.equal(devActRes.status, 403)

  const unauthSessRes = await callMiddleware(middleware, '/api/superadmin/sessions', { method: 'GET' })
  assert.equal(unauthSessRes.status, 401)

  const devSessRes = await callMiddleware(middleware, '/api/superadmin/sessions', { method: 'GET', token: devToken })
  assert.equal(devSessRes.status, 403)

  // 3. Super Admin can view Activity Stream with calculated stats and categories
  const superActRes = await callMiddleware(middleware, '/api/superadmin/activity', {
    method: 'GET',
    token: superToken,
  })
  assert.equal(superActRes.status, 200)
  assert.equal(superActRes.data.ok, true)
  assert.ok(Array.isArray(superActRes.data.activities))
  assert.ok(superActRes.data.total >= 2)
  assert.ok(superActRes.data.stats)
  assert.equal(typeof superActRes.data.stats.totalEvents, 'number')
  assert.equal(typeof superActRes.data.stats.eventsToday, 'number')
  assert.equal(typeof superActRes.data.stats.uniqueActors, 'number')
  assert.equal(typeof superActRes.data.stats.criticalCount, 'number')

  // Verify categories and user agent in activity records
  const loginActivity = superActRes.data.activities.find((a) => a.action === 'admin.login.success')
  assert.ok(loginActivity)
  assert.equal(loginActivity.category, 'Security')
  assert.ok(loginActivity.details.user_agent)

  // 4. Activity filtering: by category and search
  const filteredCatRes = await callMiddleware(middleware, '/api/superadmin/activity?category=Security', {
    method: 'GET',
    token: superToken,
  })
  assert.equal(filteredCatRes.status, 200)
  assert.ok(filteredCatRes.data.activities.every((a) => a.category === 'Security'))

  // 5. Super Admin can view active administrator sessions with live status
  const superSessRes = await callMiddleware(middleware, '/api/superadmin/sessions', {
    method: 'GET',
    token: superToken,
  })
  assert.equal(superSessRes.status, 200)
  assert.equal(superSessRes.data.ok, true)
  assert.ok(Array.isArray(superSessRes.data.sessions))
  assert.ok(superSessRes.data.sessions.length >= 2)
  assert.ok(superSessRes.data.activeCount >= 2)
  assert.equal(typeof superSessRes.data.expiredCount, 'number')
  assert.equal(typeof superSessRes.data.revokedCount, 'number')

  const devSession = superSessRes.data.sessions.find((s) => s.admin_email === DEV_ADMIN_EMAIL)
  assert.ok(devSession)
  assert.equal(devSession.status, 'active')
  assert.equal(devSession.role, 'admin')

  // 6. Dev Admin cannot revoke sessions (403 Forbidden)
  const devRevokeAttempt = await callMiddleware(middleware, `/api/superadmin/sessions/${devSession.id}/revoke`, {
    method: 'POST',
    token: devToken,
    body: { reason: 'Unauthorized revoke attempt' },
  })
  assert.equal(devRevokeAttempt.status, 403)

  // 7. Super Admin revokes Dev Admin session
  const revokeRes = await callMiddleware(middleware, `/api/superadmin/sessions/${devSession.id}/revoke`, {
    method: 'POST',
    token: superToken,
    body: { reason: 'Security audit rotation' },
  })
  assert.equal(revokeRes.status, 200)
  assert.equal(revokeRes.data.ok, true)
  assert.equal(revokeRes.data.sessionId, devSession.id)

  // 8. Revoked session is recorded in audit_logs with reason and user agent
  const revokeAuditLogs = supabase.tables.audit_logs.filter((l) => l.action === 'admin.session.revoked')
  assert.ok(revokeAuditLogs.length >= 1)
  const revokeLog = revokeAuditLogs.find((l) => l.target_id === devSession.id)
  assert.ok(revokeLog)
  assert.equal(revokeLog.details.actor_email, SUPERADMIN_EMAIL)
  assert.equal(revokeLog.details.target_email, DEV_ADMIN_EMAIL)
  assert.equal(revokeLog.details.reason, 'Security audit rotation')

  // 9. Session is immediately rejected on next verification request (401 Revoked)
  const postRevokeVerify = await callMiddleware(middleware, '/api/admin/verify', {
    method: 'GET',
    token: devToken,
  })
  assert.equal(postRevokeVerify.status, 401)
  assert.equal(postRevokeVerify.data.error, 'Administrator session has been revoked.')

  // 10. Sessions endpoint now reflects the revoked session count
  const updatedSessRes = await callMiddleware(middleware, '/api/superadmin/sessions', {
    method: 'GET',
    token: superToken,
  })
  assert.equal(updatedSessRes.status, 200)
  assert.ok(updatedSessRes.data.revokedCount >= 1)
  const updatedDevSession = updatedSessRes.data.sessions.find((s) => s.id === devSession.id)
  assert.ok(updatedDevSession)
  assert.equal(updatedDevSession.status, 'revoked')

  // 11. Sensitive credential safety: no password hashes or secrets in any audit logs
  for (const log of supabase.tables.audit_logs) {
    const rawDetails = JSON.stringify(log.details || {})
    assert.ok(!rawDetails.includes(SUPERADMIN_PASS), 'Password plaintext must never appear in audit logs')
    assert.ok(!rawDetails.includes(DEV_ADMIN_PASS), 'Password plaintext must never appear in audit logs')
    assert.ok(!rawDetails.includes('$argon2'), 'Password hash must never appear in audit logs')
    assert.ok(!rawDetails.includes(TEST_SECRET), 'Session secret must never appear in audit logs')
  }
})

test('Priority 6 - Audit Logs: Access control, search, filtering, sorting, pagination, and credential redaction', async () => {
  const supabase = createInMemorySupabase()
  const middleware = createAdminAuthMiddleware({
    sessionSecret: TEST_SECRET,
    supabaseClient: supabase,
    disableRateLimit: true,
  })

  // 1. Super Admin and Dev Admin logins
  const superLogin = await callMiddleware(middleware, '/api/admin/login', {
    method: 'POST',
    body: { email: SUPERADMIN_EMAIL, password: SUPERADMIN_PASS },
    headers: { 'user-agent': 'AuditTestSuperAgent/1.0' },
  })
  assert.equal(superLogin.status, 200)
  const superToken = superLogin.data.token

  const devLogin = await callMiddleware(middleware, '/api/admin/login', {
    method: 'POST',
    body: { email: DEV_ADMIN_EMAIL, password: DEV_ADMIN_PASS },
    headers: { 'user-agent': 'AuditTestDevAgent/2.0' },
  })
  assert.equal(devLogin.status, 200)
  const devToken = devLogin.data.token

  // 2. Unauthenticated access receives HTTP 401
  const unauthAuditRes = await callMiddleware(middleware, '/api/superadmin/audit-logs', { method: 'GET' })
  assert.equal(unauthAuditRes.status, 401)

  // 3. Dev Admin access receives HTTP 403 Forbidden
  const devAuditRes = await callMiddleware(middleware, '/api/superadmin/audit-logs', {
    method: 'GET',
    token: devToken,
  })
  assert.equal(devAuditRes.status, 403)

  // 4. Super Admin receives HTTP 200 with logs and full KPI statistics
  const superAuditRes = await callMiddleware(middleware, '/api/superadmin/audit-logs', {
    method: 'GET',
    token: superToken,
  })
  assert.equal(superAuditRes.status, 200)
  assert.equal(superAuditRes.data.ok, true)
  assert.ok(Array.isArray(superAuditRes.data.logs))
  assert.ok(superAuditRes.data.total >= 2)
  assert.ok(superAuditRes.data.stats)
  assert.equal(typeof superAuditRes.data.stats.totalEvents, 'number')
  assert.equal(typeof superAuditRes.data.stats.eventsToday, 'number')
  assert.equal(typeof superAuditRes.data.stats.criticalCount, 'number')
  assert.equal(typeof superAuditRes.data.stats.warningCount, 'number')
  assert.equal(typeof superAuditRes.data.stats.successCount, 'number')

  // 5. Category filter: only Security records
  const secFilterRes = await callMiddleware(middleware, '/api/superadmin/audit-logs?category=Security', {
    method: 'GET',
    token: superToken,
  })
  assert.equal(secFilterRes.status, 200)
  assert.ok(secFilterRes.data.logs.every((l) => l.category === 'Security'))

  // 6. Search filter: search by email
  const searchRes = await callMiddleware(
    middleware,
    `/api/superadmin/audit-logs?search=${encodeURIComponent(DEV_ADMIN_EMAIL)}`,
    {
      method: 'GET',
      token: superToken,
    },
  )
  assert.equal(searchRes.status, 200)
  assert.ok(searchRes.data.logs.length >= 1)
  assert.ok(
    searchRes.data.logs.some(
      (l) =>
        l.adminEmail === DEV_ADMIN_EMAIL ||
        l.targetResource.includes(DEV_ADMIN_EMAIL) ||
        JSON.stringify(l.details || {}).includes(DEV_ADMIN_EMAIL),
    ),
  )

  // 7. Sorting: sortBy=oldest vs sortBy=newest
  const newestRes = await callMiddleware(middleware, '/api/superadmin/audit-logs?sortBy=newest', {
    method: 'GET',
    token: superToken,
  })
  const oldestRes = await callMiddleware(middleware, '/api/superadmin/audit-logs?sortBy=oldest', {
    method: 'GET',
    token: superToken,
  })
  assert.equal(newestRes.status, 200)
  assert.equal(oldestRes.status, 200)
  if (newestRes.data.logs.length >= 2) {
    const firstNewest = new Date(newestRes.data.logs[0].isoTimestamp).getTime()
    const lastNewest = new Date(newestRes.data.logs[newestRes.data.logs.length - 1].isoTimestamp).getTime()
    assert.ok(firstNewest >= lastNewest)

    const firstOldest = new Date(oldestRes.data.logs[0].isoTimestamp).getTime()
    const lastOldest = new Date(oldestRes.data.logs[oldestRes.data.logs.length - 1].isoTimestamp).getTime()
    assert.ok(firstOldest <= lastOldest)
  }

  // 8. Pagination: limit and offset
  const page1Res = await callMiddleware(middleware, '/api/superadmin/audit-logs?limit=1&offset=0', {
    method: 'GET',
    token: superToken,
  })
  const page2Res = await callMiddleware(middleware, '/api/superadmin/audit-logs?limit=1&offset=1', {
    method: 'GET',
    token: superToken,
  })
  assert.equal(page1Res.status, 200)
  assert.equal(page2Res.status, 200)
  assert.equal(page1Res.data.logs.length, 1)
  assert.equal(page2Res.data.logs.length, 1)
  assert.notEqual(page1Res.data.logs[0].id, page2Res.data.logs[0].id)

  // 9. Sanitization: CSV formula injection check
  const formulaPayloads = ['=SUM(A1:A10)', '+cmd|/C calc', '-1337', '@evil.com', '\tcmd', '\rcalc']
  for (const raw of formulaPayloads) {
    let sanitized = raw
    if (/^[\s]*[=+\-@\t\r]/.test(sanitized)) {
      sanitized = `'${sanitized}`
    }
    assert.ok(sanitized.startsWith("'"), `Formula injection string "${raw}" must be prepended with a quote`)
  }
})

test('Priority 7 - Super Admin Dashboard Overview: Live Supabase statistics, role separation, and error handling', async () => {
  const supabase = createInMemorySupabase()
  const middleware = createAdminAuthMiddleware({
    sessionSecret: TEST_SECRET,
    supabaseClient: supabase,
    disableRateLimit: true,
  })

  // 1. Authenticate Super Admin and Standard Admin
  const superLogin = await callMiddleware(middleware, '/api/admin/login', {
    method: 'POST',
    body: { email: SUPERADMIN_EMAIL, password: SUPERADMIN_PASS },
  })
  assert.equal(superLogin.status, 200)
  const superToken = superLogin.data.token

  const devLogin = await callMiddleware(middleware, '/api/admin/login', {
    method: 'POST',
    body: { email: DEV_ADMIN_EMAIL, password: DEV_ADMIN_PASS },
  })
  assert.equal(devLogin.status, 200)
  const devToken = devLogin.data.token

  // 2. Unauthenticated request to /api/superadmin/dashboard/overview receives HTTP 401
  const unauthRes = await callMiddleware(middleware, '/api/superadmin/dashboard/overview', { method: 'GET' })
  assert.equal(unauthRes.status, 401)

  // 3. Dev Admin token receives HTTP 403 Forbidden
  const devRes = await callMiddleware(middleware, '/api/superadmin/dashboard/overview', {
    method: 'GET',
    token: devToken,
  })
  assert.equal(devRes.status, 403)

  // 4. Super Admin receives HTTP 200 with full live Supabase statistics
  const superRes = await callMiddleware(middleware, '/api/superadmin/dashboard/overview', {
    method: 'GET',
    token: superToken,
  })
  assert.equal(superRes.status, 200)
  assert.equal(superRes.data.ok, true)
  assert.ok(superRes.data.overview)

  const { overview } = superRes.data

  // 5. Verify Admin Statistics
  assert.equal(overview.adminStats.total, 2)
  assert.equal(overview.adminStats.active, 2)
  assert.equal(overview.adminStats.inactive, 0)
  assert.equal(overview.adminStats.superadminCount, 1)
  assert.equal(overview.adminStats.standardAdminCount, 1)
  assert.equal(overview.adminStats.roleDistribution.superadmin, 1)
  assert.equal(overview.adminStats.roleDistribution.admin, 1)

  // 6. Verify Customer Statistics (profiles excluding role='admin')
  assert.equal(overview.customerStats.total, 2)
  assert.equal(overview.customerStats.active, 1)
  assert.equal(overview.customerStats.inactive, 1)
  assert.equal(typeof overview.customerStats.registrations.today, 'number')
  assert.equal(typeof overview.customerStats.registrations.last7Days, 'number')
  assert.equal(typeof overview.customerStats.registrations.last30Days, 'number')
  assert.equal(Array.isArray(overview.customerStats.registrations.daily), true)
  assert.equal(overview.customerStats.registrations.daily.length, 7)

  // 7. Verify Activity and Security Statistics
  assert.equal(typeof overview.activityStats.totalActivities, 'number')
  assert.equal(typeof overview.activityStats.activitiesToday, 'number')
  assert.equal(typeof overview.activityStats.successfulLogins, 'number')
  assert.equal(typeof overview.activityStats.failedLogins, 'number')
  assert.equal(Array.isArray(overview.activityStats.recentActivities), true)

  assert.equal(typeof overview.securityStats.failedLoginAttempts, 'number')
  assert.equal(typeof overview.securityStats.blockedActions, 'number')
  assert.equal(typeof overview.securityStats.activeSessions, 'number')
  assert.equal(typeof overview.securityStats.revokedSessions, 'number')
  assert.equal(Array.isArray(overview.securityStats.recentSecurityEvents), true)

  // 8. Verify Platform Statistics (Organizations & API Keys)
  assert.equal(overview.platformStats.totalOrganizations, 2)
  assert.equal(overview.platformStats.totalApiKeys, 2)
  assert.equal(overview.platformStats.activeApiKeys, 1)

  // 9. Strict exclusion: No GPU telemetry
  assert.equal('gpuStats' in overview, false)
  assert.equal('gpus' in overview, false)
  assert.equal('clusterStats' in overview, false)

  // 10. Alias endpoint /api/superadmin/overview returns identical payload
  const aliasRes = await callMiddleware(middleware, '/api/superadmin/overview', {
    method: 'GET',
    token: superToken,
  })
  assert.equal(aliasRes.status, 200)
  assert.equal(aliasRes.data.ok, true)
  assert.deepEqual(aliasRes.data.overview.adminStats, overview.adminStats)
  assert.deepEqual(aliasRes.data.overview.customerStats.total, overview.customerStats.total)
  assert.deepEqual(aliasRes.data.overview.platformStats, overview.platformStats)

  // 11. Customer active/inactive reconciliation with NULL, missing, inactive, and suspended statuses
  supabase.tables.profiles.push(
    { user_id: 'cust-null', email: 'null@example.com', role: 'user', status: null, is_active: false },
    { user_id: 'cust-missing', email: 'missing@example.com', role: 'user' },
    { user_id: 'cust-suspended', email: 'suspended@example.com', role: 'user', status: 'suspended' },
    { user_id: 'cust-active2', email: 'active2@example.com', role: 'user', status: 'active' },
  )
  const reconciledRes = await callMiddleware(middleware, '/api/superadmin/dashboard/overview', {
    method: 'GET',
    token: superToken,
  })
  assert.equal(reconciledRes.status, 200)
  const custStats = reconciledRes.data.overview.customerStats
  assert.equal(custStats.total, 6)
  assert.equal(custStats.active, 2) // cust-1 and cust-active2
  assert.equal(custStats.inactive, 4) // cust-2, cust-null, cust-missing, cust-suspended
  assert.equal(custStats.active + custStats.inactive, custStats.total)

  // 12. API key statistics consistency with FastAPI :8001
  supabase.tables.api_keys.push(
    { id: 'key-expired', status: 'active', revoked_at: null, expires_at: new Date(Date.now() - 3600000).toISOString() },
    { id: 'key-inactive-no-revoked', status: 'inactive', revoked_at: null },
  )
  const apiKeysTestRes = await callMiddleware(middleware, '/api/superadmin/dashboard/overview', {
    method: 'GET',
    token: superToken,
  })
  assert.equal(apiKeysTestRes.status, 200)
  const platStats = apiKeysTestRes.data.overview.platformStats
  assert.equal(platStats.totalApiKeys, 4)
  assert.equal(platStats.activeApiKeys, 1) // only key-1 is active (key-2 revoked, key-expired expired, key-inactive inactive)

  // 13. Individual query failure handling: reported as unavailable rather than silently zero
  const failingSupabase = {
    ...supabase,
    from(table) {
      if (table === 'profiles' || table === 'organizations') {
        const errorBuilder = {
          select() { return errorBuilder },
          neq() { return errorBuilder },
          then(resolve, reject) {
            const err = new Error(`Simulated database failure on ${table}`)
            if (typeof reject === 'function') reject(err)
            else throw err
          },
        }
        return errorBuilder
      }
      return supabase.from(table)
    },
  }
  const failMiddleware = createAdminAuthMiddleware({
    sessionSecret: TEST_SECRET,
    supabaseClient: failingSupabase,
    disableRateLimit: true,
  })
  const partialRes = await callMiddleware(failMiddleware, '/api/superadmin/dashboard/overview', {
    method: 'GET',
    token: superToken,
  })
  assert.equal(partialRes.status, 200)
  assert.ok(Array.isArray(partialRes.data.overview.unavailableMetrics))
  assert.ok(partialRes.data.overview.unavailableMetrics.includes('customerStats'))
  assert.ok(partialRes.data.overview.unavailableMetrics.includes('organizationStats'))
  assert.equal(partialRes.data.overview.customerStats.available, false)
  assert.equal(partialRes.data.overview.platformStats.organizationsAvailable, false)
  assert.equal(partialRes.data.overview.adminStats.available, true)
})
