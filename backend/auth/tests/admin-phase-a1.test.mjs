import '../../tests/support/networkGuard.mjs'  // test isolation guard: must stay the first import (tests/testSafety.test.mjs checks)
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  ADMIN_SESSION_COOKIE_NAME,
  createAdminAuthMiddleware,
  createAdminToken,
  verifyAdminSession,
  verifyAdminToken,
} from '../adminAuth.js'
import { hashPassword, validatePasswordStrength, verifyPassword, verifyPasswordWithReason, verifyPasswordWithReasonAsync } from '../adminPassword.js'
import { classifyAdminInsertError } from '../adminSessionStore.js'

const TEST_SECRET = 'phase-a1-test-signing-secret-with-at-least-32-chars-2026'
const SUPERADMIN_ID = 'd9a494cb-1e8d-4bca-8142-19687fa9138b'
const SUPERADMIN_EMAIL = 'admin@inferxe.com'
const SUPERADMIN_PASSWORD = 'SuperAdmin#Existing2026!'

/**
 * Lightweight in-memory Supabase query builder mock covering the exact tables
 * used by Phase A1 (`admin_users`, `admin_sessions`, `audit_logs`).
 */
function createMockSupabaseClient({ failMode = false } = {}) {
  const tables = {
    admin_users: [
      {
        id: SUPERADMIN_ID,
        email: SUPERADMIN_EMAIL,
        password_hash: hashPassword(SUPERADMIN_PASSWORD, { memory: 1024, passes: 2, parallelism: 1 }),
        role: 'superadmin',
        is_active: true,
        session_version: 1,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
        last_login: null,
      },
    ],
    admin_sessions: [],
    audit_logs: [],
  }

  let isFailing = failMode

  function projectColumns(row, columns) {
    if (!row || !columns || columns === '*') return { ...row }
    const cols = columns.split(',').map((c) => c.trim()).filter(Boolean)
    const out = {}
    for (const col of cols) {
      if (col in row) out[col] = row[col]
    }
    return out
  }

  function makeBuilder(tableName) {
    const state = {
      op: 'select',
      columns: '*',
      payload: null,
      filters: [],
      orderBy: null,
      range: null,
      singleMode: null,
    }

    const execute = async () => {
      if (isFailing) {
        return { data: null, error: { message: 'Simulated database outage' } }
      }
      const rows = tables[tableName]
      if (!rows) {
        return { data: null, error: { message: `Unknown table ${tableName}` } }
      }

      const matches = (row) =>
        state.filters.every((f) => {
          if (f.type === 'eq') return String(row[f.field]) === String(f.value)
          if (f.type === 'is') {
            return f.value === null
              ? row[f.field] === null || row[f.field] === undefined
              : row[f.field] === f.value
          }
          return true
        })

      if (state.op === 'insert') {
        const items = Array.isArray(state.payload) ? state.payload : [state.payload]
        const inserted = []
        for (const item of items) {
          if (tableName === 'admin_users') {
            const dup = rows.find((r) => r.email.toLowerCase() === String(item.email).toLowerCase())
            if (dup) {
              return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } }
            }
          }
          const nowIso = new Date().toISOString()
          const record = {
            id: item.id || crypto.randomUUID(),
            created_at: item.created_at || nowIso,
            ...item,
          }
          rows.push(record)
          inserted.push(projectColumns(record, state.columns))
        }
        if (state.singleMode === 'single') return { data: inserted[0] || null, error: null }
        return { data: inserted, error: null }
      }

      if (state.op === 'delete') {
        const initialCount = rows.length
        const remaining = rows.filter((r) => !matches(r))
        tables[tableName] = remaining
        return { data: null, error: null, count: initialCount - remaining.length }
      }

      if (state.op === 'update') {
        if (tableName === 'admin_users' && state.payload?.email) {
          const newEmail = String(state.payload.email).toLowerCase()
          const dup = rows.find((r) => !matches(r) && r.email.toLowerCase() === newEmail)
          if (dup) {
            return {
              data: null,
              error: {
                code: '23505',
                constraint: 'admin_users_email_lower_unique',
                message: 'duplicate key value violates unique constraint "admin_users_email_lower_unique"',
                details: `Key (lower(email))=(${newEmail}) already exists.`,
              },
            }
          }
        }
        const updated = []
        for (const row of rows) {
          if (matches(row)) {
            Object.assign(row, state.payload)
            updated.push(projectColumns(row, state.columns))
          }
        }
        if (state.singleMode === 'single') {
          return updated.length
            ? { data: updated[0], error: null }
            : { data: null, error: { message: 'No rows updated' } }
        }
        return { data: updated, error: null }
      }

      let result = rows.filter(matches).map((r) => projectColumns(r, state.columns))
      if (state.orderBy) {
        const { field, ascending } = state.orderBy
        result.sort((a, b) => {
          const av = String(a[field] ?? '')
          const bv = String(b[field] ?? '')
          return ascending ? av.localeCompare(bv) : bv.localeCompare(av)
        })
      }
      if (state.range) {
        result = result.slice(state.range.from, state.range.to + 1)
      }
      if (state.singleMode === 'maybeSingle') {
        return { data: result[0] || null, error: null }
      }
      if (state.singleMode === 'single') {
        return result[0]
          ? { data: result[0], error: null }
          : { data: null, error: { message: 'Row not found' } }
      }
      return { data: result, error: null }
    }

    const builder = {
      select(columns = '*') {
        if (state.op === 'select') {
          state.columns = columns
        } else {
          state.columns = columns
        }
        return builder
      },
      insert(payload) {
        state.op = 'insert'
        state.payload = payload
        return builder
      },
      update(payload) {
        state.op = 'update'
        state.payload = payload
        return builder
      },
      delete() {
        state.op = 'delete'
        return builder
      },
      eq(field, value) {
        state.filters.push({ type: 'eq', field, value })
        return builder
      },
      is(field, value) {
        state.filters.push({ type: 'is', field, value })
        return builder
      },
      order(field, opts = {}) {
        state.orderBy = { field, ascending: opts.ascending !== false }
        return builder
      },
      range(from, to) {
        state.range = { from, to }
        return builder
      },
      maybeSingle() {
        state.singleMode = 'maybeSingle'
        return execute()
      },
      single() {
        state.singleMode = 'single'
        return execute()
      },
      then(resolve, reject) {
        return execute().then(resolve, reject)
      },
    }

    return builder
  }

  return {
    tables,
    setFailMode(flag) {
      isFailing = Boolean(flag)
    },
    from(tableName) {
      return makeBuilder(tableName)
    },
  }
}

