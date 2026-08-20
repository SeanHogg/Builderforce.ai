import { describe, it, expect } from 'vitest';
import { cycleEdges, edgeKey, layoutDag } from './graphLayout';

const n = (...ids: string[]) => ids.map((id) => ({ id }));
const e = (...pairs: [string, string][]) => pairs.map(([from, to]) => ({ from, to }));

describe('layoutDag', () => {
  it('layers a chain by depth', () => {
    const l = layoutDag(n('a', 'b', 'c'), e(['a', 'b'], ['b', 'c']));
    expect(l.byId.get('a')!.layer).toBe(0);
    expect(l.byId.get('b')!.layer).toBe(1);
    expect(l.byId.get('c')!.layer).toBe(2);
    expect(l.layerCount).toBe(3);
    expect(l.maxRows).toBe(1);
  });

  it('uses the LONGEST path so no edge ever points backwards in an acyclic graph', () => {
    // a→b→c and a→c: shortest-path layering would put c at layer 1, beside b, and
    // draw b→c as a sideways arrow. It belongs at layer 2.
    const l = layoutDag(n('a', 'b', 'c'), e(['a', 'b'], ['b', 'c'], ['a', 'c']));
    expect(l.byId.get('c')!.layer).toBe(2);
    expect(l.backEdges.size).toBe(0);
  });

  it('packs each layer into rows in input order', () => {
    const l = layoutDag(n('root', 'x', 'y', 'z'), e(['root', 'x'], ['root', 'y'], ['root', 'z']));
    expect(l.rowsPerLayer).toEqual([1, 3]);
    expect([l.byId.get('x')!.row, l.byId.get('y')!.row, l.byId.get('z')!.row]).toEqual([0, 1, 2]);
  });

  it('terminates on a cycle and still places every node', () => {
    // The whole reason this is Kahn + a bounded fallback rather than "relax until
    // stable": a 2-cycle makes the naive version spin forever.
    const l = layoutDag(n('a', 'b', 'c'), e(['a', 'b'], ['b', 'c'], ['c', 'b']));
    expect(l.positions).toHaveLength(3);
    expect(l.positions.every((p) => Number.isFinite(p.layer))).toBe(true);
  });

  it('flags the closing edge of a cycle as a back edge', () => {
    const l = layoutDag(n('a', 'b'), e(['a', 'b'], ['b', 'a']));
    expect(l.backEdges.has(edgeKey('b', 'a'))).toBe(true);
    expect(l.backEdges.has(edgeKey('a', 'b'))).toBe(false);
  });

  it('is stable — the same input yields an identical layout every time', () => {
    const nodes = n('a', 'b', 'c', 'd');
    const edges = e(['a', 'c'], ['b', 'c'], ['c', 'd'], ['d', 'a']);
    const first = layoutDag(nodes, edges);
    const second = layoutDag(nodes, edges);
    expect(second.positions).toEqual(first.positions);
    expect([...second.backEdges]).toEqual([...first.backEdges]);
  });

  it('ignores edges naming a node outside the graph slice', () => {
    const l = layoutDag(n('a', 'b'), e(['a', 'b'], ['a', 'ghost'], ['ghost', 'b']));
    expect(l.positions).toHaveLength(2);
    expect(l.byId.get('b')!.layer).toBe(1);
  });

  it('ignores self-edges rather than layering a node behind itself', () => {
    const l = layoutDag(n('a'), e(['a', 'a']));
    expect(l.byId.get('a')!.layer).toBe(0);
    expect(l.backEdges.size).toBe(0);
  });

  it('handles the empty graph', () => {
    const l = layoutDag([], []);
    expect(l.positions).toEqual([]);
    expect(l.layerCount).toBe(0);
    expect(l.maxRows).toBe(0);
  });
});

describe('cycleEdges', () => {
  it('finds every edge on a cycle and nothing else', () => {
    const found = cycleEdges(e(['a', 'b'], ['b', 'c'], ['c', 'a'], ['c', 'd']));
    expect(found.has(edgeKey('a', 'b'))).toBe(true);
    expect(found.has(edgeKey('b', 'c'))).toBe(true);
    expect(found.has(edgeKey('c', 'a'))).toBe(true);
    expect(found.has(edgeKey('c', 'd'))).toBe(false);
  });

  it('reports nothing for an acyclic graph, including diamonds', () => {
    expect(cycleEdges(e(['a', 'b'], ['a', 'c'], ['b', 'd'], ['c', 'd'])).size).toBe(0);
  });

  it('is not the same question as a back edge', () => {
    // b→a is a back edge in the LAYOUT of a→b→a, and it is also on a cycle. But an
    // edge can be one without the other, which is why the two live apart.
    const edges = e(['a', 'b'], ['b', 'a']);
    expect(cycleEdges(edges).size).toBe(2);
    expect(layoutDag(n('a', 'b'), edges).backEdges.size).toBe(1);
  });
});
