import { defineConfig } from 'tsup';
import { libraryConfig, REACT_EXTERNALS } from '../../scripts/tsup.base.mjs';

export default defineConfig(libraryConfig({
  entry: { index: 'src/index.ts' },
  // React + the markdown libs + the brain core are provided by the consumer
  // (deduped with the host app / webview) — never bundled into this UI package.
  external: [
    ...REACT_EXTERNALS,
    'react-markdown',
    'remark-gfm',
    '@seanhogg/builderforce-brain-embedded',
  ],
}));
