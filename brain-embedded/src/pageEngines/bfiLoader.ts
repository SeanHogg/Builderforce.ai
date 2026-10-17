/**
 * THE `bfi-web` loader — the one way a host hands `createPageEngineSet` its `loadBfi`.
 *
 * `@seanhogg/bfi-web` is the vendored wasm-pack build of Synapse's engine (PRD 34 §3.1,
 * `packages/bfi-web`). This module dynamic-imports it, runs its wasm-bindgen initializer
 * with the wasm URL the HOST's bundler emitted — once, however many engines or calls ask
 * — and hands back the `BfiEngine` class in the shape `bfiEngine.ts` takes. Only the URL
 * differs per host (Next asset, Vite `?url`, `chrome.runtime.getURL`); everything else
 * lives here.
 *
 * It is its own entry (`@seanhogg/builderforce-brain-embedded/bfi`), never re-exported
 * from the root: `@seanhogg/bfi-web` is not published, so it stays EXTERNAL in this
 * package's build and only a host that links it may import this entry. An embed that
 * imports the root alone never meets the specifier.
 */

import type { BfiModule } from './bfiEngine';

/** The slice of the wasm-pack `--target web` module this loader uses. */
export interface BfiWebModule extends BfiModule {
  /** wasm-bindgen's initializer: fetches and instantiates the binary at `module_or_path`. */
  default(options: { module_or_path: string | URL }): Promise<unknown>;
}

/** Imports the package. Injected only by tests; a host never passes it. */
export type BfiWebImporter = () => Promise<BfiWebModule>;

const importBfiWeb: BfiWebImporter = () => import('@seanhogg/bfi-web') as unknown as Promise<BfiWebModule>;

let loaded: Promise<BfiModule> | undefined;
let loadedFrom: string | undefined;

/**
 * Load `bfi-web` with its binary at `wasmUrl`, initializing the wasm once per page.
 * A failed load is not cached, so a later call (a retry after going online) tries again.
 */
export function loadBfiWeb(wasmUrl: string | URL, importer: BfiWebImporter = importBfiWeb): Promise<BfiModule> {
  const url = String(wasmUrl);
  if (loaded) {
    // One wasm instance per page: a second URL cannot re-initialize it, and silently
    // serving the first binary under the second's name would hide a host wiring bug.
    if (loadedFrom !== url) console.warn(`bfi-web already initialized from ${loadedFrom}; ignoring ${url}`);
    return loaded;
  }
  loadedFrom = url;
  const attempt = (async (): Promise<BfiModule> => {
    const module = await importer();
    await module.default({ module_or_path: wasmUrl });
    return { BfiEngine: module.BfiEngine };
  })();
  loaded = attempt;
  attempt.catch(() => {
    if (loaded === attempt) {
      loaded = undefined;
      loadedFrom = undefined;
    }
  });
  return attempt;
}

/** A `loadBfi` for `createPageEngineSet`, bound to this host's wasm URL. */
export function bfiWebLoader(wasmUrl: string | URL | (() => string | URL | Promise<string | URL>)): () => Promise<BfiModule> {
  return async () => loadBfiWeb(typeof wasmUrl === 'function' ? await wasmUrl() : wasmUrl);
}

/** Tests only: forget the initialized module. */
export function resetBfiWebForTests(): void {
  loaded = undefined;
  loadedFrom = undefined;
}
