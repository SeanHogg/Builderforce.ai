import { describe, expect, it } from 'vitest';
import type { GraphOutline, KEdge, KNode, KnowledgeGraph, NodeRef } from '@seanhogg/builderforce-memory/knowledge';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as LABELS } from '../labels';
import { surfaceDiagnosticLines } from '../surfaceDiagnostics';
import { buildLines, MAX_LINES, MAX_STOPS } from './lines';
import { outlineFixture, truncatedFixture } from './outlineFixture';
import { groupLines } from './rail/lineGroups';
import { endText } from './rail/LineRow';
import { buildStations } from './stations';
import { systemDiagnosticLines } from './systemDiagnostics';
import { foldCopyFindings, systemsOf } from './systems';

type Tags = { system?: string; app?: string; copyOf?: string };
const file = (path: string, partition: string, tags: Tags = {}): KNode =>
    ({ ref: `src:r::${path}`, kind: 'file', label: path, pack: 'code', partition, importance: 0.5, origin: 'extracted', sourceHash: 'h', ...tags }) as KNode;
const link = (a: KNode, b: KNode, extra: Partial<KEdge> = {}): KEdge => ({ from: a.ref, to: b.ref, kind: 'references', weight: 1, origin: 'extracted', ...extra }) as KEdge;
const graphOf = (nodes: KNode[], edges: KEdge[] = []): KnowledgeGraph => ({
    scope: { rootId: 'r', packs: ['code'], digest: 'd' }, nodes, edges, findings: [], stats: { sources: 0, nodes: nodes.length, edges: edges.length, stale: 0, truncated: false },
});
const build = (g: KnowledgeGraph) => buildLines(g, buildStations(g));

describe('lines across systems', () => {
    // sysA holds 6 entry points, sysB 3: A is the larger system.
    const nodes = [
        ...Array.from({ length: 6 }, (_, i) => file(`a${i}/main.ts`, 'entry', { system: 'big' })),
        ...Array.from({ length: 3 }, (_, i) => file(`b${i}/main.ts`, 'entry', { system: 'small' })),
    ];

    it('allots lines round-robin across systems, largest first', () => {
        const { lines, systems } = build(graphOf(nodes));
        expect(systems!.map((s) => s.path)).toEqual(['big', 'small']);
        expect(lines).toHaveLength(MAX_LINES);
        expect(lines.map((l) => l.system)).toEqual(['big', 'small', 'big', 'small', 'big', 'small', 'big', 'big']);
    });

    it('names a line `system › package` only when there is more than one system', () => {
        const multi = build(graphOf(nodes)).lines;
        expect(multi.every((l) => l.name.startsWith(`${l.system} › `))).toBe(true);
        const one = build(graphOf(nodes.slice(0, 3))).lines;
        expect(one.some((l) => l.name.includes('›'))).toBe(false);
    });

    it('folds a stray copy under its original: it gets no line and does not count as omitted', () => {
        const copy = [file('c0/main.ts', 'entry', { system: 'big-copy', copyOf: 'big' })];
        const { lines, omitted, systems } = build(graphOf([...nodes.slice(0, 2), ...nodes.slice(6), ...copy]));
        expect(systems!.map((s) => s.path)).toEqual(['small', 'big']);
        expect(lines.every((l) => l.system !== 'big-copy')).toBe(true);
        expect(omitted).toBe(0);
        const model = buildStations(graphOf([...nodes.slice(0, 2), ...copy]));
        expect(model.stations.find((s) => s.copy === 'big-copy')?.system).toBe('big');
    });

    it('groups the rail by system, largest first, then app', () => {
        const { lines, systems } = build(graphOf([file('x/main.ts', 'entry', { system: 'big', app: 'web' }), file('y/main.ts', 'entry', { system: 'big', app: 'api' }), ...nodes.slice(6)]));
        const groups = groupLines(lines, systems!);
        expect(groups.map((g) => g.name)).toEqual(['small', 'big']);
        expect(groups[1]!.apps.map((a) => a.app)).toEqual(['api', 'web']);
    });
});

