/**
 * Unit-test config for the pipeline router. The package is pure TypeScript; its
 * `@builderforce/*` sibling (agent-stall — the ONE request-intent classifier) is a
 * source-only package (`exports` → `src/*.ts`), so a bare import resolves nothing
 * under plain node resolution — the same alias registry every host's test config
 * uses (`scripts/sourcePackages.mjs`).
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { sourcePackageAliases } from "../../scripts/sourcePackages.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(root, "..", "..");

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    testTimeout: 10_000,
  },
  resolve: {
    alias: sourcePackageAliases(repoRoot),
  },
});
