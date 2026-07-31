import { describe, it, expect } from 'vitest';
import {
  keyResultProgress,
  objectiveProgress,
  computeDependencyAnalysis,
  wouldCreateCycle,
  foldPortfolioBreakdown,
} from './portfolioRollup';

describe('keyResultProgress', () => {
  it('interpolates numeric KRs from start→target', () => {
    expect(keyResultProgress({ metricType: 'number', startValue: 0, targetValue: 100, currentValue: 25 })).toBeCloseTo(0.25);
    expect(keyResultProgress({ metricType: 'number', startValue: 0, targetValue: 100, currentValue: 100 })).toBe(1);
  });

  it('honours a non-zero baseline (no double counting)', () => {
    // 50→100, currently 75 → halfway, not 0.75
    expect(keyResultProgress({ metricType: 'number', startValue: 50, targetValue: 100, currentValue: 75 })).toBeCloseTo(0.5);
  });

  it('clamps to [0,1] beyond target or below start', () => {
    expect(keyResultProgress({ metricType: 'percent', startValue: 0, targetValue: 80, currentValue: 120 })).toBe(1);
    expect(keyResultProgress({ metricType: 'currency', startValue: 100, targetValue: 200, currentValue: 50 })).toBe(0);
  });

  it('supports a decreasing target (start > target)', () => {
    // reduce bug count 40→10, currently 25 → halfway done
    expect(keyResultProgress({ metricType: 'number', startValue: 40, targetValue: 10, currentValue: 25 })).toBeCloseTo(0.5);
  });

  it('treats boolean KRs as binary', () => {
    expect(keyResultProgress({ metricType: 'boolean', startValue: 0, targetValue: 1, currentValue: 1 })).toBe(1);
    expect(keyResultProgress({ metricType: 'boolean', startValue: 0, targetValue: 1, currentValue: 0 })).toBe(0);
  });

  it('handles a zero-width target', () => {
    expect(keyResultProgress({ metricType: 'number', startValue: 100, targetValue: 100, currentValue: 100 })).toBe(1);
    expect(keyResultProgress({ metricType: 'number', startValue: 100, targetValue: 100, currentValue: 99 })).toBe(0);
  });
});

describe('objectiveProgress', () => {
  it('averages key-result progress', () => {
    expect(objectiveProgress([0.5, 1, 0])).toBeCloseTo(0.5);
  });

  it('is 0 for an objective with no key results', () => {
    expect(objectiveProgress([])).toBe(0);
  });
});

describe('computeDependencyAnalysis', () => {
  const inits = (statuses: Record<string, string>) =>
    Object.entries(statuses).map(([id, status]) => ({ id, name: id, status }));

  it('finds the longest incomplete chain as the critical path', () => {
    // A → B → C (all active) and a stray D → E
    const a = computeDependencyAnalysis(
      inits({ A: 'active', B: 'active', C: 'active', D: 'active', E: 'active' }),
      [
        { fromInitiativeId: 'A', toInitiativeId: 'B' },
        { fromInitiativeId: 'B', toInitiativeId: 'C' },
        { fromInitiativeId: 'D', toInitiativeId: 'E' },
      ],
    );
    expect(a.criticalPath).toEqual(['A', 'B', 'C']);
    expect(a.cycleDetected).toBe(false);
    expect(a.blockedBy.B).toEqual(['A']);
    expect(a.blockedBy.C).toEqual(['B']);
  });

  it('drops completed initiatives from the path', () => {
    // B is done, so the A→B→C chain breaks; longest incomplete chain is length 1
    const a = computeDependencyAnalysis(
      inits({ A: 'active', B: 'completed', C: 'active' }),
      [
        { fromInitiativeId: 'A', toInitiativeId: 'B' },
        { fromInitiativeId: 'B', toInitiativeId: 'C' },
      ],
    );
    expect(a.criticalPath.length).toBe(1);
  });

  it('flags a cycle among incomplete initiatives', () => {
    const a = computeDependencyAnalysis(
      inits({ A: 'active', B: 'active' }),
      [
        { fromInitiativeId: 'A', toInitiativeId: 'B' },
        { fromInitiativeId: 'B', toInitiativeId: 'A' },
      ],
    );
    expect(a.cycleDetected).toBe(true);
  });
});

