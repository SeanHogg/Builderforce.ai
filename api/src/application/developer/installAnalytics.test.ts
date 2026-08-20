/**
 * The shaping half of the publisher's analytics — the part that decides what a
 * chart draws. A sparse series and a dense one are not the same data plotted
 * differently; the sparse one joins two distant points across a quiet week and
 * reads as growth that did not happen.
 */
import { describe, expect, it } from 'vitest';
import { countByDay, densifyDaily } from './installAnalytics';

describe('countByDay', () => {
  it('buckets in UTC and ignores the nulls a never-disabled install carries', () => {
    const counts = countByDay([
      new Date('2026-08-18T23:59:00.000Z'),
      new Date('2026-08-19T00:01:00.000Z'),
      new Date('2026-08-19T22:00:00.000Z'),
      null,
    ]);
    expect(counts.get('2026-08-18')).toBe(1);
    expect(counts.get('2026-08-19')).toBe(2);
    expect(counts.size).toBe(2);
  });
});

describe('densifyDaily', () => {
  it('fills every day in the range, including the empty ones', () => {
    const series = densifyDaily(
      new Map([['2026-08-19', 3]]),
      new Date('2026-08-17T12:00:00.000Z'),
      new Date('2026-08-20T09:00:00.000Z'),
    );
    expect(series.map((p) => p.day)).toEqual(['2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20']);
    expect(series.map((p) => p.value)).toEqual([0, 0, 3, 0]);
  });

  it('includes both ends, so a one-day window is one point rather than none', () => {
    const day = new Date('2026-08-20T05:00:00.000Z');
    expect(densifyDaily(new Map(), day, day)).toEqual([{ day: '2026-08-20', value: 0 }]);
  });
});
