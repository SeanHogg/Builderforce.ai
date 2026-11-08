import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RecordedRefusal } from '../runtime/autoRunSkipReader';

vi.mock('../runtime/autoRunSkipReader', () => ({
  loadLatestRefusals: vi.fn(),
}));
vi.mock('../observability/caughtErrorReporter', () => ({ reportCaughtError: vi.fn() }));

const { loadLatestRefusals } = await import('../runtime/autoRunSkipReader');
const { loadRecordedRefusalReasons, usableRefusalReason } = await import('./censusRecordedRefusals');
const { AUTORUN_COOLDOWN_MAX_MS } = await import('../swimlane/evaluateAutoRun');

const NOW = Date.parse('2026-11-08T12:00:00Z');
const refusal = (reason: RecordedRefusal['reason'], ageMs: number): RecordedRefusal =>
  ({ reason, at: new Date(NOW - ageMs) });

describe('usableRefusalReason', () => {
  it('uses a refusal recorded after the last lane change', () => {
    expect(usableRefusalReason(refusal('capability_mismatch', 1_000), NOW - 60_000, NOW)).toBe('capability_mismatch');
  });

  it('ignores a refusal recorded BEFORE the last lane change', () => {
    expect(usableRefusalReason(refusal('capability_mismatch', 120_000), NOW - 60_000, NOW)).toBeNull();
  });

  it('ignores reasons the fast ladder already derives live', () => {
    expect(usableRefusalReason(refusal('no_agent', 1_000), NOW - 60_000, NOW)).toBeNull();
    expect(usableRefusalReason(refusal('human_gate', 1_000), NOW - 60_000, NOW)).toBeNull();
  });

  it('expires a cooldown row once the longest possible back-off has passed', () => {
    const lastMoved = NOW - 10 * AUTORUN_COOLDOWN_MAX_MS;
    expect(usableRefusalReason(refusal('cooldown_active', AUTORUN_COOLDOWN_MAX_MS - 1), lastMoved, NOW)).toBe('cooldown_active');
    expect(usableRefusalReason(refusal('cooldown_active', AUTORUN_COOLDOWN_MAX_MS + 1), lastMoved, NOW)).toBeNull();
  });

  it('maps a recorded trigger error through', () => {
    expect(usableRefusalReason(refusal('trigger_error', 1_000), NOW - 60_000, NOW)).toBe('trigger_error');
  });
});

describe('loadRecordedRefusalReasons', () => {
  beforeEach(() => vi.mocked(loadLatestRefusals).mockReset());

  it('reads the ledger ONCE for N tickets (no N+1)', async () => {
    vi.mocked(loadLatestRefusals).mockResolvedValue(new Map([
      [1, refusal('cloud_run_limit', 1_000)],
      [3, refusal('trigger_error', 1_000)],
    ]));
    const candidates = [1, 2, 3, 4, 5].map((taskId) => ({ taskId, lastMovedAtMs: NOW - 60_000 }));
    const out = await loadRecordedRefusalReasons({} as never, 7, candidates, NOW);
    expect(loadLatestRefusals).toHaveBeenCalledTimes(1);
    expect(vi.mocked(loadLatestRefusals).mock.calls[0]?.[2]).toEqual([1, 2, 3, 4, 5]);
    expect([...out.entries()]).toEqual([[1, 'cloud_run_limit'], [3, 'trigger_error']]);
  });

  it('does not query at all with no candidates', async () => {
    expect((await loadRecordedRefusalReasons({} as never, 7, [], NOW)).size).toBe(0);
    expect(loadLatestRefusals).not.toHaveBeenCalled();
  });

  it('degrades to the fast-ladder verdict when the read fails', async () => {
    vi.mocked(loadLatestRefusals).mockRejectedValue(new Error('db down'));
    const out = await loadRecordedRefusalReasons({} as never, 7, [{ taskId: 1, lastMovedAtMs: 0 }], NOW);
    expect(out.size).toBe(0);
  });
});
