import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setPendingWordsOwner } from '../pendingWords';
import { drainRunSteering, queueRunSteering, resetRunSteering } from '../runSteering';
import { continueLeftovers, continueOnSettle, type ContinueBinding } from './continueChat';
import { claimRun } from './runClaim';
import { getCell } from './runCells';
import { resetBrainRunStore, isLive, stopRun } from './runControl';
import { startRun } from './startRun';
import { wakeChat } from './wakeChat';
import { continuationLimits } from './deadline';
import type { BrainMessage } from '../types';
import { binding, chat, ports, times, until, userRows } from '../test/continueHarness';

/**
 * A Stop ends the words it reaches - from the inbox AND from the device's journal - on EVERY exit; a continuation that
 * never saved anything leaves no stop answer (it would be an orphan); words handed back by a failed continuation keep
 * their place ahead of what was said meanwhile; a steer with no key keeps the one it was given.
 */
const ME = { tenant: 1, user: 'u-stop' };
const journalOf = (chat: number): string[] => {
  const raw = localStorage.getItem(`bf:pendingWords:${ME.tenant}:${ME.user}:${chat}`);
  return raw ? (JSON.parse(raw) as Array<{ text: string }>).map((e) => e.text) : [];
};
const STOPPED = 'Stopped before it started.';

beforeEach(() => {
  localStorage.clear();
  resetBrainRunStore();
  resetRunSteering();
  setPendingWordsOwner(ME);
});
afterEach(() => setPendingWordsOwner(null));

/** A chat that has run once and can be woken. */
async function ran(key: number, texts: string[], extra: Partial<ContinueBinding> = {}) {
  const c = chat(texts);
  continueOnSettle(key, { ports: () => ports, ...extra });
  await startRun(key, { resolvedSystemPrompt: 'sys', stream: c.stream, persistence: c.persistence, userTurn: 'first' });
  return c;
}

describe('every entry point to Stop clears the inbox AND the journal', () => {
  it('the store\'s stopRun drops what was steered and not yet read, from both', () => {
    queueRunSteering(9701, 'typed before the stop', { fromPerson: true, persist: true });
    expect(journalOf(9701)).toEqual(['typed before the stop']);

    stopRun(9701);

    expect(drainRunSteering(9701)).toEqual([]);
    expect(journalOf(9701)).toEqual([]);
  });

  it('a Stop while the save FAILS (endStopped "failed"): the words are forgotten and no stop row is written', async () => {
    const c = await ran(9702, ['Done.']);
    c.gate.failUserRows = true;

    expect(wakeChat(9702, 'doomed words')).toBe(true);
    expect(journalOf(9702)).toEqual(['doomed words']);
    stopRun(9702);
    await until(() => !isLive(9702));

    expect(journalOf(9702)).toEqual([]);
    expect(drainRunSteering(9702)).toEqual([]);
    expect(c.saved.some((row) => row.content === STOPPED)).toBe(false);
  });

  it('a Stop while the save is still in flight (endStopped "pending"): forgotten at once, and the stop row follows the user row when it lands', async () => {
    const saved = { ...continuationLimits };
    continuationLimits.prepareMs = 40;
    try {
      const c = await ran(9703, ['Done.']);
      let land!: () => void;
      c.gate.holdUserRows = new Promise<void>((resolve) => { land = resolve; });

      expect(wakeChat(9703, 'slow words')).toBe(true);
      stopRun(9703);
      await until(() => !isLive(9703), 1_000);

      expect(journalOf(9703)).toEqual([]); // not waiting for the save
      land();
      await until(() => c.saved.some((row) => row.content === STOPPED), 1_000);
      const order = c.saved.map((row) => row.content);
      expect(order.indexOf(STOPPED)).toBeGreaterThan(order.indexOf('slow words'));
    } finally {
      Object.assign(continuationLimits, saved);
    }
  });

  it('the late stop row is NOT written when the person has already spoken again (it would read as the answer to THAT)', async () => {
    const saved = { ...continuationLimits };
    continuationLimits.prepareMs = 40;
    try {
      const c = await ran(9704, ['Done.']);
      // The store can say the chat moved on: a user row exists after the one just saved.
      const newer = { id: 900, seq: 900_000, role: 'user', content: 'a newer message', metadata: null, createdAt: '' } as BrainMessage;
      c.persistence.getMessages = async () => [newer];
      let land!: () => void;
      c.gate.holdUserRows = new Promise<void>((resolve) => { land = resolve; });

      expect(wakeChat(9704, 'stopped while saving')).toBe(true);
      stopRun(9704);
      await until(() => !isLive(9704), 1_000);
      land();
      await new Promise((r) => setTimeout(r, 80));

      expect(userRows(c)).toContain('stopped while saving');
      expect(c.saved.some((row) => row.content === STOPPED)).toBe(false);
    } finally {
      Object.assign(continuationLimits, saved);
    }
  });

  it('a Stop that finds NO save started (the files never became readable) writes NO stop rows, drops the words, and forgets them', async () => {
    const saved = { ...continuationLimits };
    continuationLimits.prepareMs = 40;
    try {
      const c = await ran(9705, ['Done.', 'must never run'], {
        // Reading the attachment never answers: composing the turn is what times out, before any row is saved.
        ports: () => ({ ...ports, inlineAttachments: () => new Promise(() => undefined) }),
      });
      const before = c.saved.length;

      expect(wakeChat(9705, 'with a file', [{ key: 'f1', name: 'a.txt', type: 'text/plain' }])).toBe(true);
      stopRun(9705);
      await until(() => !isLive(9705), 1_000);

      expect(c.saved).toHaveLength(before); // no user row, no stop answer: an orphan answer would be a lie
      expect(journalOf(9705)).toEqual([]);
      expect(drainRunSteering(9705)).toEqual([]);
      expect(c.asked).toHaveLength(1);
    } finally {
      Object.assign(continuationLimits, saved);
    }
  });
});

