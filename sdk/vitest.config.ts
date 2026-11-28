import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { sourcePackageAliases } from '../scripts/sourcePackages.mjs';

export default defineConfig({
  resolve: { alias: sourcePackageAliases(fileURLToPath(new URL('..', import.meta.url))) },
});
