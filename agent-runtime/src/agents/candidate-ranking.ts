/**
 * THE order of this host's model candidates for one call — the on-prem caller of the
 * shared router (`@builderforce/model-router`), so an on-prem subagent, a relay task and
 * a cloud run with the same role and the same evidence lead with the same kind of model.
 *
 * Candidates are this host's configured chain (`resolveFallbackCandidates`): the router
 * only ever PERMUTES it — never adds a model this host cannot run, never drops one the
 * failover loop would have tried.
 *
 * Two on-prem rules sit on top of the shared ranking, both about honesty:
 *   • A ROLE reorders by tier only when this host's catalog can tier EVERY candidate.
 *     An operator pin the catalog has no row for (an unpriced `anthropic/…` added by
 *     hand) would otherwise sort as "unknown" behind every priced model — the router
 *     would be overruling the operator on missing data, not on evidence. Learned
 *     evidence still applies in that case.
 *   • With NO role, learned evidence alone orders the chain (the opt-in learned seed —
 *     `learned-routing/settings.ts`), exactly as before the router existed.
 *
 * PURE — no I/O.
 */

import type { ModelRole } from "@builderforce/agent-tools";
import { rankModelsForAction, type ActionModelRankStat } from "@builderforce/learned-routing";
import type { CatalogView } from "@builderforce/model-catalog";
import { rankConnectedForRole } from "@builderforce/model-router";
import type { ArcStage } from "@builderforce/workload";
import { candidateKey, type ModelCandidate } from "./embedded-runner/learned-routing/candidate-keys.js";

export interface RankCandidatesOptions {
  /** What the call is FOR, with the catalog to read tiers from. Absent → only learned
   *  evidence can reorder. */
  routing?: { role: ModelRole; view: CatalogView; arcStage?: ArcStage };
  /** Learned per-model stats, already aligned onto candidate keys. */
  stats?: ReadonlyArray<ActionModelRankStat>;
  /** This host's local-history nudge (see `learned-routing/local-bias.ts`). */
  bias?: Record<string, number>;
}

/** Does the catalog tier every candidate? */
function catalogTiersAll(keys: readonly string[], view: CatalogView): boolean {
  return keys.every((k) => view.tierOf(k) !== undefined);
}

/** The same view with no tier and no price — role ordering becomes a stable no-op while
 *  vendor health and learned evidence still apply. */
function withoutTiers(view: CatalogView): CatalogView {
  const residencyOf = view.residencyOf?.bind(view);
  return {
    vendorOf: (m) => view.vendorOf(m),
    tierOf: () => undefined,
    ...(residencyOf ? { residencyOf } : {}),
  };
}

/** Rank this host's candidates. Always a permutation of the input. Pure. */
export function rankCandidates<C extends ModelCandidate>(
  candidates: readonly C[],
  opts: RankCandidatesOptions = {},
): C[] {
  if (candidates.length < 2) {
    return [...candidates];
  }
  const keys = candidates.map(candidateKey);
  const bias = opts.bias && Object.keys(opts.bias).length > 0 ? opts.bias : undefined;
  let order: string[];
  const routing = opts.routing;
  if (routing) {
    const view = catalogTiersAll(keys, routing.view) ? routing.view : withoutTiers(routing.view);
    order = rankConnectedForRole(keys, view, {
      role: routing.role,
      ...(routing.arcStage ? { arcStage: routing.arcStage } : {}),
      ...(opts.stats ? { stats: opts.stats } : {}),
      ...(bias ? { bias } : {}),
    });
  } else if (opts.stats?.length) {
    order = rankModelsForAction(keys, opts.stats, bias ? { bias } : undefined);
  } else {
    return [...candidates];
  }
  const byKey = new Map(candidates.map((c) => [candidateKey(c), c] as const));
  const ranked = order.map((k) => byKey.get(k)).filter((c): c is C => c !== undefined);
  // The router returns a permutation by contract; this is the belt on that brace, so a
  // future change there can never silently drop a candidate this host can run.
  return ranked.length === candidates.length ? ranked : [...candidates];
}
