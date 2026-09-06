import { defineConfig } from 'tsup';
import { libraryConfig } from '../scripts/tsup.base.mjs';

export default defineConfig(libraryConfig({ entry: ['src/index.ts'] }));
