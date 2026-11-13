import path from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'tests/unit/**/*.test.ts',
      'tests/integration/**/*.test.ts',
      'tests/security/**/*.test.ts',
    ],
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 20000,
    hookTimeout: 20000,
    pool: 'threads',
    isolate: true,
    reporters: ['default'],
  },
  resolve: {
    alias: {
      '@': path.resolve(process.cwd()),
      // `server-only` throws outside a React Server Component graph; tests import
      // server modules directly, so alias it to an empty module.
      'server-only': path.resolve(process.cwd(), 'tests/mocks/server-only.ts'),
    },
  },
});
