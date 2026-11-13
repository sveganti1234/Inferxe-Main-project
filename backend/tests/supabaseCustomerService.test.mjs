// @ts-nocheck
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  computeActivityStatus,
  formatCustomerRecord,
  getCustomerSummary,
  listCustomers,
  getCustomerDetails,
  exportCustomersToCsv,
  updateCustomerHeartbeat,
  recordCustomerLogout,
  upsertCustomerProfile,
  resolveCustomerUsername,
} from '../database/supabaseCustomerService.js'

test('1. computeActivityStatus calculates Online, Active, Inactive, and Suspended', () => {
  const now = Date.now()
  const recentSeen = new Date(now - 30 * 1000).toISOString() // 30s ago
  const activeSeen = new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString() // 2 days ago
  const inactiveSeen = new Date(now - 6 * 24 * 60 * 60 * 1000).toISOString() // 6 days ago

  assert.equal(computeActivityStatus(recentSeen, 'active'), 'Online')
  assert.equal(computeActivityStatus(activeSeen, 'active'), 'Active')
  assert.equal(computeActivityStatus(inactiveSeen, 'active'), 'Inactive')
  assert.equal(computeActivityStatus(recentSeen, 'suspended'), 'Suspended')
  assert.equal(computeActivityStatus(null, 'active'), 'Inactive')
})

test('2. formatCustomerRecord produces standard CustomerRecord contract', () => {
  const row = {
    user_id: 'sub-test-uuid-1234',
    full_name: 'Test Customer',
    email: 'test@inferxe.com',
    role: 'customer',
    status: 'active',
    last_active_at: new Date().toISOString(),
    created_at: '2026-11-01T10:00:00Z',
    updated_at: '2026-11-10T10:00:00Z',
  }

  const formatted = formatCustomerRecord(row)
  assert.equal(formatted.cognito_sub, 'sub-test-uuid-1234')
  assert.equal(formatted.full_name, 'Test Customer')
  assert.equal(formatted.email, 'test@inferxe.com')
  assert.equal(formatted.account_status, 'active')
  assert.equal(formatted.activity_status, 'Online')
  assert.ok(formatted.customer_id.startsWith('cst_'))
})

test('3. getCustomerSummary returns real statistics from Supabase', async () => {
  const summary = await getCustomerSummary()
  assert.ok(typeof summary.total === 'number')
  assert.ok(summary.total > 0, 'Must have existing customer profiles in Supabase')
  assert.ok(typeof summary.online === 'number')
  assert.ok(typeof summary.active === 'number')
  assert.ok(typeof summary.inactive === 'number')
  assert.ok(summary.active <= summary.total)
})

test('4. listCustomers returns paginated customers with search and filters', async () => {
  const result = await listCustomers({ page: 1, limit: 5 })
  assert.equal(result.ok, true)
  assert.ok(Array.isArray(result.customers))
  assert.ok(result.customers.length <= 5)
  assert.ok(result.pagination.total > 0)
  assert.ok(result.pagination.totalPages >= 1)

  // Verify search
  if (result.customers[0]) {
    const firstEmail = result.customers[0].email
    const searchRes = await listCustomers({ search: firstEmail })
    assert.ok(searchRes.customers.some((c) => c.email === firstEmail))
  }
})

test('5. exportCustomersToCsv generates valid CSV with RFC 4180 headers', async () => {
  const csv = await exportCustomersToCsv()
  assert.ok(csv.startsWith('Customer ID,Cognito Sub,Full Name,Email'))
  const lines = csv.split('\r\n')
  assert.ok(lines.length >= 2, 'CSV must contain header and data rows')
})

test('6. getCustomerDetails returns full profile and activity logs', async () => {
  const list = await listCustomers({ limit: 1 })
  assert.ok(list.customers.length > 0)
  const targetSub = list.customers[0].cognito_sub

  const details = await getCustomerDetails(targetSub)
  assert.ok(details)
  assert.equal(details.cognito_sub, targetSub)
  assert.ok(Array.isArray(details.activity_logs))
  assert.ok(details.activity_logs.length >= 1)
})

test('7. updateCustomerHeartbeat and recordCustomerLogout update isolated test profile', async () => {
  const testSub = 'sub-test-heartbeat-isolated-2026'
  const testEmail = 'heartbeat.isolated.test@inferxe.com'
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  // 1. Create isolated test profile
  await upsertCustomerProfile({
    cognito_sub: testSub,
    full_name: 'Heartbeat Test User',
    email: testEmail,
    isLogin: false,
  })

  try {
    // 2. Test heartbeat
    const ok = await updateCustomerHeartbeat({ cognito_sub: testSub })
    assert.equal(ok, true)

    // 3. Verify status becomes Online
    const details = await getCustomerDetails(testSub)
    assert.equal(details.activity_status, 'Online')

    // 4. Test logout
    const logoutOk = await recordCustomerLogout({ cognito_sub: testSub })
    assert.equal(logoutOk, true)

    // 5. Verify status is no longer Online after logout (transitions to Active since < 5 days)
    const postLogout = await getCustomerDetails(testSub)
    assert.notEqual(postLogout.activity_status, 'Online', 'After logout, status must no longer be Online')
    assert.equal(postLogout.activity_status, 'Active', 'Recent logout within 5 days is categorized as Active')
  } finally {
    // Clean up test profile so production database remains untouched
    await fetch(`${url}/rest/v1/profiles?user_id=eq.${encodeURIComponent(testSub)}`, {
      method: 'DELETE',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
    })
  }
})

