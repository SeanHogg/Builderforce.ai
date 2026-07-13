import { describe, it, expect } from 'vitest';
import { dayKeyUTC, densifyDaily, seriesTotal } from './dailySeries';

// ---------------------------------------------------------------------------
// Date-windowed daily aggregation helpers — the primitive behind every
// trend/sparkline widget. Pure (no DB), so we guard the windowing + gap-fill
// directly.
// ---------------------------------------------------------------------------

const NOON = Date.UTC(2026, 5, 28, 12, 0, 0); // 2026-06-28T12:00Z

describe('dayKeyUTC', () => {
  it('formats epoch-ms and Date as UTC YYYY-MM-DD', () => {
    expect(dayKeyUTC(NOON)).toBe('2026-06-28');
    expect(dayKeyUTC(new Date(NOON))).toBe('2026-06-28');
  });

  it('uses UTC calendar day, not local', () => {
    // 23:30Z still belongs to the 28th in UTC.
    expect(dayKeyUTC(Date.UTC(2026, 5, 28, 23, 30))).toBe('2026-06-28');
  });
});

describe('densifyDaily', () => {
  it('produces one dense point per day, oldest → newest, zero-filling gaps', () => {
    const byDay = new Map<string, number>([
      ['2026-06-28', 5],
      ['2026-06-26', 2],
    ]);
    const series = densifyDaily(byDay, 3, NOON);
    expect(series).toEqual([
      { day: '2026-06-26', value: 2 },
      { day: '2026-06-27', value: 0 },
      { day: '2026-06-28', value: 5 },
    ]);
  });

  it('returns exactly `days` points', () => {
    expect(densifyDaily(new Map(), 7, NOON)).toHaveLength(7);
  });
});

describe('seriesTotal', () => {
  it('sums the window', () => {
    expect(seriesTotal(densifyDaily(new Map([['2026-06-28', 5], ['2026-06-27', 3]]), 3, NOON))).toBe(8);
  });
});
