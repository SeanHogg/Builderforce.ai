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
// `@seanhogg/builderforce-memory` is a BUILT package (`exports` → `dist/`), not
// source-only, so it is not in `sourcePackageAliases`. This package imports its pure
// `/handoff` subpath (the packer the compaction policy binds), and `@builderforce/
// agent-tools` (source-aliased above) imports its `/working` subpath. A checkout without
// those packages' node_modules cannot resolve either, and both subpaths are pure (no
// `node:*`), so each is aliased to the sibling memory repo's built entry when that repo
// is present. It sits beside Builderforce.ai, at a depth that depends on the checkout
// (the main tree, or a worktree under `.builderforce/worktrees/`), so it is found
// walking up. No sibling ⇒ no alias, and the installed dependency resolves it.
const MEMORY_SUBPATHS = ["working", "handoff"] as const;
function siblingMemoryEntry(from: string, subpath: string): string | null {
  const entry = path.join("builderforce-memory", "packages", "memory", "dist", subpath, "index.js");
  for (let dir = from; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, entry);
    if (existsSync(candidate)) return candidate;
    if (path.dirname(dir) === dir) return null;
  }
}
const memoryAliases = MEMORY_SUBPATHS.flatMap((subpath) => {
  const replacement = siblingMemoryEntry(repoRoot, subpath);
  return replacement ? [{ find: new RegExp(`^@seanhogg/builderforce-memory/${subpath}$`), replacement }] : [];
});

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    testTimeout: 10_000,
  },
  resolve: {
    alias: [...sourcePackageAliases(repoRoot), ...memoryAliases],
  },
});
