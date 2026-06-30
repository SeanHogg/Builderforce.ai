import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  outDir: 'dist',
  // React + the markdown libs + the brain core are provided by the consumer
  // (deduped with the host app / webview) — never bundled into this UI package.
  external: [
    'react',
    'react-dom',
    'react/jsx-runtime',
    'react-markdown',
    'remark-gfm',
    '@seanhogg/builderforce-brain-embedded',
  ],
  outExtension({ format }) {
    return { js: format === 'esm' ? '.mjs' : '.cjs' };
  },
});
