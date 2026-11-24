/**
 * Unit-test config for agents in a Web Container. The package is pure TypeScript (no `node:*`, no DOM in its sources), so its
 * tests need no environment, no setup file and no isolation. Its `@builderforce/*` imports are source-only packages, resolved
 * through the registry's aliases as every host's are.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { sourcePackageAliases } from "../../scripts/sourcePackages.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export default defineConfig({
  resolve: { alias: sourcePackageAliases(repoRoot) },
  test: {
    include: ["src/**/*.test.ts"],
    testTimeout: 10_000,
  },
});
