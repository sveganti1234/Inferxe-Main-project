import assert from 'node:assert/strict'
import test from 'node:test'
import { createAdminToken, verifyAdminToken } from '../adminAuth.js'
import { verifyCognitoIdToken } from '../customerAuth.js'

const adminSecret = 'test-only-admin-signing-secret-with-adequate-length'

test('admin tokens require a valid signature and admin role', () => {
  const now = Math.floor(Date.now() / 1000)
  const token = createAdminToken(
    { sub: 'usr_admin', email: 'admin@example.test', role: 'admin', iat: now, exp: now + 60 },
    adminSecret,
  )

  assert.equal(verifyAdminToken(token, adminSecret).valid, true)
  assert.equal(verifyAdminToken(token, `${adminSecret}-wrong`).valid, false)
  assert.equal(verifyAdminToken('ix-tok-forged', adminSecret).valid, false)
})

test('admin tokens require a valid expiry and admin role', () => {
  const now = Math.floor(Date.now() / 1000)
  const expired = createAdminToken(
    { sub: 'usr_admin', role: 'admin', iat: now - 120, exp: now - 1 },
    adminSecret,
  )
  const customer = createAdminToken(
    { sub: 'usr_customer', role: 'customer', iat: now, exp: now + 60 },
    adminSecret,
  )
  const noExpiry = createAdminToken({ sub: 'usr_admin', role: 'admin', iat: now }, adminSecret)

  assert.equal(verifyAdminToken(expired, adminSecret).valid, false)
  assert.equal(verifyAdminToken(customer, adminSecret).valid, false)
  assert.equal(verifyAdminToken(noExpiry, adminSecret).valid, false)
})

test('fake OAuth token formats are not accepted as Cognito credentials', async () => {
  for (const token of ['ix-gh-forged', 'ix-goog-forged', 'ix-tok-forged', 'ix-cust-forged']) {
    await assert.rejects(verifyCognitoIdToken(token))
  }
})
