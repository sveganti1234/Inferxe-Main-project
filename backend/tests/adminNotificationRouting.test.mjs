// @ts-nocheck
import './support/networkGuard.mjs' // test isolation guard: must stay the first import
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createSupabaseApiMiddleware,
  isAdminNotificationRequest,
} from '../api/supabaseApi.js'
import { createAdminToken } from '../auth/adminAuth.js'

const TEST_ADMIN_SECRET = '0814ce1e2d4fff285f2d31e3a5ca010bda3a77a290cfc83c53d93826a9b0d8fbde08437360eb55ed706d53ad9b811a11'
process.env.ADMIN_SESSION_SECRET = TEST_ADMIN_SECRET

function makeAdminToken(overrides = {}) {
  const now = Math.floor(Date.now() / 1000)
  return createAdminToken(
    {
      sub: 'admin_usr_001',
      sid: 'sess_admin_001',
      sv: 1,
      role: 'admin',
      email: 'admin@inferxe.com',
      iat: now,
      exp: now + 3600,
      ...overrides,
    },
    TEST_ADMIN_SECRET
  )
}

function makeMockReqRes(path, method = 'GET', authHeader = '') {
  let statusCode = 200
  let responseData = null

  const req = {
    url: path,
    method,
    headers: {
      ...(authHeader ? { authorization: authHeader } : {}),
      accept: 'application/json',
      'content-type': 'application/json',
    },
    socket: { remoteAddress: '127.0.0.1' },
  }

  const res = {
    setHeader() {},
    get statusCode() {
      return statusCode
    },
    set statusCode(code) {
      statusCode = code
    },
    end(payload) {
      try {
        responseData = payload ? JSON.parse(payload) : null
      } catch {
        responseData = payload
      }
    },
  }

  return { req, res, getStatus: () => statusCode, getBody: () => responseData }
}

function createFakeSupabase(initialStore = {}) {
  const store = {
    notifications: initialStore.notifications ? [...initialStore.notifications] : [],
    profiles: initialStore.profiles ? [...initialStore.profiles] : [],
    organization_members: initialStore.organization_members ? [...initialStore.organization_members] : [],
  }

  return {
    from(table) {
      if (!store[table]) store[table] = []

      return {
        select(cols = '*', options = {}) {
          let filters = []
          let rangeLimit = null
          let rangeOffset = 0

          const queryObj = {
            eq(field, val) {
              filters.push({ field, val })
              return queryObj
            },
            order() {
              return queryObj
            },
            range(start, end) {
              rangeOffset = start
              rangeLimit = end - start + 1
              return queryObj
            },
            maybeSingle() {
              return queryObj.then((res) => {
                if (res.data && res.data.length > 0) return { data: res.data[0], error: null }
                return { data: null, error: null }
              })
            },
            single() {
              return queryObj.then((res) => {
                if (res.data && res.data.length > 0) return { data: res.data[0], error: null }
                return { data: null, error: { message: 'Row not found' } }
              })
            },
            then(resolve, reject) {
              let rows = [...store[table]]
              for (const f of filters) {
                rows = rows.filter((r) => r[f.field] === f.val)
              }
              const count = rows.length
              if (options.head) {
                return Promise.resolve({ data: null, count, error: null }).then(resolve, reject)
              }
              if (rangeLimit !== null) {
                rows = rows.slice(rangeOffset, rangeOffset + rangeLimit)
              }
              return Promise.resolve({ data: rows, count, error: null }).then(resolve, reject)
            },
          }
          return queryObj
        },
      }
    },
  }
}

test('1. Admin Token Routing: Valid Admin HS256 tokens to /api/notifications pass through to FastAPI (next is called)', async () => {
  const token = makeAdminToken()
  const middleware = createSupabaseApiMiddleware()

  const paths = [
    '/api/notifications',
    '/api/notifications?unread_only=false&limit=10&offset=0',
    '/api/notifications/unread-count',
    '/api/notifications/notif-123/read',
    '/api/notifications/read-all',
  ]

  for (const p of paths) {
    const method = p.includes('/read') || p.includes('/read-all') ? 'PATCH' : 'GET'
    const { req, res } = makeMockReqRes(p, method, `Bearer ${token}`)
    let nextCalled = false

    await middleware(req, res, () => {
      nextCalled = true
    })

    assert.equal(nextCalled, true, `Expected next() to be called for admin path ${p}`)
    assert.equal(res.statusCode, 200, `Expected status not modified before proxy for ${p}`)
  }
})