async function invokeMiddleware(middleware, path, { method = 'GET', token, cookie, body } = {}) {
  const chunks = body !== undefined ? [Buffer.from(JSON.stringify(body), 'utf8')] : []
  const req = Readable.from(chunks)
  req.url = path
  req.method = method
  req.headers = { accept: 'application/json' }
  if (body !== undefined) req.headers['content-type'] = 'application/json'
  if (token) req.headers.authorization = `Bearer ${token}`
  if (cookie) req.headers.cookie = cookie
  req.socket = { remoteAddress: '127.0.0.1' }

  const headers = new Map()
  let rawBody = ''
  let ended = false

  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      setHeader(name, value) {
        headers.set(String(name).toLowerCase(), value)
      },
      getHeader(name) {
        return headers.get(String(name).toLowerCase())
      },
      end(chunk = '') {
        if (ended) return
        ended = true
        rawBody += String(chunk || '')
        let data = {}
        try {
          data = rawBody ? JSON.parse(rawBody) : {}
        } catch {}
        const rawCookie = headers.get('set-cookie')
        const setCookie = Array.isArray(rawCookie) ? rawCookie.join('; ') : String(rawCookie || '')
        resolve({ status: res.statusCode, data, setCookie })
      },
    }

    const next = () => {
      if (ended) return
      ended = true
      resolve({ status: 404, data: { ok: false, error: 'passthrough' }, setCookie: '' })
    }

    Promise.resolve(middleware(req, res, next)).catch(reject)
  })
}

test('Argon2 password hashing and multi-variant verification work securely', () => {
  const hash = hashPassword('DevAccount#2026!Secure', { memory: 1024, passes: 2, parallelism: 1 })
  assert.ok(hash.startsWith('$argon2id$v=19$'))
  assert.equal(verifyPassword('DevAccount#2026!Secure', hash), true)
  assert.equal(verifyPassword('WrongPassword#2026!', hash), false)
  assert.equal(verifyPassword('DevAccount#2026!Secure', 'not-a-valid-hash'), false)

  // Verify live Supabase OWASP Argon2id parameters ($argon2id$v=19$m=19456,t=2,p=1$, 16B salt, 32B tag)
  const owaspHash = hashPassword('SuperAdmin#LiveFormat2026!', {
    memory: 19456,
    passes: 2,
    parallelism: 1,
    tagLength: 32,
  })
  assert.ok(owaspHash.startsWith('$argon2id$v=19$m=19456,t=2,p=1$'))
  assert.equal(verifyPassword('SuperAdmin#LiveFormat2026!', owaspHash), true)
  assert.equal(verifyPassword('WrongPassword', owaspHash), false)

  // Verify RFC 9106 Section 5.3 reference Argon2id output via Node native crypto.argon2Sync
  const rfcDerived = crypto.argon2Sync('argon2id', {
    message: Buffer.alloc(32, 1),
    nonce: Buffer.alloc(16, 2),
    secret: Buffer.alloc(8, 3),
    associatedData: Buffer.alloc(12, 4),
    passes: 3,
    memory: 32,
    parallelism: 4,
    tagLength: 32,
  })
  assert.equal(
    rfcDerived.toString('hex'),
    '0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659',
  )

  // Verify argon2i compatibility (in case existing Supabase hash uses argon2i)
  const salt = crypto.randomBytes(16)
  const derivedI = crypto.argon2Sync('argon2i', {
    message: Buffer.from('LegacyArgon2i#2026!', 'utf8'),
    nonce: salt,
    parallelism: 1,
    tagLength: 32,
    memory: 1024,
    passes: 2,
  })
  const argon2iPhc = `$argon2i$v=19$m=1024,t=2,p=1$${salt.toString('base64').replace(/=+$/, '')}$${derivedI.toString('base64').replace(/=+$/, '')}`
  assert.equal(verifyPassword('LegacyArgon2i#2026!', argon2iPhc), true)
  assert.equal(verifyPassword('Wrong', argon2iPhc), false)

  // Password strength validation
  assert.equal(validatePasswordStrength('admin123').valid, false)
  assert.equal(validatePasswordStrength('weakpass1234').valid, false)
  assert.equal(validatePasswordStrength('StrongDev#2026!').valid, true)
})

