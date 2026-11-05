// @ts-nocheck
import crypto from 'node:crypto'

function redirect(res, location) {
  res.statusCode = 302
  if (typeof res.setHeader === 'function') {
    res.setHeader('Location', location)
  }
  if (typeof res.writeHead === 'function') {
    try {
      res.writeHead(302, { Location: location })
    } catch {}
  }
  res.end()
}

function sendJson(res, statusCode, data) {
  res.statusCode = statusCode
  if (typeof res.setHeader === 'function') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  }
  res.end(JSON.stringify(data))
}

/**
 * Creates connect/http middleware to handle `/api/auth/*` SSO authentication endpoints.
 * Handles GitHub and Google OAuth/SSO redirects, callbacks, and provider discovery.
 */
export function createSSOAuthMiddleware() {
  return async function ssoAuthMiddleware(req, res, next) {
    const rawUrl = req.url || '/'
    const [parsedPath, queryString] = rawUrl.split('?')
    const queryParams = new URLSearchParams(queryString || '')

    // Only intercept /api/auth routes (skip /api/admin)
    if (!parsedPath.startsWith('/api/auth') || parsedPath.startsWith('/api/admin')) {
      return next()
    }

    // CORS pre-flight
    if (req.method === 'OPTIONS') {
      res.statusCode = 204
      if (typeof res.setHeader === 'function') {
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
      }
      return res.end()
    }

    const host = req.headers.host || '127.0.0.1:5173'
    const protocol =
      req.headers['x-forwarded-proto'] ||
      (host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https')
    const origin = req.headers.origin || `${protocol}://${host}`

    const githubClientId = (process.env.GITHUB_CLIENT_ID || process.env.VITE_GITHUB_CLIENT_ID || '').trim()
    const githubClientSecret = (process.env.GITHUB_CLIENT_SECRET || '').trim()

    const googleClientId = (process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID || '').trim()
    const googleClientSecret = (process.env.GOOGLE_CLIENT_SECRET || '').trim()

    // 1. GET /api/auth/github — Redirect to GitHub
    if (parsedPath === '/api/auth/github') {
      const callbackUrl = `${origin}/api/auth/callback/github`
      const state = crypto.randomBytes(16).toString('hex')

      if (githubClientId) {
        const authUrl = `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(
          githubClientId,
        )}&redirect_uri=${encodeURIComponent(callbackUrl)}&scope=read:user%20user:email&state=${state}`
        return redirect(res, authUrl)
      } else {
        // Redirect to official GitHub sign-in page
        return redirect(res, 'https://github.com/login')
      }
    }

    // 2. GET /api/auth/google — Redirect to Google SSO
    if (parsedPath === '/api/auth/google') {
      const callbackUrl = `${origin}/api/auth/callback/google`
      const state = crypto.randomBytes(16).toString('hex')
      const nonce = crypto.randomBytes(12).toString('hex')

      if (googleClientId) {
        const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(
          googleClientId,
        )}&redirect_uri=${encodeURIComponent(
          callbackUrl,
        )}&response_type=code&scope=openid%20profile%20email&state=${state}&nonce=${nonce}&prompt=select_account`
        return redirect(res, authUrl)
      } else {
        // Redirect to official Google SSO sign-in page
        return redirect(
          res,
          'https://accounts.google.com/signin/v2/identifier?flowName=GlifWebSignIn&flowEntry=ServiceLogin',
        )
      }
    }

    // 3. GET /api/auth/callback/github or /api/auth/github/callback
    if (parsedPath === '/api/auth/callback/github' || parsedPath === '/api/auth/github/callback') {
      const code = queryParams.get('code')
      let email = 'github.user@inferxe.com'
      let name = 'GitHub User'

      if (code && githubClientId && githubClientSecret) {
        try {
          const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            body: JSON.stringify({
              client_id: githubClientId,
              client_secret: githubClientSecret,
              code,
            }),
          })
          const tokenData = await tokenRes.json()
          if (tokenData.access_token) {
            const userRes = await fetch('https://api.github.com/user', {
              headers: {
                Authorization: `Bearer ${tokenData.access_token}`,
                'User-Agent': 'Inferxe-Platform',
              },
            })
            const userData = await userRes.json()
            if (userData.email) email = userData.email
            if (userData.name || userData.login) name = userData.name || userData.login

            if (!userData.email) {
              const emailsRes = await fetch('https://api.github.com/user/emails', {
                headers: {
                  Authorization: `Bearer ${tokenData.access_token}`,
                  'User-Agent': 'Inferxe-Platform',
                },
              })
              const emailsData = await emailsRes.json()
              const primaryEmail = emailsData.find((e) => e.primary && e.verified)
              if (primaryEmail) email = primaryEmail.email
            }
          }
        } catch (err) {
          console.error('GitHub token exchange error:', err)
        }
      }

      const ssoToken = `ix-gh-${crypto.randomBytes(12).toString('hex')}`
      const returnUrl = `/login?sso=1&provider=github&email=${encodeURIComponent(email)}&name=${encodeURIComponent(
        name,
      )}&token=${ssoToken}`

      return redirect(res, returnUrl)
    }

    // 4. GET /api/auth/callback/google or /api/auth/google/callback
    if (parsedPath === '/api/auth/callback/google' || parsedPath === '/api/auth/google/callback') {
      const code = queryParams.get('code')
      let email = 'google.user@inferxe.com'
      let name = 'Google User'

      if (code && googleClientId && googleClientSecret) {
        try {
          const callbackUrl = `${origin}/api/auth/callback/google`
          const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              code,
              client_id: googleClientId,
              client_secret: googleClientSecret,
              redirect_uri: callbackUrl,
              grant_type: 'authorization_code',
            }).toString(),
          })
          const tokenData = await tokenRes.json()
          if (tokenData.access_token) {
            const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
              headers: { Authorization: `Bearer ${tokenData.access_token}` },
            })
            const userData = await userRes.json()
            if (userData.email) email = userData.email
            if (userData.name) name = userData.name
          }
        } catch (err) {
          console.error('Google token exchange error:', err)
        }
      }

      const ssoToken = `ix-goog-${crypto.randomBytes(12).toString('hex')}`
      const returnUrl = `/login?sso=1&provider=google&email=${encodeURIComponent(email)}&name=${encodeURIComponent(
        name,
      )}&token=${ssoToken}`

      return redirect(res, returnUrl)
    }

    // 5. GET /api/auth/providers — Information endpoint
    if (parsedPath === '/api/auth/providers' && req.method === 'GET') {
      return sendJson(res, 200, {
        github: {
          name: 'GitHub',
          enabled: true,
          configured: Boolean(githubClientId),
          authUrl: '/api/auth/github',
        },
        google: {
          name: 'Google SSO',
          enabled: true,
          configured: Boolean(googleClientId),
          authUrl: '/api/auth/google',
        },
      })
    }

    return next()
  }
}
