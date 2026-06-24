import { describe, it, expect } from 'vitest';
import { computeNextRun, parseRecipients } from './runDueReports';

describe('parseRecipients', () => {
  it('parses a JSON array of emails', () => {
    expect(parseRecipients('["a@x.com","b@y.com"]')).toEqual(['a@x.com', 'b@y.com']);
  });
  it('drops non-email / non-string entries', () => {
    expect(parseRecipients('["a@x.com","nope",42,null]')).toEqual(['a@x.com']);
  });
  it('returns [] for null, empty, or malformed input', () => {
    expect(parseRecipients(null)).toEqual([]);
    expect(parseRecipients('')).toEqual([]);
    expect(parseRecipients('{not json')).toEqual([]);
    expect(parseRecipients('"a@x.com"')).toEqual([]); // not an array
  });
});

describe('computeNextRun', () => {
  const now = new Date('2026-06-23T12:00:00Z'); // hour 12 UTC

  it('daily: schedules the same hour tomorrow when today\'s hour has passed', () => {
    const next = computeNextRun('daily', 8, now); // 08:00 already past at 12:00
    expect(next.toISOString()).toBe('2026-06-24T08:00:00.000Z');
  });

  it('daily: schedules later today when the hour is still ahead', () => {
    const next = computeNextRun('daily', 18, now);
    expect(next.toISOString()).toBe('2026-06-23T18:00:00.000Z');
  });

  it('weekly: steps 7 days when the hour has passed', () => {
    const next = computeNextRun('weekly', 8, now);
    expect(next.toISOString()).toBe('2026-06-30T08:00:00.000Z');
  });

  it('monthly: rolls to next month when the hour has passed', () => {
    const next = computeNextRun('monthly', 8, now);
    expect(next.toISOString()).toBe('2026-07-23T08:00:00.000Z');
  });

  it('clamps an out-of-range delivery hour and defaults a non-finite one', () => {
    expect(computeNextRun('daily', 99, now).getUTCHours()).toBe(23);
    expect(computeNextRun('daily', NaN, now).getUTCHours()).toBe(8);
  });
});
