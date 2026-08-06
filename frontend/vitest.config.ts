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
     * It has to be raised somewhere because of how this fails: with the default
     * ceiling, `CreationCanvas.test.tsx` (a ~12,700-line component mounted ~77
     * times in one worker, each mount retained by jsdom) dies with
     * `ERR_WORKER_OUT_OF_MEMORY` partway through, the cases it never reached go
     * unrun, and vitest still prints a mostly-green summary — so the run LOOKS
     * like coverage while ~73 cases were skipped. The durable fix is splitting
     * both the component and its test file.
     */
    pool: 'threads',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@builderforce/creation-canvas-contract': path.resolve(__dirname, '../packages/creation-canvas-contract/src/index.ts'),
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
