import { describe, expect, it } from 'vitest';
import { createResumeTracker, resumeEventOf, RESUME_TIMEOUT_MS } from './interruptedResume';
import { interruptedWhen } from './interruptedWhen';

function setup(running: Set<number> = new Set(), kept: boolean | Promise<boolean> = true) {
  const calls: string[] = [];
  const timers: Array<{ fn: () => void; ms: number; live: boolean }> = [];
  const tracker = createResumeTracker({
    openChat: (id) => void calls.push(`open:${id}`),
    send: async (text) => { calls.push(`send:${text}`); return kept; },
    ack: (runId) => void calls.push(`ack:${runId}`),
    isRunning: (id) => running.has(id),
    continuation: () => 'continue',
    setTimer: (fn, ms) => {
      const t = { fn, ms, live: true };
      timers.push(t);
      return t;
    },
    clearTimer: (t) => { (t as { live: boolean }).live = false; },
  });
  const fire = () => timers.filter((t) => t.live).forEach((t) => { t.live = false; t.fn(); });
  return { tracker, calls, timers, fire };
}

describe('createResumeTracker', () => {
  it('opens the chat, sends the continuation once the chat is showing, and acks only after a run event', () => {
    const { tracker, calls } = setup();
    expect(tracker.begin({ runId: 'r1', chatId: 7 })).toBe(true);
    expect(calls).toEqual(['open:7']);
    expect(tracker.snapshot().pending.has('r1')).toBe(true);

    tracker.activeChat(3); // another chat: nothing is sent
    expect(calls).toEqual(['open:7']);
    tracker.activeChat(7);
    tracker.activeChat(7); // idempotent: one send
    expect(calls).toEqual(['open:7', 'send:continue']);
    expect(calls.some((c) => c.startsWith('ack'))).toBe(false);

    tracker.runEvent({ type: 'claimed', chatId: 7 });
    expect(calls).toEqual(['open:7', 'send:continue', 'ack:r1']);
    expect(tracker.snapshot().pending.size).toBe(0);
    expect(tracker.snapshot().failed.size).toBe(0);
  });

  it('sends THE interrupted run\'s own continuation (built from its journaled record), by its id', () => {
    const sent: string[] = [];
    const tracker = createResumeTracker({
      openChat: () => undefined,
      send: async (text) => { sent.push(text); return true; },
      ack: () => undefined,
      isRunning: () => false,
      continuation: (runId) => `continue ${runId}`,
      setTimer: () => 0,
      clearTimer: () => undefined,
    });
    tracker.begin({ runId: 'r9', chatId: 2 });
    tracker.activeChat(2);
    expect(sent).toEqual(['continue r9']);
  });

  it('ignores a run event for another chat or one seen before the continuation was sent', () => {
    const { tracker, calls } = setup();
    tracker.begin({ runId: 'r1', chatId: 7 });
    tracker.runEvent({ type: 'claimed', chatId: 7 }); // before the send
    tracker.activeChat(7);
    tracker.runEvent({ type: 'claimed', chatId: 8 });
    expect(calls).toEqual(['open:7', 'send:continue']);
    expect(tracker.snapshot().pending.has('r1')).toBe(true);
  });

  it('a timeout leaves the run unacked and marked failed, and Resume can be tried again', () => {
    const { tracker, calls, timers, fire } = setup();
    tracker.begin({ runId: 'r1', chatId: 7 });
    tracker.activeChat(7);
    expect(timers[0]!.ms).toBe(RESUME_TIMEOUT_MS);
    fire();
    expect(tracker.snapshot().failed.has('r1')).toBe(true);
    expect(tracker.snapshot().pending.size).toBe(0);
    expect(calls.some((c) => c.startsWith('ack'))).toBe(false);

    expect(tracker.begin({ runId: 'r1', chatId: 7 })).toBe(true);
    expect(tracker.snapshot().failed.has('r1')).toBe(false);
  });

  it('a failed run event marks the row failed without an ack', () => {
    const { tracker, calls } = setup();
    tracker.begin({ runId: 'r1', chatId: 7 });
    tracker.activeChat(7);
    tracker.runEvent({ type: 'failed', chatId: 7 });
    expect(tracker.snapshot().failed.has('r1')).toBe(true);
    expect(calls.some((c) => c.startsWith('ack'))).toBe(false);
  });

  it('a claim cancels the timeout', () => {
    const { tracker, fire } = setup();
    tracker.begin({ runId: 'r1', chatId: 7 });
    tracker.activeChat(7);
    tracker.runEvent({ type: 'claimed', chatId: 7 });
    fire();
    expect(tracker.snapshot().failed.size).toBe(0);
  });

  it('refuses a resume into a running chat and a second resume of a pending run', () => {
    const { tracker, calls } = setup(new Set([9]));
    expect(tracker.begin({ runId: 'busy', chatId: 9 })).toBe(false);
    expect(calls).toEqual([]);
    expect(tracker.begin({ runId: 'r1', chatId: 7 })).toBe(true);
    expect(tracker.begin({ runId: 'r1', chatId: 7 })).toBe(false);
    expect(calls).toEqual(['open:7']);
  });

  it('notifies subscribers of every change', () => {
    const { tracker } = setup();
    let n = 0;
    tracker.subscribe(() => { n += 1; });
    tracker.begin({ runId: 'r1', chatId: 7 });
    tracker.activeChat(7);
    tracker.runEvent({ type: 'claimed', chatId: 7 });
    expect(n).toBe(2);
  });
});

