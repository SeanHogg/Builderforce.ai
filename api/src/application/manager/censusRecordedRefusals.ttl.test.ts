import { describe, it, expect, vi } from 'vitest';
import type { RecordedRefusal } from '../runtime/autoRunSkipReader';

vi.mock('../runtime/autoRunSkipReader', () => ({ loadLatestRefusals: vi.fn() }));
vi.mock('../observability/caughtErrorReporter', () => ({ reportCaughtError: vi.fn() }));

const { usableRefusalReason, MAX_REFUSAL_AGE_MS } = await import('./censusRecordedRefusals');

const NOW = Date.parse('2026-11-08T12:00:00Z');
const HOUR = 3_600_000;
const refusal = (reason: RecordedRefusal['reason'], ageMs: number): RecordedRefusal =>
  ({ reason, at: new Date(NOW - ageMs) });
// Lane last moved long ago, so only the TTL can expire a row.
const LONG_AGO = NOW - 30 * 24 * HOUR;

describe('workspace-level refusals expire on their own', () => {
  it.each(['cloud_run_limit', 'tenant_token_limit', 'execution_disabled'] as const)(
    '%s is usable inside an hour and falls back to the live verdict after it', (reason) => {
      expect(usableRefusalReason(refusal(reason, HOUR - 1), LONG_AGO, NOW)).toBe(reason);
      expect(usableRefusalReason(refusal(reason, HOUR + 1), LONG_AGO, NOW)).toBeNull();
    },
  );

  it('lane_requirement_gate is lane-scoped but still self-heals within the day', () => {
    expect(usableRefusalReason(refusal('lane_requirement_gate', 5 * HOUR), LONG_AGO, NOW)).toBe('lane_requirement_gate');
    expect(usableRefusalReason(refusal('lane_requirement_gate', 7 * HOUR), LONG_AGO, NOW)).toBeNull();
  });

  it('a lane move still supersedes a fresh workspace refusal', () => {
    expect(usableRefusalReason(refusal('cloud_run_limit', 60_000), NOW - 1_000, NOW)).toBeNull();
  });

  it('keeps lane-scoped reasons with no TTL until the next move', () => {
    expect(MAX_REFUSAL_AGE_MS.capability_mismatch).toBeUndefined();
    expect(usableRefusalReason(refusal('capability_mismatch', 10 * 24 * HOUR), LONG_AGO, NOW)).toBe('capability_mismatch');
  });
});