describe('words a failed continuation hands back keep their place', () => {
  it('ALL of a chat\'s handed turns are ONE continuation: one row each, in order, one run', async () => {
    const c = await ran(9710, ['Done.', 'Read both.']);

    expect(wakeChat(9710, [{ text: 'first thing' }, { text: 'second thing' }])).toBe(true);
    await until(() => c.asked.length >= 2 && !isLive(9710));

    expect(userRows(c)).toEqual(['first thing', 'second thing']);
    expect(c.asked).toHaveLength(2);
    expect(JSON.stringify(c.asked[1])).toContain('first thing');
    expect(JSON.stringify(c.asked[1])).toContain('second thing');
  });

  it('the save fails after wakeChat took the turns: they return to the FRONT of the inbox, ahead of what was said meanwhile', async () => {
    const c = await ran(9711, ['Done.']);
    let fail!: () => void;
    c.gate.holdUserRows = new Promise<void>((resolve) => { fail = resolve; });
    c.gate.failUserRows = true;

    expect(wakeChat(9711, [{ text: 'A' }, { text: 'B' }])).toBe(true);
    queueRunSteering(9711, 'C, said while the save was out', { fromPerson: true, persist: true }); // the chat is live: it steers
    fail();
    await until(() => !isLive(9711));

    expect(drainRunSteering(9711).map((m) => m.text)).toEqual(['A', 'B', 'C, said while the save was out']);
  });

  it('a second wake while the first continuation holds the chat is refused (the caller keeps its words in the inbox)', async () => {
    const c = await ran(9712, ['Done.']);
    c.gate.holdUserRows = new Promise<void>(() => undefined);

    expect(wakeChat(9712, [{ text: 'A' }])).toBe(true);
    expect(wakeChat(9712, [{ text: 'B' }])).toBe(false);
  });
});

describe('a steer with no key keeps the one it is given', () => {
  it('saved, timed out, landing late, then continued AGAIN: one row', async () => {
    const saved = { ...continuationLimits };
    continuationLimits.prepareMs = 40;
    try {
      // An owner's direction to its sub-agent: not typed by a person, so nothing has keyed it yet.
      const c = chat(['Done.', 'Next.'], times(1, () => queueRunSteering(9720, 'owner direction', {})));
      continueOnSettle(9720, binding);
      let land!: () => void;
      c.gate.holdUserRows = new Promise<void>((resolve) => { land = resolve; });
      await startRun(9720, { resolvedSystemPrompt: 'sys', stream: c.stream, persistence: c.persistence, userTurn: 'first' });
      await until(() => !isLive(9720), 1_000); // the allowance ended the wait; the save is still in flight

      const [kept] = drainRunSteering(9720);
      expect(kept?.eventKey).toMatch(/^steer:/); // keyed before its first save attempt, and requeued WITH the key
      queueRunSteering(9720, kept!.text, { eventKey: kept!.eventKey });

      land(); // the late save lands...
      await new Promise((r) => setTimeout(r, 30));
      // ...and the words are continued again, under the key they already have.
      const claim = claimRun(9720)!;
      await continueLeftovers(9720, getCell(9720), startRun, claim);
      await until(() => !isLive(9720));

      expect(userRows(c).filter((row) => row === 'owner direction')).toHaveLength(1);
    } finally {
      Object.assign(continuationLimits, saved);
    }
  });
});
