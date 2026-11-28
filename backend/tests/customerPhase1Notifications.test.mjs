// @ts-nocheck
import './support/networkGuard.mjs' // test isolation guard: must stay the first import (tests/testSafety.test.mjs checks)
import assert from 'node:assert/strict'
import test from 'node:test'
import { handleCustomerApi, createSupabaseApiMiddleware } from '../api/supabaseApi.js'
import { handleAdminCustomerApi } from '../api/adminCustomersApi.js'

function createFakeSupabase(initialStore = {}) {
  const store = {
    deployments: initialStore.deployments ? [...initialStore.deployments] : [],
    notifications: initialStore.notifications ? [...initialStore.notifications] : [],
    profiles: initialStore.profiles ? [...initialStore.profiles] : [],
    organization_members: initialStore.organization_members ? [...initialStore.organization_members] : [],
    organizations: initialStore.organizations ? [...initialStore.organizations] : [],
    ssh_public_keys: initialStore.ssh_public_keys ? [...initialStore.ssh_public_keys] : [],
    api_keys: initialStore.api_keys ? [...initialStore.api_keys] : [],
    user_access_policies: initialStore.user_access_policies ? [...initialStore.user_access_policies] : [],
    audit_logs: initialStore.audit_logs ? [...initialStore.audit_logs] : [],
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
          order() {
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
        const inserted = records.map((r) => ({
          id: r.id || `rec-${Math.random().toString(36).slice(2, 9)}`,
          created_at: new Date().toISOString(),
          ...r,
        }))
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
              single: () => updateObj.then((res) => ({ data: res.data?.[0] || null, error: res.error })),
              maybeSingle: () => updateObj.then((res) => ({ data: res.data?.[0] || null, error: res.error })),
              then: (resolve) => updateObj.then(resolve),
            }
          },
          then(resolve) {
            let matched = []
            for (const row of store[table]) {
              const match = filters.every((f) => row[f.field] === f.val)
              if (match) {
                Object.assign(row, updateData)
                matched.push({ ...row })
              }
            }
            return Promise.resolve({ data: matched, error: null }).then(resolve)
          },
        }
        return updateObj
      },
      delete() {
        let filters = []
        const delObj = {
          eq(field, val) {
            filters.push({ field, val })
            return delObj
          },
          select() {
            return {
              single: () => delObj.then((res) => ({ data: res.data?.[0] || null, error: res.error })),
              maybeSingle: () => delObj.then((res) => ({ data: res.data?.[0] || null, error: res.error })),
              then: (resolve) => delObj.then(resolve),
            }
          },
          then(resolve) {
            let deleted = []
            store[table] = store[table].filter((row) => {
              const match = filters.every((f) => row[f.field] === f.val)
              if (match) deleted.push(row)
              return !match
            })
            return Promise.resolve({ data: deleted, error: null }).then(resolve)
          },
        }
        return delObj
      },
    }
  }

  function rpc(fn, args) {
    if (fn === 'admin_set_customer_plan') {
      const { p_user_id, p_tier } = args
      return Promise.resolve({
        data: { tier: p_tier, updated_at: new Date().toISOString() },
        error: null,
      })
    }
    return Promise.resolve({ data: null, error: { message: `Unknown RPC ${fn}` } })
  }

  return { store, from, rpc }
}

function createHttpMock({ method = 'GET', url = '/', body = null, headers = {} } = {}) {
  const req = {
    method,
    url,
    headers: {
      authorization: 'Bearer fake-jwt-token',
      ...headers,
    },
    [Symbol.asyncIterator]: async function* () {
      if (body) {
        yield Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))
      }
    },
  }

  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(key, value) {
      this.headers[key] = value
    },
    end(chunk) {
      if (chunk) {
        try {
          this.body = JSON.parse(chunk.toString())
        } catch {
          this.body = chunk.toString()
        }
      }
    },
  }

  return { req, res }
}

