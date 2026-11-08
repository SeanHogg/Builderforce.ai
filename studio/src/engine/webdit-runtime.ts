/**
 * The ONLY browser symbols studio takes from `@webdit/runtime`.
 *
 * `webdit-engine.ts` lazy-imports THIS file rather than the package, so the
 * bundler sees named re-exports and drops the rest of the runtime's surface —
 * notably `loadBundleFromDir`, whose Node-only `fs/promises`/`path` imports must
 * never reach `dist` (a namespace `import('@webdit/runtime')` cannot be
 * tree-shaken). Add a symbol here only when studio actually calls it.
 */
export { loadBundleFromBuffers, runDenoiseLoop } from '@webdit/runtime';
