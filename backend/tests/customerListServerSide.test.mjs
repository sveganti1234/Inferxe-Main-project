import './support/networkGuard.mjs'  // test isolation guard: must stay the first import (tests/testSafety.test.mjs checks)
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { Readable } from 'node:stream'
import test from 'node:test'

// Admin customer list/summary run server-side: one page of rows per list request and count-only summary
// requests, never the whole profiles table. Supabase REST is a stubbed fetch on a closed loopback URL.
process.env.SUPABASE_URL = 'http://127.0.0.1:9'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only-service-key'
delete process.env.ADMIN_SESSION_SECRET

const svc = await import('../database/supabaseCustomerService.js')
const { createAdminAuthMiddleware } = await import('../auth/adminAuth.js')
const { hashPassword } = await import('../auth/adminPassword.js')

function profile(i, extra = {}) {
  return {
    user_id: `sub-${String(i).padStart(4, '0')}`, full_name: `Customer ${i}`, email: `c${i}@corp.example`, role: 'customer',
    status: 'active', created_at: '2026-01-01T00:00:00.000Z', last_seen_at: null, last_active_at: null, last_login_at: null,
    login_count: 0, organization: null, ...extra,
  }
}

/** Stub Supabase REST: records each request; `respond(url, init)` returns { status, rows, total }. */
function stubFetch(respond) {
  const calls = []
  const real = globalThis.fetch
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input))
    calls.push({ url, method: init.method || 'GET', headers: init.headers || {} })
    const { status = 200, rows = [], total = rows.length } = respond(url, init) || {}
    const offset = Number(url.searchParams.get('offset') || 0)
    const range = rows.length ? `${offset}-${offset + rows.length - 1}/${total}` : `*/${total}`
    const body = init.method === 'HEAD' ? null : JSON.stringify(rows)
    return new Response(body, { status, headers: { 'content-range': range, 'content-type': 'application/json' } })
  }
  return { calls, restore: () => { globalThis.fetch = real } }
}

