/**
 * writeAheadIntents — the §4b re-dispatch decision, pure. A stranded host run may
 * re-dispatch ONLY if its host advertised support AND the server holds no intent for a
 * non-allowlisted tool AND the sequence numbers it has seen have no gap. Anything else
 * fails and asks a human, with the reason recorded.
 */
import { describe, expect, it } from 'vitest';
import { assessWriteAheadRunState, type WriteAheadRunState } from './writeAheadIntents';

const clean: WriteAheadRunState = {
  maxSeq: 3,
  count: 3, // 1,2,3 all present — no gap
  nonAllowlistedIntents: [], // only allowlisted (read) intents
};

describe('assessWriteAheadRunState — the §4b re-dispatch rule', () => {
  it('SAFE: advertised + no non-allowlisted intent + gap-free sequence', () => {
    expect(assessWriteAheadRunState(true, clean)).toEqual({ safeToRedispatch: true });
  });

  it('SAFE: zero intents at all (host advertised, died before any tool ran)', () => {
    expect(assessWriteAheadRunState(true, { maxSeq: 0, count: 0, nonAllowlistedIntents: [] }))
      .toEqual({ safeToRedispatch: true });
  });

  it('UNSAFE: host never advertised support (old host) — "no intent" proves nothing', () => {
    const d = assessWriteAheadRunState(false, clean);
    expect(d.safeToRedispatch).toBe(false);
    if (!d.safeToRedispatch) expect(d.reason).toContain('did not advertise');
  });

  it('UNSAFE: a non-allowlisted intent is held (a mutating tool was in flight, never acked)', () => {
    const d = assessWriteAheadRunState(true, {
      maxSeq: 2, count: 2,
      nonAllowlistedIntents: [{ seq: 2, toolName: 'git_push' }],
    });
    expect(d.safeToRedispatch).toBe(false);
    if (!d.safeToRedispatch) {
      expect(d.reason).toContain('git_push');
      expect(d.reason).toContain('side effect');
    }
  });

  it('UNSAFE: sequence gap — a tool call may have been lost off the end of the log', () => {
    const d = assessWriteAheadRunState(true, {
      maxSeq: 3, count: 2, // saw 2 of 3 → a seq between 1 and 3 is missing
      nonAllowlistedIntents: [],
    });
    expect(d.safeToRedispatch).toBe(false);
    if (!d.safeToRedispatch) expect(d.reason).toContain('gap');
  });

  it('UNSAFE: the intent read itself failed (null) — fail closed, never guess safe', () => {
    const d = assessWriteAheadRunState(true, null);
    expect(d.safeToRedispatch).toBe(false);
    if (!d.safeToRedispatch) expect(d.reason.length).toBeGreaterThan(0);
  });
});
