import { describe, expect, it } from 'vitest';
import type { KEdge, KNode, KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { codeFixture, surfaceFixture } from '../testing';
import { buildLines, MAX_LINES, MAX_STOPS } from './lines';
import { buildStations } from './stations';

const build = (graph: KnowledgeGraph) => {
    const model = buildStations(graph);
    return { model, lines: buildLines(graph, model) };
};
const names = (ids: string[], model: ReturnType<typeof buildStations>) => ids.map((id) => model.byId.get(id)!.name);

describe('buildLines', () => {
    it('starts a line at each entry station and follows references down the layers', () => {
        const { model, lines } = build(surfaceFixture());
        expect(lines.lines.map((l) => names(l.stops, model))).toEqual([
            ['main.tsx', 'Web app', 'API', 'repositories'],
            ['cron', 'API', 'repositories'],
        ]);
        expect(lines.lines.map((l) => l.name)).toEqual(['main.tsx', 'cron']);
        expect(lines.lines[0]!.hops).toHaveLength(3);
        expect(lines.lines[1]!.hops[0]).toMatchObject({ count: 1, verdict: 'skips' });
    });

    it('finds interchanges and terminates a line at infrastructure', () => {
        const { model, lines } = build(surfaceFixture());
        expect([...lines.interchanges.keys()].map((id) => model.byId.get(id)!.name).sort()).toEqual(['API', 'repositories']);
        expect(lines.lines[0]!.terminus).toMatchObject({ kind: 'data', provenance: 'heuristic' });
        expect(model.byId.get(lines.lines[0]!.terminus.stationId)!.name).toBe('repositories');
    });

    it('marks an external service and an ends-here terminus', () => {
        const graph = surfaceFixture();
        const renamed: KnowledgeGraph = { ...graph, nodes: graph.nodes.map((n) => (n.label === 'repositories' ? { ...n, label: 'github adapter' } : n)) };
        expect(build(renamed).lines.lines[0]!.terminus.kind).toBe('external');
        const dead = build(surfaceFixture());
        const noInfra: KnowledgeGraph = { ...graph, edges: graph.edges.filter((e) => e.to !== 'src:sys::db/repo.ts') };
        expect(build(noInfra).lines.lines[0]!.terminus.kind).toBe('end');
        expect(dead.lines.lines).toHaveLength(2);
    });

    it('never climbs a layer and never revisits a station', () => {
        const graph = surfaceFixture();
        const up: KEdge = { from: 'src:sys::db/repo.ts', to: 'src:sys::web/page.tsx', kind: 'references', weight: 1, origin: 'extracted', verdict: 'upward' };
        const { model, lines } = build({ ...graph, edges: [...graph.edges, up] });
        expect(names(lines.lines[0]!.stops, model)).toEqual(['main.tsx', 'Web app', 'API', 'repositories']);
    });

    it('follows a hop by the majority verdict of its references, and shows the worst on it', () => {
        const graph = surfaceFixture();
        const link = (from: KEdge['from'], to: KEdge['to'], verdict: KEdge['verdict']): KEdge => ({ from, to, kind: 'references', weight: 1, origin: 'extracted', verdict });
        // Web app -> API has one allowed reference: one more upward is a tie (the milder wins), two more are not followed.
        const page = 'src:sys::web/page.tsx' as const, routes = 'src:sys::api/routes.ts' as const;
        const mixed = build({ ...graph, edges: [...graph.edges, link(page, routes, 'upward')] });
        const shown = mixed.lines.lines[0]!.hops.find((h) => mixed.model.byId.get(h.to)!.name === 'API');
        expect(shown?.verdict).toBe('upward');
        expect(names(mixed.lines.lines[0]!.stops, mixed.model)).toContain('API');
        const worse = build({ ...graph, edges: [...graph.edges, link(page, routes, 'upward'), link(page, routes, 'upward')] });
        expect(names(worse.lines.lines[0]!.stops, worse.model)).not.toContain('API');
    });

    it('draws no lines without entry points', () => {
        expect(build(codeFixture()).lines).toEqual({ lines: [], interchanges: new Map(), omitted: 0 });
    });

    it('is bounded in lines and in stops, and reports what it left out', () => {
        const entries: KNode[] = Array.from({ length: MAX_LINES + 3 }, (_, i) => ({
            ref: `src:b::e${i}/main.ts`, kind: 'file', label: `e${i}/main.ts`, pack: 'code', partition: 'entry', importance: 1 - i / 100, origin: 'extracted', sourceHash: 'h',
        }) as KNode);
        const chain: KNode[] = Array.from({ length: MAX_STOPS + 5 }, (_, i) => ({
            ref: `src:b::c${i}/x.ts`, kind: 'file', label: `c${i}/x.ts`, pack: 'code', partition: 'application', importance: 0.5, origin: 'extracted', sourceHash: 'h',
        }) as KNode);
        const link = (a: KNode, b: KNode): KEdge => ({ from: a.ref, to: b.ref, kind: 'references', weight: 1, origin: 'extracted' });
        const edges = [link(entries[0]!, chain[0]!), ...chain.slice(1).map((c, i) => link(chain[i]!, c))];
        const graph: KnowledgeGraph = {
            scope: { rootId: 'b', packs: ['code'], digest: 'd' }, nodes: [...entries, ...chain], edges, findings: [],
            stats: { sources: 0, nodes: 0, edges: 0, stale: 0, truncated: false },
        };
        const { lines } = build(graph);
        expect(lines.lines).toHaveLength(MAX_LINES);
        expect(lines.omitted).toBe(3);
        expect(lines.lines[0]!.stops).toHaveLength(MAX_STOPS);
    });

    it('is deterministic', () => {
        expect(build(surfaceFixture()).lines).toEqual(build(surfaceFixture()).lines);
    });

    it('regression: a group with several entry files does not lend its name to the entry station, so no stop reads twice', () => {
        // hired.video: the line read "data-manager.ts → data-manager.ts → …" — the split entry station (two entry files)
        // took its community's name, then hopped into the rest of that community.
        const g = surfaceFixture();
        const main = g.nodes.find((n) => n.ref === 'src:sys::web/main.tsx')!;
        const boot = { ...main, ref: 'src:sys::web/boot.ts', label: 'web/boot.ts', importance: 0.2 } as KNode;
        const { model, lines } = build({ ...g, nodes: [...g.nodes, boot] });
        const web = lines.lines.find((l) => l.stops.includes(model.stations.find((s) => s.name === 'Web app')!.id))!;
        const stopNames = names(web.stops, model);
        expect(lines.lines.some((line) => names(line.stops, model)[0] === 'boot.ts')).toBe(true);
        expect(model.stations.filter((station) => station.entry).every((station) => station.refs.length === 1)).toBe(true);
        expect(stopNames[0]).toBe('main.tsx');
        expect(new Set(stopNames).size).toBe(stopNames.length);
        expect(new Set(web.stops).size).toBe(web.stops.length);
    });
});
