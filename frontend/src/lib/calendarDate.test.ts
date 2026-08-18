import { describe, expect, it } from 'vitest';
import { formatCalendarDate } from './calendarDate';

/**
 * The contract is "the day in the string is the day on the screen", and the bug
 * it replaces was invisible on a UTC machine: `new Date('2026-08-15')` is UTC
 * midnight, so `toLocaleDateString` printed the 14th anywhere west of UTC. That
 * was two failures at once — every article card showed the wrong day to roughly
 * half the world, and the statically prerendered homepage (rendered in UTC) then
 * disagreed with the browser that hydrated it, so React threw #418 and threw the
 * whole tree away.
 *
 * These assertions compare against the day named in the ISO string rather than a
 * value derived with the same `Date` maths under test, so they cannot both drift
 * in the same direction.
 */
describe('formatCalendarDate', () => {
  it('prints the day named in the string, whatever zone the runtime is in', () => {
    expect(formatCalendarDate('2026-08-15', 'en-US')).toBe('August 15, 2026');
  });

  it('holds at both ends of the year, where an offset would roll month and year', () => {
    expect(formatCalendarDate('2026-01-01', 'en-US')).toBe('January 1, 2026');
    expect(formatCalendarDate('2026-12-31', 'en-US')).toBe('December 31, 2026');
  });

  it('never shifts the day for any date in a month', () => {
    for (let day = 1; day <= 28; day += 1) {
      const iso = `2026-03-${String(day).padStart(2, '0')}`;
      expect(formatCalendarDate(iso, 'en-US')).toBe(`March ${day}, 2026`);
    }
  });

  it('translates the month while keeping the same day', () => {
    expect(formatCalendarDate('2026-08-15', 'de')).toContain('15');
    expect(formatCalendarDate('2026-08-15', 'de')).toContain('2026');
    expect(formatCalendarDate('2026-08-15', 'fr')).toContain('15');
  });

  it('returns the input untouched when it is not a date, rather than "Invalid Date"', () => {
    expect(formatCalendarDate('', 'en-US')).toBe('');
    expect(formatCalendarDate('not a date', 'en-US')).toBe('not a date');
  });
});
