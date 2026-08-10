import { defineConfig } from 'tsup';

export default defineConfig({
  // `chatError` is a SECOND entry, not just a re-export off the root: it is pure
  // TypeScript with no React, so a non-React host (the VS Code extension process,
  // which renders chat errors in its own native surfaces) can share the ONE
  // error classifier without bundling React and the whole hook layer with it.
  entry: { index: 'src/index.ts', chatError: 'src/chatError.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  outDir: 'dist',
  external: ['react', 'react-dom', 'react/jsx-runtime'],
  outExtension({ format }) {
    return { js: format === 'esm' ? '.mjs' : '.cjs' };
  },
});
