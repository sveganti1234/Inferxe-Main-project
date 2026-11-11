import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
// @ts-ignore
import { createAdminAuthMiddleware } from '../backend/auth/adminAuth.js'
// @ts-ignore
import { createSSOAuthMiddleware } from '../backend/auth/ssoAuth.js'
// @ts-ignore
import { loadBackendEnv, assertNoFrontendSupabaseSecrets } from '../backend/auth/envLoader.js'

declare const process: any

export default defineConfig(({ command, mode }) => {
  const frontendPublicEnv = loadEnv(mode, process.cwd(), 'VITE_')
  const frontendSupabaseVars = loadEnv(mode, process.cwd(), ['VITE_SUPABASE_', 'SUPABASE_'])
  assertNoFrontendSupabaseSecrets(frontendSupabaseVars)

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

  const authPlugin = {
    name: 'inferxe-auth-middleware',
    configureServer(server: { middlewares: { use: (fn: any) => void } }) {
      server.middlewares.use(createSSOAuthMiddleware())
      server.middlewares.use(createAdminAuthMiddleware())
    },
    configurePreviewServer(server: { middlewares: { use: (fn: any) => void } }) {
      server.middlewares.use(createSSOAuthMiddleware())
      server.middlewares.use(createAdminAuthMiddleware())
    },
  }

  return {
    envPrefix: 'VITE_',
    plugins: [react(), authPlugin],
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: false,
      proxy: {
        '/api/notifications': { target: 'http://127.0.0.1:8000', changeOrigin: true },
        '/api/wallet': { target: 'http://127.0.0.1:8000', changeOrigin: true },
        '/api/customer': { target: 'http://127.0.0.1:5174', changeOrigin: true },
        '/api/deployments': { target: 'http://127.0.0.1:8000', changeOrigin: true },
        '/api/gpu': { target: 'http://127.0.0.1:8000', changeOrigin: true },
        '/api/chat': { target: 'http://127.0.0.1:8000', changeOrigin: true },
      },
    },
    preview: {
      host: '127.0.0.1',
      port: 4173,
      proxy: {
        '/api/notifications': { target: 'http://127.0.0.1:8000', changeOrigin: true },
        '/api/wallet': { target: 'http://127.0.0.1:8000', changeOrigin: true },
        '/api/customer': { target: 'http://127.0.0.1:5174', changeOrigin: true },
        '/api/deployments': { target: 'http://127.0.0.1:8000', changeOrigin: true },
        '/api/gpu': { target: 'http://127.0.0.1:8000', changeOrigin: true },
        '/api/chat': { target: 'http://127.0.0.1:8000', changeOrigin: true },
      },
    },
    build: { target: 'es2022', sourcemap: false },
  }
})
