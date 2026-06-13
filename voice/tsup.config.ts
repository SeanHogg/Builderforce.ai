import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  outDir: 'dist',
  // Optional client-side path — keep it a peer, never bundle the studio engine.
  external: ['@seanhogg/builderforce-studio'],
  outExtension({ format }) {
    return { js: format === 'esm' ? '.mjs' : '.cjs' };
  },
});
