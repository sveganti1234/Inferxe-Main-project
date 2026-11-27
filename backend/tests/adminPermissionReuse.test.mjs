import './support/networkGuard.mjs'  // test isolation guard: must stay the first import (tests/testSafety.test.mjs checks)
import assert from 'node:assert/strict'
import test from 'node:test'
import { checkAdminPermission, hasPermission } from '../auth/adminSessionStore.js'

// The session check already returns the role's permissions; the permission check must use them, not query again.
function countingClient(permissionRows) {
  const calls = { admin_role_permissions: 0, audit_logs: 0 }
  return {
    calls,
    from(table) {
      calls[table] = (calls[table] || 0) + 1
      const q = {
        select() { return q }, eq() { return q }, insert() { return q }, single() { return Promise.resolve({ data: {}, error: null }) },
        then(res, rej) { return Promise.resolve({ data: table === 'admin_role_permissions' ? permissionRows : [], error: null }).then(res, rej) },
      }
      return q
    },
  }
}

test('known permissions are used without another database read', async () => {
  const client = countingClient([{ permission_id: 'customers:view' }])
  assert.equal(await hasPermission('admin', 'customers:view', client, ['customers:view']), true)
  assert.equal(await hasPermission('admin', 'admins:manage', client, ['customers:view']), false)
  assert.equal(client.calls.admin_role_permissions, 0)
})

test('without known permissions the role is still looked up (unchanged behaviour)', async () => {
  const client = countingClient([{ permission_id: 'customers:view' }])
  assert.equal(await hasPermission('admin', 'customers:view', client), true)
  assert.equal(client.calls.admin_role_permissions, 1)
})

test('a denied check still fails closed and is audited when permissions are passed in', async () => {
  const client = countingClient([])
  const result = await checkAdminPermission(
    { role: 'admin', permissionId: 'admins:manage', permissions: ['customers:view'], actorAdmin: { id: 'a1', email: 'a@example.test' } },
    client,
  )
  assert.equal(result.ok, false)
  assert.equal(result.status, 403)
  assert.equal(client.calls.admin_role_permissions, 0)
  assert.ok(client.calls.audit_logs >= 1, 'the violation is still written to audit_logs')
})

test('superadmin and unknown roles are unaffected', async () => {
  const client = countingClient([])
  assert.equal(await hasPermission('superadmin', 'anything', client, []), true)
  assert.equal(await hasPermission('customer', 'customers:view', client, ['customers:view']), false)
})

test('role permissions are cached per client for a short time, not looked up on every admin request', async () => {
  const { getPermissionsForRole } = await import('../auth/adminSessionStore.js')
  const client = countingClient([{ permission_id: 'customers:view' }])
  const first = await getPermissionsForRole('admin', client)
  const second = await getPermissionsForRole('admin', client)
  assert.deepEqual([...first], ['customers:view'])
  assert.deepEqual([...second], ['customers:view'])
  assert.equal(client.calls.admin_role_permissions, 1, 'second lookup served from cache')
  second.add('mutated')
  assert.ok(!(await getPermissionsForRole('admin', client)).has('mutated'), 'callers get a copy')

  const realNow = Date.now
  Date.now = () => realNow() + 61_000
  try {
    await getPermissionsForRole('admin', client)
  } finally {
    Date.now = realNow
  }
  assert.equal(client.calls.admin_role_permissions, 2, 're-read after the TTL')

  const other = countingClient([])
  await getPermissionsForRole('admin', other)
  assert.equal(other.calls.admin_role_permissions, 1, 'another client never reads a foreign cache entry')
})
