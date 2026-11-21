function sendJson(res, statusCode, data) {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(data))
}

/**
 * Reject the former direct-provider flow. Social sign-in is handled by Cognito
 * Hosted UI so its authorization state and token exchange remain provider-managed.
 */
export function createSSOAuthMiddleware() {
  return function ssoAuthMiddleware(req, res, next) {
    const path = (req.url || '/').split('?')[0]
    if (!path.startsWith('/api/auth/')) return next()

    return sendJson(res, 410, {
      ok: false,
      error: 'Direct social sign-in is disabled. Start GitHub or Google sign-in through Cognito Hosted UI.',
    })
  }
}
