import { describe, it, expect } from 'vitest';
import { isDue } from './runBoardSyncSweep';

describe('runBoardSyncSweep — isDue', () => {
  const now = new Date('2026-06-14T12:00:00Z');

  it('is due when the connection has never been polled', () => {
    expect(isDue({ lastPolledAt: null, pollIntervalSec: 60 }, now)).toBe(true);
  });

  it('is due once the poll interval has fully elapsed', () => {
    const lastPolledAt = new Date(now.getTime() - 61_000); // 61s ago, interval 60s
    expect(isDue({ lastPolledAt, pollIntervalSec: 60 }, now)).toBe(true);
  });

  it('is NOT due before the interval elapses', () => {
    const lastPolledAt = new Date(now.getTime() - 30_000); // 30s ago, interval 60s
    expect(isDue({ lastPolledAt, pollIntervalSec: 60 }, now)).toBe(false);
  });

  it('is due exactly at the interval boundary', () => {
    const lastPolledAt = new Date(now.getTime() - 60_000); // exactly 60s ago
    expect(isDue({ lastPolledAt, pollIntervalSec: 60 }, now)).toBe(true);
  });
});
