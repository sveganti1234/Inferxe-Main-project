import '../../tests/support/networkGuard.mjs'  // test isolation guard: must stay the first import (tests/testSafety.test.mjs checks)
import assert from 'node:assert/strict'
import test from 'node:test'
import { createAdminAuthMiddleware } from '../adminAuth.js'

// C1: /api/admin/data/* must reach the supabaseApi middleware (next()), while unknown
// admin routes still 404 here. Fake req/res only: no server, no Supabase.
function fakeReq(method, url) {
  return { method, url, headers: {}, socket: { remoteAddress: '127.0.0.1' } }
}

function fakeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(name, value) { this.headers[name.toLowerCase()] = value },
    getHeader(name) { return this.headers[name.toLowerCase()] },
    writeHead(code, headers = {}) { this.statusCode = code; Object.assign(this.headers, headers) },
    end(chunk = '') { this.body += chunk; this.ended = true },
  }
}

async function run(method, url) {
  const middleware = createAdminAuthMiddleware()
  const res = fakeRes()
  let nextCalled = false
  await middleware(fakeReq(method, url), res, () => { nextCalled = true })
  return { res, nextCalled }
}

test('admin data API requests pass through to the next middleware', async () => {
  for (const [method, url] of [['GET', '/api/admin/data/users'], ['POST', '/api/admin/data/users'],
    ['PATCH', '/api/admin/data/users/abc'], ['GET', '/api/admin/data/users?limit=10']]) {
    const { res, nextCalled } = await run(method, url)
    assert.equal(nextCalled, true, `${method} ${url} should reach supabaseApi`)
    assert.notEqual(res.ended, true)
  }
})

test('unknown admin routes still return 404 without calling next', async () => {
  const { res, nextCalled } = await run('GET', '/api/admin/unknown')
  assert.equal(nextCalled, false)
  assert.equal(res.statusCode, 404)
})

test('non-admin paths are untouched', async () => {
  const { nextCalled } = await run('GET', '/api/customer/workspace')
  assert.equal(nextCalled, true)
})
