// @ts-nocheck
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  computeActivityStatus,
  formatCustomerRecord,
  registerCustomerSession,
  removeCustomerSession,
  hasOtherActiveSessions,
} from '../database/supabaseCustomerService.js'
import {
  recordSessionHeartbeat,
  removeSession,
  hasOtherActiveSessionsDb,
  computeActivityStatus as computeActivityStatusSqlite,
} from '../database/customerDatabase.js'

test('1. Durga sri Anajna Devi chenchani case: Registered Nov 10, never logged in, migration last_seen is Inactive', () => {
  const chenchaniProfile = {
    user_id: 'sub-chenchani-anjana-uuid',
    full_name: 'Durga sri Anajna Devi chenchani',
    email: 'chenchanianjana@gmail.com',
    role: 'customer',
    status: 'active',
    last_active_at: null,
    last_login_at: null,
    last_seen_at: '2026-11-11T09:03:02.445584+00:00', // Migration timestamp, NOT genuine customer activity
    created_at: '2026-11-10T09:33:32.059012+00:00',
    updated_at: '2026-11-12T11:27:09.036308+00:00',
    login_count: 0,
  }

  const formatted = formatCustomerRecord(chenchaniProfile)
  assert.equal(formatted.activity_status, 'Inactive', 'Customer who never logged in or had active session must be Inactive')
  assert.equal(formatted.last_login_at, null, 'Must show null so ledger renders Never')
  assert.equal(formatted.last_active_at, null, 'Must show null so ledger renders No activity recorded')
  assert.equal(formatted.last_heartbeat_at, null, 'Must not report migration timestamp as heartbeat')
  assert.equal(formatted.login_count, 0, 'Login count must be 0')
  assert.equal(formatted.registration_date, '2026-11-10T09:33:32.059012+00:00', 'Registration date must be preserved')
})

test('2. Scenario 1: Newly registered customer who has never logged in -> Inactive', () => {
  const newProfile = {
    user_id: 'sub-newly-registered-user',
    full_name: 'Brand New Customer',
    email: 'newuser@example.com',
    role: 'customer',
    status: 'active',
    last_active_at: null,
    last_login_at: null,
    last_seen_at: null,
    created_at: new Date().toISOString(),
    login_count: 0,
  }

  const formatted = formatCustomerRecord(newProfile)
  assert.equal(formatted.activity_status, 'Inactive', 'Newly registered without login must be Inactive')
})

test('3. Scenario 2: Customer who logged in just now and has an active heartbeat -> Online', () => {
  const now = Date.now()
  const onlineProfile = {
    user_id: 'sub-online-active-user',
    full_name: 'Online Active Customer',
    email: 'online@inferxe.com',
    role: 'customer',
    status: 'active',
    last_active_at: new Date(now - 20 * 1000).toISOString(),
    last_login_at: new Date(now - 10 * 60 * 1000).toISOString(),
    last_seen_at: new Date(now - 20 * 1000).toISOString(), // 20s ago <= 120s
    created_at: '2026-11-01T10:00:00Z',
    login_count: 1,
  }

  const formatted = formatCustomerRecord(onlineProfile)
  assert.equal(formatted.activity_status, 'Online', 'Heartbeat within 120s must be Online')
})

test('4. Scenario 3: Customer who logged in 10 minutes ago but has no heartbeat -> Active', () => {
  const now = Date.now()
  const activeProfile = {
    user_id: 'sub-active-user-no-hb',
    full_name: 'Active Customer',
    email: 'active@inferxe.com',
    role: 'customer',
    status: 'active',
    last_active_at: new Date(now - 10 * 60 * 1000).toISOString(), // 10 minutes ago
    last_login_at: new Date(now - 10 * 60 * 1000).toISOString(),
    last_seen_at: new Date(now - 10 * 60 * 1000).toISOString(), // 10m ago > 120s -> Not Online
    created_at: '2026-11-01T10:00:00Z',
    login_count: 1,
  }

  const formatted = formatCustomerRecord(activeProfile)
  assert.equal(formatted.activity_status, 'Active', 'Login/activity 10 mins ago without heartbeat must be Active')
})

