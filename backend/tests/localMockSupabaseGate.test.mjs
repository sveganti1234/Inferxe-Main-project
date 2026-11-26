import './support/networkGuard.mjs'  // test isolation guard: must stay the first import (tests/testSafety.test.mjs checks)
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import test from 'node:test'

// The local Supabase REST mock and the no-credentials fallback are local-development only:
// off unless INFERXE_LOCAL_MOCK_SUPABASE=1, refused in production/staging, loopback callers only.
// Without credentials (and without the mock) the Supabase client fails closed.

const ENV_KEYS = ['INFERXE_LOCAL_MOCK_SUPABASE', 'INFERXE_ENV', 'APP_ENV', 'NODE_ENV', 'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY']
const { getSupabaseAdminClient, isLocalMockSupabaseEnabled } = await import('../lib/supabase.js')
const { createMockSupabaseMiddleware } = await import('../dev/mockSupabaseRest.js')
const { getCustomerContext } = await import('../api/supabaseApi.js')

async function withEnv(values, fn) {
  const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
  for (const k of ENV_KEYS) delete process.env[k]
  Object.assign(process.env, values)
  try { return await fn() } finally {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  }
}

function call(mw, method, url, { body, remoteAddress = '127.0.0.1' } = {}) {
  const req = Readable.from(body ? [JSON.stringify(body)] : [])
  Object.assign(req, { method, url, headers: { 'content-type': 'application/json' }, socket: { remoteAddress } })
  const res = { statusCode: 200, body: '', headers: {}, setHeader(k, v) { this.headers[k] = v }, end(c = '') { this.body += c } }
  let passed = false
  return Promise.resolve(mw(req, res, () => { passed = true })).then(() => ({ passed, status: res.statusCode, body: res.body }))
}

test('without credentials the Supabase client fails closed (no embedded fallback)', async () => {
  await withEnv({}, async () => {
    assert.equal(isLocalMockSupabaseEnabled(), false)
    assert.throws(() => getSupabaseAdminClient(), /must be configured/)
  })
})

test('the mock fallback needs the explicit flag and is refused in production and staging', async () => {
  for (const marker of [{ INFERXE_ENV: 'production' }, { INFERXE_ENV: 'staging' }, { APP_ENV: 'prod' }, { NODE_ENV: 'production' }]) {
    await withEnv({ INFERXE_LOCAL_MOCK_SUPABASE: '1', ...marker }, async () => {
      assert.equal(isLocalMockSupabaseEnabled(), false, JSON.stringify(marker))
      assert.throws(() => getSupabaseAdminClient(), /must be configured/)
    })
  }
  await withEnv({ INFERXE_LOCAL_MOCK_SUPABASE: 'true' }, async () => {
    assert.equal(isLocalMockSupabaseEnabled(), false, "only the exact value '1' enables it")
  })
  await withEnv({ INFERXE_LOCAL_MOCK_SUPABASE: '1' }, async () => {
    assert.equal(isLocalMockSupabaseEnabled(), true)
    assert.ok(getSupabaseAdminClient(), 'local development: points at the loopback mock')
  })
})

test('with the mock disabled, unauthenticated callers cannot read admin records or create admin users', async () => {
  await withEnv({}, async () => {
    const mw = createMockSupabaseMiddleware()
    const read = await call(mw, 'GET', '/rest/v1/admin_users?select=*')
    assert.equal(read.passed, true, 'request is not answered by the mock')
    assert.equal(read.body, '')
    const create = await call(mw, 'POST', '/rest/v1/admin_users', {
      body: { email: 'attacker@example.test', role: 'superadmin', password_hash: 'x' },
    })
    assert.equal(create.passed, true)
    assert.equal(create.body, '')
  })
  await withEnv({ INFERXE_LOCAL_MOCK_SUPABASE: '1', INFERXE_ENV: 'production' }, async () => {
    const read = await call(createMockSupabaseMiddleware(), 'GET', '/rest/v1/admin_users?select=*')
    assert.equal(read.passed, true, 'flag leaked into production: still not mounted')
  })
})

test('an enabled local mock only answers this machine', async () => {
  await withEnv({ INFERXE_LOCAL_MOCK_SUPABASE: '1' }, async () => {
    const mw = createMockSupabaseMiddleware()
    const remote = await call(mw, 'GET', '/rest/v1/admin_users?select=id', { remoteAddress: '203.0.113.9' })
    assert.equal(remote.passed, true)
    assert.equal(remote.body, '')
    const local = await call(mw, 'GET', '/rest/v1/gpu_providers?select=id')
    assert.equal(local.passed, false)
    assert.equal(local.status, 200)
  })
})

function fakeSupabase({ profile = null, failTable = null } = {}) {
  const writes = []
  return {
    writes,
    from(table) {
      const q = {
        select() { return q }, eq() { return q }, in() { return q },
        upsert(p) { writes.push({ table, op: 'upsert', p }); return q },
        insert(p) { writes.push({ table, op: 'insert', p }); return q },
        maybeSingle: async () => ({ data: table === 'profiles' ? profile : null, error: null }),
        then(res, rej) {
          const result = table === failTable ? { data: null, error: { code: '57014', message: 'statement timeout' } } : { data: [], error: null }
          return Promise.resolve(result).then(res, rej)
        },
      }
      return q
    },
  }
}

test('a token without a synchronised profile is refused; no profile is invented from token claims', async () => {
  const supabase = fakeSupabase({ profile: null })
  const authenticate = async () => ({ sub: 'sub-new', email: 'new@example.test', name: 'New' })
  await assert.rejects(getCustomerContext({}, { authenticate, supabase }), (err) => err.statusCode === 403)
  assert.deepEqual(supabase.writes, [])
})

test('workspace reads fail on database errors instead of returning empty data', async () => {
  const { createSupabaseApiMiddleware } = await import('../api/supabaseApi.js')
  const profile = { user_id: 'sub-a', status: 'active', role: 'customer', organization_id: null }
  const mw = createSupabaseApiMiddleware({
    authenticate: async () => ({ sub: 'sub-a' }),
    supabase: fakeSupabase({ profile, failTable: 'orders' }),
  })
  const req = Readable.from([])
  Object.assign(req, { method: 'GET', url: '/api/customer/workspace', headers: { authorization: 'Bearer x' } })
  const res = { statusCode: 200, body: '', setHeader() {}, end(c = '') { this.body += c } }
  const errors = console.error
  console.error = () => {}
  try { await mw(req, res, () => {}) } finally { console.error = errors }
  assert.ok(res.statusCode >= 500, `expected a server error, got ${res.statusCode}`)
  assert.ok(!res.body.includes('"workspace"'), 'no partial workspace is returned')
})
