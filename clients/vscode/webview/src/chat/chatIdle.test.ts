import { describe, expect, it } from 'vitest';

import { daysIdleOf } from './chatIdle';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-11-14T12:00:00.000Z');

describe('daysIdleOf', () => {
  it('counts full days since updatedAt', () => {
    expect(daysIdleOf({ updatedAt: '2026-11-14T11:00:00.000Z' }, NOW)).toBe(0); // touched today
    expect(daysIdleOf({ updatedAt: '2026-11-09T12:00:00.000Z' }, NOW)).toBe(5); // exactly 5 days
    expect(daysIdleOf({ updatedAt: '2026-11-09T11:59:59.000Z' }, NOW)).toBe(5); // a hair over 5 days
    expect(daysIdleOf({ updatedAt: '2026-11-10T12:00:01.000Z' }, NOW)).toBe(3); // a hair under 4 days
  });

  it('returns null for an absent or invalid updatedAt', () => {
    expect(daysIdleOf({}, NOW)).toBeNull();
    expect(daysIdleOf({ updatedAt: null }, NOW)).toBeNull();
    expect(daysIdleOf({ updatedAt: 'not-a-date' }, NOW)).toBeNull();
  });

  it('defaults now to the real clock', () => {
    const fiveDaysAgo = new Date(Date.now() - 5 * DAY_MS).toISOString();
    expect(daysIdleOf({ updatedAt: fiveDaysAgo })).toBe(5);
  });
});
