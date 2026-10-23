import { describe, expect, it } from 'vitest';
import { DEFAULT_COLD_EXPLORATION_SHARE, posteriorEvidence, sampleQuality, shouldExploreCold } from './exploration.js';
import { rankModelsForAction, type ActionModelRankStat } from './rankModels.js';
import { ROUTING_HALF_LIFE_DAYS } from './recencyDecay.js';

/** Deterministic LCG in [0, 1) — the injected source every test uses. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
}

const stat = (model: string, n: number, avgScore: number, extra: Partial<ActionModelRankStat> = {}): ActionModelRankStat => ({
  model, n, avgScore, avgCostMc: 0, ...extra,
});

describe('rankModelsForAction · exploration off', () => {
  it('without `explore` the order is the deterministic one, whatever the rng would say', () => {
    const pool = ['a', 'b', 'cold'];
    const stats = [stat('a', 20, 0.6), stat('b', 20, 0.8)];
    expect(rankModelsForAction(pool, stats, { minSamples: 8 })).toEqual(['b', 'a', 'cold']);
  });
});

describe('rankModelsForAction · Thompson exploration', () => {
  it('a long, clearly better record leads almost every draw', () => {
    const pool = ['weak', 'strong'];
    const stats = [stat('weak', 200, 0.3), stat('strong', 200, 0.9)];
    const rng = seeded(7);
    let strongLeads = 0;
    for (let i = 0; i < 500; i++) {
      if (rankModelsForAction(pool, stats, { explore: { rng, coldShare: 0 } })[0] === 'strong') strongLeads++;
    }
    expect(strongLeads).toBe(500);
  });

  it('two close models with thin evidence trade the lead', () => {
    const pool = ['a', 'b'];
    const stats = [stat('a', 9, 0.7), stat('b', 9, 0.68)];
    const rng = seeded(11);
    const leads = { a: 0, b: 0 } as Record<string, number>;
    for (let i = 0; i < 1000; i++) leads[rankModelsForAction(pool, stats, { explore: { rng, coldShare: 0 } })[0]!]!++;
    expect(leads.a).toBeGreaterThan(300);
    expect(leads.b).toBeGreaterThan(300);
  });

  it('cold models lead at most ~5% of picks, and only through the cold slot', () => {
    const pool = ['proven', 'cold-1', 'cold-2'];
    const stats = [stat('proven', 50, 0.8)];
    const rng = seeded(3);
    const N = 4000;
    let coldLeads = 0;
    for (let i = 0; i < N; i++) {
      if (rankModelsForAction(pool, stats, { explore: { rng } })[0] !== 'proven') coldLeads++;
    }
    expect(coldLeads / N).toBeLessThanOrEqual(DEFAULT_COLD_EXPLORATION_SHARE + 0.015);
    expect(coldLeads).toBeGreaterThan(0);
  });

  it('a chronically throttled model stays last under exploration', () => {
    const pool = ['throttled', 'ok', 'cold'];
    const stats = [stat('throttled', 20, 0.99, { rateLimitRate: 0.9 }), stat('ok', 20, 0.5)];
    const rng = seeded(5);
    for (let i = 0; i < 200; i++) {
      const out = rankModelsForAction(pool, stats, { explore: { rng, coldShare: 0.5 } });
      expect(out[out.length - 1]).toBe('throttled');
      expect([...out].sort()).toEqual([...pool].sort());
    }
  });

  it('full cold start keeps the curated order even when exploring', () => {
    const pool = ['x', 'y', 'z'];
    expect(rankModelsForAction(pool, undefined, { explore: { rng: () => 0 } })).toEqual(pool);
  });
});

describe('posterior + cold slot primitives', () => {
  it('evidence decays with the stat age at read time', () => {
    const now = Date.UTC(2026, 9, 22);
    const halfLifeAgo = now - ROUTING_HALF_LIFE_DAYS * 86_400_000;
    expect(posteriorEvidence({ n: 40, avgScore: 0.5, effectiveN: 20, at: halfLifeAgo }, now)).toBeCloseTo(10);
    expect(posteriorEvidence({ n: 40, avgScore: 0.5 })).toBe(40);
  });

  it('draws stay inside [0, 1] and centre on the score with heavy evidence', () => {
    const rng = seeded(9);
    let sum = 0;
    for (let i = 0; i < 2000; i++) {
      const q = sampleQuality({ n: 5000, avgScore: 0.7 }, rng);
      expect(q).toBeGreaterThanOrEqual(0);
      expect(q).toBeLessThanOrEqual(1);
      sum += q;
    }
    expect(sum / 2000).toBeCloseTo(0.7, 2);
  });

  it('never spends the cold slot when there is no cold model or the share is 0', () => {
    expect(shouldExploreCold({ rng: () => 0 }, 0)).toBe(false);
    expect(shouldExploreCold({ rng: () => 0, coldShare: 0 }, 3)).toBe(false);
    expect(shouldExploreCold({ rng: () => 0.01 }, 3)).toBe(true);
    expect(shouldExploreCold({ rng: () => 0.2 }, 3)).toBe(false);
  });
});
