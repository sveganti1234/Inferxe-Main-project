import { createClient } from '@supabase/supabase-js'
import { assertExternalTargetAllowed } from './testSafety.js'

let adminClient
let cachedSignature = ''

const NON_LOCAL_ENVIRONMENTS = new Set(['production', 'prod', 'staging'])
export const LOCAL_MOCK_SUPABASE_URL = `http://127.0.0.1:${process.env.ADMIN_AUTH_PORT || '5174'}`

/**
 * The in-memory Supabase REST mock (backend/dev/mockSupabaseRest.js) is for local development only:
 * it must be switched on explicitly (INFERXE_LOCAL_MOCK_SUPABASE=1) and is refused whenever the
 * environment is marked production or staging (INFERXE_ENV / APP_ENV / NODE_ENV).
 */
export function isLocalMockSupabaseEnabled() {
  if (String(process.env.INFERXE_LOCAL_MOCK_SUPABASE || '').trim() !== '1') return false
  const markers = [process.env.INFERXE_ENV, process.env.APP_ENV, process.env.NODE_ENV]
  return !markers.some((v) => NON_LOCAL_ENVIRONMENTS.has(String(v || '').trim().toLowerCase()))
}

export function getSupabaseAdminClient() {
  // Fail closed: without real credentials there is no client, unless the local mock is explicitly
  // enabled, in which case unset values point at it (it does not check keys, so none is embedded).
  const useMock = isLocalMockSupabaseEnabled()
  const url = (process.env.SUPABASE_URL || (useMock ? LOCAL_MOCK_SUPABASE_URL : '')).trim()
  const serviceRoleKey = (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEY ||
    (useMock ? 'local-mock-no-secret' : '')
  ).trim()

  if (!url || !serviceRoleKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured on the backend.')
  }

  let parsedUrl
  try {
    parsedUrl = new URL(url)
  } catch {
    throw new Error('SUPABASE_URL must be a valid HTTP or HTTPS URL.')
  }
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('SUPABASE_URL must use HTTP or HTTPS.')
  }
  assertExternalTargetAllowed(url, 'Supabase admin client')

  if (
    serviceRoleKey.startsWith('sbp_') ||
    (serviceRoleKey.startsWith('sb_publishable_') && process.env.ADMIN_DEV_FALLBACK !== 'true')
  ) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY must be a server-side Supabase Secret or Service Role key.')
  }

  const signature = `${url}|${serviceRoleKey.slice(0, 12)}|${serviceRoleKey.length}`
  if (!adminClient || cachedSignature !== signature) {
    adminClient = createClient(url, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    })
    cachedSignature = signature
  }

  return adminClient
}
