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
      // The upstream mambacode.js github tarball ships no `dist/`, so vite's
      // static import-analysis can't resolve `import('mambacode.js')` from
      // model-provider.ts even though webpack handles it at production
      // runtime. Route the specifier to a test-only stub that throws on
      // every entry point — model-provider's try/catch swallows the error
      // and the "gracefully handles missing mambacode.js" tests still pass.
      'mambacode.js': path.resolve(__dirname, './src/test/stubs/mambacode-stub.ts'),
    },
  },
});
