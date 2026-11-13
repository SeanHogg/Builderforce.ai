import { describe, expect, it, beforeEach } from 'vitest';
import {
  MAX_NO_PROGRESS_CONTINUATIONS,
  continuationStreakOf,
  mayAutoContinue,
  noteContinuationProgress,
  notePersonTurn,
  resetContinuationProgress,
} from './autoContinueGuard';
import { continueChat, continueOnSettle, type ContinueBinding } from './continueChat';
import { claimRun } from './runClaim';
import { getCell } from './runCells';
import { resetBrainRunStore, isLive } from './runControl';
import { startRun } from './startRun';
import { binding, chat, until } from '../test/continueHarness';

describe('auto-continue stops after 3 no-progress runs (chat #80006)', () => {
  beforeEach(() => resetContinuationProgress());

  it('regression: auto-continue stops after 3 no-progress runs', () => {
    const key = 42;
    expect(mayAutoContinue(key)).toBe(true);
    for (let i = 1; i <= MAX_NO_PROGRESS_CONTINUATIONS; i += 1) {
      noteContinuationProgress(key, false);
      expect(continuationStreakOf(key)).toBe(i);
      // The chain may continue until the cap is reached; at the cap it must stop.
      expect(mayAutoContinue(key)).toBe(i < MAX_NO_PROGRESS_CONTINUATIONS);
    }
    expect(mayAutoContinue(key)).toBe(false);
    // A run that finally makes progress resets the chain.
    noteContinuationProgress(key, true);
    expect(continuationStreakOf(key)).toBe(0);
    expect(mayAutoContinue(key)).toBe(true);
  });

  it('a run that changes a file or passes a check keeps the chain going past 3', () => {
    const key = 7;
    for (let i = 0; i < 5; i += 1) {
      noteContinuationProgress(key, true);
      expect(mayAutoContinue(key)).toBe(true);
    }
    expect(continuationStreakOf(key)).toBe(0);
  });

  it("a person's turn starts the chain over", () => {
    const key = 9;
    for (let i = 0; i < MAX_NO_PROGRESS_CONTINUATIONS; i += 1) noteContinuationProgress(key, false);
    expect(mayAutoContinue(key)).toBe(false);
    notePersonTurn(key);
    expect(mayAutoContinue(key)).toBe(true);
    expect(continuationStreakOf(key)).toBe(0);
  });

  it('chats are tracked independently', () => {
    noteContinuationProgress(1, false);
    noteContinuationProgress(1, false);
    expect(continuationStreakOf(1)).toBe(2);
    expect(continuationStreakOf(2)).toBe(0);
    expect(mayAutoContinue(2)).toBe(true);
  });
});

describe('the auto-continuation stops after 3 no-progress runs (end-to-end)', () => {
  beforeEach(() => {
    localStorage.clear();
    resetBrainRunStore();
  });

  it('chat #80006: the chain stops after 3 continuations that change nothing', async () => {
    const key = 9801;
    const c = chat(['Done.']);
    continueOnSettle(key, binding);
    await startRun(key, {
      resolvedSystemPrompt: 'sys',
      stream: c.stream,
      persistence: c.persistence,
      userTurn: 'fix the bug',
    });

    // The run opts in, settles unfinished (no code change, no check), and continues on its own.
    expect(continuationStreakOf(key)).toBe(0);
    for (let i = 0; i < MAX_NO_PROGRESS_CONTINUATIONS; i += 1) {
      expect(mayAutoContinue(key)).toBe(true);
      const claim = claimRun(key);
      const steers = [{ text: 'keep going', fromPerson: false, eventKey: `steer:${key}:${i}` }];
      // Each continuation is taken; the streak grows because the run changed nothing.
      expect(await continueChat(key, getCell(key), steers, startRun, claim!, () => 500)).toBe(true);
      await until(() => !isLive(key));
      expect(continuationStreakOf(key)).toBe(i + 1);
    }
    expect(mayAutoContinue(key)).toBe(false);

    // The 4th continuation is refused: the chain stops, the words are kept for the person's next turn.
    const claim = claimRun(key);
    const steers = [{ text: 'still nothing', fromPerson: false, eventKey: `steer:${key}:4` }];
    expect(await continueChat(key, getCell(key), steers, startRun, claim!, () => 500)).toBe(false);
    expect(c.asked).toHaveLength(1 + MAX_NO_PROGRESS_CONTINUATIONS); // first run + 3 continuations, no 4th
  });
});
