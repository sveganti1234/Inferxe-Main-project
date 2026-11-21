// Tests for the test-isolation guard (lib/testSafety.js, auth/envLoader.js, tests/support/networkGuard.mjs).
// Nothing here reaches a network: production-looking URLs must be refused before any request is made,
// and the only "Supabase" data used is synthetic.
import './support/networkGuard.mjs'  // test isolation guard: must stay the first import (tests/testSafety.test.mjs checks)
import assert from 'node:assert/strict'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const {
  assertExternalTargetAllowed, isHostAllowed, isTestRun, productionTargets, TestSafetyError, validateLiveTarget,
} = await import('../lib/testSafety.js')
const { spawnSync } = await import('node:child_process')
const { fileURLToPath, pathToFileURL } = await import('node:url')
const BACKEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FAKE_LIVE_URL = 'https://live-test-project-fake.supabase.co'  // never contacted
const { loadBackendEnv } = await import('../auth/envLoader.js')
const { getSupabaseAdminClient } = await import('../lib/supabase.js')
const { upsertCognitoProfile } = await import('../database/supabaseProfiles.js')
const { getCustomerSummary, exportCustomersToCsv } = await import('../database/supabaseCustomerService.js')

const PROD_LIKE_URL = 'https://abcdefghijklmnopqrst.supabase.co'  // shape of a real project URL; never contacted

function withEnv(values, fn) {
  const saved = Object.fromEntries(Object.keys(values).map((k) => [k, process.env[k]]))
  Object.assign(process.env, values)
  const restore = () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
  return Promise.resolve().then(fn).finally(restore)
}

function stubFetch(handler) {
  const calls = []
  const real = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    calls.push(String(url))
    return handler(url, init)
  }
  return { calls, restore: () => { globalThis.fetch = real } }
}

test('node --test marks the process as a test run', () => {
  assert.equal(isTestRun(), true)
})

test('backend/.env is not loaded during tests, so no production credentials enter the process', () => {
  const result = loadBackendEnv()
  assert.equal(result.loaded, false)
  assert.equal(result.blocked, true)
  assert.deepEqual(result.keys, [])
})

