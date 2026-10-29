import { beforeEach, describe, expect, it } from 'vitest';
import type { StreamChatResult } from '../streamChatCompletion';
import { queueRunSteering, drainRunSteering, resetRunSteering } from '../runSteering';
import type { ChatInputAttachment } from '../types';
import { continueOnSettle, MAX_CONTINUATIONS, type AttachmentPorts } from './continueChat';
import { resetBrainRunStore, isRunning, stopRun } from './runControl';
import { startRun } from './startRun';
import { wakeChat } from './wakeChat';
import type { BrainRunRequest } from './runTypes';

const answer = (text: string): StreamChatResult => ({ text, toolCalls: [], finishReason: 'stop', resolvedModel: 'fake-model' });
const ports: AttachmentPorts = { uploadUrl: (key) => `/uploads/${key}` };

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

/** Runs `fn` the first `times` calls only (a person steers once, not after every answer). */
const times = (count: number, fn: () => void) => { let left = count; return () => { if (left > 0) { left -= 1; fn(); } }; };

async function until(check: () => boolean, ms = 3_000): Promise<void> {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) await new Promise((r) => setTimeout(r, 10));
}

beforeEach(() => {
  resetBrainRunStore();
  resetRunSteering();
});

describe('direction a run never read (PRD 35 E10)', () => {
  it('becomes THAT chat\'s next turn, whichever chat is on screen - and the other chat is untouched', async () => {
    // The person steers after the run's final drain: the message is queued as the answer is saved.
    const c = chat(['First answer.', 'Second answer.'], times(1, () => queueRunSteering(9301, 'one more thing', { fromPerson: true, persist: true })));
    queueRunSteering(9302, 'for the other chat', { fromPerson: true });
    continueOnSettle(9301, ports);

    await startRun(9301, { resolvedSystemPrompt: 'sys', stream: c.stream, persistence: c.persistence, userTurn: 'first ask' });
    await until(() => c.asked.length >= 2 && !isRunning(9301));

    // It was saved as the chat's own next user turn, after the answer it missed...
    expect(c.saved.filter((m) => m.role === 'user').map((m) => m.content)).toEqual(['one more thing']);
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
    continueOnSettle(9304, ports);
    const run = startRun(9304, { resolvedSystemPrompt: 'sys', stream, persistence: c.persistence, userTurn: 'ask' });
    await until(() => isRunning(9304));
    queueRunSteering(9304, 'typed before the stop', { fromPerson: true });

    stopRun(9304);
    drainRunSteering(9304); // the composer's Stop drops the inbox with the run
    release();
    await run;

    expect(c.saved.filter((m) => m.role === 'user')).toEqual([]);
    expect(isRunning(9304)).toBe(false);
  });

  it('hands a chat words it did not get as its next turn, when it has a request to run with', async () => {
    const c = chat(['Done.', 'Handled it.']);
    continueOnSettle(9305, ports);
    await startRun(9305, { resolvedSystemPrompt: 'sys', stream: c.stream, persistence: c.persistence, userTurn: 'first' });

    expect(wakeChat(9305, 'a turn the screen lost', undefined)).toBe(true);
    await until(() => c.asked.length >= 2 && !isRunning(9305));

    expect(c.saved.filter((m) => m.role === 'user').map((m) => m.content)).toEqual(['a turn the screen lost']);
    expect(JSON.stringify(c.asked[1])).toContain('a turn the screen lost');
  });

  it('keeps the words when the chat never ran in this session - the caller puts them in its inbox', () => {
    expect(wakeChat(9399, 'nobody to run this', undefined)).toBe(false);
  });
});

