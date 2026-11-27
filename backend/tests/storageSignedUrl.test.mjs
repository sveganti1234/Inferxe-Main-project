import './support/networkGuard.mjs'  // test isolation guard: must stay the first import (tests/testSafety.test.mjs checks)
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import test from 'node:test'

// POST /api/customer/storage/signed-url: a customer can only obtain upload/download URLs for objects under their
// own user-id prefix, in one of the four known buckets; anything else is refused before storage is called.
process.env.SUPABASE_URL = 'http://127.0.0.1:9'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only-service-key'
const { createSupabaseApiMiddleware } = await import('../api/supabaseApi.js')

function fakeSupabase() {
  const calls = []
  return {
    calls,
    from() {
      const q = {
        select() { return q }, eq() { return q }, in() { return q }, order() { return q },
        maybeSingle: async () => ({ data: { user_id: 'sub-a', status: 'active', role: 'customer', organization_id: null }, error: null }),
        then(res, rej) { return Promise.resolve({ data: [], error: null }).then(res, rej) },
      }
      return q
    },
    storage: {
      from(bucket) {
        return {
          createSignedUrl: async (path, expiresIn) => { calls.push({ bucket, path, action: 'download', expiresIn }); return { data: { signedUrl: 'https://signed.example/d', path }, error: null } },
          createSignedUploadUrl: async (path) => { calls.push({ bucket, path, action: 'upload' }); return { data: { signedUrl: 'https://signed.example/u', token: 't', path }, error: null } },
        }
      },
    },
  }
}

async function request(supabase, body) {
  const mw = createSupabaseApiMiddleware({ authenticate: async () => ({ sub: 'sub-a' }), supabase })
  const req = Readable.from([JSON.stringify(body)])
  Object.assign(req, { method: 'POST', url: '/api/customer/storage/signed-url', headers: { authorization: 'Bearer x', 'content-type': 'application/json' } })
  const res = { statusCode: 0, body: '', setHeader() {}, end(c = '') { this.body += c } }
  const errors = console.error
  console.error = () => {}
  try { await mw(req, res, () => {}) } finally { console.error = errors }
  return { status: res.statusCode, body: JSON.parse(res.body || '{}') }
}

test('own object: download URL valid for 60 s, upload URL issued', async () => {
  const supabase = fakeSupabase()
  const down = await request(supabase, { bucket: 'notebook-files', path: 'sub-a/nb/data.csv', action: 'download' })
  assert.equal(down.status, 200)
  assert.equal(down.body.signed_url, 'https://signed.example/d')
  const up = await request(supabase, { bucket: 'profile-avatars', path: 'sub-a/avatar.png', action: 'upload' })
  assert.equal(up.status, 200)
  assert.deepEqual(supabase.calls, [
    { bucket: 'notebook-files', path: 'sub-a/nb/data.csv', action: 'download', expiresIn: 60 },
    { bucket: 'profile-avatars', path: 'sub-a/avatar.png', action: 'upload' },
  ])
})

test('another customer\'s objects, traversal, unknown buckets and actions are refused without calling storage', async () => {
  const supabase = fakeSupabase()
  const refused = [
    { bucket: 'notebook-files', path: 'sub-b/nb/data.csv', action: 'download' },      // another customer
    { bucket: 'notebook-files', path: 'sub-a/../sub-b/data.csv', action: 'download' }, // traversal
    { bucket: 'notebook-files', path: 'sub-a/./x', action: 'download' },
    { bucket: 'notebook-files', path: 'sub-a//x', action: 'download' },                // empty segment
    { bucket: 'notebook-files', path: 'sub-ab/x', action: 'download' },                // prefix of another id
    { bucket: 'notebook-files', path: 'sub-a\\..\\x', action: 'download' },
    { bucket: 'notebook-files', path: 'sub-a', action: 'download' },                   // bare prefix, no object
    { bucket: 'private-admin', path: 'sub-a/x', action: 'download' },                  // unknown bucket
    { bucket: 'notebook-files', path: 'sub-a/x', action: 'delete' },                   // unknown action
    { bucket: 'notebook-files', path: 'sub-a/' + 'x'.repeat(600), action: 'download' },
  ]
  for (const body of refused) {
    const r = await request(supabase, body)
    assert.equal(r.status, 400, JSON.stringify(body))
  }
  assert.deepEqual(supabase.calls, [], 'storage was never called')
})
