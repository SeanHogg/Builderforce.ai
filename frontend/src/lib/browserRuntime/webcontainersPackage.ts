/**
 * The ONE place the in-browser runtime package (`@seanhogg/builderforce-webcontainers`)
 * is loaded at run time — its main entry and its `check` entry.
 *
 * WHY a loader and not a plain `import()` at each call site: a dynamic import is
 * still part of the SERVER build. Webpack emits the package as an async chunk of
 * the edge compilation, and because these call sites sit in the root layout's
 * closure (the canvas run target, the site tools), next-on-pages copied the whole
 * runtime — ~0.8 MB of `webcontainers` + `webcontainers-core` + `esbuild-wasm` +
 * `es-module-lexer` — into the Worker, which must stay under Cloudflare's 10 MiB
 * compressed ceiling. None of it can run there: the runtime boots a service worker
 * and a relay frame, and every caller is a click handler in the browser.
 *
 * So each `import()` sits in a branch on `process.env.NEXT_RUNTIME`, which Next
 * defines at compile time: `'edge'` / `'nodejs'` in a server build, `''` in the
 * browser build. Webpack folds the server condition to a constant and prunes the
 * branch, so the package never enters the Worker; the browser bundle and tests
 * (where the variable is unset) load it exactly as before. It is a branch rather
 * than an early return because webpack prunes a constant-false branch but still
 * bundles an `import()` that follows a `return` (see `guestSampleResponse` in
 * `lib/apiClient.ts`, the same technique on `typeof window`).
 *
 * The `app` entry (pure spec validation, imported statically by the run target's
 * acceptance checks) is light and stays a normal import.
 */

type WebcontainersModule = typeof import('@seanhogg/builderforce-webcontainers');
type WebcontainersCheckModule = typeof import('@seanhogg/builderforce-webcontainers/check');

/** Rejection a server render gets — never reached in practice: no server path runs the runtime. */
function browserOnly(entry: string): Promise<never> {
  return Promise.reject(new Error(`${entry} runs in the browser only`));
}

/** The runtime's main entry (preview runtime, virtual file system, bundler, snapshot store). */
export function loadWebcontainers(): Promise<WebcontainersModule> {
  if (!process.env.NEXT_RUNTIME) {
    return import('@seanhogg/builderforce-webcontainers');
  }
  return browserOnly('@seanhogg/builderforce-webcontainers');
}

/** The runtime's type-checker entry. */
export function loadWebcontainersCheck(): Promise<WebcontainersCheckModule> {
  if (!process.env.NEXT_RUNTIME) {
    return import('@seanhogg/builderforce-webcontainers/check');
  }
  return browserOnly('@seanhogg/builderforce-webcontainers/check');
}
