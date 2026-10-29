import { describe, expect, it } from 'vitest';
import { ROUTING_HALF_LIFE_DAYS } from '@builderforce/learned-routing';
import { applyObservation } from './routingFold';
import { routingDecayOn } from './routingReconcile';
import type { RoutingTable } from './routingTable';

const DAY = 86_400_000;
const empty = (): RoutingTable => ({ updatedAt: new Date(0).toISOString(), byAction: {} });
const obs = (score: number) => ({ actionType: 'sql' as const, model: 'm', score, costMc: 100, merged: score > 0.5 });

describe('routing table recency decay (D3)', () => {
  it('without decay the fold is plain Welford and writes no decay fields', () => {
    let t = applyObservation(empty(), obs(0));
    t = applyObservation(t, obs(1));
    const s = t.byAction.sql![0]!;
    expect(s.avgScore).toBeCloseTo(0.5);
    expect(s.effectiveN).toBeUndefined();
    expect(s.at).toBeUndefined();
  });

  it('with decay a fresh point outweighs evidence one half-life old', () => {
    const t0 = Date.UTC(2026, 8, 1);
    let t = empty();
    for (let i = 0; i < 4; i++) t = applyObservation(t, obs(0), { nowMs: t0 });
    expect(t.byAction.sql![0]!.effectiveN).toBe(4);
    t = applyObservation(t, obs(1), { nowMs: t0 + ROUTING_HALF_LIFE_DAYS * DAY });
    const s = t.byAction.sql![0]!;
    // 4 old zeros decay to weight 2, plus one fresh 1 → mean 1/3 (plain Welford: 1/5).
    expect(s.avgScore).toBeCloseTo(1 / 3);
    expect(s.effectiveN).toBeCloseTo(3);
    expect(s.n).toBe(5);
    expect(s.at).toBe(t0 + ROUTING_HALF_LIFE_DAYS * DAY);
  });

  it('a pre-decay stat (no `at`) carries its raw n undecayed', () => {
    let t = empty();
    for (let i = 0; i < 3; i++) t = applyObservation(t, obs(0));
    t = applyObservation(t, obs(1), { nowMs: Date.now() });
    expect(t.byAction.sql![0]!.avgScore).toBeCloseTo(0.25);
  });

  it('decays the table only while the lever is fully on (never per tenant)', () => {
    expect(routingDecayOn({})).toBe(true); // manifest default is 100
    expect(routingDecayOn({ COST_LEVER_D3_ROUTING_EXPLORATION: 'off' })).toBe(false);
    expect(routingDecayOn({ COST_LEVER_D3_ROUTING_EXPLORATION: '50' })).toBe(false);
  });
});
