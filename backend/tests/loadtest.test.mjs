import './support/networkGuard.mjs'  // test isolation guard: must stay the first import (tests/testSafety.test.mjs checks)
import assert from 'node:assert/strict'
import http from 'node:http'
import test from 'node:test'
import { assertNonProductionTarget, percentile, runLoad } from '../scripts/loadtest.mjs'

test('the load tool refuses non-local hosts unless explicitly allowlisted', () => {
  assert.throws(() => assertNonProductionTarget('https://inferxe-backend.onrender.com/healthz', ''), /Refusing/)
  assert.throws(() => assertNonProductionTarget('https://example.vercel.app/api', 'staging.example.test'), /Refusing/)
  assert.equal(assertNonProductionTarget('http://127.0.0.1:10000/healthz', ''), '127.0.0.1')
  assert.equal(assertNonProductionTarget('http://localhost:8001/', ''), 'localhost')
  assert.equal(assertNonProductionTarget('https://staging.example.test/x', 'staging.example.test'), 'staging.example.test')
})

test('percentiles are taken from the sorted samples', () => {
  const s = Array.from({ length: 100 }, (_, i) => i + 1)
  assert.equal(percentile(s, 50), 50)
  assert.equal(percentile(s, 95), 95)
  assert.equal(percentile(s, 99), 99)
  assert.equal(percentile([], 95), 0)
})

test('runLoad measures a local server and reports statuses', async () => {
  const server = http.createServer((req, res) => { res.statusCode = req.url === '/fail' ? 503 : 200; res.end('ok') })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  try {
    const { port } = server.address()
    const ok = await runLoad({ url: `http://127.0.0.1:${port}/`, concurrency: 4, durationSec: 0.5 })
    assert.ok(ok.requests > 10)
    assert.deepEqual(Object.keys(ok.statuses), ['200'])
    assert.ok(ok.p50 <= ok.p95 && ok.p95 <= ok.max)
    const bad = await runLoad({ url: `http://127.0.0.1:${port}/fail`, concurrency: 2, durationSec: 0.3 })
    assert.deepEqual(Object.keys(bad.statuses), ['503'])
  } finally {
    await new Promise((r) => server.close(r))
  }
})
