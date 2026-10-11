import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'jsdom',
    testTimeout: 10_000,
  },
  resolve: {
    alias: {
      '@builderforce/interaction-contract': path.resolve(
        root,
        '../packages/interaction-contract/src/index.ts',
      ),
      rrweb: path.resolve(root, 'src/rrweb.mock.ts'),
    },
  },
});
