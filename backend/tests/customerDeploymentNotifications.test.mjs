// @ts-nocheck
import './support/networkGuard.mjs' // test isolation guard: must stay the first import (tests/testSafety.test.mjs checks)
import assert from 'node:assert/strict'
import test from 'node:test'
import { handleCustomerApi } from '../api/supabaseApi.js'

/**
 * Creates an in-memory fake Supabase client for testing customer deployment notifications.
 */
function createFakeSupabase(initialStore = {}) {
  const store = {
    deployments: initialStore.deployments ? [...initialStore.deployments] : [],
    notifications: initialStore.notifications ? [...initialStore.notifications] : [],
    profiles: initialStore.profiles ? [...initialStore.profiles] : [],
    organization_members: initialStore.organization_members ? [...initialStore.organization_members] : [],
    organizations: initialStore.organizations ? [...initialStore.organizations] : [],
  }

  function from(table) {
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
          in(field, vals) {
            filters.push({ field, vals, isIn: true })
            return queryObj
          },
          order(field, { ascending = true } = {}) {
            return queryObj
          },
          range(start, end) {
            rangeOffset = start
            rangeLimit = end - start + 1
            return queryObj
          },
          limit(n) {
            rangeLimit = n
            return queryObj
          },
          single() {
            return queryObj.then((res) => {
              if (res.data && res.data.length > 0) return { data: res.data[0], error: null }
              return { data: null, error: { message: 'Row not found' } }
            })
          },
          maybeSingle() {
            return queryObj.then((res) => {
              if (res.data && res.data.length > 0) return { data: res.data[0], error: null }
              return { data: null, error: null }
            })
          },
          then(resolve, reject) {
            let rows = [...store[table]]
            for (const f of filters) {
              if (f.isIn) {
                rows = rows.filter((r) => f.vals.includes(r[f.field]))
              } else {
                rows = rows.filter((r) => r[f.field] === f.val)
              }
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
      insert(record) {
        const records = Array.isArray(record) ? record : [record]
        const inserted = records.map((r) => ({ ...r }))
        store[table].push(...inserted)

        return {
          select() {
            return {
              single: () => Promise.resolve({ data: inserted[0], error: null }),
              maybeSingle: () => Promise.resolve({ data: inserted[0], error: null }),
              then: (resolve) => Promise.resolve({ data: inserted, error: null }).then(resolve),
            }
          },
          then: (resolve) => Promise.resolve({ data: inserted, error: null }).then(resolve),
        }
      },
      update(updateData) {
        let filters = []
        const updateObj = {
          eq(field, val) {
            filters.push({ field, val })
            return updateObj
          },
          select() {
            return {
              single() {
                return updateObj.then((res) => ({ data: res.data?.[0] || null, error: null }))
              },
              maybeSingle() {
                return updateObj.then((res) => ({ data: res.data?.[0] || null, error: null }))
              },
              then(resolve, reject) {
                return updateObj.then(resolve, reject)
              },
            }
          },
          then(resolve) {
            const updated = []
            store[table] = store[table].map((row) => {
              const match = filters.every((f) => row[f.field] === f.val)
              if (match) {
                const newRow = { ...row, ...updateData }
                updated.push(newRow)
                return newRow
              }
              return row
            })
            return Promise.resolve({ data: updated, error: null }).then(resolve)
          },
        }
        return updateObj
      },
      delete() {
        let filters = []
        const deleteObj = {
          eq(field, val) {
            filters.push({ field, val })
            return deleteObj
          },
          select() {
            return {
              maybeSingle() {
                return deleteObj.then((res) => ({ data: res.data?.[0] || null, error: null }))
              },
              then(resolve, reject) {
                return deleteObj.then(resolve, reject)
              },
            }
          },
          then(resolve) {
            const deleted = []
            store[table] = store[table].filter((row) => {
              const match = filters.every((f) => row[f.field] === f.val)
              if (match) {
                deleted.push(row)
                return false
              }
              return true
            })
            return Promise.resolve({ data: deleted, error: null }).then(resolve)
          },
        }
        return deleteObj
      },
    }
  }

  return { from, store }
}

/**
 * Creates simulated req/res objects for testing middleware.
 */
function createHttpMock({ method = 'GET', url = '/', headers = {}, body = null }) {
  const req = {
    method,
    url,
    headers: { 'content-type': 'application/json', ...headers },
    body,
    async *[Symbol.asyncIterator]() {
      if (body !== null && body !== undefined) {
        yield Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))
      }
    },
  }

  const responseHeaders = {}
  let responseData = ''

  const res = {
    statusCode: 200,
    setHeader(key, val) {
      responseHeaders[key.toLowerCase()] = val
      return res
    },
    writeHead(code, hdrs = {}) {
      res.statusCode = code
      Object.assign(responseHeaders, hdrs)
      return res
    },
    end(chunk = '') {
      responseData += chunk
      return res
    },
    get body() {
      try {
        return JSON.parse(responseData)
      } catch {
        return responseData
      }
    },
  }

  return { req, res }
}

