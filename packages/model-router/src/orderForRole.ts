/**
 * Order candidate models for what the call is FOR.
 *
 * A role with a model LADDER (plan, review, code — `roleLadders.ts` in
 * `@builderforce/model-catalog`, read through `CatalogView.ladderRankOf`) leads with its
 * ladder: the strongest judge for planning and review, the best coder PER COST for code
 * (Sonnet before Opus). On-ladder models sort before off-ladder ones; the tier and price
 * keys below break ties within a rung and order whatever the ladder does not name.
 *
 * Otherwise a quality-first objective leads with the STRONGEST tier, a cost-first one
 * with the CHEAPEST — and within a tier, by per-token price where the catalog knows it —
 * and a balanced one keeps the given order exactly. Across vendors, not within one: a
 * role that only reordered inside a provider could never move a strong model ahead of a
 * precedence-first cheap one for a coding turn, which is the point.
 *
 * Vendor HEALTH is the outermost key: a vendor known to be failing never leads because
 * a role asked for its rung or tier. Stable, so equal keys keep the given order (the
 * tenant's precedence); never adds, drops or invents a model. Pure.
 *
 * The optional LATENCY guard demotes a failover candidate whose measured p50 is more
 * than 3× the primary's ({@link latencyDemotion}): it sorts behind every candidate
 * within budget within the same rung and tier, never ahead. Unmeasured models and a down
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

/** Rung for a model the role's ladder does not name — after every named rung. */
const OFF_LADDER = Number.MAX_SAFE_INTEGER;

/**
 * The role's ladder as a sort key, or `undefined` when the role has none here (no role,
 * a ladder-less role, or a host whose view carries no ladders). Pure.
 */
export function ladderKey(view: CatalogView, role: string | undefined): ((model: string) => number) | undefined {
  const rankOf = view.ladderRankOf;
  if (!role || !rankOf) return undefined;
  return (model) => rankOf(role, model) ?? OFF_LADDER;
}

export function orderForRole(
  models: readonly string[],
  objective: number,
  view: CatalogView,
  demotedVendors?: ReadonlySet<string>,
  latency?: LatencyGuardInput,
  role?: string,
): string[] {
  const byTier = !isBalancedObjective(objective);
  // A ladder ranks by strength for the role, so it applies only to a quality-first call:
  // a cost-first one (an arc stage that turns `code` cheap) reads tier and price alone.
  const ladder = objective > 0 && byTier ? ladderKey(view, role) : undefined;
  if (!byTier && !demotedVendors?.size && !latency) return [...models];
  const costFirst = byTier && objective < 0;
  const health = (m: string): number => (demotedVendors?.has(view.vendorOf(m)) ? 1 : 0);
  const rung = (m: string): number => (ladder ? ladder(m) : 0);
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
      compareNumbers(rung(a.m), rung(b.m)) ||
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
