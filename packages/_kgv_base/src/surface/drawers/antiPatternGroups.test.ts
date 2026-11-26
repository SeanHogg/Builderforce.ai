import { describe, expect, it } from 'vitest';
import type { Finding } from '@seanhogg/builderforce-memory/knowledge';
import { surfaceFixture } from '../../testing';
import { buildStations } from '../stations';
import { groupAntiPatterns, kindTotals } from './antiPatternGroups';
import { ruleOf } from './antiPatternRules';

const ref = (p: string) => `src:sys::${p}` as Finding['nodes'][number];
const violation = (from: string, to: string, verdict: 'upward' | 'skips', a: string, b: string): Finding => ({
    id: `pv:${a}|${b}`, kind: 'partition-violation', pack: 'code', nodes: [ref(a), ref(b)], severity: 'error', params: { verdict, from, to, kind: 'references' },
});
const god = (path: string): Finding => ({ id: `god:${path}`, kind: 'god-module', pack: 'code', nodes: [ref(path)], severity: 'warn', params: { lines: 2000, linesLimit: 1000 } });

describe('groupAntiPatterns', () => {
    it('folds layer violations by verdict and layer pair, every other kind by kind, biggest first', () => {
        const groups = groupAntiPatterns([
            violation('domain', 'application', 'upward', 'a', 'b'), violation('domain', 'application', 'upward', 'a', 'c'),
            violation('entry', 'domain', 'skips', 'd', 'e'), god('big.ts'),
        ]);
        expect(groups.map((g) => [g.id, g.count])).toEqual([
            ['partition-violation:upward:domain>application', 2], ['god-module', 1], ['partition-violation:skips:entry>domain', 1],
        ]);
        const first = groups[0]!;
        expect(first).toMatchObject({ kind: 'partition-violation', from: 'domain', to: 'application', verdict: 'upward' });
        // The file touched by both findings ranks first.
        expect(first.files[0]).toBe(ref('a'));
        expect(first.files).toHaveLength(3);
        expect(groups[1]!.from).toBeUndefined();
    });

    it('filters by layer through the station model', () => {
        const graph = surfaceFixture();
        const model = buildStations(graph, { changed: new Set() });
        const all = groupAntiPatterns(graph.findings);
        expect(all.length).toBe(2);
        const layers = new Set(graph.findings.map((f) => f.nodes[0]));
        expect(layers.size).toBeGreaterThan(0);
        expect(groupAntiPatterns(graph.findings, { layer: 'nowhere', model })).toEqual([]);
        expect(groupAntiPatterns(graph.findings, { layer: 'entry', model }).length).toBeGreaterThan(0);
    });

    it('groups 20,000 findings quickly and deterministically', () => {
        const many: Finding[] = Array.from({ length: 20000 }, (_, i) =>
            violation(i % 2 ? 'domain' : 'infrastructure', 'application', i % 3 ? 'upward' : 'skips', `f${i % 500}.ts`, `g${i % 700}.ts`));
        const t0 = performance.now();
        const a = groupAntiPatterns(many);
        expect(performance.now() - t0).toBeLessThan(1500);
        expect(a.reduce((n, g) => n + g.count, 0)).toBe(20000);
        expect(groupAntiPatterns([...many].reverse()).map((g) => g.id)).toEqual(a.map((g) => g.id));
        expect(kindTotals(a)).toEqual([{ kind: 'partition-violation', count: 20000 }]);
    });
});

describe('ruleOf', () => {
    it('is data: known kinds have their picture, any other kind reads the generic row', () => {
        expect(ruleOf('partition-violation').diagram).toBe('layerArrow');
        expect(ruleOf('god-module').diagram).toBe('measures');
        expect(ruleOf('clone-group').diagram).toBe('none');
    });
});
