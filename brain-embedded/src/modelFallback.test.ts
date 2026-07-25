import { describe, it, expect } from 'vitest';
import { nextFallbackModel, type ModelFallbackSurface } from './modelFallback';

/**
 * The selector behind "a model that won't emit tool calls gets replaced, not
 * complained about". Two things must hold: it never hands back a model the run has
 * already burned, and it prefers a route that is both free (the tenant's own account)
 * and curated for the capability that just failed (tool calling).
 */
const surface: ModelFallbackSurface = {
  data: [{ id: 'plan-a' }, { id: 'plan-b' }, { id: 'coder-1' }, { id: 'coder-2' }, { id: 'byo-coder' }],
  codingModels: ['coder-1', 'coder-2', 'byo-coder'],
  byo: { models: [{ id: 'byo-chat', vendor: 'xai' }, { id: 'byo-coder', vendor: 'anthropic' }] },
};

describe('nextFallbackModel', () => {
  it('prefers a model that is BOTH the tenant\'s own account and in the coding pool', () => {
    // Free against the plan allowance AND curated for tool calling — best on both axes.
    expect(nextFallbackModel(surface, ['xai-oauth/grok-4.3'])).toBe('byo-coder');
  });

  it('falls to the coding pool next — we are failing over BECAUSE of tool calling', () => {
    // A plain BYO chat model would be cheaper, but the curated tool-calling list is
    // the one that addresses the actual failure.
    expect(nextFallbackModel(surface, ['grok', 'byo-coder'])).toBe('coder-1');
  });

  it('then any remaining BYO model, then the rest of the plan pool', () => {
    expect(nextFallbackModel(surface, ['grok', 'byo-coder', 'coder-1', 'coder-2'])).toBe('byo-chat');
    expect(nextFallbackModel(surface, ['grok', 'byo-coder', 'coder-1', 'coder-2', 'byo-chat'])).toBe('plan-a');
  });

  it('NEVER returns a model the run already burned', () => {
    const tried: string[] = ['grok'];
    for (;;) {
      const next = nextFallbackModel(surface, tried);
      if (!next) break;
      expect(tried).not.toContain(next);
      tried.push(next);
    }
    // Every distinct id across every tier was offered exactly once.
    expect(new Set(tried).size).toBe(tried.length);
    expect(tried).toHaveLength(1 + 6);
  });

  it('returns undefined when nothing untried is left, or the surface never loaded', () => {
    const all = ['plan-a', 'plan-b', 'coder-1', 'coder-2', 'byo-coder', 'byo-chat'];
    expect(nextFallbackModel(surface, all)).toBeUndefined();
    expect(nextFallbackModel(null, [])).toBeUndefined();
    expect(nextFallbackModel(undefined, [])).toBeUndefined();
    expect(nextFallbackModel({}, [])).toBeUndefined();
  });

  it('works from a surface that carries no coding pool at all', () => {
    // Older gateway / a plan with no curated subset: BYO first, then the pool.
    const bare: ModelFallbackSurface = { data: [{ id: 'p1' }], byo: { models: [{ id: 'b1' }] } };
    expect(nextFallbackModel(bare, [])).toBe('b1');
    expect(nextFallbackModel(bare, ['b1'])).toBe('p1');
  });

  it('ignores blank ids rather than offering an empty model', () => {
    const messy: ModelFallbackSurface = { data: [{ id: '' }, { }, { id: 'p1' }], codingModels: [''] };
    expect(nextFallbackModel(messy, [])).toBe('p1');
  });
});