test('1. GPU deployment creation generates exactly one notification for claims.sub', async () => {
  const fakeSupabase = createFakeSupabase({
    profiles: [{ user_id: 'cust-101', role: 'customer', status: 'active', organization_id: 'org-test' }],
  })

  const authenticate = async () => ({
    sub: 'cust-101',
    email: 'cust101@inferxe.com',
  })

  const { req, res } = createHttpMock({
    method: 'POST',
    url: '/api/customer/deployments',
    body: {
      name: 'qwen-coder-v1',
      model_name: 'Qwen 2.5 Coder 32B',
      gpu_model: 'NVIDIA H100 SXM5',
      region: 'Mumbai, IN',
      hourly_rate: 150,
      currency: 'INR',
    },
  })

  await handleCustomerApi(req, res, '/api/customer/deployments', {
    authenticate,
    supabase: fakeSupabase,
  })

  assert.equal(res.statusCode, 201)
  assert.equal(res.body.ok, true)
  assert.ok(res.body.deployment.id)

  // Verify deployment record in store
  assert.equal(fakeSupabase.store.deployments.length, 1)
  assert.equal(fakeSupabase.store.deployments[0].user_id, 'cust-101')
  assert.equal(fakeSupabase.store.deployments[0].status, 'provisioning')

  // Verify exactly one notification was created for cust-101
  assert.equal(fakeSupabase.store.notifications.length, 1)
  const notif = fakeSupabase.store.notifications[0]
  assert.equal(notif.user_id, 'cust-101')
  assert.equal(notif.title, 'GPU Deployment Started')
  assert.equal(notif.notification_type, 'GPU_DEPLOYMENT')
  assert.equal(notif.is_read, false)
  assert.equal(notif.related_entity_id, res.body.deployment.id)
  assert.ok(notif.detail.includes('NVIDIA H100 SXM5'))
  assert.ok(notif.detail.includes('qwen-coder-v1'))
})

test('2. Genuine deployment status change creates matching lifecycle notification', async () => {
  const fakeSupabase = createFakeSupabase({
    profiles: [{ user_id: 'cust-101', role: 'customer', status: 'active', organization_id: 'org-test' }],
    deployments: [{
      id: 'dep-test-1',
      user_id: 'cust-101',
      name: 'mistral-7b-v1',
      gpu_model: 'NVIDIA L4',
      region: 'Hyderabad, IN',
      status: 'provisioning',
    }],
    notifications: [],
  })

  const authenticate = async () => ({ sub: 'cust-101', email: 'cust101@inferxe.com' })

  // Transition from provisioning -> running
  const { req, res } = createHttpMock({
    method: 'PATCH',
    url: '/api/customer/deployments/dep-test-1',
    body: { status: 'running' },
  })

  await handleCustomerApi(req, res, '/api/customer/deployments/dep-test-1', {
    authenticate,
    supabase: fakeSupabase,
  })

  assert.equal(res.statusCode, 200)
  assert.equal(res.body.ok, true)
  assert.equal(fakeSupabase.store.deployments[0].status, 'running')

  // Verify notification created
  assert.equal(fakeSupabase.store.notifications.length, 1)
  const notif = fakeSupabase.store.notifications[0]
  assert.equal(notif.user_id, 'cust-101')
  assert.equal(notif.title, 'GPU Deployment Running')
  assert.equal(notif.notification_type, 'GPU_DEPLOYMENT')
  assert.ok(notif.detail.includes('live and serving requests'))
})

