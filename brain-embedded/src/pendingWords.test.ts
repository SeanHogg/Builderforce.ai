import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isMidTurnMetadata } from '@builderforce/agent-loop';
import {
  clearPendingWords,
  forgetPendingWords,
  markPendingWordsRead,
  registerPendingWordsReplay,
  rememberPendingWords,
  replayAllPendingWords,
  replayPendingWords,
  setPendingWordsOwner,
} from './pendingWords';
import { drainRunSteering, queueRunSteering, resetRunSteering } from './runSteering';
import { cells, getCell } from './runStore/runCells';

/**
 * "Your message is kept" is true because words the run will save are on the DEVICE the moment they are queued, until
 * they are saved - so a reload before the (bounded) network save lands finds them and saves them under the SAME key.
 * The journal belongs to one person in one workspace, is replayed only for page loads that are provably gone, and
 * never costs a steer.
 */
const ME = { tenant: 1, user: 'u-me' };
const keyOf = (chat: number, who = ME) => `bf:pendingWords:${who.tenant}:${who.user}:${chat}`;
const DAY = 24 * 60 * 60 * 1000;
type Row = { role: string; content: string; metadata?: string; eventKey?: string };

/** What the journal holds for a chat, as a person would describe it. */
function journal(chat: number, who = ME): Array<{ eventKey: string; text: string; read?: true }> {
  const raw = localStorage.getItem(keyOf(chat, who));
  if (!raw) return [];
  return (JSON.parse(raw) as Array<{ eventKey: string; text: string; read?: true }>).map(({ eventKey, text, read }) => ({ eventKey, text, ...(read ? { read } : {}) }));
}

/** Words an EARLIER page load left (a session that is not this one), old enough to be past the start grace. */
function leave(chat: number, entries: Array<{ eventKey: string; text: string; read?: true; session?: string; at?: number }>, who = ME): void {
  localStorage.setItem(keyOf(chat, who), JSON.stringify(entries.map((e) => ({ session: 'an-earlier-load', at: Date.now() - 60_000, ...e }))));
}

/** Web Locks as a browser reports them: these sessions hold their lock (are alive). */
function aliveSessions(...sessions: string[]): void {
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: { query: async () => ({ held: sessions.map((s) => ({ name: `bf:pendingWords:session:${s}` })) }), request: vi.fn(async () => undefined) },
  });
}

beforeEach(() => {
  localStorage.clear();
  resetRunSteering();
  setPendingWordsOwner(ME);
  aliveSessions();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  registerPendingWordsReplay(null);
  setPendingWordsOwner(null);
  Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
});

describe('the journal of unsaved words', () => {
  it('queueing words the run will save writes them to the device, under their key; a steer that is already saved is not journaled', () => {
    queueRunSteering(9601, 'unsaved words', { fromPerson: true, persist: true });
    queueRunSteering(9601, 'already saved', { fromPerson: true, saved: true });

    const [kept] = drainRunSteering(9601);
    expect(journal(9601)).toEqual([{ eventKey: kept!.eventKey, text: 'unsaved words' }]);
  });

  it('forgetting by key removes only those', () => {
    rememberPendingWords(9602, 'k1', 'one');
    rememberPendingWords(9602, 'k2', 'two');
    forgetPendingWords(9602, ['k1', undefined]);
    expect(journal(9602)).toEqual([{ eventKey: 'k2', text: 'two' }]);
  });

  it('skips empty words', () => {
    expect(rememberPendingWords(9605, 'k', '   ')).toBe(false);
    expect(journal(9605)).toEqual([]);
  });

  it('is the signed-in person\'s in this workspace: the key carries both, and another person finds nothing', async () => {
    rememberPendingWords(9606, 'k', 'mine');
    expect(localStorage.getItem('bf:pendingWords:1:u-me:9606')).toContain('mine');
    const sendMessages = vi.fn(async () => [] as never);
    leave(9606, [{ eventKey: 'steer:old', text: 'mine, from before' }]);

    setPendingWordsOwner({ tenant: 1, user: 'u-other' });

    await expect(replayPendingWords(9606, { sendMessages })).resolves.toBe(0);
    expect(sendMessages).not.toHaveBeenCalled();
  });

  it('has no journal with no owner (nobody is signed in): the words are still queued, only not on the device', () => {
    setPendingWordsOwner(null);
    queueRunSteering(9607, 'words', { fromPerson: true, persist: true });
    expect(drainRunSteering(9607).map((m) => m.text)).toEqual(['words']);
    expect(localStorage.length).toBe(0);
  });

  it('sign-out removes every owner\'s journal and the heartbeats', () => {
    rememberPendingWords(9608, 'k', 'mine');
    leave(9608, [{ eventKey: 'steer:theirs', text: 'theirs' }], { tenant: 2, user: 'u-else' });
    localStorage.setItem('bf:pendingBeat:an-earlier-load', String(Date.now()));
    localStorage.setItem('unrelated', 'kept');

    clearPendingWords();

    expect(Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i))).toEqual(['unrelated']);
    expect(rememberPendingWords(9608, 'k2', 'after sign-out')).toBe(false); // no owner any more
  });

  it('expires an entry after a week, and keeps at most 50 words per chat (the oldest go)', async () => {
    leave(9609, [{ eventKey: 'steer:stale', text: 'a week and a day old', at: Date.now() - 8 * DAY }]);
    const sendMessages = vi.fn(async () => [] as never);
    await replayPendingWords(9609, { sendMessages });
    expect(sendMessages).not.toHaveBeenCalled();
    expect(journal(9609)).toEqual([]);

    for (let i = 0; i < 55; i += 1) rememberPendingWords(9610, `k${i}`, `word ${i}`);
    const kept = journal(9610);
    expect(kept).toHaveLength(50);
    expect(kept[0]?.eventKey).toBe('k5');
    expect(kept.at(-1)?.eventKey).toBe('k54');
  });
});

