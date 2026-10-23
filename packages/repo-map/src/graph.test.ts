/** Ports of bf-index `graph.rs` tests — the TS ranker must agree with the Rust one. */
import { describe, expect, it } from 'vitest';
import { FileGraph, moduleName, type RefRow } from './graph.js';

const r = (from: string, ident: string, to: string): RefRow => ({ from, ident, to });

describe('FileGraph (mirror of bf-index graph.rs)', () => {
  it('module names', () => {
    expect(moduleName('src/lib/config.ts')).toBe('config');
    expect(moduleName('src/store/mod.rs')).toBe('store');
    expect(moduleName('pkg/__init__.py')).toBe('pkg');
    expect(moduleName('Billing.cs')).toBe('billing');
  });

  it('a local definition is not an edge; an ambiguous one is split', () => {
    const refs = [r('a.ts', 'Foo', 'a.ts'), r('a.ts', 'Foo', 'b.ts'), r('c.ts', 'Foo', 'a.ts'), r('c.ts', 'Foo', 'b.ts')];
    const g = FileGraph.build(['a.ts', 'b.ts', 'c.ts'], refs, []);
    const [a, b, c] = ['a.ts', 'b.ts', 'c.ts'].map((p) => g.indexOf(p)!);
    expect(g.edge(a!, b!)).toBe(0);
    expect(g.edge(c!, a!)).toBeCloseTo(0.5, 12);
    expect(g.edge(c!, b!)).toBeCloseTo(0.5, 12);
  });

  it('imports, then directory, pick the definer', () => {
    const refs = [
      r('core/x.ts', 'Config', 'core/config.ts'),
      r('core/x.ts', 'Config', 'app/config.ts'),
      r('core/x.ts', 'Helper', 'util/helper.ts'),
      r('core/x.ts', 'Helper', 'core/helper2.ts'),
    ];
    const g = FileGraph.build(['core/x.ts'], refs, [['core/x.ts', 'config'], ['core/x.ts', 'helper']]);
    const x = g.indexOf('core/x.ts')!;
    expect(g.edge(x, g.indexOf('core/config.ts')!)).toBe(1);
    expect(g.edge(x, g.indexOf('app/config.ts')!)).toBe(0);
    expect(g.edge(x, g.indexOf('util/helper.ts')!)).toBe(1);
    expect(g.symbolInDegree(g.indexOf('core/config.ts')!, 'Config')).toBe(1);
  });

  it('pagerank sums to one, follows edges, and personalizes', () => {
    const refs = [r('a.ts', 'B', 'b.ts'), r('b.ts', 'C', 'c.ts'), r('d.ts', 'C', 'c.ts')];
    const g = FileGraph.build(['a.ts', 'b.ts', 'c.ts', 'd.ts'], refs, []);
    const rank = g.pagerank([]);
    expect(rank.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 6);
    const c = rank[g.indexOf('c.ts')!]!;
    expect(rank.every((v) => v <= c)).toBe(true);
    const p = [1, 1, 1, 1];
    p[g.indexOf('d.ts')!]! += 20;
    expect(g.pagerank(p)[g.indexOf('d.ts')!]!).toBeGreaterThan(rank[g.indexOf('d.ts')!]!);
  });

  it('round-trips through JSON without changing ranks', () => {
    const refs = [r('a.ts', 'B', 'b.ts'), r('b.ts', 'C', 'c.ts'), r('d.ts', 'C', 'c.ts')];
    const g = FileGraph.build(['a.ts', 'b.ts', 'c.ts', 'd.ts'], refs, []);
    const back = FileGraph.fromJSON(JSON.parse(JSON.stringify(g.toJSON())));
    expect(back.pagerank([])).toEqual(g.pagerank([]));
    expect(back.symbolInDegree(back.indexOf('c.ts')!, 'C')).toBe(2);
  });
});
