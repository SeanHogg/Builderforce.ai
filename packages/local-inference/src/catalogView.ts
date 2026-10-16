/**
 * The `CatalogView` binding for locally-served models — how `@builderforce/model-router`
 * learns that a `local/<on-device runtime>/…` ref runs on the user's own CPU/GPU.
 *
 * Residency `local` is what makes the router price such a model at exactly zero
 * (`expectedCostUsd`), so a cost-first ordering of a mixed list puts it ahead of every
 * hosted model. The answer is read off the ref grammar and the registry — not off a
 * probe — because WHERE a model runs is a property of its runtime, not of whether that
 * runtime happens to be up this second. Every other ref is delegated to the host's own
 * view untouched, so this composes in front of whatever catalog the host already binds.
 */

import type { CatalogView, ModelResidency } from '@builderforce/model-catalog';
import { parseLocalModelRef } from './ref.js';
import { localRuntime } from './runtimes.js';

/** The runtime id when `model` is served by an on-device runtime; null for anything else. */
function onDeviceRuntime(model: string): string | null {
  const parsed = parseLocalModelRef(model);
  return parsed && localRuntime(parsed.provider).onDevice ? parsed.provider : null;
}

/**
 * Layer local residency over `base`. A `kimi-code` ref is locally DISPATCHED but hosted,
 * so it stays `cloud` and keeps whatever price/tier `base` knows for it.
 */
export function localCatalogView(base?: CatalogView): CatalogView {
  return {
    vendorOf: (model) => {
      const runtime = onDeviceRuntime(model);
      return runtime ? `local/${runtime}` : (base?.vendorOf(model) ?? 'unknown');
    },
    // FREE: it costs the tenant nothing, so tier-only ordering agrees with the price.
    tierOf: (model) => (onDeviceRuntime(model) ? 'FREE' : base?.tierOf(model)),
    priceOf: (model) => (onDeviceRuntime(model) ? undefined : base?.priceOf?.(model)),
    residencyOf: (model): ModelResidency =>
      onDeviceRuntime(model) ? 'local' : (base?.residencyOf?.(model) ?? 'cloud'),
  };
}
