/**
 * Administrator customer API: real-data account view, audited plan changes, input validation and
 * the admin-only gate (passthrough + token check). Uses an in-memory Supabase double: no network.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { handleAdminCustomerApi, parsePlanUpdate } from '../adminCustomersApi.js'
import { createAdminAuthMiddleware, createAdminToken } from '../../auth/adminAuth.js'
import { createSupabaseApiMiddleware } from '../supabaseApi.js'

const NOW = Date.parse('2026-11-18T12:00:00Z')

/** Chainable query double: every filter returns the builder; awaiting yields the table's rows. */
function fakeSupabase(tables, rpcResult = { data: { user_id: 'cust_1', tier: 'Pro' }, error: null }) {
  const calls = { rpc: [] }
  const builder = (rows) => {
    let single = false
    const q = new Proxy({}, {
      get(_, prop) {
        if (prop === 'then') {
          const result = single ? { data: rows[0] ?? null, error: null } : { data: rows, error: null }
          return (resolve) => resolve(result)
        }
        if (prop === 'maybeSingle') return () => { single = true; return q }
        return () => q
      },
    })
    return q
  }
  return {
    calls,
    from: (table) => builder(tables[table] ?? []),
    rpc: async (name, args) => { calls.rpc.push({ name, args }); return rpcResult },
  }
}

function req(method, url, body) {
  const r = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))])
  Object.assign(r, { method, url, headers: { 'content-type': 'application/json' } })
  return r
}
function res() {
  return {
    statusCode: 0, headers: {}, body: '',
    setHeader(k, v) { this.headers[k] = v },
    end(chunk = '') { this.body += chunk; this.done = true },
    json() { return JSON.parse(this.body) },
  }
}

const customer = { user_id: 'cust_1', full_name: 'Test Customer', email: 'c@example.test', role: 'customer', status: 'active', login_count: 4, last_login_at: '2026-11-17T10:00:00Z', organization_id: null, created_at: '2026-11-01T00:00:00Z' }

test('account view returns only recorded data and derives spend, budget and trial honestly', async () => {
  const supabase = fakeSupabase({
    profiles: [customer],
    wallets: [{ balance: '1500.50', currency: 'INR', low_balance_alert_level: 'NORMAL', updated_at: '2026-11-18T09:00:00Z' }],
    wallet_transactions: [
      { id: 't1', transaction_type: 'usage_charge', direction: 'debit', amount: '200', currency: 'INR', status: 'completed', created_at: '2026-11-10T00:00:00Z' },
      { id: 't2', transaction_type: 'usage_charge', direction: 'debit', amount: '-50', currency: 'INR', status: 'completed', created_at: '2026-11-11T00:00:00Z' },
    ],
    deployments: [{ id: 'd1', name: 'api', model_name: 'Llama', gpu_model: 'L40S', region: 'Mumbai', status: 'running', hourly_rate: '100', currency: 'INR' }],
    user_access_policies: [],
    workspace_settings: [{ monthly_budget: 10000, budget_configured: false }],
    customer_plans: [{ tier: 'Pro', trial_started_at: '2026-11-18T00:00:00Z', trial_ends_at: '2026-11-19T00:00:00Z' }],
    audit_logs: [{ id: 'a1', action: 'admin.wallet.credited', details: { administrator_email: 'admin@x.test', amount: 500 }, created_at: '2026-11-18T08:00:00Z' }],
  })
  const r = res()
  await handleAdminCustomerApi(req('GET', '/api/admin/customers/cust_1/account'), r, '/api/admin/customers/cust_1/account', { supabase, admin: { email: 'admin@x.test' }, now: NOW })
  assert.equal(r.statusCode, 200)
  const { account } = r.json()
  assert.equal(account.wallet.balance, 1500.5)
  assert.equal(account.spend.this_month, 250)
  assert.equal(account.spend.admin_spend_limit, null, 'no limit is not invented')
  assert.equal(account.spend.customer_budget, null, 'an unconfigured default budget is not shown')
  assert.equal(account.plan.trial_status, 'active')
  assert.equal(account.deployments[0].hourly_rate, 100)
  assert.equal(account.profile.login_count, 4)
  assert.equal(account.history[0].administrator_email, 'admin@x.test')
})

