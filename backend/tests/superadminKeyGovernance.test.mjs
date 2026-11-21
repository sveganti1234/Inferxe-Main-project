import './support/networkGuard.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import crypto from 'node:crypto'
import { Readable } from 'node:stream'
import { EventEmitter } from 'node:events'
import { createAdminAuthMiddleware } from '../auth/adminAuth.js'
import { hashPassword } from '../auth/adminPassword.js'

const SUPERADMIN_ID = 'd9a494cb-1e8d-4bca-8142-19687fa9138b'
const SUPERADMIN_EMAIL = 'bhumireddy@inferxe.com'
const SUPERADMIN_PASSWORD = 'SuperAdmin#Existing2026!'

const ADMIN_ID = 'e1a2b3c4-1e8d-4bca-8142-19687fa9138c'
const ADMIN_EMAIL = 'admin@inferxe.com'
const ADMIN_PASSWORD = 'AdminUser#2026Password!'

function getDefaultAdminUsers() {
  return [
    {
      id: SUPERADMIN_ID,
      email: SUPERADMIN_EMAIL,
      password_hash: hashPassword(SUPERADMIN_PASSWORD, { memory: 1024, passes: 2, parallelism: 1 }),
      role: 'superadmin',
      is_active: true,
      session_version: 1,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      last_login: null,
    },
    {
      id: ADMIN_ID,
      email: ADMIN_EMAIL,
      password_hash: hashPassword(ADMIN_PASSWORD, { memory: 1024, passes: 2, parallelism: 1 }),
      role: 'admin',
      is_active: true,
      session_version: 1,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      last_login: null,
    },
  ]
}

function dispatchRequest(middleware, { method = 'GET', url = '/', headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const bodyStr = body === null ? '' : typeof body === 'string' ? body : JSON.stringify(body)
    let sent = false
    const req = new Readable({
      read() {
        if (!sent) {
          sent = true
          if (bodyStr) this.push(Buffer.from(bodyStr))
          this.push(null)
        }
      },
    })
    req.method = method
    req.url = url
    req.headers = { ...headers }
    if (bodyStr) {
      req.headers['content-length'] = Buffer.byteLength(bodyStr).toString()
    }
    req.socket = { remoteAddress: '127.0.0.1' }

    let statusCode = 200
    const resHeaders = {}
    let responseData = ''

    const res = new EventEmitter()
    res.setHeader = (key, val) => {
      resHeaders[key.toLowerCase()] = val
    }
    res.getHeader = (key) => resHeaders[key.toLowerCase()]
    res.writeHead = (code, hdrs) => {
      statusCode = code
      if (hdrs) {
        Object.entries(hdrs).forEach(([k, v]) => {
          resHeaders[k.toLowerCase()] = v
        })
      }
    }
    Object.defineProperty(res, 'statusCode', {
      get() {
        return statusCode
      },
      set(code) {
        statusCode = code
      },
    })
    res.write = (chunk) => {
      if (chunk) responseData += chunk.toString()
      return true
    }
    res.end = (chunk) => {
      if (chunk) responseData += chunk.toString()
      let parsed = responseData
      try {
        parsed = responseData ? JSON.parse(responseData) : {}
      } catch {}
      resolve({ status: statusCode, headers: resHeaders, body: parsed })
    }

    try {
      Promise.resolve(
        middleware(req, res, () => {
          res.statusCode = 404
          res.end(JSON.stringify({ ok: false, error: 'Not found' }))
        }),
      ).catch(reject)
    } catch (err) {
      reject(err)
    }
  })
}

/**
 * In-memory Supabase PostgREST query simulator that strictly enforces
 * column selection checks and real row mutations/deletions.
 */
