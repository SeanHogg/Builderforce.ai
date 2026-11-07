/**
 * Is a pinned ref a PAGE-runtime model (`local/{bfi,webllm,browser}/<model>`), and where
 * is its root? Decided by the registry's `reach`, never by comparing runtime ids.
 *
 * A page runtime has no URL anyone configures: its root is the registry's non-routable
 * `http://<runtime>.local`, answered by the page engines' ONE fetch shim. So a page pin
 * needs nothing from a host's settings: it is `createHostModelStream`'s default local-pin
 * resolution, handed to the ONE pinned-local path (`createLocalStream`) with the fetch
 * that reaches the engines (the page's own `pageEnginesFetch` on the web and in Rovr; the
 * postMessage bridge's in the editor). That path packs each call for the pinned model's
 * window (the catalog's `contextTokens`) exactly as for any local pin.
 */

import {
  formatLocalModelRef,
  localRuntime,
  parseLocalModelRef,
  type LocalEndpoint,
  type LocalRuntimeId,
} from '@builderforce/local-inference';
import { builtInModelIdentity } from '../builtInAi/identity';

export interface PageRuntimePin {
  provider: LocalRuntimeId;
  /** The bare id the engine knows. */
  model: string;
  /** The runtime's in-page root — what the shim answers. */
  endpoint: LocalEndpoint;
}

/**
 * The browser's built-in model is whichever one THIS browser ships (PRD 42 · A1), so a
 * `local/browser/<model>` pin naming another vendor's model (a Chrome-era
 * `gemini-nano` pin in Edge) resolves to this vendor's model — the caller reports it as
 * `PIN_REMAPPED`, never a silent swap. Returns the remapped ref + pin, or null when the
 * pin is not a one-model built-in runtime's or already names the current model.
 */
export function remapBuiltInPin<P extends { model: string }>(
  ref: string,
  pin: P,
  identity: BuiltInModelIdentity | undefined = typeof navigator === 'undefined' ? undefined : builtInModelIdentity(),
): { ref: string; pin: P } | null {
  // No navigator, or a vendor we cannot name: there is no "this browser's model" to remap to.
  if (!identity || identity.vendor === 'unknown') return null;
  const current = identity.model;
  const parsed = parseLocalModelRef(ref);
  if (!parsed || !localRuntime(parsed.provider).labelFromProbe || parsed.model === current) return null;
  return { ref: formatLocalModelRef(parsed.provider, current), pin: { ...pin, model: current } };
}

/** The pin when `ref` names a model on a PAGE runtime; null for anything else (a gateway
 *  id, an HTTP runtime's model, nothing). */
export function pageRuntimePin(ref: string | undefined): PageRuntimePin |