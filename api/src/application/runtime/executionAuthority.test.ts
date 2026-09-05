import { describe, it, expect } from 'vitest';
import {
  humanDirected,
  systemInitiated,
  stampExecutionAuthority,
  parseExecutionAuthority,
  markLifecycleNeutral,
  isLifecycleNeutralRun,
  describeAuthority,
} from './executionAuthority';

/**
 * The contract behind "a run that is not stage work may still happen, and still cannot
 * advance the stage". See the module header for the two classes it admits and why
 * refusing them was a dead end rather than a control.
 */
describe('stamping an authority onto a dispatch payload', () => {
  it('preserves everything the caller already put on the payload', () => {
    const original = JSON.stringify({ cloudAgentRef: 'agent-1', laneKey: 'todo', chatId: 99 });

    const stamped = stampExecutionAuthority(original, humanDirected('u-1', 'Run now.'));

    expect(JSON.parse(stamped)).toMatchObject({ cloudAgentRef: 'agent-1', laneKey: 'todo', chatId: 99 });
    expect(parseExecutionAuthority(stamped)).toEqual({ kind: 'human', by: 'u-1', reason: 'Run now.' });
  });

  it('stamps a system authority for platform machinery', () => {
    const stamped = stampExecutionAuthority(undefined, systemInitiated('ci-autofix', 'Attempt 2.'));
    expect(parseExecutionAuthority(stamped)).toEqual({ kind: 'system', by: 'ci-autofix', reason: 'Attempt 2.' });
  });

  /**
   * An override with no name is the thing this design is trying not to be. An absent
   * user id degrades to a named placeholder rather than an empty string that would read,
   * in an audit row, as though nobody authorized it.
   */
  it('never produces an anonymous authority', () => {
    expect(humanDirected(null, 'x').by).toBe('unknown-user');
    expect(humanDirected('   ', 'x').by).toBe('unknown-user');
    expect(systemInitiated('', 'x').by).toBe('system');
  });

  it('drops the authority rather than DISCARDING a payload it cannot parse', () => {
    // Rebuilding from scratch would throw away the caller's instructions. Losing the
    // override just means the guard refuses exactly as it did before — recoverable.
    const opaque = 'not json at all';
    expect(stampExecutionAuthority(opaque, humanDirected('u-1', 'x'))).toBe(opaque);
  });

  it('reads nothing from a payload that carries no authority', () => {
    expect(parseExecutionAuthority(JSON.stringify({ actAsRole: 'developer' }))).toBeNull();
    expect(parseExecutionAuthority('{')).toBeNull();
    expect(parseExecutionAuthority(null)).toBeNull();
    // A malformed authority is not a half-valid one: an unknown kind, or a blank `by`,
    // is no authority at all, so the guard refuses instead of admitting a nameless run.
    expect(parseExecutionAuthority(JSON.stringify({ runAuthority: { kind: 'root', by: 'x' } }))).toBeNull();
    expect(parseExecutionAuthority(JSON.stringify({ runAuthority: { kind: 'human', by: '' } }))).toBeNull();
  });
});

describe('lifecycle neutrality — what the override costs', () => {
  it('marks a run unable to advance the ticket, keeping the rest of the payload', () => {
    const marked = markLifecycleNeutral(JSON.stringify({ laneKey: 'todo', runAuthority: { kind: 'human', by: 'u-1', reason: 'r' } }));

    expect(isLifecycleNeutralRun(marked)).toBe(true);
    expect(JSON.parse(marked)).toMatchObject({ laneKey: 'todo' });
    expect(parseExecutionAuthority(marked)).toMatchObject({ by: 'u-1' });
  });

  it('leaves an ordinary run untouched — nothing that worked before changes', () => {
    // Only the dispatcher marks a run, and only when a MANAGED board admitted it
    // without a role. A run on an unmanaged board is never marked, so this predicate is
    // false for every payload the platform built before this contract existed.
    expect(isLifecycleNeutralRun(JSON.stringify({ cloudAgentRef: 'a', laneKey: 'todo' }))).toBe(false);
    expect(isLifecycleNeutralRun(undefined)).toBe(false);
    expect(isLifecycleNeutralRun('nonsense')).toBe(false);
  });
});

describe('describeAuthority', () => {
  it('names who and why, for the audit row', () => {
    expect(describeAuthority(humanDirected('u-7', 'Run now on an unbound stage.')))
      .toBe('user u-7: Run now on an unbound stage.');
    expect(describeAuthority(systemInitiated('security-audit', 'SOC 2 audit 4.')))
      .toBe("system service 'security-audit': SOC 2 audit 4.");
  });
});
