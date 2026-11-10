/**
 * Unit-test config for the shared tool contract. This package is pure, dependency-free
 * TypeScript (no `node:*`, no Worker/Env), so its tests need no environment, no setup
 * file and no isolation — they are the fastest gate in the repo and run standalone in CI.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { sourcePackageAliases } from "../../scripts/sourcePackages.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// The delta adapters import `@builderforce/sarif` by source; a source-only package has no
// install, so tests resolve it through the registry's aliases, as every host's do.
export default defineConfig({
  resolve: { alias: sourcePackageAliases(repoRoot) },
  test: {
    include: ["src/**/*.test.ts"],
    testTimeout: 10_000,
  },
});
