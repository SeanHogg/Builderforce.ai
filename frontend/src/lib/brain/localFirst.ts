/**
 * LOCAL FIRST for the web app's Brain — a turn that a model running IN THIS PAGE can take
 * is answered on this device, and everything else goes to the gateway exactly as before.
 *
 * The page engines are brain-embedded's (PRD 34): Chrome's built-in model (Prompt API),
 * WebLLM models the person downloaded, and our WebGPU `bfi` running 1-bit Bonsai (the
 * vendored `@seanhogg/bfi-web`, its binary emitted by this app's bundler). Nothing here
 * decides anything: the routing step — a pinned page model, otherwise local first with
 * the invisible failover — is brain-embedded's `createHostModelStream`, the one Rovr and
 * the editor run too. This module only lends it the page: the engines' probes as the
 * local runtimes, and their ONE fetch shim as the local transport.
 *
 * SSR-safe: nothing touches `window` until a call runs, and a server (or a browser with
 * no engine ready) simply probes as "no local runtime". Probing never downloads — models
 * arrive only through the picker's `store`.
 */

import {
  createHostModelStream,
  createPageEngineSet,
  streamChatCompletion,
  type BrainStreamFn,
  type BrainTransport,
  type PageEngineSet,
} from '@seanhogg/builderforce-brain-embedded';
import { bfiWebLoader } from '@seanhogg/builderforce-brain-embedded/bfi';

let pageEngines: PageEngineSet | undefined;

/** This page's engines and their model store — built on first use, one per page. The
 *  model picker drives `store`; the Brain stream below reads `probe` and `fetch`. */
export function browserPageEngines(): PageEngineSet {
  return (pageEngines ??= createPageEngineSet({
    // The binary's URL comes from `@seanhogg/bfi-web/wasm-url` — a relative
    // `new URL(…, import.meta.url)` inside the package, which webpack and Turbopack both
    // emit as a static asset. Imported lazily, so the wasm is fetched only when a
    // downloaded Bonsai model is first probed or run, never on page load.
    loadBfi: bfiWebLoader(async () => (await import('@seanhogg/bfi-web/wasm-url')).bfiWasmUrl),
  }));
}


/** The Brain stream over `transport`, served by a model in this page first. */
export function createBrowserLocalFirstStream(transport: BrainTransport): BrainStreamFn {
  // Built per call, never at module load: this is called while the root layout's config
  // module initializes, which must stay free of work — so the engines are only reached
  // inside the fns below, when a call runs.
  const cloud: BrainStreamFn = (opts, handlers) => streamChatCompletion({ ...opts, transport }, handlers);
  return createHostModelStream({
    // A model the person PINNED from the picker's on-device list (`local/bfi/…`,
    // `local/webllm/…`) arrives as the call's own `model` and runs in this page (the
    // default page-pin resolution); nothing else is a pin here.
    cloud: () => cloud,
    // Memoized per engine inside brain-embedded, so asking per call costs nothing while
    // nothing moved.
    probes: () => browserPageEngines().probe(),
    // Every request that is not a page engine's own route passes straight through.
    fetch: (input, init) => browserPageEngines().fetch(transport.fetch)(input, init),
  });
}
