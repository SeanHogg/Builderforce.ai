import { beforeEach, describe, expect, it } from 'vitest';
import { queueRunSteering, drainRunSteering, hasRunInterrupt, resetRunSteering } from '../runSteering';
import { continueOnSettle, type ContinueBinding } from './continueChat';
import { resetBrainRunStore, isLive, isRunning, stopRun, subscribeRun } from './runControl';
import { getCell } from './runCells';
import { startRun } from './startRun';
import { wakeChat } from './wakeChat';
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
    // A person's own launch (a send that saved its row) is refused while the claim is held.
    await startRun(9308, { resolvedSystemPrompt: 'sys', stream: c.stream, persistence: c.persistence, userTurn: 'racing launch' });
    expect(isRunning(9308)).toBe(false);
    expect(c.asked).toHaveLength(1);

    release();
    await until(() => c.asked.length >= 2 && !isLive(9308));
    expect(c.asked).toHaveLength(2);
    expect(isLive(9308)).toBe(false);
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

  it('a Stop during prepareRun starts nothing: the saved row stays, the claim is released', async () => {
    const { c, release } = await waiting(9321, ['Done.', 'must never run']);

    expect(wakeChat(9321, 'said, then stopped', undefined)).toBe(true);
    await until(() => userRows(c).length === 1); // the row is saved; prepareRun is now waiting
    stopRun(9321);
    release();
    await new Promise((r) => setTimeout(r, 60));

    expect(userRows(c)).toEqual(['said, then stopped']);
    expect(c.asked).toHaveLength(1);
    expect(isLive(9321)).toBe(false);
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
