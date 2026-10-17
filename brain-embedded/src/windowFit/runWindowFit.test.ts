import { describe, expect, it, vi } from 'vitest';
import type { BrainTraceEvent } from '../brainTriage';
import { gatewayModelWindows } from '../gatewayModels';
import { seededRecall as seeded, windowFitTranscript as transcript } from '../test/windowFitTranscript';
import { createRunWindowFit, type RunWindowFitDeps } from './runWindowFit';

describe('createRunWindowFit (the run loop gate)', () => {
  const deps = (trace: BrainTraceEvent[], extra: Partial<RunWindowFitDeps> = {}): RunWindowFitDeps => ({
    workingBudgetTokens: 64_000,
    trace: (e: BrainTraceEvent) => trace.push(e),
    now: () => 't',
    ...extra,
  });

  it('leaves an auto-routed or unknown-window request alone', async () => {
    const trace: BrainTraceEvent[] = [];
    const gate = createRunWindowFit(deps(trace));
    const msgs = transcript();
    gate.served('anthropic/claude-sonnet');
    expect(await gate.prepare({ messages: msgs, step: 1 })).toBe(msgs);
    expect(await gate.prepare({ messages: msgs, model: 'openai/gpt-5', step: 1 })).toBe(msgs);
    expect(trace).toEqual([]);
  });

  it('packs for a smaller local window and records llm.handoff with from → to', async () => {
    const trace: BrainTraceEvent[] = [];
    const gate = createRunWindowFit(deps(trace));
    gate.served('anthropic/claude-sonnet');
    const msgs = transcript();
    const out = await gate.prepare({ messages: msgs, model: 'local/webllm/Qwen3-1.7B-q4f16_1-MLC', maxTokens: 512, step: 4 });
    expect(out.length).toBeLessThan(msgs.length);
    expect(trace).toHaveLength(1);
    expect(trace[0]).toMatchObject({
      category: 'message',
      label: 'llm.handoff',
      args: { step: 4, from: 'anthropic/claude-sonnet', to: 'local/webllm/Qwen3-1.7B-q4f16_1-MLC', fits: true },
    });
  });

  it('packs a stall failover onto a smaller CLOUD model the gateway catalog knows', async () => {
    const trace: BrainTraceEvent[] = [];
    // The surface's connected-account rows carry the vendor catalog window (`/llm/v1/models`).
    const cloud = gatewayModelWindows({ byo: { models: [{ id: 'direct/cloudflare/@cf/meta/llama-3.3-70b', contextWindow: 4_096 }, { id: 'direct/anthropic/claude-opus' }] } });
    const gate = createRunWindowFit(deps(trace, { windowSources: { cloud } }));
    gate.served('direct/anthropic/claude-opus');
    const msgs = transcript();
    const out = await gate.prepare({ messages: msgs, model: 'direct/cloudflare/@cf/meta/llama-3.3-70b', maxTokens: 512, step: 7 });
    expect(out.length).toBeLessThan(msgs.length);
    expect(trace[0]).toMatchObject({
      label: 'llm.handoff',
      args: { step: 7, from: 'direct/anthropic/claude-opus', to: 'direct/cloudflare/@cf/meta/llama-3.3-70b' },
    });
    // A cloud model the catalog has no window for keeps the run's budget.
    expect(await gate.prepare({ messages: msgs, model: 'direct/anthropic/claude-opus', step: 8 })).toBe(msgs);
  });

  it('reads live probes only for a local target, and falls back to the catalog when they fail', async () => {
    const probes = vi.fn(async () => {
      throw new Error('runtime down');
    });
    const trace: BrainTraceEvent[] = [];
    const gate = createRunWindowFit(deps(trace, { windowSources: { probes } }));
    const msgs = transcript();
    expect(await gate.prepare({ messages: msgs, model: 'openai/gpt-5', step: 1 })).toBe(msgs);
    expect(probes).not.toHaveBeenCalled();
    const out = await gate.prepare({ messages: msgs, model: 'local/webllm/Qwen3-1.7B-q4f16_1-MLC', maxTokens: 512, step: 2 });
    expect(probes).toHaveBeenCalledOnce();
    expect(out.length).toBeLessThan(msgs.length);
  });

  it('reuses the pre-turn recall instead of fetching it again', async () => {
    const recall = vi.fn(async (_query: string) => seeded('fresh fetch'));
    const trace: BrainTraceEvent[] = [];
    const gate = createRunWindowFit(deps(trace, { recall, priorRecall: { query: 'Now wire the chip row.', result: seeded('from the pre-turn recall') } }));
    const out = await gate.prepare({ messages: transcript(), model: 'local/webllm/Qwen3-1.7B-q4f16_1-MLC', maxTokens: 512, step: 1 });
    expect(recall).not.toHaveBeenCalled();
    expect(out.some((m) => typeof m.content === 'string' && m.content.includes('from the pre-turn recall'))).toBe(true);
  });

  it('records a failed recall instead of swallowing it, and still packs', async () => {
    const recall = vi.fn(async (_query: string) => {
      throw new Error('evermind 503');
    });
    const trace: BrainTraceEvent[] = [];
    const gate = createRunWindowFit(deps(trace, { recall }));
    const msgs = transcript();
    const out = await gate.prepare({ messages: msgs, model: 'local/webllm/Qwen3-1.7B-q4f16_1-MLC', maxTokens: 512, step: 3 });
    expect(out.length).toBeLessThan(msgs.length);
    const failed = trace.find((e) => e.label === 'llm.handoff_recall_failed');
    expect(failed).toMatchObject({ category: 'message', args: { step: 3 } });
    expect(String(failed?.result)).toContain('evermind 503');
  });
});
