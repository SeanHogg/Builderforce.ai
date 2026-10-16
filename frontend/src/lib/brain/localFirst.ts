/**
 * LOCAL FIRST for the web app's Brain — a turn that the browser's own model can take
 * (Chrome's built-in Gemini Nano, via the Prompt API) is answered on this device, and
 * everything else goes to the gateway exactly as before.
 *
 * Nothing here decides anything. Which calls are open to local-first is brain-embedded's
 * `localFirstApplies` (a named model or `byo_pool` always goes to the cloud — the rule
 * the editor applies too); which model may take a call (never a tool turn, never a
 * prompt the window cannot hold) is the shared plan; and the failover that makes a
 * refusal at the browser invisible is `createLocalFirstStream`'s. This module only lends
 * them the page: the browser engine's probe as the one local runtime, and its in-page
 * fetch as the local transport.
 *
 * SSR-safe: nothing touches `window` until a call runs, and a server (or any browser
 * without the Prompt API) simply probes as "no local runtime".
 */

import {
  browserEngineFetch,
  browserEngineProbe,
  createLocalFirstStream,
  localFirstApplies,
  streamChatCompletion,
  type BrainStreamFn,
  type BrainTransport,
} from '@seanhogg/builderforce-brain-embedded';

/** The Brain stream over `transport`, served on the browser's own model first. */
export function createBrowserLocalFirstStream(transport: BrainTransport): BrainStreamFn {
  // Built per call, never at module load: this is called while the root layout's config
  // module initializes, which must stay free of work.
  const cloud: BrainStreamFn = (opts, handlers) => streamChatCompletion({ ...opts, transport }, handlers);
  return async (opts, handlers) => {
    if (!localFirstApplies(opts)) return cloud(opts, handlers);
    // Memoized inside brain-embedded, so asking per call costs nothing while nothing moved.
    const browser = await browserEngineProbe();
    if (!browser) return cloud(opts, handlers);
    // Every request that is not the browser engine's own route passes straight through.
    const fetch = browserEngineFetch(transport.fetch);
    return createLocalFirstStream({ probes: [browser], cloud, fetch })(opts, handlers);
  };
}
