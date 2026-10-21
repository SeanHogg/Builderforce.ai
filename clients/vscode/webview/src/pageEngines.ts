/**
 * The page engines THIS webview runs — `bfi` (the vendored `@seanhogg/bfi-web`, on
 * WebGPU, in its own Web Worker), WebLLM and the browser's built-in model — composed once
 * (brain-embedded's `createPageEngineSet`), and served to the extension host over the
 * bridge.
 *
 * Two readers, one set: the composer's `/` menu drives its model store directly, and the
 * host's runs reach its engines through `servePageEngines`. The webview's own transport
 * for a pinned page model answers in place through `fetch` (see `WorkspaceApp.tsx`).
 *
 * `bfi`'s models are the extension host's: its file cache is the ONE copy
 * (`hostModelStore.ts`), so a picker download lands there, the host's own `bfi` worker
 * serves it with this panel closed, and this webview's worker streams the same bytes back
 * (through the page — `relayStore` — since a worker cannot reach the host bridge). The
 * worker serves WebGPU only; the CPU belongs to the host's worker, whose support record
 * the picker reads over `modelFile.support` (`peerSupport`), so a model that fits only
 * the CPU is still offered here, downloaded into the host cache, and served there.
 * WebLLM keeps its own cache here.
 */
import {
  PAGE_ENGINE_REQUEST_TYPES,
  createPageEngineSet,
  deferredLocalModelStore,
  servePageEngines,
  type LocalFetch,
  type LocalModelStore,
  type PageEngineRequest,
  type PageEngineSet,
} from '@seanhogg/builderforce-brain-embedded';
import type { LocalDeviceSupport } from '@builderforce/local-inference';
// Vite emits the binary into `media/webview/` (kept by `dropWasmAssets`, which drops only
// the ONNX runtime's) and this is its URL relative to the bundle — a webview resource
// URI at runtime, covered by the shell's `connect-src https:` and `'wasm-unsafe-eval'`.
import bfiWasmUrl from '@seanhogg/bfi-web/bfi_web_bg.wasm?url';
// The worker bundle's URL (Vite `worker.format: 'es'`), a webview resource URI.
import bfiWorkerUrl from './bfiWorker.ts?worker&url';
import { MODEL_FILE_EVENT_TYPES, type ModelFileEvent } from '../../src/pageEngineBridgeProtocol';
import { createHostModelStore } from './hostModelStore';
import { onHostMessage, post, request } from './vscodeBridge';

/**
 * A module worker for a script on the webview's RESOURCE origin. A webview page may not
 * construct a Worker from another origin's URL, so the worker is a same-origin `blob:`
 * module (the shell's `worker-src blob:`) that imports the real one — whose own imports
 * and `import.meta.url` then resolve against the resource origin, as the page's do. A
 * blob worker inherits the page's CSP, so the shell's `script-src` (the resource origin,
 * `'wasm-unsafe-eval'`) and `connect-src` govern it too.
 */
export function resourceModuleWorker(url: string, name: string): Worker {
  const absolute = new URL(url, import.meta.url).href;
  const blob = URL.createObjectURL(new Blob([`import ${JSON.stringify(absolute)};`], { type: 'text/javascript' }));
  const worker = new Worker(blob, { type: 'module', name });
  // Revoked once the worker has surely fetched it — never before its script loads.
  setTimeout(() => URL.revokeObjectURL(blob), BLOB_WORKER_REVOKE_MS);
  return worker;
}

/** How long a blob worker's wrapper URL outlives the `new Worker` that fetches it. */
const BLOB_WORKER_REVOKE_MS = 60_000;

let set: PageEngineSet | undefined;

/** This webview's engines — built on first use. */
export function webviewPageEngines(): PageEngineSet {
  return (set ??= createPageEngineSet({
    bfiWorker: {
      create: () => resourceModuleWorker(bfiWorkerUrl, 'bfi'),
      wasmUrl: () => new URL(bfiWasmUrl, import.meta.url),
      // WebGPU only here: every CPU turn goes to the extension host's bfi worker, so CPU
      // decoding never runs beside this chat UI. Single-threaded artifact: a VS Code
      // webview is not cross-origin isolated, so the threaded build could not start here.
      backends: ['webgpu'],
      // The host's CPU engine's record, for the picker (read without its wasm).
      peerSupport: () => request<LocalDeviceSupport>('modelFile.support', {}),
      relayStore: true,
    },
    hf: createHostModelStore({
      request: (type, payload) => request(type, payload) as never,
      post: (type, payload) => post(type, payload),
      onEvent: (listener) => {
        const offs = MODEL_FILE_EVENT_TYPES.map((type) => onHostMessage<ModelFileEvent>(type, listener));
        return () => {
          for (const off of offs) off();
        };
      },
    }),
  }));
}

/** The picker's port onto this webview's model store, deferred like the engines. */
export const webviewLocalModelStore: LocalModelStore = deferredLocalModelStore(() => webviewPageEngines().store);

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
