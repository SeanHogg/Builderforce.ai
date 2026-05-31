import { defineConfig } from 'vitest/config';

/**
 * studio-embedded ships React components that touch canvas / ImageBitmap APIs,
 * so its tests run under jsdom (not the default node env the headless `studio`
 * engine uses). `setup.ts` polyfills the browser globals jsdom lacks
 * (createImageBitmap, URL.createObjectURL) so component tests don't crash on
 * them. See the Consolidated Gap Register entry that motivated this harness.
 */
export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
});
