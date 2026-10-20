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
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: [
        'src/data/**',
        'src/session.ts',
        'src/totp.ts',
        'src/csrf.ts',
        'src/hibp.ts',
        'src/keys.ts',
        'src/authz.ts',
        'src/password.ts',
        'src/rateLimit.ts',
        'src/migrate/**',
        'src/routes/auth.ts',
        'src/routes/mfa.ts',
        'src/routes/trash.ts',
        'src/routes/workspaces.ts',
        'src/middleware.ts',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        statements: 80,
        branches: 75,
      },
    },
  },
})
