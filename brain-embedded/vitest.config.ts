import { defineConfig } from 'vitest/config';

/**
 * The brain core ships React hooks/contexts that touch browser globals
 * (localStorage via pendingPrompt, fetch/ReadableStream via the streaming
 * client), so tests run under jsdom. `setup.ts` is the seam for any polyfills.
 */
export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
});