test('account view: no wallet → null (never a zero balance), unknown customer → 404', async () => {
  const empty = fakeSupabase({ profiles: [customer] })
  const r = res()
  await handleAdminCustomerApi(req('GET', '/x'), r, '/api/admin/customers/cust_1/account', { supabase: empty, admin: {}, now: NOW })
  const { account } = r.json()
  assert.equal(account.wallet, null)
  assert.equal(account.plan, null)
  assert.deepEqual(account.transactions, [])

  const missing = res()
  await handleAdminCustomerApi(req('GET', '/x'), missing, '/api/admin/customers/nobody/account', { supabase: fakeSupabase({ profiles: [] }), admin: {}, now: NOW })
  assert.equal(missing.statusCode, 404)
})

test('plan change: validated, sent atomically with the admin identity and reason, 404 for non-customers', async () => {
  const supabase = fakeSupabase({})
  const r = res()
  const body = { tier: ' Pro ', trial_started_at: '2026-11-18T00:00:00Z', trial_ends_at: '2026-12-18T00:00:00Z', reason: 'Pilot agreement' }
  await handleAdminCustomerApi(req('PUT', '/x', body), r, '/api/admin/customers/cust_1/plan', { supabase, admin: { email: 'admin@x.test' }, now: NOW })
  assert.equal(r.statusCode, 200)
  assert.deepEqual(supabase.calls.rpc[0], {
    name: 'admin_set_customer_plan',
    args: { p_user_id: 'cust_1', p_tier: 'Pro', p_trial_started_at: '2026-11-18T00:00:00.000Z', p_trial_ends_at: '2026-12-18T00:00:00.000Z', p_admin_email: 'admin@x.test', p_reason: 'Pilot agreement' },
  })

  const notFound = res()
  await handleAdminCustomerApi(req('PUT', '/x', body), notFound, '/api/admin/customers/x/plan', { supabase: fakeSupabase({}, { data: null, error: { code: 'P0002' } }), admin: { email: 'a@x.test' } })
  assert.equal(notFound.statusCode, 404)
})

test('plan validation rejects missing reason, end before start, start without end and long tiers', () => {
  assert.throws(() => parsePlanUpdate({ tier: 'Pro' }), /reason/)
  assert.throws(() => parsePlanUpdate({ reason: 'ok!', trial_started_at: '2026-12-01', trial_ends_at: '2026-11-01' }), /after/)
  assert.throws(() => parsePlanUpdate({ reason: 'ok!', trial_started_at: '2026-12-01' }), /end date/)
  assert.throws(() => parsePlanUpdate({ reason: 'ok!', tier: 'x'.repeat(65) }), /64/)
  assert.throws(() => parsePlanUpdate({ reason: 'ok!', trial_ends_at: 'not a date' }), /valid date/)
  assert.deepEqual(parsePlanUpdate({ reason: ' clear ', tier: '' }), { tier: null, trialStartedAt: null, trialEndsAt: null, reason: 'clear' })
})

test('admin gate: only the account and plan routes pass the admin auth middleware, and they require an admin session', async () => {
  process.env.ADMIN_SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || 'x'.repeat(48)
  const admin = createAdminAuthMiddleware({ disableRateLimit: true })
  for (const path of ['/api/admin/customers/cust_1/account', '/api/admin/customers/cust_1/plan']) {
    let passed = false
    await admin(req('GET', path), res(), () => { passed = true })
    assert.equal(passed, true, `${path} must reach the customer account API`)
  }
  for (const path of ['/api/admin/customers/summary', '/api/admin/customers']) {
    let passed = false
    const r = res()
    await admin(req('GET', path), r, () => { passed = true })
    assert.equal(passed, false, `${path} stays with the admin auth server's customer routes`)
    assert.equal(r.statusCode, 401, 'and still requires an administrator session')
  }

  const api = createSupabaseApiMiddleware()
  const noToken = res()
  await api(req('GET', '/api/admin/customers/cust_1/account'), noToken, () => {})
  assert.equal(noToken.statusCode, 401)

  const customerToken = createAdminToken({ sub: 'cust_1', role: 'customer', exp: Math.floor(Date.now() / 1000) + 600 }, process.env.ADMIN_SESSION_SECRET)
  const asCustomer = req('PUT', '/api/admin/customers/cust_1/plan', { reason: 'self-upgrade' })
  asCustomer.headers.authorization = `Bearer ${customerToken}`
  const denied = res()
  await api(asCustomer, denied, () => {})
  assert.ok([401, 403].includes(denied.statusCode), `a token without the admin role is rejected (got ${denied.statusCode})`)
})
