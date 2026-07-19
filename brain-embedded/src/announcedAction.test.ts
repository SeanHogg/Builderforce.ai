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

  it('does NOT match a complete answer that merely mentions checking something', () => {
    const answers = [
      'Let me know if you want a different chart type.',
      'The build failed because the token expired. Check the gateway logs for the 401.',
      'You can call the tasks API yourself with the ingest key.',
      'I do not have the task status data for project 11.',
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
