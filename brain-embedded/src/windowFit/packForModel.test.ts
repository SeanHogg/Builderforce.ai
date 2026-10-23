import { describe, expect, it, vi } from 'vitest';
import type { EvermindRecallResult } from '@seanhogg/builderforce-memory/evermind';
import { defaultEstimateTokens, tokensOf } from '@seanhogg/builderforce-memory/handoff';
import type { ChatCompletionMessage } from '../streamChatCompletion';
import { seededRecall as seeded, windowFitTranscript as transcript } from '../test/windowFitTranscript';
import { createHandoffFit, packForModel, type WindowFitTrace } from './packForModel';

const tokens = (msgs: ChatCompletionMessage[]): number => tokensOf(msgs, defaultEstimateTokens);

/** Every `tool` row is announced by an earlier assistant `tool_calls` id. */
function pairingValid(msgs: ChatCompletionMessage[]): boolean {
  const announced = new Set<string>();
  for (const m of msgs) {
    for (const tc of m.tool_calls ?? []) announced.add(tc.id);
    if (m.role === 'tool' && !announced.has(String(m.tool_call_id))) return false;
  }
  return true;
}

describe('packForModel', () => {
  it('summary path: the dropped middle becomes the run summarizer’s note, inside the window', async () => {
    const stream = vi.fn(async () => ({ text: 'read files a.ts..j.ts; filter bar at TaskBoard.tsx:42' }));
    const traces: WindowFitTrace[] = [];
    const msgs = transcript();
    const { messages, pack } = await packForModel({
      messages: msgs,
      from: 'anthropic/claude-sonnet',
      to: 'local/webllm/Qwen3-1.7B-q4f16_1-MLC',
      contextTokens: 4_096,
      maxTokens: 512,
      summarizer: { stream, model: 'anthropic/claude-sonnet' },
      onTrace: (t) => traces.push(t),
    });
    expect(stream).toHaveBeenCalledOnce();
    expect(pack.summarized).toBe(true);
    expect(pack.fits).toBe(true);
    expect(pack.dropped).toBeGreaterThan(0);
    expect(tokens(messages)).toBeLessThanOrEqual(4_096 - 512);
    expect(messages[0]).toBe(msgs[0]);
    expect(messages).toContain(msgs[msgs.length - 1]);
    const note = messages.find((m) => typeof m.content === 'string' && m.content.includes('TaskBoard.tsx:42'));
    expect(note?.role).toBe('assistant');
    expect(note?.content).toContain('Handed off from anthropic/claude-sonnet to local/webllm/Qwen3-1.7B-q4f16_1-MLC.');
    expect(pairingValid(messages)).toBe(true);
    expect(traces).toEqual([
      {
        from: 'anthropic/claude-sonnet',
        to: 'local/webllm/Qwen3-1.7B-q4f16_1-MLC',
        dropped: pack.dropped,
        summarized: true,
        recalled: false,
        estimatedTokens: pack.estimatedTokens,
        fits: true,
      },
    ]);
  });

  it('recall path: a failing summarizer falls through to the Evermind memory block for the latest directive', async () => {
    const stream = vi.fn(async () => {
      throw new Error('summarizer down');
    });
    const recall = vi.fn(async (_query: string) => seeded('the chip row lives in FilterBar.tsx'));
    const { messages, pack } = await packForModel({
      messages: transcript(),
      to: 'local/bfi/bonsai-1.7b-q1_0',
      contextTokens: 4_096,
      maxTokens: 512,
      summarizer: { stream },
      recall,
    });
    expect(recall).toHaveBeenCalledWith('Now wire the chip row.');
    expect(pack.summarized).toBe(false);
    expect(pack.recalled).toBe(true);
    expect(messages.some((m) => typeof m.content === 'string' && m.content.includes('[Evermind Memory') && m.content.includes('FilterBar.tsx'))).toBe(true);
  });

  it('an unseeded recall and no summarizer leave the elision marker', async () => {
    const recall = vi.fn(async (_query: string): Promise<EvermindRecallResult> => ({ seeded: false, version: 0, mode: 'connected', items: [] }));
    const { messages, pack } = await packForModel({ messages: transcript(), to: 'local/x/y', contextTokens: 4_096, maxTokens: 512, recall });
    expect(pack.recalled).toBe(false);
    expect(messages.some((m) => typeof m.content === 'string' && /earlier messages omitted/.test(m.content))).toBe(true);
  });

  it('counts the advertised tool schemas against the window', async () => {
    const tools = [{ type: 'function', function: { name: 'edit_file', description: 'd'.repeat(4_000), parameters: {} } }];
    const without = await packForModel({ messages: transcript(), to: 'm', contextTokens: 6_000, maxTokens: 500 });
    const withTools = await packForModel({ messages: transcript(), to: 'm', contextTokens: 6_000, maxTokens: 500, tools });
    expect(withTools.pack.dropped).toBeGreaterThan(without.pack.dropped);
  });
});

describe('createHandoffFit', () => {
  it('packs for a known window and passes through an unknown one', async () => {
    const fit = createHandoffFit();
    const msgs = transcript();
    expect(await fit(msgs, { ref: 'local/ollama/unknown' })).toBe(msgs);
    const packed = await fit(msgs, { ref: 'local/webllm/Qwen3-1.7B-q4f16_1-MLC', contextTokens: 4_096, maxTokens: 512 });
    expect(packed.length).toBeLessThan(msgs.length);
  });
});

describe('packForModel — long-context price tier (cost PRD C9)', () => {
  // ~130K input tokens: inside a 1M window, past claude-haiku-5-5's 100K price boundary.
  const long = (): ChatCompletionMessage[] => [
    { role: 'user', content: 'Add the avatar filter.' },
    ...Array.from({ length: 26 }, (): ChatCompletionMessage => ({ role: 'assistant', content: 'X'.repeat(20_000) })),
    { role: 'user', content: 'Now wire it into the board.' },
  ];

  it('packs a tiered model under its lowest price boundary instead of filling the window', async () => {
    const { pack } = await packForModel({ messages: long(), to: 'anthropic/claude-haiku-5-5', contextTokens: 1_000_000, timeoutMs: 50 });
    expect(pack.dropped).toBeGreaterThan(0);
    expect(pack.estimatedTokens).toBeLessThanOrEqual(100_000);
  });

  it('fills the window as before for a flat-priced model', async () => {
    const { pack } = await packForModel({ messages: long(), to: 'local/webllm/Qwen3-1.7B-q4f16_1-MLC', contextTokens: 1_000_000, timeoutMs: 50 });
    expect(pack.dropped).toBe(0);
  });
});
