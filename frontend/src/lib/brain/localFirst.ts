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
 * WHERE models may run is the person's inference mode (`../localFirst/platformPolicy`):
 * Local only never builds a cloud stream, Hybrid is local first then the gateway, and a
 * pin wins under Specific — brain-embedded applies it; this module only reads it.
 *
 * SSR-safe: nothing touches `window` until a call runs, and a server (or a browser with
 * no engine ready) simply probes as "no local runtime". Probing never downloads — models
 * arrive only through the picker's `store`.
 */

import {
  createHostModelStream,
  createPageEngineSet,
  streamChatCompletion,
  webStorageLocalSuccessStore,
  type BrainStreamFn,
  type BrainTransport,
  type PageEngineSet,
} from '@seanhogg/builderforce-brain-embedded';
import { bootWebPlatformPolicy, webInferencePolicyFor, webSignedIn } from '../localFirst/platformPolicy';
import { webModelFallback } from './modelFallback';

let pageEngines: PageEngineSet | undefined;
/** Where this browser keeps Hybrid's local-success predictor — one store, one history.
 *  Touches storage only when a Hybrid turn first consults it. */
const webLocalSuccess = webStorageLocalSuccessStore();

/** This page's engines and their model store — built on first use, one per page. The
 *  model picker drives `store`; the Brain stream below reads `probe` and `fetch`. */
export function browserPageEngines(): PageEngineSet {
  return (pageEngines ??= createPageEngineSet({
    // `bfi` runs in a dedicated Web Worker (`bfi.worker.ts`), so its CPU backend — the
    // path on a browser without WebGPU — never blocks this page. The binary's URL comes
    // from `@seanhogg/bfi-web/wasm-url` — a relative `new URL(…, import.meta.url)` inside
    // the package, which webpack and Turbopack both emit as a static asset — and is
    // handed to the worker absolute. Both are reached lazily: the worker starts and the
    // wasm is fetched only when a downloaded Bonsai model is first probed or run.
    bfiWorker: {
      create: () => new Worker(new URL('./bfi.worker.ts', import.meta.url), { type: 'module', name: 'bfi' }),
      wasmUrl: async () => new URL((await import('@seanhogg/bfi-web/wasm-url')).bfiWasmUrl, window.location.href),
      // The THREADED CPU build, served as plain files from `public/bfi-threads/`
      // (`scripts/copy-bfi-threads.mjs`). The worker loads it only where threads exist and
      // no WebGPU adapter is there to prefer. Threads exist only on the cross-origin-isolated
      // routes — COOP/COEP is set by middleware.ts for the /create/ and /studio/ SSR routes
      // alone, so Studio and the canvas get threads; elsewhere it loads the single-threaded build.
      threads: () => ({
        moduleUrl: new URL('/bfi-threads/bfi_web.js', window.location.origin).href,
        wasmUrl: new URL('/bfi-threads/bfi_web_bg.wasm', window.location.origin).href,
      }),
    },
  }));
}


/** The Brain stream over `transport`, served by a model in this page first. */
export function createBrowserLocalFirstStream(transport: BrainTransport): BrainStreamFn {
  // Built per call, never at module load: this is called while the root layout's config
  // module initializes, which must stay free of work — so the engines are only reached
  // inside the fns below, when a call runs.
  const cloud: BrainStreamFn = (opts, handlers) => streamChatCompletion({ ...opts, transport }, handlers);
  // Signed in = THE web's one definition (`webSignedIn`): a web or tenant session. A
  // guest's minted token is not one — an anonymous visitor runs Local only until they
  // choose Hybrid (which is what mints it), so the no-model verdict never tells them to
  // sign in for a turn their own device or the Hybrid opt-in can serve.
  const signedIn = webSignedIn;
  // The person's inference mode and what it derives, per call (a choice applies from
  // the next turn). Booting is idempotent; it guarantees the first turn never reads an
  // unbooted, all-refused policy for a signed-in person.
  const resolved = () => {
    bootWebPlatformPolicy();
    return webInferencePolicyFor(signedIn());
  };
  return createHostModelStream({
    mode: () => resolved().mode,
    signedIn,
    // A model the person PINNED from the picker's on-device list (`local/bfi/…`,
    // `local/webllm/…`) arrives as the call's own `model` and runs in this page (the
    // default page-pin resolution); nothing else is a pin here.
    // Local only — or an advanced override refusing gateway inference — builds no cloud.
    cloud: () => (resolved().snapshot.gatewayInference ? cloud : null),
    // Memoized per engine inside brain-embedded, so asking per call costs nothing while
    // nothing moved.
    probes: () => browserPageEngines().probe(),
    // Every request that is not a page engine's own route passes straight through.
    fetch: (input, init) => browserPageEngines().fetch(transport.fetch)(input, init),
    // Hybrid's pick failed and Auto answered: `WebAiSurface` says so ("Your pick X failed;
    // answered with Auto").
    onFallback: webModelFallback.report,
    // Hybrid's local-success predictor, trained on this browser's routed turns and kept
    // in its Web Storage (no request; a guest on Local only never reaches it).
    localSuccess: webLocalSuccess,
  });
}
