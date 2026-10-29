import { beforeEach, describe, expect, it } from 'vitest';
import type { StreamChatResult } from '../streamChatCompletion';
import { queueRunSteering, drainRunSteering, hasRunInterrupt, resetRunSteering } from '../runSteering';
import type { ChatInputAttachment } from '../types';
import { continueOnSettle, MAX_CONTINUATIONS, releaseContinuation, type AttachmentPorts, type ContinueBinding } from './continueChat';
import { resetBrainRunStore, isRunning, stopRun } from './runControl';
import { getCell } from './runCells';
import { startRun } from './startRun';
import { wakeChat } from './wakeChat';
import type { BrainRunRequest } from './runTypes';

const answer = (text: string): StreamChatResult => ({ text, toolCalls: [], finishReason: 'stop', resolvedModel: 'fake-model' });
const ports: AttachmentPorts = { uploadUrl: (key) => `/uploads/${key}` };
const binding: ContinueBinding = { ports: () => ports };

type Saved = { chatId: number; role: string; content: string };

/** A chat whose persistence records every row, and whose model replays `texts`. */
function chat(texts: string[], onAssistantRow?: () => void) {
  const saved: Saved[] = [];
  const asked: Array<Parameters<BrainRunRequest['stream']>[0]['messages']> = [];
  const gate = { failUserRows: false, holdUserRows: null as Promise<void> | null };
  let n = 0;
  let id = 0;
  const stream: BrainRunRequest['stream'] = async (opts) => {
    asked.push(JSON.parse(JSON.stringify(opts.messages)));
    const text = texts[n];
    n += 1;
    if (text === undefined) throw new Error('script exhausted');
    return answer(text);
  };
  const persistence: BrainRunRequest['persistence'] = {
    sendMessages: async (chatId, rows) => {
      if (rows.some((r) => r.role === 'user')) {
        if (gate.holdUserRows) await gate.holdUserRows;
        if (gate.failUserRows) throw new Error('token expired');
      }
      for (const row of rows) {
        saved.push({ chatId, role: row.role, content: row.content });
        if (row.role === 'assistant') onAssistantRow?.();
      }
      return rows.map((row) => ({ id: (id += 1), chatId, createdAt: '', metadata: row.metadata ?? null, seq: id, ...row })) as never;
    },
  };
  return { saved, asked, stream, persistence, gate };
}

/** Runs `fn` the first `count` calls only (a person steers once, not after every answer). */
const times = (count: number, fn: () => void) => { let left = count; return () => { if (left > 0) { left -= 1; fn(); } }; };

async function until(check: () => boolean, ms = 3_000): Promise<void> {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) await new Promise((r) => setTimeout(r, 10));
}

const userRows = (c: { saved: Saved[] }) => c.saved.filter((m) => m.role === 'user').map((m) => m.content);

beforeEach(() => {
  resetBrainRunStore();
  resetRunSteering();
});