describe('foldPortfolioBreakdown', () => {
  const portfolios = [{ id: 'pfB', name: 'Beta' }, { id: 'pfA', name: 'Alpha' }];
  const initiativeRow = (initiativeId: string, projectCount: number, completedCount: number, agentLlmCostUsd: number) =>
    ({ initiativeId, projectCount, completedCount, agentLlmCostUsd });
  const ofInit = (pairs: Array<[string, string | null]>) => new Map<string, string | null>(pairs);

  it('folds initiatives into their portfolio and sums projects/completed/cost', () => {
    const rows = foldPortfolioBreakdown(
      portfolios,
      [initiativeRow('i1', 2, 3, 10), initiativeRow('i2', 1, 1, 5)],
      ofInit([['i1', 'pfA'], ['i2', 'pfA']]),
      [],
    );
    const alpha = rows.find((r) => r.portfolioId === 'pfA')!;
    expect(alpha.initiativeCount).toBe(2);
    expect(alpha.projectCount).toBe(3);
    expect(alpha.completedCount).toBe(4);
    expect(alpha.agentLlmCostUsd).toBe(15);
  });

  it('seeds every portfolio (empty ones show as zero rows) and sorts alphabetically', () => {
    const rows = foldPortfolioBreakdown(portfolios, [], ofInit([]), []);
    expect(rows.map((r) => r.name)).toEqual(['Alpha', 'Beta']);
    expect(rows.every((r) => r.initiativeCount === 0 && r.avgProgress === 0)).toBe(true);
  });

  it('buckets portfolio-less initiatives under Unassigned, placed last', () => {
    const rows = foldPortfolioBreakdown(
      portfolios,
      [initiativeRow('i1', 1, 0, 0), initiativeRow('iOrphan', 4, 2, 9)],
      ofInit([['i1', 'pfA'], ['iOrphan', null]]),
      [],
    );
    expect(rows[rows.length - 1]!.portfolioId).toBeNull();
    const unassigned = rows.find((r) => r.portfolioId === null)!;
    expect(unassigned.projectCount).toBe(4);
    expect(unassigned.completedCount).toBe(2);
  });

  it('drops an Unassigned bucket that carries nothing', () => {
    const rows = foldPortfolioBreakdown(portfolios, [initiativeRow('i1', 1, 0, 0)], ofInit([['i1', 'pfA']]), []);
    expect(rows.some((r) => r.portfolioId === null)).toBe(false);
  });

  it('averages OKR progress by the objective portfolio (own or via its initiative)', () => {
    const rows = foldPortfolioBreakdown(
      portfolios,
      [initiativeRow('i1', 1, 0, 0)],
      ofInit([['i1', 'pfA']]),
      [
        { portfolioId: 'pfA', initiativeId: null, projectId: null, progress: 1 }, // direct
        { portfolioId: null, initiativeId: 'i1', projectId: null, progress: 0 }, // via initiative → pfA
        { portfolioId: null, initiativeId: null, projectId: 42, progress: 0.5 }, // project-only → ignored
      ],
    );
    const alpha = rows.find((r) => r.portfolioId === 'pfA')!;
    expect(alpha.avgProgress).toBeCloseTo(0.5); // mean of 1 and 0; project-only excluded
  });
});

describe('wouldCreateCycle', () => {
  const edges = [
    { fromInitiativeId: 'A', toInitiativeId: 'B' },
    { fromInitiativeId: 'B', toInitiativeId: 'C' },
  ];
  it('rejects a self-loop', () => {
    expect(wouldCreateCycle(edges, 'A', 'A')).toBe(true);
  });
  it('detects a back edge that closes a cycle (C → A)', () => {
    expect(wouldCreateCycle(edges, 'C', 'A')).toBe(true);
  });
  it('allows an edge that keeps the graph acyclic (A → C)', () => {
    expect(wouldCreateCycle(edges, 'A', 'C')).toBe(false);
  });
});
