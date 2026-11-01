/**
 * Unit-test config for the shared Brain UI package.
 *
 * The package HAS run tests for a while, but on vitest's bare defaults — no `include`, no
 * environment, no timeout — because there was no config file at all. That worked only by
 * accident: every test here happens to exercise a pure module (timeline model, think
 * blocks, ticket run gate, Evermind status, and now the Project 360 sunburst geometry),
 * so none of them needed a DOM. The first component test written would have failed on a
 * missing `document` with nothing pointing at the cause.
 *
 * `jsdom` is declared so that test is possible, and `include` is pinned so the runner
 * cannot start picking up `dist/` once the package has been built.
 *
 * `resolve.dedupe` pins `react` / `react-dom` to one copy: `@seanhogg/builderforce-brain-embedded`
 * is a `link:` dependency, so vite treats it as source and would otherwise resolve its bare
 * `react` import from its own node_modules, giving two Reacts (null hooks dispatcher).
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { dedupe: ['react', 'react-dom'] },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['**/node_modules/**', 'dist/**'],
    testTimeout: 10_000,
  },
});
