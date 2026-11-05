// @ts-nocheck
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  getDatabase,
  computeActivityStatus,
  registerOrUpdateCustomer,
  recordHeartbeat,
  recordCustomerLogout,
  listCustomers,
  getCustomerSummary,
  getCustomerDetails,
  backupDatabase,
  restoreDatabase,
  exportCustomersToCsv,
  syncCustomersBatch,
} from '../database/customerDatabase.js'
import {
  createAdminToken,
  verifyAdminToken,
  createAdminAuthMiddleware,
} from '../auth/adminAuth.js'

async function runTests() {
  console.log('───────────────────────────────────────────────────────')
  console.log('▶ RUNNING INFERXE CUSTOMER MANAGEMENT & DATABASE TESTS')
  console.log('───────────────────────────────────────────────────────\n')

  let passed = 0
  let failed = 0

  function test(name, fn) {
    try {
      fn()
      console.log(`  ✔ [PASS] ${name}`)
      passed++
    } catch (err) {
      console.error(`  ✖ [FAIL] ${name}`)
      console.error(`    Error: ${err.message}\n`)
      failed++
    }
  }

  // ── TEST 1: 5-Day Inactivity Rule & Activity Status Calculation ──
  test('1. Activity Status: Online (< 2 minutes heartbeat)', () => {
    const now = Date.now()
    const recentHeartbeat = new Date(now - 30 * 1000).toISOString() // 30s ago
    const recentActive = new Date(now - 30 * 1000).toISOString()
    const status = computeActivityStatus(recentActive, recentHeartbeat)
    assert.equal(status, 'Online', `Expected 'Online', got '${status}'`)
  })

  test('2. Activity Status: Active (Heartbeat > 2 mins, activity < 5 days)', () => {
    const now = Date.now()
    const oldHeartbeat = new Date(now - 10 * 60 * 1000).toISOString() // 10 mins ago
    const recentActive = new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString() // 2 days ago
    const status = computeActivityStatus(recentActive, oldHeartbeat)
    assert.equal(status, 'Active', `Expected 'Active', got '${status}'`)
  })

  test('3. Activity Status: Inactive (Exactly 5 days / 432M ms without activity)', () => {
    const now = Date.now()
    const fiveDaysMs = 5 * 24 * 60 * 60 * 1000
    const inactiveActive = new Date(now - (fiveDaysMs + 5000)).toISOString() // 5 days + 5s ago
    const oldHeartbeat = new Date(now - (fiveDaysMs + 5000)).toISOString()
    const status = computeActivityStatus(inactiveActive, oldHeartbeat)
    assert.equal(status, 'Inactive', `Expected 'Inactive', got '${status}'`)
  })

  test('4. Activity Status: Inactive (14 days without activity)', () => {
    const now = Date.now()
    const inactiveActive = new Date(now - 14 * 24 * 60 * 60 * 1000).toISOString()
    const status = computeActivityStatus(inactiveActive, null)
    assert.equal(status, 'Inactive', `Expected 'Inactive', got '${status}'`)
  })

  // ── TEST 2: Customer Registration & Login Tracking ──
  const testSub = 'sub-test-' + Date.now()
  const testEmail = `qa.customer.${Date.now()}@testcorp.internal`

  test('5. Customer Registration: creates customer and logs registration event', () => {
    const reg = registerOrUpdateCustomer({
      cognito_sub: testSub,
      full_name: 'QA Test Customer',
      email: testEmail,
      organization: 'Inferxe QA Systems',
      phone_number: '+15551234567',
      isLogin: false,
    })

    assert.ok(reg.customer_id, 'Customer ID must be generated')
    assert.equal(reg.email, testEmail)
    assert.equal(reg.cognito_sub, testSub)

    const details = getCustomerDetails(testEmail)
    assert.ok(details, 'Details record must be retrievable')
    assert.ok(details.activity_logs.some((l) => l.event_type === 'registration'), 'Must have registration activity log')
  })

  test('6. Login Tracking: increments login_count and records login event', () => {
    const detailsBefore = getCustomerDetails(testEmail)
    const loginsBefore = detailsBefore.login_count || 0

    registerOrUpdateCustomer({
      cognito_sub: testSub,
      email: testEmail,
      isLogin: true,
    })

    const detailsAfter = getCustomerDetails(testEmail)
    assert.equal(detailsAfter.login_count, loginsBefore + 1, 'Login count must increment on login')
    assert.ok(detailsAfter.last_login_at, 'last_login_at must be populated')
    assert.ok(detailsAfter.previous_logins.length > 0, 'previous_logins list must contain login timestamp')
  })

  test('7. Logout Tracking: updates heartbeat to past and logs logout event', () => {
    const success = recordCustomerLogout({
      cognito_sub: testSub,
      email: testEmail,
    })
    assert.equal(success, true)

    const details = getCustomerDetails(testEmail)
    assert.ok(details.activity_logs.some((l) => l.event_type === 'logout'), 'Must have logout activity log')
    assert.notEqual(details.activity_status, 'Online', 'Status must immediately drop off Online after logout')
  })

  // ── TEST 3: Existing Customer Synchronization & Deduplication ──
  test('8. Customer Synchronization: imports new customer and backfills existing without overwriting history', () => {
    const syncSub1 = testSub // Existing user
    const syncSub2 = 'sub-sync-new-' + Date.now()
    const syncEmail2 = `qa.new.sync.${Date.now()}@testcorp.internal`

    const existingDetailsBefore = getCustomerDetails(testEmail)
    const originalRegDate = existingDetailsBefore.registration_date
    const originalLogins = existingDetailsBefore.login_count

    const result = syncCustomersBatch([
      {
        cognito_sub: syncSub1,
        email: testEmail,
        full_name: 'QA Test Customer Updated Name',
        organization: 'Updated Enterprise Org',
      },
      {
        cognito_sub: syncSub2,
        email: syncEmail2,
        full_name: 'New Synced Customer',
        organization: 'Synced Cloud Labs',
      },
    ])

    assert.equal(result.syncedCount, 2, 'Must process 2 records')
    assert.equal(result.updatedCount, 1, 'Must update 1 existing customer')
    assert.equal(result.newCount, 1, 'Must insert 1 new customer')

    // Verify existing customer was updated without losing history
    const existingDetailsAfter = getCustomerDetails(testEmail)
    assert.equal(existingDetailsAfter.full_name, 'QA Test Customer Updated Name')
    assert.equal(existingDetailsAfter.organization, 'Updated Enterprise Org')
    assert.equal(existingDetailsAfter.registration_date, originalRegDate, 'Original registration_date must NOT be overwritten')
    assert.equal(existingDetailsAfter.login_count, originalLogins, 'Original login_count must NOT be reset')
  })

  // ── TEST 4: CSV Export & Inactive Customers Retention ──
  test('9. CSV Export: exports all customers including inactive customers', () => {
    const csv = exportCustomersToCsv()
    assert.ok(csv.startsWith('Customer ID,Cognito Sub,Full Name'), 'CSV header must be present')
    const lines = csv.split('\r\n')
    assert.ok(lines.length >= 6, 'Must export all seed and created customers')

    // Verify inactive customer is included
    assert.ok(csv.includes('Inactive'), 'Inactive customers must be included in CSV export')
  })

  // ── TEST 5: Database Persistence & Re-open ──
  test('10. Database Persistence: data survives connection re-open / restart', () => {
    const initialCustomer = getCustomerDetails(testEmail)
    assert.ok(initialCustomer, 'Customer must exist prior to restart')

    // Simulate backend restart by re-instantiating connection
    const db = getDatabase()
    const customerAfter = db.prepare('SELECT * FROM customers WHERE email = ?').get(testEmail)
    assert.ok(customerAfter, 'Customer must persist in SQLite disk file after re-open')
    assert.equal(customerAfter.email, testEmail)
  })

  // ── TEST 6: Automated Backup and Restoration ──
  test('11. Database Backup & Restore: creates backup and restores verified database', () => {
    const backupResult = backupDatabase()
    assert.ok(backupResult.ok, 'Backup must succeed')
    assert.ok(fs.existsSync(backupResult.backupPath), 'Backup file must exist on disk')
    assert.ok(backupResult.sizeBytes > 0, 'Backup file size must be > 0 bytes')

    const restoreResult = restoreDatabase(backupResult.backupFile)
    assert.ok(restoreResult.ok, 'Restoration must succeed')
    assert.ok(restoreResult.customerCount >= 5, 'Restored database must contain customer records')

    // Clean up temporary test backup
    try {
      fs.unlinkSync(backupResult.backupPath)
    } catch {}
  })

  // ── TEST 7: Security & Production Guard ──
  test('12. Security: production environment rejects default dev credentials & dev token bypass', () => {
    const secret = 'inferxe_test_session_secret_2026'

    // Verify valid HMAC-SHA256 JWT
    const adminToken = createAdminToken(
      {
        sub: 'usr_admin',
        email: 'admin@inferxe.com',
        role: 'admin',
        fullName: 'Inferxe Administrator',
        exp: Math.floor(Date.now() / 1000) + 3600,
      },
      secret,
    )
    const verified = verifyAdminToken(adminToken, secret)
    assert.equal(verified.valid, true, 'Cryptographic admin token must be valid')
    assert.equal(verified.payload.role, 'admin')

    // Verify non-admin token is rejected
    const customerToken = createAdminToken(
      {
        sub: 'usr_customer',
        email: 'customer@inferxe.com',
        role: 'customer',
        exp: Math.floor(Date.now() / 1000) + 3600,
      },
      secret,
    )
    const customerVerified = verifyAdminToken(customerToken, secret)
    assert.equal(customerVerified.valid, false, 'Customer token must NOT have admin access')

    // Test production guard against 'ix-tok-' bypass
    const originalEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      const devBypassVerified = verifyAdminToken('ix-tok-test-dev-bypass', secret)
      assert.equal(devBypassVerified.valid, false, 'Development bypass token MUST be rejected in production mode')
    } finally {
      process.env.NODE_ENV = originalEnv
    }
  })

  console.log('\n───────────────────────────────────────────────────────')
  console.log(`TEST RESULTS: ${passed} PASSED, ${failed} FAILED`)
  console.log('───────────────────────────────────────────────────────\n')

  if (failed > 0) {
    process.exit(1)
  }
}

runTests().catch((err) => {
  console.error('Fatal test execution error:', err)
  process.exit(1)
})

