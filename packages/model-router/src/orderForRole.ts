/**
 * Order candidate models for what the call is FOR.
 *
 * A quality-first objective leads with the STRONGEST tier, a cost-first one with the
 * CHEAPEST — and within a tier, by per-token price where the catalog knows it — and a
 * balanced one keeps the given order exactly. Across vendors, not within one: a role
 * that only reordered inside a provider could never move a strong model ahead of a
 * precedence-first cheap one for a coding turn, which is the point.
 *
 * Vendor HEALTH is the outermost key: a vendor known to be failing never leads because
 * a role asked for its tier. Stable, so equal keys keep the given order; never adds,
 * drops or invents a model. Pure.
 *
 * The optional LATENCY guard demotes a failover candidate whose measured p50 is more
 * than 3× the primary's ({@link latencyDemotion}): it sorts behind every candidate
 * within budget within the same tier, never ahead. Unmeasured models and a down
 * primary are neutral; the caller decides when the guard applies (code/verify roles).
 */

import { UNKNOWN_TIER_RANK, tierRank, type CatalogView } from '@builderforce/model-catalog';
import { isBalancedObjective } from './objective.js';
import { latencyDemotion, type LatencyGuardInput } from './latencyGuard.js';

/** Blended per-token price used when only an ORDER is needed (no token estimate):
 *  output dominates agent turns, so it weighs 3:1. */
function blendedUnitPrice(view: CatalogView, model: string): number | undefined {
  const price = view.priceOf?.(model);
  return price ? price.input + 3 * price.output : undefined;
}

export function orderForRole(
  models: readonly string[],
  objective: number,
  view: CatalogView,
  demotedVendors?: ReadonlySet<string>,
  latency?: LatencyGuardInput,
): string[] {
  const byTier = !isBalancedObjective(objective);
  if (!byTier && !demotedVendors?.size && !latency) return [...models];
  const costFirst = byTier && objective < 0;
  const health = (m: string): number => (demotedVendors?.has(view.vendorOf(m)) ? 1 : 0);
  const tier = (m: string): number => {
    if (!byTier) return 0;
    const rank = tierRank(view.tierOf(m));
    // Cost-first reads the ladder upside down; an UNKNOWN tier is not evidence of
    // cheapness, so it sorts with the top tier rather than jumping to the lead.
    return objective > 0 ? rank : rank >= UNKNOWN_TIER_RANK ? 0 : -rank;
  };
  // Within one tier a cost-first call prefers the cheaper price; an unknown price keeps
  // its place behind the priced models of the same tier.
  const price = (m: string): number =>
    costFirst ? (blendedUnitPrice(view, m) ?? Number.POSITIVE_INFINITY) : 0;
  const slow = (m: string): number => latencyDemotion(m, latency);
  return models
    .map((m, i) => ({ m, i, p: price(m) }))
    .sort((a, b) =>
      health(a.m) - health(b.m) ||
      tier(a.m) - tier(b.m) ||
      slow(a.m) - slow(b.m) ||
      compareNumbers(a.p, b.p) ||
      a.i - b.i)
    .map(({ m }) => m);
}

/** Total order that tolerates Infinity on both sides (Infinity - Infinity is NaN). */
function compareNumbers(a: number, b: number): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}
