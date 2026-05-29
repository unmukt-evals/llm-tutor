import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      // `server-only` throws by default; under Vitest's Node env our server
      // modules (e.g. src/lib/cms/db.ts) are exercised directly, so route the
      // import to the package's React-server-condition no-op.
      'server-only': resolve(__dirname, './node_modules/server-only/empty.js'),
    },
  },
});
