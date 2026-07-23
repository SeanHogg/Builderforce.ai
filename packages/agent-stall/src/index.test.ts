import { describe, it, expect } from 'vitest';
import {
  announcesUntakenAction,
  shouldRecoverStalledTurn,
  stallRecoveryNudge,
  MAX_ANNOUNCEMENT_RECOVERIES,
} from './index';

/**
 * Guards the heuristic behind every agent loop's stall recovery. A false positive
 * costs one extra model turn; a false negative strands the user holding a promise.
 */
describe('announcesUntakenAction', () => {
  it('matches the reply that prompted this — a promise instead of a call', () => {
    expect(announcesUntakenAction(
      'I need the task status breakdown for project 11 before charting. Calling the tool now.',
    )).toBe(true);
  });

  it('matches the common stall phrasings', () => {
    const stalls = [
      'Let me fetch that for you.',
      "I'll query the tasks API and report back.",
      'I am going to look up the project data.',
      'One moment.',
      'Retrieving that now.',
      'Stand by.',
    ];
    for (const s of stalls) expect(announcesUntakenAction(s), s).toBe(true);
  });

  /**
   * Regression: the verb list used to be call/use/invoke/run/query/fetch/retrieve/
   * look up/pull/check/get, so EVERY line below scored false and the run loop
   * accepted the announcement as a final answer — the reported "the agent says it
   * will search and then just stops".
   */
  it('matches the stall verbs the narrow list missed', () => {
    const stalls = [
      "I'll search the codebase for the handler.",
      'Let me search for where that is wired.',
      "I'll review the tasks with successful PR builds. Let me start by looking at the pull requests.",
      'Let me look at a few more file-change sets.',
      'Let me find the coder and tester agents in the roster.',
      'Let me verify these 8 are the doc-only ones.',
      'Let me do that now.',
      'Let me first understand the pattern by examining a couple of these PRs. Let me examine them.',
      "I'll take a look at the migrations.",
      "Let's dig into the execution history.",
      "I'll go ahead and list the open pull requests.",
      'Searching for the failing spec now.',
    ];
    for (const s of stalls) expect(announcesUntakenAction(s), s).toBe(true);
  });

  it('does NOT match a complete answer that merely mentions checking something', () => {
    const answers = [
      'Let me know if you want a different chart type.',
      'The build failed because the token expired. Check the gateway logs for the 401.',
      'You can call the tasks API yourself with the ingest key.',
      'I do not have the task status data for project 11.',
    ];
    for (const a of answers) expect(announcesUntakenAction(a), a).toBe(false);
  });

  /**
   * The broadened verb list leans on the SUBJECT to discriminate: a first-person
   * commitment is a stall, the same verb aimed at the user is a finished answer.
   * These pin that boundary.
   */
  it('does NOT match an action the USER is being told to take', () => {
    const answers = [
      'Search the audit log for the revoked token to confirm the window.',
      'You should review PR #302 before merging — it only changes PRD.md.',
      'To reproduce, run the migration and then look at the 0297 table.',
      'The next step is to find the orphaned tickets and reassign them.',
      'Let me know once the coder agent finishes and I can verify the diff.',
    ];
    for (const a of answers) expect(announcesUntakenAction(a), a).toBe(false);
  });

  it('ignores a mid-answer aside — only the tail signs off with a promise', () => {
    const body = 'Let me check the numbers. '.padEnd(400, 'x');
    const complete = `${body}\n\n| Status | Count |\n| --- | --- |\n| Open | 12 |`;
    expect(announcesUntakenAction(complete)).toBe(false);
  });

  it('has no opinion on empty text', () => {
    expect(announcesUntakenAction('')).toBe(false);
    expect(announcesUntakenAction('   ')).toBe(false);
  });
});

/**
 * The gate itself lives here rather than in each loop, so the Brain run loop and the
 * on-prem/cloud agent loop cannot drift on WHEN a stall is recoverable.
 */
describe('shouldRecoverStalledTurn', () => {
  const stall = {
    text: "I'll search the codebase for the handler.",
    toolCallCount: 0,
    availableToolCount: 12,
    recoveriesUsed: 0,
  };

  it('recovers an announcement made with tools available and budget left', () => {
    expect(shouldRecoverStalledTurn(stall)).toBe(true);
  });

  it('never fires when the turn actually called a tool', () => {
    expect(shouldRecoverStalledTurn({ ...stall, toolCallCount: 1 })).toBe(false);
  });

  it('never fires when the turn had no tools to call', () => {
    expect(shouldRecoverStalledTurn({ ...stall, availableToolCount: 0 })).toBe(false);
  });

  it('stops once the per-run budget is spent', () => {
    for (let used = 0; used < MAX_ANNOUNCEMENT_RECOVERIES; used++) {
      expect(shouldRecoverStalledTurn({ ...stall, recoveriesUsed: used }), `used=${used}`).toBe(true);
    }
    expect(shouldRecoverStalledTurn({ ...stall, recoveriesUsed: MAX_ANNOUNCEMENT_RECOVERIES })).toBe(false);
  });

  it('lets a genuine final answer through untouched', () => {
    expect(shouldRecoverStalledTurn({ ...stall, text: 'The build failed because the token expired.' })).toBe(false);
  });

  it('allows more than one recovery — the stall repeats', () => {
    expect(MAX_ANNOUNCEMENT_RECOVERIES).toBeGreaterThan(1);
  });
});

describe('stallRecoveryNudge', () => {
  it('always demands the call be made in this turn', () => {
    for (const last of [false, true]) {
      expect(stallRecoveryNudge(last)).toContain('made zero tool calls');
      expect(stallRecoveryNudge(last)).toContain('Do not announce another call.');
    }
  });

  it('escalates only on the final attempt', () => {
    expect(stallRecoveryNudge(false)).not.toContain('last chance');
    expect(stallRecoveryNudge(true)).toContain('last chance');
  });
});