describe('storage that refuses never costs a steer', () => {
  it('a write that throws: the words are still in the inbox, and the journal says it could not keep them', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError'); });

    queueRunSteering(9611, 'still sent', { fromPerson: true, persist: true });

    expect(drainRunSteering(9611).map((m) => m.text)).toEqual(['still sent']);
    expect(rememberPendingWords(9611, 'k', 'x')).toBe(false);
  });

  it('a profile whose storage cannot even be read has no journal and nothing throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('SecurityError'); });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('SecurityError'); });

    expect(rememberPendingWords(9612, 'k', 'x')).toBe(false);
    expect(() => forgetPendingWords(9612, ['k'])).not.toThrow();
    expect(() => clearPendingWords()).not.toThrow();
    await expect(replayPendingWords(9612, { sendMessages: vi.fn() as never })).resolves.toBe(0);
  });
});

describe('replayPendingWords - after a reload', () => {
  it('saves words an EARLIER page load left, under their keys, and clears them; this load\'s own words are left to its inbox', async () => {
    leave(9603, [{ eventKey: 'steer:old', text: 'left by the last session' }]);
    rememberPendingWords(9603, 'steer:mine', 'still in this load\'s inbox');
    const sendMessages = vi.fn(async () => [] as never);

    const saved = await replayPendingWords(9603, { sendMessages });

    expect(saved).toBe(1);
    expect(sendMessages).toHaveBeenCalledWith(9603, [{ role: 'user', content: 'left by the last session', eventKey: 'steer:old' }]);
    expect(journal(9603)).toEqual([{ eventKey: 'steer:mine', text: 'still in this load\'s inbox' }]);
  });

  it('does not answer another TAB\'s words: a page load that still holds its lock is alive', async () => {
    aliveSessions('the-other-tab');
    leave(9613, [{ eventKey: 'steer:theirs', text: 'typed in the other tab', session: 'the-other-tab' }]);
    const sendMessages = vi.fn(async () => [] as never);

    await expect(replayPendingWords(9613, { sendMessages })).resolves.toBe(0);

    expect(sendMessages).not.toHaveBeenCalled();
    expect(journal(9613)).toHaveLength(1);
  });

  it('without Web Locks, a load that still beats is alive and one that went quiet is dead', async () => {
    Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
    leave(9614, [
      { eventKey: 'steer:beating', text: 'alive', session: 'beating-load' },
      { eventKey: 'steer:quiet', text: 'dead', session: 'quiet-load' },
    ]);
    localStorage.setItem('bf:pendingBeat:beating-load', String(Date.now() - 2_000));
    localStorage.setItem('bf:pendingBeat:quiet-load', String(Date.now() - 60_000));
    const sendMessages = vi.fn(async () => [] as never);

    await replayPendingWords(9614, { sendMessages });

    expect(sendMessages.mock.calls.map((c) => (c as unknown as [number, Row[]])[1][0]?.content)).toEqual(['dead']);
  });

  it('gives a page load that has only just started the time to take its lock', async () => {
    leave(9615, [{ eventKey: 'steer:fresh', text: 'a moment ago', session: 'just-started', at: Date.now() - 500 }]);
    const sendMessages = vi.fn(async () => [] as never);
    await expect(replayPendingWords(9615, { sendMessages })).resolves.toBe(0);
    expect(sendMessages).not.toHaveBeenCalled();
  });

  it('words the model already read replay as the mid-turn rows they became - no second answer; unread words replay as a pending turn', async () => {
    leave(9616, [
      { eventKey: 'steer:read', text: 'the model read this' },
      { eventKey: 'steer:unread', text: 'nobody read this' },
    ]);
    markPendingWordsRead(9616, ['steer:read']);
    const sendMessages = vi.fn(async () => [] as never);

    await replayPendingWords(9616, { sendMessages });

    const rows = sendMessages.mock.calls.map((c) => (c as unknown as [number, Row[]])[1][0]!);
    expect(rows.map((r) => r.eventKey)).toEqual(['steer:read', 'steer:unread']);
    expect(isMidTurnMetadata(rows[0]!.metadata)).toBe(true);
    expect(rows[1]!.metadata).toBeUndefined();
  });

  it("a sub-agent's journaled words replay to its OWNER's chat (the root chat id), not to the child's own key", async () => {
    const child = 9640;
    getCell(child).lastRequest = { lineage: { rootChatId: 9600 } } as never;
    try {
      queueRunSteering(child, 'for the helper', { fromPerson: true, persist: true });
    } finally {
      cells.delete(child);
    }
    const [kept] = drainRunSteering(child);
    // The journal stays keyed by the run (a Stop and the drain find it there); the entry names where the words are saved.
    expect(JSON.parse(localStorage.getItem(keyOf(child))!)).toMatchObject([{ eventKey: kept!.eventKey, chatId: 9600 }]);

    const raw = JSON.parse(localStorage.getItem(keyOf(child))!) as Array<Record<string, unknown>>;
    localStorage.setItem(keyOf(child), JSON.stringify(raw.map((e) => ({ ...e, session: 'an-earlier-load', at: Date.now() - 60_000 }))));
    const sendMessages = vi.fn(async () => [] as never);

    await expect(replayPendingWords(child, { sendMessages })).resolves.toBe(1);

    expect(sendMessages.mock.calls.map((c) => (c as unknown as [number])[0])).toEqual([9600]);
    expect(journal(child)).toEqual([]);
  });

  it("a top-level run's words, and an entry written before the field existed, replay to the run's own chat", async () => {
    queueRunSteering(9641, 'top level', { fromPerson: true, persist: true });
    expect(JSON.parse(localStorage.getItem(keyOf(9641))!)).toMatchObject([{ chatId: 9641 }]);
    leave(9642, [{ eventKey: 'steer:old-shape', text: 'before the field' }]);
    const sendMessages = vi.fn(async () => [] as never);

    await replayPendingWords(9642, { sendMessages });

    expect(sendMessages.mock.calls.map((c) => (c as unknown as [number])[0])).toEqual([9642]);
  });

  it('sign-out (or an owner cleared) stops the heartbeat: nothing recreates the beat key afterwards (no Web Locks)', async () => {
    vi.resetModules(); // the heartbeat is per page load: a fresh module is a fresh load
    Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
    vi.useFakeTimers();
    const words = await import('./pendingWords');
    const beats = () => Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)!).filter((k) => k.startsWith('bf:pendingBeat:'));

    words.setPendingWordsOwner(ME);
    words.rememberPendingWords(9650, 'k1', 'mine');
    expect(beats()).toHaveLength(1);

    words.clearPendingWords();
    expect(beats()).toEqual([]);
    vi.advanceTimersByTime(60_000);
    expect(beats()).toEqual([]);

    // Signed in again, then the owner is cleared without a sign-out: the beat stops there too.
    words.setPendingWordsOwner(ME);
    words.rememberPendingWords(9650, 'k2', 'again');
    expect(beats()).toHaveLength(1);
    words.setPendingWordsOwner(null);
    for (const key of beats()) localStorage.removeItem(key);
    vi.advanceTimersByTime(60_000);
    expect(beats()).toEqual([]);
    words.setPendingWordsOwner(null);
  });

  it('a row the server already has comes back as the same row: the entry is forgotten, nothing doubles', async () => {
    leave(9617, [{ eventKey: 'steer:landed', text: 'it did land' }]);
    const sendMessages = vi.fn(async () => [{ id: 7, role: 'user', content: 'it did land' }] as never); // the original, answered again

    await expect(replayPendingWords(9617, { sendMessages })).resolves.toBe(1);

    expect(journal(9617)).toEqual([]);
  });

  it('a save that fails leaves the words for the next open - never lost, never throws - and the NEXT entry is still tried', async () => {
    leave(9604, [
      { eventKey: 'steer:first', text: 'offline when tried' },
      { eventKey: 'steer:second', text: 'goes through' },
    ]);
    const sendMessages = vi.fn(async (_chat: number, rows: Row[]) => {
      if (rows[0]!.eventKey === 'steer:first') throw new Error('offline');
      return [] as never;
    });

    await expect(replayPendingWords(9604, { sendMessages })).resolves.toBe(1);

    expect(journal(9604).map((e) => e.eventKey)).toEqual(['steer:first']);
  });

  it('a refusal retrying cannot change (the chat is gone) ends the entry; a lapsed login or a limit does not', async () => {
    leave(9618, [
      { eventKey: 'steer:gone', text: 'chat deleted' },
      { eventKey: 'steer:login', text: 'token expired' },
      { eventKey: 'steer:limit', text: 'rate limited' },
    ]);
    const refuse = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });
    const sendMessages = vi.fn(async (_chat: number, rows: Row[]) => {
      throw refuse({ 'steer:gone': 404, 'steer:login': 401, 'steer:limit': 429 }[rows[0]!.eventKey!]!);
    });

    await replayPendingWords(9618, { sendMessages });

    expect(journal(9618).map((e) => e.eventKey)).toEqual(['steer:login', 'steer:limit']);
  });

  it('is bounded: a save that never answers cannot hold the chat\'s load', async () => {
    vi.useFakeTimers();
    leave(9619, [{ eventKey: 'steer:hang', text: 'the network hangs' }, { eventKey: 'steer:next', text: 'still tried' }]);
    const sendMessages = vi.fn((_chat: number, _rows: Row[]) => new Promise<never>(() => undefined));

    const replay = replayPendingWords(9619, { sendMessages });
    await vi.advanceTimersByTimeAsync(30_000);

    await expect(replay).resolves.toBe(0);
    expect(journal(9619)).toHaveLength(2); // both left for the next open
  });

  it('is one replay per chat at a time: a second asker shares it', async () => {
    leave(9620, [{ eventKey: 'steer:once', text: 'once' }]);
    let finish!: () => void;
    const sendMessages = vi.fn(() => new Promise<never>((resolve) => { finish = () => resolve([] as never); }));

    const first = replayPendingWords(9620, { sendMessages });
    const second = replayPendingWords(9620, { sendMessages });
    await vi.waitFor(() => expect(sendMessages).toHaveBeenCalled());
    finish();

    await expect(Promise.all([first, second])).resolves.toEqual([1, 1]);
    expect(sendMessages).toHaveBeenCalledTimes(1);
  });
});