describe('direction a run never read (PRD 35 E10)', () => {
  it('becomes THAT chat\'s next turn, whichever chat is on screen - and the other chat is untouched', async () => {
    // The person steers after the run's final drain: the message is queued as the answer is saved.
    const c = chat(['First answer.', 'Second answer.'], times(1, () => queueRunSteering(9301, 'one more thing', { fromPerson: true, persist: true })));
    queueRunSteering(9302, 'for the other chat', { fromPerson: true });
    continueOnSettle(9301, binding);

    await startRun(9301, { resolvedSystemPrompt: 'sys', stream: c.stream, persistence: c.persistence, userTurn: 'first ask' });
    await until(() => c.asked.length >= 2 && !isRunning(9301));

    // It was saved as the chat's own next user turn, after the answer it missed...
    expect(userRows(c)).toEqual(['one more thing']);
    const order = c.saved.filter((m) => m.role === 'assistant' || m.content === 'one more thing').map((m) => m.content);
    expect(order[0]).toBe('First answer.');
    expect(order[1]).toBe('one more thing');
    // ...and run: the model's second call reads it, and the single owner drained it - nothing is offered twice.
    expect(JSON.stringify(c.asked[1])).toContain('one more thing');
    expect(drainRunSteering(9301)).toEqual([]);
    // The chat that was not running keeps its own inbox.
    expect(drainRunSteering(9302).map((m) => m.text)).toEqual(['for the other chat']);
  });

  it('a run that did not opt in leaves its inbox alone (the editor\'s host wakes its own)', async () => {
    const c = chat(['Only answer.'], () => queueRunSteering(9303, 'late', { fromPerson: true }));

    await startRun(9303, { resolvedSystemPrompt: 'sys', stream: c.stream, persistence: c.persistence, userTurn: 'ask' });

    expect(c.asked).toHaveLength(1);
    expect(drainRunSteering(9303).map((m) => m.text)).toEqual(['late']);
  });

  it('a Stop ends the work, waiting words included: a stopped run continues nothing', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const c = chat(['never finished']);
    const stream: BrainRunRequest['stream'] = async (opts, handlers) => {
      await held;
      return c.stream(opts, handlers);
    };
    continueOnSettle(9304, binding);
    const run = startRun(9304, { resolvedSystemPrompt: 'sys', stream, persistence: c.persistence, userTurn: 'ask' });
    await until(() => isRunning(9304));
    queueRunSteering(9304, 'typed before the stop', { fromPerson: true });

    stopRun(9304);
    drainRunSteering(9304); // the composer's Stop drops the inbox with the run
    release();
    await run;

    expect(userRows(c)).toEqual([]);
    expect(isRunning(9304)).toBe(false);
  });

  it('hands a chat words it did not get as its next turn, when it has a request to run with', async () => {
    const c = chat(['Done.', 'Handled it.']);
    continueOnSettle(9305, binding);
    await startRun(9305, { resolvedSystemPrompt: 'sys', stream: c.stream, persistence: c.persistence, userTurn: 'first' });

    expect(wakeChat(9305, 'a turn the screen lost', undefined)).toBe(true);
    await until(() => c.asked.length >= 2 && !isRunning(9305));

    expect(userRows(c)).toEqual(['a turn the screen lost']);
    expect(JSON.stringify(c.asked[1])).toContain('a turn the screen lost');
  });

  it('keeps the words when the chat never ran in this session - the caller puts them in its inbox', () => {
    expect(wakeChat(9399, 'nobody to run this', undefined)).toBe(false);
  });

  it('forgets its bindings on a store reset and when the conversation that bound them unmounts', async () => {
    const c = chat(['Done.', 'Done again.']);
    continueOnSettle(9313, binding);
    await startRun(9313, { resolvedSystemPrompt: 'sys', stream: c.stream, persistence: c.persistence, userTurn: 'first' });
    releaseContinuation(9313);
    expect(wakeChat(9313, 'nobody composes this', undefined)).toBe(false);

    // A binding made before a store reset is gone after it: a chat that runs again unbound cannot be woken.
    continueOnSettle(9313, binding);
    resetBrainRunStore();
    const again = chat(['Ran again.']);
    await startRun(9313, { resolvedSystemPrompt: 'sys', stream: again.stream, persistence: again.persistence, userTurn: 'again' });
    expect(getCell(9313).lastRequest).not.toBeNull();
    expect(wakeChat(9313, 'the store was reset', undefined)).toBe(false);
  });
});

describe('a turn that cannot be made the chat\'s next turn (M2)', () => {
  it('a wake whose row cannot be saved puts the words back in the inbox with their flags - no unhandled rejection', async () => {
    const c = chat(['Done.']);
    continueOnSettle(9306, binding);
    await startRun(9306, { resolvedSystemPrompt: 'sys', stream: c.stream, persistence: c.persistence, userTurn: 'first' });
    c.gate.failUserRows = true;

    expect(wakeChat(9306, 'must not be lost', undefined)).toBe(true);
    await new Promise((r) => setTimeout(r, 50));

    expect(c.asked).toHaveLength(1);
    expect(drainRunSteering(9306)).toMatchObject([{ text: 'must not be lost', fromPerson: true, persist: true }]);
  });

  it('leftovers whose row cannot be saved keep their ORIGINAL flags in the inbox', async () => {
    const c = chat(['Done.'], times(1, () => { c.gate.failUserRows = true; queueRunSteering(9307, 'unflagged', { fromPerson: true, persist: true }); }));
    continueOnSettle(9307, binding);

    await startRun(9307, { resolvedSystemPrompt: 'sys', stream: c.stream, persistence: c.persistence, userTurn: 'first' });

    expect(drainRunSteering(9307)).toMatchObject([{ text: 'unflagged', fromPerson: true, persist: true }]);
  });
});

