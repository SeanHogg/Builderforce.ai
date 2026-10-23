import { describe, expect, it } from 'vitest';
import { dateArithmeticHandler, parseCalendarDate } from './dateArithmetic';

const now = new Date('2026-10-22T23:30:00Z');
const answer = (q: string) => dateArithmeticHandler.answer(q, now)?.content ?? null;

describe('parseCalendarDate', () => {
  it('reads ISO and month-name dates', () => {
    expect(parseCalendarDate('2026-12-25')).toBe(Date.UTC(2026, 11, 25));
    expect(parseCalendarDate('december 25, 2026')).toBe(Date.UTC(2026, 11, 25));
    expect(parseCalendarDate('25 dec 2026')).toBe(Date.UTC(2026, 11, 25));
    expect(parseCalendarDate('march 1st 2026')).toBe(Date.UTC(2026, 2, 1));
  });

  it('refuses impossible and ambiguous dates', () => {
    expect(parseCalendarDate('2026-02-30')).toBeNull();
    expect(parseCalendarDate('03/04/2026')).toBeNull();
    expect(parseCalendarDate('december 25')).toBeNull();
  });
});

describe('dateArithmeticHandler', () => {
  it('adds and subtracts days and weeks, naming UTC when relative to today', () => {
    expect(answer('What day is 30 days from today?')).toBe('30 days from today is Saturday, November 21, 2026 (today is Thursday, October 22, 2026, UTC).');
    expect(answer('what date was 2 weeks before 2026-03-01')).toBe('2 weeks before 2026-03-01 is Sunday, February 15, 2026.');
    expect(answer('what date was 1 day ago')).toBe('1 day ago is Wednesday, October 21, 2026 (today is Thursday, October 22, 2026, UTC).');
  });

  it('names the weekday of a date', () => {
    expect(answer('what day of the week is 2026-12-25')).toBe('December 25, 2026 is a Friday.');
  });

  it('counts days between dates and until a date', () => {
    expect(answer('how many days between 2026-01-01 and 2026-03-01')).toBe('There are 59 days between Thursday, January 1, 2026 and Sunday, March 1, 2026.');
    expect(answer('how many days until december 25, 2026')).toBe('Friday, December 25, 2026 is 64 days away (today is Thursday, October 22, 2026, UTC).');
  });

  it('does not answer questions it cannot be sure of', () => {
    for (const q of [
      'what day is 3 months from today',
      'what day is 30 days from my birthday',
      'what day of the week is 03/04/2026',
      'how many days until 2026-02-30',
      'how many days until 2020-01-01',
      'what time is it',
      'what day is it today in Tokyo',
      'schedule the release 30 days from today',
    ]) {
      expect(answer(q), q).toBeNull();
    }
  });
});
