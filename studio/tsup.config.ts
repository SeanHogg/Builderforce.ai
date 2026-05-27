import { defineConfig } from 'tsup';
import { copyFileSync } from 'node:fs';
import { resolve } from 'node:path';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    engine: 'src/engine/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  outDir: 'dist',
  external: [
    'react',
    'react-dom',
    'react/jsx-runtime',
    'onnxruntime-web',
    '@huggingface/transformers',
    'mambacode.js',
    '@seanhogg/builderforce-sdk',
  ],
  outExtension({ format }) {
    return {
      js: format === 'esm' ? '.mjs' : '.cjs',
    };
  },
  onSuccess: async () => {
    copyFileSync(resolve('src/styles.css'), resolve('dist/styles.css'));
  },
});
