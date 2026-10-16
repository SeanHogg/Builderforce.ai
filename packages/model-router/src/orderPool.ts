/**
 * Order a PLAN POOL (the platform's free/paid models, not the tenant's connected
 * accounts) for a workload.
 *
 * Only a cost-first call reorders it — exploring, verifying and mechanical work lead
 * with the cheapest model by expected cost. Every other call gets the pool back exactly
 * as given: quality-first ordering of a plan pool is capability-specific (coding
 * drivers, premium writers) and stays with the host that curates those lists, and a
 * balanced call keeps the pool's latency order. Pure.
 */

import type { CatalogView } from '@builderforce/model-catalog';
import type { WorkloadProfile } from '@builderforce/workload';
import { orderByExpectedCost } from './expectedCost.js';
import { isCostFirstObjective, resolveRoleObjective } from './objective.js';

export type PoolWorkload = Pick<WorkloadProfile, 'role' | 'arcStage' | 'inputTokens' | 'outputTokens'>;

/** Does this workload reorder a plan pool at all? Lets a host skip loading prices. */
export function poolOrderIsCostFirst(workload: Pick<WorkloadProfile, 'role' | 'arcStage'>): boolean {
  return isCostFirstObjective(resolveRoleObjective(workload.role, workload.arcStage));
}

export function orderPoolForWorkload(pool: readonly string[], workload: PoolWorkload, view: CatalogView): string[] {
  if (!poolOrderIsCostFirst(workload)) return [...pool];
  return orderByExpectedCost(pool, workload, view);
}
