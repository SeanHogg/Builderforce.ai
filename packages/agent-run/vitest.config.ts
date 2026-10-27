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
const repoRoot = path.resolve(root, "..", "..");
// `@builderforce/agent-tools` (source-aliased above) re-exports its knowledge modules,
// which import `@seanhogg/builderforce-memory/working`. That package is built
// (`exports` → `dist/`), not source-only, so it is not in `sourcePackageAliases` — but
// the ws2 worktree has no node_modules for it, and its `working/` dist is pure
// (no `node:*`). Alias the subpath to the built entry so the alias-only gate resolves it.
const workingAlias = {
  find: /^@seanhogg\/builderforce-memory\/working$/,
  // `repoRoot` below is the ws2 dir itself (it holds `packages/` directly); the sibling
  // memory repo at the workspace root is FOUR levels up (ws2 → worktrees → .builderforce
  // → Builderforce.ai → agentic), then into builderforce-memory.
  replacement: path.resolve(repoRoot, "..", "..", "..", "..", "builderforce-memory", "packages", "memory", "dist", "working", "index.js"),
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
