/**
 * The coverage behind the engineering spend total. The total counts only the runs that REPORTED a
 * cost (an unreported cost is unknown, not $0), so when some did not, the card says how many did.
 * Null when every run is priced (or there are no runs), and the card keeps its ordinary subtitle.
 */
export function costCoverage(totals: { runs: number; pricedRuns?: number }): { priced: number; total: number } | null {
  const priced = totals.pricedRuns ?? totals.runs;
  return totals.runs > 0 && priced < totals.runs ? { priced, total: totals.runs } : null;
}
