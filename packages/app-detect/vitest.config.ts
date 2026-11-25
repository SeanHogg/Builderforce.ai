/**
 * Unit-test config for app detection. The package is pure TypeScript, but its `@builderforce/creation-canvas-contract` import is a
 * source-only package with no install of its own, so its tests resolve it through the registry's aliases, as every host's do.
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