describe('line stop reasons', () => {
    const e = file('e/main.ts', 'entry'), a = file('a/x.ts', 'application'), p = file('p/x.ts', 'presentation'), d = file('d/db.ts', 'infrastructure');
    const reason = (nodes: KNode[], edges: KEdge[]) => build(graphOf(nodes, edges)).lines[0]!.stopReason;

    it('no-references: the entry references nothing on the map', () => {
        expect(reason([e], [])).toBe('no-references');
    });
    it('terminus: the line ends at a data store', () => {
        expect(reason([e, d], [link(e, d)])).toBe('terminus');
    });
    it('only-upward: the only hop climbs a layer', () => {
        expect(reason([e, a], [link(e, a, { verdict: 'upward' })])).toBe('only-upward');
    });
    it('only-visited: the only hop returns to a station already on the line', () => {
        expect(reason([e, a], [link(e, a), link(a, e)])).toBe('only-visited');
    });
    it('only-higher-layer: the only hop goes to a higher layer', () => {
        expect(reason([e, a, p], [link(e, a), link(a, p)])).toBe('only-higher-layer');
    });
    it('weighs every blocked hop, not just the strongest: upward beats visited', () => {
        // a -> e is the strongest edge (twice) but only returns to the line; a -> p climbs. The line is held by the climb.
        expect(reason([e, a, p], [link(e, a), link(a, e), link(a, e), link(a, p, { verdict: 'upward' })])).toBe('only-upward');
    });
    it('only-higher-layer beats only-visited', () => {
        expect(reason([e, a, p], [link(e, a), link(a, e), link(a, e), link(a, p)])).toBe('only-higher-layer');
    });
    it('max-stops: the walk is cut by the stop limit', () => {
        const chain = Array.from({ length: MAX_STOPS + 3 }, (_, i) => file(`c${i}/x.ts`, 'application'));
        expect(reason([e, ...chain], [link(e, chain[0]!), ...chain.slice(1).map((c, i) => link(chain[i]!, c))])).toBe('max-stops');
    });

    it('says why in words, and "Ends here" only for a line with no recorded reason', () => {
        const line = build(graphOf([e], [])).lines[0]!;
        expect(endText(line, LABELS)).toBe(LABELS.surface.stopReasons.noReferences);
        const { stopReason: _drop, ...legacy } = line;
        expect(endText(legacy as typeof line, LABELS)).toBe(LABELS.surface.terminus.end);
    });
});

describe('systems from the outline and the diagnostics', () => {
    it('resolves the outline pools onto the nodes and reads systems from them', () => {
        const outline: GraphOutline & Record<string, unknown> = {
            ...outlineFixture(), systems: ['one', 'two'], apps: ['web'],
            files: outlineFixture().files.map((f, i) => ({ ...f, system: i < 3 ? 0 : 1, ...(i === 3 ? { app: 0 } : {}), ...(i === 4 ? { copyOf: 0 } : {}) })),
        } as never;
        // The kept node (main.tsx) is the graph's own, so it carries its own tags.
        const g = { ...truncatedFixture(false, { system: 'two', app: 'web' } as Partial<KNode>), outline };
        const systems = systemsOf(g);
        expect(systems.map((s) => [s.path, s.files, s.copyOf ?? null])).toEqual([['one', 3, null], ['two', 2, 'one']]);
        expect(systems.find((s) => s.path === 'two')!.apps).toEqual(['web']);
    });

    it('prefers graph.meta.systems and prints systems, copies and per-line stop reasons', () => {
        const g = graphOf([file('e/main.ts', 'entry', { system: 'a' })]) as KnowledgeGraph & { meta?: unknown };
        g.meta = { systems: [
            { path: 'a', name: 'a', files: 9, apps: [{ path: 'a/web', name: 'web' }], truncated: true, graphRead: { read: 6000, skipped: [{ reason: 'too-large', count: 2 }] } },
            { path: 'a-copy', name: 'a-copy', files: 9, apps: [], copyOf: 'a', copySimilarity: 0.93, copyReason: 'no-git' },
        ] };
        const text = systemDiagnosticLines(g).join('\n');
        expect(text).toContain('a [a]: files=9 · apps=web · truncated=yes · graph read=6000 skipped=too-large:2');
        expect(text).toContain('copy-of=a');
        expect(text).toContain('copies: a-copy -> a (93%, no-git)');
        const model = buildStations(g);
        const out = surfaceDiagnosticLines({ graph: g, stations: model, lines: buildLines(g, model), coverage: null, scopeName: null, scope: null, lensFindings: 0, listedFindings: 0, queue: { open: 0, shown: 0, repo: 0 }, sync: null }).join('\n');
        expect(out).toContain('stop=no-references');
        expect(out).toContain('systems: 2');
    });
});

describe('findings of a stray copy', () => {
    const finding = (id: string, kind: string, nodes: string[]) => ({ id, kind, pack: 'code', nodes: nodes as NodeRef[], severity: 'warn' as const, params: {} });

    it('are folded away; the duplicate-copy finding and findings that touch the original stay', () => {
        const orig = file('a.ts', 'entry', { system: 'big' });
        const copy = file('c/a.ts', 'entry', { system: 'big-copy', copyOf: 'big' });
        const g = { ...graphOf([orig, copy]), findings: [
            finding('in-copy', 'partition-violation', [copy.ref]),
            finding('in-orig', 'partition-violation', [orig.ref]),
            finding('across', 'partition-violation', [orig.ref, copy.ref]),
            finding('dup', 'duplicate-copy', [copy.ref]),
            finding('no-nodes', 'tidy', []),
        ] };
        const folded = foldCopyFindings(g);
        expect(folded.findings.map((f) => f.id)).toEqual(['in-orig', 'across', 'dup', 'no-nodes']);
        expect(foldCopyFindings(g)).toBe(folded);
        const plain = graphOf([orig]);
        expect(foldCopyFindings(plain)).toBe(plain);
    });
});
