/**
 * Vitest Configuration for Conflict Detection Tests
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules', 'dist', 'build'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules', 'dist', 'build', 'tests', '**/*.config.ts'],
    },
    testTimeout: 10000,
    hookTimeout: 10000,
  },
});
