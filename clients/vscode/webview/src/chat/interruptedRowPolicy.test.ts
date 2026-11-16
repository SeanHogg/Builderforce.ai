import { describe, expect, it } from 'vitest';

import {
  interruptedCompleteIds,
  isCompleteProgress,
  pendingChatIds,
  resumableInterruptedRun,
  type InterruptedResumeView,
  type InterruptedRunRef,
} from './interruptedRowPolicy';

const RUN_1 = { runId: 'run-1', chatId: '101' };
const RUN_2 = { runId: 'run-2', chatId: '102' };
const RUNS = [RUN_1, RUN_2];

/** A resume view with nothing pending and no chat running. */
function quiet(): InterruptedResumeView {
  return { pending: new Set(), isRunning: () => false };
}

describe('isCompleteProgress', () => {
  it('treats 100 and above as complete', () => {
    expect(isCompleteProgress(100)).toBe(true);
    expect(isCompleteProgress(100.0)).toBe(true);
  });

  it('treats a missing, non-numeric, or non-finite progress as complete (no Resume on unknown)', () => {
    expect(isCompleteProgress(undefined)).toBe(true);
    expect(isCompleteProgress(null)).toBe(true);
    expect(isCompleteProgress('50' as unknown as number)).toBe(true);
    expect(isCompleteProgress(Number.NaN)).toBe(true);
    expect(isCompleteProgress(Number.POSITIVE_INFINITY)).toBe(true);
  });

  it('treats anything under 100 as incomplete', () => {
    expect(isCompleteProgress(0)).toBe(false);
    expect(isCompleteProgress(50)).toBe(false);
    expect(isCompleteProgress(99.9)).toBe(false);
  });
});

describe('pendingChatIds', () => {
  it('collects the chats of pending runs', () => {
    expect(pendingChatIds(RUNS, new Set(['run-2']))).toEqual(new Set([102]));
  });

  it('ignores runs without a chat and non-integer chat ids', () => {
    expect(pendingChatIds([{ runId: 'a', chatId: null }, { runId: 'b', chatId: 'x' }], new Set(['a', 'b']))).toEqual(new Set());
  });

  it('is empty when nothing is pending', () => {
    expect(pendingChatIds(RUNS, new Set())).toEqual(new Set());
  });
});

describe('resumableInterruptedRun', () => {
  it('returns a journaled run for an interrupted, incomplete chat', () => {
    expect(resumableInterruptedRun(101, 50, RUNS, quiet())).toEqual({ runId: 'run-1', chatId: 101, journaled: true });
  });

  it('returns an OPEN-ONLY target for an incomplete chat with NO journaled run', () => {
    // Under 100% but nothing journaled: still offers Resume, as open-only (the play button
    // opens the chat; no continuation is sent).
    expect(resumableInterruptedRun(999, 50, RUNS, quiet())).toEqual({ runId: 'open-999', chatId: 999, journaled: false });
  });

  it('returns undefined for a complete chat even with a journaled run (Resume would be a no-op)', () => {
    expect(resumableInterruptedRun(101, 100, RUNS, quiet())).toBeUndefined();
  });

  it('returns undefined for a chat with unknown progress (no Resume on unknown)', () => {
    expect(resumableInterruptedRun(101, undefined, RUNS, quiet())).toBeUndefined();
    expect(resumableInterruptedRun(999, undefined, RUNS, quiet())).toBeUndefined();
  });

  it('returns undefined when the chat is already running', () => {
    const running: InterruptedResumeView = { pending: new Set(), isRunning: (id) => id === 101 };
    expect(resumableInterruptedRun(101, 50, RUNS, running)).toBeUndefined();
  });

  it('returns the PENDING run itself when a resume is in flight in its chat (one per chat)', () => {
    // run-2 of chat 102 is pending; run-1 of chat 101 must not also offer Resume into 101? No —
    // the guard is per CHAT: a pending resume in chat 102 does not block chat 101.
    expect(resumableInterruptedRun(101, 50, RUNS, { pending: new Set(['run-2']), isRunning: () => false })).toEqual({ runId: 'run-1', chatId: 101, journaled: true });
    // But a second run in the SAME chat is not targeted while the first is pending: the row
    // resolves to the pending run (its button shows the in-flight state), never the other run.
    const sameChat: InterruptedRunRef[] = [{ runId: 'run-a', chatId: '101' }, { runId: 'run-b', chatId: '101' }];
    const target = resumableInterruptedRun(101, 50, sameChat, { pending: new Set(['run-a']), isRunning: () => false });
    expect(target).toEqual({ runId: 'run-a', chatId: 101, journaled: true });
    expect(target).not.toEqual(expect.objectContaining({ runId: 'run-b' }));
  });

  it('returns an OPEN-ONLY target for a non-integer run chat id (row falls back to open)', () => {
    // A journaled run whose chat id is not an integer cannot be resumed by id; an incomplete
    // chat still offers open-only Resume.
    const target = resumableInterruptedRun(101, 50, [{ runId: 'run-x', chatId: 'nope' }], quiet());
    expect(target).toEqual({ runId: 'open-101', chatId: 101, journaled: false });
  });
});

describe('interruptedCompleteIds', () => {
  const progress = (pct: number | null | undefined) => () => pct;

  it('lists an interrupted, complete chat as a dedicated interrupted row', () => {
    expect(interruptedCompleteIds([101], RUNS, quiet(), progress(100))).toEqual(new Set([101]));
  });

  it('does NOT list an interrupted, incomplete chat (it is a normal row carrying Resume)', () => {
    expect(interruptedCompleteIds([101], RUNS, quiet(), progress(50))).toEqual(new Set());
  });

  it('does NOT list a chat with no interrupted run at all', () => {
    expect(interruptedCompleteIds([999], RUNS, quiet(), progress(100))).toEqual(new Set());
  });

  it('lists an interrupted, incomplete chat once its chat is running (Resume refused; dedicated row takes over)', () => {
    const running: InterruptedResumeView = { pending: new Set(), isRunning: (id) => id === 101 };
    expect(interruptedCompleteIds([101], RUNS, running, progress(50))).toEqual(new Set([101]));
  });

  it('lists each interrupted chat exactly once across the whole set (no duplicate normal + dedicated rows)', () => {
    const chatIds = [101, 102, 103];
    const pct = (id: number) => (id === 101 ? 100 : id === 102 ? 50 : null);
    const ids = interruptedCompleteIds(chatIds, RUNS, quiet(), pct);
    // 101 complete → dedicated; 102 incomplete → normal row with Resume; 103 not interrupted → normal.
    expect(ids.has(101)).toBe(true);
    expect(ids.has(102)).toBe(false);
    expect(ids.has(103)).toBe(false);
  });
});
