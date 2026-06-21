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
  },
  resolve: {
    alias: {
      '@builderforce/agent-tools': fileURLToPath(
        new URL('../packages/agent-tools/src/index.ts', import.meta.url),
      ),
    },
  },
});
