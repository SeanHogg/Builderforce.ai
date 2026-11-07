/**
 * The web app's ONE `OnDeviceTasks` port (PRD 42 · Part B), beside `browserPageEngines()`.
 *
 * Built-in browser APIs first (Summarizer, Rewriter, Writer, Proofreader, LanguageDetector,
 * Translator, the Prompt API), then the page engines (bfi / WebLLM through their ONE fetch
 * shim). Every method returns its result or `null` and never reaches the network — a
 * consumer receives this port and does what it did before on `null`.
 *
 * SSR-safe: nothing is read until a method runs; built once per page.
 */

import { pageClientFirst, pageEngineCompletion, pageEnginesReady, pageOnDeviceTasks, type ClientFirstHost, type OnDeviceTasks } from '@seanhogg/builderforce-brain-embedded';

/** The page engines load on first use — `./localFirst` is the heavy chain and must not ride in the root bundle. */
const pageEngines = async () => (await import('./localFirst')).browserPageEngines();

let tasks: OnDeviceTasks | undefined;

export function browserOnDeviceTasks(): OnDeviceTasks {
  return (tasks ??= pageOnDeviceTasks({
    pageCompletion: pageEngineCompletion({
      probe: async () => (await pageEngines()).probe(),
      // No base: only a page engine's own route is answered, so nothing leaves the page.
      fetch: async (input, init) => (await pageEngines()).fetch()(input, init),
    }),
    pageAvailable: () => pageEnginesReady(async () => (await pageEngines()).probe()),
  }));
}

/**
 * The web host's client-first pair (PRD 42 · Part D): the port above and the stamp its results
 * carry. A result is stamped `browser` with the vendor's built-in model id.
 */
export function browserClientFirst(): ClientFirstHost {
  // Lazy: a module that holds this at load time (builderforceApi's persistence) builds nothing
  // until the first call actually reaches the device.
  let host: ClientFirstHost | undefined;
  const real = () => (host ??= pageClientFirst(browserOnDeviceTasks()));
  return {
    get tasks() { return real().tasks; },
    provenance: () => real().provenance(),
    get observe() { return real().observe; },
  };
}
