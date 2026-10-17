/**
 * Is a pinned ref a PAGE-runtime model (`local/{bfi,webllm,browser}/<model>`), and where
 * is its root? Decided by the registry's `reach`, never by comparing runtime ids.
 *
 * A page runtime has no URL anyone configures: its root is the registry's non-routable
 * `http://<runtime>.local`, answered by the page engines' ONE fetch shim. So a host that
 * finds a page pin needs nothing from its settings — it hands this endpoint to the ONE
 * pinned-local path, `createLocalStream(endpoint, model, fetch, { ref, fit, cloud })`,
 * with the fetch that reaches the engines (the page's own `pageEnginesFetch` on the web
 * and in Rovr; the postMessage bridge's in the editor). That path packs each call for the
 * pinned model's window (the catalog's `contextTokens`) exactly as for any local pin.
 */

import { localRuntime, parseLocalModelRef, type LocalEndpoint, type LocalRuntimeId } from '@builderforce/local-inference';

export interface PageRuntimePin {
  provider: LocalRuntimeId;
  /** The bare id the engine knows. */
  model: string;
  /** The runtime's in-page root — what the shim answers. */
  endpoint: LocalEndpoint;
}

/** The pin when `ref` names a model on a PAGE runtime; null for anything else (a gateway
 *  id, an HTTP runtime's model, nothing). */
export function pageRuntimePin(ref: string | undefined): PageRuntimePin | null {
  const pin = parseLocalModelRef(ref);
  if (!pin) return null;
  const runtime = localRuntime(pin.provider);
  if (runtime.reach !== 'page' || !runtime.defaultBaseUrl) return null;
  return { ...pin, endpoint: { baseUrl: runtime.defaultBaseUrl } };
}