test('1. GPU deployment failure triggers GPU_DEPLOYMENT_FAILED notification', async () => {
  const fakeSupabase = createFakeSupabase({
    profiles: [{ user_id: 'cust-101', role: 'customer', status: 'active', organization_id: 'org-test' }],
    deployments: [
      {
        id: 'dep-fail-1',
        user_id: 'cust-101',
        name: 'failing-llama',
        gpu_model: 'NVIDIA H100',
        region: 'Mumbai, IN',
        status: 'provisioning',
      },
    ],
  })

  const authenticate = async () => ({ sub: 'cust-101', email: 'cust101@inferxe.com' })

  const { req, res } = createHttpMock({
    method: 'PATCH',
    url: '/api/customer/deployments/dep-fail-1',
    body: { status: 'failed' },
  })

  await handleCustomerApi(req, res, '/api/customer/deployments/dep-fail-1', {
    authenticate,
    supabase: fakeSupabase,
  })

  assert.equal(res.statusCode, 200)
  assert.equal(res.body.ok, true)
  assert.equal(res.body.deployment.status, 'failed')

  const notifs = fakeSupabase.store.notifications.filter((n) => n.user_id === 'cust-101')
  assert.equal(notifs.length, 1)
  assert.equal(notifs[0].title, 'GPU Deployment Failed')
  assert.equal(notifs[0].notification_type, 'GPU_DEPLOYMENT_FAILED')
  assert.ok(notifs[0].detail.includes('failing-llama'))
  assert.equal(notifs[0].related_entity_id, 'dep-fail-1')
})

test('2. API Key creation generates notification without exposing the secret', async () => {
  const fakeSupabase = createFakeSupabase({
    profiles: [{ user_id: 'cust-101', role: 'customer', status: 'active', organization_id: 'org-test' }],
  })

  const authenticate = async () => ({ sub: 'cust-101', email: 'cust101@inferxe.com' })

  const { req, res } = createHttpMock({
    method: 'POST',
    url: '/api/customer/api-keys',
    body: { name: 'Production Inference Key' },
  })

  await handleCustomerApi(req, res, '/api/customer/api-keys', {
    authenticate,
    supabase: fakeSupabase,
  })

  assert.equal(res.statusCode, 201)
  assert.equal(res.body.ok, true)
  assert.ok(res.body.secret) // secret returned to caller once

  const notifs = fakeSupabase.store.notifications.filter((n) => n.user_id === 'cust-101')
  assert.equal(notifs.length, 1)
  assert.equal(notifs[0].title, 'API Key Created')
  assert.equal(notifs[0].notification_type, 'SECURITY_KEY')
  assert.ok(notifs[0].detail.includes('Production Inference Key'))
  assert.ok(notifs[0].detail.includes('ix_live_'))
  // Critical security check: secret must NEVER appear in the notification detail, message, or metadata
  assert.equal(notifs[0].detail.includes(res.body.secret), false)
  assert.equal(notifs[0].message?.includes(res.body.secret), false)
  assert.equal(notifs[0].metadata?.includes(res.body.secret), false)
})

test('3. API Key revocation generates notification for the owner', async () => {
  const fakeSupabase = createFakeSupabase({
    profiles: [{ user_id: 'cust-101', role: 'customer', status: 'active', organization_id: 'org-test' }],
    api_keys: [
      { id: 'key-123', user_id: 'cust-101', name: 'Legacy Key', status: 'active' },
    ],
  })

  const authenticate = async () => ({ sub: 'cust-101', email: 'cust101@inferxe.com' })

  const { req, res } = createHttpMock({
    method: 'POST',
    url: '/api/customer/api-keys/key-123/revoke',
  })

  await handleCustomerApi(req, res, '/api/customer/api-keys/key-123/revoke', {
    authenticate,
    supabase: fakeSupabase,
  })

  assert.equal(res.statusCode, 200)
  assert.equal(res.body.ok, true)

  const notifs = fakeSupabase.store.notifications.filter((n) => n.user_id === 'cust-101')
  assert.equal(notifs.length, 1)
  assert.equal(notifs[0].title, 'API Key Revoked')
  assert.equal(notifs[0].notification_type, 'SECURITY_KEY')
  assert.ok(notifs[0].detail.includes('Legacy Key'))
})

