import { describe, expect, it } from 'vitest';
import {
  CODING_MODEL_POOL,
  CODING_DEFAULT_MODEL,
  FREE_MODEL_POOL,
  isKnownModel,
  codingModelsForPlan,
  codingDefaultForPlan,
  pickCloudModel,
} from './LlmProxyService';
import { catalogEntry } from './vendors';

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

    // No selection → plan default, soft.
    expect(pickCloudModel(undefined, 'pro')).toEqual({ model: codingDefaultForPlan('pro'), strict: false });
  });
});
