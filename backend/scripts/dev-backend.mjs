import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import http from 'node:http'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { assertNoFrontendSupabaseSecrets, parseEnvContent } from '../auth/envLoader.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.resolve(__dirname, '../..')
const BACKEND_DIR = path.join(ROOT_DIR, 'backend')
const FRONTEND_DIR = path.join(ROOT_DIR, 'frontend')

const args = new Set(process.argv.slice(2))
const CHECK_ONLY = args.has('--check') || args.has('--dry-run')
const WITH_SEARCH = args.has('--with-search')
const NO_RELOAD = args.has('--no-reload')

const PLACEHOLDER_TOKENS = [
  'your-project.supabase.co',
  'nvapi-your-key-here',
  'ap-south-1_xxxxxxxxx',
  'your-cognito-client-id',
  'YOUR_PASSWORD',
]

function isConfiguredValue(val) {
  const cleaned = String(val || '').trim()
  if (!cleaned) return false
  return !PLACEHOLDER_TOKENS.some((token) => cleaned.includes(token))
}

function readEnvFileSafe(filePath) {
  if (!fs.existsSync(filePath)) return null
  return parseEnvContent(fs.readFileSync(filePath, 'utf8'))
}

function validateEnvironment() {
  const rootEnvPath = path.join(ROOT_DIR, '.env')
  const backendEnvPath = path.join(BACKEND_DIR, '.env')
  const frontendEnvPath = path.join(FRONTEND_DIR, '.env')

  const rootEnv = readEnvFileSafe(rootEnvPath)
  const backendEnv = readEnvFileSafe(backendEnvPath)
  const frontendEnv = readEnvFileSafe(frontendEnvPath)

  const fatalErrors = []
  const warnings = []

  if (!backendEnv) {
    fatalErrors.push(
      'Missing backend/.env. Copy backend/.env.example to backend/.env and populate shared project credentials.',
    )
  }

  if (frontendEnv) {
    try {
      assertNoFrontendSupabaseSecrets(frontendEnv)
    } catch (err) {
      fatalErrors.push(err instanceof Error ? err.message : String(err))
    }
  } else {
    warnings.push(
      'frontend/.env not found. Copy frontend/.env.example to frontend/.env with VITE_COGNITO_* before starting Vite (`npm run dev`).',
    )
  }

  const effective = {
    ...(rootEnv || {}),
    ...(backendEnv || {}),
  }

  const sbUrl = effective.SUPABASE_URL || process.env.SUPABASE_URL || ''
  const sbKey = effective.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || ''

  if (!isConfiguredValue(sbUrl)) {
    fatalErrors.push(
      'SUPABASE_URL is missing or placeholder in backend/.env. Set it to your shared Supabase REST URL.',
    )
  }

  if (!sbKey.trim()) {
    fatalErrors.push(
      'SUPABASE_SERVICE_ROLE_KEY is missing in backend/.env. Set it to your shared project Secret/Service Role key.',
    )
  } else if (sbKey.startsWith('sbp_') || sbKey.startsWith('sb_publishable_')) {
    fatalErrors.push(
      'SUPABASE_SERVICE_ROLE_KEY cannot use a Personal Access Token (sbp_*) or Publishable key (sb_publishable_*).',
    )
  }

  const supaDb = effective.SUPABASE_DATABASE_URL || process.env.SUPABASE_DATABASE_URL || ''
  const dbUrl = effective.DATABASE_URL || process.env.DATABASE_URL || ''
  const notifDb = effective.NOTIFICATIONS_DATABASE_URL || process.env.NOTIFICATIONS_DATABASE_URL || ''
  const hasNotifDb =
    isConfiguredValue(notifDb) ||
    isConfiguredValue(supaDb) ||
    (isConfiguredValue(dbUrl) && !/localhost|127\.0\.0\.1/.test(dbUrl))

  if (!hasNotifDb && !isConfiguredValue(dbUrl)) {
    warnings.push(
      'SUPABASE_DATABASE_URL is not set in backend/.env. Notifications/Wallet endpoints (port 8000) will fail DB checks until configured.',
    )
  }

  const nvidiaKey = effective.NVIDIA_API_KEY || process.env.NVIDIA_API_KEY || ''
  if (!isConfiguredValue(nvidiaKey)) {
    warnings.push(
      'NVIDIA_API_KEY is missing or placeholder in backend/.env. Inference gateway calls (POST /api/v1/inference) require a valid NVIDIA key.',
    )
  }

  const poolId =
    effective.COGNITO_USER_POOL_ID ||
    process.env.COGNITO_USER_POOL_ID ||
    frontendEnv?.VITE_COGNITO_USER_POOL_ID ||
    effective.VITE_COGNITO_USER_POOL_ID ||
    ''
  const clientId =
    effective.COGNITO_CLIENT_ID ||
    process.env.COGNITO_CLIENT_ID ||
    frontendEnv?.VITE_COGNITO_CLIENT_ID ||
    effective.VITE_COGNITO_CLIENT_ID ||
    ''

  if (!isConfiguredValue(poolId) || !isConfiguredValue(clientId)) {
    warnings.push(
      'COGNITO_USER_POOL_ID / COGNITO_CLIENT_ID are incomplete. Protected endpoints will fail closed (503) until configured in backend/.env or frontend/.env.',
    )
  }

  return {
    effective,
    fatalErrors,
    warnings,
    inferencePort: Number(effective.INFERENCE_PORT || process.env.INFERENCE_PORT || 8001),
    notificationsPort: Number(effective.NOTIFICATIONS_PORT || process.env.NOTIFICATIONS_PORT || 8000),
    searchPort: Number(effective.SEARCH_PORT || process.env.SEARCH_PORT || 8765),
  }
}

