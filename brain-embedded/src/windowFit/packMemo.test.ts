import { describe, expect, it } from 'vitest';
import { volatileTail } from '@seanhogg/builderforce-memory/handoff';
import type { BrainTraceEvent } from '../brainTriage';
import type { ChatCompletionMessage } from '../streamChatCompletion';
import { windowFitTranscript as transcript } from '../test/windowFitTranscript';
import { createHandoffFit, HANDOFF_FIT_MEMOS } from './packForModel';
import { packMemoOf, reusePack } from './packMemo';
import { createRunWindowFit } from './runWindowFit';

// WS-C: a pinned small-window model is packed ONCE and the pack reused — new turns
// appended after the packed prefix — until the transcript overflows the window.

const SMALL = 'direct/cloudflare/@cf/small-4k';
const tail = (n: number) => volatileTail([`budget: ${n}%`])! as ChatCompletionMessage;

describe('reusePack (pure)', () => {
  const history: ChatCompletionMessage[] = [
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'task' },
    { role: 'assistant', content: 'a1' },
  ];
  const packed: ChatCompletionMessage[] = [{ role: 'system', content: 'sys' }, { role: 'user', content: 'note' }, history[2]!];
  const memo = packMemoOf([...history, tail(10)], [...packed, tail(10)]);

  it('appends the new turns and the NEW volatile tail after the packed prefix', () => {
    const next: ChatCompletionMessage = { role: 'user', content: 'more' };
    expect(reusePack(memo, [...history, next, tail(20)], 10_000)).toEqual([...packed, next, tail(20)]);
  });

  it('matches a rebuilt system prompt by value, not by object identity', () => {
    const rebuilt = [{ role: 'system' as const, content: 'sys' }, ...history.slice(1)];
    expect(reusePack(memo, rebuilt, 10_000)).toEqual(packed);
  });

  it('re-packs when the history no longer opens with the memo, or the result overflows', () => {
    expect(reusePack(memo, [history[0]!, { role: 'user', content: 'other' }, history[2]!], 10_000)).toBeNull();
    expect(reusePack(memo, history.slice(0, 2), 10_000)).toBeNull();
    expect(reusePack(memo, [...history, { role: 'user', content: 'x'.repeat(40_000) }], 1_000)).toBeNull();
  });
});

describe('createHandoffFit — the local-first fit memoises its pack too', () => {
  it('packs once per (model, window) while the conversation still fits', async () => {
    let packCount = 0;
    const fit = createHandoffFit({ onTrace: () => { packCount += 1; } });
    const target = { ref: 'local/webllm/Qwen3-1.7B-q4f16_1-MLC', contextTokens: 4_096, maxTokens: 512 };
    const msgs = transcript();
    const first = await fit(msgs, target);
    const second = await fit([...msgs], target);
    expect(packCount).toBe(1);
    expect(second).toEqual(first);
  });

  it('keeps one pack per conversation: two chats on one local model never evict each other', async () => {
    let packCount = 0;
    const fit = createHandoffFit({ onTrace: () => { packCount += 1; } });
    const target = { ref: 'local/webllm/Qwen3-1.7B-q4f16_1-MLC', contextTokens: 4_096, maxTokens: 512 };
    const a = transcript();
    // Chat 2's history is not a prefix of chat 1's: a shared memo could never serve both.
    const b = [...a, { role: 'user' as const, content: 'another chat entirely' }];
    await fit(a, { ...target, conversation: 1 });
    await fit(b, { ...target, conversation: 2 });
    expect(packCount).toBe(2);
    // Each chat's next call reuses ITS pack — alternating chats no longer re-pack every call.
    await fit([...a], { ...target, conversation: 1 });
    await fit([...b], { ...target, conversation: 2 });
    expect(packCount).toBe(2);
  });

  it('remembers a bounded number of conversations, least recently used out first', async () => {
    let packCount = 0;
    const fit = createHandoffFit({ onTrace: () => { packCount += 1; } });
    const target = { ref: 'local/webllm/Qwen3-1.7B-q4f16_1-MLC', contextTokens: 4_096, maxTokens: 512 };
    const msgs = transcript();
    for (let chat = 0; chat <= HANDOFF_FIT_MEMOS; chat++) await fit([...msgs], { ...target, conversation: chat });
    expect(packCount).toBe(HANDOFF_FIT_MEMOS + 1);
    // Chat 0 was the least recently used: its pack is gone; the newest is kept.
    await fit([...msgs], { ...target, conversation: HANDOFF_FIT_MEMOS });
    expect(packCount).toBe(HANDOFF_FIT_MEMOS + 1);
    await fit([...msgs], { ...target, conversation: 0 });
    expect(packCount).toBe(HANDOFF_FIT_MEMOS + 2);
  });
});

describe('createRunWindowFit — the pack is memoised per run', () => {
  const packs = (trace: BrainTraceEvent[]) => trace.filter((e) => e.label === 'llm.handoff').length;

  it('packs once for a pinned small model, reuses it, and re-packs only on overflow', async () => {
    const trace: BrainTraceEvent[] = [];
    const gate = createRunWindowFit({
      workingBudgetTokens: 64_000,
      windowSources: { cloud: (ref) => (ref === SMALL ? 4_096 : undefined) },
      trace: (e) => trace.push(e),
      now: () => 't',
    });
    gate.served(SMALL);
    const msgs = transcript();
    const first = await gate.prepare({ messages: [...msgs, tail(10)], model: SMALL, maxTokens: 512, step: 1 });
    expect(packs(trace)).toBe(1);
    expect(first.length).toBeLessThan(msgs.length);

    // Next turn, same history, a different per-turn tail: the same pack, the new tail last.
    const second = await gate.prepare({ messages: [...msgs, tail(20)], model: SMALL, maxTokens: 512, step: 2 });
    expect(packs(trace)).toBe(1);
    expect(second.slice(0, -1)).toEqual(first.slice(0, -1));
    expect(second.at(-1)).toEqual(tail(20));

    // The transcript outgrows the window: re-packed.
    const grown = [...msgs, { role: 'user' as const, content: 'Y'.repeat(6_000) }];
    await gate.prepare({ messages: grown, model: SMALL, maxTokens: 512, step: 3 });
    expect(packs(trace)).toBe(2);
  });
});