describe('the app starts', () => {
  it('replays EVERY chat this person left words in, not only the one that gets opened', async () => {
    leave(9621, [{ eventKey: 'steer:a', text: 'in chat A' }]);
    leave(9622, [{ eventKey: 'steer:b', text: 'in chat B' }]);
    leave(9623, [{ eventKey: 'steer:c', text: 'someone else\'s' }], { tenant: 1, user: 'u-other' });
    const sendMessages = vi.fn(async () => [] as never);

    await expect(replayAllPendingWords({ sendMessages })).resolves.toBe(2);

    expect(sendMessages.mock.calls.map((c) => (c as unknown as [number, Row[]])[0]).sort()).toEqual([9621, 9622]);
  });

  it('starts by itself when the provider is mounted and the person becomes known', async () => {
    setPendingWordsOwner(null);
    leave(9624, [{ eventKey: 'steer:d', text: 'left before the reload' }]);
    const sendMessages = vi.fn(async () => [] as never);
    registerPendingWordsReplay({ sendMessages });
    expect(sendMessages).not.toHaveBeenCalled(); // nobody signed in yet

    setPendingWordsOwner(ME);

    await vi.waitFor(() => expect(sendMessages).toHaveBeenCalledWith(9624, [{ role: 'user', content: 'left before the reload', eventKey: 'steer:d' }]));
  });
});
