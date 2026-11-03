import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
// @ts-ignore
import { createAdminAuthMiddleware } from '../backend/auth/adminAuth.js'

declare const process: any

export default defineConfig(({ mode }) => {
  // Load environment variables including non-VITE_ server variables for development
  const env = loadEnv(mode, process.cwd(), '')
  Object.assign(process.env, env)

  const adminAuthPlugin = {
    name: 'inferxe-admin-auth-middleware',
    configureServer(server: { middlewares: { use: (fn: any) => void } }) {
      server.middlewares.use(createAdminAuthMiddleware())
    },
    configurePreviewServer(server: { middlewares: { use: (fn: any) => void } }) {
      server.middlewares.use(createAdminAuthMiddleware())
    },
  }

  return {
    plugins: [react(), adminAuthPlugin],
    server: { host: '127.0.0.1', port: 5173, strictPort: false },
    preview: { host: '127.0.0.1', port: 4173 },
    build: { target: 'es2022', sourcemap: false },
  }
})
