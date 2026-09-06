import { defineConfig } from 'tsup';
import { libraryConfig, REACT_EXTERNALS } from '../scripts/tsup.base.mjs';

export default defineConfig(libraryConfig({
  entry: { index: 'src/index.ts' },
  external: REACT_EXTERNALS,
}));
