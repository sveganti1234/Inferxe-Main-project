/**
 * adminAuthServer.mjs
 * ===================
 * Standalone Node.js HTTP server for Inferxe Admin Authentication.
 * Can be run independently or mounted directly inside Vite.
 *
 * Usage:
 *   node server/adminAuthServer.mjs
 * Or:
 *   npm run server:admin
 */

import http from 'node:http'
import { createAdminAuthMiddleware } from './adminAuth.js'

const PORT = parseInt(process.env.ADMIN_AUTH_PORT || '5174', 10)
const middleware = createAdminAuthMiddleware()

const server = http.createServer((req, res) => {
  middleware(req, res, () => {
    res.statusCode = 404
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ ok: false, error: 'Not found' }))
  })
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[Inferxe] Admin Authentication Server running at http://127.0.0.1:${PORT}`)
})
