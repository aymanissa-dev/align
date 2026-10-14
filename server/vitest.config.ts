import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    isolate: false,
    globalSetup: ['./test/globalSetup.ts'],
    setupFiles: ['./test/setup.ts'],
    globalSetupTimeout: 180000,
    hookTimeout: 30000,
    testTimeout: 20000,
  },
})
