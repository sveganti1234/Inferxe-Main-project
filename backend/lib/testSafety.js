/**
 * Test-isolation guard for the Node backend (same rules as backend/isolation_guard.py).
 *
 * A test process is: `node --test` (NODE_TEST_CONTEXT), a process that loaded tests/support/networkGuard.mjs
 * (INFERXE_NODE_TEST_GUARD), a *.test.(m)js file run directly, or INFERXE_TEST_MODE=1. In a test process:
 *   - the project .env files (production credentials) are never loaded (auth/envLoader.js);
 *   - external requests are refused before any network I/O, except loopback;
 *   - live integration mode (INFERXE_LIVE_SUPABASE_TESTS=1) additionally allows exactly one Supabase host, named in
 *     INFERXE_LIVE_SUPABASE_URL, after checking it is not the production project from backend/.env (or listed in
 *     INFERXE_PRODUCTION_SUPABASE_HOSTS). Live mode never loads .env and never lifts the guard for other hosts.
 * Messages name variables and host categories only; never URLs, hosts, keys or connection strings.
 * Production processes (no test context) are unaffected.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const BACKEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const PROJECT_ENV_FILES = [path.join(BACKEND_DIR, '.env'), path.join(BACKEND_DIR, '..', '.env')]

export const LIVE_FLAG = 'INFERXE_LIVE_SUPABASE_TESTS'
export const LIVE_URL_VAR = 'INFERXE_LIVE_SUPABASE_URL'
export const LIVE_KEY_VAR = 'INFERXE_LIVE_SUPABASE_SERVICE_ROLE_KEY'
export const PRODUCTION_HOSTS_VAR = 'INFERXE_PRODUCTION_SUPABASE_HOSTS'

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

export class TestSafetyError extends Error {
  constructor(message) {
    super(`[test-safety] ${message}`)
    this.name = 'TestSafetyError'
  }
}

export function isTestRun(env = process.env, argv = process.argv) {
  if (env.NODE_TEST_CONTEXT || env.INFERXE_NODE_TEST_GUARD === '1' || env.INFERXE_TEST_MODE === '1') return true
  return /\.test\.[cm]?js$/i.test(path.basename(String(argv?.[1] || '')))
}

export function liveSupabaseTestsEnabled(env = process.env) {
  return env[LIVE_FLAG] === '1'
}

export function isLoopbackHost(hostname) {
  return LOOPBACK_HOSTS.has(String(hostname || '').toLowerCase())
}

/** Category of a host for messages: never the host itself. */
export function classifyHost(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '')
  if (isLoopbackHost(h)) return 'loopback'
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(':')) return 'IP address'
  if (h.includes('supabase')) return 'supabase project'
  if (h.endsWith('.amazonaws.com') || h.includes('cognito')) return 'aws/cognito'
  if (h.includes('nvidia')) return 'nvidia api'
  return 'external host'
}

function hostOf(url) {
  try {
    return new URL(String(url)).hostname.toLowerCase()
  } catch {
    return ''
  }
}

function readEnvValue(file, name) {
  try {
    const line = fs.readFileSync(file, 'utf8').split(/\r?\n/).find((l) => l.trim().startsWith(`${name}=`))
    return line ? line.slice(line.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '') : ''
  } catch {
    return ''
  }
}

/** Hosts and keys of the production project (read from the project .env files, never exported). */
export function productionTargets(env = process.env) {
  const hosts = new Set()
  const keys = new Set()
  for (const file of PROJECT_ENV_FILES) {
    const host = hostOf(readEnvValue(file, 'SUPABASE_URL'))
    if (host) hosts.add(host)
    for (const name of ['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY']) {
      const key = readEnvValue(file, name)
      if (key) keys.add(key)
    }
  }
  for (const extra of String(env[PRODUCTION_HOSTS_VAR] || '').split(',')) {
    if (extra.trim()) hosts.add(extra.trim().toLowerCase())
  }
  return { hosts, keys }
}

/** The single Supabase host live tests may reach; throws (without revealing values) when unsafe. */
export function validateLiveTarget(env = process.env) {
  const url = String(env[LIVE_URL_VAR] || '').trim()
  const key = String(env[LIVE_KEY_VAR] || '').trim()
  if (!url || !key) {
    throw new TestSafetyError(
      `live mode (${LIVE_FLAG}=1) requires ${LIVE_URL_VAR} and ${LIVE_KEY_VAR} for a dedicated non-production ` +
        'Supabase project; the project .env files are never used by tests.',
    )
  }
  const host = hostOf(url)
  if (!host) throw new TestSafetyError(`${LIVE_URL_VAR} is not a valid URL.`)
  const prod = productionTargets(env)
  if (prod.hosts.has(host) || prod.keys.has(key)) {
    throw new TestSafetyError(
      `${LIVE_URL_VAR}/${LIVE_KEY_VAR} identify the production Supabase project (matches backend/.env or ` +
        `${PRODUCTION_HOSTS_VAR}); refusing to run live tests against it.`,
    )
  }
  return host
}

/** Live mode: expose only the validated live project to the code under test. */
export function applyLiveTarget(env = process.env) {
  validateLiveTarget(env)
  env.SUPABASE_URL = String(env[LIVE_URL_VAR]).trim()
  env.SUPABASE_SERVICE_ROLE_KEY = String(env[LIVE_KEY_VAR]).trim()
  delete env.SUPABASE_SECRET_KEY
}

/** Whether a test process may reach this host (loopback, or the validated live project in live mode). */
export function isHostAllowed(hostname, env = process.env) {
  if (isLoopbackHost(hostname)) return true
  return liveSupabaseTestsEnabled(env) && String(hostname || '').toLowerCase() === validateLiveTarget(env)
}

/** Throw before any request when a test would reach a disallowed host. No-op outside test processes. */
export function assertExternalTargetAllowed(url, label = 'Supabase', env = process.env) {
  if (!isTestRun(env)) return
  const hostname = hostOf(url)
  if (!hostname) throw new TestSafetyError(`${label} URL is not a valid URL; refusing to use it during tests.`)
  if (!isHostAllowed(hostname, env)) {
    throw new TestSafetyError(
      `blocked ${label} request during tests (${classifyHost(hostname)}). Mock the service or use a local ` +
        `test instance; live integration tests need ${LIVE_FLAG}=1 with ${LIVE_URL_VAR}.`,
    )
  }
}
