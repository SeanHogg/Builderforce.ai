/**
 * Run cost where a run may not have reported one.
 *
 * `run_model_outcomes.cost_usd_millicents` is NULL for a run that reported no cost (a canvas
 * turn, a VS Code run the gateway did not price): UNKNOWN, not free. Every cost lens reads it
 * through here, so a sum or a per-merged-PR average counts only the runs that HAVE a cost,
 * and a group in which no run did reads as unknown (null) rather than as $0.
 */

import { MILLICENTS_PER_USD } from '../../domain/shared/money';

/** A run, as far as its cost is concerned. */
export interface CostedRun {
  /** NULL = the run reported no cost. */
  costUsdMillicents: number | null;
}

/** The runs that reported a cost. */
export function pricedRuns<T extends CostedRun>(rows: readonly T[]): T[] {
  return rows.filter((row) => row.costUsdMillicents !== null);
}

/** USD spent by the runs that reported a cost; null when none did. */
export function pricedCostUsd(rows: readonly CostedRun[]): number | null {
  const priced = pricedRuns(rows);
  if (priced.length === 0) return null;
  return priced.reduce((sum, row) => sum + (row.costUsdMillicents ?? 0), 0) / MILLICENTS_PER_USD;
}

/**
 * USD per merged PR over the runs that reported a cost. An unpriced run joins neither the spend
 * nor the merged count it is divided by, so it cannot dilute the figure toward free. Null when
 * no merged run reported a cost.
 */
export function pricedCostPerMergedUsd(rows: ReadonlyArray<CostedRun & { merged: boolean }>): number | null {
  const priced = pricedRuns(rows);
  const merged = priced.filter((row) => row.merged).length;
  if (merged === 0) return null;
  return (pricedCostUsd(priced) ?? 0) / merged;
}
