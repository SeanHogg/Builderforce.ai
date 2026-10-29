/**
 * A run that reported no cost (a canvas turn, a client run with no gateway cost) stores NULL:
 * unknown, not free. The cost lenses skip it, so it never reads as the cheapest run.
 */
import { describe, expect, it } from 'vitest';
import { scoreComponents, summarizeComparison, type ImpactOutcomeRow } from './aiImpactInsights';
import { summarizeOutcomes, type OutcomeRow } from './engineeringInsights';

const impact = (over: Partial<ImpactOutcomeRow> = {}): ImpactOutcomeRow => ({
  resolvedModel: 'm', score: 1, merged: true, ciGreen: true, steps: 3, costUsdMillicents: 100_000, ...over,
});
const outcome = (over: Partial<OutcomeRow> = {}): OutcomeRow => ({
  actionType: 'feature', resolvedModel: 'm', score: 1, merged: true, ciGreen: true, degraded: false, steps: 3, costUsdMillicents: 100_000, ...over,
});

describe('cost per merged PR', () => {
  it('averages over the merged runs that reported a cost — an unknown cost does not dilute it toward free', () => {
    const rows = [impact({ costUsdMillicents: 100_000 }), impact({ costUsdMillicents: null })];

    const [comparison] = summarizeComparison(rows, new Map());

    expect(comparison?.costPerMergedPrUsd).toBe(1);
  });

  it('is unknown when no merged run reported a cost', () => {
    const [comparison] = summarizeComparison([impact({ costUsdMillicents: null })], new Map());

    expect(comparison?.costPerMergedPrUsd).toBeNull();
    expect(scoreComponents([impact({ costUsdMillicents: null })]).efficiency).toBe(0);
  });
});

describe('spend totals', () => {
  it('skips a run with no reported cost', () => {
    const insights = summarizeOutcomes([outcome({ costUsdMillicents: 100_000 }), outcome({ costUsdMillicents: null })], 30);

    expect(insights.totals.costUsd).toBe(1);
    expect(insights.totals.runs).toBe(2);
  });
});
