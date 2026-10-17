import { B as BfiModule } from './bfiEngine-c2iSOBaE.js';

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

/** The slice of the wasm-pack `--target web` module this loader uses. */
interface BfiWebModule extends BfiModule {
    /** wasm-bindgen's initializer: fetches and instantiates the binary at `module_or_path`. */
    default(options: {
        module_or_path: string | URL;
    }): Promise<unknown>;
}
/** Imports the package. Injected only by tests; a host never passes it. */
type BfiWebImporter = () => Promise<BfiWebModule>;
/**
 * Load `bfi-web` with its binary at `wasmUrl`, initializing the wasm once per page.
 * A failed load is not cached, so a later call (a retry after going online) tries again.
 */
declare function loadBfiWeb(wasmUrl: string | URL, importer?: BfiWebImporter): Promise<BfiModule>;
/** A `loadBfi` for `createPageEngineSet`, bound to this host's wasm URL. */
declare function bfiWebLoader(wasmUrl: string | URL | (() => string | URL | Promise<string | URL>)): () => Promise<BfiModule>;
/** Tests only: forget the initialized module. */
declare function resetBfiWebForTests(): void;

export { type BfiWebImporter, type BfiWebModule, bfiWebLoader, loadBfiWeb, resetBfiWebForTests };
