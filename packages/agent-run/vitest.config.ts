/**
 * Unit-test config for the one agent. The package is Worker-, browser- and Node-safe
 * (no `node:*`, no DOM), so its tests need no environment, no setup file and no
 * isolation — the same standalone gate the kernel package runs.
 *
 * The `@builderforce/*` siblings are source-only packages (their `exports` point at
 * TypeScript in `src/`), so a bare import resolves nothing under plain node
 * resolution — the same alias registry brain-embedded and the other consumers use.
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { sourcePackageAliases } from "../../scripts/sourcePackages.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(root, "..", "..");
// `@builderforce/agent-tools` (source-aliased above) re-exports its knowledge modules,
// which import `@seanhogg/builderforce-memory/working`. That package is built
// (`exports` → `dist/`), not source-only, so it is not in `sourcePackageAliases`, and a
// checkout without its node_modules cannot resolve it. Its `working/` dist is pure (no
// `node:*`), so alias the subpath to the sibling memory repo's built entry. That repo
// sits beside Builderforce.ai, at a depth that depends on the checkout (the main tree,
// or a worktree under `.builderforce/worktrees/`), so it is found walking up.
const WORKING_ENTRY = path.join("builderforce-memory", "packages", "memory", "dist", "working", "index.js");
function siblingWorkingEntry(from: string): string {
  for (let dir = from; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, WORKING_ENTRY);
    if (existsSync(candidate)) return candidate;
    if (path.dirname(dir) === dir) return path.join(from, "..", WORKING_ENTRY);
  }
}
const workingAlias = {
  find: /^@seanhogg\/builderforce-memory\/working$/,
  replacement: siblingWorkingEntry(repoRoot),
};

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    testTimeout: 10_000,
  },
  resolve: {
    alias: [...sourcePackageAliases(repoRoot), workingAlias],
  },
});
