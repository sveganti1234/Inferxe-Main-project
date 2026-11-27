import './support/networkGuard.mjs'  // test isolation guard: must stay the first import (tests/testSafety.test.mjs checks)
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import test from 'node:test'

// POST /api/customer/orders: a deployment can only be linked by its owner, and bad dates do not break the insert.
process.env.SUPABASE_URL = 'http://127.0.0.1:9'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only-service-key'
const { createSupabaseApiMiddleware } = await import('../api/supabaseApi.js')

function fakeSupabase() {
  const deployments = [
    { id: 'dep-mine', user_id: 'sub-a' },
    { id: 'dep-other', user_id: 'sub-b' },
  ]
  const inserted = []
  return {
    inserted,
    from(table) {
      const st = { filters: {}, payload: null }
      const run = async () => {
        if (table === 'profiles') return { data: { user_id: 'sub-a', status: 'active', role: 'customer', organization_id: null }, error: null }
        if (table === 'deployments') {
          const hit = deployments.find((d) => Object.entries(st.filters).every(([f, v]) => d[f] === v))
          return { data: hit ?? null, error: null }
        }
        if (table === 'orders' && st.payload) {
          inserted.push(st.payload)
          return { data: st.payload, error: null }
        }
        return { data: [], error: null }
      }
      const q = {
        select() { return q }, eq(f, v) { st.filters[f] = v; return q }, in() { return q }, order() { return q }, limit() { return q },
        insert(p) { st.payload = p; return q },
        maybeSingle: run, single: run, then(res, rej) { return run().then(res, rej) },
      }
      return q
    },
  }
}

async function postOrder(supabase, body) {
  const mw = createSupabaseApiMiddleware({ authenticate: async () => ({ sub: 'sub-a' }), supabase })
  const req = Readable.from([JSON.stringify(body)])
  Object.assign(req, { method: 'POST', url: '/api/customer/orders', headers: { authorization: 'Bearer x', 'content-type': 'application/json' } })
  const res = { statusCode: 0, body: '', setHeader() {}, end(c = '') { this.body += c } }
  const errors = console.error
  console.error = () => {}
  try { await mw(req, res, () => {}) } finally { console.error = errors }
  return { status: res.statusCode, body: JSON.parse(res.body || '{}') }
}

test('an order cannot link another customer\'s deployment', async () => {
  const supabase = fakeSupabase()
  const { status } = await postOrder(supabase, { item_name: 'GPU', deployment_id: 'dep-other' })
  assert.equal(status, 404)
  assert.equal(supabase.inserted.length, 0)
})

test('an order can link the caller\'s own deployment, and no deployment at all', async () => {
  const supabase = fakeSupabase()
  assert.equal((await postOrder(supabase, { item_name: 'GPU', deployment_id: 'dep-mine' })).status, 201)
  assert.equal(supabase.inserted[0].deployment_id, 'dep-mine')
  assert.equal((await postOrder(supabase, { item_name: 'GPU' })).status, 201)
  assert.equal(supabase.inserted[1].deployment_id, null)
})

test('an unparseable order_date falls back to now instead of failing the insert', async () => {
  const supabase = fakeSupabase()
  const before = Date.now()
  assert.equal((await postOrder(supabase, { item_name: 'GPU', order_date: 'not a date' })).status, 201)
  assert.ok(Date.parse(supabase.inserted[0].order_date) >= before - 1000)
  assert.equal((await postOrder(supabase, { item_name: 'GPU', order_date: '2026-11-20T10:00:00Z' })).status, 201)
  assert.equal(supabase.inserted[1].order_date, '2026-11-20T10:00:00.000Z')
})
