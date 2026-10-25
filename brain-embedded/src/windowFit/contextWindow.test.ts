import { describe, expect, it, vi } from 'vitest';
import { createRunWindowFit } from './runWindowFit';

/** The window a run's tool-result cap is sized to (PRD 35 E4). */
describe('RunWindowFit.contextWindow', () => {
  const gate = (cloud?: (ref: string) => number | undefined) =>
    createRunWindowFit({ workingBudgetTokens: 64_000, trace: () => {}, now: () => 't', ...(cloud ? { windowSources: { cloud } } : {}) });

  it('is unknown before any model asked or served, and for a model nobody knows', async () => {
    const g = gate(() => undefined);
    expect(await g.contextWindow!()).toBeUndefined();
    g.served('openai/gpt-5');
    expect(await g.contextWindow!()).toBeUndefined();
  });

  it('follows the model that last served, else the one last asked for', async () => {
    const windows: Record<string, number> = { 'direct/a': 200_000, 'direct/b': 100_000 };
    const g = gate((ref) => windows[ref]);
    await g.prepare({ messages: [], model: 'direct/b', step: 1 });
    expect(await g.contextWindow!()).toBe(100_000);
    g.served('direct/a');
    expect(await g.contextWindow!()).toBe(200_000);
  });

  it('resolves each model once per run', async () => {
    const cloud = vi.fn((ref: string) => (ref === 'direct/a' ? 128_000 : undefined));
    const g = gate(cloud);
    g.served('direct/a');
    await g.contextWindow!();
    await g.contextWindow!();
    expect(cloud).toHaveBeenCalledTimes(1);
  });
});
