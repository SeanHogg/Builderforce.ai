import { describe, it, expect } from 'vitest';
import { announcesUntakenAction } from './brainRunStore';

/**
 * Guards the heuristic behind the run loop's one-shot recovery. A false positive
 * costs one extra model turn; a false negative just restores the old behaviour —
 * so these tests pin the bias toward matching LITTLE.
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
