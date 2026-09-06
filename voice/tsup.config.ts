import { defineConfig } from 'tsup';
import { libraryConfig } from '../scripts/tsup.base.mjs';

export default defineConfig(libraryConfig({
  entry: { index: 'src/index.ts' },
  // Optional client-side path — keep it a peer, never bundle the studio engine.
  external: ['@seanhogg/builderforce-studio'],
}));
