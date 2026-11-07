import type { KEdge, KNode, KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { describe, expect, it } from 'vitest';
import { surfaceFixture } from '../testing';
import { buildStations } from './stations';
import { MAX_REACH_DEPTH, reachOf, staticReach } from './staticReach';

const ref = (path: string) => `src:r::${path}` as KNode['ref'];
const file = (path: string, extra: Partial<KNode> = {}): KNode => ({ ref: ref(path), kind: 'file', label: path, pack: 'code', importance: 0.5, origin: 'extracted', sourceHash: `h:${path}`, partition: 'application', ...extra });
const link = (from: string, to: string): KEdge => ({ from: ref(from), to: ref(to), kind: 'references', weight: 1, origin: 'extracted' });

function graphOf(nodes: KNode[], edges: KEdge[]): KnowledgeGraph {
    return {
        scope: { rootId: 'r', packs: ['code'], digest: 'd' }, nodes, edges, findings: [],
        stats: { sources: nodes.length, nodes: nodes.length, edges: edges.length, stale: 0, truncated: false },
    };
}

const chain = () => graphOf(
    [file('a/a.test.ts'), file('a/helper.ts'), file('a/one.ts'), file('b/two.ts'), file('c/lonely.ts')],
    [link('a/a.test.ts', 'a/helper.ts'), link('a/helper.ts', 'a/one.ts'), link('a/one.ts', 'b/two.ts')],
);

describe('staticReach', () => {
    it('reaches a file through two hops of references, and not one nothing leads to', () => {
        const reach = staticReach(chain())!;
        expect([...reach.reached].sort()).toEqual([ref('a/helper.ts'), ref('a/one.ts'), ref('b/two.ts')].sort());
        expect(reach.reached.has(ref('c/lonely.ts'))).toBe(false);
        expect(reach.tests.has(ref('a/a.test.ts'))).toBe(true);
    });

    it('does not count the test files themselves as reached', () => {
        expect(staticReach(chain())!.reached.has(ref('a/a.test.ts'))).toBe(false);
    });

    it('stops at the depth cap', () => {
        const names = Array.from({ length: MAX_REACH_DEPTH + 3 }, (_, i) => `m/f${i}.ts`);
        const g = graphOf([file('m/x.test.ts'), ...names.map((n) => file(n))], [link('m/x.test.ts', names[0]!), ...names.slice(1).map((n, i) => link(names[i]!, n))]);
        const reach = staticReach(g)!;
        expect(reach.reached.has(ref(names[MAX_REACH_DEPTH - 1]!))).toBe(true);
        expect(reach.reached.has(ref(names[MAX_REACH_DEPTH]!))).toBe(false);
    });

    it('is null when the graph has no test file (reach is not measurable, not 0%)', () => {
        expect(staticReach(surfaceFixture())).toBeNull();
        expect(reachOf(null, [ref('a/one.ts')])).toBeUndefined();
    });

    it('is computed once per graph', () => {
        const g = chain();
        expect(staticReach(g)).toBe(staticReach(g));
    });

    it('measures the share of the given files reached, ignoring test files', () => {
        const reach = staticReach(chain())!;
        expect(reachOf(reach, [ref('a/one.ts'), ref('c/lonely.ts')])).toBe(0.5);
        expect(reachOf(reach, [ref('a/a.test.ts')])).toBeUndefined();
    });
});

describe('station coverage from static reach', () => {
    const area = (name: string): KNode => ({ ref: ref(`area/${name}`), kind: 'area', label: name, pack: 'code', importance: 0.5, origin: 'extracted', sourceHash: `h:${name}` });
    const inArea = (n: KNode, name: string): KNode => ({ ...n, area: ref(`area/${name}`) });
    const build = (badge?: number) => {
        const g = chain();
        const nodes = [area('A'), area('B'), area('C'), ...g.nodes.map((n) => {
            const own = n.ref.includes('::a/') ? 'A' : n.ref.includes('::b/') ? 'B' : 'C';
            return inArea(badge !== undefined && n.ref === ref('c/lonely.ts') ? { ...n, badges: { coverage: badge } } : n, own);
        })];
        return buildStations({ ...g, nodes });
    };

    it('fills cov from the reach, as a heuristic, when no file carries a coverage badge', () => {
        const model = build();
        const by = (n: string) => model.stations.find((s) => s.path === n || s.name === n)!;
        expect(by('A')).toMatchObject({ cov: 1, covProvenance: 'heuristic' });
        expect(by('B')).toMatchObject({ cov: 1, covProvenance: 'heuristic' });
        expect(by('C')).toMatchObject({ cov: 0, covProvenance: 'heuristic' });
    });

    it('keeps the measured coverage, and no reach, once any file carries a badge', () => {
        const model = build(0.9);
        expect(model.stations.find((s) => s.name === 'C')).toMatchObject({ cov: 0.9, covProvenance: 'runtime' });
        expect(model.stations.find((s) => s.name === 'B')!.cov).toBeUndefined();
    });
});