test('5. Scenario 4: Customer whose last genuine activity was 6 days ago -> Inactive', () => {
  const now = Date.now()
  const oldActiveProfile = {
    user_id: 'sub-old-active-user',
    full_name: 'Old Active Customer',
    email: 'oldactive@inferxe.com',
    role: 'customer',
    status: 'active',
    last_active_at: new Date(now - 6 * 24 * 60 * 60 * 1000).toISOString(), // 6 days ago
    last_login_at: new Date(now - 6 * 24 * 60 * 60 * 1000).toISOString(),
    last_seen_at: new Date(now - 6 * 24 * 60 * 60 * 1000).toISOString(),
    created_at: '2026-10-01T10:00:00Z',
    login_count: 3,
  }

  const formatted = formatCustomerRecord(oldActiveProfile)
  assert.equal(formatted.activity_status, 'Inactive', 'Activity > 5 days ago must be Inactive')
})

test('6. Scenario 5: Customer whose registration was yesterday but has never logged in -> Inactive', () => {
  const now = Date.now()
  const yesterdayRegisteredProfile = {
    user_id: 'sub-yesterday-registered',
    full_name: 'Yesterday Registered',
    email: 'yesterday@example.com',
    role: 'customer',
    status: 'active',
    last_active_at: null,
    last_login_at: null,
    last_seen_at: null,
    created_at: new Date(now - 24 * 60 * 60 * 1000).toISOString(), // Yesterday
    login_count: 0,
  }

  const formatted = formatCustomerRecord(yesterdayRegisteredProfile)
  assert.equal(formatted.activity_status, 'Inactive', 'Registered yesterday with no login must be Inactive')
  assert.equal(formatted.last_active_at, null)
})

test('7. Scenario 6: Customer with null last_active_at but a genuine recent last_login_at -> Active', () => {
  const now = Date.now()
  const loginOnlyProfile = {
    user_id: 'sub-login-only-user',
    full_name: 'Login Only Customer',
    email: 'loginonly@inferxe.com',
    role: 'customer',
    status: 'active',
    last_active_at: null,
    last_login_at: new Date(now - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago
    last_seen_at: null,
    created_at: '2026-11-01T10:00:00Z',
    login_count: 1,
  }

  const formatted = formatCustomerRecord(loginOnlyProfile)
  assert.equal(formatted.activity_status, 'Active', 'Recent last_login_at within 5 days must be Active')
})

test('8. Scenario 7: Multi-session and server restart resilience: another active session keeps customer Online after restart', () => {
  const sub = 'sub-test-multisession-restart'
  const email = 'multisession@inferxe.com'
  const session1 = 'sess_device_laptop_123'
  const session2 = 'sess_device_phone_456'

  // Register session 1 and session 2 in SQLite
  recordSessionHeartbeat({ session_id: session1, cognito_sub: sub, email })
  recordSessionHeartbeat({ session_id: session2, cognito_sub: sub, email })

  // Verify SQLite tracks both sessions
  assert.equal(
    hasOtherActiveSessionsDb({ cognito_sub: sub, email, excluded_session_id: session1, windowMs: 120000 }),
    true,
    'Session 2 must be detected as active when Session 1 is excluded'
  )

  // SIMULATE SERVER RESTART:
  // In-memory sessions are NOT present for this sub.
  // When Session 1 logs out, check if Session 2 keeps customer Online
  const hasOther = hasOtherActiveSessions(sub, session1)
  assert.equal(hasOther, true, 'Persistent session check must find Session 2 active after server restart')

  // Remove Session 1
  removeSession({ session_id: session1 })

  // Session 2 is still active
  const hasOtherAfterSession1Removed = hasOtherActiveSessions(sub, null)
  assert.equal(hasOtherAfterSession1Removed, true, 'Customer still has active Session 2')

  // Remove Session 2 (explicit logout from last device)
  removeSession({ session_id: session2 })

  // Now no sessions remain
  const hasOtherAfterAllRemoved = hasOtherActiveSessions(sub, null)
  assert.equal(hasOtherAfterAllRemoved, false, 'No sessions remain after both devices log out')
})

test('9. Scenario 8: Expired sessions (> 120s) must not remain Online or keep customer Online', () => {
  const sub = 'sub-test-expired-session'
  const email = 'expired@inferxe.com'
  const expiredSession = 'sess_expired_device_999'

  // Register session with timestamp 3 minutes ago
  const threeMinutesAgoIso = new Date(Date.now() - 3 * 60 * 1000).toISOString()
  recordSessionHeartbeat({ session_id: expiredSession, cognito_sub: sub, email, last_seen_at: threeMinutesAgoIso })

  // Check with standard 120s window
  const isStillOnline = hasOtherActiveSessionsDb({
    cognito_sub: sub,
    email,
    excluded_session_id: null,
    windowMs: 120000,
  })

  assert.equal(isStillOnline, false, 'Expired session must not be considered active')

  // Cleanup
  removeSession({ session_id: expiredSession })
})
