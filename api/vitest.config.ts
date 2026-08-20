import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Snapshot the working tree BEFORE anything is read, for the mid-run-edit detector in
 * `test/treeStability.ts`.
 *
 * It has to happen here, not in the globalSetup's `setup()`. Vitest runs globalSetup
 * AFTER Vite boots and transforms — measured at >25s into a run on this suite — by which
 * point most of the source has already been read and an edit made at t=12s would be
 * baked into the "before" snapshot and therefore invisible. This config module is the
 * first thing evaluated, so it is the only honest place to take the baseline.
 *
 * Handed over in an env var because config and globalSetup run in the same process but
 * share no module scope. Best-effort: a checkout without git simply leaves it unset and
 * the detector no-ops.
 */
try {
  process.env.BF_TREE_BEFORE = execFileSync('git', ['status', '--porcelain'], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
} catch {
  // Not a git checkout, or git unavailable — the detector stays silent.
}

// Vitest does not read tsconfig `paths`, so the shared cross-package contract
// (`@builderforce/agent-tools`, resolved via tsconfig paths for tsc + wrangler/esbuild
// bundling) needs an explicit resolve alias here too. Points at the package source
// (vitest transforms TS on the fly).
export default defineConfig({
  test: {
    // Reset the module-global L1 read-through cache before every test so
    // cache-backed tests are order-independent (see test/setup.ts).
    setupFiles: ['./test/setup.ts'],
    // Reports (never fails on) the working tree being edited mid-run — the cause of
    // the long-standing "a different file fails each run" flake. See test/treeStability.ts.
    globalSetup: ['./test/treeStability.ts'],
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
      '@builderforce/creation-canvas-contract': fileURLToPath(
        new URL('../packages/creation-canvas-contract/src/index.ts', import.meta.url),
      ),
    },
  },
});