test('Phase A1 end-to-end: Super Admin login, developer creation, RBAC, session revocation, deactivation', async () => {
  const mockDb = createMockSupabaseClient()
  const middleware = createAdminAuthMiddleware({
    sessionSecret: TEST_SECRET,
    supabaseClient: mockDb,
    disableRateLimit: true,
  })

  // 1. Invalid password rejected (401)
  const badLogin = await invokeMiddleware(middleware, '/api/admin/login', {
    method: 'POST',
    body: { email: SUPERADMIN_EMAIL, password: 'wrong-password' },
  })
  assert.equal(badLogin.status, 401)
  assert.equal(badLogin.data.ok, false)
  assert.equal(badLogin.data.isAdmin, true)

  // 2. Non-admin customer email returns 200 { ok: false, isAdmin: false } so Cognito flow works
  const customerProbe = await invokeMiddleware(middleware, '/api/admin/login', {
    method: 'POST',
    body: { email: 'customer@example.com', password: 'SomePassword123!' },
  })
  assert.equal(customerProbe.status, 200)
  assert.equal(customerProbe.data.isAdmin, false)

  // 3. Super Admin login succeeds with DB session + HttpOnly cookie and never leaks password_hash
  const superLogin = await invokeMiddleware(middleware, '/api/admin/login', {
    method: 'POST',
    body: { email: SUPERADMIN_EMAIL, password: SUPERADMIN_PASSWORD },
  })
  assert.equal(superLogin.status, 200)
  assert.equal(superLogin.data.ok, true)
  assert.equal(superLogin.data.role, 'superadmin')
  assert.equal(superLogin.data.user.id, SUPERADMIN_ID)
  assert.equal(superLogin.data.user.role, 'superadmin')
  assert.equal('password_hash' in superLogin.data.user, false)
  assert.ok(superLogin.setCookie.includes(`${ADMIN_SESSION_COOKIE_NAME}=`))
  assert.ok(superLogin.setCookie.includes('HttpOnly'))
  assert.equal(mockDb.tables.admin_sessions.length, 1)

  const superToken = superLogin.data.token
  const superCookie = superLogin.setCookie.split(';')[0]

  // 4. Verify works with Bearer token AND with HttpOnly cookie alone
  const verifyBearer = await invokeMiddleware(middleware, '/api/admin/verify', {
    method: 'POST',
    token: superToken,
  })
  assert.equal(verifyBearer.status, 200)
  assert.equal(verifyBearer.data.valid, true)
  assert.equal(verifyBearer.data.user.role, 'superadmin')

  const verifyCookie = await invokeMiddleware(middleware, '/api/admin/verify', {
    method: 'GET',
    cookie: superCookie,
  })
  assert.equal(verifyCookie.status, 200)
  assert.equal(verifyCookie.data.valid, true)
  assert.equal(verifyCookie.data.user.id, SUPERADMIN_ID)

  // 5. Bypass tokens and stateless tokens without DB session ID are strictly rejected
  for (const fakeToken of ['ix-tok-forged', 'ix-admin-dev', 'admin-dev-token']) {
    const res = await invokeMiddleware(middleware, '/api/admin/verify', {
      method: 'POST',
      token: fakeToken,
    })
    assert.equal(res.status, 401)
    assert.equal(res.data.valid, false)
  }
  const nowSec = Math.floor(Date.now() / 1000)
  const statelessJwt = createAdminToken(
    { sub: SUPERADMIN_ID, email: SUPERADMIN_EMAIL, role: 'superadmin', iat: nowSec, exp: nowSec + 3600 },
    TEST_SECRET,
  )
  const statelessVerify = await invokeMiddleware(middleware, '/api/admin/verify', {
    method: 'POST',
    token: statelessJwt,
  })
  assert.equal(statelessVerify.status, 401)

  // 6. Super Admin cannot create another superadmin (403)
  const createSuperAttempt = await invokeMiddleware(middleware, '/api/superadmin/admins', {
    method: 'POST',
    token: superToken,
    body: { email: 'rogue@inferxe.com', password: 'StrongDev#2026!Password', role: 'superadmin' },
  })
  assert.equal(createSuperAttempt.status, 403)

  // 7. Weak password rejected (400)
  const weakCreate = await invokeMiddleware(middleware, '/api/superadmin/admins', {
    method: 'POST',
    token: superToken,
    body: { email: 'dev1@inferxe.com', password: 'password' },
  })
  assert.equal(weakCreate.status, 400)

  // 8. Super Admin creates developer admin account (201, role='admin', Argon2id hash, no password_hash in response)
  const devPassword = 'DevUser#2026!StrongPass'
  const devCreate = await invokeMiddleware(middleware, '/api/superadmin/admins', {
    method: 'POST',
    token: superToken,
    body: { email: 'dev1@inferxe.com', password: devPassword },
  })
  assert.equal(devCreate.status, 201)
  assert.equal(devCreate.data.ok, true)
  assert.equal(devCreate.data.admin.email, 'dev1@inferxe.com')
  assert.equal(devCreate.data.admin.role, 'admin')
  assert.equal(devCreate.data.admin.is_active, true)
  assert.equal('password_hash' in devCreate.data.admin, false)

  const storedDev = mockDb.tables.admin_users.find((u) => u.email === 'dev1@inferxe.com')
  assert.ok(storedDev.password_hash.startsWith('$argon2id$v=19$'))

  // 9. Duplicate developer email rejected (409 + DUPLICATE_ADMIN_EMAIL code)
  const dupCreate = await invokeMiddleware(middleware, '/api/superadmin/admins', {
    method: 'POST',
    token: superToken,
    body: { email: 'dev1@inferxe.com', password: devPassword },
  })
  assert.equal(dupCreate.status, 409)
  assert.equal(dupCreate.data.code, 'DUPLICATE_ADMIN_EMAIL')

  // 10. Developer admin logs in and receives role='admin'
  const devLogin = await invokeMiddleware(middleware, '/api/admin/login', {
    method: 'POST',
    body: { email: 'dev1@inferxe.com', password: devPassword },
  })
  assert.equal(devLogin.status, 200)
  assert.equal(devLogin.data.role, 'admin')
  const devToken = devLogin.data.token

  // 11. Normal developer admin is strictly blocked (403) from all /api/superadmin/* endpoints
  const devGetAdmins = await invokeMiddleware(middleware, '/api/superadmin/admins', {
    method: 'GET',
    token: devToken,
  })
  assert.equal(devGetAdmins.status, 403)

  const devCreateAdmin = await invokeMiddleware(middleware, '/api/superadmin/admins', {
    method: 'POST',
    token: devToken,
    body: { email: 'dev2@inferxe.com', password: 'DevUser2#2026!StrongPass' },
  })
  assert.equal(devCreateAdmin.status, 403)

  const devAuditLogs = await invokeMiddleware(middleware, '/api/superadmin/audit-logs', {
    method: 'GET',
    token: devToken,
  })
  assert.equal(devAuditLogs.status, 403)

  // 12. Super Admin can list admins without leaking password_hash
  const listAdmins = await invokeMiddleware(middleware, '/api/superadmin/admins', {
    method: 'GET',
    token: superToken,
  })
  assert.equal(listAdmins.status, 200)
  assert.equal(listAdmins.data.admins.length, 2)
  for (const adm of listAdmins.data.admins) {
    assert.equal('password_hash' in adm, false)
  }

  // 13. Super Admin cannot deactivate themselves or a superadmin account
  const selfDeactivate = await invokeMiddleware(middleware, '/api/superadmin/admins/status', {
    method: 'POST',
    token: superToken,
    body: { admin_id: SUPERADMIN_ID, status: 'inactive' },
  })
  assert.equal(selfDeactivate.status, 400)

  // 14. Super Admin deactivates developer admin -> existing session immediately rejected & login blocked
  const deactivateDev = await invokeMiddleware(
    middleware,
    `/api/superadmin/admins/${devCreate.data.admin.id}/status`,
    {
      method: 'PATCH',
      token: superToken,
      body: { is_active: false, reason: 'Offboarded contractor' },
    },
  )
  assert.equal(deactivateDev.status, 200)
  assert.equal(deactivateDev.data.admin.is_active, false)
  assert.equal(deactivateDev.data.admin.session_version, 2)

  const devVerifyAfterDeactivate = await invokeMiddleware(middleware, '/api/admin/verify', {
    method: 'POST',
    token: devToken,
  })
  assert.equal(devVerifyAfterDeactivate.status, 401)

  const devLoginWhileInactive = await invokeMiddleware(middleware, '/api/admin/login', {
    method: 'POST',
    body: { email: 'dev1@inferxe.com', password: devPassword },
  })
  assert.equal(devLoginWhileInactive.status, 403)

  // 15. Reactivating developer admin keeps old session_version token invalid, while fresh login works
  const reactivateDev = await invokeMiddleware(middleware, '/api/superadmin/admins/status', {
    method: 'POST',
    token: superToken,
    body: { admin_id: devCreate.data.admin.id, status: 'active', reason: 'Access restored' },
  })
  assert.equal(reactivateDev.status, 200)
  assert.equal(reactivateDev.data.admin.is_active, true)

  const oldDevTokenStillRejected = await invokeMiddleware(middleware, '/api/admin/verify', {
    method: 'POST',
    token: devToken,
  })
  assert.equal(oldDevTokenStillRejected.status, 401)

  const freshDevLogin = await invokeMiddleware(middleware, '/api/admin/login', {
    method: 'POST',
    body: { email: 'dev1@inferxe.com', password: devPassword },
  })
  assert.equal(freshDevLogin.status, 200)

  // 16. Logout revokes session in DB so subsequent verify returns 401
  const logoutRes = await invokeMiddleware(middleware, '/api/admin/logout', {
    method: 'POST',
    token: freshDevLogin.data.token,
  })
  assert.equal(logoutRes.status, 200)
  assert.ok(logoutRes.setCookie.includes('Max-Age=0'))

  const verifyAfterLogout = await invokeMiddleware(middleware, '/api/admin/verify', {
    method: 'POST',
    token: freshDevLogin.data.token,
  })
  assert.equal(verifyAfterLogout.status, 401)

  // 17. /api/admin/data/* passes through without being shadowed by adminAuth middleware
  const passthrough = await invokeMiddleware(middleware, '/api/admin/data/users', { method: 'GET' })
  assert.equal(passthrough.data.error, 'passthrough')

  // 18. Fail-closed when Supabase DB becomes unavailable (503)
  mockDb.setFailMode(true)
  const verifyDuringOutage = await invokeMiddleware(middleware, '/api/admin/verify', {
    method: 'POST',
    token: superToken,
  })
  assert.equal(verifyDuringOutage.status, 503)
  assert.equal(verifyDuringOutage.data.valid, false)

  // 19. Audit logs recorded for security events
  mockDb.setFailMode(false)
  const actions = mockDb.tables.audit_logs.map((l) => l.action)
  assert.ok(actions.includes('admin.login.success'))
  assert.ok(actions.includes('superadmin.admin.created'))
  assert.ok(actions.includes('superadmin.admin.deactivated'))
  assert.ok(actions.includes('superadmin.admin.activated'))
  assert.ok(actions.includes('admin.logout'))
})

