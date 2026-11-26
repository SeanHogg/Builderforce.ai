import { describe, expect, it } from 'vitest';
import { buildLines } from './lines';
import { mapEdges, outlineView } from './outlineGraph';
import { outlineFixture, ref, truncatedFixture as truncated } from './outlineFixture';
import { buildStations, stationOfRef } from './stations';

describe('outlineView', () => {
    it('is null without an outline, so callers read the graph itself', () => {
        expect(outlineView(truncated(false))).toBeNull();
        expect(mapEdges(truncated(false))).toEqual([]);
    });

    it('is null when the graph is not truncated, even if an outline is attached', () => {
        const whole = truncated(true);
        whole.stats = { ...whole.stats, truncated: false };
        expect(outlineView(whole)).toBeNull();
    });

    it('maps every outline file to a file node with its area, partition and overview badges only', () => {
        const view = outlineView(truncated(true))!;
        expect(view.files).toHaveLength(5);
        const useCase = view.files.find((f) => f.ref === ref('api/useCase.ts'))!;
        expect(useCase).toMatchObject({ kind: 'file', label: 'useCase.ts', area: ref('area:api'), partition: 'application', importance: 0.8 });
        expect(useCase.badges).toEqual({ complexity: 6, coverage: 0.5 });
    });

    it('does not pass the outline hash off as a sourceHash', () => {
        const app = outlineView(truncated(true))!.files.find((f) => f.ref === ref('web/App.tsx'))!;
        expect(app.sourceHash).toBeUndefined();
    });

    it('decodes link verdict codes and the cycle flag once', () => {
        const edges = outlineView(truncated(true))!.edges;
        const between = (a: string, b: string) => edges.find((e) => e.from === ref(a) && e.to === ref(b))!;
        expect(between('api/useCase.ts', 'web/App.tsx')).toMatchObject({ kind: 'references', verdict: 'upward', cycle: true });
        expect(between('cron.ts', 'api/useCase.ts')).toMatchObject({ verdict: 'skips' });
        expect(between('cron.ts', 'api/useCase.ts').cycle).toBeUndefined();
        expect(between('web/App.tsx', 'api/useCase.ts').verdict).toBeUndefined();
    });

    it('skips a link whose index is out of range', () => {
        const graph = truncated(true);
        graph.outline = { ...outlineFixture(), links: [[0, 99, 2, 0], [-1, 0, 2, 0], [0, 2, 2, 0]] };
        expect(outlineView(graph)!.edges).toHaveLength(1);
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
        expect(api).toMatchObject({ files: 1, layer: 'application', cx: 3, cov: 0.5 });
        expect(stationOfRef(model, ref('web/App.tsx'))).not.toBe(stationOfRef(model, ref('main.tsx')));
    });

    it('orders a station refs by importance, most important first', () => {
        const graph = truncated(true);
        graph.outline = {
            ...outlineFixture(),
            files: [
                { path: 'z.ts', area: 0, partition: 0, importance: 0.9 },
                { path: 'a.ts', area: 0, partition: 0, importance: 0.1 },
                { path: 'm.ts', area: 0, partition: 0, importance: 0.5 },
            ],
            links: [],
        };
        const model = buildStations(graph);
        expect(model.stations[0]!.refs).toEqual([ref('z.ts'), ref('m.ts'), ref('a.ts')]);
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

    it('marks a hop as a cycle when stations reference each other or a link carries the cycle flag', () => {
        const graph = truncated(true);
        const model = buildStations(graph);
        const main = buildLines(graph, model).lines.find((l) => model.byId.get(l.stops[0]!)!.name === 'main.tsx')!;
        // main -> App is one way; App -> useCase and useCase -> App run both ways (and one is flagged).
        expect(main.hops[0]!.cycle).toBeUndefined();
        expect(main.hops[1]!.cycle).toBe(true);
    });
});