describe('words whose row is already saved are never saved twice (MUST-FIX 2)', () => {
  it('leftover direction queued WITHOUT persist (said, saved) starts the next turn but adds no user row', async () => {
    const c = chat(['First.', 'Second.'], times(1, () => queueRunSteering(9314, 'said already', { fromPerson: true })));
    continueOnSettle(9314, binding);

    await startRun(9314, { resolvedSystemPrompt: 'sys', stream: c.stream, persistence: c.persistence, userTurn: 'first' });
    await until(() => c.asked.length >= 2 && !isRunning(9314));

    expect(userRows(c)).toEqual([]);
    expect(JSON.stringify(c.asked[1])).toContain('said already');
  });

  it('a mix saves only the words that have no row yet, and the run reads all of them', async () => {
    const c = chat(['First.', 'Second.'], times(1, () => {
      queueRunSteering(9315, 'had a row', { fromPerson: true });
      queueRunSteering(9315, 'needs a row', { fromPerson: true, persist: true });
    }));
    continueOnSettle(9315, binding);

    await startRun(9315, { resolvedSystemPrompt: 'sys', stream: c.stream, persistence: c.persistence, userTurn: 'first' });
    await until(() => c.asked.length >= 2 && !isRunning(9315));

    expect(userRows(c)).toEqual(['needs a row']);
    expect(JSON.stringify(c.asked[1])).toContain('had a row');
    expect(JSON.stringify(c.asked[1])).toContain('needs a row');
  });
});

describe('a run that starts while the words are being saved (M3)', () => {
  it('the words join THAT run\'s inbox as what the model reads, interrupting, and are not saved again', async () => {
    const c = chat(['Done.']);
    const notes: ChatInputAttachment = { key: 'n1', name: 'notes.txt', type: 'text/plain' };
    continueOnSettle(9308, { ports: () => ({ uploadUrl: (key) => `/uploads/${key}`, inlineAttachments: async () => ({ text: 'FILE BODY', keys: ['n1'] }) }) });
    await startRun(9308, { resolvedSystemPrompt: 'sys', stream: c.stream, persistence: c.persistence, userTurn: 'first' });

    let releaseSave!: () => void;
    c.gate.holdUserRows = new Promise<void>((resolve) => { releaseSave = resolve; });
    let releaseRun!: () => void;
    const hold = new Promise<void>((resolve) => { releaseRun = resolve; });
    const other = chat(['Second run.']);
    const stream: BrainRunRequest['stream'] = async (opts, handlers) => { await hold; return other.stream(opts, handlers); };

    expect(wakeChat(9308, 'said just now', [notes])).toBe(true);
    const second = startRun(9308, { resolvedSystemPrompt: 'sys', stream, persistence: c.persistence, userTurn: 'typed meanwhile' });
    await until(() => isRunning(9308));
    releaseSave();
    await until(() => c.saved.some((m) => m.content.startsWith('said just now')));
    await new Promise((r) => setTimeout(r, 20));

    // Saved once; the running run's inbox holds the COMPOSED content (the inlined file, not just the raw
    // text), interrupting, and not persisted again - and no extra run was started.
    expect(userRows(c)).toHaveLength(1);
    expect(hasRunInterrupt(9308)).toBe(true);
    const [steer] = drainRunSteering(9308);
    expect(steer?.text).toContain('said just now');
    expect(steer?.text).toContain('FILE BODY');
    expect(steer).toMatchObject({ fromPerson: true });
    expect(steer?.persist).toBeFalsy();
    expect(steer?.attachments ?? []).toEqual([]);
    releaseRun();
    await second;
  });
});

describe('a Stop that lands while words are becoming the next turn (MUST-FIX 3)', () => {
  it('on an IDLE chat: the row is kept and nothing starts', async () => {
    const c = chat(['Done.', 'must never run']);
    continueOnSettle(9316, binding);
    await startRun(9316, { resolvedSystemPrompt: 'sys', stream: c.stream, persistence: c.persistence, userTurn: 'first' });

    let releaseSave!: () => void;
    c.gate.holdUserRows = new Promise<void>((resolve) => { releaseSave = resolve; });
    expect(wakeChat(9316, 'said, then stopped', undefined)).toBe(true);
    stopRun(9316); // nothing is running: the Stop must still be remembered
    releaseSave();
    await new Promise((r) => setTimeout(r, 60));

    expect(userRows(c)).toEqual(['said, then stopped']);
    expect(c.asked).toHaveLength(1);
    expect(isRunning(9316)).toBe(false);
    expect(drainRunSteering(9316)).toEqual([]);
  });

  it('counts a Stop on an idle cell', () => {
    const cell = getCell(9317);
    stopRun(9317);
    expect(cell.stopEpoch).toBe(1);
  });
});

