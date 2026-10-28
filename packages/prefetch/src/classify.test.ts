import { describe, expect, it, vi } from 'vitest';
import { classify } from './classify';
import { defineRegistry, offeredActions } from './registry';
import type { GatePorts, LogprobPort, PrefetchAction } from './types';

const row = (over: Partial<PrefetchAction> & Pick<PrefetchAction, 'id'>): PrefetchAction => ({
  kind: 'answer',
  sideEffect: 'read',
  surfaces: ['vscode'],
  examples: [],
  budgetMs: 1000,
  labelKey: `prefetch.action.${over.id}`,
  ...over,
});

const registry = defineRegistry([
  row({ id: 'dup.check', slash: '/dup', examples: ['find duplicate code', 'show copy pasted code', 'detect duplicated blocks'], requires: { tool: 'jscpd' } }),
  row({ id: 'symbols.where-defined', patterns: [/^\s*where\s+is\s+\S+\s+defined/i], examples: ['where is fooBar defined', 'which file defines Widget'] }),
  row({ id: 'context.pre-search', kind: 'prefetch', surfaces: ['vscode', 'web'], examples: ['fix the bug in parseConfig', 'how does resolveMembership work'] }),
]);

const ports = (over: Partial<GatePorts> = {}): GatePorts => ({ surface: 'vscode', tools: new Set(['jscpd']), ...over });

const coldLogprob = (): LogprobPort & { calls: number } => {
  const port = { calls: 0, warm: () => false, logprobs: vi.fn(async () => { port.calls += 1; return {}; }) };
  return port;
};

describe('classify', () => {
  it('an exact slash wins at p = 1 on tier 1', async () => {
    const d = await classify('/dup src/', registry, ports());
    expect(d.route).toBe('answer');
    expect(d.actions[0]).toMatchObject({ id: 'dup.check', p: 1, tier: 1 });
    expect(d.tiersRun).toEqual([1]);
  });

  it('a rule pattern is tier 1 too', async () => {
    const d = await classify('where is fooBar defined?', registry, ports());
    expect(d.route).toBe('answer');
    expect(d.actions[0]).toMatchObject({ id: 'symbols.where-defined', p: 1, tier: 1 });
  });

  it('a near-copy of an example clears the cold answer threshold on tier 2', async () => {
    const d = await classify('find duplicate code', registry, ports());
    expect(d.route).toBe('answer');
    expect(d.actions[0]).toMatchObject({ id: 'dup.check', tier: 2 });
    expect(d.actions[0]!.p).toBeGreaterThanOrEqual(0.9);
  });

  it('an ambiguous request goes to the llm', async () => {
    const d = await classify('make this better', registry, ports());
    expect(d.route).toBe('llm');
    expect(d.pNeedsLlm).toBeGreaterThan(0.5);
  });

  it('never consults tier 3 when no local engine is warm', async () => {
    const logprob = coldLogprob();
    // Half the words of an example: ambiguous on tier 2.
    const d = await classify('find duplicate things', registry, ports({ logprob }));
    expect(logprob.calls).toBe(0);
    expect(d.tiersRun).not.toContain(3);
  });

  it('consults a warm tier 3 on an ambiguous request and lets needs-llm win', async () => {
    const logprobs = vi.fn(async () => ({ 'dup.check': -3, 'needs-llm': -0.1 }));
    const d = await classify('find duplicate things', registry, ports({ logprob: { warm: () => true, logprobs } }));
    expect(logprobs).toHaveBeenCalledTimes(1);
    expect(d.tiersRun).toContain(3);
    expect(d.route).toBe('llm');
  });

  it('does not offer an action whose tool is missing, or on another surface', async () => {
    expect(offeredActions(registry, { surface: 'vscode' }).map((a) => a.id)).toEqual(['symbols.where-defined', 'context.pre-search']);
    expect(offeredActions(registry, { surface: 'web' }).map((a) => a.id)).toEqual(['context.pre-search']);
    const d = await classify('/dup', registry, ports({ tools: new Set() }));
    expect(d.actions.some((a) => a.id === 'dup.check')).toBe(false);
  });

  it('is deterministic: the same request gives the same decision, ties by action id', async () => {
    const tied = defineRegistry([
      row({ id: 'b.second', examples: ['run the linter'] }),
      row({ id: 'a.first', examples: ['run the linter'] }),
    ]);
    const strip = ({ elapsedMs: _e, ...rest }: Awaited<ReturnType<typeof classify>>) => rest;
    const one = strip(await classify('run the linter', tied, ports()));
    const two = strip(await classify('run the linter', tied, ports()));
    expect(one).toEqual(two);
    expect(one.actions.map((a) => a.id)).toEqual(['a.first', 'b.second']);
  });

  it('rejects a registry that would auto-run a write', () => {
    expect(() => defineRegistry([row({ id: 'fmt', kind: 'prefetch', sideEffect: 'write' })])).toThrow(/write/);
    expect(() => defineRegistry([row({ id: 'x' }), row({ id: 'x' })])).toThrow(/duplicate/);
  });
});
