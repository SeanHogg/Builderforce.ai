/**
 * Whether a routing stat knows what its runs cost, and the ONE ordering that uses it.
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

/** The cost a stat contributes to the tie-break: its mean, or null when it has none (unknown). */
export function costForTieBreak(stat: CostStat): number | null {
  return hasCostMean(stat) ? stat.avgCostMc : null;
}

/** How one item takes part in the ordering. */
export interface RankKeys<T> {
  /** A band that sorts strictly before the next (e.g. the trailing rate-limited band). Default: one band. */
  band?: (item: T) => number;
  /** Higher ranks first. */
  score: (item: T) => number;
  /** The stable position that breaks every remaining tie. Unique per item. */
  index: (item: T) => number;
  /** Millicents per run, or null when unknown. */
  cost: (item: T) => number | null;
}

/**
 * Order items best-first: band, then score (descending), then — among items of EQUAL band and
 * score — cheaper first, with the stable index breaking what is left.
 *
 * The cost step is not a comparator. A comparator that calls two items "equal" whenever one cost
 * is unknown is not transitive (5 < 9, but an unknown between them ties with both), so the result
 * would depend on which pair the sort happened to compare. Instead the order is built in two
 * steps, both total:
 *   1. sort by (band, score, index) — a total order;
 *   2. inside each run of equal (band, score), put the priced members in cost order (index
 *      breaking cost ties) back into the slots the priced members held. Unknown members keep
 *      their slots, so an unknown cost neither wins nor loses a place, and a cheaper priced item
 *      is never placed behind a dearer one because an unpriced item sits between them.
 *
 * Pure: the result is a function of the items' keys alone.
 */
export function rankWithCostTieBreak<T>(items: readonly T[], keys: RankKeys<T>): T[] {
  const band = keys.band ?? (() => 0);
  const sorted = [...items].sort((a, b) => band(a) - band(b) || keys.score(b) - keys.score(a) || keys.index(a) - keys.index(b));
  const sameRank = (a: T, b: T): boolean => band(a) === band(b) && keys.score(a) === keys.score(b);

  for (let start = 0; start < sorted.length;) {
    let end = start + 1;
    while (end < sorted.length && sameRank(sorted[start]!, sorted[end]!)) end += 1;

    const slots: number[] = [];
    for (let at = start; at < end; at += 1) if (keys.cost(sorted[at]!) !== null) slots.push(at);
    const priced = slots
      .map((at) => sorted[at]!)
      .sort((a, b) => keys.cost(a)! - keys.cost(b)! || keys.index(a) - keys.index(b));
    slots.forEach((at, position) => { sorted[at] = priced[position]!; });

    start = end;
  }
  return sorted;
}
