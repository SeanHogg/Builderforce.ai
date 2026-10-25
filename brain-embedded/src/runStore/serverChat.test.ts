/**
 * PRD 36 §36.1 — a local chat's view key never leaves the machine. A host with a local
 * store names the SERVER chat a run is bound to (`serverChatId`), or none; the run's
 * gateway metadata, prompt-cache key and system prompt then carry that id or no id at
 * all — never the local number, which named (and billed) whichever server chat shared it.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { resetBrainRunStore, startRun, type BrainStreamFn } from '../brainRunStore';

beforeEach(resetBrainRunStore);

/** A local view key a server chat could easily share. */
const LOCAL = 5;

function capture() {
  const calls: Array<Parameters<BrainStreamFn>[0]> = [];
  const stream: BrainStreamFn = async (opts) => {
    calls.push(opts);
    return { text: 'Done.', toolCalls: [], finishReason: 'stop' };
  };
  const persistence = {
    sendMessages: async (_chatId: number, msgs: Array<{ role: string; content: string; metadata?: string }>) =>
      msgs.map((m, i) => ({ id: 900 + i, seq: i + 1, createdAt: '', metadata: m.metadata ?? null, role: m.role, content: m.content })),
  };
  return { calls, stream, persistence };
}

/** Everything a request would put on the wire that could name a chat. */
const wireOf = (opts: Parameters<BrainStreamFn>[0]): string =>
  JSON.stringify({ metadata: opts.metadata, prompt_cache_key: opts.prompt_cache_key, messages: opts.messages });

const namesChat = (wire: string, id: number): boolean =>
  new RegExp(`chatId=${id}\\b`).test(wire) || wire.includes(`chat #${id}`) || wire.includes(`"chatId":${id},`) || wire.includes(`"chatId":${id}}`);

describe('PRD 36 — a local chat id never leaves the machine', () => {
  it('an unbound local chat sends no chat id: not in the metadata, the cache key, or the prompt', async () => {
    const { calls, stream, persistence } = capture();
    await startRun(LOCAL, {
      resolvedSystemPrompt: 'sys', stream, persistence, userTurn: 'fix the bug',
      serverChatId: null, clientChatId: 'client-uuid', chatMode: 'work',
    });
    expect(calls.length).toBeGreaterThan(0);
    for (const opts of calls) {
      expect(opts.metadata?.chatId).toBeUndefined();
      expect(opts.metadata?.clientChatId).toBe('client-uuid');
      expect(opts.prompt_cache_key).toBe('brain:client-uuid');
      expect(namesChat(wireOf(opts), LOCAL)).toBe(false);
    }
  });

  it('a bound chat names its server chat — and only its server chat', async () => {
    const { calls, stream, persistence } = capture();
    await startRun(LOCAL, {
      resolvedSystemPrompt: 'sys', stream, persistence, userTurn: 'fix the bug',
      serverChatId: 4242, clientChatId: 'client-uuid', chatMode: 'work',
    });
    expect(calls.length).toBeGreaterThan(0);
    for (const opts of calls) {
      expect(opts.metadata?.chatId).toBe(4242);
      expect(opts.prompt_cache_key).toBe('brain:4242');
      const wire = wireOf(opts);
      expect(wire).toContain('chatId=4242');
      expect(namesChat(wire, LOCAL)).toBe(false);
    }
  });

  it('a host that names no server chat keeps its own id — its chats are server chats', async () => {
    const { calls, stream, persistence } = capture();
    await startRun(77, { resolvedSystemPrompt: 'sys', stream, persistence, userTurn: 'hi', chatMode: 'work' });
    expect(calls[0]?.metadata?.chatId).toBe(77);
    expect(calls[0]?.prompt_cache_key).toBe('brain:77');
  });
});
