/**
 * adminAuthServer.mjs
 * ===================
 * Standalone Node.js HTTP server for Inferxe Authentication & SSO.
 * Can be run independently or mounted directly inside Vite.
 *
 * Usage:
 *   node backend/auth/adminAuthServer.mjs
 * Or:
 *   npm run server:admin
 */

import crypto from 'node:crypto'
import http from 'node:http'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import { loadBackendEnv } from './envLoader.js'
import { createSupabaseApiMiddleware } from '../api/supabaseApi.js'
import { createCustomerAuthMiddleware } from './customerAuth.js'
import { createAdminAuthMiddleware } from './adminAuth.js'
import { createSSOAuthMiddleware } from './ssoAuth.js'
import { createMockSupabaseMiddleware } from '../dev/mockSupabaseRest.js'

dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') })

// Load server-only Supabase credentials from backend/.env (not exposed to frontend)
loadBackendEnv()

// Administrator passwords are Argon2id hashes verified with crypto.argon2Sync (Node >= 24.7, see .nvmrc).
if (typeof crypto.argon2Sync !== 'function') {
  console.error(
    `[admin-auth] Node ${process.version} lacks crypto.argon2Sync: administrator sign-in will fail (503). Use Node >= 24.7 (see .nvmrc).`,
  )
}

const PORT = parseInt(process.env.ADMIN_AUTH_PORT || '5174', 10)
const mockSupabaseMiddleware = createMockSupabaseMiddleware()
const adminMiddleware = createAdminAuthMiddleware()
const customerMiddleware = createCustomerAuthMiddleware()
const supabaseApiMiddleware = createSupabaseApiMiddleware()
const ssoMiddleware = createSSOAuthMiddleware()

const server = http.createServer((req, res) => {
  mockSupabaseMiddleware(req, res, () => {
    ssoMiddleware(req, res, () => {
      customerMiddleware(req, res, () => {
        adminMiddleware(req, res, () => {
          supabaseApiMiddleware(req, res, () => {
            res.statusCode = 404
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ ok: false, error: 'Not found' }))
          })
        })
      })
    })
  })
})

/**
 * Is the process already listening on `port` this same Inferxe auth/customer API?
 * An unauthenticated GET /api/customer/workspace is answered by this server with a JSON 401
 * ({ ok: false, error: "...authentication..." }); an unrelated application will not produce that.
 */
function probeExistingInferxeServer(port) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: '127.0.0.1', port, path: '/api/customer/workspace', timeout: 5000 },
      (res) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => { if (body.length < 4096) body += chunk })
        res.on('end', () => {
          try {
            const json = JSON.parse(body)
            resolve(res.statusCode === 401 && json?.ok === false && /authentication/i.test(String(json?.error || '')))
          } catch {
            resolve(false)
          }
        })
      },
    )
    req.on('error', () => resolve(false))
    req.on('timeout', () => { req.destroy(); resolve(false) })
  })
}

server.on('error', async (err) => {
  if (err?.code !== 'EADDRINUSE') {
    console.error(`[Inferxe] Authentication & SSO Server failed to start: ${err?.code || err?.name || 'error'}`)
    process.exit(1)
  }
  if (await probeExistingInferxeServer(PORT)) {
    // A healthy copy is already serving this port (e.g. left from an earlier `npm run dev`): reuse it.
    console.log(`[Inferxe] Authentication & SSO Server is already running on http://127.0.0.1:${PORT}; reusing the existing service.`)
    process.exit(0)
  }
  console.error(
    `[Inferxe] Port ${PORT} is in use by a process that does not look like the Inferxe auth/customer API, and it was not stopped.\n` +
      `  Find it with: netstat -ano | findstr :${PORT}   (then check the PID in Task Manager)\n` +
      `  The Vite dev proxy for /api/customer expects port 5174; if you change ADMIN_AUTH_PORT, update the proxy too.`,
  )
  process.exit(1)
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[Inferxe] Authentication & SSO Server running at http://127.0.0.1:${PORT}`)
})
