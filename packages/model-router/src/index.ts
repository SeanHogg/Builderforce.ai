/**
 * `@builderforce/model-router` — THE ordering of candidate models for one call.
 *
 * Role objective, learned evidence, vendor health and expected cost, read through the
 * `CatalogView` port so every host (Worker gateway, editor, on-prem runtime, offline
 * browser) ranks the same inputs the same way. Ordering only: dispatch, cooldowns,
 * budgets and failover stay with the host. Pure and I/O-free.
 */

export {
  BALANCED_OBJECTIVE_THRESHOLD,
  isBalancedObjective,
  isCostFirstObjective,
  resolveRoleObjective,
  roleUsesLearnedRanking,
} from './objective.js';
export { orderForRole } from './orderForRole.js';
export {
  LATENCY_SAMPLE_WINDOW,
  clearLatency,
  latencySnapshot,
  p50,
  recordLatency,
  type LatencySamples,
} from './latency.js';
export {
  MAX_FAILOVER_LATENCY_RATIO,
  latencyDemotion,
  roleAppliesLatencyGuard,
  type LatencyGuardInput,
} from './latencyGuard.js';
export { rankConnectedForRole, type RankConnectedOptions } from './rankConnected.js';
export { expectedCostUsd, orderByExpectedCost, type CostWorkload } from './expectedCost.js';
export { orderPoolForWorkload, poolOrderIsCostFirst, type PoolEvidence, type PoolWorkload } from './orderPool.js';
