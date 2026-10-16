import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { sourcePackageAliases } from '../../scripts/sourcePackages.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * This package imports its siblings by source (`@builderforce/model-catalog`), and a
 * source-only package has no install of its own — so its tests resolve them through the
 * registry's aliases, exactly as every host's test config does.
 */
export default defineConfig({
  resolve: { alias: sourcePackageAliases(repoRoot) },
});
