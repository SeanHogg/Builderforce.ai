import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Vitest does not read tsconfig `paths`, so the shared cross-package contract
// (`@builderforce/agent-tools`, resolved via tsconfig paths for tsc + wrangler/esbuild
// bundling) needs an explicit resolve alias here too. Points at the package source
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
    alias: {
      '@builderforce/agent-tools': fileURLToPath(
        new URL('../packages/agent-tools/src/index.ts', import.meta.url),
      ),
      '@builderforce/agent-stall': fileURLToPath(
        new URL('../packages/agent-stall/src/index.ts', import.meta.url),
      ),
      // Was in `tsconfig.json` `paths` but NOT here, so `classifyTask.test.ts` and
      // everything downstream of it resolved this package only by luck of the
      // worker's module graph — `vitest run src/application/llm` failed the whole
      // directory with "Cannot find package '@builderforce/learned-routing'" while
      // the full-suite run passed. Every tsconfig path needs its alias twin.
      '@builderforce/learned-routing': fileURLToPath(
        new URL('../packages/learned-routing/src/index.ts', import.meta.url),
      ),
      '@builderforce/run-context': fileURLToPath(
        new URL('../packages/run-context/src/index.ts', import.meta.url),
      ),
      '@builderforce/creation-canvas-contract': fileURLToPath(
        new URL('../packages/creation-canvas-contract/src/index.ts', import.meta.url),
      ),
      // The third-party widget contract — the manifest shape, the permission
      // vocabulary and the postMessage allowlist the API enforces at registration
      // and the browser host enforces per message. Same source, two runtimes.
      '@builderforce/canvas-widget-protocol': fileURLToPath(
        new URL('../packages/canvas-widget-protocol/src/index.ts', import.meta.url),
      ),
    },
  },
});
