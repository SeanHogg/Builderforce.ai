import { describe, expect, it } from 'vitest';
import {
  CODING_MODEL_POOL,
  CODING_DEFAULT_MODEL,
  CODING_PREMIUM_FALLBACK_MODELS,
  FREE_MODEL_POOL,
  isKnownModel,
  codingModelsForPlan,
  codingDefaultForPlan,
  pickCloudModel,
  rankModelsForAction,
  type ActionModelRankStat,
} from './LlmProxyService';
import { catalogEntry, vendorForModel, autoRoutableModelsByTier, modelsByTier } from './vendors';

// ---------------------------------------------------------------------------
// Drift guard for the curated coding pool. The capability-reorder + the cloud-
// agent model picker + the runtime default all read from CODING_MODEL_POOL, so a
// silent rename in a vendor catalog (the exact bug that retired
// `anthropic/claude-3.7-sonnet` and left the tool-routing scoring every current
// model 0) must fail CI here instead of degrading routing in production.
// ---------------------------------------------------------------------------

describe('CODING_MODEL_POOL', () => {
  it('every entry is a real catalog model id', () => {
    const missing = CODING_MODEL_POOL.filter((m) => catalogEntry(m) === null);
    expect(missing, `coding-pool ids absent from any vendor catalog: ${missing.join(', ')}`).toEqual([]);
  });

  it('contains at least one FREE model so the default is dispatchable on the free key', () => {
    const free = CODING_MODEL_POOL.filter((m) => FREE_MODEL_POOL.includes(m));
    expect(free.length).toBeGreaterThan(0);
  });

  it('CODING_DEFAULT_MODEL is a FREE coding model', () => {
    expect(FREE_MODEL_POOL).toContain(CODING_DEFAULT_MODEL);
    expect(CODING_MODEL_POOL).toContain(CODING_DEFAULT_MODEL);
  });

  it('isKnownModel accepts catalog ids and rejects garbage', () => {
    expect(isKnownModel(CODING_DEFAULT_MODEL)).toBe(true);
    expect(isKnownModel('totally/made-up-model')).toBe(false);
    expect(isKnownModel('')).toBe(false);
    expect(isKnownModel(undefined)).toBe(false);
  });
});

describe('auto-route pool composition', () => {
  it('FREE_MODEL_POOL excludes Ollama (local/self-hosted vendor) so a cloud run never cascades onto it', () => {
    const ollama = FREE_MODEL_POOL.filter((m) => vendorForModel(m) === 'ollama');
    expect(ollama, `auto-routed free pool must not include Ollama ids: ${ollama.join(', ')}`).toEqual([]);
  });

  it('Ollama models still exist in the catalog (reachable via an explicit ollama/ pin)', () => {
    // The exclusion is at pool-composition time only — the catalog still owns them
    // so `ollama/gpt-oss:120b` resolves for genuine on-prem/self-hosted use.
    expect(catalogEntry('gpt-oss:120b')).not.toBeNull();
    expect(modelsByTier('FREE')).toContain('gpt-oss:120b');
    expect(autoRoutableModelsByTier('FREE')).not.toContain('gpt-oss:120b');
  });
});

describe('plan-aware coding routing', () => {
  it('free plan sees only free coding models; pro plan also sees premium', () => {
    const free = codingModelsForPlan('free');
    const pro = codingModelsForPlan('pro');
    // Free is a subset of pro, and pro carries at least one model free does not.
    expect(free.every((m) => pro.includes(m))).toBe(true);
    expect(pro.length).toBeGreaterThan(free.length);
    // Every free coding model is dispatchable on the free pool.
    expect(free.every((m) => FREE_MODEL_POOL.includes(m))).toBe(true);
  });

  it('codingDefaultForPlan upgrades the default for paid plans', () => {
    // Free default is a free model; pro default is the pool leader (premium first).
    expect(FREE_MODEL_POOL).toContain(codingDefaultForPlan('free'));
    expect(codingDefaultForPlan('pro')).toBe(CODING_MODEL_POOL[0]);
    // premiumOverride forces premium routing regardless of plan.
    expect(codingDefaultForPlan('free', true)).toBe(CODING_MODEL_POOL[0]);
  });

  it('pickCloudModel hard-pins a real explicit id, else falls back to the plan default', () => {
    const explicit = pickCloudModel('openai/gpt-4.1', 'pro');
    expect(explicit).toEqual({ model: 'openai/gpt-4.1', strict: true });

    // Typo'd / off-catalog id is NOT pinned — falls back to the plan's coding default.
    const garbage = pickCloudModel('made/up-model', 'free');
    expect(garbage.strict).toBe(false);
    expect(garbage.model).toBe(codingDefaultForPlan('free'));

    // No selection → plan default, soft (extra learned-routing fields are additive).
    const softPro = pickCloudModel(undefined, 'pro');
    expect(softPro.strict).toBe(false);
    expect(softPro.model).toBe(codingDefaultForPlan('pro'));
  });

  it('FREE plan cannot pin a model — even a real catalog id is ignored for the managed default', () => {
    // A free tenant's explicit pick (a user choice OR an agent base_model) must NOT
    // hard-pin; Builderforce manages which model free runs use. The picker is hidden
    // in the UI, but this is the authoritative server-side gate.
    const pinned = pickCloudModel('openai/gpt-4.1', 'free');
    expect(pinned.strict).toBe(false);
    expect(pinned.model).toBe(codingDefaultForPlan('free'));

    // A premium override lifts the gate (comped/beta access pins like a paid plan).
    expect(pickCloudModel('openai/gpt-4.1', 'free', true)).toEqual({ model: 'openai/gpt-4.1', strict: true });
  });
});

