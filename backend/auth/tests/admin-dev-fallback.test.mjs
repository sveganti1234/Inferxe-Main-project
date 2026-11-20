import '../../tests/support/networkGuard.mjs'  // test isolation guard: must stay the first import (tests/testSafety.test.mjs checks)
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import test from 'node:test'

// Regression: when the Supabase client cannot be created (missing/invalid backend config), the admin store
// must fail closed. The in-memory development fallback (hardcoded admin emails, ADMIN_PASSWORD) is opt-in only.
process.env.SUPABASE_URL = 'ftp://127.0.0.1:9'  // rejected by getSupabaseAdminClient -> client creation throws
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-disabled'
delete process.env.SUPABASE_SECRET_KEY

const store = await import('../adminSessionStore.js')
const { PRIMARY_SUPERADMIN_EMAIL } = store

function withEnv(vars, fn) {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]))
  for (const [k, v] of Object.entries(vars)) v === undefined ? delete process.env[k] : (process.env[k] = v)
  return Promise.resolve(fn()).finally(() => {
    for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : (process.env[k] = v)
  })
}

const OFF = { ADMIN_DEV_FALLBACK: undefined, ADMIN_PASSWORD: 'Some-Strong-Pass-123', NODE_ENV: 'development' }

test('fallback disabled by default: hardcoded admin emails are not resolved', () => withEnv(OFF, async () => {
  assert.equal(store.isAdminDevFallbackEnabled(), false)
  for (const email of [PRIMARY_SUPERADMIN_EMAIL, 'superadmin@inferxe.com', 'admin@inferxe.com']) {
    await assert.rejects(store.findAdminByEmailForAuth(email))
  }
}))

test('fallback disabled: unknown session ids are not accepted', () => withEnv(OFF, async () => {
  const r = await store.verifyAdminSessionRecord({ sessionId: crypto.randomUUID(), adminUserId: 'x', tokenSessionVersion: 1 })
  assert.equal(r.valid, false)
  assert.equal(r.statusCode, 503)
}))

test('fallback never enables in production or without an explicit ADMIN_PASSWORD', async () => {
  await withEnv({ ADMIN_DEV_FALLBACK: 'true', ADMIN_PASSWORD: 'Some-Strong-Pass-123', NODE_ENV: 'production' },
    () => assert.equal(store.isAdminDevFallbackEnabled(), false))
  await withEnv({ ADMIN_DEV_FALLBACK: 'true', ADMIN_PASSWORD: undefined, NODE_ENV: 'development' },
    () => assert.equal(store.isAdminDevFallbackEnabled(), false))
})

test('opt-in dev fallback still rejects session ids it never issued', () => withEnv(
  { ADMIN_DEV_FALLBACK: 'true', ADMIN_PASSWORD: 'Some-Strong-Pass-123', NODE_ENV: 'development' }, async () => {
    assert.equal(store.isAdminDevFallbackEnabled(), true)
    const forged = await store.verifyAdminSessionRecord({ sessionId: crypto.randomUUID(), adminUserId: 'x', tokenSessionVersion: 1 })
    assert.equal(forged.valid, false)
    assert.equal(forged.statusCode, 401)
  }))
