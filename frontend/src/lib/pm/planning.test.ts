import { describe, expect, it } from 'vitest';
import {
  decompositionSourceBadge, planWarnings, windowState, windowStateLabelKey,
} from './planning';

/**
 * These three rules exist so the board card, the ticket drawer and the planning
 * spine cannot disagree about one Epic. Testing them here, once, is what makes
 * "shared" mean something more than "imported in three places".
 */

describe('decompositionSourceBadge', () => {
  it('marks the FALLBACK plan as a degradation, not a choice', () => {
    // A run of these is a model-availability incident; if it read as neutral, the
    // conclusion people reach is "the AI is bad at planning", which is the wrong fix.
    expect(decompositionSourceBadge('heuristic')?.tone).toBe('warn');
    expect(decompositionSourceBadge('llm')?.tone).toBe('accent');
    expect(decompositionSourceBadge('manual')?.tone).toBe('neutral');
  });

  it('shows nothing for a ticket that was never decomposed', () => {
    expect(decompositionSourceBadge(null)).toBeNull();
    expect(decompositionSourceBadge(undefined)).toBeNull();
    expect(decompositionSourceBadge('something-else')).toBeNull();
  });
});

describe('planWarnings', () => {
  const clean = { compressed: false, overruns: [], cyclic: [], capacityDeferred: [] };

  it('says nothing about a clean plan or a missing verdict', () => {
    expect(planWarnings(null)).toEqual([]);
    expect(planWarnings(clean)).toEqual([]);
  });

  it('warns that a COMPRESSED plan does not fit, even though its windows do', () => {
    const [w] = planWarnings({ ...clean, compressed: true });
    expect(w?.kind).toBe('does-not-fit');
    expect(w?.titleKey).toBe('warning.compressedTitle');
  });

  it('warns about overruns and names how many', () => {
    const [w] = planWarnings({ ...clean, overruns: ['1', '2'] });
    expect(w).toMatchObject({ kind: 'does-not-fit', titleKey: 'warning.overrunTitle', count: 2 });
  });

  it('puts a dependency CYCLE first — it invalidates the order, not just the dates', () => {
    const warnings = planWarnings({ ...clean, compressed: true, cyclic: ['3'] });
    expect(warnings.map((w) => w.kind)).toEqual(['cyclic', 'does-not-fit']);
    expect(warnings[0]?.tone).toBe('danger');
  });

  it('does NOT warn about capacity deferral', () => {
    // The plan still lands inside its window; one person is simply the constraint.
    expect(planWarnings({ ...clean, capacityDeferred: ['1', '2', '3'] })).toEqual([]);
  });
});

describe('windowState', () => {
  it('separates "not yet scoped" from "no dates"', () => {
    expect(windowState({ kind: 'objective', startDate: null, endDate: null })).toBe('not-yet-scoped');
    expect(windowState({ kind: 'task', startDate: null, endDate: null })).toBe('undated');
  });

  it('trusts the server flag over the local kind guess', () => {
    expect(windowState({ kind: 'task', startDate: null, endDate: null, notYetScoped: true })).toBe('not-yet-scoped');
    expect(windowState({ kind: 'epic', startDate: null, endDate: null, notYetScoped: false })).toBe('undated');
  });

  it('calls a derived window derived, so a rollup is not read as a commitment', () => {
    expect(windowState({ kind: 'epic', startDate: '2026-01-01', endDate: null, datesDerived: true })).toBe('derived');
    expect(windowState({ kind: 'epic', startDate: '2026-01-01', endDate: '2026-02-01' })).toBe('scoped');
  });

  it('gives a label only where there are no dates to show', () => {
    expect(windowStateLabelKey('not-yet-scoped')).toBe('notYetScoped');
    expect(windowStateLabelKey('undated')).toBe('undated');
    expect(windowStateLabelKey('scoped')).toBeNull();
    expect(windowStateLabelKey('derived')).toBeNull();
  });
});
