import { defineConfig } from 'vitest/config';

/**
 * The embed component mounts an iframe and exchanges postMessage events, so
 * tests run under jsdom (MessageEvent, window, iframe elements).
 */
export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
  },
});
