/**
 * render-gateway.mjs
 * ==================
 * Unified single-port production gateway for Render (and Docker deployments).
 * Runs:
 *   1. Python FastAPI Inference & GPU Health Service (127.0.0.1:8001)
 *   2. Python FastAPI Notifications, Wallet & RAG Service (127.0.0.1:8002)
 *   3. Node.js Admin, Customer, SSO & Supabase Auth/Workspace APIs (in-process)
 *
 * Exposes everything on 0.0.0.0:$PORT with CORS support so Vercel and local
 * frontends can connect through one public HTTPS URL.
 */

import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import { loadBackendEnv } from '../auth/envLoader.js'
import { createSupabaseApiMiddleware } from '../api/supabaseApi.js'
import { createCustomerAuthMiddleware } from '../auth/customerAuth.js'
import { createAdminAuthMiddleware } from '../auth/adminAuth.js'
import { createSSOAuthMiddleware } from '../auth/ssoAuth.js'
import { createMockSupabaseMiddleware } from '../dev/mockSupabaseRest.js'
import { isPortAccepting } from './workerProbe.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.resolve(__dirname, '../..')
const BACKEND_DIR = path.join(ROOT_DIR, 'backend')

dotenv.config({ path: path.join(ROOT_DIR, '.env') })
loadBackendEnv()

const PORT = parseInt(process.env.PORT || '10000', 10)
const HOST = process.env.HOST || '0.0.0.0'
const INFERENCE_PORT = parseInt(process.env.INFERENCE_PORT || '8001', 10)
const NOTIFICATIONS_PORT = parseInt(process.env.NOTIFICATIONS_PORT || '8002', 10)

const VERCEL_ORIGIN_RE = /^https:\/\/[a-z0-9-]+\.vercel\.app$/i
const LOCAL_ORIGIN_RE = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i

function getConfiguredOrigins() {
  const origins = new Set()
  for (const key of ['FRONTEND_URL', 'CORS_ALLOWED_ORIGINS']) {
    const raw = process.env[key] || ''
    for (const part of raw.split(',')) {
      const cleaned = part.trim().replace(/\/$/, '')
      if (cleaned) origins.add(cleaned)
    }
  }
  return origins
}

function isOriginAllowed(origin) {
  if (!origin) return false
  const cleaned = origin.trim().replace(/\/$/, '')
  if (getConfiguredOrigins().has(cleaned)) return true
  if (LOCAL_ORIGIN_RE.test(cleaned)) return true
  if (process.env.ALLOW_VERCEL_PREVIEW_ORIGINS !== 'false' && VERCEL_ORIGIN_RE.test(cleaned)) {
    return true
  }
  return false
}

function applyCorsHeaders(req, res) {
  const origin = req.headers.origin
  if (origin && isOriginAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
    res.setHeader('Access-Control-Allow-Credentials', 'true')
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-Requested-With, Accept, x-api-key, x-inferxe-key',
  )
}

function discoverPython() {
  const isWin = process.platform === 'win32'
  const candidates = []

  if (process.env.INFERXE_PYTHON) {
    candidates.push({ command: process.env.INFERXE_PYTHON, args: [] })
  }
  if (!isWin && fs.existsSync('/opt/venv/bin/python')) {
    candidates.push({ command: '/opt/venv/bin/python', args: [] })
  }

  for (const base of [ROOT_DIR, BACKEND_DIR]) {
    for (const vName of ['.venv311', '.venv', 'venv311', 'venv']) {
      const exe = isWin
        ? path.join(base, vName, 'Scripts', 'python.exe')
        : path.join(base, vName, 'bin', 'python')
      if (fs.existsSync(exe)) {
        candidates.push({ command: exe, args: [] })
      }
    }
  }

  if (isWin) {
    candidates.push({ command: 'py', args: ['-3'] })
  }
  candidates.push({ command: 'python3', args: [] })
  candidates.push({ command: 'python', args: [] })

  for (const candidate of candidates) {
    const res = spawnSync(
      candidate.command,
      [...candidate.args, '-c', 'import fastapi, uvicorn; print("ok")'],
      { cwd: ROOT_DIR, encoding: 'utf8', timeout: 8000, windowsHide: true },
    )
    if (!res.error && res.status === 0 && (res.stdout || '').includes('ok')) {
      return candidate
    }
  }
  return null
}

function pipePrefixed(stream, prefix, isErr = false) {
  if (!stream) return
  let buf = ''
  stream.setEncoding('utf8')
  stream.on('data', (chunk) => {
    buf += chunk
    const lines = buf.split(/\r?\n/)
    buf = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      ;(isErr ? process.stderr : process.stdout).write(`${prefix} ${line}\n`)
    }
  })
  stream.on('end', () => {
    if (buf.trim()) {
      ;(isErr ? process.stderr : process.stdout).write(`${prefix} ${buf}\n`)
    }
  })
}