describe('interruptedWhen', () => {
  it('formats in the given locale and falls back to the raw text', () => {
    const iso = '2026-10-18T12:00:00.000Z';
    expect(interruptedWhen(iso, 'en-US')).toBe(new Date(iso).toLocaleString('en-US'));
    expect(interruptedWhen('not a date', 'en-US')).toBe('not a date');
  });
});

describe('createResumeTracker: door answer, claims and dispose', () => {
  it('a run.sync with running:false does not claim; running:true, settled and failed map to events', () => {
    expect(resumeEventOf({ type: 'run.sync', chatId: 7, snapshot: { running: false } })).toBeNull();
    expect(resumeEventOf({ type: 'run.sync', chatId: 7 })).toBeNull();
    expect(resumeEventOf({ type: 'run.sync', chatId: 7, snapshot: { running: true } })).toEqual({ type: 'claimed', chatId: 7 });
    expect(resumeEventOf({ type: 'run.settled', chatId: 7 })).toEqual({ type: 'claimed', chatId: 7 });
    expect(resumeEventOf({ type: 'run.failed', chatId: 7 })).toEqual({ type: 'failed', chatId: 7 });
  });

  it('a send the door did not keep fails the row at once, with no ack', async () => {
    const { tracker, calls } = setup(new Set(), false);
    tracker.begin({ runId: 'r1', chatId: 7 });
    tracker.activeChat(7);
    await Promise.resolve();
    await Promise.resolve();
    expect(tracker.snapshot().failed.has('r1')).toBe(true);
    expect(tracker.snapshot().pending.size).toBe(0);
    expect(calls.some((c) => c.startsWith('ack'))).toBe(false);
  });

  it('a send that rejects fails the row at once', async () => {
    const { tracker } = setup(new Set(), Promise.reject(new Error('x')));
    tracker.begin({ runId: 'r1', chatId: 7 });
    tracker.activeChat(7);
    await new Promise((r) => setTimeout(r, 0));
    expect(tracker.snapshot().failed.has('r1')).toBe(true);
  });

  it('a late kept answer does not undo a claim', async () => {
    const { tracker, calls } = setup();
    tracker.begin({ runId: 'r1', chatId: 7 });
    tracker.activeChat(7);
    tracker.runEvent({ type: 'claimed', chatId: 7 });
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toContain('ack:r1');
    expect(tracker.snapshot().failed.size).toBe(0);
  });

  it('dispose clears the timer and drops the pending run', () => {
    const { tracker, timers, fire } = setup();
    tracker.begin({ runId: 'r1', chatId: 7 });
    expect(timers[0]!.live).toBe(true);
    tracker.dispose();
    expect(timers[0]!.live).toBe(false);
    fire();
    expect(tracker.snapshot().failed.size).toBe(0);
  });

  it('a run that starts late, after the timeout, is acked and its row leaves the failed list', () => {
    const { tracker, calls, fire } = setup();
    tracker.begin({ runId: 'r1', chatId: 7 });
    tracker.activeChat(7);
    fire();
    expect(tracker.snapshot().failed.has('r1')).toBe(true);
    tracker.runEvent({ type: 'claimed', chatId: 8 });
    expect(tracker.snapshot().failed.has('r1')).toBe(true);
    tracker.runEvent({ type: 'claimed', chatId: 7 });
    expect(calls).toContain('ack:r1');
    expect(tracker.snapshot().failed.size).toBe(0);
  });

  it('a row that failed because the door did not keep it is not claimed by a later run', async () => {
    const { tracker, calls } = setup(new Set(), false);
    tracker.begin({ runId: 'r1', chatId: 7 });
    tracker.activeChat(7);
    await new Promise((r) => setTimeout(r, 0));
    tracker.runEvent({ type: 'claimed', chatId: 7 });
    expect(calls.some((c) => c.startsWith('ack'))).toBe(false);
    expect(tracker.snapshot().failed.has('r1')).toBe(true);
  });

  it('regression: a second interrupted run in the same chat is refused while one is pending, so one claim acks one run', () => {
    const { tracker, calls } = setup();
    expect(tracker.begin({ runId: 'r1', chatId: 7 })).toBe(true);
    expect(tracker.begin({ runId: 'r2', chatId: 7 })).toBe(false);
    expect(tracker.begin({ runId: 'r3', chatId: 8 })).toBe(true);
    tracker.activeChat(7);
    expect(calls.filter((c) => c.startsWith('send'))).toHaveLength(1);
    tracker.runEvent({ type: 'claimed', chatId: 7 });
    expect(calls.filter((c) => c.startsWith('ack'))).toEqual(['ack:r1']);
    expect([...tracker.snapshot().pending]).toEqual(['r3']);
    // Settled, the chat takes the next resume.
    expect(tracker.begin({ runId: 'r2', chatId: 7 })).toBe(true);
  });

  it('regression: a new resume in a chat supersedes a timed-out one there, so a claim acks only the new run', () => {
    const { tracker, calls, fire } = setup();
    tracker.begin({ runId: 'r1', chatId: 7 });
    tracker.activeChat(7);
    fire();
    expect(tracker.begin({ runId: 'r2', chatId: 7 })).toBe(true);
    tracker.activeChat(7);
    tracker.runEvent({ type: 'claimed', chatId: 7 });
    tracker.runEvent({ type: 'claimed', chatId: 7 });
    expect(calls.filter((c) => c.startsWith('ack'))).toEqual(['ack:r2']);
    expect(tracker.snapshot().failed.has('r1')).toBe(true);
  });
});
