import { describe, it, expect } from 'vitest';
import {
  nextFallbackModel,
  chooseStallFailover,
  MAX_MODEL_FAILOVERS,
  type ModelFallbackSurface,
} from './index';

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

/**
 * THE BRANCH THAT DID NOT RUN.
 *
 * The server-side addressed-reply loop expressed failover as "if there is a pin, drop
 * it and let the cascade re-route". On the DEFAULT path — a tenant with a connected
 * account, deliberately left unpinned so the gateway seeds their own flagship — there is
 * no pin, so the branch was dead and the run gave up after one model. Measured on
 * project 11 / chat 86: 11 model turns, one model, zero tool calls, zero failovers.
 *
 * The first test below is that case, and it is the reason this function exists rather
 * than a third hand-written copy of the same three steps.
 */
describe('chooseStallFailover', () => {
  it('fails over on an UNPINNED turn — the case the hand-rolled branch could not reach', () => {
    const tried: string[] = [];
    const next = chooseStallFailover({
      activeModel: undefined,           // gateway auto-select: nothing was pinned
      resolvedModel: 'xai-oauth/grok-4.3', // …but something answered, and it is spent
      tried,
      failoversUsed: 0,
      surface,
    });
    expect(next).toBe('byo-coder');
    // The resolved model is what identifies the route to skip; without recording it the
    // "different model" could be the same one again.
    expect(tried).toContain('xai-oauth/grok-4.3');
  });

  it('records the pinned model too, so a pinned run cannot be handed back its own model', () => {
    const tried: string[] = [];
    const next = chooseStallFailover({
      activeModel: 'byo-coder',
      resolvedModel: 'byo-coder',
      tried,
      failoversUsed: 0,
      surface,
    });
    expect(tried).toEqual(['byo-coder']);
    expect(next).not.toBe('byo-coder');
    expect(next).toBe('coder-1');
  });

  it('stops at the budget rather than walking the catalog on the tenant\'s money', () => {
    const tried = ['grok'];
    expect(chooseStallFailover({
      resolvedModel: 'grok', tried, failoversUsed: MAX_MODEL_FAILOVERS, surface,
    })).toBeUndefined();
    // Still records the burned model — the exhausted notice names every model tried.
    expect(tried).toEqual(['grok']);
  });

  it('never offers a model the run already burned, even from a host-supplied picker', () => {
    // `pick` comes from outside this package; a host that ignores `tried` must not be
    // able to put the run back on the model that just failed.
    const tried = ['grok'];
    expect(chooseStallFailover({
      resolvedModel: 'grok', tried, failoversUsed: 0, pick: () => 'grok',
    })).toBeUndefined();
    expect(chooseStallFailover({
      resolvedModel: 'grok', tried, failoversUsed: 0, pick: (t) => (t.includes('other') ? undefined : 'other'),
    })).toBe('other');
  });

  it('prefers the host picker over the surface, and answers undefined given neither', () => {
    const tried: string[] = [];
    expect(chooseStallFailover({
      resolvedModel: 'grok', tried, failoversUsed: 0, surface, pick: () => 'host-choice',
    })).toBe('host-choice');
    expect(chooseStallFailover({
      resolvedModel: 'grok', tried: [], failoversUsed: 0,
    })).toBeUndefined();
  });

  it('ignores the placeholder id `default` — it names no model to skip', () => {
    const tried: string[] = [];
    chooseStallFailover({ activeModel: 'default', resolvedModel: 'default', tried, failoversUsed: 0, surface });
    expect(tried).toEqual([]);
  });
});
