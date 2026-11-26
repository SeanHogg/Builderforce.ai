import { describe, expect, it } from 'vitest';
import type { Finding, KEdge, KNode, KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { codeFixture } from '../../testing';
import type { SymbolRecord } from '../../types';
import { isRestructurable, needsSymbols, PROPOSERS, proposeRestructure } from './restructure';

const R = (path: string) => `src:r::${path}`;
const node = (path: string, extra: Partial<KNode> = {}): KNode =>
    ({ ref: R(path) as KNode['ref'], kind: 'file', label: path, pack: 'code', importance: 0.6, origin: 'extracted', sourceHash: `h:${path}`, ...extra });
const edge = (from: string, to: string): KEdge => ({ from: R(from) as KEdge['from'], to: R(to) as KEdge['to'], kind: 'references', weight: 1, origin: 'extracted' });
const sym = (name: string, line: number, over: Partial<SymbolRecord> = {}, rel: string[] = []): SymbolRecord => ({
    ref: `${R('api/big.ts')}#${name}`, name, kind: 'function', parent: R('api/big.ts'), line, exported: true,
    relations: rel.map((to) => ({ kind: 'calls', to })), ...over,
});
const inBig = (name: string) => `${R('api/big.ts')}#${name}`;

function godGraph(): { graph: KnowledgeGraph; finding: Finding } {
    const finding: Finding = { id: 'god1', kind: 'god-module', pack: 'code', nodes: [R('api/big.ts') as never], severity: 'warn', params: { lines: 900 } };
    const graph: KnowledgeGraph = {
        scope: { rootId: 'r', packs: ['code'], digest: 'd' },
        nodes: [node('web/caller.ts'), node('api/big.ts', { badges: { patterns: 'god-module', lines: 900, coverage: 0.5 } }), node('lib/util.ts')],
        edges: [edge('web/caller.ts', 'api/big.ts'), edge('api/big.ts', 'lib/util.ts')],
        findings: [finding], stats: { sources: 3, nodes: 3, edges: 2, stale: 0, truncated: false },
    };
    return { graph, finding };
}

/** fetchUsers → parseUser (an `@line` ref); renderPage → renderRow, renderRow reaches util; `helper` is tied to nothing; `Svc` is a class with a method. */
const SYMBOLS: SymbolRecord[] = [
    sym('fetchUsers', 1, {}, [inBig('parseUser')]),
    sym('parseUser', 5, { ref: `${inBig('parseUser')}@5`, exported: false }),
    sym('renderPage', 20, {}, [inBig('renderRow')]),
    sym('renderRow', 25, { exported: false }, [R('lib/util.ts#fmt')]),
    sym('helper', 40, { exported: false }),
    sym('Svc', 50, { kind: 'class' }),
    sym('Svc.run', 51, { kind: 'method', parent: inBig('Svc'), exported: false }),
];

describe('restructure: the table', () => {
    it('only the kinds with a proposer are restructurable; only god-module needs symbols', () => {
        expect(Object.keys(PROPOSERS).sort()).toEqual(['god-module', 'partition-violation']);
        expect(isRestructurable('god-module')).toBe(true);
        expect(isRestructurable('partition-violation')).toBe(true);
        for (const k of ['cycle', 'clone-group', 'unused-file', 'constructor', 'toString']) expect(isRestructurable(k), k).toBe(false);
        expect(needsSymbols('god-module')).toBe(true);
        expect(needsSymbols('partition-violation')).toBe(false);
    });

    it('proposeRestructure is null for a kind with no row', () => {
        const g = codeFixture('code');
        expect(proposeRestructure(g, g.findings.find((f) => f.kind === 'cycle')!, [])).toBeNull();
    });
});

describe('restructure: partition-violation', () => {
    const g = codeFixture('code');
    const ref = (p: string) => `src:code::${p}`;
    const find = (v: string) => g.findings.find((f) => f.kind === 'partition-violation' && f.params['verdict'] === v)!;

    it('a skipping edge is routed through the layer between; the finding is resolved', () => {
        const p = proposeRestructure(g, find('skips'), [])!;
        const pairs = p.after.edges.map((e) => `${e.from}>${e.to}`);
        expect(pairs).not.toContain(`${ref('app/page.tsx')}>${ref('infrastructure/db.ts')}`);
        expect(pairs).toContain(`${ref('app/page.tsx')}>${ref('application/charge.ts')}`);
        expect(pairs).toContain(`${ref('application/charge.ts')}>${ref('infrastructure/db.ts')}`);
        expect(p.after.findings.some((f) => f.id === find('skips').id)).toBe(false);
        expect(p.after.nodes).toBe(g.nodes);
        expect(p.bornFrom.size).toBe(0);
        expect(p.after.stats.edges).toBe(p.after.edges.length);
    });

    it('an upward edge with no layer between is dropped, and the input graph is untouched', () => {
        const before = g.edges.length;
        const p = proposeRestructure(g, find('upward'), [])!;
        expect(p.after.edges.some((e) => e.from === ref('domain/invoice.ts') && e.to === ref('application/charge.ts'))).toBe(false);
        expect(p.after.edges.length).toBe(before - 1);
        expect(g.edges.length).toBe(before);
    });

    it('is null when the finding names an edge the graph does not have', () => {
        const f = { ...find('skips'), nodes: [ref('app/page.tsx'), ref('domain/invoice.ts')] as never };
        expect(proposeRestructure(g, f, [])).toBeNull();
    });
});

describe('restructure: god-module', () => {
    it('splits the file into cohesive modules bornFrom it, edges re-pointed', () => {
        const { graph, finding } = godGraph();
        const p = proposeRestructure(graph, finding, SYMBOLS)!;
        const a = R('api/big.fetchUsers.ts'), b = R('api/big.renderPage.ts');
        expect(p.after.nodes.map((n) => n.ref)).toEqual([R('web/caller.ts'), a, b, R('lib/util.ts')]);
        expect([...p.bornFrom]).toEqual([[a, R('api/big.ts')], [b, R('api/big.ts')]]);
        const edges = p.after.edges.map((e) => `${e.from}>${e.to}`);
        // a caller of the file depends on every part; the part whose definition reaches util owns that edge.
        expect(edges.sort()).toEqual([`${R('web/caller.ts')}>${a}`, `${R('web/caller.ts')}>${b}`, `${b}>${R('lib/util.ts')}`].sort());
        expect(p.after.findings).toEqual([]);
        expect(p.after.stats).toMatchObject({ nodes: 4, edges: 3 });
    });

    it('groups components of internal calls; a lone definition joins the nearest by line; a class keeps its methods', () => {
        const { graph, finding } = godGraph();
        const p = proposeRestructure(graph, finding, SYMBOLS)!;
        const a = p.after.nodes.find((n) => n.ref === R('api/big.fetchUsers.ts'))!, b = p.after.nodes.find((n) => n.ref === R('api/big.renderPage.ts'))!;
        // {fetchUsers, parseUser} = 2 members; {renderPage, renderRow, helper, Svc + Svc.run} = 5 of 7.
        expect(a.importance).toBeCloseTo(0.6 * 2 / 7);
        expect(b.importance).toBeCloseTo(0.6 * 5 / 7);
    });

    it('a new module is a file: its own label, no hash, the god-module measures dropped, the rest kept', () => {
        const { graph, finding } = godGraph();
        const m = proposeRestructure(graph, finding, SYMBOLS)!.after.nodes.find((n) => n.ref === R('api/big.fetchUsers.ts'))!;
        expect(m).toMatchObject({ kind: 'file', pack: 'code', label: 'api/big.fetchUsers.ts', badges: { coverage: 0.5 } });
        expect(m.sourceHash).toBeUndefined();
    });

    it('is null with no symbols, with nothing tied together, or with one cohesive group', () => {
        const { graph, finding } = godGraph();
        expect(proposeRestructure(graph, finding, [])).toBeNull();
        expect(proposeRestructure(graph, finding, [sym('a', 1), sym('b', 2), sym('c', 3)])).toBeNull();
        expect(proposeRestructure(graph, finding, [sym('a', 1, {}, [inBig('b')]), sym('b', 2), sym('c', 3)])).toBeNull();
    });

    it('a colliding name gets a suffix, and the input graph is untouched', () => {
        const { graph, finding } = godGraph();
        graph.nodes.push(node('api/big.fetchUsers.ts'));
        const before = JSON.stringify(graph);
        const p = proposeRestructure(graph, finding, SYMBOLS)!;
        expect(p.after.nodes.some((n) => n.ref === R('api/big.fetchUsers-2.ts'))).toBe(true);
        expect(JSON.stringify(graph)).toBe(before);
    });
});
