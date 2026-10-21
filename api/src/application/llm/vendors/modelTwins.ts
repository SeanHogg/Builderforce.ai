/**
 * Twin lookup over the vendor catalogs: model ids that serve the SAME open weights
 * (`VendorModelEntry.weights`) through different vendors. Pure data derived once from
 * the registry, so declaring a twin is one catalog edit and nothing here names a model.
 */

import { getCatalog, vendorForModel } from './registry';
import type { AiCapability } from './types';

interface TwinEntry {
  id: string;
  capabilities: readonly AiCapability[];
}

const BY_WEIGHTS: Map<string, TwinEntry[]> = new Map();
const WEIGHTS_OF: Map<string, string> = new Map();

for (const entry of getCatalog()) {
  if (!entry.weights) continue;
  // Only ids that route to the vendor that declared them: an id another vendor's catalog
  // shadows would dispatch somewhere else, and the twin would not be the model it claims.
  if (vendorForModel(entry.id) !== entry.vendor) continue;
  const group = BY_WEIGHTS.get(entry.weights) ?? [];
  group.push({ id: entry.id, capabilities: entry.capabilities ?? [] });
  BY_WEIGHTS.set(entry.weights, group);
  WEIGHTS_OF.set(entry.id, entry.weights);
}

const CAPS_OF: Map<string, readonly AiCapability[]> = new Map(
  [...BY_WEIGHTS.values()].flat().map((e) => [e.id, e.capabilities]),
);

/**
 * The other ids serving `modelId`'s weights that declare AT LEAST its capabilities — a
 * twin missing a declared capability (tools, vision) is not a substitute for it. Empty
 * when the model declares no weights.
 */
export function capableTwinsOf(modelId: string): string[] {
  const weights = WEIGHTS_OF.get(modelId);
  if (!weights) return [];
  const need = CAPS_OF.get(modelId) ?? [];
  return (BY_WEIGHTS.get(weights) ?? [])
    .filter((e) => e.id !== modelId && need.every((c) => e.capabilities.includes(c)))
    .map((e) => e.id);
}
