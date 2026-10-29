/**
 * A run that reported no cost (a canvas turn, a client run with no gateway cost) stores NULL:
 * unknown, not free. The cost lenses read it through `pricedCost`, so they skip it, and a group in
 * which no run reported a cost reads as unknown (null) — never as $0 or as the cheapest run.
 */
import { describe, expect, it } from 'vitest';
import { scoreComponents, summarizeComparison, type ImpactOutcomeRow } from './aiImpactInsights';
import { summarizeOutcomes, type OutcomeRow } from './engineeringInsights';
import { pricedCostPerMergedUsd, pricedCostUsd } from './pricedCost';

const impact = (over: Partial<ImpactOutcomeRow> = {}): ImpactOutcomeRow => ({
  resolvedModel: 'm', score: 1, merged: true, ciGreen: true, steps: 3, costUsdMillicents: 100_000, ...over,
});
const outcome = (over: Partial<OutcomeRow> = {}): OutcomeRow => ({
  actionType: 'feature', resolvedModel: 'm', score: 1, merged: true, ciGreen: true, degraded: false, steps: 3, costUsdMillicents: 100_000, ...over,
});

describe('the priced-cost helpers', () => {
  it('sums only the runs that reported a cost, and reads none reported as unknown', () => {
    expect(pricedCostUsd([{ costUsdMillicents: 100_000 }, { costUsdMillicents: null }])).toBe(1);
    expect(pricedCostUsd([{ costUsdMillicents: 0 }])).toBe(0);
    expect(pricedCostUsd([{ costUsdMillicents: null }])).toBeNull();
    expect(pricedCostUsd([])).toBeNull();
  });

  it('divides by the merged runs that reported a cost, not by every merged run', () => {
    const runs = [
      { merged: true, costUsdMillicents: 200_000 },
      { merged: true, costUsdMillicents: null },
      { merged: false, costUsdMillicents: 100_000 },
    ];

    expect(pricedCostPerMergedUsd(runs)).toBe(3);
    expect(pricedCostPerMergedUsd([{ merged: true, costUsdMillicents: null }])).toBeNull();
  });
});

describe('cost per merged PR (AI impact)', () => {
  it('averages over the merged runs that reported a cost — an unknown cost does not dilute it toward free', () => {
    const [comparison] = summarizeComparison([impact({ costUsdMillicents: 100_000 }), impact({ costUsdMillicents: null })], new Map());

    expect(comparison?.costPerMergedPrUsd).toBe(1);
  });

  it('is unknown when no merged run reported a cost', () => {
    const [comparison] = summarizeComparison([impact({ costUsdMillicents: null })], new Map());

    expect(comparison?.costPerMergedPrUsd).toBeNull();
    expect(scoreComponents([impact({ costUsdMillicents: null })]).efficiency).toBe(0);
  });
});

describe('spend totals (engineering)', () => {
  it('skips a run with no reported cost', () => {
    const insights = summarizeOutcomes([outcome({ costUsdMillicents: 100_000 }), outcome({ costUsdMillicents: null })], 30);

    expect(insights.totals.costUsd).toBe(1);
    expect(insights.totals.costPerMergedPrUsd).toBe(1);
    expect(insights.totals.runs).toBe(2);
  });

  it('reads a bucket where every run is unknown as unknown, not $0', () => {
    const insights = summarizeOutcomes([
      outcome({ resolvedModel: 'priced', costUsdMillicents: 100_000 }),
      outcome({ resolvedModel: 'unpriced', costUsdMillicents: null }),
    ], 30);

    const byModel = Object.fromEntries(insights.byModel.map((b) => [b.key, b.costUsd]));
    expect(byModel).toEqual({ priced: 1, unpriced: null });
    expect(summarizeOutcomes([outcome({ costUsdMillicents: null })], 30).totals.costUsd).toBeNull();
  });
});