function buildPythonCandidates() {
  const isWin = process.platform === 'win32'
  const candidates = []

  if (process.env.INFERXE_PYTHON) {
    candidates.push({ label: 'INFERXE_PYTHON', command: process.env.INFERXE_PYTHON, prefixArgs: [] })
  }

  const venvNames = ['.venv311', '.venv', 'venv311', 'venv']
  for (const baseDir of [ROOT_DIR, BACKEND_DIR]) {
    for (const vName of venvNames) {
      const exePath = isWin
        ? path.join(baseDir, vName, 'Scripts', 'python.exe')
        : path.join(baseDir, vName, 'bin', 'python')
      if (fs.existsSync(exePath)) {
        candidates.push({
          label: path.relative(ROOT_DIR, exePath),
          command: exePath,
          prefixArgs: [],
        })
      }
    }
  }

  if (isWin) {
    candidates.push({ label: 'py -3.11', command: 'py', prefixArgs: ['-3.11'] })
    candidates.push({ label: 'py -3.12', command: 'py', prefixArgs: ['-3.12'] })
    candidates.push({ label: 'py -3', command: 'py', prefixArgs: ['-3'] })
    candidates.push({ label: 'python', command: 'python', prefixArgs: [] })
    candidates.push({ label: 'python3', command: 'python3', prefixArgs: [] })
  } else {
    candidates.push({ label: 'python3.11', command: 'python3.11', prefixArgs: [] })
    candidates.push({ label: 'python3.12', command: 'python3.12', prefixArgs: [] })
    candidates.push({ label: 'python3', command: 'python3', prefixArgs: [] })
    candidates.push({ label: 'python', command: 'python', prefixArgs: [] })
  }

  return candidates
}

function probePythonCandidate(candidate) {
  const probeScript = [
    'import importlib.util, json, sys',
    'core = ["fastapi", "uvicorn", "jwt", "cryptography", "dotenv", "psycopg2", "sqlalchemy", "httpx2", "openai"]',
    'opt = ["chromadb", "httpx", "ddgs"]',
    'print(json.dumps({"version": f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}", "executable": sys.executable, "missing_core": [m for m in core if importlib.util.find_spec(m) is None], "missing_opt": [m for m in opt if importlib.util.find_spec(m) is None]}))',
  ].join('; ')

  const res = spawnSync(candidate.command, [...candidate.prefixArgs, '-c', probeScript], {
    cwd: ROOT_DIR,
    encoding: 'utf8',
    timeout: 8000,
    windowsHide: true,
  })

  if (res.error || res.status !== 0 || !res.stdout) {
    return null
  }

  try {
    const info = JSON.parse(res.stdout.trim())
    return { ...candidate, ...info }
  } catch {
    return null
  }
}

function discoverPythonInterpreter() {
  const seenExecutables = new Set()
  const probed = []

  for (const candidate of buildPythonCandidates()) {
    const info = probePythonCandidate(candidate)
    if (!info) continue
    const normExe = path.resolve(info.executable).toLowerCase()
    if (seenExecutables.has(normExe)) continue
    seenExecutables.add(normExe)
    probed.push(info)

    // Ideal fast path: all core packages + chromadb installed
    if (info.missing_core.length === 0 && !info.missing_opt.includes('chromadb')) {
      return { selected: info, probed }
    }
  }

  const coreOnlyMatch = probed.find((info) => info.missing_core.length === 0)
  return { selected: coreOnlyMatch || null, probed }
}

function isPortOpen(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host })
    const finish = (result) => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(result)
    }
    socket.setTimeout(500)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

