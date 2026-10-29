import { beforeEach, describe, expect, it } from 'vitest';
import { queueRunSteering, drainRunSteering, hasRunInterrupt, resetRunSteering } from '../runSteering';
import { continueOnSettle, type ContinueBinding } from './continueChat';
import { resetBrainRunStore, isLive, isRunning, stopRun, subscribeRun } from './runControl';
import { getCell } from './runCells';
import { startRun } from './startRun';
import { wakeChat } from './wakeChat';
import { continuationLimits } from './deadline';
import type { BrainRunRequest } from './runTypes';
import { binding, chat, ports, times, until, userRows } from '../test/continueHarness';

beforeEach(() => {
  resetBrainRunStore();
  resetRunSteering();
});

describe('a continuation holds the chat while it is made (the claim)', () => {
  /** A chat that has run once and can be woken, whose host's `prepareRun` waits for `gate.release()`. */
  async function waiting(key: number, texts: string[], extra: Partial<ContinueBinding> = {}) {
    const c = chat(texts);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    continueOnSettle(key, { ports: () => ports, prepareRun: async () => { await gate; return {}; }, ...extra });
    await startRun(key, { resolvedSystemPrompt: 'sys', stream: c.stream, persistence: c.persistence, userTurn: 'first' });
    return { c, release };
  }

  it('the chat is LIVE while the continuation is made, though nothing runs: a launch cannot take it', async () => {
    const { c, release } = await waiting(9308, ['Done.', 'Continued.']);

    expect(wakeChat(9308, 'wake', undefined)).toBe(true);
    expect(isRunning(9308)).toBe(false);
    expect(isLive(9308)).toBe(true);
    // A person's own launch (a send that already saved its row) is refused while the claim is held - and its
    // words are NOT dropped: they join the run being made, which reads them once.
    const outcome = await startRun(9308, { resolvedSystemPrompt: 'sys', stream: c.stream, persistence: c.persistence, userTurn: 'racing launch', userTurnMessageId: 4242 });
    expect(outcome).toBe('joined');
    expect(isRunning(9308)).toBe(false);
    expect(c.asked).toHaveLength(1);
    expect(hasRunInterrupt(9308)).toBe(true);

    release();
    await until(() => c.asked.length >= 2 && !isLive(9308));
    expect(c.asked).toHaveLength(2);
    expect(isLive(9308)).toBe(false);
    expect(JSON.stringify(c.asked[1]).split('racing launch')).toHaveLength(2); // read exactly once
    expect(userRows(c)).toEqual(['wake']); // its row was saved by the caller: nothing saved it twice
  });

  it('a refused launch whose row was NOT saved is saved once, by the run that reads it', async () => {
    const { c, release } = await waiting(9326, ['Done.', 'Continued.']);

    expect(wakeChat(9326, 'wake', undefined)).toBe(true);
    expect(await startRun(9326, { resolvedSystemPrompt: 'sys', stream: c.stream, persistence: c.persistence, userTurn: 'unsaved launch' })).toBe('joined');
    release();
    await until(() => c.asked.length >= 2 && !isLive(9326));

    expect(JSON.stringify(c.asked[1])).toContain('unsaved launch');
    expect(userRows(c).sort()).toEqual(['unsaved launch', 'wake']);
  });

  it('a launch refused because a run is going joins THAT run\'s inbox, interrupting - never dropped', async () => {
    const c = chat(['Only.']);
    let hold!: () => void;
    const gate = new Promise<void>((resolve) => { hold = resolve; });
    const stream: BrainRunRequest['stream'] = async (opts, handlers) => { await gate; return c.stream(opts, handlers); };
    const first = startRun(9327, { resolvedSystemPrompt: 'sys', stream, persistence: c.persistence, userTurn: 'first' });
    await until(() => isRunning(9327));

    expect(await startRun(9327, { resolvedSystemPrompt: 'sys', stream, persistence: c.persistence, userTurn: 'second', userTurnMessageId: 9 })).toBe('joined');
    expect(hasRunInterrupt(9327)).toBe(true);
    expect(drainRunSteering(9327)).toMatchObject([{ text: 'second', fromPerson: true, saved: true }]);
    hold();
    await first;
  });

  it('a person typing meanwhile reaches the continuation run\'s inbox ONCE, interrupting - and the run reads it', async () => {
    const { c, release } = await waiting(9320, ['Done.', 'Handled both.']);

    expect(wakeChat(9320, 'the wake', undefined)).toBe(true);
    // What the door does for a live chat: steer (the claim counts as live), persisted by the run.
    queueRunSteering(9320, 'and also this', { interrupt: true, fromPerson: true, persist: true });
    expect(hasRunInterrupt(9320)).toBe(true);
    release();
    await until(() => c.asked.length >= 2 && !isLive(9320));

    expect(JSON.stringify(c.asked[1])).toContain('and also this');
    expect(userRows(c).filter((row) => row === 'and also this')).toHaveLength(1);
    expect(userRows(c).filter((row) => row === 'the wake')).toHaveLength(1);
    expect(drainRunSteering(9320)).toEqual([]);
  });

  it('a Stop during prepareRun starts nothing: the saved row stays AND is answered "stopped", so a reopen does not run it', async () => {
    const { c, release } = await waiting(9321, ['Done.', 'must never run']);

    expect(wakeChat(9321, 'said, then stopped', undefined)).toBe(true);
    await until(() => userRows(c).length === 1); // the row is saved; prepareRun is now waiting
    const before = c.saved.length;
    stopRun(9321);
    // A claim is released ONLY by its holder: the Stop does not take the chat from it.
    expect(isLive(9321)).toBe(true);
    release();
    await until(() => !isLive(9321));

    expect(userRows(c)).toEqual(['said, then stopped']);
    expect(c.asked).toHaveLength(1);
    expect(c.saved.slice(before).some((row) => row.role === 'assistant' && row.content === 'Stopped before it started.')).toBe(true);
  });

  it('a Stop, then a prepareRun that fails: the stopped words are not requeued', async () => {
    let fail!: () => void;
    const gate = new Promise<void>((_, reject) => { fail = () => reject(new Error('host gone')); });
    const c = chat(['Done.', 'must never run']);
    continueOnSettle(9331, { ports: () => ports, prepareRun: async () => { await gate; return {}; } });
    await startRun(9331, { resolvedSystemPrompt: 'sys', stream: c.stream, persistence: c.persistence, userTurn: 'first' });

    expect(wakeChat(9331, 'stopped words', undefined)).toBe(true);
    await until(() => userRows(c).length === 1);
    stopRun(9331);
    fail();
    await until(() => !isLive(9331));

    expect(drainRunSteering(9331)).toEqual([]);
    expect(c.asked).toHaveLength(1);
  });

  it('two continuations race: ONE run; the other\'s words wait in the inbox that run reads', async () => {
    const { c, release } = await waiting(9322, ['Done.', 'Read both.']);

    expect(wakeChat(9322, 'first wake', undefined)).toBe(true);
    // The second finds the chat claimed: it is refused, and the caller puts the words in the inbox (useChatTurns).
    expect(wakeChat(9322, 'second wake', undefined)).toBe(false);
    queueRunSteering(9322, 'second wake', { fromPerson: true, persist: true });
    release();
    await until(() => c.asked.length >= 2 && !isLive(9322));

    expect(c.asked).toHaveLength(2);
    expect(JSON.stringify(c.asked[1])).toContain('first wake');
    expect(JSON.stringify(c.asked[1])).toContain('second wake');
    expect(userRows(c).sort()).toEqual(['first wake', 'second wake']);
  });

  it('a run that settles hands the chat STRAIGHT to its continuation: it is never idle in between', async () => {
    const c = chat(['First.', 'Second.'], times(1, () => queueRunSteering(9323, 'leftover', { fromPerson: true, persist: true })));
    continueOnSettle(9323, binding);
    const lives: boolean[] = [];
    getCell(9323);
    const off = subscribeRun(9323, () => lives.push(isLive(9323)));

    await startRun(9323, { resolvedSystemPrompt: 'sys', stream: c.stream, persistence: c.persistence, userTurn: 'first' });
    await until(() => c.asked.length >= 2 && !isLive(9323));
    off();

    expect(c.asked).toHaveLength(2);
    expect(lives.length).toBeGreaterThan(2);
    expect(lives.slice(0, -1).every(Boolean)).toBe(true);
    expect(lives[lives.length - 1]).toBe(false);
  });

  it('the claim is released when the row cannot be saved (the words wait in the inbox)', async () => {
    const { c, release } = await waiting(9324, ['Done.']);
    c.gate.failUserRows = true;

    expect(wakeChat(9324, 'lost row', undefined)).toBe(true);
    release();
    await new Promise((r) => setTimeout(r, 60));

    expect(isLive(9324)).toBe(false);
    expect(drainRunSteering(9324)).toMatchObject([{ text: 'lost row', fromPerson: true, persist: true }]);
  });
});

