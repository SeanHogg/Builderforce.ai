/**
 * Provider MODEL SELECTION (1165) — a connected provider told which of its models to use.
 *
 * Covers the four places the choice has to land identically: the BYO seed, the cloud pin,
 * the picker/probe projection, and what the settings surface offers (Qwen Cloud's catalog,
 * filtered to models the gateway can actually drive).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../env';
import { BYO_FRONTIER_CODERS, byoAutoSeedModels, isDispatchableSeed, pickCloudModel } from './LlmProxyService';
import { byoModelsFor, byoSelectedModelRefs } from './byoModelRouting';
import { MAX_SELECTED_PROVIDER_MODELS, normalizeModelSelection } from './providerModelSelection';
import { listProviderModelChoices, mergeProviderModelChoices } from './providerModelCatalog';

const QWEN_SELECTION = ['direct/qwen/deepseek-v4-flash', 'direct/qwen/kimi-k3'];

describe('every BYO default flagship is dispatchable', () => {
  // A flagship constant naming an id its vendor does not catalogue is silently dropped by
  // the seed guard — the connected account then contributes NOTHING to auto-select (the
  // Qwen `qwen3-coder-plus` case). Asserting every entry, not a hand-picked three, is what
  // turns that drift into a red build.
  it.each([...BYO_FRONTIER_CODERS])('%s', (flagship) => {
    expect(isDispatchableSeed(flagship)).toBe(true);
  });
});

describe('byoAutoSeedModels — with a provider model selection', () => {
  it('a selection replaces the vendor flagship, in the chosen order', () => {
    expect(byoAutoSeedModels(new Set(['qwen']), { agentic: true, selectedModels: { qwen: QWEN_SELECTION } }))
      .toEqual(QWEN_SELECTION);
  });

  it('keeps the selection together at its vendor\'s precedence — failover never interleaves', () => {
    const seeds = byoAutoSeedModels(new Set(['anthropic', 'qwen']), {
      agentic: true,
      vendorPriority: ['qwen', 'anthropic'],
      selectedModels: { qwen: QWEN_SELECTION },
    });
    expect(seeds).toEqual([...QWEN_SELECTION, 'claude-opus-5']);
  });

  it('a vendor with no selection keeps its flagship', () => {
    expect(byoAutoSeedModels(new Set(['qwen']), { agentic: true, selectedModels: {} }))
      .toEqual(['direct/qwen/qwen3.8-max']);
  });
});

describe('pickCloudModel — pins on a connected provider route', () => {
  const byoVendors = new Set(['qwen']);

  it('honours a catalog model pinned on the connected provider\'s own route', () => {
    // Was dropped: `isKnownModel` looks up the bare catalog index, which never holds a
    // `direct/<vendor>/…` id, so every direct BYO pin fell back to the soft seed.
    expect(pickCloudModel('direct/qwen/qwen3.8-max', 'free', false, { byoVendors }))
      .toEqual({ model: 'direct/qwen/qwen3.8-max', strict: true });
  });

  it('honours a SELECTED model the curated catalog never listed', () => {
    expect(pickCloudModel('direct/qwen/deepseek-v4-flash', 'free', false, { byoVendors, registeredModels: QWEN_SELECTION }))
      .toEqual({ model: 'direct/qwen/deepseek-v4-flash', strict: true });
  });

  it('an id that is neither catalogued nor selected still falls back to the seed', () => {
    expect(pickCloudModel('direct/qwen/not-a-model', 'free', false, { byoVendors }))
      .toMatchObject({ model: 'direct/qwen/qwen3.8-max', strict: false });
  });

  it('an unpinned run seeds with the selection\'s lead model', () => {
    expect(pickCloudModel(undefined, 'free', false, { byoVendors, byoSelectedModels: { qwen: QWEN_SELECTION } }))
      .toMatchObject({ model: QWEN_SELECTION[0], strict: false });
  });
});

describe('byoModelsFor / byoSelectedModelRefs — the picker and probe projection', () => {
  const qwen = [{ provider: 'qwen' as const, authType: 'api_key' as const, priority: null }];

  it('a selected provider offers exactly its selection, on the tenant-keyed route', () => {
    expect(byoModelsFor(qwen, { qwen: ['deepseek-v4-flash', 'qwen3.8-max'] }).map((m) => m.id))
      .toEqual(['direct/qwen/deepseek-v4-flash', 'direct/qwen/qwen3.8-max']);
  });

  it('an unselected provider still offers its static catalog', () => {
    expect(byoModelsFor(qwen).map((m) => m.id)).toContain('direct/qwen/qwen3.8-max');
  });

  it('refs are keyed by the DISPATCH vendor, and unselected providers are absent', () => {
    expect(byoSelectedModelRefs(
      [...qwen, { provider: 'anthropic', authType: 'api_key', priority: null }],
      { qwen: ['kimi-k3'] },
    )).toEqual({ qwen: ['direct/qwen/kimi-k3'] });
  });
});

describe('normalizeModelSelection', () => {
  it('keeps first-seen order and drops duplicates', () => {
    expect(normalizeModelSelection(['kimi-k3', ' glm-5.3 ', 'kimi-k3'])).toEqual({ ok: true, models: ['kimi-k3', 'glm-5.3'] });
  });

  it('rejects a malformed id rather than silently reordering around it', () => {
    expect(normalizeModelSelection(['kimi-k3', 'bad id'])).toEqual({ ok: false, error: 'invalid_models' });
    expect(normalizeModelSelection('kimi-k3')).toEqual({ ok: false, error: 'invalid_models' });
  });

  it('caps the list', () => {
    const tooMany = Array.from({ length: MAX_SELECTED_PROVIDER_MODELS + 1 }, (_, i) => `model-${i}`);
    expect(normalizeModelSelection(tooMany)).toEqual({ ok: false, error: 'too_many_models' });
  });
});

describe('mergeProviderModelChoices', () => {
  it('leads with what the key serves, keeps key-only ids, and drops non-chat models', () => {
    const merged = mergeProviderModelChoices(
      ['qwen3.5-plus', 'qwen3.8-max', 'wan2.7-t2v'],
      ['qwen3.8-max', 'plan-only-model'],
      (id) => !id.startsWith('wan'),
    );
    expect(merged).toEqual([
      { id: 'qwen3.8-max', onAccount: true, inCatalog: true },
      { id: 'plan-only-model', onAccount: true, inCatalog: false },
      { id: 'qwen3.5-plus', onAccount: false, inCatalog: true },
    ]);
  });

  it('marks availability unknown when the key list could not be read', () => {
    expect(mergeProviderModelChoices(['qwen3.8-max'], null, () => true))
      .toEqual([{ id: 'qwen3.8-max', onAccount: null, inCatalog: true }]);
  });
});

describe('listProviderModelChoices — Qwen Cloud catalog', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('offers every chat-capable model Qwen Cloud lists, including other brands, and none of the rest', async () => {
    const mapping = Object.fromEntries([
      'qwen3.8-max', 'qwen3-coder-plus', 'qwen3-vl-plus', 'deepseek-v4-flash', 'kimi-k3', 'glm-5.3',
      'wan2.7-t2v', 'qwen3-tts-flash', 'qwen-image-2.0', 'qwen3.5-omni-plus', 'text-embedding-v4',
      'qwen-mt-plus', 'fun-asr', 'qwen3-rerank',
    ].map((id) => [id, 'sfm_inference']));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(mapping), { status: 200 })));

    // No env: the key lookup cannot run, so availability is honestly unknown.
    const choices = await listProviderModelChoices(undefined as unknown as Env, 1, 'qwen');
    expect(choices?.accountChecked).toBe(false);
    expect(choices?.models.map((m) => m.id).sort()).toEqual(
      ['deepseek-v4-flash', 'glm-5.3', 'kimi-k3', 'qwen3-coder-plus', 'qwen3-vl-plus', 'qwen3.8-max'],
    );
    expect(choices?.models.every((m) => m.onAccount === null && m.inCatalog)).toBe(true);
  });

  it('falls back to the static catalog when the public list is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('down', { status: 503 })));
    const choices = await listProviderModelChoices(undefined as unknown as Env, 2, 'qwen');
    expect(choices?.models.map((m) => m.id)).toContain('qwen3.8-max');
  });

  it('a provider without a published catalog offers no choice', async () => {
    expect(await listProviderModelChoices(undefined as unknown as Env, 1, 'minimax')).toBeNull();
  });
});