describe('a turn that cannot be made the chat\'s next turn (M2)', () => {
  it('a wake whose row cannot be saved puts the words back in the inbox with their flags - no unhandled rejection', async () => {
    const c = chat(['Done.']);
    continueOnSettle(9306, ports);
    await startRun(9306, { resolvedSystemPrompt: 'sys', stream: c.stream, persistence: c.persistence, userTurn: 'first' });
    c.gate.failUserRows = true;

    expect(wakeChat(9306, 'must not be lost', undefined)).toBe(true);
    await until(() => !isRunning(9306));
    await new Promise((r) => setTimeout(r, 50));

    expect(c.asked).toHaveLength(1);
    expect(drainRunSteering(9306)).toMatchObject([{ text: 'must not be lost', fromPerson: true, persist: true }]);
  });

  it('leftovers whose row cannot be saved keep their ORIGINAL flags in the inbox', async () => {
    const c = chat(['Done.'], times(1, () => { c.gate.failUserRows = true; queueRunSteering(9307, 'unflagged', { fromPerson: true }); }));
    continueOnSettle(9307, ports);

    await startRun(9307, { resolvedSystemPrompt: 'sys', stream: c.stream, persistence: c.persistence, userTurn: 'first' });

    const [left] = drainRunSteering(9307);
    expect(left).toMatchObject({ text: 'unflagged', fromPerson: true });
    expect(left?.persist).toBeFalsy();
  });
});

describe('a run that starts while the words are being saved (M3)', () => {
  it('the words join THAT run\'s inbox (the row is saved once) instead of starting a second run', async () => {
    const c = chat(['Done.']);
    continueOnSettle(9308, ports);
    await startRun(9308, { resolvedSystemPrompt: 'sys', stream: c.stream, persistence: c.persistence, userTurn: 'first' });

    let releaseSave!: () => void;
    c.gate.holdUserRows = new Promise<void>((resolve) => { releaseSave = resolve; });
    let releaseRun!: () => void;
    const hold = new Promise<void>((resolve) => { releaseRun = resolve; });
    const other = chat(['Second run.']);
    const stream: BrainRunRequest['stream'] = async (opts, handlers) => { await hold; return other.stream(opts, handlers); };

    expect(wakeChat(9308, 'said just now', undefined)).toBe(true);
    const second = startRun(9308, { resolvedSystemPrompt: 'sys', stream, persistence: c.persistence, userTurn: 'typed meanwhile' });
    await until(() => isRunning(9308));
    releaseSave();
    await until(() => c.saved.some((m) => m.content === 'said just now'));
    await new Promise((r) => setTimeout(r, 20));

    // Saved once, now waiting in the running run's inbox: not persisted again, and no extra run.
    expect(c.saved.filter((m) => m.content === 'said just now')).toHaveLength(1);
    const [steer] = drainRunSteering(9308);
    expect(steer).toMatchObject({ text: 'said just now', fromPerson: true });
    expect(steer?.persist).toBeFalsy();
    releaseRun();
    await second;
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
    continueOnSettle(9309, readable);
    await startRun(9309, { resolvedSystemPrompt: 'sys', stream: c.stream, persistence: c.persistence, userTurn: 'first' });

    expect(wakeChat(9309, 'read this', [notes])).toBe(true);
    await until(() => c.asked.length >= 2 && !isRunning(9309));

    expect(c.saved.find((m) => m.role === 'user')?.content).toContain('[Attached: notes.txt](/uploads/n1)');
    expect(JSON.stringify(c.asked[1])).toContain('FILE BODY');
  });
});

describe('a chat that keeps receiving direction cannot continue forever', () => {
  it('stops continuing after MAX_CONTINUATIONS; the rest waits in the inbox for the person\'s next turn', async () => {
    const texts = Array.from({ length: MAX_CONTINUATIONS + 4 }, (_, i) => `Answer ${i}.`);
    // Every answer is followed by one more steer - a run that is always being spoken to.
    const c = chat(texts, () => queueRunSteering(9310, 'and another', { fromPerson: true }));
    continueOnSettle(9310, ports);

    await startRun(9310, { resolvedSystemPrompt: 'sys', stream: c.stream, persistence: c.persistence, userTurn: 'first' });
    await until(() => !isRunning(9310) && c.asked.length >= MAX_CONTINUATIONS + 1);
    await new Promise((r) => setTimeout(r, 100));

    // The first run plus at most MAX_CONTINUATIONS continuations - never more.
    expect(c.asked.length).toBe(MAX_CONTINUATIONS + 1);
    expect(drainRunSteering(9310).map((m) => m.text)).toEqual(['and another']);
    expect(isRunning(9310)).toBe(false);
  });
});
