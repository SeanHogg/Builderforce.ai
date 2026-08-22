/**
 * The rating arithmetic.
 *
 * A wrong average is the worst kind of defect this feature can have: it renders
 * as a confident number beside a real company's name, nobody can tell by looking
 * that it is wrong, and the people it misrepresents are not customers who would
 * report it.
 */

import { describe, expect, it } from 'vitest';
import { RATING_MAX, RATING_MIN, summarise } from './objectReviews';

describe('rating summary', () => {
  it('reports no average at all when there are no reviews', () => {
    // Null, not 0 — an unrated employer rendered as "0.0 ★" is a libel with a
    // decimal point.
    expect(summarise([])).toEqual({
      count: 0, average: null, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    });
  });

  it('weights by how many people gave each score', () => {
    // The bug a naive `mean(distinct scores)` has: this is 40×5 and 10×1, which
    // is 4.2 — not 3.0, the average of the two distinct values.
    const summary = summarise([{ score: 5, n: 40 }, { score: 1, n: 10 }]);
    expect(summary.count).toBe(50);
    expect(summary.average).toBe(4.2);
  });

  it('keeps the distribution, because an average hides its own shape', () => {
    const summary = summarise([{ score: 5, n: 40 }, { score: 1, n: 10 }]);
    expect(summary.distribution).toEqual({ 1: 10, 2: 0, 3: 0, 4: 0, 5: 40 });
  });

  it('rounds to one decimal rather than carrying float noise', () => {
    // 1+2+3 over 3 is exactly 2; 1+2 over 3 would be 1.6666…
    expect(summarise([{ score: 1, n: 1 }, { score: 2, n: 1 }, { score: 3, n: 1 }]).average).toBe(2);
    expect(summarise([{ score: 1, n: 2 }, { score: 3, n: 1 }]).average).toBe(1.7);
  });

  it('drops a score outside the scale instead of averaging it in', () => {
    // A 0 or a 9 in the data is corruption, and folding it into the mean spreads
    // the corruption across every other review.
    const summary = summarise([{ score: 5, n: 2 }, { score: 0, n: 5 }, { score: 9, n: 5 }]);
    expect(summary.count).toBe(2);
    expect(summary.average).toBe(5);
  });

  it('ignores a non-positive count', () => {
    expect(summarise([{ score: 4, n: 0 }, { score: 5, n: -3 }]).count).toBe(0);
  });

  it('accepts both ends of the scale', () => {
    expect(summarise([{ score: RATING_MIN, n: 1 }]).average).toBe(1);
    expect(summarise([{ score: RATING_MAX, n: 1 }]).average).toBe(5);
  });

  it('sums repeated buckets for the same score', () => {
    // The grouped query returns one row per (object, value), but the bulk path
    // stitches several queries' rows together and must not lose either.
    const summary = summarise([{ score: 4, n: 3 }, { score: 4, n: 2 }]);
    expect(summary.count).toBe(5);
    expect(summary.distribution[4]).toBe(5);
  });
});
