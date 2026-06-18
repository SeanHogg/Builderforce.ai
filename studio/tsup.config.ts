import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  outDir: 'dist',
  external: [
    'onnxruntime-web',
    '@huggingface/transformers',
    '@seanhogg/builderforce-memory-engine',
    '@seanhogg/builderforce-sdk',
  ],
  outExtension({ format }) {
    return { js: format === 'esm' ? '.mjs' : '.cjs' };
  },
});
