import { describe, expect, it } from 'vitest';
import { startsRun, unansweredTurnIndex } from './userTurnRuns';

// VS Code chat #6: the progress guard asked "Continue with guidance / Stop the run"; the
// question ended the run, and the "Stop the run" answer started a fresh one that kept working.

describe('startsRun', () => {
  it.each(['Stop the run', 'stop', 'Please stop now.', 'cancel the task'])('a stop starts nothing: %s', (text) => {
    expect(startsRun(text)).toBe(false);
  });
  it.each(['Continue with guidance', 'stop using the old adapter and port it', 'Fix the stop button'])('work starts a run: %s', (text) => {
    expect(startsRun(text)).toBe(true);
  });
});

describe('unansweredTurnIndex', () => {
  const row = (id: number, role: string, content = '') => ({ id, role, content, metadata: null, seq: id, createdAt: '' }) as never;
  it('a trailing stop is answered by stopping: nothing is left to retry', () => {
    expect(unansweredTurnIndex([row(1, 'assistant', 'Continue or stop?'), row(2, 'user', 'Stop the run')])).toBe(-1);
  });
});
