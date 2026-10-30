/**
 * telemetry/costTally — the ONE rule for what a run cost, from what each turn reported.
 *
 * A turn the transport did not price (no `costMc`) has an UNKNOWN cost, not a free one. A run with such
 * a turn has an unknown total too: summing only the priced turns would report a partial figure as the
 * run's cost (a cheap-looking run that mixed a free on-device turn with an unpriced gateway one). So the
 * first unpriced turn LATCHES the run unknown; all-priced runs sum as ever (a run served entirely on the
 * device is a known 0), and a run with no turn at all reports nothing.
 *
 * The running value is a single plain-JSON field on whichever tally holds it (`RunTally.costMc`,
 * `EventTally.cost`): a number while every turn so far was priced, `null` once one was not, `undefined`
 * before any turn. {@link reportedRunCost} reads it as the figure to report. PURE.
 */

/** A run's cost so far: the sum while every turn was priced, `null` (unknown) once one was not. */
export type RunningCost = number | null | undefined;

/** Fold one turn's reported cost (`undefined` = the turn was not priced) into the running cost. */
export function foldTurnCost(running: RunningCost, turnCostMc: number | undefined): number | null {
  if (running === null || turnCostMc === undefined) return null;
  return (running ?? 0) + turnCostMc;
}

/** The run's cost as it is reported: the sum when every turn was priced, else nothing. */
export function reportedRunCost(running: RunningCost): number | undefined {
  return running ?? undefined;
}