test('an explicit env file (e.g. a temp fixture) still loads during tests', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inferxe-env-'))
  try {
    const file = path.join(dir, '.env')
    fs.writeFileSync(file, 'INFERXE_FIXTURE_VALUE=ok\n')
    const target = {}
    assert.equal(loadBackendEnv({ envPath: file, targetEnv: target }).loaded, true)
    assert.equal(target.INFERXE_FIXTURE_VALUE, 'ok')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('the guard refuses non-loopback targets, allows loopback, and reports categories only', () => {
  assert.throws(() => assertExternalTargetAllowed(PROD_LIKE_URL), TestSafetyError)
  assert.throws(() => assertExternalTargetAllowed('https://cognito-idp.ap-south-1.amazonaws.com/x'), TestSafetyError)
  assert.doesNotThrow(() => assertExternalTargetAllowed('http://127.0.0.1:54321'))
  assert.doesNotThrow(() => assertExternalTargetAllowed('http://localhost:54321'))
  const err = (() => { try { assertExternalTargetAllowed(PROD_LIKE_URL) } catch (e) { return e } })()
  assert.match(err.message, /supabase project/)
  assert.ok(!err.message.includes('abcdefghijklmnopqrst'), 'never the host')
})

test('detection: node --test, the guard, and *.test.mjs files run directly are test processes; servers are not', () => {
  assert.equal(isTestRun(), true)
  assert.equal(isTestRun({}, ['node', '/srv/app/backend/auth/adminAuthServer.mjs']), false)
  assert.equal(isTestRun({}, ['node', '/x/backend/tests/some.test.mjs']), true)
  assert.equal(isTestRun({ INFERXE_NODE_TEST_GUARD: '1' }, ['node', 'server.mjs']), true)
  // Outside a test process the guard is a no-op (production behaviour unchanged).
  assert.equal(isTestRun({ NODE_TEST_CONTEXT: '' }, ['node', 'server.mjs']), false)
})

test('live mode requires an explicit, non-production target and still blocks every other host', () => {
  const base = { NODE_TEST_CONTEXT: 'child', INFERXE_LIVE_SUPABASE_TESTS: '1' }
  assert.throws(() => validateLiveTarget(base), /INFERXE_LIVE_SUPABASE_URL/)
  const listed = {
    ...base, INFERXE_LIVE_SUPABASE_URL: 'https://prod-listed-fake.supabase.co',
    INFERXE_LIVE_SUPABASE_SERVICE_ROLE_KEY: 'fake-live-key', INFERXE_PRODUCTION_SUPABASE_HOSTS: 'prod-listed-fake.supabase.co',
  }
  const prodErr = (() => { try { validateLiveTarget(listed) } catch (e) { return e } })()
  assert.ok(prodErr instanceof TestSafetyError && /production Supabase project/.test(prodErr.message))
  assert.ok(!prodErr.message.includes('prod-listed-fake'))

  const live = { ...base, INFERXE_LIVE_SUPABASE_URL: FAKE_LIVE_URL, INFERXE_LIVE_SUPABASE_SERVICE_ROLE_KEY: 'fake-live-key' }
  assert.equal(validateLiveTarget(live), 'live-test-project-fake.supabase.co')
  assert.equal(isHostAllowed('live-test-project-fake.supabase.co', live), true)
  assert.equal(isHostAllowed('abcdefghijklmnopqrst.supabase.co', live), false)
  assert.equal(isHostAllowed('cognito-idp.ap-south-1.amazonaws.com', live), false)
  assert.throws(() => assertExternalTargetAllowed(PROD_LIKE_URL, 'Supabase', live), TestSafetyError)
})

test('live mode refuses the project configured in backend/.env (host or key)', (t) => {
  const prod = productionTargets({})  // read from the .env files; never exported or printed
  if (prod.hosts.size === 0) return t.skip('no project .env with SUPABASE_URL on this machine')
  const [host] = prod.hosts
  const env = {
    NODE_TEST_CONTEXT: 'child', INFERXE_LIVE_SUPABASE_TESTS: '1',
    INFERXE_LIVE_SUPABASE_URL: `https://${host}`, INFERXE_LIVE_SUPABASE_SERVICE_ROLE_KEY: 'fake-live-key',
  }
  const err = (() => { try { validateLiveTarget(env) } catch (e) { return e } })()
  assert.ok(err instanceof TestSafetyError)
  assert.ok(!err.message.includes(host))
  if (prod.keys.size) {
    const [key] = prod.keys
    assert.throws(() => validateLiveTarget({ ...env, INFERXE_LIVE_SUPABASE_URL: FAKE_LIVE_URL, INFERXE_LIVE_SUPABASE_SERVICE_ROLE_KEY: key }), TestSafetyError)
  }
})

function cleanChildEnv(extra = {}) {
  const env = { ...process.env }
  for (const k of Object.keys(env)) {
    if (k.startsWith('NODE_TEST') || k === 'INFERXE_NODE_TEST_GUARD' || k.startsWith('INFERXE_LIVE') || k.startsWith('SUPABASE')) delete env[k]
  }
  return { ...env, ...extra }
}

test('a *.test.mjs file run directly with plain `node` cannot load backend/.env', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inferxe-direct-'))
  try {
    const probe = path.join(dir, 'probe.test.mjs')
    fs.writeFileSync(probe, `
      import { loadBackendEnv } from ${JSON.stringify(pathToFileURL(path.join(BACKEND, 'auth', 'envLoader.js')).href)}
      const r = loadBackendEnv()
      console.log('DIRECT', r.loaded, Boolean(r.blocked), Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY))
    `)
    const out = spawnSync(process.execPath, [probe], { env: cleanChildEnv(), encoding: 'utf8', timeout: 60000 })
    assert.match(out.stdout, /DIRECT false true false/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('a production live target stops the process before any test runs', () => {
  const out = spawnSync(process.execPath, [path.join(BACKEND, 'tests', 'support', 'networkGuard.mjs')], {
    env: cleanChildEnv({
      INFERXE_LIVE_SUPABASE_TESTS: '1', INFERXE_LIVE_SUPABASE_URL: 'https://prod-listed-fake.supabase.co',
      INFERXE_LIVE_SUPABASE_SERVICE_ROLE_KEY: 'fake-live-key', INFERXE_PRODUCTION_SUPABASE_HOSTS: 'prod-listed-fake.supabase.co',
    }),
    encoding: 'utf8', timeout: 60000,
  })
  assert.notEqual(out.status, 0)
  assert.match(out.stderr, /production Supabase project/)
  assert.ok(!out.stderr.includes('prod-listed-fake'))
})

test('every Node test file imports the isolation guard first', () => {
  const files = [
    ...fs.readdirSync(path.join(BACKEND, 'tests')).filter((f) => f.endsWith('.test.mjs')).map((f) => path.join(BACKEND, 'tests', f)),
    ...fs.readdirSync(path.join(BACKEND, 'auth', 'tests')).filter((f) => f.endsWith('.test.mjs')).map((f) => path.join(BACKEND, 'auth', 'tests', f)),
  ]
  const offenders = files.filter((file) => {
    const firstImport = fs.readFileSync(file, 'utf8').split(/\r?\n/).find((l) => l.startsWith('import '))
    return !firstImport || !firstImport.includes('support/networkGuard.mjs')
  })
  assert.deepEqual(offenders.map((f) => path.relative(BACKEND, f)), [])
})

test('production Supabase credentials in the environment fail before any request (customer service)', async () => {
  const fetchStub = stubFetch(async () => new Response('[]'))
  try {
    await withEnv({ SUPABASE_URL: PROD_LIKE_URL, SUPABASE_SERVICE_ROLE_KEY: 'test-only-key' }, async () => {
      await assert.rejects(() => getCustomerSummary(), TestSafetyError)
      await assert.rejects(() => exportCustomersToCsv(), TestSafetyError)
    })
  } finally {
    fetchStub.restore()
  }
  assert.equal(fetchStub.calls.length, 0, 'no request may be sent')
})

test('production Supabase credentials fail before a client is created (admin client)', async () => {
  await withEnv({ SUPABASE_URL: PROD_LIKE_URL, SUPABASE_SERVICE_ROLE_KEY: 'test-only-key' }, () => {
    assert.throws(() => getSupabaseAdminClient(), TestSafetyError)
  })
})

test('profile sync with the real fetch is blocked; an injected fetch double is allowed', async () => {
  const claims = { sub: 'sub-test', email: 'user@example.test' }
  const opts = { supabaseUrl: PROD_LIKE_URL, serviceRoleKey: 'test-only-key' }
  await assert.rejects(() => upsertCognitoProfile(claims, opts), TestSafetyError)

  const seen = []
  const fakeFetch = async (url) => { seen.push(String(url)); return new Response('[{}]', { status: 201 }) }
  await upsertCognitoProfile(claims, { ...opts, fetchImpl: fakeFetch }).catch(() => {})
  assert.ok(seen.length > 0, 'the injected double is used')
})

test('CSV export works from mocked Supabase data only (synthetic rows, loopback URL, stubbed fetch)', async () => {
  const rows = [
    { user_id: 'sub-synthetic-1', email: 'first@example.test', full_name: 'Doe, Jane "JD"', organization: 'Acme', role: 'customer', created_at: '2026-01-01T00:00:00Z' },
    { user_id: 'sub-synthetic-2', email: 'second@example.test', full_name: 'Plain Name', role: 'customer', created_at: '2026-01-02T00:00:00Z' },
    { user_id: 'usr_admin', email: 'admin@example.test', full_name: 'Admin', role: 'admin', created_at: '2026-01-03T00:00:00Z' },
  ]
  // Emulates the database: the customer filter (admin exclusion) is part of the request, not done in Node.
  const fetchStub = stubFetch(async (url) => {
    const excludeAdmins = new URL(String(url)).searchParams.get('and')?.includes('role.neq."admin"')
    const hits = excludeAdmins ? rows.filter((r) => r.role !== 'admin') : rows
    return new Response(JSON.stringify(hits), { status: 200, headers: { 'content-range': `0-${hits.length - 1}/${hits.length}` } })
  })
  let csv
  try {
    await withEnv({ SUPABASE_URL: 'http://127.0.0.1:9', SUPABASE_SERVICE_ROLE_KEY: 'test-only-key' }, async () => {
      csv = await exportCustomersToCsv()
    })
  } finally {
    fetchStub.restore()
  }
  assert.ok(fetchStub.calls.every((u) => u.startsWith('http://127.0.0.1:9/')))
  const lines = csv.trim().split('\n')
  assert.equal(lines.length, 3, 'header + 2 customers (admin excluded)')
  assert.ok(csv.includes('"Doe, Jane ""JD"""'), 'RFC 4180 quoting of commas and quotes')
  assert.ok(csv.includes('second@example.test'))
  assert.ok(!csv.includes('admin@example.test'))
})

test('the network guard blocks outbound sockets and fetch to non-loopback hosts before connecting', async () => {
  // 192.0.2.0/24 is a reserved documentation range: never routable, so this is safe even unguarded.
  const socketError = await new Promise((resolve) => {
    const s = net.connect({ host: '192.0.2.1', port: 443 })
    s.on('error', resolve)
    s.on('connect', () => { s.destroy(); resolve(null) })
  })
  assert.ok(socketError instanceof TestSafetyError)

  const fetchError = await fetch('https://192.0.2.1/').then(() => null, (e) => e)
  assert.ok(fetchError, 'fetch must fail')
  const cause = fetchError.cause || fetchError
  assert.equal(cause.name, 'TestSafetyError')
})
