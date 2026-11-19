/**
 * dev-frontend.mjs — start the Vite dev server unless a healthy Inferxe one is already on the port.
 *
 * Why: `vite` is configured with strictPort:false, so if 5173 is taken (typically by an orphaned
 * dev server from an earlier `npm run dev`) it silently starts a SECOND server on another port,
 * where the dev experience and any registered callback URLs no longer match.
 *
 *   - port free                      -> start `npm --prefix frontend run dev` (and stop its whole
 *                                       process tree on exit, so no orphan is left behind)
 *   - healthy Inferxe Vite on port   -> reuse it, exit 0 (does not trip `--kill-others-on-fail`)
 *   - something else on the port     -> clear diagnostic, exit 1, nothing is stopped
 */
import http from 'node:http'
import net from 'node:net'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const PORT = 5173
const HOST = '127.0.0.1'

function isPortOpen(port, host = HOST) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host })
    const finish = (result) => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(result)
    }
    socket.setTimeout(800)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

function httpGetText(urlPath, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const req = http.get({ host: HOST, port: PORT, path: urlPath, timeout: timeoutMs }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => { if (body.length < 65536) body += chunk })
      res.on('end', () => resolve({ status: res.statusCode || 0, body }))
    })
    req.on('error', () => resolve({ status: 0, body: '' }))
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: '' }) })
  })
}

/** A Vite dev server (serves its client script) that is serving the Inferxe app (page title). */
async function isHealthyInferxeVite() {
  const client = await httpGetText('/@vite/client')
  if (client.status !== 200 || !/vite/i.test(client.body)) return false
  const page = await httpGetText('/')
  return page.status === 200 && /<title>[^<]*Inferxe/i.test(page.body)
}

function stopTree(child) {
  if (!child || child.killed || child.pid === undefined) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  } else {
    child.kill('SIGTERM')
  }
}

async function main() {
  if (await isPortOpen(PORT)) {
    if (await isHealthyInferxeVite()) {
      console.log(`[frontend:${PORT}] Already running and healthy; reusing existing Vite dev server at http://${HOST}:${PORT}`)
      process.exit(0)
    }
    console.error(
      `[error] Port ${PORT} is in use by a process that does not look like the Inferxe Vite dev server, and it was not stopped.\n` +
        `  Find it with: netstat -ano | findstr :${PORT}   (then check the PID in Task Manager)\n` +
        `  Vite would otherwise silently pick another port, which breaks the /api proxy expectations.`,
    )
    process.exit(1)
  }

  const child = spawn('npm', ['--prefix', 'frontend', 'run', 'dev'], {
    cwd: ROOT_DIR,
    stdio: 'inherit',
    shell: process.platform === 'win32', // npm is npm.cmd on Windows
  })

  let stopping = false
  const shutdown = (code) => {
    if (stopping) return
    stopping = true
    stopTree(child)
    process.exit(code)
  }
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK']) process.on(signal, () => shutdown(0))
  process.on('exit', () => stopTree(child))
  child.on('exit', (code) => {
    if (!stopping) {
      stopping = true
      process.exit(typeof code === 'number' ? code : 1)
    }
  })
}

main().catch((err) => {
  console.error(`[error] Could not start the frontend: ${err?.message || err}`)
  process.exit(1)
})
