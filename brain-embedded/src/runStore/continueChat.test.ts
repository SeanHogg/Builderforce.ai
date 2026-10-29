import { beforeEach, describe, expect, it } from 'vitest';
import type { StreamChatResult } from '../streamChatCompletion';
import { queueRunSteering, drainRunSteering, resetRunSteering } from '../runSteering';
import { continueOnSettle } from './continueChat';
import { resetBrainRunStore, isRunning, stopRun } from './runControl';
import { startRun } from './startRun';
import { wakeChat } from './wakeChat';
import type { BrainRunRequest } from './runTypes';

const answer = (text: string): StreamChatResult => ({ text, toolCalls: [], finishReason: 'stop', resolvedModel: 'fake-model' });

type Saved = { chatId: number; role: string; content: string };

/** A chat whose persistence records every row, and whose model replays `texts`. */
function chat(texts: string[], onAssistantRow?: () => void) {
  const saved: Saved[] = [];
  const asked: Array<Parameters<BrainRunRequest['stream']>[0]['messages']> = [];
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
      for (const row of rows) {
        saved.push({ chatId, role: row.role, content: row.content });
        if (row.role === 'assistant') onAssistantRow?.();
      }
      return rows.map((row) => ({ id: (id += 1), chatId, createdAt: '', metadata: row.metadata ?? null, seq: id, ...row })) as never;
    },
  };
  return { saved, asked, stream, persistence };
}

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
    const c = chat(['First answer.', 'Second answer.'], () => queueRunSteering(9301, 'one more thing', { fromPerson: true, persist: true }));
    queueRunSteering(9302, 'for the other chat', { fromPerson: true });
    continueOnSettle(9301);

    await startRun(9301, { resolvedSystemPrompt: 'sys', stream: c.stream, persistence: c.persistence, userTurn: 'first ask' });
    await until(() => c.asked.length >= 2 && !isRunning(9301));

    // It was saved as the chat's own next user turn, after the answer it missed...
    expect(c.saved.filter((m) => m.role === 'user').map((m) => m.content)).toEqual(['one more thing']);
    const order = c.saved.filter((m) => m.role === 'assistant' || m.content === 'one more thing').map((m) => m.content);
    expect(order[0]).toBe('First answer.');
    expect(order[1]).toBe('one more thing');
    // ...and run: the model's second call reads it.
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
    continueOnSettle(9304);
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
