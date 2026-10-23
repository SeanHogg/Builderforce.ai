import { describe, expect, it } from 'vitest';
import {
  applyReleasedAtPlan,
  calendarDaySlip,
  foldDeprecatedReleaseDate,
  isReleasedOnTime,
  planReleasedAt,
  summarizeReleaseSchedule,
  type ReleaseDates,
} from './releaseSchedule';

const NOW = new Date('2026-10-23T15:30:00.000Z');
const SHIPPED = new Date('2026-10-01T09:00:00.000Z');
const LATER = new Date('2026-10-20T09:00:00.000Z');

describe('planReleasedAt + applyReleasedAtPlan — the status transition owns released_at', () => {
  it('stamps now on the move to released', () => {
    const plan = planReleasedAt({ status: 'released' }, NOW);
    expect(plan).toEqual({ kind: 'stamp', at: NOW });
    expect(applyReleasedAtPlan(plan, { status: 'in_progress', releasedAt: null })).toEqual(NOW);
    expect(applyReleasedAtPlan(plan, null)).toEqual(NOW); // created already released
  });

  it('keeps the original ship date when an already-released release is re-saved as released', () => {
    const plan = planReleasedAt({ status: 'released' }, NOW);
    expect(applyReleasedAtPlan(plan, { status: 'released', releasedAt: SHIPPED })).toEqual(SHIPPED);
  });

  it('honours an explicit (back-dated) ship date on the move to released', () => {
    const plan = planReleasedAt({ status: 'released', releasedAt: SHIPPED }, NOW);
    expect(plan).toEqual({ kind: 'set', at: SHIPPED });
    expect(applyReleasedAtPlan(plan, { status: 'released', releasedAt: LATER })).toEqual(SHIPPED);
  });

  it('keeps the ship date when a shipped release is cancelled (rolled back), and a never-shipped one stays empty', () => {
    const plan = planReleasedAt({ status: 'cancelled', releasedAt: LATER }, NOW);
    expect(plan).toEqual({ kind: 'keep' });
    expect(applyReleasedAtPlan(plan, { status: 'released', releasedAt: SHIPPED })).toEqual(SHIPPED);
    expect(applyReleasedAtPlan(plan, { status: 'planned', releasedAt: null })).toBeNull();
    expect(applyReleasedAtPlan(plan, null)).toBeNull();
  });

  it('clears released_at when a release is moved back into plan — even if a date is sent', () => {
    for (const status of ['planned', 'in_progress'] as const) {
      const plan = planReleasedAt({ status, releasedAt: SHIPPED }, NOW);
      expect(plan).toEqual({ kind: 'clear' });
      expect(applyReleasedAtPlan(plan, { status: 'released', releasedAt: SHIPPED })).toBeNull();
    }
  });

  it('a create that is not released never carries an actual date', () => {
    expect(applyReleasedAtPlan(planReleasedAt({ status: 'planned', releasedAt: SHIPPED }, NOW), null)).toBeNull();
  });

  it('without a status, a date only corrects a release that is already released', () => {
    const plan = planReleasedAt({ releasedAt: SHIPPED }, NOW);
    expect(plan).toEqual({ kind: 'correct', at: SHIPPED });
    expect(applyReleasedAtPlan(plan, { status: 'released', releasedAt: LATER })).toEqual(SHIPPED);
    expect(applyReleasedAtPlan(plan, { status: 'planned', releasedAt: null })).toBeNull();
    expect(applyReleasedAtPlan(plan, null)).toBeNull();
  });

  it('leaves released_at alone when neither status nor a date is written', () => {
    const plan = planReleasedAt({}, NOW);
    expect(plan).toEqual({ kind: 'keep' });
    expect(applyReleasedAtPlan(plan, { status: 'released', releasedAt: SHIPPED })).toEqual(SHIPPED);
    expect(planReleasedAt({ releasedAt: null }, NOW)).toEqual({ kind: 'keep' });
  });
});

