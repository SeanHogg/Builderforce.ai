import { describe, expect, it } from 'vitest';
import { activeModelKey, buildModelItems, filterModelItems, modelInUse, DEFAULT_MODEL_CHOICE_LABELS as L, type ChatModelOptions } from './modelChoice';

const options: ChatModelOptions = {
  configured: [{ id: 'tenant_model:reviewer', label: 'Review specialist' }],
  byo: [{ id: 'direct/kimi-code/kimi-k2.5', vendor: 'Kimi Code' }],
  free: ['free/qwen'],
  plan: ['free/qwen', 'plan/sonnet'],
  paid: [{ id: 'openrouter/paid-opus', cost: '$15.00 input / $75.00 output per 1M tokens + $0.01/request' }],
};

describe('buildModelItems', () => {
  it('puts BuilderForce collections first, preserves BYO order, and never repeats a model', () => {
    const items = buildModelItems({
      ...options,
      byo: [
        { id: 'direct/meta/llama', vendor: 'Meta' },
        { id: 'claude-opus', vendor: 'Anthropic' },
      ],
    }, L);
    expect(items.map((item) => item.key)).toEqual([
      'auto',
      'model:free/qwen',
      'model:plan/sonnet',
      'model:openrouter/paid-opus',
      'byo_pool',
      'model:direct/meta/llama',
      'model:claude-opus',
      'model:tenant_model:reviewer',
    ]);
  });

  it('funds each row: explicit cost wins, BYO names the vendor billed', () => {
    const items = buildModelItems(options, L);
    expect(items.find((item) => item.key === 'model:openrouter/paid-opus')?.detail)
      .toBe('$15.00 input / $75.00 output per 1M tokens + $0.01/request');
    expect(items.find((item) => item.key === 'model:free/qwen')?.detail).toBe(L.freeDetail);
    expect(items.find((item) => item.key === 'model:plan/sonnet')?.detail).toBe(L.planDetail);
    expect(items.find((item) => item.key === 'model:direct/kimi-code/kimi-k2.5')?.detail)
      .toBe('Billed to your own Kimi Code account — no plan credit used.');
  });

  it('keeps each funding tier contiguous', () => {
    // The VS Code QuickPick emits one separator per tier as it walks this list, so a
    // tier appearing twice would render duplicate headings around split groups.
    const seen: string[] = [];
    for (const item of buildModelItems(options, L)) {
      if (seen[seen.length - 1] !== item.category) seen.push(item.category);
    }
    expect(seen).toEqual([...new Set(seen)]);
  });

  it('offers the BYO pool only when a provider is connected', () => {
    const items = buildModelItems({ ...options, byo: [] }, L);
    expect(items.some((item) => item.key === 'byo_pool')).toBe(false);
  });
});

describe('filterModelItems', () => {
  const items = buildModelItems(options, L);

  it('narrows by funding category', () => {
    const byo = filterModelItems(items, L, '', 'byo');
    expect(byo.map((item) => item.key)).toEqual(['byo_pool', 'model:direct/kimi-code/kimi-k2.5']);
  });

  it('searches label, funding detail, and category name', () => {
    expect(filterModelItems(items, L, 'k2.5', 'all').map((item) => item.key)).toEqual(['model:direct/kimi-code/kimi-k2.5']);
    expect(filterModelItems(items, L, 'nothing-here', 'all')).toEqual([]);
  });
});

describe('modelInUse', () => {
  const items = buildModelItems(options, L);

  it('names a strict pin and how it is funded', () => {
    expect(modelInUse({ mode: 'model', model: 'plan/sonnet' }, items, L)).toEqual({
      name: 'plan/sonnet',
      detail: L.planDetail,
    });
    expect(activeModelKey({ mode: 'model', model: 'plan/sonnet' })).toBe('model:plan/sonnet');
  });

  it('reports what auto actually resolved to, not just "Auto"', () => {
    expect(modelInUse({ mode: 'auto' }, items, L, 'free/qwen')).toEqual({ name: 'free/qwen', detail: L.freeDetail });
    expect(modelInUse({ mode: 'auto' }, items, L)).toEqual({ name: L.autoLabel, detail: L.autoDetail });
  });

  it('describes a project-Evermind pin as the plan feature it is, not a metered model', () => {
    expect(modelInUse({ mode: 'auto' }, items, L, 'project_evermind:12')).toEqual({
      name: L.evermindLabel,
      detail: L.evermindDetail,
    });
  });

  it('describes the BYO pool', () => {
    expect(modelInUse({ mode: 'byo_pool' }, items, L)).toEqual({ name: L.poolLabel, detail: L.poolDetail });
  });
});
