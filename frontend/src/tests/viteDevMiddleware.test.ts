// @vitest-environment node
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadConfigFromFile } from 'vite'

// Vite bundles vite.config.ts into node_modules/.vite-temp/ before running it. The backend dev middlewares are
// imported at runtime there, so a path resolved relative to that temp file silently loaded nothing and
// /api/admin/* and /api/superadmin/* returned 404 in `npm run dev`.
describe('vite dev server middleware', () => {
  it('registers every backend dev middleware when the config runs from its bundled temp file', async () => {
    const root = path.resolve(__dirname, '../..')
    const loaded = await loadConfigFromFile({ command: 'serve', mode: 'development' }, path.join(root, 'vite.config.ts'), root)
    const plugin = (loaded!.config.plugins as any[]).flat().find((p) => p?.name === 'inferxe-auth-middleware')
    const used: unknown[] = []
    await plugin.configureServer({ middlewares: { use: (fn: unknown) => used.push(fn) } })
    expect(used).toHaveLength(6) // verdelo + mock Supabase, SSO, customer, admin, Supabase API
  }, 30000)

  it('keeps backend middleware out of production builds', async () => {
    const root = path.resolve(__dirname, '../..')
    const loaded = await loadConfigFromFile({ command: 'build', mode: 'production' }, path.join(root, 'vite.config.ts'), root)
    expect((loaded!.config.plugins as any[]).flat().some((p) => p?.name === 'inferxe-auth-middleware')).toBe(false)
  }, 30000)
})
