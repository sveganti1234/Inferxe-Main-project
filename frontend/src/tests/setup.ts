import { beforeEach, vi } from 'vitest'

// Mock fetch globally
globalThis.fetch = vi.fn()

// Every test signs in as the same fixture user: start each one with an empty page-data cache.
// Imported lazily so the cache's auth-store import never loads before a test file's vi.mock().
beforeEach(async () => {
  const { clearResourceCache } = await import('../features/customer/data/resourceCache')
  clearResourceCache()
})
