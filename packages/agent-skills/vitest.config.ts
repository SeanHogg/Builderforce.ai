/**
 * Unit-test config for the shared Agent Skills package. Pure, dependency-free
 * TypeScript (no `node:*`, no Worker/Env, no DOM), so its tests need no environment,
 * no setup file and no isolation — the same standalone gate the agent loop runs.
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    testTimeout: 10_000,
  },
});
