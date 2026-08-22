import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    // Vitest does not read tsconfig `paths`, so the starter scaffolds this
    // worker's file router seeds need an explicit alias too. Every tsconfig path
    // needs its alias twin.
    alias: {
      '@builderforce/ide-templates': fileURLToPath(
        new URL('../packages/ide-templates/src/index.ts', import.meta.url),
      ),
    },
  },
});