test('8. upsertCustomerProfile correctly increments login_count from 0 to 1', async () => {
  const testSub = 'sub-test-login-count-isolated-2026'
  const testEmail = 'login.count.isolated@inferxe.com'
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  try {
    // Step 1: Initial registration without login (login_count = 0)
    const initialReg = await upsertCustomerProfile({
      cognito_sub: testSub,
      full_name: 'Login Count Test Customer',
      email: testEmail,
      isLogin: false,
    })
    assert.equal(initialReg.login_count, 0, 'New registration without login must have login_count = 0')

    // Step 2: First login (0 must increment to 1)
    const firstLogin = await upsertCustomerProfile({
      cognito_sub: testSub,
      full_name: 'Login Count Test Customer',
      email: testEmail,
      isLogin: true,
    })
    assert.equal(firstLogin.login_count, 1, 'First login must increment login_count from 0 to 1')
    assert.ok(firstLogin.last_login_at, 'First login must set last_login_at')

    // Step 3: Second login (1 must increment to 2)
    const secondLogin = await upsertCustomerProfile({
      cognito_sub: testSub,
      full_name: 'Login Count Test Customer',
      email: testEmail,
      isLogin: true,
    })
    assert.equal(secondLogin.login_count, 2, 'Second login must increment login_count from 1 to 2')

    // Verify duplicate rows are never created
    const searchResult = await listCustomers({ search: testEmail })
    const matching = searchResult.customers.filter((c) => c.cognito_sub === testSub)
    assert.equal(matching.length, 1, 'Repeated logins must NEVER create duplicate records')
  } finally {
    // Clean up test profile so production database remains untouched
    await fetch(`${url}/rest/v1/profiles?user_id=eq.${encodeURIComponent(testSub)}`, {
      method: 'DELETE',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
    })
  }
})

test('9. resolveCustomerUsername preserves friendly username against Cognito internal machine usernames', async () => {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  // Part A: Pure function unit assertions
  // 1. Claims with machine cognito:username must NOT override existing friendly username
  const name1 = resolveCustomerUsername({
    existingProfile: { username: 'Durga sri Anajna Devi chenchani' },
    claims: { 'cognito:username': 'user_1dfdc3885d58ff62' },
    email: 'chenchanianjana@gmail.com',
    fullName: 'Durga sri Anajna Devi chenchani',
  })
  assert.equal(name1, 'Durga sri Anajna Devi chenchani', 'Must preserve existing friendly username')

  // 2. Explicit genuine preferred_username is honored
  const name2 = resolveCustomerUsername({
    existingProfile: { username: 'old_username' },
    claims: { preferred_username: 'custom_preferred_handle' },
    email: 'user@example.com',
  })
  assert.equal(name2, 'custom_preferred_handle', 'Explicit genuine preferred_username must be used')

  // 3. Machine preferred_username is rejected in favor of existing username
  const name3 = resolveCustomerUsername({
    existingProfile: { username: 'friendly_user' },
    claims: { preferred_username: 'user_1dfdc3885d58ff62' },
    email: 'user@example.com',
  })
  assert.equal(name3, 'friendly_user', 'Machine preferred_username must be rejected in favor of existing username')

  // 4. New account with fullName fallback
  const name4 = resolveCustomerUsername({
    existingProfile: null,
    claims: { 'cognito:username': 'user_aabbccddeeff0011' },
    email: 'newbie@example.com',
    fullName: 'New User FullName',
  })
  assert.equal(name4, 'New User FullName', 'New account must fallback to full name before email prefix')

  // 5. New account without fullName falls back to email prefix
  const name5 = resolveCustomerUsername({
    existingProfile: null,
    claims: { 'cognito:username': 'user_aabbccddeeff0011' },
    email: 'john.smith@inferxe.com',
  })
  assert.equal(name5, 'john.smith', 'New account without fullName must fallback to email prefix')

  // Part B: Integration test with isolated profile in Supabase
  const testSub = 'sub-test-username-regression-2026'
  const testEmail = 'username.regression@inferxe.com'
  const friendlyName = 'Original Friendly Username'

  try {
    // 1. Initial registration establishes friendly username
    await upsertCustomerProfile({
      cognito_sub: testSub,
      full_name: friendlyName,
      email: testEmail,
      isLogin: false,
    })

    // Verify initial profile in database
    const initialCheck = await fetch(`${url}/rest/v1/profiles?user_id=eq.${encodeURIComponent(testSub)}&select=*`, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
    }).then((r) => r.json())
    assert.equal(initialCheck[0].username, friendlyName)

    // 2. Subsequent login with Cognito token containing machine-generated 'cognito:username'
    await upsertCustomerProfile({
      cognito_sub: testSub,
      full_name: friendlyName,
      email: testEmail,
      isLogin: true,
      claims: {
        'cognito:username': 'user_99887766554433221100',
        sub: testSub,
        email: testEmail,
      },
    })

    // Verify that the friendly username was NOT overwritten
    const postLoginCheck = await fetch(`${url}/rest/v1/profiles?user_id=eq.${encodeURIComponent(testSub)}&select=*`, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
    }).then((r) => r.json())
    assert.equal(
      postLoginCheck[0].username,
      friendlyName,
      'Cognito machine username must NEVER overwrite an existing friendly username'
    )
    assert.notEqual(
      postLoginCheck[0].username,
      'user_99887766554433221100',
      'Cognito machine username must not be stored as username'
    )
  } finally {
    // Cleanup isolated test profile
    await fetch(`${url}/rest/v1/profiles?user_id=eq.${encodeURIComponent(testSub)}`, {
      method: 'DELETE',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
    })
  }
})
