/**
 * EXIT METRICS (PRD 25 §25a.4 C1) — `equity.exitPayoutAt`.
 *
 * The founder's payout at a stated exit value, computed from the cap table by the pure
 * `computeWaterfall`. Nothing is stored: the figure is a projection of the ledger.
 *
 * The exit value defaults to $100M (the middle of the $25M / $100M / $250M set a founder
 * is shown); the other two are exported so a preset can name them. Null — "Not measured" —
 * when there is no cap table, no classes or no individual holder, never 0.
 */

import type { Db } from '../../infrastructure/database/connection';
import { companyKey, computeCapTable } from '../finance/equity';
import { computeWaterfall } from '../finance/exitWaterfall';
import { runwayReport } from '../finance/runwayReport';
import type { MetricDef } from './metricRegistry';

/** The default exit values a founder models. */
export const DEFAULT_EXIT_VALUES = [25_000_000, 100_000_000, 250_000_000] as const;

/** The exit the single-scalar metric reports at. */
export const DEFAULT_EXIT_VALUE = DEFAULT_EXIT_VALUES[1];

async function founderPayoutAt(db: Db, tenantId: number, exitValue: number): Promise<number | null> {
  const report = await runwayReport(db, undefined, tenantId, null);
  const declared = report.declared;
  if (!declared) return null;
  const table = await computeCapTable(
    db,
    tenantId,
    companyKey(String(declared.companyId)),
    new Date().toISOString(),
  );
  if (!(table.fullyDiluted > 0) || !table.classes.length) return null;
  const individuals = table.holders.filter((holder) => holder.instrument !== 'option');
  if (!individuals.length) return null;
  const result = computeWaterfall({
    holders: table.holders,
    classes: table.classes,
    exitValue,
    vesting: 'normal',
    asOf: new Date(),
  });
  // The largest individual holder, the same reading `equity.founderOwnership` takes.
  const top = individuals.reduce((best, holder) =>
    holder.percentFullyDiluted > best.percentFullyDiluted ? holder : best);
  const row = result.byHolder.find((holder) => holder.partyRef === top.holderRef);
  return row ? Math.round(row.payout) : null;
}

export const EXIT_METRICS: Record<string, MetricDef> = {
  'equity.exitPayoutAt': {
    label: 'Founder payout at exit',
    unit: 'USD',
    description: 'The largest individual holder\'s payout at a $100M exit (also modelled at $25M and $250M), after debt, liquidation preferences and conversion.',
    goodWhenUp: true,
    async compute(db, tenantId) {
      return founderPayoutAt(db, tenantId, DEFAULT_EXIT_VALUE);
    },
  },
};
