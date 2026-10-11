/**
 * Unit-test config for the interaction contract. Pure TypeScript — no DOM
 * globals at module scope, no Worker/Env — so the tests need no environment
 * and no setup file.
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    testTimeout: 10_000,
  },
});
