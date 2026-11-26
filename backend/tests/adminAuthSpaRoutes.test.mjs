import './support/networkGuard.mjs'  // test isolation guard: must stay the first import (tests/testSafety.test.mjs checks)
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import test from 'node:test'

// Vite mounts the admin auth middleware in front of the SPA: a page load of /login or /logout must reach the
// app (next), while the POST endpoints and GET /verify stay with the middleware.
process.env.SUPABASE_URL = 'http://127.0.0.1:9'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only-service-key'
const { createAdminAuthMiddleware } = await import('../auth/adminAuth.js')

async function call(method, url) {
  const mw = createAdminAuthMiddleware()
  const req = Readable.from(method === 'POST' ? ['{}'] : [])
  Object.assign(req, { method, url, headers: { 'content-type': 'application/json', host: '127.0.0.1' }, socket: { remoteAddress: '127.0.0.1' } })
  const res = { statusCode: 200, headersSent: false, setHeader() {}, getHeader() {}, writeHead(s) { this.statusCode = s }, end() { this.ended = true } }
  let passed = false
  const errors = console.error
  console.error = () => {}
  try { await mw(req, res, () => { passed = true }) } finally { console.error = errors }
  return { passed, status: res.statusCode, ended: Boolean(res.ended) }
}

test('GET /login and GET /logout are SPA page loads and pass through', async () => {
  for (const url of ['/login', '/login?next=%2Fdashboard', '/logout']) {
    const r = await call('GET', url)
    assert.equal(r.passed, true, `${url} was answered by the auth middleware`)
    assert.equal(r.ended, false)
  }
})

test('the auth endpoints are still handled by the middleware', async () => {
  for (const [method, url] of [['POST', '/login'], ['POST', '/logout'], ['GET', '/verify'], ['POST', '/verify'], ['OPTIONS', '/login']]) {
    const r = await call(method, url)
    assert.equal(r.passed, false, `${method} ${url} fell through`)
    assert.equal(r.ended, true)
  }
})
