/**
 * The page engines THIS webview runs — WebGPU `bfi` (the vendored `@seanhogg/bfi-web`),
 * WebLLM and the browser's built-in model — composed once (brain-embedded's
 * `createPageEngineSet`), and served to the extension host over the bridge.
 *
 * Two readers, one set: the composer's `/` menu drives its model store directly (the
 * downloads happen here, into this webview's Cache Storage), and the host's runs reach
 * its engines through `servePageEngines`. The webview's own transport for a pinned page
 * model answers in place through `fetch` (see `WorkspaceApp.tsx`).
 */
import {
  createPageEngineSet,
  type LocalModelStore,
  type PageEngineSet,
} from '@seanhogg/builderforce-brain-embedded';
import { bfiWebLoader } from '@seanhogg/builderforce-brain-embedded/bfi';
// Vite emits the binary into `media/webview/` (kept by `dropWasmAssets`, which drops only
// the ONNX runtime's) and this is its URL relative to the bundle — a webview resource
// URI at runtime, covered by the shell's `connect-src https:` and `'wasm-unsafe-eval'`.
import bfiWasmUrl from '@seanhogg/bfi-web/bfi_web_bg.wasm?url';
import type { PageEngineRequest } from '../../src/pageEngineBridgeProtocol';
import { PAGE_ENGINE_REQUEST_TYPES } from '../../src/pageEngineBridgeProtocol';
import { onHostMessage, post } from './vscodeBridge';
import { servePageEngines } from './pageEngineHost';

let set: PageEngineSet | undefined;

/** This webview's engines — built on first use. */
export function webviewPageEngines(): PageEngineSet {
  return (set ??= createPageEngineSet({ loadBfi: bfiWebLoader(() => new URL(bfiWasmUrl, import.meta.url)) }));
}

/** The picker's port onto this webview's model store, deferred like the engines. */
export const webviewLocalModelStore: LocalModelStore = {
  listLocalModels: () => webviewPageEngines().store.listLocalModels(),
  download: (ref, onProgress, signal) => webviewPageEngines().store.download(ref, onProgress, signal),
  remove: (ref) => webviewPageEngines().store.remove(ref),
  subscribe: (listener) => webviewPageEngines().store.subscribe(listener),
};

type LocalFetch = (input: string, init: RequestInit) => Promise<Response>;

/** The webview's local fetch: a page runtime's root (`http://bfi.local`, …) is answered
 *  by this webview's engines, anything else goes to `base` (the host-performed fetch). */
export function webviewLocalFetch(base: LocalFetch): LocalFetch {
  return (input, init) => webviewPageEngines().fetch(base)(input, init);
}

let installed = false;

/** Answer the host's page-engine requests for as long as this webview lives. Once. */
export function installPageEngineHost(): void {
  if (installed) return;
  installed = true;
  servePageEngines(() => webviewPageEngines().engines, {
    reply: (type, payload) => post(type, payload as Record<string, unknown>),
    listen: (onRequest) => {
      const offs = PAGE_ENGINE_REQUEST_TYPES.map((type) => onHostMessage<PageEngineRequest>(type, onRequest));
      return () => {
        for (const off of offs) off();
      };
    },
  });
}
