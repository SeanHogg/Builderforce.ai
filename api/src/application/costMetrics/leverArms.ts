/**
 * The cost-lever ARMS a usage row was produced under — the control-group stamp A4
 * compares on-arm against off-arm with.
 *
 * Only levers in a PARTIAL rollout (0 < share < 100) are stamped: a lever that is on
 * or off for every tenant has no control group, so naming it on each row would only
 * spend ledger bytes (this is the hottest-written relation on the operational
 * endpoint). Both arms are written explicitly — `off` is not "every partial lever not
 * in `on`" — because the rollout share can change between rows, and a row must say
 * which levers WERE being compared when it was written.
 *
 * Pure over `env` + tenant: the bucket is `@builderforce/cost-levers`' stable hash, so
 * the same tenant stamps the same arms on every row until an operator moves a share.
 */
import { COST_LEVERS, costLeverRollout, isCostLeverOn, type CostLeverId } from '@builderforce/cost-levers';

/** The metadata key the stamp rides under on `llm_usage_log.metadata`. */
export const COST_LEVER_ARMS_KEY = 'costLevers';

export interface CostLeverArmsStamp {
  on: CostLeverId[];
  off: CostLeverId[];
}

/** The tenant's arm for every partially rolled-out lever, or null when none is partial. */
export function costLeverArmsStamp(env: unknown, tenantId: number | string | null | undefined): CostLeverArmsStamp | null {
  const on: CostLeverId[] = [];
  const off: CostLeverId[] = [];
  for (const lever of COST_LEVERS) {
    const share = costLeverRollout(env, lever.id);
    if (share <= 0 || share >= 100) continue;
    (isCostLeverOn(env, lever.id, tenantId) ? on : off).push(lever.id);
  }
  return on.length + off.length > 0 ? { on, off } : null;
}
