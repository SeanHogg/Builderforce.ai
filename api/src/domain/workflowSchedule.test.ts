import { describe, it, expect } from 'vitest';
import { parseCronField, parseCron, isValidCron, nextCronTime } from './workflowSchedule';

describe('parseCronField', () => {
  it('expands wildcards over the full range', () => {
    expect(parseCronField('*', 0, 5)).toEqual([0, 1, 2, 3, 4, 5]);
  });
  it('expands step values', () => {
    expect(parseCronField('*/15', 0, 59)).toEqual([0, 15, 30, 45]);
    expect(parseCronField('0-10/2', 0, 59)).toEqual([0, 2, 4, 6, 8, 10]);
  });
  it('expands ranges and comma lists', () => {
    expect(parseCronField('1-3', 0, 59)).toEqual([1, 2, 3]);
    expect(parseCronField('1,5,9', 0, 59)).toEqual([1, 5, 9]);
    expect(parseCronField('5,1,1', 0, 59)).toEqual([1, 5]); // dedup + sort
  });
  it('rejects out-of-range and malformed values', () => {
    expect(() => parseCronField('60', 0, 59)).toThrow();
    expect(() => parseCronField('5-1', 0, 59)).toThrow();
    expect(() => parseCronField('*/0', 0, 59)).toThrow();
    expect(() => parseCronField('', 0, 59)).toThrow();
  });
});

describe('parseCron', () => {
  it('requires exactly 5 fields', () => {
    expect(() => parseCron('* * * *')).toThrow();
    expect(() => parseCron('* * * * * *')).toThrow();
  });
  it('normalizes day-of-week 7 to 0 (Sunday)', () => {
    expect(parseCron('0 0 * * 7').daysOfWeek).toEqual([0]);
  });
  it('tracks dom/dow restriction flags', () => {
    const c = parseCron('0 9 * * 1-5');
    expect(c.domRestricted).toBe(false);
    expect(c.dowRestricted).toBe(true);
  });
});

describe('isValidCron', () => {
  it('accepts valid and rejects invalid expressions', () => {
    expect(isValidCron('0 9 * * 1-5')).toBe(true);
    expect(isValidCron('*/5 * * * *')).toBe(true);
    expect(isValidCron('nope')).toBe(false);
    expect(isValidCron('99 * * * *')).toBe(false);
  });
});

describe('nextCronTime (UTC)', () => {
  it('finds the next daily 09:00 UTC run', () => {
    const after = new Date('2026-06-06T08:00:00Z');
    const next = nextCronTime('0 9 * * *', after, 'UTC');
    expect(next?.toISOString()).toBe('2026-06-06T09:00:00.000Z');
  });
  it('rolls to the next day when today is already past', () => {
    const after = new Date('2026-06-06T10:00:00Z');
    const next = nextCronTime('0 9 * * *', after, 'UTC');
    expect(next?.toISOString()).toBe('2026-06-07T09:00:00.000Z');
  });
  it('honors */15 minute steps', () => {
    const after = new Date('2026-06-06T08:07:00Z');
    const next = nextCronTime('*/15 * * * *', after, 'UTC');
    expect(next?.toISOString()).toBe('2026-06-06T08:15:00.000Z');
  });
  it('matches weekday constraints (next weekday at 09:00)', () => {
    // 2026-06-06 is a Saturday → next Mon-Fri 09:00 is Monday the 8th.
    const after = new Date('2026-06-06T12:00:00Z');
    const next = nextCronTime('0 9 * * 1-5', after, 'UTC');
    expect(next?.toISOString()).toBe('2026-06-08T09:00:00.000Z');
  });
  it('uses OR semantics when both dom and dow are restricted', () => {
    // Day-of-month 1 OR Monday. After Jun 6 2026 (Sat), next is Mon Jun 8.
    const after = new Date('2026-06-06T12:00:00Z');
    const next = nextCronTime('0 0 1 * 1', after, 'UTC');
    expect(next?.toISOString()).toBe('2026-06-08T00:00:00.000Z');
  });
});

describe('nextCronTime (timezone)', () => {
  it('computes 09:00 in a fixed-offset zone as the right UTC instant', () => {
    // 09:00 in America/New_York on 2026-06-06 = 13:00 UTC (EDT, UTC-4).
    const after = new Date('2026-06-06T00:00:00Z');
    const next = nextCronTime('0 9 * * *', after, 'America/New_York');
    expect(next?.toISOString()).toBe('2026-06-06T13:00:00.000Z');
  });
  it('computes 09:00 Tokyo as 00:00 UTC', () => {
    // Asia/Tokyo is UTC+9 (no DST) → 09:00 JST = 00:00 UTC same day.
    const after = new Date('2026-06-05T20:00:00Z');
    const next = nextCronTime('0 9 * * *', after, 'Asia/Tokyo');
    expect(next?.toISOString()).toBe('2026-06-06T00:00:00.000Z');
  });
});
