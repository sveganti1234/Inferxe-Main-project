import './support/networkGuard.mjs'  // test isolation guard: must stay the first import (tests/testSafety.test.mjs checks)
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import test from 'node:test'

// Customer workspace load: only the last 90 days of inference requests (all-time count via a COUNT),
// no queries for unused collections, and a short-lived shared cache for the GPU catalogue.
process.env.SUPABASE_URL = 'http://127.0.0.1:9'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only-service-key'
const { createSupabaseApiMiddleware } = await import('../api/supabaseApi.js')

const DAY = 86400000
const requests = [1, 10, 89, 120, 400].map((days, i) => ({
  id: `r${i}`, user_id: 'sub-a', status: 'success', created_at: new Date(Date.now() - days * DAY).toISOString(),
}))

function fakeSupabase({ catalogError = false, inferenceDenied = false } = {}) {
  const log = []
  const client = {
    log,
    from(table) {
      const st = { table, filters: {}, head: false, count: null }
      const run = async (single) => {
        log.push({ ...st })
        if (table === 'profiles') return { data: { user_id: 'sub-a', status: 'active', role: 'customer', organization_id: null }, error: null }
        if (catalogError && (table === 'gpu_listings' || table === 'gpu_providers')) return { data: null, error: { code: '57014', message: 'timeout' } }
        if (inferenceDenied && table === 'inference_requests') return { data: null, count: null, error: { code: '42501', message: 'permission denied' } }
        let rows = table === 'inference_requests' ? requests : table === 'gpu_listings' ? [{ id: 'l1' }] : []
        if (st.filters.gte) rows = rows.filter((r) => r.created_at >= st.filters.gte)
        if (st.head) return { data: null, count: rows.length, error: null }
        return { data: single ? rows[0] ?? null : rows, error: null }
      }
      const q = {
        select(_c, opts) { st.head = Boolean(opts?.head); st.count = opts?.count ?? null; return q },
        eq(f, v) { st.filters[f] = v; return q }, in() { return q }, order(f, o) { st.order = { f, ascending: o?.ascending }; return q }, limit(n) { st.limit = n; return q },
        gte(f, v) { st.filters.gte = v; return q },
        maybeSingle() { return run(true) }, then(res, rej) { return run(false).then(res, rej) },
      }
      return q
    },
  }
  return client
}

async function loadWorkspace(supabase) {
  const mw = createSupabaseApiMiddleware({ authenticate: async () => ({ sub: 'sub-a' }), supabase })
  const req = Readable.from([])
  Object.assign(req, { method: 'GET', url: '/api/customer/workspace', headers: { authorization: 'Bearer x' } })
  const res = { statusCode: 0, body: '', setHeader() {}, end(c = '') { this.body += c } }
  const errors = console.error
  console.error = () => {}
  try { await mw(req, res, () => {}) } finally { console.error = errors }
  return { status: res.statusCode, body: JSON.parse(res.body || '{}') }
}

test('only the last 90 days of inference requests are sent, with the all-time count', async () => {
  const supabase = fakeSupabase()
  const { status, body } = await loadWorkspace(supabase)
  assert.equal(status, 200)
  assert.deepEqual(body.workspace.inference_requests.map((r) => r.id), ['r0', 'r1', 'r2'])
  assert.equal(body.workspace.inference_requests_total, 5)
  const countQuery = supabase.log.find((q) => q.table === 'inference_requests' && q.head)
  assert.ok(countQuery && countQuery.count === 'exact' && countQuery.filters.user_id === 'sub-a', 'counted server-side, scoped to the customer')
})

test('unused collections are not queried', async () => {
  const supabase = fakeSupabase()
  const { body } = await loadWorkspace(supabase)
  for (const table of ['order_reviews', 'usage_records']) {
    assert.ok(!supabase.log.some((q) => q.table === table), `${table} queried`)
    assert.equal(body.workspace[table], undefined)
  }
})

test('the GPU catalogue is cached per client, never across clients, and failures are not cached', async () => {
  const a = fakeSupabase()
  await loadWorkspace(a)
  await loadWorkspace(a)
  assert.equal(a.log.filter((q) => q.table === 'gpu_listings').length, 1, 'second load served from cache')

  const b = fakeSupabase()
  const { body } = await loadWorkspace(b)
  assert.equal(b.log.filter((q) => q.table === 'gpu_listings').length, 1, 'another client never reads a foreign cache entry')
  assert.deepEqual(body.workspace.gpu_listings, [{ id: 'l1' }])

  const failing = fakeSupabase({ catalogError: true })
  assert.ok((await loadWorkspace(failing)).status >= 500)
  assert.ok((await loadWorkspace(failing)).status >= 500)
  assert.equal(failing.log.filter((q) => q.table === 'gpu_listings').length, 2, 'a failed load is retried, not cached')
})

test('the GPU catalogue is re-read once the 30-second TTL has passed', async () => {
  const a = fakeSupabase()
  const realNow = Date.now
  let now = realNow()
  Date.now = () => now
  try {
    await loadWorkspace(a)
    now += 29_000
    await loadWorkspace(a)
    assert.equal(a.log.filter((q) => q.table === 'gpu_listings').length, 1, 'still fresh at 29 s')
    now += 2_000
    await loadWorkspace(a)
    assert.equal(a.log.filter((q) => q.table === 'gpu_listings').length, 2, 'expired after 30 s')
  } finally { Date.now = realNow }
})

test('permission denied on inference_requests yields an empty usage history, not an error', async () => {
  const { status, body } = await loadWorkspace(fakeSupabase({ inferenceDenied: true }))
  assert.equal(status, 200)
  assert.deepEqual(body.workspace.inference_requests, [])
  assert.equal(body.workspace.inference_requests_total, 0)
})

test('growing history tables are read newest first with an explicit cap, other collections untouched', async () => {
  const supabase = fakeSupabase()
  await loadWorkspace(supabase)
  for (const table of ['deployments', 'orders', 'wallet_transactions', 'notifications', 'notebook_sessions']) {
    const q = supabase.log.find((x) => x.table === table)
    assert.deepEqual(q.order, { f: 'created_at', ascending: false }, table)
    assert.equal(q.limit, 1000, table)
    assert.equal(q.filters.user_id, 'sub-a', `${table} stays scoped to the customer`)
  }
  assert.equal(supabase.log.find((x) => x.table === 'wallets').limit, undefined)
})
