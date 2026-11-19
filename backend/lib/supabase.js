import { createClient } from '@supabase/supabase-js'

let adminClient
let cachedSignature = ''

export function getSupabaseAdminClient() {
  const url = process.env.SUPABASE_URL?.trim()
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY)?.trim()

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

  if (serviceRoleKey.startsWith('sbp_') || serviceRoleKey.startsWith('sb_publishable_')) {
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
