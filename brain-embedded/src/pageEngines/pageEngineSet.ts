/**
 * Every page engine a host carries, composed ONCE — so the web app, Rovr and the editor's
 * webview do not each wire the same three engines, cache and store.
 *
 * What a host supplies is only what differs between hosts: how to start its `bfi` Web
 * Worker (`bfiWorker` — a worker module calling `runBfiWorker()`, plus the wasm URLs;
 * every host passes one, and absent = the `bfi` engine is not offered and its catalog
 * rows read `engine_unavailable`) and an optional WebLLM worker. `bfi` never runs on the
 * page's own thread (`bfiWorkerEngine.ts`). What it gets back is the probe and
 * fetch the local-first stream takes, and the model store the picker drives.
 */

import type { LocalRuntimeProbe } from '@builderforce/local-inference';
import { promptApiEngine } from '../browserEngine';
import type { LocalFetch } from '../localFirstTransport';
import { createBfiWorkerEngine, type BfiWorkerEngineOptions } from './bfiWorkerEngine';
import { pageEnginesFetch, probePageEngines } from './fetchShim';
import { createHfModelStore, type HfModelStore } from './hfModelStore';
import { createLocalModelStore, type LocalModelStore } from './modelStore';
import type { PageEngine } from './types';
import { webGpuSupport } from './webgpu';
import { createWebLlmEngine } from './webllmEngine';

export interface PageEngineSet {
  engines: readonly PageEngine[];
  /** The picker's ONE API over every engine's downloads. */
  store: LocalModelStore;
  /** Every engine with something to serve. Memoized per engine; never downloads. */
  probe(options?: { fresh?: boolean }): Promise<LocalRuntimeProbe[]>;
  /** The local fetch: page engines answered in the page, everything else via `base`. */
  fetch(base?: LocalFetch): LocalFetch;
}

export interface PageEngineSetOptions {
  /** `bfi` in a dedicated Web Worker (every host: the web app, Rovr, the editor's
   *  webview — which also passes `backends: ['webgpu']`, its host's CPU `peerSupport` and
   *  `relayStore`). Absent = no `bfi` engine here. */
  bfiWorker?: Omit<BfiWorkerEngineOptions, 'store'>;
  /** Where `hf-file` models are stored; default this origin's Cache Storage. The editor
   *  webview passes the extension host's file cache, so a model is downloaded once. */
  hf?: HfModelStore;
  /** A module worker running WebLLM's `WebWorkerMLCEngineHandler`; absent = in-page. */
  webllmWorkerUrl?: string | URL;
}

export function createPageEngineSet(options: PageEngineSetOptions = {}): PageEngineSet {
  const hf = options.hf ?? createHfModelStore();
  const bfi = options.bfiWorker ? createBfiWorkerEngine({ ...options.bfiWorker, store: hf }) : undefined;
  const webllm = createWebLlmEngine(options.webllmWorkerUrl ? { workerUrl: options.webllmWorkerUrl } : {});
  const engines: PageEngine[] = [...(bfi ? [bfi] : []), webllm, promptApiEngine];
  const store = createLocalModelStore({
    ...(bfi ? { hf } : {}),
    webllm: webllm.models,
    support: { webllm: () => webGpuSupport(), ...(bfi ? { bfi: bfi.support } : {}) },
    engines,
  });
  return {
    engines,
    store,
    probe: (probeOptions) => probePageEngines(engines, probeOptions),
    fetch: (base) => pageEnginesFetch(engines, base),
  };
}
