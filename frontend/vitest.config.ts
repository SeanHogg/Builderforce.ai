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
    pool: 'threads',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
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
    dedupe: ['react', 'react-dom', 'react/jsx-runtime', 'react-markdown', 'remark-gfm'],
  },
});
