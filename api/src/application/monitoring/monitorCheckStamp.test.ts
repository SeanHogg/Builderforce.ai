import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MONITOR_CHECK_STAMP_REFRESH_MS, monitorCheckNeedsWrite } from './monitorCheckStamp';

const NOW = Date.parse('2026-10-17T12:00:00Z');
const recent = new Date(NOW - 5 * 60_000);

describe('monitorCheckNeedsWrite', () => {
  it('skips the write for a healthy monitor stamped recently', () => {
    expect(monitorCheckNeedsWrite({ consecutiveFailures: 0, lastCheckedAt: recent }, 0, NOW)).toBe(false);
  });

  it('always writes when the failure streak changes (every breaching tick, and recovery)', () => {
    expect(monitorCheckNeedsWrite({ consecutiveFailures: 0, lastCheckedAt: recent }, 1, NOW)).toBe(true);
    expect(monitorCheckNeedsWrite({ consecutiveFailures: 3, lastCheckedAt: recent }, 4, NOW)).toBe(true);
    expect(monitorCheckNeedsWrite({ consecutiveFailures: 3, lastCheckedAt: recent }, 0, NOW)).toBe(true);
  });

  it('writes when never stamped, or when the stamp is going stale', () => {
    expect(monitorCheckNeedsWrite({ consecutiveFailures: 0, lastCheckedAt: null }, 0, NOW)).toBe(true);
    expect(monitorCheckNeedsWrite(
      { consecutiveFailures: 0, lastCheckedAt: new Date(NOW - MONITOR_CHECK_STAMP_REFRESH_MS).toISOString() }, 0, NOW,
    )).toBe(true);
  });

  it('is what applyResult gates its stamp and its still-unknown event on', () => {
    const service = readFileSync(fileURLToPath(new URL('./MonitoringService.ts', import.meta.url).href), 'utf8');
    expect(service).toMatch(/const stamp = monitorCheckNeedsWrite\(monitor, consecutiveFailures, now\.getTime\(\)\);/);
    expect(service).toMatch(/result === 'unknown' && monitor\.status === 'unknown' && stamp/);
  });
});
