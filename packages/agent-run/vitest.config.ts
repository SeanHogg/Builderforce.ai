/**
 * Unit-test config for the one agent. The package is Worker-, browser- and Node-safe
 * (no `node:*`, no DOM), so its tests need no environment, no setup file and no
 * isolation — the same standalone gate the kernel package runs.
 *
 * The `@builderforce/*` siblings are source-only packages (their `exports` point at
 * TypeScript in `src/`), so a bare import resolves nothing under plain node
 * resolution — the same alias registry brain-embedded and the other consumers use.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { sourcePackageAliases } from "../../scripts/sourcePackages.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    testTimeout: 10_000,
  },
  resolve: {
    alias: sourcePackageAliases(path.resolve(root, "..", "..")),
  },
});
