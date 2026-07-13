import { describe, expect, it } from 'vitest';
import {
  applyObservation,
  scopeToken,
  parseScopeToken,
  MIN_SAMPLES,
  type RoutingTable,
} from './routingTable';

const empty = (): RoutingTable => ({ updatedAt: new Date(0).toISOString(), byAction: {} });

describe('scope tokens', () => {
  it('round-trips project/tenant/global', () => {
    expect(scopeToken({ kind: 'project', id: 7 })).toBe('project:7');
    expect(scopeToken({ kind: 'tenant', id: 3 })).toBe('tenant:3');
    expect(scopeToken({ kind: 'global' })).toBe('global');
    expect(parseScopeToken('project:7')).toEqual({ kind: 'project', id: 7 });
    expect(parseScopeToken('tenant:3')).toEqual({ kind: 'tenant', id: 3 });
    expect(parseScopeToken('global')).toEqual({ kind: 'global' });
  });

  it('rejects malformed scope tokens', () => {
    expect(parseScopeToken('tenant')).toBeNull(); // missing id
    expect(parseScopeToken('project:abc')).toBeNull();
    expect(parseScopeToken('project:-1')).toBeNull();
    expect(parseScopeToken('bogus:1')).toBeNull();
    expect(parseScopeToken('')).toBeNull();
    expect(parseScopeToken(undefined)).toBeNull();
  });
});

describe('applyObservation (Welford incremental == full re-aggregate)', () => {
  it("a model's running avgScore/avgCostMc match the arithmetic mean of all observations", () => {
    const scores = [0.2, 0.8, 0.5, 1.0, 0.6];
    const costs = [100, 300, 200, 50, 150];
    let table = empty();
    for (let i = 0; i < scores.length; i++) {
      table = applyObservation(table, { actionType: 'sql', model: 'm', score: scores[i]!, costMc: costs[i]!, merged: i % 2 === 0 });
    }
    const stat = table.byAction.sql!.find((s) => s.model === 'm')!;
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(stat.n).toBe(scores.length);
    expect(stat.avgScore).toBeCloseTo(mean(scores), 10);
    expect(stat.avgCostMc).toBeCloseTo(mean(costs), 6);
    // mergeRate = mean of the 0/1 merged flags (true on even indices → 3/5).
    expect(stat.mergeRate).toBeCloseTo(3 / 5, 10);
  });

  it('keeps the per-action list sorted best-first (highest avgScore leads)', () => {
    let table = empty();
    // Give model-lo many low-score runs, model-hi many high-score runs.
    for (let i = 0; i < MIN_SAMPLES; i++) {
      table = applyObservation(table, { actionType: 'sql', model: 'model-lo', score: 0.3, costMc: 0, merged: false });
      table = applyObservation(table, { actionType: 'sql', model: 'model-hi', score: 0.9, costMc: 0, merged: true });
    }
    expect(table.byAction.sql![0]!.model).toBe('model-hi');
  });

  it('does not cross-contaminate action types', () => {
    let table = empty();
    table = applyObservation(table, { actionType: 'sql', model: 'm', score: 1, costMc: 0, merged: true });
    table = applyObservation(table, { actionType: 'docs', model: 'm', score: 0, costMc: 0, merged: false });
    expect(table.byAction.sql![0]!.avgScore).toBe(1);
    expect(table.byAction.docs![0]!.avgScore).toBe(0);
  });
});
