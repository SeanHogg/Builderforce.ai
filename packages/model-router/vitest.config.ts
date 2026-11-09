/**
 * Unit-test config for the model router. The package is pure, Worker-, browser- and
 * Node-safe TypeScript (no `node:*`, no DOM), so its tests need no environment and no
 * setup file.
 *
 * The `@builderforce/*` siblings it reads (agent-tools, learned-routing, model-catalog,
 * workload) are source-only packages (`exports` → `src/*.ts`), so a bare import
 * resolves nothing under plain node resolution — the same alias registry every host's
 * test config uses.
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