function createFakeSupabaseClient(initialState = {}, options = {}) {
  const tables = {
    api_keys: structuredClone(initialState.api_keys || []),
    ssh_public_keys: structuredClone(initialState.ssh_public_keys || []),
    profiles: structuredClone(initialState.profiles || []),
    inference_requests: structuredClone(initialState.inference_requests || []),
    notebook_sessions: structuredClone(initialState.notebook_sessions || []),
    audit_logs: structuredClone(initialState.audit_logs || []),
    admin_users: structuredClone(initialState.admin_users || getDefaultAdminUsers()),
    admin_sessions: structuredClone(initialState.admin_sessions || []),
  }
  const selectLog = []

  function projectRow(row, selectClause) {
    if (!selectClause || selectClause === '*') return structuredClone(row)
    const cols = selectClause
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean)
    const out = {}
    for (const col of cols) {
      out[col] = row[col] ?? null
    }
    return out
  }

  function buildQuery(tableName) {
    const state = {
      op: 'select',
      selectClause: null,
      patch: null,
      insertRow: null,
      filters: [],
      orderBy: null,
      singleMode: null,
    }

    function matchesFilters(row) {
      return state.filters.every((f) => {
        if (f.kind === 'eq') return String(row[f.col]) === String(f.val)
        if (f.kind === 'is') return f.val === null ? (row[f.col] === null || row[f.col] === undefined) : row[f.col] === f.val
        if (f.kind === 'in') return Array.isArray(f.val) && f.val.includes(row[f.col])
        return true
      })
    }

    async function execute() {
      if (options.failTables && options.failTables.has(tableName)) {
        return { data: null, error: { message: `Simulated upstream outage on ${tableName}` } }
      }

      if (state.selectClause) {
        selectLog.push({ table: tableName, select: state.selectClause })
      }

      const rows = tables[tableName]
      if (!rows) {
        return { data: null, error: { message: `Unknown table ${tableName}` } }
      }

      if (state.op === 'insert') {
        const items = Array.isArray(state.insertRow) ? state.insertRow : [state.insertRow]
        const inserted = []
        for (const item of items) {
          const record = {
            id: item.id || crypto.randomUUID(),
            created_at: item.created_at || new Date().toISOString(),
            ...item,
          }
          rows.push(record)
          inserted.push(projectRow(record, state.selectClause))
        }
        if (state.singleMode === 'single' || state.singleMode === 'maybeSingle') {
          return { data: inserted[0] || null, error: null }
        }
        return { data: inserted, error: null }
      }

      if (state.op === 'update') {
        const updated = []
        for (const row of rows) {
          if (matchesFilters(row)) {
            Object.assign(row, state.patch)
            updated.push(projectRow(row, state.selectClause))
          }
        }
        if (state.singleMode === 'single' || state.singleMode === 'maybeSingle') {
          return updated.length
            ? { data: updated[0], error: null }
            : { data: null, error: { message: 'No rows updated' } }
        }
        return { data: updated, error: null }
      }

      if (state.op === 'delete') {
        const deleted = []
        for (let i = rows.length - 1; i >= 0; i--) {
          if (matchesFilters(rows[i])) {
            const [removed] = rows.splice(i, 1)
            deleted.push(projectRow(removed, state.selectClause))
          }
        }
        return { data: deleted, error: null }
      }

      let matched = rows.filter(matchesFilters)
      if (state.orderBy) {
        const { col, ascending } = state.orderBy
        matched = [...matched].sort((a, b) => {
          const av = String(a[col] || '')
          const bv = String(b[col] || '')
          return ascending ? av.localeCompare(bv) : bv.localeCompare(av)
        })
      }
      const projected = matched.map((r) => projectRow(r, state.selectClause))
      if (state.singleMode === 'single') {
        return projected.length
          ? { data: projected[0], error: null }
          : { data: null, error: { code: 'PGRST116', message: 'The result contains 0 rows' } }
      }
      if (state.singleMode === 'maybeSingle') {
        return { data: projected[0] || null, error: null }
      }
      return { data: projected, error: null }
    }

    const builder = {
      select(clause) {
        state.selectClause = clause
        return builder
      },
      insert(row) {
        state.op = 'insert'
        state.insertRow = row
        return builder
      },
      update(patch) {
        state.op = 'update'
        state.patch = patch
        return builder
      },
      delete() {
        state.op = 'delete'
        return builder
      },
      eq(col, val) {
        state.filters.push({ kind: 'eq', col, val })
        return builder
      },
      is(col, val) {
        state.filters.push({ kind: 'is', col, val })
        return builder
      },
      in(col, val) {
        state.filters.push({ kind: 'in', col, val })
        return builder
      },
      order(col, { ascending = true } = {}) {
        state.orderBy = { col, ascending }
        return builder
      },
      single() {
        state.singleMode = 'single'
        return execute()
      },
      maybeSingle() {
        state.singleMode = 'maybeSingle'
        return execute()
      },
      then(onFulfilled, onRejected) {
        return execute().then(onFulfilled, onRejected)
      },
    }

    return builder
  }

  return {
    tables,
    selectLog,
    from(tableName) {
      return buildQuery(tableName)
    },
  }
}

