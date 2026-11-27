import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
// @ts-ignore
import path from 'path'
// @ts-ignore
import fs from 'fs'
// @ts-ignore
import { pathToFileURL } from 'url'
// @ts-ignore
import { FRONTEND_DIR, ROOT_DIR, loadBackendEnv, assertNoFrontendSupabaseSecrets, collectFrontendEnvForSecurityCheck } from '../backend/auth/envLoader.js'
declare const process: any
declare const __dirname: any

export default defineConfig(({ command, mode }) => {
  const envDir = FRONTEND_DIR
  const frontendPublicEnv = loadEnv(mode, envDir, 'VITE_')
  const frontendSecurityEnv = collectFrontendEnvForSecurityCheck({ envDir, mode })
  assertNoFrontendSupabaseSecrets({
    ...frontendSecurityEnv,
    ...frontendPublicEnv,
  })

  // Keep VITE_* variables available to Node server middleware (e.g. Cognito config),
  // and load server-only Supabase credentials exclusively from backend/.env during serve.
  for (const [key, value] of Object.entries(frontendPublicEnv)) {
    if (process.env[key] === undefined) {
      process.env[key] = value
    }
  }
  if (command === 'serve') {
    loadBackendEnv()
    loadBackendEnv({ envPath: path.join(ROOT_DIR, '.env'), override: false })
  }

  const notificationsPort = process.env.NOTIFICATIONS_PORT || '8002'
  const inferencePort = process.env.INFERENCE_PORT || '8001'
  const notificationsTarget = `http://127.0.0.1:${notificationsPort}`
  const inferenceTarget = `http://127.0.0.1:${inferencePort}`

  const apiProxy = {
    '/api/v1': { target: inferenceTarget, changeOrigin: true },
    '/api/customer': { target: 'http://127.0.0.1:5174', changeOrigin: true },
    '/api/notifications': { target: notificationsTarget, changeOrigin: true },
    '/api/wallet': { target: notificationsTarget, changeOrigin: true },
    '/api/deployments': { target: notificationsTarget, changeOrigin: true },
    '/api/gpu': { target: notificationsTarget, changeOrigin: true },
    '/api/chat': { target: notificationsTarget, changeOrigin: true },
    '/api/workspace': { target: notificationsTarget, changeOrigin: true },
    '/api/health': { target: notificationsTarget, changeOrigin: true },
  }

  const verdeloMiddleware = (req: any, res: any, next: any) => {
    const u = req.url?.split('?')[0].split('#')[0]
    if (u === '/verdelo' || u === '/verdelo/') {
      const htmlPath = path.resolve(__dirname, 'public/verdelo/index.html')
      if (fs.existsSync(htmlPath)) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        return res.end(fs.readFileSync(htmlPath, 'utf-8'))
      }
    }
    next()
  }

  const plugins: any[] = [react()]

  if (command === 'serve') {
    // @ts-ignore
    // Resolve from frontend/, not from the bundled config's temp folder (node_modules/.vite-temp/).
    const loadDevModule = (specifier: string) => import(/* @vite-ignore */ pathToFileURL(path.resolve(FRONTEND_DIR, specifier)).href)
    const authPlugin = {
      name: 'inferxe-auth-middleware',
      async configureServer(server: { middlewares: { use: (fn: any) => void } }) {
        server.middlewares.use(verdeloMiddleware)
        try {
          const [mockMod, ssoMod, custMod, adminMod, sbMod] = await Promise.all([
            loadDevModule('../backend/dev/mockSupabaseRest.js'),
            loadDevModule('../backend/auth/ssoAuth.js'),
            loadDevModule('../backend/auth/customerAuth.js'),
            loadDevModule('../backend/auth/adminAuth.js'),
            loadDevModule('../backend/api/supabaseApi.js'),
          ]) as any[]
          server.middlewares.use(mockMod.createMockSupabaseMiddleware())
          server.middlewares.use(ssoMod.createSSOAuthMiddleware())
          server.middlewares.use(custMod.createCustomerAuthMiddleware())
          server.middlewares.use(adminMod.createAdminAuthMiddleware())
          server.middlewares.use(sbMod.createSupabaseApiMiddleware())
        } catch (err) {
          // Without these, /api/admin, /api/superadmin and SSO routes return 404 in local development
          console.error('[inferxe] Backend dev middleware failed to load:', err)
        }
      },
      async configurePreviewServer(server: { middlewares: { use: (fn: any) => void } }) {
        server.middlewares.use(verdeloMiddleware)
        try {
          const [mockMod, ssoMod, custMod, adminMod, sbMod] = await Promise.all([
            loadDevModule('../backend/dev/mockSupabaseRest.js'),
            loadDevModule('../backend/auth/ssoAuth.js'),
            loadDevModule('../backend/auth/customerAuth.js'),
            loadDevModule('../backend/auth/adminAuth.js'),
            loadDevModule('../backend/api/supabaseApi.js'),
          ]) as any[]
          server.middlewares.use(mockMod.createMockSupabaseMiddleware())
          server.middlewares.use(ssoMod.createSSOAuthMiddleware())
          server.middlewares.use(custMod.createCustomerAuthMiddleware())
          server.middlewares.use(adminMod.createAdminAuthMiddleware())
          server.middlewares.use(sbMod.createSupabaseApiMiddleware())
        } catch (err) {
          // Without these, /api/admin, /api/superadmin and SSO routes return 404 in local development
          console.error('[inferxe] Backend dev middleware failed to load:', err)
        }
      },
    }
    plugins.push(authPlugin)
  }

  return {
    envPrefix: 'VITE_',
    plugins,
    server: {
      host: '127.0.0.1',
      port: 5173,
      // Fail loudly when 5173 is taken: the backends' CORS allowlists only accept 5173, and the next free
      // port would be 5175 (5174 is the auth server), where every API call is silently CORS-blocked.
      strictPort: true,
      proxy: apiProxy,
    },
    preview: {
      host: '127.0.0.1',
      port: 4173,
      proxy: apiProxy,
    },
    build: { target: 'es2022', sourcemap: false },
  }
})
