import { describe, expect, it } from 'vitest';
import { reachableFrom, topoOrder, wouldCycle } from './graphCycle';

const edges = (...pairs: Array<[string, string]>) => pairs.map(([from, to]) => ({ from, to }));

describe('reachableFrom', () => {
  it('follows a chain to its end', () => {
    expect([...reachableFrom(edges(['a', 'b'], ['b', 'c'], ['c', 'd']), 'a')]).toEqual(['b', 'c', 'd']);
  });

  it('returns nothing for a node with no outgoing edges', () => {
    expect(reachableFrom(edges(['a', 'b']), 'b').size).toBe(0);
  });

  it('terminates on a graph that already contains a cycle', () => {
    // Not a hypothetical: the check is run BEFORE an edge is stored, and a
    // pre-existing loop (from a direct DB write, or from before this guard) must
    // not hang the request that discovers it.
    expect(reachableFrom(edges(['a', 'b'], ['b', 'a']), 'a').has('a')).toBe(true);
  });
});

describe('wouldCycle', () => {
  it('refuses a self-edge — which the unique index does not', () => {
    expect(wouldCycle([], 'a', 'a')).toBe(true);
  });

  it('refuses the edge that closes a loop, in either length', () => {
    expect(wouldCycle(edges(['b', 'a']), 'a', 'b')).toBe(true);
    expect(wouldCycle(edges(['b', 'c'], ['c', 'a']), 'a', 'b')).toBe(true);
  });

  it('allows a diamond — two paths to the same node are not a cycle', () => {
    expect(wouldCycle(edges(['a', 'b'], ['a', 'c'], ['b', 'd']), 'c', 'd')).toBe(false);
  });

  it('allows an edge between two unrelated components', () => {
    expect(wouldCycle(edges(['a', 'b'], ['c', 'd']), 'b', 'c')).toBe(false);
  });
});

describe('topoOrder', () => {
  it('orders prerequisites before what needs them', () => {
    const order = topoOrder(['c', 'a', 'b'], edges(['a', 'b'], ['b', 'c']));
    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('is stable — ties break on the order the nodes were given', () => {
    expect(topoOrder(['x', 'y', 'z'], [])).toEqual(['x', 'y', 'z']);
  });

  it('returns null rather than a wrong order when the graph has a cycle', () => {
    expect(topoOrder(['a', 'b'], edges(['a', 'b'], ['b', 'a']))).toBeNull();
  });

  it('ignores an edge that leaves the node set', () => {
    // A prerequisite on a course the learner cannot see must not delete every
    // course that depends on it from the sequence.
    expect(topoOrder(['a', 'b'], edges(['hidden', 'b'], ['a', 'b']))).toEqual(['a', 'b']);
  });
});