const childState = {
  inference: { port: INFERENCE_PORT, running: false, pid: null, proc: null },
  notifications: { port: NOTIFICATIONS_PORT, running: false, pid: null, proc: null },
}

let shuttingDown = false

function startPythonWorker(name, python, spec) {
  if (shuttingDown) return
  const env = {
    ...process.env,
    PYTHONPATH: [ROOT_DIR, BACKEND_DIR, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),
    INFERENCE_DEMO_MODE: process.env.INFERENCE_DEMO_MODE || 'true',
    PYTHONUTF8: '1',
    PYTHONIOENCODING: 'utf-8',
  }

  const proc = spawn(python.command, [...python.args, ...spec.args], {
    cwd: spec.cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })

  childState[name].proc = proc
  childState[name].pid = proc.pid || null
  childState[name].running = true

  pipePrefixed(proc.stdout, `[${name}]`, false)
  pipePrefixed(proc.stderr, `[${name}]`, true)

  proc.on('exit', (code, signal) => {
    childState[name].running = false
    childState[name].pid = null
    childState[name].proc = null
    if (shuttingDown) return
    console.error(`[gateway] Worker "${name}" exited (code=${code}, signal=${signal || 'none'}). Restarting in 2s...`)
    setTimeout(() => startPythonWorker(name, python, spec), 2000)
  })
}

function proxyRequest(req, res, targetPort, cors = true) {
  const headers = { ...req.headers }
  headers.host = `127.0.0.1:${targetPort}`

  const proxyReq = http.request(
    {
      hostname: '127.0.0.1',
      port: targetPort,
      path: req.url,
      method: req.method,
      headers,
      timeout: 120000,
    },
    (proxyRes) => {
      const responseHeaders = {}
      for (const [k, v] of Object.entries(proxyRes.headers)) {
        // Let the gateway set authoritative CORS headers without duplicate values
        if (k.toLowerCase().startsWith('access-control-')) continue
        if (v !== undefined) responseHeaders[k] = v
      }
      res.statusCode = proxyRes.statusCode || 502
      for (const [k, v] of Object.entries(responseHeaders)) {
        res.setHeader(k, v)
      }
      if (cors) applyCorsHeaders(req, res)
      proxyRes.pipe(res)
    },
  )

  proxyReq.on('timeout', () => {
    proxyReq.destroy(new Error('Upstream timeout'))
  })

  proxyReq.on('error', (err) => {
    if (res.headersSent) {
      res.destroy()
      return
    }
    if (cors) applyCorsHeaders(req, res)
    res.statusCode = 503
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(
      JSON.stringify({
        ok: false,
        error: 'Backend service is starting up or temporarily unavailable. Please retry.',
        detail: err?.code || err?.message || 'upstream_unavailable',
      }),
    )
  })

  req.pipe(proxyReq)
}

function isInferenceRoute(pathname) {
  return (
    pathname === '/api/v1' ||
    pathname.startsWith('/api/v1/') ||
    pathname === '/docs' ||
    pathname.startsWith('/docs/') ||
    pathname === '/redoc' ||
    pathname.startsWith('/redoc/') ||
    pathname === '/openapi.json'
  )
}

// Notebook proxy (/nb/<notebook id>/...): JupyterLab pages and their WebSockets, served by the inference service.
function isNotebookRoute(pathname) {
  return pathname === '/nb' || pathname.startsWith('/nb/')
}

function isNotificationsRoute(pathname) {
  return (
    pathname === '/api/notifications' ||
    pathname.startsWith('/api/notifications/') ||
    pathname === '/api/wallet' ||
    pathname.startsWith('/api/wallet/') ||
    pathname === '/api/deployments' ||
    pathname.startsWith('/api/deployments/') ||
    pathname === '/api/gpu' ||
    pathname.startsWith('/api/gpu/') ||
    pathname === '/api/chat' ||
    pathname.startsWith('/api/chat/') ||
    pathname === '/api/documents' ||
    pathname.startsWith('/api/documents/') ||
    pathname === '/api/workspace' ||
    pathname.startsWith('/api/workspace/') ||
    pathname === '/api/health' ||
    pathname === '/api/supabase/status'
  )
}

const ssoMiddleware = createSSOAuthMiddleware()
const customerMiddleware = createCustomerAuthMiddleware()
const adminMiddleware = createAdminAuthMiddleware()
const supabaseApiMiddleware = createSupabaseApiMiddleware()
const mockSupabaseMiddleware =
  process.env.MOCK_SUPABASE_ENABLED === 'true' ? createMockSupabaseMiddleware() : (_req, _res, next) => next()

