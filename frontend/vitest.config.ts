import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/tests/**/*.test.ts', 'src/tests/**/*.test.tsx'],
    setupFiles: ['./src/tests/setup.ts'],
    // Tests that render the whole app cold-load the lazy console bundle; allow for slow machines.
    testTimeout: 20000,
  },
})