test('2. Customer Token Routing: Valid customer tokens are handled by customer Supabase handler (next is NOT called)', async () => {
  const fakeStore = {
    profiles: [
      { user_id: 'cust_abc_123', full_name: 'Test Customer', status: 'active', role: 'customer' },
    ],
    organization_members: [],
    notifications: [
      { id: 'notif_cust_1', user_id: 'cust_abc_123', title: 'Customer Notice', is_read: false },
    ],
  }
  const fakeSupabase = createFakeSupabase(fakeStore)

  const middleware = createSupabaseApiMiddleware({
    authenticate: async () => ({ sub: 'cust_abc_123', token_use: 'id' }),
    supabase: fakeSupabase,
  })

  const { req, res, getStatus, getBody } = makeMockReqRes('/api/notifications', 'GET', 'Bearer cognito-customer-token')
  let nextCalled = false

  await middleware(req, res, () => {
    nextCalled = true
  })

  assert.equal(nextCalled, false, 'Expected customer request NOT to call next() (handled by Node customer API)')
  assert.equal(getStatus(), 200)
  assert.equal(getBody().total, 1)
  assert.equal(getBody().items[0].title, 'Customer Notice')
})

test('3. Unauthenticated requests to /api/notifications are rejected with 401 (next is NOT called)', async () => {
  const middleware = createSupabaseApiMiddleware()
  const { req, res, getStatus, getBody } = makeMockReqRes('/api/notifications', 'GET', '')
  let nextCalled = false

  await middleware(req, res, () => {
    nextCalled = true
  })

  assert.equal(nextCalled, false, 'Unauthenticated request must not call next()')
  assert.equal(getStatus(), 401, 'Unauthenticated request must be rejected with 401')
  assert.equal(getBody().ok, false)
  assert.match(getBody().error, /authentication/i)
})

test('4. Tampered / invalid Admin HS256 tokens are rejected with 401 (next is NOT called)', async () => {
  // Signed with a different, wrong secret
  const forgedToken = createAdminToken(
    {
      sub: 'hacker_admin',
      sid: 'sess_fake',
      sv: 1,
      role: 'admin',
      email: 'hacker@example.com',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    '1111111111111111111111111111111111111111111111111111111111111111' // wrong secret
  )

  const middleware = createSupabaseApiMiddleware()
  const { req, res, getStatus } = makeMockReqRes('/api/notifications', 'GET', `Bearer ${forgedToken}`)
  let nextCalled = false

  await middleware(req, res, () => {
    nextCalled = true
  })

  assert.equal(nextCalled, false, 'Tampered admin token must not call next()')
  assert.equal(getStatus(), 401, 'Tampered admin token must be rejected with 401')
})

test('5. Expired Admin tokens are rejected with 401 (next is NOT called)', async () => {
  const expiredToken = makeAdminToken({
    exp: Math.floor(Date.now() / 1000) - 100, // expired 100 seconds ago
  })

  const middleware = createSupabaseApiMiddleware()
  const { req, res, getStatus } = makeMockReqRes('/api/notifications', 'GET', `Bearer ${expiredToken}`)
  let nextCalled = false

  await middleware(req, res, () => {
    nextCalled = true
  })

  assert.equal(nextCalled, false, 'Expired admin token must not call next()')
  assert.equal(getStatus(), 401, 'Expired admin token must be rejected with 401')
})

test('6. User Isolation: Customer A can NEVER view Customer B notifications', async () => {
  const fakeStore = {
    profiles: [
      { user_id: 'customer_A', full_name: 'Customer Alice', status: 'active', role: 'customer' },
      { user_id: 'customer_B', full_name: 'Customer Bob', status: 'active', role: 'customer' },
    ],
    organization_members: [],
    notifications: [
      { id: 'notif_cust_A', user_id: 'customer_A', title: 'Confidential Notice A', is_read: false },
      { id: 'notif_cust_B', user_id: 'customer_B', title: 'Confidential Notice B', is_read: false },
    ],
  }
  const fakeSupabase = createFakeSupabase(fakeStore)

  // Request as Customer A
  const middlewareA = createSupabaseApiMiddleware({
    authenticate: async () => ({ sub: 'customer_A', token_use: 'id' }),
    supabase: fakeSupabase,
  })

  const { req, res, getStatus, getBody } = makeMockReqRes('/api/notifications', 'GET', 'Bearer cust-A-token')
  let nextCalled = false
  await middlewareA(req, res, () => {
    nextCalled = true
  })

  assert.equal(nextCalled, false)
  assert.equal(getStatus(), 200)
  const itemsA = getBody().items
  assert.equal(itemsA.length, 1)
  assert.equal(itemsA[0].id, 'notif_cust_A')
  assert.equal(itemsA.some((item) => item.user_id === 'customer_B'), false)
})
