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
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    // The `link:`ed brain-embedded package ships React as an external peer dep and
    // imports a bare `react`. Vite follows the symlink into ../brain-embedded/dist and
    // would resolve `react` from that package's own node_modules (absent in the
    // frontend-only CI job). Dedupe forces a single React copy — the frontend's — which
    // also prevents a second React instance breaking brain-embedded's context/hooks.
    dedupe: ['react', 'react-dom', 'react/jsx-runtime'],
  },
});
