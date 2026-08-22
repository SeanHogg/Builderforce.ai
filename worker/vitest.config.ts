import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { sourcePackageAliases } from '../scripts/sourcePackages.mjs';

const monorepoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    // Vitest does not read tsconfig `paths`, so every tsconfig path needs its
    // alias twin — and the twin is DERIVED, not typed out. This was a single
    // object-form entry for `@builderforce/ide-templates`, which was wrong twice:
    // it went stale the moment this worker imported a second shared package, and
    // the object form matches by PREFIX, so a subpath export like
    // `@builderforce/agent-tools/node-path` would have been rewritten to
    // `…/src/index.ts/node-path`. `sourcePackageAliases` returns anchored
    // patterns, which is order-independent and subpath-safe.
    alias: sourcePackageAliases(monorepoRoot),
  },
});
