import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    environment: 'node',
    // These tests talk to a real Postgres, because the property under test in
    // sale-transaction.test.ts is row-level locking. A mocked database would prove
    // nothing about it.
    setupFiles: ['./tests/setup.ts'],
    // Concurrency in test 1 is created inside the test with Promise.allSettled; running
    // whole files in parallel against one database would make results non-deterministic.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
