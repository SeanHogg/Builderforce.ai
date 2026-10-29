/**
 * A run that reported no cost (a canvas turn, a client run with no gateway cost) stores NULL:
 * unknown, not free. The cost lenses read it through `pricedCost`, so they skip it, and a group in
 * which no run reported a cost reads as unknown (null) — never as $0 or as the cheapest run.
 */
import { describe, expect, it } from 'vitest';
import { scoreComponents, summarizeAiImpact, summarizeComparison, type ImpactOutcomeRow } from './aiImpactInsights';
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
  });
});

describe('productivity score (AI impact)', () => {
  it('renormalises over throughput and quality when merges exist but none reported a cost', () => {
    const unknown = scoreComponents([impact({ costUsdMillicents: null })]);

    expect(unknown.efficiency).toBeNull();
    expect(unknown.score).toBeCloseTo(((unknown.throughput + unknown.quality) / 2) * 100, 6);
  });

  it('does not score an unpriced run as the most expensive one', () => {
    const unknown = scoreComponents([impact({ costUsdMillicents: null })]);
    const dear = scoreComponents([impact({ costUsdMillicents: 5_000_000 })]);

    expect(dear.efficiency).toBe(0);
    expect(unknown.score).toBeGreaterThan(dear.score);
  });

  it('keeps the three-term composite when a merged run reported its cost', () => {
    const priced = scoreComponents([impact({ costUsdMillicents: 0 })]);

    expect(priced.efficiency).toBe(1);
    expect(priced.score).toBeCloseTo(((priced.throughput + priced.quality + 1) / 3) * 100, 6);
  });

  it('keeps efficiency at 0 when nothing merged, as before', () => {
    const none = scoreComponents([impact({ merged: false, costUsdMillicents: null })]);

    expect(none.efficiency).toBe(0);
  });
});

describe('productivity delta (AI impact)', () => {
  const DAY = 86_400_000;
  const NOW = Date.UTC(2026, 9, 29);
  const at = (outcomes: ImpactOutcomeRow[], prev: ImpactOutcomeRow[]) => summarizeAiImpact([], outcomes, prev, 30, NOW - 30 * DAY, NOW).productivity;

  it('compares both windows on throughput and quality when only one of them is priced', () => {
    const priced = [impact({ costUsdMillicents: 0 })];
    const unpriced = [impact({ costUsdMillicents: null })];

    const p = at(priced, unpriced);

    // Identical runs, so on the same terms the score is flat: the delta is 0, not an artefact of one
    // window being three-term (efficiency 1) and the other two-term.
    expect(p.score).toBeCloseTo(p.prevScore, 6);
    expect(p.deltaPct).toBeCloseTo(0, 6);
    expect(p.efficiency).toBe(1);
  });

  it('keeps the three-term composites when both windows are priced', () => {
    const p = at([impact({ costUsdMillicents: 0 })], [impact({ costUsdMillicents: 0 })]);

    expect(p.score).toBeCloseTo(scoreComponents([impact({ costUsdMillicents: 0 })]).score, 6);
    expect(p.deltaPct).toBeCloseTo(0, 6);
  });
});

describe('spend totals (engineering)', () => {
  it('skips a run with no reported cost', () => {
    const insights = summarizeOutcomes([outcome({ costUsdMillicents: 100_000 }), outcome({ costUsdMillicents: null })], 30);

    expect(insights.totals.costUsd).toBe(1);
    expect(insights.totals.costPerMergedPrUsd).toBe(1);
    expect(insights.totals.runs).toBe(2);
    // The coverage behind the total: one of two runs reported a cost.
    expect(insights.totals.pricedRuns).toBe(1);
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
