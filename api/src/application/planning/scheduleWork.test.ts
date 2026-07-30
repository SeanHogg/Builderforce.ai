import { describe, expect, it } from 'vitest';
import {
  addWorkingDays, estimateDaysFromStoryPoints, normalizeEstimateDays,
  nextWorkingDay, scheduleItems, workingDaysBetween,
} from './scheduleWork';

/** A Monday, so weekend arithmetic in the assertions is easy to read. */
const MONDAY = new Date('2026-08-03T00:00:00.000Z');
const iso = (d: Date) => d.toISOString().slice(0, 10);

describe('working-day arithmetic', () => {
  it('treats a weekend date as the following Monday', () => {
    expect(iso(nextWorkingDay(new Date('2026-08-08T00:00:00Z')))).toBe('2026-08-10'); // Sat → Mon
    expect(iso(nextWorkingDay(new Date('2026-08-09T00:00:00Z')))).toBe('2026-08-10'); // Sun → Mon
    expect(iso(nextWorkingDay(MONDAY))).toBe('2026-08-03');
  });

  it('skips weekends when advancing', () => {
    // Mon + 4 working days = Fri; + 5 = the next Mon.
    expect(iso(addWorkingDays(MONDAY, 4))).toBe('2026-08-07');
    expect(iso(addWorkingDays(MONDAY, 5))).toBe('2026-08-10');
  });

  it('counts working days inclusively', () => {
    expect(workingDaysBetween(MONDAY, new Date('2026-08-03T00:00:00Z'))).toBe(1);
    expect(workingDaysBetween(MONDAY, new Date('2026-08-07T00:00:00Z'))).toBe(5);
    // The weekend in between is not counted.
    expect(workingDaysBetween(MONDAY, new Date('2026-08-10T00:00:00Z'))).toBe(6);
  });

  it('clamps nonsense estimates instead of trusting them', () => {
    expect(normalizeEstimateDays(undefined)).toBe(2);
    expect(normalizeEstimateDays(0)).toBe(2);
    expect(normalizeEstimateDays(-5)).toBe(2);
    expect(normalizeEstimateDays(1000)).toBe(60);
    expect(normalizeEstimateDays(3.4)).toBe(3);
  });

  it('maps story points to a shallow day estimate', () => {
    expect(estimateDaysFromStoryPoints(null)).toBeNull();
    expect(estimateDaysFromStoryPoints(0)).toBeNull();
    expect(estimateDaysFromStoryPoints(1)).toBe(1);
    expect(estimateDaysFromStoryPoints(8)).toBe(4);
  });
});

describe('scheduleItems', () => {
  it('runs independent items in PARALLEL from the anchor', () => {
    const r = scheduleItems(
      [{ key: 'a', estimateDays: 2 }, { key: 'b', estimateDays: 3 }],
      { anchor: MONDAY },
    );
    expect(iso(r.windows.get('a')!.startDate)).toBe('2026-08-03');
    expect(iso(r.windows.get('b')!.startDate)).toBe('2026-08-03');
    expect(iso(r.windows.get('a')!.endDate)).toBe('2026-08-04');
    expect(iso(r.windows.get('b')!.endDate)).toBe('2026-08-05');
    expect(iso(r.span!.endDate)).toBe('2026-08-05');
  });

  it('starts a successor the next working day after its predecessor ends', () => {
    const r = scheduleItems(
      [
        { key: 'design', estimateDays: 3 },
        { key: 'build', estimateDays: 2, afterKeys: ['design'] },
      ],
      { anchor: MONDAY },
    );
    expect(iso(r.windows.get('design')!.endDate)).toBe('2026-08-05'); // Wed
    expect(iso(r.windows.get('build')!.startDate)).toBe('2026-08-06'); // Thu
    expect(iso(r.windows.get('build')!.endDate)).toBe('2026-08-07');
  });

  it('rolls a successor over a weekend rather than into it', () => {
    const r = scheduleItems(
      [
        { key: 'a', estimateDays: 5 },                       // Mon–Fri
        { key: 'b', estimateDays: 1, afterKeys: ['a'] },     // must land on the Monday
      ],
      { anchor: MONDAY },
    );
    expect(iso(r.windows.get('a')!.endDate)).toBe('2026-08-07');
    expect(iso(r.windows.get('b')!.startDate)).toBe('2026-08-10');
  });

  it('compresses to fit a deadline instead of silently overrunning it', () => {
    const r = scheduleItems(
      [
        { key: 'a', estimateDays: 10 },
        { key: 'b', estimateDays: 10, afterKeys: ['a'] },
      ],
      { anchor: MONDAY, deadline: new Date('2026-08-14T00:00:00Z') }, // 10 working days
    );
    expect(r.compressed).toBe(true);
    expect(r.span!.endDate.getTime()).toBeLessThanOrEqual(new Date('2026-08-14T00:00:00Z').getTime());
    // Order still holds after compression.
    expect(r.windows.get('b')!.startDate.getTime())
      .toBeGreaterThan(r.windows.get('a')!.endDate.getTime());
  });

  it('reports an overrun it cannot compress away rather than hiding it', () => {
    const r = scheduleItems(
      [
        { key: 'a', estimateDays: 5 },
        { key: 'b', estimateDays: 5, afterKeys: ['a'] },
      ],
      // One single day for two items that cannot go below a day each.
      { anchor: MONDAY, deadline: new Date('2026-08-03T00:00:00Z') },
    );
    expect(r.overruns.length).toBeGreaterThan(0);
  });

  it('does not deadlock on a dependency cycle — it reports it', () => {
    const r = scheduleItems(
      [
        { key: 'a', estimateDays: 1, afterKeys: ['b'] },
        { key: 'b', estimateDays: 1, afterKeys: ['a'] },
      ],
      { anchor: MONDAY },
    );
    expect(r.cyclic.sort()).toEqual(['a', 'b']);
    // Both are still placed (at the anchor), never dropped.
    expect(r.windows.size).toBe(2);
    expect(iso(r.windows.get('a')!.startDate)).toBe('2026-08-03');
  });

  it('ignores a dependency on an item outside the set', () => {
    const r = scheduleItems([{ key: 'a', estimateDays: 1, afterKeys: ['ghost'] }], { anchor: MONDAY });
    expect(iso(r.windows.get('a')!.startDate)).toBe('2026-08-03');
    expect(r.cyclic).toEqual([]);
  });

  it('returns an empty result for no items', () => {
    const r = scheduleItems([], { anchor: MONDAY });
    expect(r.span).toBeNull();
    expect(r.windows.size).toBe(0);
  });
});
