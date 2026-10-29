/**
 * Whether a routing stat knows what its runs cost.
 *
 * A run that reported no cost (a VS Code run the gateway did not price, a canvas turn) is
 * UNKNOWN, not free: the blob's running cost mean folds only the runs that reported one and
 * counts them in `costN`. A stat none of whose runs did has no mean to compare, and the
 * tie-break between equal scorers must neither reward nor punish that absence.
 *
 * Pure and dependency-free, like the rest of this package, so the Worker's table sort and the
 * ranker the on-prem host runs break ties the same way.
 */

/** The slice of a stat the cost rules read. */
export interface CostStat {
  avgCostMc: number;
  /** Runs behind `avgCostMc` that reported a cost. Absent on blobs written before cost could be
   *  unknown: every run counted, so the mean is known. */
  costN?: number;
}

/** True when `avgCostMc` is a mean over at least one priced run. */
export function hasCostMean(stat: Pick<CostStat, 'costN'>): boolean {
  return stat.costN === undefined || stat.costN > 0;
}

/** Cheaper-first comparison for the tie-break; 0 (no information) unless BOTH know their cost. */
export function compareAvgCost(a: CostStat, b: CostStat): number {
  if (!hasCostMean(a) || !hasCostMean(b)) return 0;
  return a.avgCostMc - b.avgCostMc;
}
