import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { sourcePackageAliases } from "../../scripts/sourcePackages.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * Unit-test config for the shared loop-breakers. Pure TypeScript; it imports
 * `@builderforce/agent-tools` by source, and a source-only package has no install of its
 * own — so its tests resolve it through the registry's aliases, as every host's do.
 */
export default defineConfig({
  resolve: { alias: sourcePackageAliases(repoRoot) },
  test: {
    include: ["src/**/*.test.ts"],
    testTimeout: 10_000,
  },
});
