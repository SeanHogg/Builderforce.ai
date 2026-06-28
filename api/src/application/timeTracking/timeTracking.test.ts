import { describe, expect, it } from 'vitest';
import { bucketDailyHours, isoDay } from './timeTracking';

const NOW = new Date('2026-06-27T12:00:00Z');

describe('bucketDailyHours', () => {
  it('buckets minutes into hours per day, zero-filling the window', () => {
    const rows = [
      { entryDate: '2026-06-27', minutes: 90 },  // 1.5h today
      { entryDate: '2026-06-27', minutes: 30 },  // +0.5h same day → 2h
      { entryDate: '2026-06-25', minutes: 120 }, // 2h two days ago
    ];
    const out = bucketDailyHours(rows, 3, NOW);
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({ date: '2026-06-25', hours: 2 });
    expect(out[1]).toEqual({ date: '2026-06-26', hours: 0 }); // zero-filled
    expect(out[2]).toEqual({ date: '2026-06-27', hours: 2 }); // 90+30 min
  });

  it('ignores entries outside the trailing window', () => {
    const out = bucketDailyHours([{ entryDate: '2026-06-01', minutes: 600 }], 3, NOW);
    expect(out.every((b) => b.hours === 0)).toBe(true);
  });

  it('isoDay is UTC yyyy-mm-dd', () => {
    expect(isoDay(NOW)).toBe('2026-06-27');
  });
});