function httpGetJson(url, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => {
        body += chunk
      })
      res.on('end', () => {
        try {
          resolve({ ok: (res.statusCode || 500) < 500, status: res.statusCode, json: JSON.parse(body) })
        } catch {
          resolve({ ok: false, status: res.statusCode, json: null })
        }
      })
    })
    req.on('error', () => resolve({ ok: false, status: 0, json: null }))
    req.on('timeout', () => {
      req.destroy()
      resolve({ ok: false, status: 0, json: null })
    })
  })
}

async function waitForEndpoint(url, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const res = await httpGetJson(url, 2000)
    if (res.ok && res.json) return res
    await new Promise((r) => setTimeout(r, 400))
  }
  return null
}

function pipePrefixedStream(stream, prefix, isError = false) {
  if (!stream) return
  let buffer = ''
  stream.setEncoding('utf8')
  stream.on('data', (chunk) => {
    buffer += chunk
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (line.trim() === '') continue
      const target = isError ? process.stderr : process.stdout
      target.write(`${prefix} ${line}\n`)
    }
  })
  stream.on('end', () => {
    if (buffer.trim()) {
      const target = isError ? process.stderr : process.stdout
      target.write(`${prefix} ${buffer}\n`)
    }
  })
}

function killProcessTree(child) {
  if (!child || child.exitCode !== null || child.killed) return
  if (process.platform === 'win32' && child.pid) {
    try {
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      })
      return
    } catch {
      // Fall through to standard kill
    }
  }
  try {
    child.kill('SIGTERM')
  } catch {}
}