test('Phase 2A: Super Admin Real Key Listing, Emergency Revocation & Security Boundaries', async (t) => {
  const secret = 'inferxe_dev_secret_key_2026_super_secure'
  const apiKeyId = '11111111-1111-4111-8111-111111111111'
  const expiredKeyId = '22222222-2222-4222-8222-222222222222'
  const sshKeyId = '33333333-3333-4333-8333-333333333333'
  const missingKeyId = '99999999-9999-4999-8999-999999999999'
  const rawSshBlob = 'AAAAC3NzaC1lZDI1NTE5AAAAIMockSuperSecretBlobMaterialForMaskingTest123456'

  const fakeSupabase = createFakeSupabaseClient({
    profiles: [
      {
        user_id: 'cognito-sub-alice',
        full_name: 'Alice Developer',
        email: 'alice@novatech.ai',
        role: 'developer',
        status: 'active',
      },
      {
        user_id: 'cognito-sub-bob',
        full_name: 'Bob Customer',
        email: 'bob@acme.io',
        role: 'customer',
        status: 'active',
      },
    ],
    api_keys: [
      {
        id: apiKeyId,
        user_id: 'cognito-sub-alice',
        organization_id: null,
        name: 'Alice Production Inference Key',
        key_prefix: 'inf_live_abcd12',
        secret_hash: 'deadbeef'.repeat(8),
        status: 'active',
        created_at: '2026-11-10T10:00:00.000Z',
        last_used_at: '2026-11-18T05:00:00.000Z',
        expires_at: null,
        revoked_at: null,
      },
      {
        id: expiredKeyId,
        user_id: 'cognito-sub-bob',
        organization_id: null,
        name: 'Bob Staging Test Key',
        key_prefix: 'inf_test_998877',
        secret_hash: 'cafebabe'.repeat(8),
        status: 'active',
        created_at: '2026-10-01T10:00:00.000Z',
        last_used_at: null,
        expires_at: '2026-10-15T00:00:00.000Z',
        revoked_at: null,
      },
    ],
    ssh_public_keys: [
      {
        id: sshKeyId,
        user_id: 'cognito-sub-alice',
        name: 'Alice Workstation Ed25519',
        public_key: `ssh-ed25519 ${rawSshBlob} alice@laptop`,
        fingerprint: 'SHA256:AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcdef0',
        created_at: '2026-11-12T08:00:00.000Z',
      },
    ],
    inference_requests: [
      { api_key_id: apiKeyId, status: 'success', created_at: '2026-11-18T04:00:00.000Z' },
      { api_key_id: apiKeyId, status: 'failed', created_at: '2026-11-18T04:30:00.000Z' },
    ],
    notebook_sessions: [
      {
        id: 'nb-1',
        user_id: 'cognito-sub-alice',
        selected_ssh_key_id: sshKeyId,
        status: 'running',
      },
      {
        id: 'nb-2',
        user_id: 'cognito-sub-alice',
        selected_ssh_key_id: sshKeyId,
        status: 'stopped',
      },
    ],
  })

  let activeSupabaseClient = fakeSupabase
  const localAuditEntries = []
  const middleware = createAdminAuthMiddleware({
    adminEmail: 'admin@inferxe.com',
    adminPassword: 'admin',
    sessionSecret: secret,
    getSupabaseClient: () => {
      if (!activeSupabaseClient) {
        throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured on the backend.')
      }
      return activeSupabaseClient
    },
    logLocalActivity: (entry) => {
      localAuditEntries.unshift({
        id: `test_log_${localAuditEntries.length + 1}`,
        admin_email: entry.adminEmail,
        action: entry.action,
        category: entry.category,
        target_id: entry.targetId,
        target_type: entry.targetType,
        details: entry.details,
        ip_address: entry.ipAddress,
        created_at: new Date().toISOString(),
      })
      return { ok: true }
    },
    getLocalActivityLogs: () => ({ logs: localAuditEntries, total: localAuditEntries.length }),
  })

  // Obtain real admin & superadmin JWTs via Argon2id authentication
  const adminLogin = await dispatchRequest(middleware, {
    url: '/api/admin/login',
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  })
  assert.equal(adminLogin.status, 200)
  const adminToken = adminLogin.body.token

  const superLogin = await dispatchRequest(middleware, {
    url: '/api/admin/login',
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: { email: SUPERADMIN_EMAIL, password: SUPERADMIN_PASSWORD },
  })
  assert.equal(superLogin.status, 200)
  const superadminToken = superLogin.body.token

  await t.test('1. Rejects unauthenticated access and bypass tokens with HTTP 401', async () => {
    const getRes = await dispatchRequest(middleware, { url: '/api/superadmin/keys', method: 'GET' })
    assert.equal(getRes.status, 401)

    const postRes = await dispatchRequest(middleware, {
      url: '/api/superadmin/keys/revoke',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: { key_id: apiKeyId, key_type: 'api', reason: 'Emergency test' },
    })
    assert.equal(postRes.status, 401)

    // Bypass token rejection: Super Admin routes must reject dev bypass tokens
    const bypassGet = await dispatchRequest(middleware, {
      url: '/api/superadmin/keys',
      method: 'GET',
      headers: { authorization: 'Bearer admin-dev-token' },
    })
    assert.equal(bypassGet.status, 401)

    const bypassPost = await dispatchRequest(middleware, {
      url: '/api/superadmin/keys/revoke',
      method: 'POST',
      headers: { authorization: 'Bearer ix-dev-bypass-12345', 'content-type': 'application/json' },
      body: { key_id: apiKeyId, key_type: 'api', reason: 'Bypass token attempt' },
    })
    assert.equal(bypassPost.status, 401)
  })

  await t.test('2. Blocks standard Admin from Super Admin key endpoints with HTTP 403', async () => {
    const getRes = await dispatchRequest(middleware, {
      url: '/api/superadmin/keys',
      method: 'GET',
      headers: { authorization: `Bearer ${adminToken}` },
    })
    assert.equal(getRes.status, 403)

    const postRes = await dispatchRequest(middleware, {
      url: '/api/superadmin/keys/revoke',
      method: 'POST',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json',
      },
      body: { key_id: apiKeyId, key_type: 'api', reason: 'Admin should be blocked' },
    })
    assert.equal(postRes.status, 403)
  })

  await t.test('3. Lists real metadata-only API & SSH keys without exposing secret_hash or full SSH blobs', async () => {
    const res = await dispatchRequest(middleware, {
      url: '/api/superadmin/keys',
      method: 'GET',
      headers: { authorization: `Bearer ${superadminToken}` },
    })

    assert.equal(res.status, 200)
    assert.equal(res.body.ok, true)
    assert.equal(res.body.keys.length, 3)

    // Verify metadata-only SQL column selection (never secret_hash or wildcard *)
    const apiSelects = fakeSupabase.selectLog.filter((s) => s.table === 'api_keys')
    assert.ok(apiSelects.length > 0)
    for (const s of apiSelects) {
      assert.ok(!s.select.includes('secret_hash'), 'api_keys SELECT must never include secret_hash')
      assert.ok(!s.select.includes('*'), 'api_keys SELECT must never use wildcard *')
    }

    const serialized = JSON.stringify(res.body)
    assert.ok(!serialized.includes('deadbeef'), 'secret_hash must never appear in response')
    assert.ok(!serialized.includes(rawSshBlob), 'full SSH public key blob must be masked in response')

    const aliceApi = res.body.keys.find((k) => k.id === apiKeyId)
    assert.equal(aliceApi.type, 'API Key')
    assert.equal(aliceApi.owner_email, 'alice@novatech.ai')
    assert.equal(aliceApi.environment, 'live')
    assert.equal(aliceApi.status, 'active')
    assert.equal(aliceApi.usage_count, 2)
    assert.equal(aliceApi.failed_count, 1)

    const bobExpired = res.body.keys.find((k) => k.id === expiredKeyId)
    assert.equal(bobExpired.status, 'expired')
    assert.equal(bobExpired.environment, 'test')

    const aliceSsh = res.body.keys.find((k) => k.id === sshKeyId)
    assert.equal(aliceSsh.type, 'SSH Key')
    assert.equal(aliceSsh.ssh_algorithm, 'ssh-ed25519')
    assert.equal(aliceSsh.fingerprint, 'SHA256:AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcdef0')
  })

  await t.test('4. Enforces strict input validation (HTTP 400) on emergency revocation', async () => {
    const cases = [
      { key_type: 'api', reason: 'Missing key_id' },
      { key_id: 'not-a-uuid', key_type: 'api', reason: 'Bad UUID format' },
      { key_id: apiKeyId, key_type: 'invalid', reason: 'Invalid key type' },
      { key_id: apiKeyId, key_type: 'api', reason: '' },
      { key_id: apiKeyId, key_type: 'api', reason: 'ab' },
    ]

    for (const payload of cases) {
      const res = await dispatchRequest(middleware, {
        url: '/api/superadmin/keys/revoke',
        method: 'POST',
        headers: {
          authorization: `Bearer ${superadminToken}`,
          'content-type': 'application/json',
        },
        body: payload,
      })
      assert.equal(res.status, 400, `Expected 400 for payload ${JSON.stringify(payload)}`)
    }

    const badJson = await dispatchRequest(middleware, {
      url: '/api/superadmin/keys/revoke',
      method: 'POST',
      headers: {
        authorization: `Bearer ${superadminToken}`,
        'content-type': 'application/json',
      },
      body: '{invalid-json',
    })
    assert.equal(badJson.status, 400)
  })

  await t.test('5. Performs real atomic API key revocation, prevents repeated revocation (409), and records audit logs', async () => {
    const revokeRes = await dispatchRequest(middleware, {
      url: '/api/superadmin/keys/revoke',
      method: 'POST',
      headers: {
        authorization: `Bearer ${superadminToken}`,
        'content-type': 'application/json',
      },
      body: {
        key_id: apiKeyId,
        key_type: 'api',
        reason: 'Suspected credential leak in public repo',
      },
    })

    assert.equal(revokeRes.status, 200)
    assert.equal(revokeRes.body.ok, true)
    assert.equal(revokeRes.body.revocation_mode, 'status_revoked')

    // Confirm real database row was mutated
    const dbRow = fakeSupabase.tables.api_keys.find((r) => r.id === apiKeyId)
    assert.equal(dbRow.status, 'revoked')
    assert.ok(dbRow.revoked_at)
    const firstRevokedAt = dbRow.revoked_at

    // Repeated revocation must fail with 409 Conflict and keep original revoked_at
    const repeatRes = await dispatchRequest(middleware, {
      url: '/api/superadmin/keys/revoke',
      method: 'POST',
      headers: {
        authorization: `Bearer ${superadminToken}`,
        'content-type': 'application/json',
      },
      body: {
        key_id: apiKeyId,
        key_type: 'api',
        reason: 'Duplicate revocation attempt',
      },
    })
    assert.equal(repeatRes.status, 409)
    assert.equal(dbRow.revoked_at, firstRevokedAt)

    // Non-existent API key returns 404
    const notFoundRes = await dispatchRequest(middleware, {
      url: '/api/superadmin/keys/revoke',
      method: 'POST',
      headers: {
        authorization: `Bearer ${superadminToken}`,
        'content-type': 'application/json',
      },
      body: {
        key_id: missingKeyId,
        key_type: 'api',
        reason: 'Non-existent key check',
      },
    })
    assert.equal(notFoundRes.status, 404)

    // Confirm audit trail in both local audit ledger and Supabase
    assert.ok(localAuditEntries.some((l) => l.target_id === apiKeyId && l.action === 'keys.revoke'))
    assert.ok(
      fakeSupabase.tables.audit_logs.some(
        (l) => l.target_id === apiKeyId && l.action === 'superadmin.api_key.revoked',
      ),
    )
  })

  await t.test('6. Permanently deletes SSH key, detaches GPU notebook sessions, blocks repeat deletion (404), and audits', async () => {
    const deleteRes = await dispatchRequest(middleware, {
      url: '/api/superadmin/keys/revoke',
      method: 'POST',
      headers: {
        authorization: `Bearer ${superadminToken}`,
        'content-type': 'application/json',
      },
      body: {
        key_id: sshKeyId,
        key_type: 'ssh',
        reason: 'Compromised developer workstation SSH key',
      },
    })

    assert.equal(deleteRes.status, 200)
    assert.equal(deleteRes.body.ok, true)
    assert.equal(deleteRes.body.revocation_mode, 'permanent_delete')
    assert.equal(deleteRes.body.detached_sessions, 2)

    // Confirm SSH key is permanently gone from ssh_public_keys
    assert.equal(fakeSupabase.tables.ssh_public_keys.length, 0)

    // Confirm ALL GPU notebook sessions referencing this SSH key were detached (authorization removed)
    for (const nb of fakeSupabase.tables.notebook_sessions) {
      assert.equal(nb.selected_ssh_key_id, null)
    }

    // Confirm listing reflects deletion immediately
    const listAfter = await dispatchRequest(middleware, {
      url: '/api/superadmin/keys',
      method: 'GET',
      headers: { authorization: `Bearer ${superadminToken}` },
    })
    assert.equal(listAfter.status, 200)
    assert.ok(!listAfter.body.keys.some((k) => k.id === sshKeyId))

    // Repeated SSH deletion returns 404
    const repeatDelete = await dispatchRequest(middleware, {
      url: '/api/superadmin/keys/revoke',
      method: 'POST',
      headers: {
        authorization: `Bearer ${superadminToken}`,
        'content-type': 'application/json',
      },
      body: {
        key_id: sshKeyId,
        key_type: 'ssh',
        reason: 'Repeat SSH deletion attempt',
      },
    })
    assert.equal(repeatDelete.status, 404)

    // Confirm audit trail in both local audit ledger and Supabase
    assert.ok(localAuditEntries.some((l) => l.target_id === sshKeyId && l.target_type === 'ssh_public_key'))
    const sbAudit = fakeSupabase.tables.audit_logs.find(
      (l) => l.target_id === sshKeyId && l.action === 'superadmin.ssh_key.deleted',
    )
    assert.ok(sbAudit)
    assert.equal(sbAudit.details.detached_notebook_sessions, 2)
  })

  await t.test('7. Fails closed with HTTP 503 when Supabase is unavailable or unconfigured (zero mock fallback)', async () => {
    // 7A. Upstream Supabase table failure
    activeSupabaseClient = createFakeSupabaseClient(
      {
        admin_users: fakeSupabase.tables.admin_users,
        admin_sessions: fakeSupabase.tables.admin_sessions,
      },
      { failTables: new Set(['api_keys']) },
    )
    const failedQueryRes = await dispatchRequest(middleware, {
      url: '/api/superadmin/keys',
      method: 'GET',
      headers: { authorization: `Bearer ${superadminToken}` },
    })
    assert.equal(failedQueryRes.status, 503)
    assert.equal(failedQueryRes.body.ok, false)
    assert.equal(failedQueryRes.body.keys, undefined)

    // 7B. Supabase unconfigured
    activeSupabaseClient = null
    const unconfGet = await dispatchRequest(middleware, {
      url: '/api/superadmin/keys',
      method: 'GET',
      headers: { authorization: `Bearer ${superadminToken}` },
    })
    assert.equal(unconfGet.status, 503)
    assert.equal(unconfGet.body.ok, false)

    const unconfPost = await dispatchRequest(middleware, {
      url: '/api/superadmin/keys/revoke',
      method: 'POST',
      headers: {
        authorization: `Bearer ${superadminToken}`,
        'content-type': 'application/json',
      },
      body: {
        key_id: apiKeyId,
        key_type: 'api',
        reason: 'Should fail closed with 503',
      },
    })
    assert.equal(unconfPost.status, 503)
    assert.equal(unconfPost.body.ok, false)
  })
})