const server = http.createServer((req, res) => {
  const pathname = (req.url || '/').split('?')[0].split('#')[0]

  // Notebooks are opened as pages, never fetched cross-origin: no CORS headers, and OPTIONS goes to JupyterLab.
  if (isNotebookRoute(pathname)) {
    return proxyRequest(req, res, INFERENCE_PORT, false)
  }

  applyCorsHeaders(req, res)

  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return
  }

  if (pathname === '/healthz' && req.method === 'GET') {
    // Healthy only when both Python workers accept connections: before, this answered 200 while every proxied
    // /api call returned 503, so Render kept routing traffic to a gateway with dead workers.
    Promise.all([isPortAccepting(childState.inference.port), isPortAccepting(childState.notifications.port)]).then(
      ([inferenceUp, notificationsUp]) => {
        const healthy = inferenceUp && notificationsUp
        res.statusCode = healthy ? 200 : 503
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(
          JSON.stringify({
            ok: healthy,
            service: 'inferxe-backend-gateway',
            status: healthy ? 'healthy' : 'degraded',
            workers: {
              inference: { running: childState.inference.running, reachable: inferenceUp, port: childState.inference.port },
              notifications: { running: childState.notifications.running, reachable: notificationsUp, port: childState.notifications.port },
            },
          }),
        )
      },
    )
    return
  }

  if (pathname === '/' && req.method === 'GET') {
    res.statusCode = 200
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(
      JSON.stringify({
        ok: true,
        service: 'Inferxe Unified Backend API',
        docs: '/docs',
        health: '/healthz',
        inferenceHealth: '/api/v1/health',
        notificationsHealth: '/api/health',
      }),
    )
    return
  }

  if (isInferenceRoute(pathname)) {
    return proxyRequest(req, res, INFERENCE_PORT)
  }

  if (isNotificationsRoute(pathname)) {
    return proxyRequest(req, res, NOTIFICATIONS_PORT)
  }

  mockSupabaseMiddleware(req, res, () => {
    ssoMiddleware(req, res, () => {
      customerMiddleware(req, res, () => {
        adminMiddleware(req, res, () => {
          supabaseApiMiddleware(req, res, () => {
            res.statusCode = 404
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.end(JSON.stringify({ ok: false, error: 'Not found' }))
          })
        })
      })
    })
  })
})

// WebSocket upgrades (JupyterLab kernels and terminals) are passed through to the inference service byte for
// byte; it authenticates the notebook session and checks Origin. Every other upgrade is refused.
server.on('upgrade', (req, socket, head) => {
  const pathname = (req.url || '/').split('?')[0]
  if (!isNotebookRoute(pathname)) {
    socket.destroy()
    return
  }
  const upstream = net.connect(INFERENCE_PORT, '127.0.0.1', () => {
    const lines = [`${req.method} ${req.url} HTTP/1.1`]
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const name = req.rawHeaders[i]
      lines.push(`${name}: ${name.toLowerCase() === 'host' ? `127.0.0.1:${INFERENCE_PORT}` : req.rawHeaders[i + 1]}`)
    }
    upstream.write(`${lines.join('\r\n')}\r\n\r\n`)
    if (head && head.length) upstream.write(head)
    socket.pipe(upstream).pipe(socket)
  })
  const destroyBoth = () => {
    socket.destroy()
    upstream.destroy()
  }
  upstream.on('error', destroyBoth)
  socket.on('error', destroyBoth)
  upstream.on('close', () => socket.destroy())
  socket.on('close', () => upstream.destroy())
})

function shutdown(code = 0) {
  if (shuttingDown) return
  shuttingDown = true
  console.log('[gateway] Shutting down Inferxe backend services...')
  for (const state of Object.values(childState)) {
    if (state.proc && !state.proc.killed) {
      try {
        state.proc.kill('SIGTERM')
      } catch {}
    }
  }
  server.close(() => process.exit(code))
  setTimeout(() => process.exit(code), 3000)
}

process.once('SIGINT', () => shutdown(0))
process.once('SIGTERM', () => shutdown(0))

const python = discoverPython()
if (!python) {
  console.warn('[gateway] Warning: Python FastAPI/Uvicorn runtime not found; only Node auth routes will serve.')
} else {
  console.log(`[gateway] Starting Python workers using ${python.command}...`)
  startPythonWorker('inference', python, {
    cwd: BACKEND_DIR,
    args: ['-m', 'uvicorn', 'inference.main:app', '--host', '127.0.0.1', '--port', String(INFERENCE_PORT)],
  })
  startPythonWorker('notifications', python, {
    cwd: ROOT_DIR,
    args: ['-m', 'uvicorn', 'backend.notifications.main:app', '--host', '127.0.0.1', '--port', String(NOTIFICATIONS_PORT)],
  })
}

server.listen(PORT, HOST, () => {
  console.log(`[gateway] Inferxe Unified Backend Gateway listening on http://${HOST}:${PORT}`)
})
