/**
 * Tests for the SHARED dependency-graph primitive
 * (`packages/creation-canvas-contract/src/dependencyGraph.ts`).
 *
 * It lives here because the PMO rollup is its production consumer today —
 * `computeDependencyAnalysis` is now a thin initiative-shaped adapter over it —
 * and `portfolioRollup.test.ts` beside this file already pins the adapter's
 * behaviour. These cases pin the primitive's OWN contract: the parts the PMO
 * adapter does not exercise (weights, `isBlocked`, `blocks`) and the parts both
 * callers depend on (resolved nodes leaving the path, cycle safety).
 */
import { describe, it, expect } from 'vitest';
import { analyzeDependencies, type DependencyNode, type DependencyEdge } from '@builderforce/creation-canvas-contract';

/** The canvas task vocabulary — anything not done/archived is still open. */
const taskIsOpen = (status: string | null | undefined) => !['done', 'archived', 'completed'].includes(status ?? '');

const nodes = (...ids: Array<[string, string?, number?]>): DependencyNode[] =>
  ids.map(([id, status, weight]) => ({ id, status: status ?? 'todo', ...(weight != null ? { weight } : {}) }));
const edge = (fromId: string, toId: string): DependencyEdge => ({ fromId, toId });

describe('analyzeDependencies', () => {
  it('records both directions of every edge', () => {
    const r = analyzeDependencies(nodes(['a'], ['b'], ['c']), [edge('a', 'b'), edge('b', 'c')], taskIsOpen);
    expect(r.blockedBy).toEqual({ a: [], b: ['a'], c: ['b'] });
    expect(r.blocks).toEqual({ a: ['b'], b: ['c'], c: [] });
  });

  it('marks a node blocked only while a blocker is still OPEN', () => {
    // `a` is done, so `b` is no longer held up by it; `c` is still waiting on `b`.
    const r = analyzeDependencies(nodes(['a', 'done'], ['b'], ['c']), [edge('a', 'b'), edge('b', 'c')], taskIsOpen);
    expect(r.isBlocked.b).toBe(false);
    expect(r.isBlocked.c).toBe(true);
    // The finished blocker stays in the record — "that was blocked by this, and
    // this is now done" is a true statement worth keeping.
    expect(r.blockedBy.b).toEqual(['a']);
  });

  it('takes the heaviest chain, not the longest one', () => {
    // Three 1h tasks in a row must NOT outrank a single 10h task.
    const r = analyzeDependencies(
      nodes(['s1', 'todo', 1], ['s2', 'todo', 1], ['s3', 'todo', 1], ['big', 'todo', 10]),
      [edge('s1', 's2'), edge('s2', 's3')],
      taskIsOpen,
    );
    expect(r.criticalPath).toEqual(['big']);
    expect(r.criticalPathWeight).toBe(10);
  });

  it('counts hops when no weights are given, which is what the PMO layer relies on', () => {
    const r = analyzeDependencies(nodes(['a'], ['b'], ['c'], ['solo']), [edge('a', 'b'), edge('b', 'c')], taskIsOpen);
    expect(r.criticalPath).toEqual(['a', 'b', 'c']);
    expect(r.criticalPathWeight).toBe(3);
  });

  it('drops resolved nodes out of the critical path', () => {
    const r = analyzeDependencies(
      nodes(['a', 'done'], ['b', 'done'], ['c'], ['d']),
      [edge('a', 'b'), edge('b', 'c'), edge('c', 'd')],
      taskIsOpen,
    );
    expect(r.criticalPath).toEqual(['c', 'd']);
  });

  it('flags a cycle and still terminates with a finite answer', () => {
    const r = analyzeDependencies(nodes(['a'], ['b'], ['c']), [edge('a', 'b'), edge('b', 'c'), edge('c', 'a')], taskIsOpen);
    expect(r.cycleDetected).toBe(true);
    expect(r.criticalPath.length).toBeGreaterThan(0);
    expect(r.criticalPath.length).toBeLessThanOrEqual(3);
  });

  it('ignores an edge whose endpoint is not on the board', () => {
    // A dependency pointing at a deleted object is not a dependency.
    const r = analyzeDependencies(nodes(['a'], ['b']), [edge('a', 'b'), edge('b', 'ghost'), edge('ghost', 'a')], taskIsOpen);
    expect(r.blocks.b).toEqual([]);
    expect(r.blockedBy.a).toEqual([]);
    expect(r.criticalPath).toEqual(['a', 'b']);
  });

  it('returns empty structures for an empty graph rather than throwing', () => {
    const r = analyzeDependencies([], [], taskIsOpen);
    expect(r).toEqual({ blockedBy: {}, blocks: {}, isBlocked: {}, criticalPath: [], criticalPathWeight: 0, cycleDetected: false });
  });

  it('treats a non-positive or non-finite weight as 1 rather than erasing the node', () => {
    const r = analyzeDependencies(nodes(['a', 'todo', 0], ['b', 'todo', Number.NaN]), [edge('a', 'b')], taskIsOpen);
    expect(r.criticalPathWeight).toBe(2);
  });
});