test('Phase 2B: Admin Read-Only Key Monitoring API, Alerts, Audit Records & Read-Only Enforcement', async (t) => {
  const secret = 'inferxe_dev_secret_key_2026_super_secure'
  const noisyKeyId = '44444444-4444-4444-8444-444444444444'
  const staleKeyId = '55555555-5555-4555-8555-555555555555'
  const expiredKeyId = '66666666-6666-4666-8666-666666666666'
  const sshKeyId = '77777777-7777-4777-8777-777777777777'
  const rawSshBlob = 'AAAAC3NzaC1lZDI1NTE5AAAAIAdminMonitoringSecretBlobNeverLeak1234567890'

  const staleDateIso = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString()
  const recentIso = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()

  const fakeSupabase = createFakeSupabaseClient({
    profiles: [
      {
        user_id: 'cognito-sub-dev1',
        full_name: 'Dev One',
        email: 'dev1@company.ai',
        role: 'developer',
        status: 'active',
      },
    ],
    api_keys: [
      {
        id: noisyKeyId,
        user_id: 'cognito-sub-dev1',
        organization_id: null,
        name: 'High Failure API Key',
        key_prefix: 'inf_live_noisy1',
        secret_hash: 'aaaa1111'.repeat(8),
        status: 'active',
        created_at: recentIso,
        last_used_at: recentIso,
        expires_at: null,
        revoked_at: null,
      },
      {
        id: staleKeyId,
        user_id: 'cognito-sub-dev1',
        organization_id: null,
        name: 'Stale Legacy Key',
        key_prefix: 'inf_live_stale2',
        secret_hash: 'bbbb2222'.repeat(8),
        status: 'active',
        created_at: staleDateIso,
        last_used_at: staleDateIso,
        expires_at: null,
        revoked_at: null,
      },
      {
        id: expiredKeyId,
        user_id: 'cognito-sub-dev1',
        organization_id: null,
        name: 'Expired Cleanup Key',
        key_prefix: 'inf_test_exp003',
        secret_hash: 'cccc3333'.repeat(8),
        status: 'active',
        created_at: staleDateIso,
        last_used_at: null,
        expires_at: '2026-01-01T00:00:00.000Z',
        revoked_at: null,
      },
    ],
    ssh_public_keys: [
      {
        id: sshKeyId,
        user_id: 'cognito-sub-dev1',
        name: 'Dev One SSH Key',
        public_key: `ssh-ed25519 ${rawSshBlob} dev1@workstation`,
        fingerprint: 'SHA256:AdminMonitorFingerprintExample0123456789abc',
        created_at: recentIso,
      },
    ],
    inference_requests: [
      { api_key_id: noisyKeyId, status: 'failed', created_at: recentIso },
      { api_key_id: noisyKeyId, status: 'failed', created_at: recentIso },
      { api_key_id: noisyKeyId, status: 'failed', created_at: recentIso },
      { api_key_id: noisyKeyId, status: 'success', created_at: recentIso },
    ],
    audit_logs: [
      {
        id: 'sb_audit_key_1',
        action: 'superadmin.api_key.revoked',
        target_type: 'api_key',
        target_id: expiredKeyId,
        details: {
          actor_email: 'bhumireddy@inferxe.com',
          key_name: 'Historical Revoked Key',
          reason: 'Quarterly rotation audit',
        },
        created_at: recentIso,
      },
    ],
  })

  let activeSupabaseClient = fakeSupabase
  const localAuditEntries = []
  const middleware = createAdminAuthMiddleware({
    adminEmail: 'admin@inferxe.com',
    adminPassword: 'admin',
    sessionSecret: secret,
    getSupabaseClient: () => {
      if (!activeSupabaseClient) {
        throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured on the backend.')
      }
      return activeSupabaseClient
    },
    logLocalActivity: (entry) => {
      localAuditEntries.unshift({
        id: `test_log_${localAuditEntries.length + 1}`,
        admin_email: entry.adminEmail,
        action: entry.action,
        category: entry.category,
        target_id: entry.targetId,
        target_type: entry.targetType,
        details: entry.details,
        ip_address: entry.ipAddress,
        created_at: new Date().toISOString(),
      })
      return { ok: true }
    },
    getLocalActivityLogs: () => ({ logs: localAuditEntries, total: localAuditEntries.length }),
  })

  const adminLogin = await dispatchRequest(middleware, {
    url: '/api/admin/login',
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  })
  assert.equal(adminLogin.status, 200)
  const adminToken = adminLogin.body.token

  const superLogin = await dispatchRequest(middleware, {
    url: '/api/admin/login',
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: { email: SUPERADMIN_EMAIL, password: SUPERADMIN_PASSWORD },
  })
  assert.equal(superLogin.status, 200)
  const superadminToken = superLogin.body.token

  await t.test('1. Rejects unauthenticated access and bypass tokens to /api/admin/keys with HTTP 401', async () => {
    const res = await dispatchRequest(middleware, { url: '/api/admin/keys', method: 'GET' })
    assert.equal(res.status, 401)

    const bypassRes = await dispatchRequest(middleware, {
      url: '/api/admin/keys',
      method: 'GET',
      headers: { authorization: 'Bearer admin-dev-token' },
    })
    assert.equal(bypassRes.status, 401)

    const ixRes = await dispatchRequest(middleware, {
      url: '/api/admin/keys',
      method: 'GET',
      headers: { authorization: 'Bearer ix-admin-fake-token' },
    })
    assert.equal(ixRes.status, 401)
  })

  await t.test('2. Returns real read-only metadata, verified actor_role, usage metrics, security alerts, and audit records without secrets', async () => {
    const res = await dispatchRequest(middleware, {
      url: '/api/admin/keys',
      method: 'GET',
      headers: { authorization: `Bearer ${adminToken}` },
    })

    assert.equal(res.status, 200)
    assert.equal(res.body.ok, true)
    assert.equal(res.body.read_only, true)
    assert.equal(res.body.actor_role, 'admin')
    assert.equal(res.body.keys.length, 4)

    const superRes = await dispatchRequest(middleware, {
      url: '/api/admin/keys',
      method: 'GET',
      headers: { authorization: `Bearer ${superadminToken}` },
    })
    assert.equal(superRes.status, 200)
    assert.equal(superRes.body.ok, true)
    assert.equal(superRes.body.read_only, true)
    assert.equal(superRes.body.actor_role, 'superadmin')

    // Strictly no secret hashes or raw SSH key blobs exposed
    const rawJson = JSON.stringify(res.body)
    assert.ok(!rawJson.includes('aaaa1111'), 'secret_hash must never be exposed to Admin')
    assert.ok(!rawJson.includes(rawSshBlob), 'raw SSH public key blob must be masked for Admin')

    // Real usage metrics
    assert.equal(res.body.summary.total_requests, 4)
    assert.equal(res.body.summary.failed_requests, 3)
    assert.equal(res.body.summary.error_rate_pct, 75)
    assert.equal(res.body.summary.active_keys_used_24h, 1)

    // Real derived security alerts (high_failure_rate, stale_active_key, expired_unrevoked)
    const alertTypes = res.body.alerts.map((a) => a.type)
    assert.ok(alertTypes.includes('high_failure_rate'))
    assert.ok(alertTypes.includes('stale_active_key'))
    assert.ok(alertTypes.includes('expired_unrevoked'))
    assert.equal(res.body.summary.high_severity_alerts, 1)

    // Real key audit records
    assert.ok(Array.isArray(res.body.audit_records))
    assert.ok(res.body.audit_records.some((r) => r.target_id === expiredKeyId))
  })

  await t.test('3. Strictly blocks Admin from revoking or mutating keys via /api/admin/keys* (HTTP 403)', async () => {
    const revokeAttempt = await dispatchRequest(middleware, {
      url: '/api/admin/keys/revoke',
      method: 'POST',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json',
      },
      body: { key_id: noisyKeyId, key_type: 'api', reason: 'Admin attempt' },
    })
    assert.equal(revokeAttempt.status, 403)
    assert.match(revokeAttempt.body.error, /read-only/i)

    const deleteAttempt = await dispatchRequest(middleware, {
      url: `/api/admin/keys/${sshKeyId}`,
      method: 'DELETE',
      headers: { authorization: `Bearer ${adminToken}` },
    })
    assert.equal(deleteAttempt.status, 403)

    // Confirm zero database mutations occurred
    assert.equal(fakeSupabase.tables.api_keys.find((k) => k.id === noisyKeyId).status, 'active')
    assert.equal(fakeSupabase.tables.ssh_public_keys.length, 1)
  })

  await t.test('4. Fails closed with HTTP 503 when Supabase is unavailable (zero mock fallback)', async () => {
    activeSupabaseClient = null
    const res = await dispatchRequest(middleware, {
      url: '/api/admin/keys',
      method: 'GET',
      headers: { authorization: `Bearer ${adminToken}` },
    })
    assert.equal(res.status, 503)
    assert.equal(res.body.ok, false)
    assert.equal(res.body.keys, undefined)
  })
})

