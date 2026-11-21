import { describe, expect, it } from 'vitest';
import type { BrainTraceEvent } from '../brainTriage';
import { bareModelId, gatewayModelWindows } from '../gatewayModels';
import { windowFitTranscript as transcript } from '../test/windowFitTranscript';
import { createRunWindowFit } from './runWindowFit';

// VS Code chat #157440 (msg #2319): a plan-role turn's llm.complete carried no contextWindow while the code turns carried
// 500000, so every read_file result on the plan turns fell back to the 16K default cap and the PRD arrived in slices. The
// window is resolved the same way for EVERY role (the model that served, else the one asked for), and the gateway
// catalog answers a served model by its bare vendor id as well as by its route ref.

const surface = { byo: { models: [{ id: 'direct/moonshot/kimi-k2-planner', contextWindow: 500_000 }, { id: 'claude-opus-4-5', contextWindow: 200_000 }] } };
const gate = () => {
  const trace: BrainTraceEvent[] = [];
  return createRunWindowFit({ workingBudgetTokens: 64_000, trace: (e) => trace.push(e), now: () => 't', windowSources: { cloud: gatewayModelWindows(surface) } });
};

describe('regression: chat #157440 — every role carries the resolved model window', () => {
  it('regression: a plan turn served under the vendor spelling of a catalog route ref still gets its window', async () => {
    const g = gate();
    g.served('moonshot/kimi-k2-planner');
    expect(await g.contextWindow?.()).toBe(500_000);
  });

  it('a plan turn asked of a catalog model before anything served reads that model window', async () => {
    const g = gate();
    await g.prepare({ messages: transcript(), model: 'claude-opus-4-5', step: 1 });
    expect(await g.contextWindow?.()).toBe(200_000);
  });

  it('the served model wins when it is known', async () => {
    const g = gate();
    await g.prepare({ messages: transcript(), model: 'claude-opus-4-5', step: 1 });
    g.served('direct/moonshot/kimi-k2-planner');
    expect(await g.contextWindow?.()).toBe(500_000);
  });

  it('nobody known ⇒ undefined (the default caps), as before', async () => {
    const g = gate();
    g.served('someone/else');
    expect(await g.contextWindow?.()).toBeUndefined();
  });
});

describe('gatewayModelWindows — bare vendor ids', () => {
  it('answers a route ref and its bare id; an ambiguous bare id answers nothing', () => {
    const windows = gatewayModelWindows({ byo: { models: [
      { id: 'googleai/gemini-pro', contextWindow: 1_000_000 },
      { id: 'direct/a/shared', contextWindow: 100 },
      { id: 'direct/b/shared', contextWindow: 200 },
    ] } });
    expect(windows('googleai/gemini-pro')).toBe(1_000_000);
    expect(windows('gemini-pro')).toBe(1_000_000);
    expect(windows('direct/a/shared')).toBe(100);
    expect(windows('shared')).toBeUndefined();
    expect(bareModelId('~Anthropic/Claude-Opus:thinking')).toBe('claude-opus');
  });
});
