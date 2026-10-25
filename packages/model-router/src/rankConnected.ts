/**
 * THE order of a tenant's connected models for one call — shared by the gateway seed
 * and the cloud-run pick, so a chat turn and a cloud run with the same role and the
 * same evidence lead with the same model.
 *
 * 1. The role orders by tier and price ({@link orderForRole}).
 * 2. Where the role lets the system choose ({@link roleUsesLearnedRanking}), models
 *    with enough evidence re-rank by what they actually delivered; the role order
 *    stays the tie-break and the order for everything still cold — except that an
 *    untried model stronger than every measured one keeps the lead on a quality-first
 *    role ({@link liftUntriedStronger}), so evidence cannot seal out a better coder.
 * 3. Vendor HEALTH is re-applied last, so a good history cannot lift a vendor that is
 *    failing right now back to the lead.
 *
 * Never adds, drops or invents a model. Pure.
 */

import type { ModelRole } from '@builderforce/agent-tools';
import { rankModelsForAction, type ActionModelRankStat, type RoutingExploration } from '@builderforce/learned-routing';
import type { CatalogView } from '@builderforce/model-catalog';
import type { ArcStage } from '@builderforce/workload';
import { resolveRoleObjective, roleUsesLearnedRanking } from './objective.js';
import { orderForRole } from './orderForRole.js';
import { liftUntriedStronger } from './untriedStronger.js';

export interface RankConnectedOptions {
  role?: ModelRole;
  arcStage?: ArcStage;
  /** Vendors known to be failing — never lead, whatever tier or history says. */
  demotedVendors?: ReadonlySet<string>;
  /** Learned per-model stats for this call. Absent or cold -> the role order stands. */
  stats?: ReadonlyArray<ActionModelRankStat>;
  minSamples?: number;
  /** Client SSM recall nudge on top of the learned score. */
  bias?: Record<string, number>;
  /** Thompson exploration (cost PRD D3) — the host passes it only when the lever is on
   *  and the call may explore (no strict pin, BYO-strict chain or premium override).
   *  Absent = the deterministic learned order. */
  explore?: RoutingExploration;
}

export function rankConnectedForRole(
  models: readonly string[],
  view: CatalogView,
  opts: RankConnectedOptions = {},
): string[] {
  const objective = resolveRoleObjective(opts.role, opts.arcStage);
  const byRole = orderForRole(models, objective, view, opts.demotedVendors);
  if (!roleUsesLearnedRanking(opts.role, opts.arcStage)) return byRole;
  const bias = opts.bias && Object.keys(opts.bias).length > 0 ? opts.bias : undefined;
  const learned = rankModelsForAction(byRole, opts.stats, {
    minSamples: opts.minSamples,
    ...(bias ? { bias } : {}),
    ...(opts.explore ? { explore: opts.explore } : {}),
  });
  return orderForRole(liftUntriedStronger(learned, opts.stats, objective, view, opts.minSamples), 0, view, opts.demotedVendors);
}
