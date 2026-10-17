import { describe, expect, it, vi } from 'vitest';

const held = new Set<string>();
vi.mock('../../infrastructure/cache/firstInWindow', () => ({
  firstInWindow: async (_env: unknown, key: string) => {
    if (held.has(key)) return false;
    held.add(key);
    return true;
  },
}));

import { claimDailyMemberSnapshot, memberSnapshotPeriod } from './memberMetricsSnapshot';

describe('memberSnapshotPeriod', () => {
  it('files every view of one UTC day under the same period, so the upsert key matches', () => {
    const morning = memberSnapshotPeriod(7, new Date('2026-10-17T01:02:03.004Z'));
    const evening = memberSnapshotPeriod(7, new Date('2026-10-17T23:59:59.999Z'));
    expect(morning).toEqual(evening);
    expect(morning.periodEnd.toISOString()).toBe('2026-10-17T00:00:00.000Z');
    expect(morning.periodStart.toISOString()).toBe('2026-10-10T00:00:00.000Z');
  });

  it('rolls to a new period the next UTC day', () => {
    const today = memberSnapshotPeriod(30, new Date('2026-10-17T12:00:00Z'));
    const tomorrow = memberSnapshotPeriod(30, new Date('2026-10-18T00:00:01Z'));
    expect(tomorrow.periodEnd.getTime()).toBeGreaterThan(today.periodEnd.getTime());
  });
});

describe('claimDailyMemberSnapshot', () => {
  const day = new Date('2026-10-17T09:00:00Z');

  it('lets the first view of the day write and holds every later one', async () => {
    expect(await claimDailyMemberSnapshot(undefined, 'scorecard', 1, 7, day)).toBe(true);
    expect(await claimDailyMemberSnapshot(undefined, 'scorecard', 1, 7, new Date('2026-10-17T22:00:00Z'))).toBe(false);
  });

  it('keeps kinds, tenants, windows and days apart', async () => {
    expect(await claimDailyMemberSnapshot(undefined, 'engagement', 1, 7, day)).toBe(true);
    expect(await claimDailyMemberSnapshot(undefined, 'scorecard', 2, 7, day)).toBe(true);
    expect(await claimDailyMemberSnapshot(undefined, 'scorecard', 1, 30, day)).toBe(true);
    expect(await claimDailyMemberSnapshot(undefined, 'scorecard', 1, 7, new Date('2026-10-18T09:00:00Z'))).toBe(true);
  });
});