describe('direct-Anthropic coding floor', () => {
  it('claude-sonnet-4-6 and claude-opus-4-8 are real catalog ids owned by the anthropic vendor', () => {
    for (const id of ['claude-sonnet-4-6', 'claude-opus-4-8']) {
      expect(catalogEntry(id), `${id} must be a catalog model`).not.toBeNull();
      expect(vendorForModel(id)).toBe('anthropic');
    }
  });

  it('is auto-route excluded — never in a plan pool or the user-facing coding picker', () => {
    for (const plan of ['free', 'pro', 'teams'] as const) {
      const picker = codingModelsForPlan(plan);
      expect(picker).not.toContain('claude-sonnet-4-6');
      expect(picker).not.toContain('claude-opus-4-8');
    }
    expect(autoRoutableModelsByTier('PREMIUM', 'ULTRA')).not.toContain('claude-opus-4-8');
  });

  it('is a recognised coder (not flagged as a non-coder degradation)', () => {
    expect(CODING_MODEL_POOL).toContain('claude-sonnet-4-6');
    expect(CODING_MODEL_POOL).toContain('claude-opus-4-8');
  });

  it('the direct-Anthropic floor is tried LAST — after the Cloudflare + OpenRouter paid coders', () => {
    const cf = CODING_PREMIUM_FALLBACK_MODELS.indexOf('@cf/qwen/qwen3-30b-a3b-fp8');
    const sonnetDirect = CODING_PREMIUM_FALLBACK_MODELS.indexOf('claude-sonnet-4-6');
    const opusDirect = CODING_PREMIUM_FALLBACK_MODELS.indexOf('claude-opus-4-8');
    expect(cf).toBeGreaterThanOrEqual(0);
    expect(cf).toBeLessThan(sonnetDirect);   // Cloudflare surfaces before direct Claude
    expect(sonnetDirect).toBeLessThan(opusDirect);
  });
});

// ---------------------------------------------------------------------------
// Learned Model Routing (PRD 13) — rankModelsForAction + pickCloudModel hook.
// ---------------------------------------------------------------------------
describe('rankModelsForAction', () => {
  const reachable = ['model-a', 'model-b', 'model-c'];
  const stat = (model: string, n: number, avgScore: number, avgCostMc = 0): ActionModelRankStat => ({ model, n, avgScore, avgCostMc });

  it('empty stats → curated order unchanged (identity)', () => {
    expect(rankModelsForAction(reachable, undefined)).toEqual(reachable);
    expect(rankModelsForAction(reachable, [])).toEqual(reachable);
  });

  it('a model below MIN_SAMPLES never leads (cold-start keeps the curated order)', () => {
    // model-c has the best score but too few samples → curated order stands.
    const stats = [stat('model-c', 3, 0.99)];
    expect(rankModelsForAction(reachable, stats, { minSamples: 8 })).toEqual(reachable);
  });

  it('the best-scoring eligible model leads; rest keep curated order', () => {
    const stats = [stat('model-c', 10, 0.9), stat('model-a', 10, 0.5)];
    const ranked = rankModelsForAction(reachable, stats, { minSamples: 8 });
    expect(ranked[0]).toBe('model-c');
    // The two eligible sort by score; the non-eligible 'model-b' trails.
    expect(ranked).toEqual(['model-c', 'model-a', 'model-b']);
  });

  it('ties on score break to the lower-cost model', () => {
    const stats = [stat('model-a', 10, 0.8, 500), stat('model-b', 10, 0.8, 100)];
    const ranked = rankModelsForAction(reachable, stats, { minSamples: 8 });
    expect(ranked[0]).toBe('model-b'); // cheaper wins the tie
  });

  it('a bias map nudges ordering among eligible models before the sort', () => {
    const stats = [stat('model-a', 10, 0.70), stat('model-b', 10, 0.75)];
    // Without bias, model-b leads. A +0.1 nudge to model-a flips it.
    expect(rankModelsForAction(reachable, stats, { minSamples: 8 })[0]).toBe('model-b');
    expect(rankModelsForAction(reachable, stats, { minSamples: 8, bias: { 'model-a': 0.1 } })[0]).toBe('model-a');
  });

  it('output is always a permutation of reachable (never invents a model)', () => {
    const stats = [stat('not-in-pool', 99, 1.0)];
    expect([...rankModelsForAction(reachable, stats, { minSamples: 8 })].sort()).toEqual([...reachable].sort());
  });
});