test('4. SSH Key addition and deletion generate security notifications', async () => {
  const fakeSupabase = createFakeSupabase({
    profiles: [{ user_id: 'cust-101', role: 'customer', status: 'active', organization_id: 'org-test' }],
  })

  const authenticate = async () => ({ sub: 'cust-101', email: 'cust101@inferxe.com' })

  // Valid ED25519 public key
  const validSshKey = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIK710vUq8P3Bq1tF3i6N0vM3k4a5b6c7d8e9f0g1h2i3 user@dev'

  // A) Add SSH Key
  const { req: addReq, res: addRes } = createHttpMock({
    method: 'POST',
    url: '/api/customer/ssh-keys',
    body: { name: 'MacBook Pro SSH Key', public_key: validSshKey },
  })

  await handleCustomerApi(addReq, addRes, '/api/customer/ssh-keys', {
    authenticate,
    supabase: fakeSupabase,
  })

  assert.equal(addRes.statusCode, 201)
  assert.equal(addRes.body.ok, true)
  const sshKeyId = addRes.body.ssh_key.id

  let notifs = fakeSupabase.store.notifications.filter((n) => n.user_id === 'cust-101')
  assert.equal(notifs.length, 1)
  assert.equal(notifs[0].title, 'SSH Key Added')
  assert.equal(notifs[0].notification_type, 'SECURITY_KEY')
  assert.ok(notifs[0].detail.includes('MacBook Pro SSH Key'))

  // B) Delete SSH Key
  const { req: delReq, res: delRes } = createHttpMock({
    method: 'DELETE',
    url: `/api/customer/ssh-keys/${sshKeyId}`,
  })

  await handleCustomerApi(delReq, delRes, `/api/customer/ssh-keys/${sshKeyId}`, {
    authenticate,
    supabase: fakeSupabase,
  })

  assert.equal(delRes.statusCode, 200)
  assert.equal(delRes.body.ok, true)

  notifs = fakeSupabase.store.notifications.filter((n) => n.user_id === 'cust-101')
  assert.equal(notifs.length, 2)
  const delNotif = notifs.find((n) => n.title === 'SSH Key Deleted')
  assert.ok(delNotif)
  assert.equal(delNotif.notification_type, 'SECURITY_KEY')
  assert.ok(delNotif.detail.includes('MacBook Pro SSH Key'))
})

test('5. Admin plan update notifies target customer with tier details', async () => {
  const fakeSupabase = createFakeSupabase({
    profiles: [{ user_id: 'cust-101', role: 'customer', status: 'active' }],
  })

  const { req, res } = createHttpMock({
    method: 'PUT',
    url: '/api/admin/customers/cust-101/plan',
    body: {
      tier: 'Enterprise Dedicated',
      reason: 'Upgraded to enterprise SLA per annual contract',
    },
  })

  await handleAdminCustomerApi(req, res, '/api/admin/customers/cust-101/plan', {
    supabase: fakeSupabase,
    admin: { email: 'admin@inferxe.com', sub: 'admin-uuid' },
  })

  assert.equal(res.statusCode, 200)
  assert.equal(res.body.ok, true)

  const notifs = fakeSupabase.store.notifications.filter((n) => n.user_id === 'cust-101')
  assert.equal(notifs.length, 1)
  assert.equal(notifs[0].title, 'Subscription Plan Updated')
  assert.equal(notifs[0].notification_type, 'PLAN_UPDATE')
  assert.ok(notifs[0].detail.includes('Enterprise Dedicated'))
})

test('6. Strict recipient isolation: Customer B never sees Customer A notifications', async () => {
  const fakeSupabase = createFakeSupabase({
    profiles: [
      { user_id: 'cust-a', role: 'customer', status: 'active' },
      { user_id: 'cust-b', role: 'customer', status: 'active' },
    ],
    notifications: [
      { id: 'notif-a1', user_id: 'cust-a', title: 'API Key Created', detail: 'Secret info for A', notification_type: 'SECURITY_KEY', is_read: false },
      { id: 'notif-a2', user_id: 'cust-a', title: 'GPU Deployment Failed', detail: 'Fail for A', notification_type: 'GPU_DEPLOYMENT_FAILED', is_read: false },
      { id: 'notif-b1', user_id: 'cust-b', title: 'SSH Key Added', detail: 'Key for B', notification_type: 'SECURITY_KEY', is_read: false },
    ],
  })

  // Customer B fetches notifications
  const authenticateB = async () => ({ sub: 'cust-b', email: 'custB@inferxe.com' })
  const { req, res } = createHttpMock({
    method: 'GET',
    url: '/api/notifications',
  })

  await handleCustomerApi(req, res, '/api/notifications', {
    authenticate: authenticateB,
    supabase: fakeSupabase,
  })

  assert.equal(res.statusCode, 200)
  assert.equal(res.body.items.length, 1)
  assert.equal(res.body.items[0].id, 'notif-b1')
  assert.equal(res.body.items.some((n) => n.user_id === 'cust-a'), false)
  assert.equal(res.body.unread_count, 1)
})
