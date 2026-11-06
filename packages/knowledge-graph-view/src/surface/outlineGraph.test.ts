import { describe, expect, it } from 'vitest';
import type { GraphOutline, KnowledgeGraph, KNode, NodeRef } from '@seanhogg/builderforce-memory/knowledge';
import { buildLines } from './lines';
import { outlineView } from './outlineGraph';
import { buildStations, stationOfRef } from './stations';

const PREFIX = 'src:sys::';
const ref = (path: string) => `${PREFIX}${path}` as NodeRef;

/** The whole system: two entry files in two areas, a web area, an api area and an infrastructure folder. */
function outline(): GraphOutline {
    return {
        prefix: PREFIX,
        areas: [ref('area:api'), ref('area:jobs'), ref('area:web')],
        partitions: ['application', 'entry', 'infrastructure', 'presentation'],
        files: [
            { path: 'api/useCase.ts', area: 0, partition: 0, importance: 0.8, badges: { complexity: 6, coverage: 0.5, notABadgeKey: 1 } },
            { path: 'cron.ts', area: 1, partition: 1, importance: 0.3 },
            { path: 'db/repo.ts', partition: 2, importance: 0.4 },
            { path: 'main.tsx', area: 2, partition: 1, importance: 0.5 },
            { path: 'web/App.tsx', area: 2, partition: 3, importance: 0.6, hash: 'abc' },
        ],
        links: [
            [0, 2, 2, 0], // useCase -> repo (allowed)
            [0, 4, 4, 1], // useCase -> App (upward, in a cycle)
            [1, 0, 3, 0], // cron -> useCase (skips)
            [3, 4, 2, 0], // main -> App (allowed)
            [4, 0, 0, 0], // App -> useCase (no verdict)
        ],
        capped: false,
    };
}

/** A graph the server cut to ONE node: on its own it is "1 line, 1 stop". */
function truncated(withOutline: boolean): KnowledgeGraph {
    const kept: KNode = { ref: ref('main.tsx'), kind: 'file', label: 'main.tsx', pack: 'code', partition: 'entry', area: ref('area:web'), importance: 0.5, origin: 'extracted' };
    return {
        scope: { rootId: 'sys', packs: ['code'], digest: 'd' },
        nodes: [kept], edges: [], findings: [],
        stats: { sources: 5, nodes: 1, edges: 0, stale: 0, truncated: true },
        ...(withOutline ? { outline: outline() } : {}),
    };
}

describe('outlineView', () => {
    it('is null without an outline, so callers read the graph itself', () => {
        expect(outlineView(truncated(false))).toBeNull();
    });

    it('maps every outline file to a file node with its area, partition, hash and overview badges only', () => {
        const view = outlineView(truncated(true))!;
        expect(view.files).toHaveLength(5);
        const useCase = view.files.find((f) => f.ref === ref('api/useCase.ts'))!;
        expect(useCase).toMatchObject({ kind: 'file', area: ref('area:api'), partition: 'application', importance: 0.8 });
        expect(useCase.badges).toEqual({ complexity: 6, coverage: 0.5 });
        expect(view.files.find((f) => f.ref === ref('web/App.tsx'))).toMatchObject({ partition: 'presentation', sourceHash: 'abc' });
    });

    it('decodes link verdict codes and the cycle flag once', () => {
        const edges = outlineView(truncated(true))!.edges;
        const between = (a: string, b: string) => edges.find((e) => e.from === ref(a) && e.to === ref(b))!;
        expect(between('api/useCase.ts', 'web/App.tsx')).toMatchObject({ kind: 'references', verdict: 'upward', cycle: true });
        expect(between('cron.ts', 'api/useCase.ts')).toMatchObject({ verdict: 'skips' });
        expect(between('cron.ts', 'api/useCase.ts').cycle).toBeUndefined();
        expect(between('web/App.tsx', 'api/useCase.ts').verdict).toBeUndefined();
    });

    it('is computed once per graph', () => {
        const graph = truncated(true);
        expect(outlineView(graph)).toBe(outlineView(graph));
    });
});

describe('stations and lines from an outline', () => {
    it('without the outline the cut graph gives one station and one line of one stop', () => {
        const graph = truncated(false);
        const model = buildStations(graph);
        const lines = buildLines(graph, model);
        expect(model.stations).toHaveLength(1);
        expect(lines.lines).toHaveLength(1);
        expect(lines.lines[0]!.stops).toHaveLength(1);
    });

    it('builds a station per area (entry files split out) with the full file counts', () => {
        const model = buildStations(truncated(true));
        expect(model.stations).toHaveLength(5);
        expect(model.stations.reduce((n, s) => n + s.files, 0)).toBe(5);
        expect(model.stations.filter((s) => s.entry)).toHaveLength(2);
        const api = model.byId.get(stationOfRef(model, ref('api/useCase.ts'))!)!;
        expect(api).toMatchObject({ files: 1, layer: 'application', cx: 1, cov: 0.5 });
        expect(stationOfRef(model, ref('web/App.tsx'))).not.toBe(stationOfRef(model, ref('main.tsx')));
    });

    it('runs one line per entry file along the links: more than one line, more than one stop', () => {
        const graph = truncated(true);
        const model = buildStations(graph);
        const result = buildLines(graph, model);
        expect(result.lines).toHaveLength(2);
        for (const line of result.lines) expect(line.stops.length).toBeGreaterThan(1);
        const names = result.lines.map((l) => l.stops.map((id) => model.byId.get(id)!.name));
        expect(names.map((n) => n[0]).sort()).toEqual(['area:jobs', 'main.tsx']);
        expect(result.lines.every((l) => l.terminus.kind === 'data')).toBe(true);
        expect(model.byId.get(result.lines[0]!.terminus.stationId)!.layer).toBe('infrastructure');
    });

    it('shares the api station between the lines and never follows the upward link', () => {
        const graph = truncated(true);
        const model = buildStations(graph);
        const result = buildLines(graph, model);
        const api = stationOfRef(model, ref('api/useCase.ts'))!;
        expect(result.interchanges.get(api)).toHaveLength(2);
        const cron = result.lines.find((l) => model.byId.get(l.stops[0]!)!.name === 'area:jobs')!;
        expect(cron.hops[0]).toMatchObject({ count: 1, verdict: 'skips' });
        const web = stationOfRef(model, ref('web/App.tsx'))!;
        expect(cron.stops).not.toContain(web);
    });
});
