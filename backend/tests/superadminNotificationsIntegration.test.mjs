/**
 * superadminNotificationsIntegration.test.mjs
 * ===========================================
 * End-to-end integration tests for Super Admin account creation and deletion notifications:
 * 1. Admin creation triggers SUPERADMIN_ADMIN_CREATED notification.
 * 2. Admin deletion triggers SUPERADMIN_ADMIN_DELETED notification.
 * 3. Failed operations (duplicate email, weak password, invalid role, protected superadmin deletion) generate ZERO notifications.
 * 4. Recipient isolation: Super Admins receive notifications; standard Admins never receive them.
 * 5. Credential safety: Passwords, password hashes, and tokens are NEVER dispatched in notification payloads.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import {
  createAdminAuthMiddleware,
} from '../auth/adminAuth.js'
import { hashPassword } from '../auth/adminPassword.js'

const TEST_SECRET = 'super-secret-admin-session-signing-key-32chars!'
const SUPERADMIN_ID = 'd9a494cb-1e8d-4bca-8142-19687fa9138b'
const SUPERADMIN_EMAIL = 'admin@inferxe.com'
const SUPERADMIN_PASS = 'SuperAdmin#Governance2026!'

const DEV_ADMIN_ID = 'c1111111-1111-4111-8111-111111111111'
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
    notifications: [],
    profiles: [],
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
        if (state.op === 'upsert') {
          const existingIdx = rows.findIndex((r) => r.user_id === state.payload.user_id || r.id === state.payload.id)
          if (existingIdx >= 0) {
            rows[existingIdx] = { ...rows[existingIdx], ...state.payload }
          } else {
            rows.push({ id: state.payload.id || crypto.randomUUID(), created_at: new Date().toISOString(), ...state.payload })
          }
          return { data: state.payload, error: null }
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
        upsert(p) { state.op = 'upsert'; state.payload = p; return b },
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

test('1. Successful Admin creation generates SUPERADMIN_ADMIN_CREATED notification for Super Admin', async () => {
  const supabase = createInMemorySupabase()
  const middleware = createAdminAuthMiddleware({
    sessionSecret: TEST_SECRET,
    supabaseClient: supabase,
    disableRateLimit: true,
  })

  // 1. Super Admin authenticates cleanly
  const loginRes = await callMiddleware(middleware, '/api/admin/login', {
    method: 'POST',
    body: { email: SUPERADMIN_EMAIL, password: SUPERADMIN_PASS },
  })
  assert.equal(loginRes.status, 200)
  const superToken = loginRes.data.token

  // 2. Super Admin creates a new developer admin
  const res = await callMiddleware(middleware, '/api/superadmin/admins', {
    method: 'POST',
    token: superToken,
    body: {
      email: 'new-operator@inferxe.com',
      password: 'Operator#2026!StrongPass',
    },
  })

  assert.equal(res.status, 201)
  assert.equal(res.data.ok, true)
  assert.equal(res.data.admin.email, 'new-operator@inferxe.com')

  // 3. Verify notification was created targeting Super Admin
  const notifs = supabase.tables.notifications
  const createNotif = notifs.find((n) => n.notification_type === 'SUPERADMIN_ADMIN_CREATED')
  assert.ok(createNotif, 'Expected SUPERADMIN_ADMIN_CREATED notification to be generated')
  assert.equal(createNotif.title, 'Admin Account Created')
  assert.equal(createNotif.message, 'A new Admin account has been created.')
  assert.equal(createNotif.user_id, SUPERADMIN_ID)
  assert.equal(createNotif.is_read, false)

  // 4. Verify credential safety: no password or hash in metadata or message
  assert.equal(createNotif.message.includes('password'), false)
  assert.equal('password' in (createNotif.metadata || {}), false)
  assert.equal('password_hash' in (createNotif.metadata || {}), false)
})

test('2. Successful Admin deletion generates SUPERADMIN_ADMIN_DELETED notification for Super Admin', async () => {
  const supabase = createInMemorySupabase()
  const middleware = createAdminAuthMiddleware({
    sessionSecret: TEST_SECRET,
    supabaseClient: supabase,
    disableRateLimit: true,
  })

  const loginRes = await callMiddleware(middleware, '/api/admin/login', {
    method: 'POST',
    body: { email: SUPERADMIN_EMAIL, password: SUPERADMIN_PASS },
  })
  assert.equal(loginRes.status, 200)
  const superToken = loginRes.data.token

  const res = await callMiddleware(middleware, `/api/superadmin/admins/${DEV_ADMIN_ID}`, {
    method: 'DELETE',
    token: superToken,
    body: { reason: 'Terminated access' },
  })

  assert.equal(res.status, 200)
  assert.equal(res.data.ok, true)

  const notifs = supabase.tables.notifications
  const deleteNotif = notifs.find((n) => n.notification_type === 'SUPERADMIN_ADMIN_DELETED')
  assert.ok(deleteNotif, 'Expected SUPERADMIN_ADMIN_DELETED notification to be generated')
  assert.equal(deleteNotif.title, 'Admin Account Deleted')
  assert.equal(deleteNotif.message, 'An Admin account has been deleted.')
  assert.equal(deleteNotif.user_id, SUPERADMIN_ID)
})

test('3. Failed creation operations (weak pass, duplicate email, invalid role) generate ZERO notifications', async () => {
  const supabase = createInMemorySupabase()
  const middleware = createAdminAuthMiddleware({
    sessionSecret: TEST_SECRET,
    supabaseClient: supabase,
    disableRateLimit: true,
  })

  const loginRes = await callMiddleware(middleware, '/api/admin/login', {
    method: 'POST',
    body: { email: SUPERADMIN_EMAIL, password: SUPERADMIN_PASS },
  })
  assert.equal(loginRes.status, 200)
  const superToken = loginRes.data.token

  // 1. Weak password (400)
  const weakRes = await callMiddleware(middleware, '/api/superadmin/admins', {
    method: 'POST',
    token: superToken,
    body: { email: 'weak@inferxe.com', password: '123' },
  })
  assert.equal(weakRes.status, 400)

  // 2. Duplicate email (409)
  const dupRes = await callMiddleware(middleware, '/api/superadmin/admins', {
    method: 'POST',
    token: superToken,
    body: { email: DEV_ADMIN_EMAIL, password: 'StrongPassword#2026!' },
  })
  assert.equal(dupRes.status, 409)

  // 3. Prohibited role promotion attempt (403)
  const rogueRoleRes = await callMiddleware(middleware, '/api/superadmin/admins', {
    method: 'POST',
    token: superToken,
    body: { email: 'rogue@inferxe.com', password: 'StrongPassword#2026!', role: 'superadmin' },
  })
  assert.equal(rogueRoleRes.status, 403)

  // Assert NO notifications were generated for these failed requests
  assert.equal(supabase.tables.notifications.length, 0)
})

test('4. Failed deletion operations (nonexistent admin, self-deletion, superadmin protection) generate ZERO notifications', async () => {
  const supabase = createInMemorySupabase()
  const middleware = createAdminAuthMiddleware({
    sessionSecret: TEST_SECRET,
    supabaseClient: supabase,
    disableRateLimit: true,
  })

  const loginRes = await callMiddleware(middleware, '/api/admin/login', {
    method: 'POST',
    body: { email: SUPERADMIN_EMAIL, password: SUPERADMIN_PASS },
  })
  assert.equal(loginRes.status, 200)
  const superToken = loginRes.data.token

  // 1. Nonexistent admin (404)
  const notFoundRes = await callMiddleware(middleware, '/api/superadmin/admins/00000000-0000-0000-0000-000000000000', {
    method: 'DELETE',
    token: superToken,
  })
  assert.equal(notFoundRes.status, 404)

  // 2. Primary Super Admin deletion protection (403)
  const protRes = await callMiddleware(middleware, `/api/superadmin/admins/${SUPERADMIN_ID}`, {
    method: 'DELETE',
    token: superToken,
  })
  assert.equal(protRes.status, 403)

  // Assert NO notifications generated
  assert.equal(supabase.tables.notifications.length, 0)
})

test('5. Standard Admin users are strictly blocked (403) from Super Admin actions and generate ZERO notifications', async () => {
  const supabase = createInMemorySupabase()
  const middleware = createAdminAuthMiddleware({
    sessionSecret: TEST_SECRET,
    supabaseClient: supabase,
    disableRateLimit: true,
  })

  const devLoginRes = await callMiddleware(middleware, '/api/admin/login', {
    method: 'POST',
    body: { email: DEV_ADMIN_EMAIL, password: DEV_ADMIN_PASS },
  })
  assert.equal(devLoginRes.status, 200)
  const devToken = devLoginRes.data.token

  const blockCreate = await callMiddleware(middleware, '/api/superadmin/admins', {
    method: 'POST',
    token: devToken,
    body: { email: 'dev-trying-to-create@inferxe.com', password: 'StrongPassword#2026!' },
  })
  assert.equal(blockCreate.status, 403)

  const blockDelete = await callMiddleware(middleware, `/api/superadmin/admins/${DEV_ADMIN_ID}`, {
    method: 'DELETE',
    token: devToken,
  })
  assert.equal(blockDelete.status, 403)

  assert.equal(supabase.tables.notifications.length, 0)
})