test('Fail closed (503) when ADMIN_SESSION_SECRET is missing or too short', async () => {
  const mockDb = createMockSupabaseClient()
  const middleware = createAdminAuthMiddleware({
    sessionSecret: 'too-short',
    supabaseClient: mockDb,
  })

  // Admin account gets explicit 503 with isAdmin:true (never misrouted to Cognito)
  const loginRes = await invokeMiddleware(middleware, '/api/admin/login', {
    method: 'POST',
    body: { email: SUPERADMIN_EMAIL, password: SUPERADMIN_PASSWORD },
  })
  assert.equal(loginRes.status, 503)
  assert.equal(loginRes.data.isAdmin, true)
  assert.equal(loginRes.data.code, 'ADMIN_AUTH_NOT_CONFIGURED')

  // Customer account still gets 200 { isAdmin: false } so Cognito login is uninterrupted
  const custRes = await invokeMiddleware(middleware, '/api/admin/login', {
    method: 'POST',
    body: { email: 'customer@example.com', password: 'SomePassword123!' },
  })
  assert.equal(custRes.status, 200)
  assert.equal(custRes.data.isAdmin, false)

  const verifyRes = await invokeMiddleware(middleware, '/api/admin/verify', {
    method: 'POST',
    token: 'anything',
  })
  assert.equal(verifyRes.status, 503)

  const sessionCheck = await verifyAdminSession('anything', 'too-short', { supabaseClient: mockDb })
  assert.equal(sessionCheck.valid, false)
  assert.equal(sessionCheck.statusCode, 503)
  assert.equal(verifyAdminToken('anything', 'too-short').valid, false)
})

