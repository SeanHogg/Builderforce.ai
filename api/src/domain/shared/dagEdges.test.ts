/**
 * THE cycle gate — the cases both dependency graphs relied on, carried over from the
 * two copies it replaced (task precedence edges keyed by number, PMO initiative edges
 * keyed by uuid string), so neither graph lost a pinned behaviour in the merge.
 */
import { describe, expect, it } from 'vitest';
import { isReachable, wouldCloseCycle } from './dagEdges';

describe('isReachable', () => {
  it('finds a direct path, in one direction only', () => {
    const edges = [[1, 2]] as const;
    expect(isReachable(edges, 1, 2)).toBe(true);
    expect(isReachable(edges, 2, 1)).toBe(false);
  });

  it('finds a transitive path', () => {
    const edges = [[1, 2], [2, 3]] as const;
    expect(isReachable(edges, 1, 3)).toBe(true);
    expect(isReachable(edges, 3, 1)).toBe(false);
  });

  it('treats start === target as reachable (the empty path)', () => {
    expect(isReachable([], 5, 5)).toBe(true);
  });

  it('terminates on a cycle already in the data', () => {
    expect(isReachable([[1, 2], [2, 1]], 1, 99)).toBe(false);
  });

  it('keeps disconnected components apart', () => {
    const edges = [[1, 2], [10, 11]] as const;
    expect(isReachable(edges, 1, 11)).toBe(false);
    expect(isReachable(edges, 10, 11)).toBe(true);
  });
});

describe('wouldCloseCycle', () => {
  // Task precedence: predecessor → successor.
  it('refuses a task edge that closes a loop and allows a shortcut', () => {
    const chain = [[1, 2], [2, 3]] as const;
    expect(wouldCloseCycle(chain, 3, 1)).toBe(true);
    expect(wouldCloseCycle(chain, 1, 3)).toBe(false);
  });

  // PMO initiatives: blocker → blocked, uuid-string keys.
  const initiatives = [['A', 'B'], ['B', 'C']] as const;
  it('refuses a self-loop', () => {
    expect(wouldCloseCycle(initiatives, 'A', 'A')).toBe(true);
  });
  it('detects a back edge (C → A)', () => {
    expect(wouldCloseCycle(initiatives, 'C', 'A')).toBe(true);
  });
  it('allows an edge that keeps the graph acyclic (A → C)', () => {
    expect(wouldCloseCycle(initiatives, 'A', 'C')).toBe(false);
  });
});
