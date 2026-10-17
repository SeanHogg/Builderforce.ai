/**
 * LOCAL FIRST for the web app's Brain — a turn that a model running IN THIS PAGE can take
 * is answered on this device, and everything else goes to the gateway exactly as before.
 *
 * The page engines are brain-embedded's (PRD 34): Chrome's built-in model (Prompt API),
 * WebLLM models the person downloaded, and our WebGPU `bfi` running 1-bit Bonsai (the
 * vendored `@seanhogg/bfi-web`, its binary emitted by this app's bundler). Nothing here
 * decides anything. Which calls are open to local-first is `localFirstApplies` (a named model or `byo_pool` always goes to the
 * cloud — the rule the editor applies too); which model may take a call (a tool turn only
 * to a tool-capable one, never a prompt the window cannot hold) is the shared plan; and
 * the failover that makes a refusal in the page invisible is `createLocalFirstStream`'s.
 * This module only lends them the page: the engines' probes as the local runtimes, and
 * their ONE fetch shim as the local transport.
 *
 * SSR-safe: nothing touches `window` until a call runs, and a server (or a browser with
 * no engine ready) simply probes as "no local runtime". Probing never downloads — models
 * arrive only through the picker's `store`.
 */

import {
  createHandoffFit,
  createLocalFirstStream,
  createLocalStream,
  createPageEngineSet,
  localFirstApplies,
  pageRuntimePin,
  streamChatCompletion,
  type BrainStreamFn,
  type BrainTransport,
  type PageEngineSet,
} from '@seanhogg/builderforce-brain-embedded';
import { bfiWebLoader } from '@seanhogg/builderforce-brain-embedded/bfi';

let pageEngines: PageEngineSet | undefined;
/** Packs a local attempt for its model's window — `@seanhogg/builderforce-memory/handoff`. */
const handoffFit = createHandoffFit();

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
  // module initializes, which must stay free of work.
  const cloud: BrainStreamFn = (opts, handlers) => streamChatCompletion({ ...opts, transport }, handlers);
  return async (opts, handlers) => {
    // A model the person PINNED from the picker's on-device list (`local/bfi/…`,
    // `local/webllm/…`) runs in this page through the engines' fetch — never at the
    // gateway, which knows no such id. It takes the ONE pinned-local path every host
    // uses, so each call is packed for the pin's window (the catalog's context size) and
    // a call naming a different model still reaches where that model runs.
    const pin = pageRuntimePin(opts.model);
    if (pin) {
      return createLocalStream(pin.endpoint, pin.model, browserPageEngines().fetch(transport.fetch), {
        ref: opts.model!,
        cloud,
        fit: handoffFit,
      })(opts, handlers);
    }
    if (!localFirstApplies(opts)) return cloud(opts, handlers);
    const engines = browserPageEngines();
    // Memoized per engine inside brain-embedded, so asking per call costs nothing while
    // nothing moved.
    const probes = await engines.probe();
    if (probes.length === 0) return cloud(opts, handlers);
    // Every request that is not a page engine's own route passes straight through.
    // Each local attempt is packed for that model's window (a 4k WebLLM model included);
    // the gateway attempt keeps the full transcript.
    return createLocalFirstStream({ probes, cloud, fetch: engines.fetch(transport.fetch), fit: handoffFit })(opts, handlers);
  };
}