test('Pre-migration compatibility: Super Admin logs in cleanly when admin_users.role column does not yet exist', async () => {
  const baseDb = createMockSupabaseClient()
  const legacyDevId = '33333333-3333-4333-8333-333333333333'
  const legacyDevPass = 'LegacyDev#2026!Password'
  baseDb.tables.admin_users.push({
    id: legacyDevId,
    email: 'legacy.dev@inferxe.com',
    password_hash: hashPassword(legacyDevPass, { memory: 1024, passes: 2, parallelism: 1 }),
    is_active: true,
    session_version: 1,
    created_at: '2026-01-02T00:00:00.000Z',
    updated_at: '2026-01-02T00:00:00.000Z',
    last_login: null,
  })
  // Simulate live Supabase before migration 004: strip `role` from rows and return 42703 if `role` is selected
  for (const row of baseDb.tables.admin_users) delete row.role

  const preMigrationDb = {
    tables: baseDb.tables,
    from(tableName) {
      const inner = baseDb.from(tableName)
      if (tableName !== 'admin_users') return inner
      let selectedRole = false
      const origSelect = inner.select.bind(inner)
      const origInsert = inner.insert.bind(inner)
      inner.select = (cols = '*') => {
        if (/\brole\b/.test(String(cols))) selectedRole = true
        return origSelect(cols)
      }
      inner.insert = (payload) => {
        if (payload && 'role' in payload) selectedRole = true
        return origInsert(payload)
      }
      const errResp = async () => ({
        data: null,
        error: { code: '42703', message: 'column admin_users.role does not exist' },
      })
      const origMaybeSingle = inner.maybeSingle.bind(inner)
      const origSingle = inner.single.bind(inner)
      const origThen = inner.then.bind(inner)
      inner.maybeSingle = () => (selectedRole ? errResp() : origMaybeSingle())
      inner.single = () => (selectedRole ? errResp() : origSingle())
      inner.then = (res, rej) => (selectedRole ? errResp().then(res, rej) : origThen(res, rej))
      return inner
    },
  }

  const middleware = createAdminAuthMiddleware({
    sessionSecret: `  ${TEST_SECRET}  `, // Also verifies whitespace trimming parity
    supabaseClient: preMigrationDb,
    disableRateLimit: true,
  })

  // Confirmed existing Super Admin logs in as superadmin despite missing role column
  const superLogin = await invokeMiddleware(middleware, '/api/admin/login', {
    method: 'POST',
    body: { email: SUPERADMIN_EMAIL, password: SUPERADMIN_PASSWORD },
  })
  assert.equal(superLogin.status, 200)
  assert.equal(superLogin.data.ok, true)
  assert.equal(superLogin.data.role, 'superadmin')
  assert.equal(superLogin.data.user.id, SUPERADMIN_ID)

  // Session verify succeeds as superadmin
  const verifyRes = await invokeMiddleware(middleware, '/api/admin/verify', {
    method: 'POST',
    token: superLogin.data.token,
  })
  assert.equal(verifyRes.status, 200)
  assert.equal(verifyRes.data.user.role, 'superadmin')

  // Superadmin listing works pre-migration
  const listRes = await invokeMiddleware(middleware, '/api/superadmin/admins', {
    method: 'GET',
    token: superLogin.data.token,
  })
  assert.equal(listRes.status, 200)
  assert.equal(listRes.data.admins.length, 2)

  // Any other pre-migration row strictly resolves to 'admin' and is blocked from /api/superadmin/*
  const devLogin = await invokeMiddleware(middleware, '/api/admin/login', {
    method: 'POST',
    body: { email: 'legacy.dev@inferxe.com', password: legacyDevPass },
  })
  assert.equal(devLogin.status, 200)
  assert.equal(devLogin.data.role, 'admin')

  const devBlocked = await invokeMiddleware(middleware, '/api/superadmin/admins', {
    method: 'GET',
    token: devLogin.data.token,
  })
  assert.equal(devBlocked.status, 403)

  // Super Admin creates a brand-new Admin account pre-migration (admin_users.role missing)
  const createdDevPass = 'NewPreMigAdmin#2026!Secure'
  const createdDev = await invokeMiddleware(middleware, '/api/superadmin/admins', {
    method: 'POST',
    token: superLogin.data.token,
    body: { email: 'new.admin@inferxe.com', password: createdDevPass },
  })
  assert.equal(createdDev.status, 201)
  assert.equal(createdDev.data.admin.email, 'new.admin@inferxe.com')
  assert.equal(createdDev.data.admin.role, 'admin')
  assert.equal(createdDev.data.admin.is_active, true)
  assert.equal(createdDev.data.admin.session_version, 1)
  assert.equal('password_hash' in createdDev.data.admin, false)

  // Appears in GET /api/superadmin/admins
  const updatedList = await invokeMiddleware(middleware, '/api/superadmin/admins', {
    method: 'GET',
    token: superLogin.data.token,
  })
  assert.equal(updatedList.status, 200)
  assert.ok(updatedList.data.admins.some((a) => a.email === 'new.admin@inferxe.com' && a.role === 'admin'))

  // New Admin can sign in via POST /api/admin/login
  const newAdminLogin = await invokeMiddleware(middleware, '/api/admin/login', {
    method: 'POST',
    body: { email: 'new.admin@inferxe.com', password: createdDevPass },
  })
  assert.equal(newAdminLogin.status, 200)
  assert.equal(newAdminLogin.data.role, 'admin')

  // New Admin cannot access Super Admin routes or create other admins (403)
  const newAdminListBlocked = await invokeMiddleware(middleware, '/api/superadmin/admins', {
    method: 'GET',
    token: newAdminLogin.data.token,
  })
  assert.equal(newAdminListBlocked.status, 403)

  const newAdminCreateBlocked = await invokeMiddleware(middleware, '/api/superadmin/admins', {
    method: 'POST',
    token: newAdminLogin.data.token,
    body: { email: 'other@inferxe.com', password: 'OtherAdmin#2026!Secure' },
  })
  assert.equal(newAdminCreateBlocked.status, 403)

  // Deactivating the new Admin immediately invalidates existing sessions & prevents sign-in
  const deactivateRes = await invokeMiddleware(middleware, '/api/superadmin/admins/status', {
    method: 'POST',
    token: superLogin.data.token,
    body: { admin_id: createdDev.data.admin.id, status: 'inactive', reason: 'Offboarded' },
  })
  assert.equal(deactivateRes.status, 200)
  assert.equal(deactivateRes.data.admin.is_active, false)

  const verifyDeactivated = await invokeMiddleware(middleware, '/api/admin/verify', {
    method: 'POST',
    token: newAdminLogin.data.token,
  })
  assert.equal(verifyDeactivated.status, 401)

  const reloginDeactivated = await invokeMiddleware(middleware, '/api/admin/login', {
    method: 'POST',
    body: { email: 'new.admin@inferxe.com', password: createdDevPass },
  })
  assert.equal(reloginDeactivated.status, 403)
})

test('Thrown Supabase exceptions fail closed (503) on /api/superadmin/* and /api/admin/logout', async () => {
  const mockDb = createMockSupabaseClient()
  let shouldThrow = false
  const throwingDb = {
    from(tableName) {
      if (shouldThrow) {
        throw new Error('Simulated synchronous Supabase transport crash')
      }
      return mockDb.from(tableName)
    },
  }

  const middleware = createAdminAuthMiddleware({
    sessionSecret: TEST_SECRET,
    supabaseClient: throwingDb,
    disableRateLimit: true,
  })

  const loginRes = await invokeMiddleware(middleware, '/api/admin/login', {
    method: 'POST',
    body: { email: SUPERADMIN_EMAIL, password: SUPERADMIN_PASSWORD },
  })
  assert.equal(loginRes.status, 200)

  shouldThrow = true

  const superadminRes = await invokeMiddleware(middleware, '/api/superadmin/admins', {
    method: 'GET',
    token: loginRes.data.token,
  })
  assert.equal(superadminRes.status, 503)

  const logoutRes = await invokeMiddleware(middleware, '/api/admin/logout', {
    method: 'POST',
    token: loginRes.data.token,
  })
  assert.equal(logoutRes.status, 503)
  assert.equal(logoutRes.data.ok, false)
  assert.ok(logoutRes.setCookie.includes('Max-Age=0'))
})

test('Malformed stored password_hash returns 503 ADMIN_HASH_VERIFY_ERROR rather than 401 wrong password', async () => {
  const mockDb = createMockSupabaseClient()
  mockDb.tables.admin_users[0].password_hash = '$unsupported$broken-hash'

  const middleware = createAdminAuthMiddleware({
    sessionSecret: TEST_SECRET,
    supabaseClient: mockDb,
    disableRateLimit: true,
  })

  const res = await invokeMiddleware(middleware, '/api/admin/login', {
    method: 'POST',
    body: { email: SUPERADMIN_EMAIL, password: SUPERADMIN_PASSWORD },
  })
  assert.equal(res.status, 503)
  assert.equal(res.data.isAdmin, true)
  assert.equal(res.data.code, 'ADMIN_HASH_VERIFY_ERROR')
})

