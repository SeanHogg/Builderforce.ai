/**
 * A run that reported no cost is UNKNOWN, not free: the live fold skips it exactly as the
 * reconcile does (its `avg` and weighted mean skip NULLs), so a model's cost mean is the same
 * whichever writer produced it, and an unknown cost neither wins nor loses a tie-break.
 */
import { describe, expect, it } from 'vitest';
import { applyObservation, type RoutingTable } from './routingFold';
import { assignOutcomeAggregate, type ActionModelStat } from './routingTable';

const empty = (): RoutingTable => ({ updatedAt: new Date(0).toISOString(), byAction: {} });
const obs = (model: string, costMc?: number, score = 0.8) => ({
  actionType: 'sql' as const, model, score, merged: true, ...(costMc === undefined ? {} : { costMc }),
});
const statOf = (t: RoutingTable, model: string) => t.byAction.sql!.find((s) => s.model === model)!;

function fold(observations: Array<ReturnType<typeof obs>>, decay?: { nowMs: number }): RoutingTable {
  return observations.reduce((table, o) => applyObservation(table, o, decay), empty());
}

describe('the live fold skips an unreported cost', () => {
  const mixed = [
    ...Array.from({ length: 10 }, () => obs('m', 50_000)),
    ...Array.from({ length: 30 }, () => obs('m')),
  ];

  it('averages 10 priced runs @50k and 30 unknown ones to 50k, over costN = 10', () => {
    const stat = statOf(fold(mixed), 'm');

    expect(stat.n).toBe(40);
    expect(stat.costN).toBe(10);
    expect(stat.avgCostMc).toBeCloseTo(50_000, 6);
  });

  it('matches the reconcile: the same model read back from the grouped aggregate', () => {
    // What the reconcile's SQL returns for those 40 rows: count(*), count(cost), avg(cost) over the priced ones.
    const reconciled: ActionModelStat = { model: 'm', n: 0, avgScore: 0, mergeRate: 0, avgCostMc: 0, costN: 0 };
    assignOutcomeAggregate(reconciled, { n: 40, avgScore: 0.8, avgCost: 50_000, costN: 10, mergeRate: 1, rateLimitRate: 0 }, 0);

    const folded = statOf(fold(mixed), 'm');
    expect(reconciled.avgCostMc).toBeCloseTo(folded.avgCostMc, 6);
    expect(reconciled.costN).toBe(folded.costN);
  });

  it('does not depend on the order the unknown and priced runs arrive in', () => {
    const unknownFirst = statOf(fold([...mixed].reverse()), 'm');

    expect(unknownFirst.costN).toBe(10);
    expect(unknownFirst.avgCostMc).toBeCloseTo(50_000, 6);
  });

  it('keeps a model with no priced run at costN 0: unknown, not a mean of zero', () => {
    const stat = statOf(fold([obs('m'), obs('m')]), 'm');

    expect(stat.n).toBe(2);
    expect(stat.costN).toBe(0);
  });

  it('counts a reported cost of 0 as priced (free is a fact; absent is not)', () => {
    const stat = statOf(fold([obs('m', 0), obs('m', 100)]), 'm');

    expect(stat.costN).toBe(2);
    expect(stat.avgCostMc).toBeCloseTo(50, 6);
  });

  it('decayed: unknown runs age the weight behind the cost mean but never move the mean', () => {
    const t0 = Date.UTC(2026, 9, 1);
    const stat = statOf(fold([obs('m', 50_000), obs('m'), obs('m'), obs('m', 50_000)], { nowMs: t0 }), 'm');

    expect(stat.avgCostMc).toBeCloseTo(50_000, 6);
    expect(stat.costN).toBe(2);
  });

  it('resumes a blob written before cost could be unknown: every earlier run counted as priced', () => {
    const legacy: RoutingTable = {
      updatedAt: new Date(0).toISOString(),
      byAction: { sql: [{ model: 'm', n: 4, avgScore: 0.8, mergeRate: 1, avgCostMc: 100 }] },
    };

    const stat = statOf(applyObservation(legacy, obs('m', 200)), 'm');

    expect(stat.costN).toBe(5);
    expect(stat.avgCostMc).toBeCloseTo(120, 6);
  });
});

describe('the tie-break between equal scorers', () => {
  it('does not let an unknown cost win it: a model that never reported a cost is not "cheapest"', () => {
    const table = fold([obs('priced', 10), obs('unknown')]);

    expect(table.byAction.sql!.map((s) => s.model)).toEqual(['priced', 'unknown']);
  });

  it('does not let an unknown cost lose it either: order falls to the stable index', () => {
    const table = fold([obs('unknown'), obs('priced', 10)]);

    expect(table.byAction.sql!.map((s) => s.model)).toEqual(['unknown', 'priced']);
  });

  it('still prefers the cheaper of two models that both report a cost', () => {
    const table = fold([obs('dear', 900), obs('cheap', 10)]);

    expect(table.byAction.sql!.map((s) => s.model)).toEqual(['cheap', 'dear']);
  });
});
