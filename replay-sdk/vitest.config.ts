import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { sourcePackageAliases } from '../scripts/sourcePackages.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'jsdom',
    testTimeout: 10_000,
  },
  resolve: {
    alias: [
      ...sourcePackageAliases(path.resolve(root, '..')),
      { find: /^rrweb$/, replacement: path.resolve(root, 'src/rrweb.mock.ts') },
    ],
  },
});