test('Admin creation allows multiple active standard Admins, rejects duplicate emails (409), and enforces single active Super Admin', async () => {
  const mockDb = createMockSupabaseClient()
  const middleware = createAdminAuthMiddleware({
    sessionSecret: TEST_SECRET,
    supabaseClient: mockDb,
    disableRateLimit: true,
  })

  const superLogin = await invokeMiddleware(middleware, '/api/admin/login', {
    method: 'POST',
    body: { email: SUPERADMIN_EMAIL, password: SUPERADMIN_PASSWORD },
  })
  assert.equal(superLogin.status, 200)
  const token = superLogin.data.token

  // Create first active standard Admin (diya@inferxe.com)
  const firstAdmin = await invokeMiddleware(middleware, '/api/superadmin/admins', {
    method: 'POST',
    token,
    body: { email: 'diya@inferxe.com', password: 'DiyaAdmin#2026!Strong' },
  })
  assert.equal(firstAdmin.status, 201)
  assert.equal(firstAdmin.data.admin.email, 'diya@inferxe.com')
  assert.equal(firstAdmin.data.admin.role, 'admin')
  assert.equal(firstAdmin.data.admin.is_active, true)

  // Create second active standard Admin with a different email alongside the first + active Super Admin
  const secondAdmin = await invokeMiddleware(middleware, '/api/superadmin/admins', {
    method: 'POST',
    token,
    body: { email: 'ops.admin@inferxe.com', password: 'OpsAdmin#2026!Strong' },
  })
  assert.equal(secondAdmin.status, 201)
  assert.equal(secondAdmin.data.admin.email, 'ops.admin@inferxe.com')
  assert.equal(secondAdmin.data.admin.role, 'admin')
  assert.equal(secondAdmin.data.admin.is_active, true)

  // All 3 active accounts exist simultaneously (1 superadmin + 2 standard admins)
  const listRes = await invokeMiddleware(middleware, '/api/superadmin/admins', {
    method: 'GET',
    token,
  })
  assert.equal(listRes.status, 200)
  assert.equal(listRes.data.admins.length, 3)
  assert.equal(listRes.data.admins.filter((a) => a.is_active).length, 3)
  assert.equal(listRes.data.admins.filter((a) => a.role === 'superadmin').length, 1)
  assert.equal(listRes.data.admins.filter((a) => a.role === 'admin').length, 2)

  // Existing email returns 409 DUPLICATE_ADMIN_EMAIL and leaves the existing account untouched
  const diyaBefore = { ...mockDb.tables.admin_users.find((u) => u.email === 'diya@inferxe.com') }
  const dupEmailRes = await invokeMiddleware(middleware, '/api/superadmin/admins', {
    method: 'POST',
    token,
    body: { email: 'DIYA@INFERXE.COM', password: 'Takeover#2026!Different' },
  })
  assert.equal(dupEmailRes.status, 409)
  assert.equal(dupEmailRes.data.code, 'DUPLICATE_ADMIN_EMAIL')
  assert.deepEqual(mockDb.tables.admin_users.find((u) => u.email === 'diya@inferxe.com'), diyaBefore)
  assert.equal(mockDb.tables.admin_users.filter((u) => u.email === 'diya@inferxe.com').length, 1)

  // Without a session, creation is refused before anything is written
  const countBefore = mockDb.tables.admin_users.length
  const anonCreate = await invokeMiddleware(middleware, '/api/superadmin/admins', {
    method: 'POST',
    body: { email: 'anon.create@inferxe.com', password: 'AnonCreate#2026!Strong' },
  })
  assert.equal(anonCreate.status, 401)
  assert.equal(mockDb.tables.admin_users.length, countBefore)

  // Attempting to create another Super Admin is strictly rejected (403)
  const secondSuperRes = await invokeMiddleware(middleware, '/api/superadmin/admins', {
    method: 'POST',
    token,
    body: { email: 'second.super@inferxe.com', password: 'SuperAdmin#Second2026!', role: 'superadmin' },
  })
  assert.equal(secondSuperRes.status, 403)

  // Migration 004 drops legacy single-account index and enforces single active superadmin partial unique index
  const testDir = path.dirname(fileURLToPath(import.meta.url))
  const migration004Path = path.resolve(testDir, '../../../database/migrations/004_admin_users_role_and_sessions.sql')
  const migrationSql = fs.readFileSync(migration004Path, 'utf8')
  assert.match(migrationSql, /DROP\s+INDEX\s+IF\s+EXISTS\s+public\.admin_users_one_active_shared_account\s*;/i)
  assert.match(
    migrationSql,
    /CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+admin_users_one_active_superadmin\s+ON\s+public\.admin_users\s*\(role\)\s+WHERE\s+role\s*=\s*'superadmin'\s+AND\s+is_active\s*;/i,
  )
})