describe('a claim cannot hold a chat forever', () => {
  it('prepareRun that never answers: bounded, said as an error, the saved words wait in the inbox, the chat is free', async () => {
    const saved = { ...continuationLimits };
    continuationLimits.prepareMs = 40;
    try {
      const c = chat(['Done.', 'must never run']);
      continueOnSettle(9328, { ports: () => ports, prepareRun: () => new Promise<never>(() => {}) });
      await startRun(9328, { resolvedSystemPrompt: 'sys', stream: c.stream, persistence: c.persistence, userTurn: 'first' });

      expect(wakeChat(9328, 'host is stuck', undefined)).toBe(true);
      await until(() => !isLive(9328), 1_000);

      expect(isLive(9328)).toBe(false);
      expect(c.asked).toHaveLength(1);
      expect(userRows(c)).toEqual(['host is stuck']);
      expect(drainRunSteering(9328)).toMatchObject([{ fromPerson: true, saved: true }]);
      // A CODE, rendered in the person's language by each host - never an English sentence from the store.
      expect(getCell(9328).error).toBe('continuation_timed_out');
      expect(getCell(9328).errorAction).toEqual({ kind: 'continuation_timed_out' });
      expect(getCell(9328).trace.some((e) => e.label === 'steer.prepare_failed')).toBe(true);
    } finally {
      Object.assign(continuationLimits, saved);
    }
  });

  it('a row that cannot be saved is said as the chat\'s error, with the failure\'s own message', async () => {
    const c = chat(['Done.']);
    continueOnSettle(9329, binding);
    await startRun(9329, { resolvedSystemPrompt: 'sys', stream: c.stream, persistence: c.persistence, userTurn: 'first' });
    c.gate.failUserRows = true;

    expect(wakeChat(9329, 'no session', undefined)).toBe(true);
    await until(() => !isLive(9329));

    expect(getCell(9329).error).toBe('token expired');
  });

  it('an unwinding run holds the chat until it has unwound, and frees it after - a Stop\'s included', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const c = chat(['never']);
    const stream: BrainRunRequest['stream'] = async (opts, handlers) => { await gate; return c.stream(opts, handlers); };
    continueOnSettle(9330, binding);
    const run = startRun(9330, { resolvedSystemPrompt: 'sys', stream, persistence: c.persistence, userTurn: 'ask' });
    await until(() => isRunning(9330));

    stopRun(9330);
    release();
    await run;

    expect(isLive(9330)).toBe(false);
    expect(getCell(9330).claim).toBeNull();
  });
});
