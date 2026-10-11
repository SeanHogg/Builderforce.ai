import { describe, expect, it } from 'vitest';
import { DAY_MS } from '../shared/time';
import { HEAT_DECAY_PER_DAY, heatScore, rankHeatZones } from './heatZones';

describe('heatScore', () => {
  const now = new Date('2026-06-01T00:00:00.000Z');

  it('is the raw count when lastSeen is now', () => {
    expect(heatScore(10, now, now)).toBe(10);
  });

  it('decays by 0.97 per day', () => {
    const yesterday = new Date(now.getTime() - DAY_MS);
    expect(heatScore(100, yesterday, now)).toBeCloseTo(100 * HEAT_DECAY_PER_DAY, 10);
  });

  it('does not invert a future lastSeen into a boost', () => {
    const tomorrow = new Date(now.getTime() + DAY_MS);
    expect(heatScore(10, tomorrow, now)).toBe(10);
  });
});

describe('rankHeatZones', () => {
  const now = new Date('2026-06-01T00:00:00.000Z');

  it('orders by recency-weighted score, not raw count', () => {
    const oldHot = { id: 'old', count: 100, lastSeen: new Date(now.getTime() - 60 * DAY_MS) };
    const recent = { id: 'recent', count: 20, lastSeen: now };
    const ranked = rankHeatZones([oldHot, recent], now, 10);
    expect(ranked.map((r) => r.id)).toEqual(['recent', 'old']);
    expect(ranked[0]!.score).toBe(20);
    expect(ranked[1]!.score).toBeCloseTo(100 * Math.pow(HEAT_DECAY_PER_DAY, 60), 8);
  });

  it('respects the limit', () => {
    const rows = [
      { id: 'a', count: 3, lastSeen: now },
      { id: 'b', count: 2, lastSeen: now },
      { id: 'c', count: 1, lastSeen: now },
    ];
    expect(rankHeatZones(rows, now, 2).map((r) => r.id)).toEqual(['a', 'b']);
  });
});
