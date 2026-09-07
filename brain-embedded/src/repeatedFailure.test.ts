import { describe, it, expect } from 'vitest';
import {
  FailureTally,
  failureReason,
  repeatedFailureAdvisory,
  FAILURE_NUDGE_AT,
  FAILURE_HARD_AT,
} from './repeatedFailure';

/** The remedy the real run got three times, and re-issued the same bare call after. */
const NOT_A_REPO =
  'not a git repository at the workspace root — this usually means the open folder CONTAINS the repositories rather than being one. Re-run with `repo` set.';

describe('FailureTally', () => {
  it('counts identical failing calls', () => {
    const tally = new FailureTally();
    expect(tally.record('git_status', {})).toBe(1);
    expect(tally.record('git_status', {})).toBe(2);
    expect(tally.record('git_status', {})).toBe(3);
  });

  it('fingerprints arguments regardless of key order', () => {
    const tally = new FailureTally();
    tally.record('read_file', { path: 'a.ts', offset: 40 });
    expect(tally.record('read_file', { offset: 40, path: 'a.ts' })).toBe(2);
  });

  it('treats a CHANGED argument as a different call — the fix must never be nagged', () => {
    // This is the whole point: the remedy tells the model to pass `repo`, so the call
    // that follows the advice has to start from a clean count.
    const tally = new FailureTally();
    tally.record('git_status', {});
    tally.record('git_status', {});
    expect(tally.record('git_status', { repo: 'Builderforce.ai' })).toBe(1);
  });

  it('keeps different tools apart', () => {
    const tally = new FailureTally();
    tally.record('git_status', {});
    expect(tally.record('git_diff', {})).toBe(1);
  });

  it('forgets a call that eventually SUCCEEDED — those failures were flakes', () => {
    const tally = new FailureTally();
    tally.record('builtin_tasks_list', { projectId: 11 });
    tally.record('builtin_tasks_list', { projectId: 11 });
    tally.clear('builtin_tasks_list', { projectId: 11 });
    expect(tally.record('builtin_tasks_list', { projectId: 11 })).toBe(1);
  });

  it('reports the repeated calls for the run\'s own triage, worst first', () => {
    const tally = new FailureTally();
    tally.record('git_status', {});
    tally.record('git_status', {});
    tally.record('git_status', {});
    tally.record('builtin_errors_summary', {});
    tally.record('builtin_errors_summary', {});
    tally.record('read_file', { path: 'once.ts' });
    const repeated = tally.repeated();
    expect(repeated.map((r) => r.attempts)).toEqual([3, 2]);
    expect(repeated[0].call).toContain('git_status');
    // A single failure is a fact, not a pattern.
    expect(repeated.some((r) => r.call.includes('read_file'))).toBe(false);
  });
});

describe('failureReason', () => {
  it('quotes the error the tool named', () => {
    expect(failureReason({ ok: false, error: NOT_A_REPO })).toContain('not a git repository');
  });

  it('has nothing to quote for a failure that named no error', () => {
    expect(failureReason({ ok: false })).toBeUndefined();
    expect(failureReason('plain text')).toBeUndefined();
    expect(failureReason(null)).toBeUndefined();
  });

  it('bounds the quote so an advisory is not buried in a stack trace', () => {
    expect(failureReason({ error: 'x'.repeat(5_000) })!.length).toBe(400);
  });
});

describe('repeatedFailureAdvisory', () => {
  it('leaves the first attempt alone — a retry after one failure is right', () => {
    expect(repeatedFailureAdvisory('git_status', 1, NOT_A_REPO)).toBeNull();
  });

  it('names the count and quotes the answer already given, at the nudge', () => {
    const note = repeatedFailureAdvisory('git_status', FAILURE_NUDGE_AT, NOT_A_REPO)!;
    expect(note).toContain('git_status');
    expect(note).toContain('2 times');
    expect(note).toContain('not a git repository');
    // It must offer the way OUT, not just report the repetition.
    expect(note).toMatch(/change what it names/i);
    expect(note).toMatch(/different tool/i);
    expect(note).toMatch(/what is blocking you/i);
  });

  it('escalates to an instruction once the nudge has demonstrably failed', () => {
    const note = repeatedFailureAdvisory('git_status', FAILURE_HARD_AT, NOT_A_REPO)!;
    expect(note).toContain('STOP CALLING');
    expect(note).toMatch(/arguments are the problem, not the timing/i);
    expect(note).toMatch(/Do not issue this call again/i);
  });

  it('still works when the failure named no error', () => {
    const note = repeatedFailureAdvisory('run_command', FAILURE_NUDGE_AT)!;
    expect(note).toContain('run_command');
    expect(note).not.toContain('undefined');
  });
});
