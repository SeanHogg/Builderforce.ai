import { describe, expect, it } from 'vitest';
import { hasPathReachingTarget, type DependencyEdge } from './taskDependencies';

// Build edges with just the fields the graph walk reads.
function edge(predecessorTaskId: number, successorTaskId: number): DependencyEdge {
  return {
    id: predecessorTaskId * 1000 + successorTaskId,
    projectId: 1,
    predecessorTaskId,
    successorTaskId,
    depType: 'finish_to_start',
    createdAt: new Date(0),
  };
}

describe('hasPathReachingTarget (cycle gate)', () => {
  it('finds a direct path', () => {
    // 1 → 2. From 2, can we reach 1? No. From 1, reach 2? Yes.
    const edges = [edge(1, 2)];
    expect(hasPathReachingTarget(edges, 1, 2)).toBe(true);
    expect(hasPathReachingTarget(edges, 2, 1)).toBe(false);
  });

  it('finds a transitive path', () => {
    // 1 → 2 → 3. From 1, reach 3? Yes (transitively).
    const edges = [edge(1, 2), edge(2, 3)];
    expect(hasPathReachingTarget(edges, 1, 3)).toBe(true);
    expect(hasPathReachingTarget(edges, 3, 1)).toBe(false);
  });

  it('rejects adding an edge that would close a cycle', () => {
    // Existing chain 1 → 2 → 3. Adding 3 → 1 would create a cycle: it does iff
    // successor(1) already reaches predecessor(3). It does (1 → 2 → 3).
    const edges = [edge(1, 2), edge(2, 3)];
    expect(hasPathReachingTarget(edges, /* successor */ 1, /* predecessor */ 3)).toBe(true);
  });

  it('allows a non-cyclic edge', () => {
    // Chain 1 → 2 → 3. Adding 1 → 3 (a shortcut) is safe: does successor(3) reach
    // predecessor(1)? No. So no cycle.
    const edges = [edge(1, 2), edge(2, 3)];
    expect(hasPathReachingTarget(edges, /* successor */ 3, /* predecessor */ 1)).toBe(false);
  });

  it('returns true immediately when from === target', () => {
    expect(hasPathReachingTarget([], 5, 5)).toBe(true);
  });

  it('terminates on an existing cycle in the data (defensive)', () => {
    // Corrupt data: 1 → 2 → 1. The walk must not loop forever.
    const edges = [edge(1, 2), edge(2, 1)];
    expect(hasPathReachingTarget(edges, 1, 99)).toBe(false);
  });

  it('handles disconnected components', () => {
    const edges = [edge(1, 2), edge(10, 11)];
    expect(hasPathReachingTarget(edges, 1, 11)).toBe(false);
    expect(hasPathReachingTarget(edges, 10, 11)).toBe(true);
  });
});
