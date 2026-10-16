/**
 * The CatalogView port — how a pure router reads a host's model catalog without
 * importing it.
 *
 * The Worker binds it to its vendor registry plus a price book built from the live
 * provider catalog; an on-prem or editor host binds it to whatever catalog it holds.
 * The router never learns where the answers came from, which is what lets the same
 * ranking code run in the cloud, in the editor and offline.
 */

import type { ModelPrice } from './price.js';
import type { ModelTier } from './tier.js';

/** Where a model executes. `local` = the user's own machine (CPU/GPU) — no network,
 *  no metered cost, available offline. `cloud` = any hosted provider. */
export type ModelResidency = 'local' | 'cloud';

export interface CatalogView {
  /** The vendor id that serves this model (health and cooldown are per vendor). */
  vendorOf(model: string): string;
  /** Catalog tier; `undefined` when the model is unknown to the catalog. */
  tierOf(model: string): ModelTier | undefined;
  /** Per-token price, when known. Absent = the router falls back to the tier. */
  priceOf?(model: string): ModelPrice | undefined;
  /** Where it runs. Absent = `cloud`. */
  residencyOf?(model: string): ModelResidency;
}

/** Residency through the optional port method — `cloud` when the host doesn't say. */
export function residencyOf(view: CatalogView, model: string): ModelResidency {
  return view.residencyOf?.(model) ?? 'cloud';
}
