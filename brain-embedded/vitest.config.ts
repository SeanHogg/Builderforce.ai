import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { sourcePackageAliases } from '../scripts/sourcePackages.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));

/**
 * The brain core ships React hooks/contexts that touch browser globals
 * (localStorage via pendingPrompt, fetch/ReadableStream via the streaming
 * client), so tests run under jsdom. `setup.ts` is the seam for any polyfills.
 *
 * The source-only packages are aliased from the registry, not left to the
 * `link:` symlinks: vite resolves a bare import from the REAL path of the file
 * that makes it, so `@builderforce/run-policy`'s own import of
 * `@builderforce/agent-stall` is looked up under `packages/run-policy`, which has
 * no install. The aliases resolve every edge from anywhere.
 */
export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
  resolve: {
    alias: sourcePackageAliases(path.resolve(root, '..')),
  },
});
