import { describe, expect, it } from 'vitest';
import { activeModelKey, buildModelItems, filterModelItems, modelInUse, DEFAULT_MODEL_CHOICE_LABELS as L, type ChatModelOptions } from './modelChoice';
import { BUILDERFORCE_PRODUCT_NAME, type ModelIdentityContext } from './modelIdentity';

/** A viewer entitled to pick a model (paid plan or a connected provider). */
const CHOOSER: ModelIdentityContext = { product: 'pro', canChoose: true };
/** The free / anonymous viewer: routed, no choice, so no upstream id is ever shown. */
const FREE: ModelIdentityContext = { product: 'free', canChoose: false };

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
  const items = buildModelItems(options, L, CHOOSER);

  it('names a strict pin and how it is funded', () => {
    expect(modelInUse({ mode: 'model', model: 'plan/sonnet' }, items, L, undefined, CHOOSER)).toEqual({
      name: 'plan/sonnet',
      detail: L.planDetail,
    });
    expect(activeModelKey({ mode: 'model', model: 'plan/sonnet' })).toBe('model:plan/sonnet');
  });

  it('reports what auto resolved to for a viewer who may pin, and the product otherwise', () => {
    expect(modelInUse({ mode: 'auto' }, items, L, 'free/qwen', CHOOSER)).toEqual({ name: 'free/qwen', detail: L.freeDetail });
    expect(modelInUse({ mode: 'auto' }, items, L, undefined, CHOOSER))
      .toEqual({ name: BUILDERFORCE_PRODUCT_NAME.pro, detail: L.autoDetail });
  });

  it('never leaks the upstream model a routed FREE turn landed on', () => {
    // The reported bug: a free-plan composer announced "minimaxai/minimax-m3" next to a
    // menu that would not let the user change it. Free viewers see the product, always —
    // including when the host reports what the cascade actually resolved to.
    for (const effective of [undefined, 'minimaxai/minimax-m3', 'plan/sonnet']) {
      expect(modelInUse({ mode: 'auto' }, items, L, effective, FREE))
        .toEqual({ name: BUILDERFORCE_PRODUCT_NAME.free, detail: L.autoDetail });
    }
    // Even a pin that somehow survived on the selection is masked — the gateway would
    // ignore it for this tenant anyway, so naming it would state something untrue.
    expect(modelInUse({ mode: 'model', model: 'minimaxai/minimax-m3' }, items, L, undefined, FREE).name)
      .toBe(BUILDERFORCE_PRODUCT_NAME.free);
  });

  it('defaults to the masked identity when a host wires none', () => {
    expect(modelInUse({ mode: 'auto' }, items, L, 'minimaxai/minimax-m3').name)
      .toBe(BUILDERFORCE_PRODUCT_NAME.free);
  });

  it('describes a project-Evermind pin as the plan feature it is, not a metered model', () => {
    // Named on BOTH tiers: it is the user's OWN learned head, not an upstream model.
    for (const identity of [CHOOSER, FREE]) {
      expect(modelInUse({ mode: 'auto' }, items, L, 'project_evermind:12', identity)).toEqual({
        name: L.evermindLabel,
        detail: L.evermindDetail,
      });
    }
  });

  it('describes the BYO pool', () => {
    expect(modelInUse({ mode: 'byo_pool' }, items, L, undefined, FREE)).toEqual({ name: L.poolLabel, detail: L.poolDetail });
  });
});

describe('buildModelItems · routed row', () => {
  it('names the routed row after the product that funds it', () => {
    expect(buildModelItems(options, L, CHOOSER)[0]).toMatchObject({ key: 'auto', label: BUILDERFORCE_PRODUCT_NAME.pro });
    expect(buildModelItems(options, L, FREE)[0]).toMatchObject({ key: 'auto', label: BUILDERFORCE_PRODUCT_NAME.free });
  });
});
