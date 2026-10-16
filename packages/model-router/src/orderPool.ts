/**
 * Order a PLAN POOL (the platform's free/paid models, not the tenant's connected
 * accounts) for a workload.
 *
 * A cost-first call reorders it — exploring, verifying and mechanical work lead with
 * the cheapest model by expected cost. Where the role lets the system choose
 * ({@link roleUsesLearnedRanking}) and there is evidence, models then re-rank by what
 * they actually delivered in that role, exactly as the connected-account seed does
 * ({@link rankConnectedForRole}) — so a tenant with no connected provider gets the same
 * learned ordering as one with. Every other call gets the pool back exactly as given:
 * quality-first ordering of a plan pool is capability-specific (coding drivers, premium
 * writers) and stays with the host that curates those lists, and a balanced call keeps
 * the pool's latency order. Pure.
 */

import { rankModelsForAction, type ActionModelRankStat } from '@builderforce/learned-routing';
import type { CatalogView } from '@builderforce/model-catalog';
import type { WorkloadProfile } from '@builderforce/workload';
import { orderByExpectedCost } from './expectedCost.js';
import { isCostFirstObjective, resolveRoleObjective, roleUsesLearnedRanking } from './objective.js';

export type PoolWorkload = Pick<WorkloadProfile, 'role' | 'arcStage' | 'inputTokens' | 'outputTokens'>;

/** Learned evidence for the pool order. Absent or cold → cost/latency order stands. */
export interface PoolEvidence {
  /** Learned per-model stats for this call's role. */
  stats?: ReadonlyArray<ActionModelRankStat>;
  minSamples?: number;
}

/** Does this workload reorder a plan pool by price? Lets a host skip loading prices. */
export function poolOrderIsCostFirst(workload: Pick<WorkloadProfile, 'role' | 'arcStage'>): boolean {
  return isCostFirstObjective(resolveRoleObjective(workload.role, workload.arcStage));
}

export function orderPoolForWorkload(
  pool: readonly string[],
  workload: PoolWorkload,
  view: CatalogView,
  evidence: PoolEvidence = {},
): string[] {
  const ordered = poolOrderIsCostFirst(workload) ? orderByExpectedCost(pool, workload, view) : [...pool];
  if (!evidence.stats || !roleUsesLearnedRanking(workload.role, workload.arcStage)) return ordered;
  return rankModelsForAction(ordered, evidence.stats, { minSamples: evidence.minSamples });
}
