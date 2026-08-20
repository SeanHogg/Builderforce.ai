/**
 * The 429 capacity fix, end to end across its three seams.
 *
 * MEASURED (project 11, 2026-07-31): 150 of 164 terminal runs in one day were provider
 * 429s, and every downstream symptom on that board — the 180-ticket `failure_breaker`
 * cohort, the retry storm, the 0.7% completion rate — was that one fact. The three
 * behaviours asserted here are the three places it had to be fixed:
 *
 *   1. the dispatcher must BACK OFF HARDER each time a model refuses (cooldownStore);
 *   2. the router must STOP LEADING with a chronically-refused model (routing table);
 *   3. the manager must NOT SPEND A RUN resetting a breaker into a saturated pool
 *      (stall triage).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  _resetMemoryCooldowns,
  escalatedTtlSeconds,
  escalatedVendorTtlSeconds,
  loadCooldownExpiries,
  recordFailure,
  trialAfterDelaySeconds,
} from '../../infrastructure/auth/cooldownStore';
import {
  isChronicallyRateLimited,
  rankModelsForAction,
  RATE_LIMIT_MIN_RUNS,
  type ActionModelRankStat,
} from '@builderforce/learned-routing';
import { applyObservation, type RoutingTable } from './routingTable';
import { judgePoolHealth, codingPoolVendors, POOL_RATE_LIMITED_RATIO } from './poolHealth';
import type { VendorId } from './vendors';

beforeEach(() => { _resetMemoryCooldowns(); });

// ── 1. ESCALATING BACKOFF ────────────────────────────────────────────────────────

describe('escalatedTtlSeconds', () => {
  it('doubles the bench per consecutive strike from the class base', () => {
    expect(escalatedTtlSeconds('transient', 1)).toBe(5 * 60);
    expect(escalatedTtlSeconds('transient', 2)).toBe(10 * 60);
    expect(escalatedTtlSeconds('transient', 3)).toBe(20 * 60);
    expect(escalatedTtlSeconds('transient', 4)).toBe(40 * 60);
  });

  it('caps at an hour so no class benches a model indefinitely', () => {
    expect(escalatedTtlSeconds('transient', 5)).toBe(60 * 60);
    expect(escalatedTtlSeconds('transient', 50)).toBe(60 * 60);
    expect(escalatedTtlSeconds('auth', 3)).toBe(60 * 60);
    expect(escalatedTtlSeconds('capacity', 1)).toBe(60 * 60);
  });

  it('treats a missing/absurd strike count as the first strike', () => {
    expect(escalatedTtlSeconds('transient', 0)).toBe(5 * 60);
    expect(escalatedTtlSeconds('transient', -3)).toBe(5 * 60);
    expect(escalatedTtlSeconds('transient', Number.NaN)).toBe(5 * 60);
  });
});

describe('trialAfterDelaySeconds', () => {
  it('probes the first strike within 90s — a blip must recover fast', () => {
    expect(trialAfterDelaySeconds(5 * 60, 1)).toBe(75);
  });

  it('backs the PROBE off too — otherwise the probe defeats the escalation', () => {
    // The probe is the thing actually spending runs: a flat 90s ceiling means a
    // chronically-throttled model is re-dispatched every 90 seconds forever.
    const d2 = trialAfterDelaySeconds(10 * 60, 2);
    const d3 = trialAfterDelaySeconds(20 * 60, 3);
    const d5 = trialAfterDelaySeconds(60 * 60, 5);
    expect(d2).toBeGreaterThan(trialAfterDelaySeconds(5 * 60, 1));
    expect(d3).toBeGreaterThan(d2);
    expect(d5).toBeGreaterThan(d3);
  });

  it('never probes later than a quarter of the bench', () => {
    expect(trialAfterDelaySeconds(60 * 60, 100)).toBe(15 * 60);
  });
});

describe('recordFailure — consecutive strikes lengthen the bench', () => {
  const env = {} as { AUTH_CACHE_KV?: KVNamespace };
  const V = 'openrouter' as VendorId;
  const M = 'moonshotai/kimi-k3';

  it('benches a repeat offender for longer than a first-time failure', async () => {
    await recordFailure(env, V, M, 429);
    const first = (await loadCooldownExpiries(env, [{ vendor: V, model: M }], 'display')).get(`${V}/${M}`)!;

    await recordFailure(env, V, M, 429);
    const second = (await loadCooldownExpiries(env, [{ vendor: V, model: M }], 'display')).get(`${V}/${M}`)!;

    await recordFailure(env, V, M, 429);
    const third = (await loadCooldownExpiries(env, [{ vendor: V, model: M }], 'display')).get(`${V}/${M}`)!;

    expect(second).toBeGreaterThan(first);
    expect(third).toBeGreaterThan(second);
  });

  it('a model that recovered starts the ladder over — the escalation self-resets', async () => {
    await recordFailure(env, V, M, 429);
    await recordFailure(env, V, M, 429);
    // The store expiring the entry IS the reset (no success hook, so no KV write on the
    // hot path). `_resetMemoryCooldowns` stands in for that expiry.
    _resetMemoryCooldowns();
    await recordFailure(env, V, M, 429);
    const after = (await loadCooldownExpiries(env, [{ vendor: V, model: M }], 'display')).get(`${V}/${M}`)!;
    // Back to the 5-minute base (allow generous slack for clock/scheduling).
    expect(after - Date.now()).toBeLessThanOrEqual(5 * 60_000 + 5_000);
  });

  it('still writes nothing for a caller-side 400 — a schema typo is not the model’s fault', async () => {
    await recordFailure(env, V, M, 400);
    const cooled = await loadCooldownExpiries(env, [{ vendor: V, model: M }], 'display');
    expect(cooled.has(`${V}/${M}`)).toBe(false);
  });
});

describe('escalatedVendorTtlSeconds', () => {
  it('escalates the vendor bench on the same ladder as the per-model one', () => {
    expect(escalatedVendorTtlSeconds('transient', 1)).toBe(5 * 60);
    expect(escalatedVendorTtlSeconds('transient', 2)).toBe(10 * 60);
    expect(escalatedVendorTtlSeconds('auth', 2)).toBe(60 * 60);
    expect(escalatedVendorTtlSeconds('capacity', 4)).toBe(60 * 60);
  });
});

// ── 2. THE ROUTER LEARNS AVAILABILITY, NOT A FAKE QUALITY PENALTY ────────────────

describe('isChronicallyRateLimited', () => {
  const base = { n: 10, avgScore: 0.8 };

  it('is true when most of a meaningful sample died on a 429', () => {
    expect(isChronicallyRateLimited({ ...base, rateLimitRate: 0.9 })).toBe(true);
    expect(isChronicallyRateLimited({ ...base, rateLimitRate: 0.5 })).toBe(true);
  });

  it('is false below the majority — one bad afternoon is not a pattern', () => {
    expect(isChronicallyRateLimited({ ...base, rateLimitRate: 0.49 })).toBe(false);
    expect(isChronicallyRateLimited({ ...base, rateLimitRate: 0 })).toBe(false);
  });

  it('needs enough runs behind the share before it may demote', () => {
    expect(isChronicallyRateLimited({ n: RATE_LIMIT_MIN_RUNS - 1, avgScore: 0, rateLimitRate: 1 })).toBe(false);
    expect(isChronicallyRateLimited({ n: RATE_LIMIT_MIN_RUNS, avgScore: 0, rateLimitRate: 1 })).toBe(true);
  });

  it('reads a pre-0485 blob (no field) as not rate-limited', () => {
    expect(isChronicallyRateLimited({ n: 40, avgScore: 0.9 })).toBe(false);
  });
});

describe('rankModelsForAction — throttled models go last', () => {
  const HEALTHY = 'anthropic/claude-sonnet-5';
  const THROTTLED = 'moonshotai/kimi-k3';
  const COLD = 'openai/gpt-4.1';

  it('demotes a chronically-429ing model BELOW the curated tail, not just below the good ones', () => {
    const stats: ActionModelRankStat[] = [
      // The saturated free coder: a great score on the few runs that got through, and
      // unreachable the rest of the time. Quality ranking alone would seed it FIRST.
      { model: THROTTLED, n: 20, avgScore: 0.95, avgCostMc: 0, rateLimitRate: 0.9 },
      { model: HEALTHY, n: 20, avgScore: 0.6, avgCostMc: 500, rateLimitRate: 0 },
    ];
    const out = rankModelsForAction([THROTTLED, HEALTHY, COLD], stats, { minSamples: 8 });
    expect(out).toEqual([HEALTHY, COLD, THROTTLED]);
  });

  it('never drops it — the cascade must always have somewhere to land', () => {
    const stats: ActionModelRankStat[] = [
      { model: THROTTLED, n: 20, avgScore: 0.95, avgCostMc: 0, rateLimitRate: 1 },
    ];
    const out = rankModelsForAction([THROTTLED], stats, { minSamples: 8 });
    expect(out).toEqual([THROTTLED]);
  });

  it('leaves cold-start behaviour untouched when nothing is ranked or throttled', () => {
    const order = [COLD, HEALTHY, THROTTLED];
    expect(rankModelsForAction(order, [], { minSamples: 8 })).toEqual(order);
    expect(rankModelsForAction(order, undefined, { minSamples: 8 })).toEqual(order);
  });

  it('is always a permutation of the reachable set', () => {
    const stats: ActionModelRankStat[] = [
      { model: THROTTLED, n: 20, avgScore: 0.9, avgCostMc: 0, rateLimitRate: 1 },
      { model: HEALTHY, n: 20, avgScore: 0.7, avgCostMc: 1, rateLimitRate: 0 },
    ];
    const out = rankModelsForAction([THROTTLED, HEALTHY, COLD], stats, { minSamples: 8 });
    expect([...out].sort()).toEqual([THROTTLED, HEALTHY, COLD].sort());
  });
});

describe('applyObservation — the rate-limit share is folded like any other running stat', () => {
  const empty = (): RoutingTable => ({ updatedAt: new Date(0).toISOString(), byAction: {} });
  const obs = (rateLimited: boolean) => ({
    actionType: 'backend_api' as const, model: 'm', score: rateLimited ? 0 : 0.9, costMc: 0,
    merged: !rateLimited, rateLimited,
  });

  it('tracks the running share across mixed observations', () => {
    let t = empty();
    t = applyObservation(t, obs(true));
    expect(t.byAction.backend_api?.[0]?.rateLimitRate).toBe(1);
    t = applyObservation(t, obs(false));
    expect(t.byAction.backend_api?.[0]?.rateLimitRate).toBeCloseTo(0.5, 6);
    t = applyObservation(t, obs(false));
    expect(t.byAction.backend_api?.[0]?.rateLimitRate).toBeCloseTo(1 / 3, 6);
  });

  it('defaults to 0 when the caller does not say', () => {
    const t = applyObservation(empty(), { actionType: 'backend_api', model: 'm', score: 0.5, costMc: 0, merged: false });
    expect(t.byAction.backend_api?.[0]?.rateLimitRate).toBe(0);
  });

  it('sorts a throttled model into the trailing band of the blob', () => {
    let t = empty();
    for (let i = 0; i < 6; i += 1) {
      t = applyObservation(t, { actionType: 'backend_api', model: 'throttled', score: 0.95, costMc: 0, merged: true, rateLimited: true });
    }
    for (let i = 0; i < 6; i += 1) {
      t = applyObservation(t, { actionType: 'backend_api', model: 'healthy', score: 0.4, costMc: 0, merged: false, rateLimited: false });
    }
    expect(t.byAction.backend_api?.map((s) => s.model)).toEqual(['healthy', 'throttled']);
  });
});

// ── 3. POOL HEALTH ──────────────────────────────────────────────────────────────

describe('judgePoolHealth', () => {
  const vendors = ['a', 'b', 'c', 'd'] as unknown as VendorId[];

  it('reports rate-limited once the pool has no meaningful headroom left', () => {
    const cooled = new Set(vendors.slice(0, 3));
    const health = judgePoolHealth(vendors, cooled);
    expect(3 / 4).toBeGreaterThanOrEqual(POOL_RATE_LIMITED_RATIO);
    expect(health.rateLimited).toBe(true);
    expect(health.cooledVendors).toHaveLength(3);
  });

  it('reports healthy while real headroom remains', () => {
    expect(judgePoolHealth(vendors, new Set(vendors.slice(0, 2))).rateLimited).toBe(false);
    expect(judgePoolHealth(vendors, new Set()).rateLimited).toBe(false);
  });

  it('an EMPTY pool is a misconfiguration, not a throttle — holding on it would never clear', () => {
    expect(judgePoolHealth([], new Set()).rateLimited).toBe(false);
  });

  it('the real coding pool spans several distinct vendors', () => {
    // Guards the threshold's premise: with one vendor, 0.75 would mean "any single
    // cooldown halts the manager".
    expect(codingPoolVendors().length).toBeGreaterThan(2);
  });
});