test('3. Unchanged deployment status does NOT create duplicate notifications', async () => {
  const fakeSupabase = createFakeSupabase({
    profiles: [{ user_id: 'cust-101', role: 'customer', status: 'active', organization_id: 'org-test' }],
    deployments: [{
      id: 'dep-test-2',
      user_id: 'cust-101',
      name: 'qwen-endpoint',
      gpu_model: 'NVIDIA A100',
      region: 'Bengaluru, IN',
      status: 'running',
    }],
    notifications: [],
  })

  const authenticate = async () => ({ sub: 'cust-101', email: 'cust101@inferxe.com' })

  // Update status with identical value: 'running' -> 'running'
  const { req, res } = createHttpMock({
    method: 'PATCH',
    url: '/api/customer/deployments/dep-test-2',
    body: { status: 'running' },
  })

  await handleCustomerApi(req, res, '/api/customer/deployments/dep-test-2', {
    authenticate,
    supabase: fakeSupabase,
  })

  assert.equal(res.statusCode, 200)
  assert.equal(res.body.ok, true)

  // Must NOT insert any duplicate notification
  assert.equal(fakeSupabase.store.notifications.length, 0, 'No notification should be emitted when status is unchanged')
})

test('4. Customer A cannot access or update Customer B deployment (ownership isolation)', async () => {
  const fakeSupabase = createFakeSupabase({
    profiles: [
      { user_id: 'cust-101', role: 'customer', status: 'active' },
      { user_id: 'cust-victim', role: 'customer', status: 'active' },
    ],
    deployments: [{
      id: 'dep-victim',
      user_id: 'cust-victim',
      name: 'victim-llama-endpoint',
      gpu_model: 'NVIDIA H100',
      status: 'running',
    }],
    notifications: [],
  })

  // Cust-101 tries to stop Customer Victim's deployment
  const authenticate = async () => ({ sub: 'cust-101', email: 'attacker@inferxe.com' })

  const { req, res } = createHttpMock({
    method: 'PATCH',
    url: '/api/customer/deployments/dep-victim',
    body: { status: 'stopped' },
  })

  await handleCustomerApi(req, res, '/api/customer/deployments/dep-victim', {
    authenticate,
    supabase: fakeSupabase,
  })

  // Must reject with 404 (not found / not owned)
  assert.equal(res.statusCode, 404)
  assert.equal(fakeSupabase.store.deployments[0].status, 'running', 'Status must remain untouched')
  assert.equal(fakeSupabase.store.notifications.length, 0, 'No notifications emitted')
})

test('5. Customer A cannot view Customer B notifications via /api/notifications', async () => {
  const fakeSupabase = createFakeSupabase({
    profiles: [
      { user_id: 'cust-101', role: 'customer', status: 'active' },
      { user_id: 'cust-victim', role: 'customer', status: 'active' },
    ],
    notifications: [
      {
        id: 'notif-victim-1',
        user_id: 'cust-victim',
        title: 'Victim Private Notification',
        detail: 'Confidential deployment details',
        notification_type: 'GPU_DEPLOYMENT',
        is_read: false,
        created_at: new Date().toISOString(),
      },
    ],
  })

  // Cust-101 queries notifications
  const authenticate = async () => ({ sub: 'cust-101', email: 'cust101@inferxe.com' })

  const { req, res } = createHttpMock({
    method: 'GET',
    url: '/api/notifications',
  })

  await handleCustomerApi(req, res, '/api/notifications', {
    authenticate,
    supabase: fakeSupabase,
  })

  assert.equal(res.statusCode, 200)
  assert.equal(res.body.total, 0)
  assert.equal(res.body.unread_count, 0)
  assert.deepEqual(res.body.items, [])
})