test('Legacy admin_users_one_active_shared_account and non-email 23505 violations are NOT reported as duplicate email', async () => {
  // 1. Direct unit checks on classifyAdminInsertError
  const legacyErr = classifyAdminInsertError({
    code: '23505',
    message: 'duplicate key value violates unique constraint "admin_users_one_active_shared_account"',
    details: 'Key (is_active)=(t) already exists.',
  })
  assert.equal(legacyErr.statusCode, 503)
  assert.equal(legacyErr.code, 'ADMIN_SCHEMA_MIGRATION_REQUIRED')
  assert.equal(/admin_users_one_active_shared_account|Key \(is_active\)/i.test(legacyErr.message), false)

  const superadminErr = classifyAdminInsertError({
    code: '23505',
    constraint: 'admin_users_one_active_superadmin',
    message: 'duplicate key value violates unique constraint "admin_users_one_active_superadmin"',
    details: 'Key (role)=(superadmin) already exists.',
  })
  assert.equal(superadminErr.statusCode, 403)
  assert.equal(superadminErr.code, 'SUPERADMIN_ALREADY_EXISTS')

  const emailRaceErr = classifyAdminInsertError({
    code: '23505',
    message: 'duplicate key value violates unique constraint "admin_users_email_lower_unique"',
    details: 'Key (lower(email))=(diya@inferxe.com) already exists.',
  })
  assert.equal(emailRaceErr.statusCode, 409)
  assert.equal(emailRaceErr.code, 'DUPLICATE_ADMIN_EMAIL')

  const otherUniqueErr = classifyAdminInsertError({
    code: '23505',
    message: 'duplicate key value violates unique constraint "admin_users_pkey"',
    details: 'Key (id)=(00000000-0000-0000-0000-000000000000) already exists.',
  })
  assert.equal(otherUniqueErr.statusCode, 503)
  assert.equal(otherUniqueErr.code, 'ADMIN_CREATE_FAILED')
  assert.equal(/admin_users_pkey/i.test(otherUniqueErr.message), false)

  // 2. End-to-end middleware test: legacy index violation returns 503 ADMIN_SCHEMA_MIGRATION_REQUIRED (NOT 409)
  const mockDb = createMockSupabaseClient()
  let injectedInsertError = {
    code: '23505',
    message: 'duplicate key value violates unique constraint "admin_users_one_active_shared_account"',
    details: 'Key (is_active)=(t) already exists.',
  }
  const wrappedDb = {
    from(tableName) {
      const builder = mockDb.from(tableName)
      if (tableName === 'admin_users') {
        const origInsert = builder.insert.bind(builder)
        builder.insert = (payload) => {
          if (injectedInsertError) {
            const err = injectedInsertError
            return {
              select() {
                return {
                  async single() {
                    return { data: null, error: err }
                  },
                }
              },
            }
          }
          return origInsert(payload)
        }
      }
      return builder
    },
  }

  const middleware = createAdminAuthMiddleware({
    sessionSecret: TEST_SECRET,
    supabaseClient: wrappedDb,
    disableRateLimit: true,
  })

  const superLogin = await invokeMiddleware(middleware, '/api/admin/login', {
    method: 'POST',
    body: { email: SUPERADMIN_EMAIL, password: SUPERADMIN_PASSWORD },
  })
  assert.equal(superLogin.status, 200)

  const legacyRes = await invokeMiddleware(middleware, '/api/superadmin/admins', {
    method: 'POST',
    token: superLogin.data.token,
    body: { email: 'diya@inferxe.com', password: 'DiyaAdmin#2026!Strong' },
  })
  assert.equal(legacyRes.status, 503)
  assert.equal(legacyRes.data.ok, false)
  assert.equal(legacyRes.data.code, 'ADMIN_SCHEMA_MIGRATION_REQUIRED')
  assert.equal(/already exists/i.test(legacyRes.data.error), false)
  assert.equal(/admin_users_one_active_shared_account|Key \(is_active\)/i.test(legacyRes.data.error), false)

  // 3. End-to-end middleware test: concurrent email unique constraint race (23505 on email) STILL returns 409 DUPLICATE_ADMIN_EMAIL
  injectedInsertError = {
    code: '23505',
    message: 'duplicate key value violates unique constraint "admin_users_email_lower_unique"',
    details: 'Key (lower(email))=(diya@inferxe.com) already exists.',
  }
  const raceEmailRes = await invokeMiddleware(middleware, '/api/superadmin/admins', {
    method: 'POST',
    token: superLogin.data.token,
    body: { email: 'diya@inferxe.com', password: 'DiyaAdmin#2026!Strong' },
  })
  assert.equal(raceEmailRes.status, 409)
  assert.equal(raceEmailRes.data.code, 'DUPLICATE_ADMIN_EMAIL')

  // 4. End-to-end middleware test: single-superadmin constraint violation returns 403 SUPERADMIN_ALREADY_EXISTS (NOT 409)
  injectedInsertError = {
    code: '23505',
    constraint: 'admin_users_one_active_superadmin',
    message: 'duplicate key value violates unique constraint "admin_users_one_active_superadmin"',
    details: 'Key (role)=(superadmin) already exists.',
  }
  const superConstraintRes = await invokeMiddleware(middleware, '/api/superadmin/admins', {
    method: 'POST',
    token: superLogin.data.token,
    body: { email: 'another@inferxe.com', password: 'AnotherAdmin#2026!Strong' },
  })
  assert.equal(superConstraintRes.status, 403)
  assert.equal(superConstraintRes.data.code, 'SUPERADMIN_ALREADY_EXISTS')
})

