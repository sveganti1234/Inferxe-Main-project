import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const BACKEND_DIR = path.resolve(__dirname, '..')
export const BACKEND_ENV_PATH = path.join(BACKEND_DIR, '.env')

const FORBIDDEN_FRONTEND_PREFIXES = ['VITE_SUPABASE_']
const FORBIDDEN_FRONTEND_SECRET_KEYS = new Set([
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_SECRET_KEY',
  'SUPABASE_URL',
])

/**
 * Parse .env file contents without evaluating shell code or mutating process.env.
 */
export function parseEnvContent(content) {
  const parsed = {}
  const lines = String(content || '').split(/\r?\n/)

  for (const rawLine of lines) {
    const trimmed = rawLine.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const line = trimmed.startsWith('export ') ? trimmed.slice(7).trim() : trimmed
    const eqIndex = line.indexOf('=')
    if (eqIndex <= 0) continue

    const key = line.slice(0, eqIndex).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue

    let value = line.slice(eqIndex + 1).trim()
    const quoteChar = value[0]
    if (quoteChar === '"' || quoteChar === "'") {
      let endIdx = -1
      for (let i = 1; i < value.length; i += 1) {
        if (value[i] === quoteChar && (quoteChar === "'" || value[i - 1] !== '\\')) {
          endIdx = i
          break
        }
      }
      if (endIdx !== -1) {
        const trailing = value.slice(endIdx + 1).trim()
        if (!trailing || trailing.startsWith('#')) {
          value = value.slice(1, endIdx)
        }
      }
    } else {
      const commentIndex = value.search(/\s+#/)
      if (commentIndex !== -1) {
        value = value.slice(0, commentIndex).trim()
      }
    }

    parsed[key] = value
  }

  return parsed
}

/**
 * Load server-side backend/.env credentials into targetEnv without overwriting
 * values that are already defined unless override=true.
 */
export function loadBackendEnv({
  envPath = BACKEND_ENV_PATH,
  override = false,
  targetEnv = process.env,
} = {}) {
  if (!fs.existsSync(envPath)) {
    return { loaded: false, envPath, keys: [] }
  }

  const content = fs.readFileSync(envPath, 'utf8')
  const parsed = parseEnvContent(content)
  const loadedKeys = []

  for (const [key, value] of Object.entries(parsed)) {
    if (override || targetEnv[key] === undefined) {
      targetEnv[key] = value
      loadedKeys.push(key)
    }
  }

  return { loaded: true, envPath, keys: loadedKeys }
}

/**
 * Reject any server-only Supabase credential or VITE_SUPABASE_* key placed in
 * frontend environment files so secrets cannot reach the React client bundle.
 */
export function assertNoFrontendSupabaseSecrets(frontendEnv = {}) {
  for (const [key, value] of Object.entries(frontendEnv)) {
    const isForbiddenPrefix = FORBIDDEN_FRONTEND_PREFIXES.some((prefix) => key.startsWith(prefix))
    const isForbiddenSecret = FORBIDDEN_FRONTEND_SECRET_KEYS.has(key)

    if ((isForbiddenPrefix || isForbiddenSecret) && String(value || '').trim() !== '') {
      throw new Error(
        `[security] Forbidden Supabase setting "${key}" detected in frontend env. Keep SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY strictly in backend/.env without a VITE_ prefix.`,
      )
    }

    if (key === 'VITE_SUPABASE_SERVICE_ROLE_KEY' || key === 'VITE_SUPABASE_SECRET_KEY') {
      throw new Error(
        `[security] Forbidden secret variable "${key}" declared in frontend env. Remove it from frontend/.env*.`,
      )
    }
  }
}
