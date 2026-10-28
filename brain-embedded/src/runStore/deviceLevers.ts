/**
 * A cost lever, as this device reads it. On-device there is no tenant to bucket by, so
 * it is the manifest default plus any env a Node host exposes
 * (`COST_LEVER_<ID>=off`, `COST_LEVERS_ALL=off`).
 */

import { isCostLeverOn, type CostLeverId } from '@builderforce/cost-levers';

export function deviceLeverOn(id: CostLeverId): boolean {
  const env = (globalThis as { process?: { env?: unknown } }).process?.env;
  return isCostLeverOn(env, id, null);
}
