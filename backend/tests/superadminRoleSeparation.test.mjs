import assert from 'node:assert/strict'
import test from 'node:test'
import { Readable } from 'node:stream'
import { EventEmitter } from 'node:events'
import {
  createAdminAuthMiddleware,
  createAdminToken,
  verifyAdminToken,
} from '../auth/adminAuth.js'
import {
  getAdminUserByEmail,
  getAllAdminUsers,
  updateAdminUserStatus,
  getAdminActivityLogs,
} from '../database/customerDatabase.js'

function dispatchRequest(middleware, { method = 'GET', url = '/', headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : ''
    let sent = false
    const req = new Readable({
      read() {
        if (!sent) {
          sent = true
          if (bodyStr) {
            this.push(Buffer.from(bodyStr))
          }
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
    res.writeHead = (code, headers) => {
      statusCode = code
      if (headers) {
        Object.entries(headers).forEach(([k, v]) => {
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
      middleware(req, res, () => {
        res.statusCode = 404
        res.end(JSON.stringify({ error: 'Not found' }))
      })
    } catch (err) {
      reject(err)
    }
  })
}

test('Inferxe Admin vs Superadmin Role Separation & Governance', async (t) => {
  const secret = 'inferxe_dev_secret_key_2026_super_secure'
  const middleware = createAdminAuthMiddleware({
    adminEmail: 'admin@inferxe.com',
    adminPassword: 'admin',
    sessionSecret: secret,
  })

  let adminToken = ''
  let superadminToken = ''

  await t.test('1. Standard Admin login issues role: "admin"', async () => {
    const res = await dispatchRequest(middleware, {
      url: '/api/admin/login',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: { email: 'admin@inferxe.com', password: 'admin' },
    })

    assert.equal(res.status, 200)
    assert.equal(res.body.ok, true)
    assert.equal(res.body.isAdmin, true)
    assert.equal(res.body.role, 'admin')
    assert.equal(res.body.user.role, 'admin')
    assert.ok(res.body.token)
    adminToken = res.body.token
  })

  await t.test('2. Superadmin login issues role: "superadmin"', async () => {
    const res = await dispatchRequest(middleware, {
      url: '/api/admin/login',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: { email: 'bhumireddy@inferxe.com', password: 'admin' },
    })

    assert.equal(res.status, 200)
    assert.equal(res.body.ok, true)
    assert.equal(res.body.isAdmin, true)
    assert.equal(res.body.role, 'superadmin')
    assert.equal(res.body.user.role, 'superadmin')
    assert.ok(res.body.token)
    superadminToken = res.body.token
  })

  await t.test('3. Standard Admin cannot access Superadmin endpoints (HTTP 403 Forbidden)', async () => {
    const res = await dispatchRequest(middleware, {
      url: '/api/superadmin/admins',
      method: 'GET',
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
    })

    assert.equal(res.status, 403)
    assert.equal(res.body.ok, false)
    assert.match(res.body.error, /Superadmin credentials required/i)
  })

  await t.test('4. Superadmin successfully accesses Superadmin endpoints', async () => {
    const res = await dispatchRequest(middleware, {
      url: '/api/superadmin/admins',
      method: 'GET',
      headers: {
        authorization: `Bearer ${superadminToken}`,
      },
    })

    assert.equal(res.status, 200)
    assert.equal(res.body.ok, true)
    assert.ok(Array.isArray(res.body.admins))
    assert.ok(res.body.admins.length >= 3)
  })

  await t.test('5. Superadmin can view immutable Audit Trail logs', async () => {
    const res = await dispatchRequest(middleware, {
      url: '/api/superadmin/audit-logs',
      method: 'GET',
      headers: {
        authorization: `Bearer ${superadminToken}`,
      },
    })

    assert.equal(res.status, 200)
    assert.equal(res.body.ok, true)
    assert.ok(Array.isArray(res.body.logs))
  })

  await t.test('6. Superadmin can access GPU Telemetry & Pricing analytics', async () => {
    const res = await dispatchRequest(middleware, {
      url: '/api/superadmin/telemetry',
      method: 'GET',
      headers: {
        authorization: `Bearer ${superadminToken}`,
      },
    })

    assert.equal(res.status, 200)
    assert.equal(res.body.ok, true)
    assert.ok(res.body.telemetry.clusters.length >= 2)
    assert.ok(res.body.telemetry.summary.totalVramGb > 0)
  })

  await t.test('7. Superadmin can suspend an admin account and enforce suspension', async () => {
    // 7A. Suspend alex.chen
    const suspendRes = await dispatchRequest(middleware, {
      url: '/api/superadmin/admins/status',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${superadminToken}`,
      },
      body: {
        admin_id: 'alex.chen@inferxe.internal',
        status: 'suspended',
        reason: 'Temporary suspension for compliance test',
      },
    })

    assert.equal(suspendRes.status, 200)
    assert.equal(suspendRes.body.ok, true)

    // 7B. Suspended admin fails login with HTTP 403
    const loginAttempt = await dispatchRequest(middleware, {
      url: '/api/admin/login',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: { email: 'alex.chen@inferxe.internal', password: 'admin' },
    })

    assert.equal(loginAttempt.status, 403)
    assert.match(loginAttempt.body.error, /suspended/i)

    // 7C. Reactivate alex.chen
    const restoreRes = await dispatchRequest(middleware, {
      url: '/api/superadmin/admins/status',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${superadminToken}`,
      },
      body: {
        admin_id: 'alex.chen@inferxe.internal',
        status: 'active',
        reason: 'Compliance test complete',
      },
    })

    assert.equal(restoreRes.status, 200)
    assert.equal(restoreRes.body.ok, true)

    // 7D. Alex Chen can log in again
    const reLogin = await dispatchRequest(middleware, {
      url: '/api/admin/login',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: { email: 'alex.chen@inferxe.internal', password: 'admin' },
    })

    assert.equal(reLogin.status, 200)
    assert.equal(reLogin.body.ok, true)
  })
})
