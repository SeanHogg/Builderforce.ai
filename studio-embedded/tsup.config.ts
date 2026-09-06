import { defineConfig } from 'tsup';
import { copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { libraryConfig, REACT_EXTERNALS } from '../scripts/tsup.base.mjs';

export default defineConfig(libraryConfig({
  entry: { index: 'src/index.ts' },
  external: [...REACT_EXTERNALS, '@seanhogg/builderforce-studio'],
  extra: {
    onSuccess: async () => {
      copyFileSync(resolve('src/styles.css'), resolve('dist/styles.css'));
    },
  },
}));