test('6. Unread count and mark-all-as-read strictly isolate to authenticated customer', async () => {
  const fakeSupabase = createFakeSupabase({
    profiles: [
      { user_id: 'cust-101', role: 'customer', status: 'active' },
      { user_id: 'cust-victim', role: 'customer', status: 'active' },
    ],
    notifications: [
      { id: 'notif-1', user_id: 'cust-101', title: 'N1', is_read: false, created_at: '2026-11-20T10:00:00Z' },
      { id: 'notif-2', user_id: 'cust-101', title: 'N2', is_read: false, created_at: '2026-11-20T11:00:00Z' },
      { id: 'notif-v', user_id: 'cust-victim', title: 'NV', is_read: false, created_at: '2026-11-20T12:00:00Z' },
    ],
  })

  const authenticate = async () => ({ sub: 'cust-101', email: 'cust101@inferxe.com' })

  // 1. Check unread count
  const mockCount = createHttpMock({ method: 'GET', url: '/api/notifications/unread-count' })
  await handleCustomerApi(mockCount.req, mockCount.res, '/api/notifications/unread-count', {
    authenticate,
    supabase: fakeSupabase,
  })
  assert.equal(mockCount.res.statusCode, 200)
  assert.equal(mockCount.res.body.unread_count, 2)

  // 2. Mark all as read
  const mockReadAll = createHttpMock({ method: 'PATCH', url: '/api/notifications/read-all' })
  await handleCustomerApi(mockReadAll.req, mockReadAll.res, '/api/notifications/read-all', {
    authenticate,
    supabase: fakeSupabase,
  })
  assert.equal(mockReadAll.res.statusCode, 200)
  assert.equal(mockReadAll.res.body.updated_count, 2)

  // Cust-101 notifications are now is_read: true
  const n1 = fakeSupabase.store.notifications.find((n) => n.id === 'notif-1')
  const n2 = fakeSupabase.store.notifications.find((n) => n.id === 'notif-2')
  const nv = fakeSupabase.store.notifications.find((n) => n.id === 'notif-v')
  assert.equal(n1.is_read, true)
  assert.equal(n2.is_read, true)
  assert.equal(nv.is_read, false, 'Victim notification must stay untouched')
})

test('7. Notification insert error does NOT fail deployment creation (graceful degradation)', async () => {
  // Faulty Supabase client where notifications table rejects inserts
  const baseFake = createFakeSupabase({
    profiles: [{ user_id: 'cust-101', role: 'customer', status: 'active', organization_id: 'org-test' }],
  })

  const faultySupabase = {
    ...baseFake,
    from(table) {
      if (table === 'notifications') {
        return {
          insert() {
            return Promise.resolve({ data: null, error: { message: 'Database connection timeout on notifications table' } })
          },
        }
      }
      return baseFake.from(table)
    },
  }

  const authenticate = async () => ({ sub: 'cust-101', email: 'cust101@inferxe.com' })

  const { req, res } = createHttpMock({
    method: 'POST',
    url: '/api/customer/deployments',
    body: {
      name: 'resilient-endpoint',
      model_name: 'Llama 3 8B',
      gpu_model: 'NVIDIA RTX 4090',
      region: 'Delhi, IN',
      hourly_rate: 45,
      currency: 'INR',
    },
  })

  await handleCustomerApi(req, res, '/api/customer/deployments', {
    authenticate,
    supabase: faultySupabase,
  })

  // Deployment creation must still succeed with 201!
  assert.equal(res.statusCode, 201)
  assert.equal(res.body.ok, true)
  assert.ok(res.body.deployment.id)
  assert.equal(baseFake.store.deployments.length, 1)
})