describe('pickCloudModel with learned routing', () => {
  it('no stats → soft seed equals the curated plan default (Phase-1 behaviour preserved)', () => {
    const pick = pickCloudModel(undefined, 'pro');
    expect(pick.strict).toBe(false);
    expect(pick.model).toBe(codingDefaultForPlan('pro'));
  });

  it('seeds the top-scoring reachable model for the action type (soft seed = ranked[0])', () => {
    const reachable = codingModelsForPlan('pro');
    const leader = reachable[reachable.length - 1]; // pick a NON-default to prove the reorder
    const pick = pickCloudModel(undefined, 'pro', false, {
      actionType: 'sql',
      actionStats: [{ model: leader, n: 14, avgScore: 0.78, avgCostMc: 0 }],
      minSamples: 8,
    });
    expect(pick.strict).toBe(false);
    expect(pick.model).toBe(leader);
    expect(pick.seedSamples).toBe(14);
  });

  it('below MIN_SAMPLES → curated default (cold-start), even with a high score', () => {
    const reachable = codingModelsForPlan('pro');
    const other = reachable[reachable.length - 1];
    const pick = pickCloudModel(undefined, 'pro', false, {
      actionType: 'sql',
      actionStats: [{ model: other, n: 2, avgScore: 0.99, avgCostMc: 0 }],
      minSamples: 8,
    });
    expect(pick.model).toBe(codingDefaultForPlan('pro'));
  });

  it('explicit Pro pin is honoured byte-for-byte regardless of stats', () => {
    const pick = pickCloudModel('openai/gpt-4.1', 'pro', false, {
      actionType: 'sql',
      actionStats: [{ model: 'openai/gpt-4.1', n: 100, avgScore: 0.1, avgCostMc: 0 }],
    });
    expect(pick).toEqual({ model: 'openai/gpt-4.1', strict: true });
  });

  it('free plan ignores an explicit pick and still reorders only within the free coding pool', () => {
    const freePool = codingModelsForPlan('free');
    const leader = freePool[freePool.length - 1];
    const pick = pickCloudModel('openai/gpt-4.1', 'free', false, {
      actionType: 'sql',
      actionStats: [{ model: leader, n: 20, avgScore: 0.9, avgCostMc: 0 }],
      minSamples: 8,
    });
    expect(pick.strict).toBe(false);
    expect(freePool).toContain(pick.model); // never escapes the free pool
    expect(pick.model).toBe(leader);
  });
});

describe('Cloudflare paid coder', () => {
  it('@cf/qwen/qwen3-30b-a3b-fp8 is a tool-capable catalog coder owned by cloudflare', () => {
    const entry = catalogEntry('@cf/qwen/qwen3-30b-a3b-fp8');
    expect(entry).not.toBeNull();
    expect(vendorForModel('@cf/qwen/qwen3-30b-a3b-fp8')).toBe('cloudflare');
    expect(entry?.capabilities).toContain('tools');
    expect(CODING_MODEL_POOL).toContain('@cf/qwen/qwen3-30b-a3b-fp8');
  });

  it('surfaces in the Pro coding picker (paid, auto-routable) but not the Free one', () => {
    expect(codingModelsForPlan('pro')).toContain('@cf/qwen/qwen3-30b-a3b-fp8');
    expect(codingModelsForPlan('free')).not.toContain('@cf/qwen/qwen3-30b-a3b-fp8');
  });
});
