import { describe, expect, it } from 'vitest';
import { costForTieBreak, hasCostMean, rankWithCostTieBreak } from './costEvidence.js';

describe('costEvidence', () => {
  it('reads a stat with no costN as priced (blobs written before cost could be unknown)', () => {
    expect(hasCostMean({})).toBe(true);
    expect(hasCostMean({ costN: 3 })).toBe(true);
    expect(hasCostMean({ costN: 0 })).toBe(false);
  });

  it('hands the tie-break a mean only when the stat has one', () => {
    expect(costForTieBreak({ avgCostMc: 5, costN: 1 })).toBe(5);
    expect(costForTieBreak({ avgCostMc: 0, costN: 0 })).toBeNull();
  });
});

interface Item { id: string; score: number; cost: number | null; index: number; rl?: number }
const keys = {
  band: (i: Item) => i.rl ?? 0,
  score: (i: Item) => i.score,
  index: (i: Item) => i.index,
  cost: (i: Item) => i.cost,
};
const ids = (items: Item[]) => items.map((i) => i.id);

function permutations<T>(list: T[]): T[][] {
  if (list.length <= 1) return [list];
  return list.flatMap((head, at) => permutations([...list.slice(0, at), ...list.slice(at + 1)]).map((rest) => [head, ...rest]));
}

describe('rankWithCostTieBreak', () => {
  // The curated order is [C, B, A]; A is the cheapest priced model, C the dearest, B reports no cost.
  const A: Item = { id: 'A', score: 0.8, cost: 5, index: 2 };
  const B: Item = { id: 'B', score: 0.8, cost: null, index: 1 };
  const C: Item = { id: 'C', score: 0.8, cost: 9, index: 0 };

  it('gives the same order for all six input orders', () => {
    const results = permutations([A, B, C]).map((order) => ids(rankWithCostTieBreak(order, keys)).join(''));

    expect(new Set(results)).toEqual(new Set(['ABC']));
  });

  it('never places a dearer priced model before a cheaper one because an unpriced one sits between them', () => {
    for (const order of permutations([A, B, C])) {
      const ranked = ids(rankWithCostTieBreak(order, keys));
      expect(ranked.indexOf('A')).toBeLessThan(ranked.indexOf('C'));
    }
  });

  it('keeps an unknown cost in its own place: it neither wins nor loses', () => {
    // Curated [C, B, A] → slots: priced, unknown, priced. The unknown model stays in the middle.
    expect(ids(rankWithCostTieBreak([C, B, A], keys))).toEqual(['A', 'B', 'C']);
  });

  it('is idempotent: ranking a ranked list changes nothing when the indexes are the ranks', () => {
    const once = rankWithCostTieBreak([C, B, A], keys);
    const reindexed = once.map((item, index) => ({ ...item, index }));

    expect(ids(rankWithCostTieBreak(reindexed, keys))).toEqual(ids(once));
  });

  it('lets score decide before cost, and leaves a different-score model where its score puts it', () => {
    const best: Item = { id: 'best', score: 0.95, cost: 900, index: 3 };
    const ranked = rankWithCostTieBreak([A, B, C, best], keys);

    expect(ids(ranked)).toEqual(['best', 'A', 'B', 'C']);
  });

  it('keeps the trailing band behind everything, ranking inside it by the same rule', () => {
    const throttledCheap: Item = { id: 'tc', score: 0.99, cost: 1, index: 4, rl: 1 };
    const throttledDear: Item = { id: 'td', score: 0.99, cost: 50, index: 5, rl: 1 };
    const ranked = rankWithCostTieBreak([throttledDear, C, throttledCheap, A], keys);

    expect(ids(ranked)).toEqual(['A', 'C', 'tc', 'td']);
  });

  it('breaks a cost tie between priced models by index', () => {
    const x: Item = { id: 'x', score: 0.5, cost: 7, index: 1 };
    const y: Item = { id: 'y', score: 0.5, cost: 7, index: 0 };

    expect(ids(rankWithCostTieBreak([x, y], keys))).toEqual(['y', 'x']);
  });
});
