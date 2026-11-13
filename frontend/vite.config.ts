import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
// @ts-ignore
import { createAdminAuthMiddleware } from '../backend/auth/adminAuth.js'
// @ts-ignore
import { createCustomerAuthMiddleware } from '../backend/auth/customerAuth.js'
// @ts-ignore
import { createSupabaseApiMiddleware } from '../backend/api/supabaseApi.js'
// @ts-ignore
import { createSSOAuthMiddleware } from '../backend/auth/ssoAuth.js'
// @ts-ignore
import { FRONTEND_DIR, loadBackendEnv, assertNoFrontendSupabaseSecrets, collectFrontendEnvForSecurityCheck } from '../backend/auth/envLoader.js'
declare const process: any

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
  }

  const notificationsPort = process.env.NOTIFICATIONS_PORT || '8000'
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

  const authPlugin = {
    name: 'inferxe-auth-middleware',
    configureServer(server: { middlewares: { use: (fn: any) => void } }) {
      server.middlewares.use(createSSOAuthMiddleware())
      server.middlewares.use(createCustomerAuthMiddleware())
      server.middlewares.use(createAdminAuthMiddleware())
      server.middlewares.use(createSupabaseApiMiddleware())
    },
    configurePreviewServer(server: { middlewares: { use: (fn: any) => void } }) {
      server.middlewares.use(createSSOAuthMiddleware())
      server.middlewares.use(createCustomerAuthMiddleware())
      server.middlewares.use(createAdminAuthMiddleware())
      server.middlewares.use(createSupabaseApiMiddleware())
    },
  }

  return {
    envPrefix: 'VITE_',
    plugins: [react(), authPlugin],
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: false,
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
