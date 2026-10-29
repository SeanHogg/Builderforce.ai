/**
 * telemetry/costTally — the ONE rule for what a run cost, from what each turn reported.
 *
 * A turn the transport did not price (no `costMc`) has an UNKNOWN cost, not a free one. A run
 * with such a turn has an unknown total too: summing only the priced turns would report a
 * partial figure as the run's cost (a cheap-looking run that mixed a free on-device turn with an
 * unpriced gateway one). So the first unpriced turn LATCHES the run unknown; all-priced runs
 * sum as ever (a run served entirely on the device is a known 0), and a run with no turn at all
 * reports nothing.
 *
 * Shared by the persisted run tally (`runTally.ts`) and the event-trace fold (`eventTally.ts`),
 * which count the same turns, so the two cannot disagree. PURE.
 */

/** The cost fields a tally carries. */
export interface RunCost {
  /** Millicents summed over the turns that reported one. */
  sum?: number;
  /** Some turn reported none: the run's cost is unknown whatever `sum` holds. */
  unpriced?: true;
}

/** Fold one turn's reported cost (`undefined` = the turn was not priced) into the running cost. */
export function foldTurnCost(cost: RunCost, turnCostMc: number | undefined): RunCost {
  if (turnCostMc === undefined) return { ...cost, unpriced: true };
  return { ...cost, sum: (cost.sum ?? 0) + turnCostMc };
}

/** The run's cost as it is reported: the sum when every turn was priced, else nothing. */
export function reportedRunCost(cost: RunCost): number | undefined {
  return cost.unpriced ? undefined : cost.sum;
}
