/**
 * Every page engine a host carries, composed ONCE — so the web app, Rovr and the editor's
 * webview do not each wire the same three engines, cache and store.
 *
 * What a host supplies is only what differs between hosts: the vendored `bfi-web` loader
 * (`bfiWebLoader(wasmUrl)` from the `/bfi` entry — every host passes one; absent = the
 * `bfi` engine is not offered, and its catalog rows read
 * `engine_unavailable`) and an optional WebLLM worker. What it gets back is the probe and
 * fetch the local-first stream takes, and the model store the picker drives.
 */

import type { LocalRuntimeProbe } from '@builderforce/local-inference';
import { promptApiEngine } from '../browserEngine';
import type { LocalFetch } from '../localFirstTransport';
import { createBfiEngine, type BfiModule } from './bfiEngine';
import { pageEnginesFetch, probePageEngines } from './fetchShim';
import { createHfModelStore } from './hfModelStore';
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
  /** The vendored `bfi-web` module loader; absent = no `bfi` engine on this host. */
  loadBfi?: () => Promise<BfiModule>;
  /** A module worker running WebLLM's `WebWorkerMLCEngineHandler`; absent = in-page. */
  webllmWorkerUrl?: string | URL;
}

export function createPageEngineSet(options: PageEngineSetOptions = {}): PageEngineSet {
  const hf = createHfModelStore();
  const bfi = options.loadBfi ? createBfiEngine({ loadBfi: options.loadBfi, store: hf }) : undefined;
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
