import { describe, expect, it } from 'vitest';
import { decaySince, decayWeight, foldDecayedMean, ROUTING_HALF_LIFE_DAYS } from './recencyDecay.js';

const DAY = 86_400_000;

describe('recency decay', () => {
  it('halves every half-life, and never inflates on skew', () => {
    expect(decayWeight(0)).toBe(1);
    expect(decayWeight(ROUTING_HALF_LIFE_DAYS * DAY)).toBeCloseTo(0.5);
    expect(decayWeight(2 * ROUTING_HALF_LIFE_DAYS * DAY)).toBeCloseTo(0.25);
    expect(decayWeight(-5 * DAY)).toBe(1);
    expect(decayWeight(Number.NaN)).toBe(1);
  });

  it('with no age the decayed mean IS the Welford mean', () => {
    let m = { mean: 0, weight: 0 };
    for (const x of [1, 0, 1, 1]) m = foldDecayedMean(m.mean, m.weight, x, 0);
    expect(m.mean).toBeCloseTo(0.75);
    expect(m.weight).toBe(4);
  });

  it('old evidence counts less than a fresh point', () => {
    // Ten old zeros a full half-life ago, then one fresh 1.
    const m = foldDecayedMean(0, 10, 1, ROUTING_HALF_LIFE_DAYS * DAY);
    expect(m.weight).toBeCloseTo(6);
    expect(m.mean).toBeCloseTo(1 / 6);
  });

  it('reads as-is when a timestamp is unknown', () => {
    expect(decaySince(undefined, Date.now())).toBe(1);
    expect(decaySince(0, undefined)).toBe(1);
  });
});
