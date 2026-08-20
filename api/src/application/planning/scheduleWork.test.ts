import { describe, expect, it } from 'vitest';
import {
  addWorkingDays, estimateDaysFromStoryPoints, normalizeEstimateDays,
  nextWorkingDay, scheduleItems, workingDaysBetween,
  DEFAULT_WORKING_CALENDAR, normalizeWorkingCalendar, type WorkingCalendar,
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

// ── SCHED-R4: capacity, the working calendar, and the sprint cadence ─────────
// Before these, the planner modelled an infinitely available workforce on a
// permanent Mon-Fri week: two tickets on one person overlapped completely, a
// sprint boundary meant nothing, and a public holiday did not exist.

/** Mon-Fri with Wednesday 5 Aug 2026 declared a holiday. */
const WITH_HOLIDAY: WorkingCalendar = normalizeWorkingCalendar({
  workingWeekdays: [1, 2, 3, 4, 5],
  holidays: ['2026-08-05'],
});

describe('working calendar', () => {
  it('defaults to Mon-Fri, so an unconfigured tenant schedules exactly as before', () => {
    expect([...DEFAULT_WORKING_CALENDAR.workingWeekdays]).toEqual([1, 2, 3, 4, 5]);
    expect([...DEFAULT_WORKING_CALENDAR.holidays]).toEqual([]);
  });

  it('refuses an empty working week rather than making every day non-working', () => {
    // An empty week would hang any forward walk; it degrades to the default instead.
    expect([...normalizeWorkingCalendar({ workingWeekdays: [] }).workingWeekdays]).toEqual([1, 2, 3, 4, 5]);
    expect([...normalizeWorkingCalendar({ workingWeekdays: ['nonsense', 99] }).workingWeekdays]).toEqual([1, 2, 3, 4, 5]);
  });

  it('honours a configured working week (Sun-Thu)', () => {
    const sunThu = normalizeWorkingCalendar({ workingWeekdays: [0, 1, 2, 3, 4] });
    // Friday 7 Aug 2026 is not worked; the next working day is Sunday the 9th.
    expect(iso(nextWorkingDay(new Date('2026-08-07T00:00:00Z'), sunThu))).toBe('2026-08-09');
  });

  it('skips a configured HOLIDAY when advancing', () => {
    // Mon 3rd + 2 working days would be Wed 5th, which is a holiday → Thu 6th.
    expect(iso(addWorkingDays(MONDAY, 2, WITH_HOLIDAY))).toBe('2026-08-06');
    expect(workingDaysBetween(MONDAY, new Date('2026-08-07T00:00:00Z'), WITH_HOLIDAY)).toBe(4);
  });

  it('pushes a scheduled item across a configured holiday', () => {
    const plain = scheduleItems([{ key: 'a', estimateDays: 3 }], { anchor: MONDAY });
    expect(iso(plain.windows.get('a')!.endDate)).toBe('2026-08-05');

    const withHoliday = scheduleItems([{ key: 'a', estimateDays: 3 }], { anchor: MONDAY, calendar: WITH_HOLIDAY });
    // Same three days of WORK, one day later, because nobody works the 5th.
    expect(iso(withHoliday.windows.get('a')!.endDate)).toBe('2026-08-06');
  });
});

describe('assignee capacity', () => {
  it('SERIALISES two tickets on one assignee instead of overlapping them', () => {
    const r = scheduleItems(
      [
        { key: 'a', estimateDays: 2, assigneeKey: 'human:ada' },
        { key: 'b', estimateDays: 2, assigneeKey: 'human:ada' },
      ],
      { anchor: MONDAY },
    );
    expect(iso(r.windows.get('a')!.startDate)).toBe('2026-08-03');
    expect(iso(r.windows.get('a')!.endDate)).toBe('2026-08-04');
    // b cannot start until a is done — one person, one ticket.
    expect(iso(r.windows.get('b')!.startDate)).toBe('2026-08-05');
    expect(r.capacityDeferred).toEqual(['b']);
  });

  it('still runs two tickets on DIFFERENT assignees in parallel', () => {
    const r = scheduleItems(
      [
        { key: 'a', estimateDays: 2, assigneeKey: 'human:ada' },
        { key: 'b', estimateDays: 2, assigneeKey: 'cloud_agent:grace' },
      ],
      { anchor: MONDAY },
    );
    expect(iso(r.windows.get('b')!.startDate)).toBe('2026-08-03');
    expect(r.capacityDeferred).toEqual([]);
  });

  it('leaves unowned work unconstrained — nobody\u2019s time is being spent', () => {
    const r = scheduleItems(
      [{ key: 'a', estimateDays: 2 }, { key: 'b', estimateDays: 2 }],
      { anchor: MONDAY },
    );
    expect(iso(r.windows.get('b')!.startDate)).toBe('2026-08-03');
  });

  it('stretches an item for a half-available owner rather than pretending it is free', () => {
    const r = scheduleItems(
      [{ key: 'a', estimateDays: 2, assigneeKey: 'human:ada' }],
      { anchor: MONDAY, capacity: new Map([['human:ada', { availability: 0.5 }]]) },
    );
    expect(r.windows.get('a')!.days).toBe(4);
  });

  it('lets an owner with real concurrency hold two at once', () => {
    const r = scheduleItems(
      [
        { key: 'a', estimateDays: 2, assigneeKey: 'host_agent:7' },
        { key: 'b', estimateDays: 2, assigneeKey: 'host_agent:7' },
      ],
      { anchor: MONDAY, capacity: { 'host_agent:7': { concurrency: 2 } } },
    );
    expect(iso(r.windows.get('b')!.startDate)).toBe('2026-08-03');
  });
});

describe('sprint boundaries', () => {
  /** Two consecutive one-week sprints, Mon 3rd-Fri 7th and Mon 10th-Fri 14th. */
  const SPRINTS = [
    { startDate: new Date('2026-08-03T00:00:00Z'), endDate: new Date('2026-08-07T00:00:00Z') },
    { startDate: new Date('2026-08-10T00:00:00Z'), endDate: new Date('2026-08-14T00:00:00Z') },
  ];

  it('pushes work that would STRADDLE a boundary into the next sprint', () => {
    const r = scheduleItems(
      [
        { key: 'a', estimateDays: 4, assigneeKey: 'human:ada' },
        // 3 days starting Fri the 7th would run into the next sprint.
        { key: 'b', estimateDays: 3, assigneeKey: 'human:ada' },
      ],
      { anchor: MONDAY, sprints: SPRINTS },
    );
    expect(iso(r.windows.get('a')!.endDate)).toBe('2026-08-06');
    expect(iso(r.windows.get('b')!.startDate)).toBe('2026-08-10');
    expect(iso(r.windows.get('b')!.endDate)).toBe('2026-08-12');
  });

  it('leaves work that fits inside its sprint exactly where it is', () => {
    const r = scheduleItems([{ key: 'a', estimateDays: 3 }], { anchor: MONDAY, sprints: SPRINTS });
    expect(iso(r.windows.get('a')!.startDate)).toBe('2026-08-03');
  });

  it('lets an item LONGER than a whole sprint span, rather than refusing to place it', () => {
    const r = scheduleItems([{ key: 'big', estimateDays: 8 }], { anchor: MONDAY, sprints: SPRINTS });
    expect(iso(r.windows.get('big')!.startDate)).toBe('2026-08-03');
    expect(iso(r.windows.get('big')!.endDate)).toBe('2026-08-12');
  });
});
