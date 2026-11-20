import './support/networkGuard.mjs'  // test isolation guard: must stay the first import (tests/testSafety.test.mjs checks)
import assert from 'node:assert/strict'
import test from 'node:test'
import { getCustomerContext } from '../api/supabaseApi.js'

// Fake Supabase query builder: every query resolves after `delayMs` with the given result.
function fakeSupabase(results, delayMs = 50) {
  const started = []
  return {
    started,
    from(table) {
      const builder = {
        select() { return builder }, eq() { return builder }, maybeSingle() { return builder },
        then(resolve, reject) {
          started.push([table, Date.now()])
          return new Promise((r) => setTimeout(() => r(results[table]), delayMs)).then(resolve, reject)
        },
      }
      return builder
    },
  }
}
const authenticate = async () => ({ sub: 'cognito-sub-1' })
const activeProfile = { data: { user_id: 'cognito-sub-1', status: 'active', role: 'customer', organization_id: 'org-1' }, error: null }

test('profile and membership lookups run concurrently', async () => {
  const supabase = fakeSupabase({ profiles: activeProfile, organization_members: { data: [{ organization_id: 'org-2' }], error: null } })
  const t0 = Date.now()
  const ctx = await getCustomerContext({}, { authenticate, supabase })
  const elapsed = Date.now() - t0
  assert.deepEqual(ctx.organizationIds.sort(), ['org-1', 'org-2'])
  assert.equal(supabase.started.length, 2)
  assert.ok(elapsed < 90, `expected one ~50ms round trip, took ${elapsed}ms`)  // sequential would be ~100ms
})

test('profile errors still take precedence over membership errors', async () => {
  const supabase = fakeSupabase({ profiles: { data: null, error: null }, organization_members: { data: null, error: new Error('membership failed') } })
  await assert.rejects(getCustomerContext({}, { authenticate, supabase }), (e) => e.statusCode === 403)
})

test('inactive and admin profiles are still rejected', async () => {
  for (const data of [{ ...activeProfile.data, status: 'suspended' }, { ...activeProfile.data, role: 'admin' }]) {
    const supabase = fakeSupabase({ profiles: { data, error: null }, organization_members: { data: [], error: null } })
    await assert.rejects(getCustomerContext({}, { authenticate, supabase }), (e) => e.statusCode === 403)
  }
})

test('membership error surfaces for an otherwise valid profile', async () => {
  const supabase = fakeSupabase({ profiles: activeProfile, organization_members: { data: null, error: new Error('membership failed') } })
  await assert.rejects(getCustomerContext({}, { authenticate, supabase }), /membership failed/)
})