describe('foldDeprecatedReleaseDate — the one-release input alias', () => {
  it('maps releaseDate onto targetDate for a planned release', () => {
    expect(foldDeprecatedReleaseDate({ name: 'v2', releaseDate: '2026-11-01' })).toEqual({ name: 'v2', targetDate: '2026-11-01' });
    expect(foldDeprecatedReleaseDate({ status: 'planned', releaseDate: '2026-11-01' })).toEqual({ status: 'planned', targetDate: '2026-11-01' });
  });

  it('maps releaseDate onto releasedAt on a write that marks the release released', () => {
    expect(foldDeprecatedReleaseDate({ status: 'released', releaseDate: '2026-10-01' })).toEqual({ status: 'released', releasedAt: '2026-10-01' });
  });

  it('never overrides an explicit targetDate / releasedAt', () => {
    expect(foldDeprecatedReleaseDate({ targetDate: '2026-12-01', releaseDate: '2026-11-01' })).toEqual({ targetDate: '2026-12-01' });
    expect(foldDeprecatedReleaseDate({ status: 'released', releasedAt: '2026-10-02', releaseDate: '2026-10-01' }))
      .toEqual({ status: 'released', releasedAt: '2026-10-02' });
  });

  it('keeps an explicit null (a clear) and passes a body without the alias through untouched', () => {
    expect(foldDeprecatedReleaseDate({ releaseDate: null })).toEqual({ targetDate: null });
    const body = { name: 'v3', targetDate: '2026-11-01' };
    expect(foldDeprecatedReleaseDate(body)).toBe(body);
  });
});

describe('plan vs actual rollup', () => {
  it('grades by calendar day: shipping late on the target day is on time', () => {
    expect(calendarDaySlip('2026-11-01T23:00:00.000Z', '2026-11-01T00:00:00.000Z')).toBe(0);
    expect(calendarDaySlip('2026-11-03T01:00:00.000Z', '2026-11-01T00:00:00.000Z')).toBe(2);
    expect(calendarDaySlip('2026-10-30T00:00:00.000Z', '2026-11-01')).toBe(-2);
    expect(calendarDaySlip(null, '2026-11-01')).toBeNull();
    expect(calendarDaySlip('2026-11-01', null)).toBeNull();
  });

  it('isReleasedOnTime = releasedAt ≤ targetDate, ungradable when not released or unplanned', () => {
    expect(isReleasedOnTime({ status: 'released', targetDate: '2026-11-01', releasedAt: '2026-11-01T18:00:00Z' })).toBe(true);
    expect(isReleasedOnTime({ status: 'released', targetDate: '2026-11-01', releasedAt: '2026-11-02T00:00:00Z' })).toBe(false);
    expect(isReleasedOnTime({ status: 'released', targetDate: null, releasedAt: '2026-11-02' })).toBeNull();
    expect(isReleasedOnTime({ status: 'planned', targetDate: '2026-11-01', releasedAt: null })).toBeNull();
  });

  it('summarizes on-time rate, mean lateness, overdue and upcoming', () => {
    const rows: ReleaseDates[] = [
      { status: 'released', targetDate: '2026-09-10', releasedAt: '2026-09-09T10:00:00Z' }, // on time (early)
      { status: 'released', targetDate: '2026-09-20', releasedAt: '2026-09-20T22:00:00Z' }, // on time (on the day)
      { status: 'released', targetDate: '2026-10-01', releasedAt: '2026-10-05T10:00:00Z' }, // 4 days late
      { status: 'released', targetDate: '2026-10-10', releasedAt: '2026-10-12T10:00:00Z' }, // 2 days late
      { status: 'released', targetDate: null, releasedAt: '2026-10-15T10:00:00Z' },         // released, not measurable
      { status: 'in_progress', targetDate: '2026-10-20', releasedAt: null },                // overdue
      { status: 'planned', targetDate: '2026-10-23', releasedAt: null },                    // due today → upcoming
      { status: 'planned', targetDate: '2026-12-01', releasedAt: null },                    // upcoming
      { status: 'cancelled', targetDate: '2026-10-01', releasedAt: null },                  // ignored
      { status: 'planned', targetDate: null, releasedAt: null },                            // unplanned, ignored
    ];
    expect(summarizeReleaseSchedule(rows, NOW)).toEqual({
      released: 5,
      measured: 4,
      onTime: 2,
      late: 2,
      onTimeRatePct: 50,
      avgDaysLate: 3,
      overdue: 1,
      upcoming: 2,
    });
  });

  it('reports null rates when nothing is measurable', () => {
    expect(summarizeReleaseSchedule([], NOW)).toEqual({
      released: 0, measured: 0, onTime: 0, late: 0, onTimeRatePct: null, avgDaysLate: null, overdue: 0, upcoming: 0,
    });
  });
});
