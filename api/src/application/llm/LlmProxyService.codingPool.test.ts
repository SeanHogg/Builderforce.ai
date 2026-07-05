import { describe, expect, it } from 'vitest';
import {
  CODING_MODEL_POOL,
  CODING_DEFAULT_MODEL,
  CODING_PREMIUM_FALLBACK_MODELS,
  FREE_MODEL_POOL,
  PRO_PAID_MODEL_POOL,
  PAID_LEAD_VENDOR,
  leadPoolWithVendor,
  isKnownModel,
  codingModelsForPlan,
  codingDefaultForPlan,
  pickCloudModel,
  rankModelsForAction,
  byoAutoSeedModels,
  isDispatchableSeed,
  explicitModelPreemptsByo,
  type ActionModelRankStat,
} from './LlmProxyService';
import { catalogEntry, vendorForModel, autoRoutableModelsByTier, modelsByTier, tierForModel } from './vendors';

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

  it('PRO_PAID_MODEL_POOL leads with Cloudflare (free daily neuron allowance spent before metered vendors)', () => {
    // "use Cloudflare more / first in the list for paid": every Cloudflare paid model
    // must sort ahead of every non-Cloudflare paid model, so the cascade drains the
    // free ~10K-neuron/day allowance before any metered vendor.
    const lastCf = PRO_PAID_MODEL_POOL.map((m) => vendorForModel(m)).lastIndexOf(PAID_LEAD_VENDOR);
    const firstNonCf = PRO_PAID_MODEL_POOL.findIndex((m) => vendorForModel(m) !== PAID_LEAD_VENDOR);
    expect(lastCf).toBeGreaterThanOrEqual(0); // Cloudflare actually present in the paid pool
    expect(lastCf).toBeLessThan(firstNonCf);  // …and entirely ahead of the metered tail
  });

  it('leadPoolWithVendor floats a vendor first and is a no-op when absent (preserves order)', () => {
    const cf = '@cf/qwen/qwen3-30b-a3b-fp8'; // a real Cloudflare catalog id
    const or = 'openai/gpt-4.1';             // a real OpenRouter catalog id
    expect(leadPoolWithVendor([or, cf, 'deepseek/deepseek-v4-flash'], 'cloudflare')[0]).toBe(cf);
    // A vendor with no models in the pool leaves the order untouched.
    expect(leadPoolWithVendor([or, 'deepseek/deepseek-v4-flash'], 'cloudflare')).toEqual([or, 'deepseek/deepseek-v4-flash']);
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
    // Free default is a free model; the Pro default is the pool leader — now the
    // free-neuron Cloudflare coder (cost-first), NOT a metered model.
    expect(FREE_MODEL_POOL).toContain(codingDefaultForPlan('free'));
    expect(codingDefaultForPlan('pro')).toBe(CODING_MODEL_POOL[0]);
    // premiumOverride forces PREMIUM routing regardless of plan — the pool then
    // excludes STANDARD models (incl. the STANDARD Cloudflare lead), so the default
    // is the first PREMIUM coder, which is the same for 'free' and 'pro'.
    expect(codingDefaultForPlan('free', true)).toBe(codingDefaultForPlan('pro', true));
    expect(CODING_MODEL_POOL).toContain(codingDefaultForPlan('free', true));
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
// BYO auto-select preference — the connected owner account(s) lead the auto pool.
// When an account owner connects their OWN frontier account(s), an auto-select turn
// (no explicit model) must lead with those accounts' premium frontier model(s) so
// they're used before the free/paid tiers. It is REGISTRATION-DRIVEN (reflects
// exactly what the tenant connected — no hardcoded vendor) and multi-provider (all
// connected flagships lead, strongest catalog tier first). Anthropic contributes Opus
// for agentic tool-loops, Sonnet for chat. Every seed id must resolve to the DIRECT
// (tenant-keyed) vendor so the call is $0 → byo — the `direct/openai/` prefix must
// not drift back to a bare `openai/…` that hijacks OpenRouter (operator key).
// ---------------------------------------------------------------------------
describe('byoAutoSeedModels (connected-account auto seed)', () => {
  it('returns [] when the tenant has connected nothing (plan routing unchanged)', () => {
    expect(byoAutoSeedModels(undefined, { agentic: true })).toEqual([]);
    expect(byoAutoSeedModels(new Set(), { agentic: false })).toEqual([]);
  });

  it('Anthropic connected → Opus for agentic tool-loops, Sonnet for plain chat', () => {
    const s = new Set(['anthropic']);
    expect(byoAutoSeedModels(s, { agentic: true })).toEqual(['claude-opus-4-8']);
    expect(byoAutoSeedModels(s, { agentic: false })).toEqual(['claude-sonnet-4-6']);
  });

  it('OpenAI-only → the DIRECT (tenant-keyed) flagship, never the bare OpenRouter slug', () => {
    const seeds = byoAutoSeedModels(new Set(['openai']), { agentic: true });
    expect(seeds).toEqual(['direct/openai/gpt-4.1']);
    // The bare `openai/gpt-4.1` resolves to OpenRouter (operator key) — the direct
    // prefix must route to the tenant's OWN OpenAI key instead.
    expect(vendorForModel(seeds[0]!)).toBe('openai');
    expect(vendorForModel('openai/gpt-4.1')).toBe('openrouter');
  });

  it('Google-only → the direct googleai flagship', () => {
    const seeds = byoAutoSeedModels(new Set(['googleai']), { agentic: true });
    expect(seeds).toEqual(['googleai/gemini-2.5-pro']);
    expect(vendorForModel(seeds[0]!)).toBe('googleai');
  });

  it('all three connected → every provider flagship leads, ordered by frontier tier (no hardcoded vendor)', () => {
    const seeds = byoAutoSeedModels(new Set(['googleai', 'openai', 'anthropic']), { agentic: true });
    // One flagship per connected provider — the owner's OWN premium frontier models.
    expect([...seeds].sort()).toEqual(
      ['claude-opus-4-8', 'direct/openai/gpt-4.1', 'googleai/gemini-2.5-pro'].sort(),
    );
    // Ordered strongest-tier-first from catalog data: Opus (ULTRA) leads; every id
    // sorts by its catalog tier, so the ordering is monotonic and vendor-agnostic.
    const tiers = seeds.map((m) => tierForModel(m));
    const rank: Record<string, number> = { ULTRA: 0, PREMIUM: 1, STANDARD: 2, FREE: 3 };
    const ranks = tiers.map((t) => rank[t] ?? 4);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(seeds[0]).toBe('claude-opus-4-8'); // ULTRA leads
  });

  it('every seed output is dispatchable (prefix-stripped id is a real catalog entry)', () => {
    const seeds = [
      ...byoAutoSeedModels(new Set(['anthropic']), { agentic: true }),
      ...byoAutoSeedModels(new Set(['anthropic']), { agentic: false }),
      ...byoAutoSeedModels(new Set(['openai']), { agentic: true }),
      ...byoAutoSeedModels(new Set(['googleai']), { agentic: true }),
    ];
    for (const s of seeds) expect(isDispatchableSeed(s), `${s} must be dispatchable`).toBe(true);
    expect(isDispatchableSeed('made/up-model')).toBe(false);
  });
});

// The single branching rule shared by the cloud pin AND the Brain addressed-reply
// path — a connected account beats a NON-BYO explicit model (e.g. a default agent
// base model), which is the exact bug that let Ada run on `@cf/qwen` despite a live
// Claude subscription. Testing it here is what would have caught that regression.
describe('explicitModelPreemptsByo (explicit-vs-connected-account rule)', () => {
  it('no explicit model → never preempts (the connected flagship leads)', () => {
    expect(explicitModelPreemptsByo(undefined, new Set(['anthropic']))).toBe(false);
    expect(explicitModelPreemptsByo('', new Set(['anthropic']))).toBe(false);
    expect(explicitModelPreemptsByo('  ', new Set(['anthropic']))).toBe(false);
  });

  it('nothing connected → any explicit model is honored (normal plan routing)', () => {
    expect(explicitModelPreemptsByo('@cf/qwen/qwen3-30b-a3b-fp8', new Set())).toBe(true);
    expect(explicitModelPreemptsByo('openai/gpt-4.1', undefined)).toBe(true);
  });

  it('connected account + NON-BYO explicit model → does NOT preempt (connected account wins)', () => {
    const byo = new Set(['anthropic']);
    // A default agent base model of `@cf/qwen` (Cloudflare, operator-keyed) must NOT
    // shadow the connected Claude subscription — the reported bug.
    expect(explicitModelPreemptsByo('@cf/qwen/qwen3-30b-a3b-fp8', byo)).toBe(false);
    // A bare `openai/gpt-4.1` is OpenRouter (operator-keyed), not the tenant's account.
    expect(explicitModelPreemptsByo('openai/gpt-4.1', byo)).toBe(false);
  });

  it('connected account + explicit model ON that account → preempts (a deliberate BYO pick)', () => {
    expect(explicitModelPreemptsByo('claude-opus-4-8', new Set(['anthropic']))).toBe(true);
    expect(explicitModelPreemptsByo('direct/openai/gpt-4.1', new Set(['openai']))).toBe(true);
    expect(explicitModelPreemptsByo('googleai/gemini-2.5-pro', new Set(['googleai']))).toBe(true);
  });
});

describe('pickCloudModel with a connected BYO account', () => {
  it('no explicit pin + Anthropic connected → soft Opus seed, even on the free plan', () => {
    const byoVendors = new Set(['anthropic']);
    const free = pickCloudModel(undefined, 'free', false, { byoVendors });
    expect(free).toEqual({ model: 'claude-opus-4-8', strict: false });
    const pro = pickCloudModel(undefined, 'pro', false, { byoVendors });
    expect(pro.model).toBe('claude-opus-4-8');
    expect(pro.strict).toBe(false);
  });

  it('OpenAI-only connected → the cloud pin leads with the owner GPT account (not Anthropic)', () => {
    const pick = pickCloudModel(undefined, 'free', false, { byoVendors: new Set(['openai']) });
    expect(pick).toEqual({ model: 'direct/openai/gpt-4.1', strict: false });
  });

  it("a weak default base model does NOT shadow a connected account — the reported bug", () => {
    // Ada (Sr PM) seeded with `@cf/qwen` + a Pro tenant who connected Claude: the pin
    // must NOT win; the connected Opus flagship leads instead of the empty-turning coder.
    const byoVendors = new Set(['anthropic']);
    const pick = pickCloudModel('@cf/qwen/qwen3-30b-a3b-fp8', 'pro', false, { byoVendors });
    expect(pick).toEqual({ model: 'claude-opus-4-8', strict: false });
  });

  it('a deliberate BYO-served pin still wins over the auto seed', () => {
    const byoVendors = new Set(['anthropic']);
    expect(pickCloudModel('claude-opus-4-8', 'pro', false, { byoVendors }))
      .toEqual({ model: 'claude-opus-4-8', strict: true });
  });

  it('a non-BYO explicit pin on a Pro tenant with NO connected account is still honored (no regression)', () => {
    expect(pickCloudModel('openai/gpt-4.1', 'pro')).toEqual({ model: 'openai/gpt-4.1', strict: true });
  });

  it('no connected account → unchanged plan default (no BYO seed)', () => {
    expect(pickCloudModel(undefined, 'free').model).toBe(codingDefaultForPlan('free'));
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
    const leader = reachable[reachable.length - 1]!; // pick a NON-default to prove the reorder
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
    const other = reachable[reachable.length - 1]!;
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
    const leader = freePool[freePool.length - 1]!;
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

describe('Cloudflare paid coders', () => {
  // Every Cloudflare coder added to the pool MUST be tool-capable (the coding loop
  // sends `tools`; a non-FC model 400s on the payload). These ids were verified
  // function-calling-capable against the live Cloudflare catalog (2026-06-15).
  const CF_CODERS = [
    '@cf/qwen/qwen3-30b-a3b-fp8',
    '@cf/zai-org/glm-4.7-flash',
    '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    '@cf/moonshotai/kimi-k2.7-code',
  ];

  it('each is a tool-capable catalog coder owned by cloudflare, present in the coding pool', () => {
    for (const id of CF_CODERS) {
      const entry = catalogEntry(id);
      expect(entry, `${id} must be a catalog model`).not.toBeNull();
      expect(vendorForModel(id)).toBe('cloudflare');
      expect(entry?.capabilities, `${id} must be tool-capable`).toContain('tools');
      expect(CODING_MODEL_POOL).toContain(id);
    }
  });

  it('Cloudflare (free neurons) LEADS the paid coding section — no metered model before the first CF coder', () => {
    // Anthropic must NOT be first: every Cloudflare coder sorts ahead of the
    // OpenRouter-routed Anthropic coder so the free daily neuron allowance is spent
    // before any metered coder.
    const firstCf = CODING_MODEL_POOL.findIndex((m) => vendorForModel(m) === 'cloudflare');
    const meteredAnthropic = CODING_MODEL_POOL.indexOf('anthropic/claude-sonnet-4.6');
    expect(firstCf).toBe(0);                      // a Cloudflare coder is the pool leader
    expect(firstCf).toBeLessThan(meteredAnthropic); // …ahead of the metered Anthropic coder
  });

  it('surface in the Pro coding picker (paid, auto-routable) but not the Free one', () => {
    for (const id of CF_CODERS) {
      expect(codingModelsForPlan('pro')).toContain(id);
      expect(codingModelsForPlan('free')).not.toContain(id);
    }
  });

  it('the slow 256K kimi is the LAST Cloudflare coder in the backstop — faster coders lead (execution #136)', () => {
    // kimi-k2.7-code is the slowest CF coder by far (a single completion ran 93s and
    // got a live durable tick orphan-reaped). It must sit behind the fast big-window
    // glm lead AND the small/fast qwen/llama failovers, so a free/exhausted coding run
    // prefers a faster coder and only reaches kimi for a genuinely huge context.
    const glm   = CODING_PREMIUM_FALLBACK_MODELS.indexOf('@cf/zai-org/glm-4.7-flash');
    const qwen  = CODING_PREMIUM_FALLBACK_MODELS.indexOf('@cf/qwen/qwen3-30b-a3b-fp8');
    const llama = CODING_PREMIUM_FALLBACK_MODELS.indexOf('@cf/meta/llama-3.3-70b-instruct-fp8-fast');
    const kimi  = CODING_PREMIUM_FALLBACK_MODELS.indexOf('@cf/moonshotai/kimi-k2.7-code');
    expect(glm).toBeGreaterThanOrEqual(0);
    expect(glm).toBeLessThan(kimi);   // big-window lead before the slow model
    expect(qwen).toBeLessThan(kimi);  // fast small coders before the slow model
    expect(llama).toBeLessThan(kimi);
    // glm stays the Cloudflare lead (fits the cloud loop's compacted contexts).
    expect(glm).toBeLessThan(qwen);
    expect(glm).toBeLessThan(llama);
  });
});