describe('the continuation prepares its run again (stale run-time parts)', () => {
  it('asks the host for fresh parts: the second run uses them, not the last run\'s', async () => {
    const c = chat(['Done.', 'Handled it.']);
    continueOnSettle(9318, { ports: () => ports, prepareRun: async () => ({ resolvedSystemPrompt: 'FRESH PROMPT' }) });
    await startRun(9318, { resolvedSystemPrompt: 'OLD PROMPT', stream: c.stream, persistence: c.persistence, userTurn: 'first' });

    expect(wakeChat(9318, 'again', undefined)).toBe(true);
    await until(() => c.asked.length >= 2 && !isRunning(9318));

    expect(JSON.stringify(c.asked[0])).toContain('OLD PROMPT');
    expect(JSON.stringify(c.asked[1])).toContain('FRESH PROMPT');
    expect(JSON.stringify(c.asked[1])).not.toContain('OLD PROMPT');
  });

  it('a host that refuses leaves the (saved) words waiting in the inbox, said on the trace - no run', async () => {
    const c = chat(['Done.', 'must never run']);
    continueOnSettle(9319, { ports: () => ports, prepareRun: async () => { throw new Error('no tab'); } });
    await startRun(9319, { resolvedSystemPrompt: 'sys', stream: c.stream, persistence: c.persistence, userTurn: 'first' });

    expect(wakeChat(9319, 'try anyway', undefined)).toBe(true);
    await new Promise((r) => setTimeout(r, 60));

    expect(c.asked).toHaveLength(1);
    expect(userRows(c)).toEqual(['try anyway']);
    const [kept] = drainRunSteering(9319);
    expect(kept?.text).toContain('try anyway');
    expect(kept?.persist).toBeFalsy();
    expect(getCell(9319).trace.some((e) => e.label === 'steer.prepare_failed')).toBe(true);
  });
});

describe('a file steered into a run the run never read (M4)', () => {
  it('becomes the next turn the way a typed send composes it: a link on the row, the readable text for the model', async () => {
    const c = chat(['Done.', 'Read it.']);
    const readable: AttachmentPorts = {
      uploadUrl: (key) => `/uploads/${key}`,
      inlineAttachments: async () => ({ text: 'FILE BODY', keys: ['n1'] }),
    };
    const notes: ChatInputAttachment = { key: 'n1', name: 'notes.txt', type: 'text/plain' };
    continueOnSettle(9309, { ports: () => readable });
    await startRun(9309, { resolvedSystemPrompt: 'sys', stream: c.stream, persistence: c.persistence, userTurn: 'first' });

    expect(wakeChat(9309, 'read this', [notes])).toBe(true);
    await until(() => c.asked.length >= 2 && !isRunning(9309));

    expect(c.saved.find((m) => m.role === 'user')?.content).toContain('[Attached: notes.txt](/uploads/n1)');
    expect(JSON.stringify(c.asked[1])).toContain('FILE BODY');
  });
});

describe('a chat that keeps receiving direction cannot continue forever', () => {
  it('stops continuing after MAX_CONTINUATIONS, says so on the trace; the rest waits in the inbox', async () => {
    const texts = Array.from({ length: MAX_CONTINUATIONS + 4 }, (_, i) => `Answer ${i}.`);
    // Every answer is followed by one more steer - a run that is always being spoken to.
    const c = chat(texts, () => queueRunSteering(9310, 'and another', { fromPerson: true, persist: true }));
    continueOnSettle(9310, binding);

    await startRun(9310, { resolvedSystemPrompt: 'sys', stream: c.stream, persistence: c.persistence, userTurn: 'first' });
    await until(() => !isRunning(9310) && c.asked.length >= MAX_CONTINUATIONS + 1);
    await new Promise((r) => setTimeout(r, 100));

    // The first run plus at most MAX_CONTINUATIONS continuations - never more.
    expect(c.asked.length).toBe(MAX_CONTINUATIONS + 1);
    expect(drainRunSteering(9310).map((m) => m.text)).toEqual(['and another']);
    expect(getCell(9310).trace.some((e) => e.label === 'steer.continue_limit')).toBe(true);
    expect(isRunning(9310)).toBe(false);
  });
});
