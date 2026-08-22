import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { sourcePackageAliases } from '../scripts/sourcePackages.mjs';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

// Vitest does not read tsconfig `paths`, so the source-only shared packages
// (`@builderforce/agent-tools`, resolved via tsconfig paths for tsc + wrangler/esbuild
// bundling) need explicit resolve aliases here too. They point at the package source
// (vitest transforms TS on the fly).
export default defineConfig({
  test: {
    // Reset the module-global L1 read-through cache before every test so
    // cache-backed tests are order-independent (see test/setup.ts).
    setupFiles: ['./test/setup.ts'],
    /**
     * Worker threads, not the default `forks` pool. This suite is ~520 files whose
     * cost is almost entirely module loading — measured at 320s wall, of which the
     * tests themselves were 116s and importing was 1233s of cumulative worker time.
     * A fork pays a fresh process AND a cold module graph per file; threads reuse the
     * transform cache, which takes the same suite to 140s with identical results.
     *
     * `isolate` stays ON deliberately. Turning it off takes this to ~35s, and 104
     * tests across 26 files then fail: module-global state (the read-through L1 cache
     * among them) is reset per TEST by `test/setup.ts`, never per FILE, so files
     * sharing a worker registry see each other's writes. The 105s that isolation
     * costs is buying real independence, not overhead — do not trade it away without
     * first making that state per-file.
     */
    pool: 'threads',
  },
  resolve: {
    // Derived from the package manifests, never listed: every tsconfig path
    // needs its alias twin, and hand-keeping the two lists in step failed —
    // `@builderforce/learned-routing` was in `tsconfig.json` and not here, so
    // `vitest run src/application/llm` failed the whole directory with "Cannot
    // find package" while the full-suite run passed on luck of the module graph.
    alias: sourcePackageAliases(REPO_ROOT),
  },
});
