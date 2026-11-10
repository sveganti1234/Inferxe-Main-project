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

import http from 'node:http'
import { loadBackendEnv } from './envLoader.js'
import { createAdminAuthMiddleware } from './adminAuth.js'
import { createSSOAuthMiddleware } from './ssoAuth.js'

loadBackendEnv()

const PORT = parseInt(process.env.ADMIN_AUTH_PORT || '5174', 10)
const adminMiddleware = createAdminAuthMiddleware()
const ssoMiddleware = createSSOAuthMiddleware()

const server = http.createServer((req, res) => {
  ssoMiddleware(req, res, () => {
    adminMiddleware(req, res, () => {
      res.statusCode = 404
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ ok: false, error: 'Not found' }))
    })
  })
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[Inferxe] Authentication & SSO Server running at http://127.0.0.1:${PORT}`)
})
