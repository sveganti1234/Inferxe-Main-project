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
    serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY,
    fetchImpl = globalThis.fetch,
  } = {},
) {
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase profile synchronization is not configured.')
  }

  const baseUrl = new URL(supabaseUrl)
  if (!['http:', 'https:'].includes(baseUrl.protocol)) {
    throw new Error('Supabase URL must use HTTP or HTTPS.')
  }

  const endpoint = new URL('/rest/v1/profiles?on_conflict=user_id', baseUrl)
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
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