test('Super Admin can update and delete Admin accounts with strict protections, session revocation, and audit preservation', async () => {
  const mockDb = createMockSupabaseClient()
  const middleware = createAdminAuthMiddleware({
    sessionSecret: TEST_SECRET,
    supabaseClient: mockDb,
    disableRateLimit: true,
  })

  // 1. Log in as Super Admin
  const superLogin = await invokeMiddleware(middleware, '/api/admin/login', {
    method: 'POST',
    body: { email: SUPERADMIN_EMAIL, password: SUPERADMIN_PASSWORD },
  })
  assert.equal(superLogin.status, 200)
  const superToken = superLogin.data.token

  // 2. Create two developer admins: Dev A and Dev B
  const createA = await invokeMiddleware(middleware, '/api/superadmin/admins', {
    method: 'POST',
    token: superToken,
    body: { email: 'developer.a@inferxe.com', password: 'DevPassword#2026!A' },
  })
  assert.equal(createA.status, 201)
  const adminA = createA.data.admin

  const createB = await invokeMiddleware(middleware, '/api/superadmin/admins', {
    method: 'POST',
    token: superToken,
    body: { email: 'developer.b@inferxe.com', password: 'DevPassword#2026!B' },
  })
  assert.equal(createB.status, 201)
  const adminB = createB.data.admin

  // 3. Dev A logs in and obtains a session token
  const devALogin = await invokeMiddleware(middleware, '/api/admin/login', {
    method: 'POST',
    body: { email: 'developer.a@inferxe.com', password: 'DevPassword#2026!A' },
  })
  assert.equal(devALogin.status, 200)
  const devAToken = devALogin.data.token

  // Dev A verifies session successfully
  const devAVerify = await invokeMiddleware(middleware, '/api/admin/verify', {
    method: 'GET',
    token: devAToken,
  })
  assert.equal(devAVerify.status, 200)
  assert.equal(devAVerify.data.ok, true)

  // 4. Role separation: Dev A attempts to PATCH /api/superadmin/admins/:id -> 403 Forbidden
  const devAAttemptPatch = await invokeMiddleware(middleware, `/api/superadmin/admins/${adminB.id}`, {
    method: 'PATCH',
    token: devAToken,
    body: { email: 'hacked@inferxe.com' },
  })
  assert.equal(devAAttemptPatch.status, 403)

  // Dev A attempts to DELETE /api/superadmin/admins/:id -> 403 Forbidden
  const devAAttemptDelete = await invokeMiddleware(middleware, `/api/superadmin/admins/${adminB.id}`, {
    method: 'DELETE',
    token: devAToken,
  })
  assert.equal(devAAttemptDelete.status, 403)

  // 5. Super Admin protection: Cannot update or delete primary Super Admin
  const patchSuperRes = await invokeMiddleware(middleware, `/api/superadmin/admins/${SUPERADMIN_ID}`, {
    method: 'PATCH',
    token: superToken,
    body: { email: 'superhacked@inferxe.com' },
  })
  assert.equal(patchSuperRes.status, 403)
  assert.equal(/Super Admin account cannot be modified/i.test(patchSuperRes.data.error), true)

  const deleteSuperRes = await invokeMiddleware(middleware, `/api/superadmin/admins/${SUPERADMIN_ID}`, {
    method: 'DELETE',
    token: superToken,
  })
  assert.equal(deleteSuperRes.status, 403)
  assert.equal(/Super Admin account cannot be deleted/i.test(deleteSuperRes.data.error), true)

  // 6. Privilege escalation protection: Reject role escalation to superadmin
  const escalateRes = await invokeMiddleware(middleware, `/api/superadmin/admins/${adminA.id}`, {
    method: 'PATCH',
    token: superToken,
    body: { role: 'superadmin' },
  })
  assert.equal(escalateRes.status, 403)
  assert.equal(/Privilege escalation/i.test(escalateRes.data.error), true)

  // 7. Duplicate email rejection: Dev A cannot be updated to Dev B's email
  const dupEmailRes = await invokeMiddleware(middleware, `/api/superadmin/admins/${adminA.id}`, {
    method: 'PATCH',
    token: superToken,
    body: { email: 'developer.b@inferxe.com' },
  })
  assert.equal(dupEmailRes.status, 409)
  assert.equal(dupEmailRes.data.code, 'DUPLICATE_ADMIN_EMAIL')

  // 8. Successful update of Dev A: update email, password, and add audit reason
  const patchSuccessRes = await invokeMiddleware(middleware, `/api/superadmin/admins/${adminA.id}`, {
    method: 'PATCH',
    token: superToken,
    body: {
      email: 'developer.a.updated@inferxe.com',
      password: 'DevNewPassword#2026!Rotated',
      reason: 'Scheduled quarterly credential rotation and email update',
    },
  })
  assert.equal(patchSuccessRes.status, 200)
  assert.equal(patchSuccessRes.data.ok, true)
  assert.equal(patchSuccessRes.data.admin.email, 'developer.a.updated@inferxe.com')
  assert.equal(patchSuccessRes.data.admin.password_hash, undefined)
  assert.equal(patchSuccessRes.data.admin.session_version, 2)

  // Dev A's previous token is now rejected because credentials changed (session revoked and session_version bumped)
  const devAOldTokenVerify = await invokeMiddleware(middleware, '/api/admin/verify', {
    method: 'GET',
    token: devAToken,
  })
  assert.equal(devAOldTokenVerify.status, 401)

  // Old password fails to log in
  const devAOldLogin = await invokeMiddleware(middleware, '/api/admin/login', {
    method: 'POST',
    body: { email: 'developer.a.updated@inferxe.com', password: 'DevPassword#2026!A' },
  })
  assert.equal(devAOldLogin.status, 401)

  // New password logs in cleanly
  const devANewLogin = await invokeMiddleware(middleware, '/api/admin/login', {
    method: 'POST',
    body: { email: 'developer.a.updated@inferxe.com', password: 'DevNewPassword#2026!Rotated' },
  })
  assert.equal(devANewLogin.status, 200)
  const devANewToken = devANewLogin.data.token

  // 9. Successful deletion of Dev A
  const deleteDevARes = await invokeMiddleware(middleware, `/api/superadmin/admins/${adminA.id}`, {
    method: 'DELETE',
    token: superToken,
    body: { reason: 'Developer offboarding' },
  })
  assert.equal(deleteDevARes.status, 200)
  assert.equal(deleteDevARes.data.ok, true)
  assert.equal(deleteDevARes.data.deleted_admin.id, adminA.id)

  // Dev A's active token is immediately rejected
  const devADeletedTokenVerify = await invokeMiddleware(middleware, '/api/admin/verify', {
    method: 'GET',
    token: devANewToken,
  })
  assert.equal(devADeletedTokenVerify.status, 401)

  // Dev A can no longer log in as admin (returns 200 { ok: false, isAdmin: false } for customer Cognito fallback)
  const devALoginAfterDelete = await invokeMiddleware(middleware, '/api/admin/login', {
    method: 'POST',
    body: { email: 'developer.a.updated@inferxe.com', password: 'DevNewPassword#2026!Rotated' },
  })
  assert.equal(devALoginAfterDelete.status, 200)
  assert.equal(devALoginAfterDelete.data.ok, false)
  assert.equal(devALoginAfterDelete.data.isAdmin, false)

  // Verify audit logs contain update and delete entries
  const auditLogsRes = await invokeMiddleware(middleware, '/api/superadmin/audit-logs', {
    method: 'GET',
    token: superToken,
  })
  assert.equal(auditLogsRes.status, 200)
  const actions = auditLogsRes.data.logs.map((l) => l.action)
  assert.equal(actions.includes('superadmin.admin.updated'), true)
  assert.equal(actions.includes('superadmin.admin.deleted'), true)
})

test('async admin password verification matches the sync result and does not block the event loop', async () => {
  const hash = hashPassword('DevAccount#2026!Secure', { memory: 65536, passes: 3, parallelism: 1 }) // production cost
  for (const [pw, h] of [['DevAccount#2026!Secure', hash], ['WrongPassword#2026!', hash], ['DevAccount#2026!Secure', 'not-a-valid-hash'], ['', hash]]) {
    const sync = verifyPasswordWithReason(pw, h)
    const asyncResult = await verifyPasswordWithReasonAsync(pw, h)
    assert.deepEqual({ valid: asyncResult.valid, reason: asyncResult.reason }, { valid: sync.valid, reason: sync.reason })
  }
  let ticks = 0
  const timer = setInterval(() => { ticks += 1 }, 5)
  await verifyPasswordWithReasonAsync('WrongPassword#2026!', hash)
  clearInterval(timer)
  assert.ok(ticks > 0, 'timers kept running while Argon2 was computing')
})
