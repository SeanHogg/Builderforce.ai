/**
 * Unit-test config for the shared tool contract. This package is pure, dependency-free
 * TypeScript (no `node:*`, no Worker/Env), so its tests need no environment, no setup
 * file and no isolation — they are the fastest gate in the repo and run standalone in CI.
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    testTimeout: 10_000,
  },
});
