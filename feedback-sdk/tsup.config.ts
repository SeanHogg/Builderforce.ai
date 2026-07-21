import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  // esm/cjs for bundlers + npm; iife (global.js) for the <script> snippet.
  format: ['esm', 'cjs', 'iife'],
  globalName: 'BuilderforceFeedback',
  dts: true,
  sourcemap: true,
  clean: true,
  outDir: 'dist',
  outExtension({ format }) {
    if (format === 'esm') return { js: '.mjs' };
    if (format === 'cjs') return { js: '.cjs' };
    return { js: '.global.js' };
  },
});