async function main() {
  console.log('\n[inferxe] Validating environment and Python runtime...')
  const envCheck = validateEnvironment()

  for (const warn of envCheck.warnings) {
    console.warn(`[warn] ${warn}`)
  }

  if (envCheck.fatalErrors.length > 0) {
    for (const err of envCheck.fatalErrors) {
      console.error(`[error] ${err}`)
    }
    process.exit(1)
  }

  const { selected, probed } = discoverPythonInterpreter()
  if (!selected) {
    console.error('[error] Could not find a Python interpreter with required Inferxe backend packages.')
    if (probed.length > 0) {
      for (const p of probed) {
        console.error(
          `  - ${p.label} (Python ${p.version}): missing ${p.missing_core.join(', ')}`,
        )
      }
    } else {
      console.error('  - No Python interpreter found on PATH or in .venv311 / .venv.')
    }
    console.error('[fix] Create a Python 3.11+ virtualenv and install dependencies:')
    console.error('      pip install -r backend/requirements.txt')
    process.exit(1)
  }

  console.log(
    `[python] Using ${selected.label} (Python ${selected.version})`,
  )
  if (selected.missing_opt.includes('chromadb')) {
    console.warn(
      '[warn] chromadb is not installed in this Python environment; RAG vector search (/api/chat) will degrade until `pip install -r backend/requirements.txt` is completed.',
    )
  }

  const { inferencePort, notificationsPort, searchPort } = envCheck
  const infPortOpen = await isPortOpen(inferencePort)
  const notifPortOpen = await isPortOpen(notificationsPort)

  if (CHECK_ONLY) {
    console.log(
      `[check] Environment & Python OK. Inference port ${inferencePort}: ${infPortOpen ? 'in use' : 'free'}, Notifications port ${notificationsPort}: ${notifPortOpen ? 'in use' : 'free'}.`,
    )
    process.exit(0)
  }

  const childEnv = {
    ...process.env,
    PYTHONPATH: [ROOT_DIR, BACKEND_DIR, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),
    PYTHONUTF8: '1',
    PYTHONIOENCODING: 'utf-8',
  }

  const children = []
  let shuttingDown = false

  const shutdownAll = (signalCode = 0) => {
    if (shuttingDown) return
    shuttingDown = true
    console.log('\n[inferxe] Stopping backend services...')
    for (const child of children) {
      killProcessTree(child.proc)
    }
    setTimeout(() => process.exit(signalCode), 250)
  }

  process.once('SIGINT', () => shutdownAll(0))
  process.once('SIGTERM', () => shutdownAll(0))
  process.once('SIGHUP', () => shutdownAll(0))
  process.once('SIGBREAK', () => shutdownAll(0))
  process.once('exit', () => {
    for (const child of children) {
      killProcessTree(child.proc)
    }
  })

  const reloadArgs = NO_RELOAD ? [] : ['--reload']
  const spawnSpecs = []

  // 1. Notifications & RAG Service (Port 8000)
  if (notifPortOpen) {
    const probe = await httpGetJson(`http://127.0.0.1:${notificationsPort}/api/notifications/db-status`)
    if (probe.ok) {
      console.log(`[notifications:${notificationsPort}] Already running and healthy; reusing existing service.`)
    } else {
      console.error(
        `[error] Port ${notificationsPort} is already in use by another process. Free port ${notificationsPort} or set NOTIFICATIONS_PORT in backend/.env.`,
      )
      process.exit(1)
    }
  } else {
    spawnSpecs.push({
      name: `notifications:${notificationsPort}`,
      cwd: ROOT_DIR,
      args: [
        ...selected.prefixArgs,
        '-m',
        'uvicorn',
        'backend.notifications.main:app',
        '--host',
        '127.0.0.1',
        '--port',
        String(notificationsPort),
        ...reloadArgs,
      ],
      healthUrl: `http://127.0.0.1:${notificationsPort}/health`,
    })
  }

  // 2. Inference, API Keys, SSH Keys & Notebooks Service (Port 8001)
  if (infPortOpen) {
    const probe = await httpGetJson(`http://127.0.0.1:${inferencePort}/api/v1/health`)
    if (probe.ok && probe.json?.service === 'inferxe-inference-api') {
      console.log(`[inference:${inferencePort}] Already running and healthy; reusing existing service.`)
    } else {
      console.error(
        `[error] Port ${inferencePort} is already in use by another process. Free port ${inferencePort} or set INFERENCE_PORT in backend/.env.`,
      )
      process.exit(1)
    }
  } else {
    spawnSpecs.push({
      name: `inference:${inferencePort}`,
      cwd: BACKEND_DIR,
      args: [
        ...selected.prefixArgs,
        '-m',
        'uvicorn',
        'inference.main:app',
        '--host',
        '127.0.0.1',
        '--port',
        String(inferencePort),
        ...reloadArgs,
      ],
      healthUrl: `http://127.0.0.1:${inferencePort}/api/v1/health`,
    })
  }

  // 3. Optional Web Search Proxy (Port 8765)
  if (WITH_SEARCH) {
    if (selected.missing_opt.includes('ddgs')) {
      console.warn('[warn] --with-search requested, but `ddgs` package is not installed; skipping port 8765.')
    } else if (!(await isPortOpen(searchPort))) {
      spawnSpecs.push({
        name: `search:${searchPort}`,
        cwd: ROOT_DIR,
        args: [...selected.prefixArgs, path.join(BACKEND_DIR, 'search', 'web_search_server.py')],
        healthUrl: `http://127.0.0.1:${searchPort}/health`,
      })
    }
  }

  if (spawnSpecs.length === 0) {
    console.log('\n[inferxe] Both backend services are already running cleanly.')
    console.log(`  - Notifications & RAG : http://127.0.0.1:${notificationsPort}/health`)
    console.log(`  - Inference & Compute : http://127.0.0.1:${inferencePort}/api/v1/health`)
    console.log('Run `npm run dev` in Terminal 2 to start the frontend.\n')
    process.exit(0)
  }

  for (const spec of spawnSpecs) {
    const proc = spawn(selected.command, spec.args, {
      cwd: spec.cwd,
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })

    const tag = `[${spec.name}]`
    pipePrefixedStream(proc.stdout, tag, false)
    pipePrefixedStream(proc.stderr, tag, true)

    proc.on('exit', (code, signal) => {
      if (shuttingDown) return
      console.error(
        `[error] ${spec.name} exited unexpectedly (code=${code}, signal=${signal || 'none'}). Shutting down remaining backend services.`,
      )
      shutdownAll(typeof code === 'number' && code !== 0 ? code : 1)
    })

    children.push({ ...spec, proc })
  }

  const healthResults = await Promise.all(
    children.map(async (c) => ({
      name: c.name,
      healthUrl: c.healthUrl,
      result: await waitForEndpoint(c.healthUrl, 45000),
    })),
  )

  const failedHealth = healthResults.filter((h) => !h.result)
  if (failedHealth.length > 0 && !shuttingDown) {
    for (const f of failedHealth) {
      console.error(`[error] ${f.name} did not respond on ${f.healthUrl} within timeout.`)
    }
  } else if (!shuttingDown) {
    console.log('\n' + '='.repeat(68))
    console.log(' Inferxe Local Backend Services Ready (Shared Supabase + Cognito)')
    console.log('='.repeat(68))
    console.log(` Notifications & RAG API : http://127.0.0.1:${notificationsPort}  (health: /health)`)
    console.log(` Inference & Compute API : http://127.0.0.1:${inferencePort}  (health: /api/v1/health)`)
    if (WITH_SEARCH && children.some((c) => c.name.startsWith('search:'))) {
      console.log(` Web Search Proxy        : http://127.0.0.1:${searchPort}  (health: /health)`)
    }
    console.log(' Next step (Terminal 2)  : npm run dev  ->  http://127.0.0.1:5173')
    console.log(' Press Ctrl+C to stop all backend services cleanly.')
    console.log('='.repeat(68) + '\n')
  }
}

main().catch((err) => {
  console.error('[error] Backend launcher failure:', err instanceof Error ? err.message : err)
  process.exit(1)
})