test('default page: one request, page-sized, sorted and counted in the database', async () => {
  const f = stubFetch(() => ({ rows: [profile(1), profile(2)], total: 57 }))
  try {
    const r = await svc.listCustomers()
    assert.equal(f.calls.length, 1)
    const q = f.calls[0].url.searchParams
    assert.equal(f.calls[0].url.pathname, '/rest/v1/profiles')
    assert.equal(q.get('limit'), '20')
    assert.equal(q.get('offset'), '0')
    assert.equal(q.get('order'), 'created_at.desc.nullslast,user_id.asc')
    assert.equal(f.calls[0].headers.Prefer, 'count=exact')
    assert.match(q.get('and'), /^\(and\(role\.neq\."admin",user_id\.neq\."usr_admin"\)/)
    assert.deepEqual(r.pagination, { total: 57, page: 1, limit: 20, totalPages: 3 })
    assert.deepEqual(r.customers.map((c) => c.cognito_sub), ['sub-0001', 'sub-0002'])
    assert.equal(r.customers[0].customer_id, 'cst_sub-0001')
  } finally { f.restore() }
})

test('page sizes are clamped to 1..100 and pages map to offsets', async () => {
  const f = stubFetch(() => ({ rows: [profile(1)], total: 1000 }))
  try {
    for (const [limit, page, expLimit, expOffset] of [[500, 1, '100', '0'], [0, 1, '20', '0'], ['abc', 2, '20', '20'], [10, 3, '10', '20'], [7, -4, '7', '0']]) {
      await svc.listCustomers({ limit, page })
      const q = f.calls.at(-1).url.searchParams
      assert.deepEqual([q.get('limit'), q.get('offset')], [expLimit, expOffset], `limit=${limit} page=${page}`)
    }
  } finally { f.restore() }
})

test('out-of-range page serves the last page (and handles HTTP 416)', async () => {
  for (const firstStatus of [200, 416]) {
    const f = stubFetch((url) => (url.searchParams.get('offset') === '80'
      ? { status: firstStatus, rows: [], total: 25 }
      : { rows: [profile(21), profile(22), profile(23), profile(24), profile(25)], total: 25 }))
    try {
      const r = await svc.listCustomers({ page: 9, limit: 10 })
      assert.equal(f.calls.length, 2)
      assert.equal(f.calls[1].url.searchParams.get('offset'), '20')
      assert.deepEqual(r.pagination, { total: 25, page: 3, limit: 10, totalPages: 3 })
      assert.equal(r.customers.length, 5)
    } finally { f.restore() }
  }
})

test('empty result: no second request, one empty page', async () => {
  const f = stubFetch(() => ({ rows: [], total: 0 }))
  try {
    const r = await svc.listCustomers({ search: 'nobody', page: 4 })
    assert.equal(f.calls.length, 1)
    assert.deepEqual(r, { ok: true, customers: [], pagination: { total: 0, page: 1, limit: 20, totalPages: 1 } })
  } finally { f.restore() }
})

test('search matches name, email, sub, organization and customer id; input is matched literally', () => {
  const render = (search) => svc.renderPostgrestFilter(svc.customerSearchFilter(search))
  assert.equal(svc.customerSearchFilter('   '), null)
  assert.equal(svc.customerSearchFilter('cst'), null)  // every customer id contains it
  const alice = render('Alice')
  for (const col of ['full_name', 'email', 'user_id', 'organization']) assert.ok(alice.includes(`${col}.ilike."*alice*"`), col)
  assert.ok(render('cst_ab12').includes('user_id.ilike."ab12*"'))
  // LIKE metacharacters, quotes, commas and parentheses cannot change the filter structure.
  assert.ok(render('100%_x').includes('"*100\\\\%\\\\_x*"'))
  assert.ok(render('a"),or(role.eq.admin').includes('"*a\\"),or(role.eq.admin*"'))
  assert.ok(!render('a*b').includes('a*b'))
})

test('sorting: allowed columns only, missing timestamps sort as oldest, stable tie-break', () => {
  assert.equal(svc.customerOrder('full_name', 'asc'), 'full_name.asc,user_id.asc')
  assert.equal(svc.customerOrder('last_active', 'asc'), 'last_active_at.asc.nullsfirst,user_id.asc')
  assert.equal(svc.customerOrder('last_login', 'desc'), 'last_login_at.desc.nullslast,user_id.asc')
  assert.equal(svc.customerOrder('password_hash;drop', 'desc'), 'created_at.desc.nullslast,user_id.asc')
})

test('status and account filters render null-safe PostgREST logic trees', () => {
  const now = Date.parse('2026-11-20T10:00:00.000Z')
  const none = { ids: [], emails: [] }
  assert.equal(svc.renderPostgrestFilter(svc.activityStatusFilter('suspended', now, none)), 'status.eq."suspended"')
  const inactive = svc.renderPostgrestFilter(svc.activityStatusFilter('inactive', now, none))
  assert.ok(inactive.startsWith('and(status.neq."suspended",not.or('))
  assert.ok(inactive.includes('and(last_active_at.not.is.null,last_active_at.gte."2026-11-15T10:00:00.000Z")'))
  const online = svc.renderPostgrestFilter(svc.activityStatusFilter('online', now, { ids: ['sub-1'], emails: ['A_b@x.io'] }))
  assert.ok(online.includes('user_id.in.("sub-1")') && online.includes('email.ilike."A\\\\_b@x.io"'))
  assert.equal(svc.activityStatusFilter('all', now, none), null)
  const real = svc.renderPostgrestFilter(svc.buildCustomerFilter({ accountType: 'real' }))
  assert.ok(real.includes('not.or(user_id.like."cust\\\\_wallet\\\\_*"'))
})

test('summary: count-only HEAD requests, no profile rows downloaded', async () => {
  const totals = [120, 100, 9, 40, 6]  // total, real, online, active, suspended (Promise.all order)
  let i = 0
  const f = stubFetch(() => ({ total: totals[i++] }))
  try {
    const s = await svc.getCustomerSummary({ accountType: 'real' })
    assert.equal(f.calls.length, 5)
    assert.ok(f.calls.every((c) => c.method === 'HEAD' && c.headers.Prefer === 'count=exact'))
    assert.ok(f.calls.every((c) => c.url.searchParams.get('select') === 'user_id'))
    assert.deepEqual(s, { total: 120, total_real: 100, total_test: 20, active_count: 100, online: 9, active: 40,
      inactive: 45, suspended: 6, onlineTrackingAvailable: true })
  } finally { f.restore() }
})

test('full export pages through every customer in database-sized chunks', async () => {
  const all = [1, 2, 3, 4, 5].map((i) => profile(i))
  const f = stubFetch((url) => {
    const offset = Number(url.searchParams.get('offset')), limit = Number(url.searchParams.get('limit'))
    return { rows: all.slice(offset, offset + limit), total: all.length }
  })
  try {
    const rows = await svc.listAllCustomers({ chunk: 2 })
    assert.deepEqual(rows.map((r) => r.cognito_sub), all.map((r) => r.user_id))
    assert.deepEqual(f.calls.map((c) => c.url.searchParams.get('offset')), ['0', '2', '4'])
    assert.ok(f.calls.every((c) => c.url.searchParams.get('and').includes('role.neq."admin"')))
  } finally { f.restore() }
})

test('Supabase errors surface as failures, not empty lists', async () => {
  const f = stubFetch(() => ({ status: 500, rows: [] }))
  try {
    await assert.rejects(svc.listCustomers(), /HTTP 500/)
    await assert.rejects(svc.getCustomerSummary(), /HTTP 500/)
  } finally { f.restore() }
})

// ── Route: admin authorization is enforced before any Supabase access ──────────────────────────────

const SECRET = 'test-only-admin-signing-secret-with-adequate-length'
const ARGON2_SKIP = typeof crypto.argon2Sync === 'function' ? false : 'needs crypto.argon2Sync (Node >= 24.7)'

function mockSupabase(tables) {
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
  Object.assign(req, { method, url, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    socket: { remoteAddress: '10.9.0.1' } })
  const res = {
    statusCode: 200, headers: {}, body: '',
    setHeader(n, v) { this.headers[n.toLowerCase()] = v }, getHeader(n) { return this.headers[n.toLowerCase()] },
    writeHead(c, h = {}) { this.statusCode = c; Object.assign(this.headers, h) }, end(chunk = '') { this.body += chunk },
  }
  return mw(req, res, () => {}).then(() => ({ status: res.statusCode, json: JSON.parse(res.body || '{}') }))
}

test('customer list and summary reject missing, forged and customer tokens before touching Supabase', async () => {
  const mw = createAdminAuthMiddleware({ supabaseClient: mockSupabase({}), sessionSecret: SECRET })
  const forged = ['x', 'y', 'z'].join('.')
  const customerLike = `${Buffer.from('{"alg":"RS256","kid":"k"}').toString('base64url')}.${Buffer.from('{"sub":"c1","token_use":"id"}').toString('base64url')}.sig`
  const f = stubFetch(() => ({ rows: [profile(1)], total: 1 }))
  try {
    for (const path of ['/api/admin/customers?search=%25&limit=100000&accountType=all', '/api/admin/customers/summary?accountType=all']) {
      for (const token of [undefined, forged, customerLike]) {
        const { status } = await call(mw, 'GET', path, { token })
        assert.ok(status === 401 || status === 403, `${path} token=${token ? 'set' : 'none'} -> ${status}`)
      }
    }
    assert.equal(f.calls.length, 0, 'no Supabase request before authorization')
  } finally { f.restore() }
})

test('an authenticated admin gets one bounded page', { skip: ARGON2_SKIP }, async () => {
  const password = 'Correct-Horse-Battery-Staple-42'
  const tables = { admin_users: [{ id: crypto.randomUUID(), email: 'ops@example.test', password_hash: hashPassword(password, { memory: 1024, passes: 2, parallelism: 1 }),
    role: 'admin', is_active: true, session_version: 1, created_at: '2026-01-01T00:00:00.000Z', last_login: null }], admin_sessions: [], audit_logs: [] }
  const mw = createAdminAuthMiddleware({ supabaseClient: mockSupabase(tables), sessionSecret: SECRET })
  const login = await call(mw, 'POST', '/api/admin/login', { body: { email: 'ops@example.test', password } })
  assert.equal(login.status, 200, JSON.stringify(login.json))
  const f = stubFetch(() => ({ rows: [profile(1), profile(2)], total: 2 }))
  try {
    const { status, json } = await call(mw, 'GET', '/api/admin/customers?limit=100000&page=1&search=customer', { token: login.json.token })
    assert.equal(status, 200, JSON.stringify(json))
    assert.equal(json.customers.length, 2)
    const profileCalls = f.calls.filter((c) => c.url.pathname === '/rest/v1/profiles')
    assert.equal(profileCalls.length, 1)
    assert.equal(profileCalls[0].url.searchParams.get('limit'), String(svc.CUSTOMER_PAGE_SIZE_MAX))
  } finally { f.restore() }
})
