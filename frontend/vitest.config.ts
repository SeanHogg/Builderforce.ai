import { defineConfig, Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';

/** Treat *.md files as raw string exports, matching the webpack asset/source loader in next.config.js. */
const rawMarkdown: Plugin = {
  name: 'raw-markdown',
  load(id) {
    if (id.endsWith('.md')) {
      const content = fs.readFileSync(id, 'utf-8');
      return `export default ${JSON.stringify(content)}`;
    }
  },
};

export default defineConfig({
  plugins: [react(), rawMarkdown],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
    // Use worker threads, not child-process forks: the default `forks` pool
    // fails to spawn workers in constrained/sandboxed CI environments
    // (`Timeout waiting for worker to respond`); threads run the suite cleanly.
    /**
     * The worker heap is NOT raised here — it is raised on the runner, by the
     * `test` script (`node --max-old-space-size=…`). A worker thread inherits the
     * parent's heap ceiling, and none of the levers this file has reach it:
     * vitest 4 deleted `poolOptions.threads.resourceLimits` (silently — it just
     * warns and raises nothing), and `execArgv` is rejected outright by Node,
     * which refuses V8 flags on a worker and then fails to start ANY worker.
     *
     * It is still worth having: a suite of jsdom mounts this size has no reason
     * to run near the default ceiling.
     *
     * It is NOT, however, what made `CreationCanvas.test.tsx` die with
     * `ERR_WORKER_OUT_OF_MEMORY` — that was an unbounded render/effect loop in
     * the next-intl mock, which returned a new `t` per render and so invalidated
     * every `useMemo` hanging off it. Fixed in `src/test/setup.ts`; the file now
     * completes in ~160s. Recorded here because this comment previously blamed
     * the component's size and prescribed splitting it, which would not have
     * helped.
     */
    pool: 'threads',
    /**
     * Heavy jsdom mounts, measured against a shared thread pool rather than an
     * idle one. A directory run of the canvas passes comfortably; the same files
     * inside a 56-file `src/components` run get starved and were cut off
     * mid-assertion. Neither ceiling can make a wrong assertion pass — `waitFor`
     * POLLS, and a test that finishes early never spends its budget — so the
     * only thing a longer ceiling buys is that a correct assertion is not
     * reported as a failure because the scheduler was busy.
     */
    testTimeout: 60_000,
    hookTimeout: 60_000,
    /**
     * A jsdom document is built for every test FILE, and 155 of the 257 test files
     * are `src/lib` — router-free logic that never touches a DOM. Measured, that
     * directory spent 23.9s actually running 1,887 tests and 1,688s of cumulative
     * worker time constructing environments for them: 194s wall to assert on pure
     * functions.
     *
     * So `src/lib` runs in `node` and everything that renders keeps jsdom. The 21
     * lib files that DO need a document (storage, `window` events, hooks, anything
     * mounting) carry their own `@vitest-environment jsdom` docblock, which
     * overrides the project. That way the requirement is stated by the file that
     * has it, and a new DOM-using lib test declares itself rather than silently
     * failing against a central glob nobody remembers to update.
     */
    projects: [
      {
        extends: true,
        test: {
          name: 'lib',
          include: ['src/lib/**/*.test.{ts,tsx}'],
          environment: 'node',
        },
      },
      {
        extends: true,
        test: {
          name: 'dom',
          // Overriding `exclude` replaces vitest's defaults, so they are restated.
          include: ['src/**/*.test.{ts,tsx}'],
          exclude: ['**/node_modules/**', '**/dist/**', 'src/lib/**'],
          environment: 'jsdom',
        },
      },
    ],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@builderforce/creation-canvas-contract': path.resolve(__dirname, '../packages/creation-canvas-contract/src/index.ts'),
      '@builderforce/canvas-widget-protocol': path.resolve(__dirname, '../packages/canvas-widget-protocol/src/index.ts'),
    },
    // The `link:`ed sibling packages (brain-embedded, brain-ui) ship their deps as
    // external peers and import them bare. Vite follows the symlink into the sibling's
    // dist and would resolve those bare imports from that package's own node_modules
    // (absent in the frontend-only CI job). Dedupe forces resolution from the
    // frontend's node_modules instead:
    //  - react/react-dom: a single React copy (also prevents a second React instance
    //    breaking brain-embedded's context/hooks);
    //  - react-markdown/remark-gfm: brain-ui/dist imports these bare and brain-ui has
    //    no installed node_modules in the frontend-only job, so they must resolve here.
    //  - @seanhogg/builderforce-brain-embedded: brain-ui/dist imports it bare; it lives
    //    in the frontend's node_modules (link: dep) but not in brain-ui's, so dedupe it.
    dedupe: ['react', 'react-dom', 'react/jsx-runtime', 'react-markdown', 'remark-gfm', '@seanhogg/builderforce-brain-embedded'],
  },
});
