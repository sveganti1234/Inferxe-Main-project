function profileFromCognitoClaims(claims) {
  const email = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : ''
  const fullName = typeof claims.name === 'string' ? claims.name.trim() : ''
  const username = typeof claims.preferred_username === 'string'
    ? claims.preferred_username.trim()
    : ''

  if (!claims.sub || !email || !email.includes('@')) {
    throw new Error('Verified Cognito profile is missing its subject or email.')
  }

  return {
    user_id: claims.sub,
    full_name: fullName || email.split('@')[0],
    email,
    username: username || email.split('@')[0],
  }
}

export async function upsertCognitoProfile(
  claims,
  {
    supabaseUrl = process.env.SUPABASE_URL,
    secretKey = process.env.SUPABASE_SECRET_KEY,
    serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY,
    fetchImpl = globalThis.fetch,
  } = {},
) {
  const trimmedSecretKey = String(secretKey || '').trim()
  const trimmedServiceRoleKey = String(serviceRoleKey || '').trim()
  const apiKey = trimmedSecretKey || trimmedServiceRoleKey
  if (!supabaseUrl || !apiKey) {
    throw new Error(
      'Supabase profile synchronization requires SUPABASE_URL and SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY.',
    )
  }

  if (apiKey.startsWith('sbp_') || apiKey.startsWith('sb_publishable_')) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY must be the server-side Supabase secret/service role key.')
  }

  const baseUrl = new URL(supabaseUrl)
  if (!['http:', 'https:'].includes(baseUrl.protocol)) {
    throw new Error('Supabase URL must use HTTP or HTTPS.')
  }

  const headers = {
    apikey: apiKey,
    'Content-Type': 'application/json',
    Prefer: 'resolution=merge-duplicates,return=minimal',
  }
  if (!apiKey.startsWith('sb_secret_')) {
    headers.Authorization = `Bearer ${apiKey}`
  }

  const endpoint = new URL('/rest/v1/profiles?on_conflict=user_id', baseUrl)
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(profileFromCognitoClaims(claims)),
  })

  if (!response.ok) {
    let errorInfo = {}
    try {
      const responseBody = await response.json()
      errorInfo = {
        code: typeof responseBody.code === 'string' ? responseBody.code : undefined,
        message: typeof responseBody.message === 'string'
          ? responseBody.message.slice(0, 500)
          : undefined,
      }
    } catch {
      errorInfo.message = `Supabase returned HTTP ${response.status}.`
    }

    const error = new Error(errorInfo.message || `Supabase returned HTTP ${response.status}.`)
    error.status = response.status
    error.code = errorInfo.code
    throw error
  }
}
