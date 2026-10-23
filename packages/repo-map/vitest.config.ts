/**
 * Standalone unit-test config for the cloud repo map. Pure TypeScript; its one
 * cross-package import (the shared symbol extractor) is source-only, so it is aliased
 * here exactly as `scripts/sourcePackages.mjs` aliases it for the api suite.
 */

import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@builderforce\/agent-tools\/symbols$/,
        replacement: fileURLToPath(new URL("../agent-tools/src/symbols.ts", import.meta.url)),
      },
    ],
  },
  test: {
    include: ["src/**/*.test.ts"],
    testTimeout: 10_000,
  },
});
