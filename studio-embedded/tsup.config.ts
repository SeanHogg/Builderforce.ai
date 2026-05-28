import { defineConfig } from 'tsup';
import { copyFileSync } from 'node:fs';
import { resolve } from 'node:path';

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  outDir: 'dist',
  external: [
    'react',
    'react-dom',
    'react/jsx-runtime',
    '@seanhogg/builderforce-studio',
  ],
  outExtension({ format }) {
    return { js: format === 'esm' ? '.mjs' : '.cjs' };
  },
  onSuccess: async () => {
    copyFileSync(resolve('src/styles.css'), resolve('dist/styles.css'));
  },
});
