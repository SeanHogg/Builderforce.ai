import { describe, it, expect } from 'vitest';
import {
  asksForChange,
  promisesUnfinishedWork,
  isContinuationDirective,
  continuationDirective,
} from './requestIntent';

describe('asksForChange', () => {
  it('reads a work order as a change request', () => {
    for (const t of [
      'In mobile mode on the front end, reduce the height of the scrolling box so the prompt is shown.',
      'Fix the gate in deliveryVerdict.ts',
      'Add a column for the owner',
      'Bump the version and package the VSIX',
    ]) expect(asksForChange(t)).toBe(true);
  });

  it('does not read a question as a change request, even when it names a change verb', () => {
    for (const t of [
      'Why did you change the height?',
      'Where is the scrolling box defined?',
      'How do I add a column?',
      'What does this module do?',
      'Explain how the cache decides to replay an answer',
      'Can you show me where the board is rendered?',
      'Summarize the last run',
    ]) expect(asksForChange(t)).toBe(false);
  });

  it('is empty-safe', () => {
    expect(asksForChange('')).toBe(false);
    expect(asksForChange(null)).toBe(false);
    expect(asksForChange(undefined)).toBe(false);
  });

  it('judges on the OPENING, so a long question quoting a verb stays a question', () => {
    const q = `What does this do? ${'context '.repeat(200)} it will update the row.`;
    expect(asksForChange(q)).toBe(false);
  });
});

describe('promisesUnfinishedWork', () => {
  it('catches the answer that caused this module to exist', () => {
    // Verbatim shape from the run: analysis, an explicit "nothing changed", and a
    // promise to do it next time — cached, then replayed forever.
    const answer = 'I found the exact issue but hit the tool-call budget before applying the edit — '
      + 'so nothing has been changed on disk yet. Re-run me and I\'ll apply the edit.';
    expect(promisesUnfinishedWork(answer)).toBe(true);
  });

  it('catches each signal on its own', () => {
    expect(promisesUnfinishedWork('Nothing was modified.')).toBe(true);
    expect(promisesUnfinishedWork('Say the word and I will apply it.')).toBe(true);
    expect(promisesUnfinishedWork('I ran out of steps.')).toBe(true);
    expect(promisesUnfinishedWork('I hit the iteration cap.')).toBe(true);
  });

  it('leaves a REPORT of completed work alone — that is exactly what should cache', () => {
    for (const t of [
      'I reduced the board cap to min(56vh, 480px) in LandingCanvasHero.module.css and the tests pass.',
      'The homepage hero lives in LandingCanvasHero.tsx; the board caps itself at 74vh below 900px.',
      'Done — the column is added and the migration ran.',
    ]) expect(promisesUnfinishedWork(t)).toBe(false);
  });
});

describe('isContinuationDirective', () => {
  it('recognizes a bare directive', () => {
    for (const t of ['Fix', 'fix it', 'do it', 'Go ahead', 'yes', 'apply it', 'proceed', 'continue', 'ok do it', 'ship it', 'Please go ahead.']) {
      expect(isContinuationDirective(t)).toBe(true);
    }
  });

  it('does NOT swallow a directive that says what to do', () => {
    for (const t of [
      'fix the login redirect',
      'apply it to the mobile breakpoint only',
      'yes, but use 56vh instead',
      'continue with the other three files',
    ]) expect(isContinuationDirective(t)).toBe(false);
  });

  it('is empty-safe and length-bounded', () => {
    expect(isContinuationDirective('')).toBe(false);
    expect(isContinuationDirective(null)).toBe(false);
    expect(isContinuationDirective('do it '.repeat(20))).toBe(false);
  });
});

describe('continuationDirective', () => {
  it('tells the agent to carry out the previous proposal and NOT to ask', () => {
    const d = continuationDirective();
    expect(d).toMatch(/preceding message/i);
    expect(d).toMatch(/do NOT ask the user what to fix/i);
    expect(d).toMatch(/apply that edit/i);
  });
});

describe('the failure these three close, end to end', () => {
  it('a change request is never cacheable, and its budget-exhausted answer is never cached', () => {
    const question = 'reduce the height of the current scrolling box so the prompt is shown on mobile';
    const answer = 'I found the issue but hit the tool-call budget before applying the edit — nothing has been changed on disk yet.';
    // Either gate alone would have stopped the replay; both hold.
    expect(asksForChange(question)).toBe(true);
    expect(promisesUnfinishedWork(answer)).toBe(true);
  });

  it('and the "Fix" that follows resolves against that answer rather than asking', () => {
    const answer = 'Re-run me and I\'ll apply the edit.';
    expect(isContinuationDirective('Fix')).toBe(true);
    expect(promisesUnfinishedWork(answer)).toBe(true);
  });
});

describe('the verbatim turns from chat #98', () => {
  // Copied from the real capture rather than paraphrased: these predicates only earn
  // their keep if they fire on the exact prose that produced the failure.
  const REQUEST =
    'In mobile mode on the front end of the website (/builderforce.ai) reduce the height of the current scrolling box so that the prompt is shown to users on mobile.';
  const ANSWER_HEAD =
    'I found the exact issue but hit the tool-call budget before applying the edit — so nothing has been changed on disk yet. Here\'s what I found and the precise fix to apply:';
  const ANSWER_TAIL =
    'Re-run me (or open a follow-up) and I\'ll apply the edit, run the frontend\'s `LandingCanvasHero.test.tsx` / typecheck to verify, and record the ticket per the chat workflow.';

  it('treats the request as a work order, so it can never be served from cache', () => {
    expect(asksForChange(REQUEST)).toBe(true);
  });

  it('recognizes the reply as an unfulfillable promise, so it is never cached', () => {
    expect(promisesUnfinishedWork(ANSWER_HEAD)).toBe(true);
    // The closing line on its own is enough: "re-run me" is an instruction the user
    // cannot act on in a way that would change the outcome.
    expect(promisesUnfinishedWork(ANSWER_TAIL)).toBe(true);
    expect(promisesUnfinishedWork(`${ANSWER_HEAD}\n\n…analysis…\n\n${ANSWER_TAIL}`)).toBe(true);
  });

  it('resolves the user\'s "Fix" against that reply instead of asking what to fix', () => {
    expect(isContinuationDirective('Fix')).toBe(true);
    expect(promisesUnfinishedWork(ANSWER_TAIL)).toBe(true);
  });
});
