import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { buildOutline, type GraphOutline, type KnowledgeGraph, type KNode, type NodeRef } from '@seanhogg/builderforce-memory/knowledge';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L, fillTemplate } from '../labels';
import { codeFixture, surfaceFixture } from '../testing';
import type { KnowledgeGraphSource } from '../types';
import { useKnowledgeGraph } from '../useKnowledgeGraph';
import { HEAT_CELL_CAP, HeatGrid } from './HeatGrid';
import { buildLines } from './lines';
import { outlineView } from './outlineGraph';
import { ref, truncatedFixture } from './outlineFixture';
import { buildStations, stationOfRef } from './stations';
import { MAX_STATIONS } from './areaRollup';
import type { SceneProps } from './registry';
import { useSurfaceActions } from './useSurfaceActions';

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

describe('parity: a cut graph with its outline reads like the whole graph', () => {
    it('gives the same stations and lines as the uncut graph', () => {
        const whole = surfaceFixture();
        const cut: KnowledgeGraph = {
            ...whole,
            nodes: whole.nodes.filter((n) => n.kind !== 'file'),
            edges: [],
            stats: { ...whole.stats, truncated: true },
            outline: buildOutline(whole),
        };
        const a = buildStations(whole), b = buildStations(cut);
        const brief = (m: typeof a) => m.stations.map((s) => ({ name: s.name, files: s.files, layer: s.layer, entry: s.entry, anti: s.anti, cx: s.cx, cov: s.cov, use: s.use }));
        expect(brief(b)).toEqual(brief(a));
        const names = (g: KnowledgeGraph, m: typeof a) => buildLines(g, m).lines.map((l) => ({
            stops: l.stops.map((id) => m.byId.get(id)!.name), hops: l.hops.map((h) => [h.count, h.verdict]), end: l.terminus.kind,
        }));
        expect(names(cut, b)).toEqual(names(whole, a));
    });
});

describe('verdict majority', () => {
    /** Entry station X -> Y over three file links: two without a verdict (code 0) and one upward. */
    const graphWith = (codes: number[]): KnowledgeGraph => {
        const g = truncatedFixture(false);
        const outline: GraphOutline = {
            prefix: 'src:sys::', areas: [ref('area:x'), ref('area:y')], partitions: ['application', 'entry'],
            files: [
                { path: 'x/main.ts', area: 0, partition: 1, importance: 1 },
                { path: 'y/a.ts', area: 1, partition: 0, importance: 0.5 },
                { path: 'y/b.ts', area: 1, partition: 0, importance: 0.5 },
                { path: 'y/c.ts', area: 1, partition: 0, importance: 0.5 },
            ],
            links: codes.map((code, i) => [0, i + 1, code, 0] as [number, number, number, number]),
            capped: false,
        };
        return { ...g, nodes: [], outline };
    };
    const stops = (g: KnowledgeGraph) => { const m = buildStations(g); return buildLines(g, m).lines[0]!.stops.length; };

    it('counts a code-0 link as allowed: two of them outvote one upward link', () => {
        expect(stops(graphWith([0, 0, 4]))).toBe(2);
    });
    it('does not follow a hop most of whose links are upward', () => {
        expect(stops(graphWith([0, 4, 4]))).toBe(1);
    });
});

describe('real nodes win over the outline', () => {
    it('keeps the graph node (hash, badges, label) for a kept file and builds only the missing ones', () => {
        const graph = truncatedFixture(true, { sourceHash: 'real-hash', label: 'The main file', badges: { changed: 1, extra: 'kept' } });
        const view = outlineView(graph)!;
        const main = view.files.find((f) => f.ref === ref('main.tsx'))!;
        expect(main).toMatchObject({ sourceHash: 'real-hash', label: 'The main file' });
        expect(main).toBe(graph.nodes[0]);
        expect(view.files).toHaveLength(5);
    });

    it('lets a live changed badge on a kept file reach its station', () => {
        const graph = truncatedFixture(true, { badges: { changed: 1 } });
        const model = buildStations(graph);
        const byRef = (r: string) => model.byId.get(stationOfRef(model, ref(r))!)!;
        expect(byRef('main.tsx').changed).toBe(true);
        expect(byRef('api/useCase.ts').changed).toBe(false);
    });
});

describe('the decoded outline is shared by overlays', () => {
    it('decodes once for two copies of one graph that share an outline', () => {
        const a = truncatedFixture(true);
        const b: KnowledgeGraph = { ...a, nodes: [...a.nodes] };
        const va = outlineView(a)!, vb = outlineView(b)!;
        expect(vb).not.toBe(va);
        expect(vb.edges).toBe(va.edges);
        expect(vb.files[0]).toBe(va.files[0]);
    });
});

describe('capped outline', () => {
    it('exposes shown and total on the stations when the outline was capped', () => {
        const graph = truncatedFixture(true);
        graph.outline = { ...graph.outline!, capped: true };
        graph.stats = { ...graph.stats, sources: 90 };
        expect(buildStations(graph).capped).toEqual({ shown: 5, total: 90 });
        expect(buildStations(truncatedFixture(true)).capped).toBeUndefined();
    });
});

describe('files that share no prefix', () => {
    it('keeps the ref as the path and groups an area-less file by its top folder', () => {
        const graph = truncatedFixture(false);
        const outline: GraphOutline = {
            prefix: '', areas: [], partitions: ['presentation'],
            files: [
                { path: 'src:a::p/x.ts', partition: 0, importance: 0.5 },
                { path: 'src:b::q/y.ts', partition: 0, importance: 0.4 },
            ],
            links: [[0, 1, 2, 0]],
            capped: false,
        };
        const model = buildStations({ ...graph, nodes: [], outline });
        expect(model.stations.map((s) => s.id).sort()).toEqual(['folder:p', 'folder:q']);
        expect(stationOfRef(model, 'src:a::p/x.ts')).toBe('folder:p');
    });
});

describe('a big repository', () => {
    const FILES = 20_000, PACKAGES = 300, SUBS = 7;
    const bigGraph = (): KnowledgeGraph => {
        const areas: NodeRef[] = [];
        for (let p = 0; p < PACKAGES; p++) for (let s = 0; s < SUBS; s++) areas.push(ref(`pkg${p}/sub${s}`));
        const files: GraphOutline['files'] = [];
        for (let i = 0; i < FILES; i++) {
            const p = i % PACKAGES, s = i % SUBS;
            files.push({ path: `pkg${p}/sub${s}/f${i}.ts`, area: p * SUBS + s, partition: i % 2000 === 0 ? 1 : 0, importance: (i % 97) / 100 });
        }
        const links: GraphOutline['links'] = [];
        for (let i = 0; i < FILES; i++) {
            for (const to of [(i + 1) % FILES, (i * 3 + 5) % FILES, (i * 7 + 13) % FILES]) if (to !== i) links.push([i, to, 2, 0]);
        }
        const kept: KNode[] = [];
        return {
            ...truncatedFixture(false), nodes: kept,
            stats: { sources: FILES, nodes: 0, edges: 0, stale: 0, truncated: true },
            outline: { prefix: 'src:big::', areas, partitions: ['application', 'entry'], files, links, capped: false },
        };
    };

    it('builds stations and lines within a time budget and folds areas under the station cap', () => {
        const graph = bigGraph();
        expect(graph.outline!.links.length).toBeGreaterThan(55_000);
        const t0 = Date.now();
        const model = buildStations(graph);
        const lines = buildLines(graph, model);
        expect(Date.now() - t0).toBeLessThan(20_000);
        expect(PACKAGES * SUBS).toBeGreaterThan(MAX_STATIONS);
        expect(model.stations.length).toBeLessThanOrEqual(MAX_STATIONS + 20);
        expect(model.stations.reduce((n, s) => n + s.files, 0)).toBe(FILES);
        expect(lines.lines.length).toBeGreaterThan(1);
    }, 60_000);
});

describe('Show brings an outline-only ref in', () => {
    it('show focuses through focusRefs (which loads what the graph lacks) and selects the first ref', () => {
        const graph = truncatedFixture(true);
        const stations = buildStations(graph);
        const kg = { focusRefs: vi.fn(), setFocus: vi.fn(), select: vi.fn(), focus: [], lenses: [], setLens: vi.fn() };
        const surface = { stations, selectStation: vi.fn(), setQuestion: vi.fn(), pinPath: vi.fn() };
        const { result } = renderHook(() => useSurfaceActions(kg as never, surface as never, vi.fn()));
        const refs = [ref('api/useCase.ts'), ref('db/repo.ts')];
        act(() => result.current.show(refs));
        expect(kg.focusRefs).toHaveBeenCalledWith(refs);
        expect(kg.setFocus).not.toHaveBeenCalled();
        expect(kg.select).toHaveBeenCalledWith(refs[0]);
        expect(surface.selectStation).toHaveBeenCalledWith(stationOfRef(stations, refs[0]!));
    });

    it('focusRefs loads around a ref that is not in the graph, and not around one that is', async () => {
        const graph = codeFixture('a');
        const load = vi.fn(async () => graph);
        const source: KnowledgeGraphSource = {
            scopes: async () => [{ rootId: 'a', title: 'a', packs: graph.scope.packs }],
            load,
        };
        const { result } = renderHook(() => useKnowledgeGraph(source));
        await flush(); await flush();
        expect(result.current.graph).toBe(graph);
        const calls = load.mock.calls.length;
        act(() => result.current.focusRefs([graph.nodes[0]!.ref]));
        await flush();
        expect(load.mock.calls.length).toBe(calls);
        act(() => result.current.focusRefs(['src:a::not/in/the/graph.ts']));
        await flush();
        expect(load).toHaveBeenLastCalledWith('a', { focus: ['src:a::not/in/the/graph.ts'] });
        expect(result.current.focus).toEqual(['src:a::not/in/the/graph.ts']);
    });
});

describe('HeatGrid pages its cells', () => {
    it('draws at most HEAT_CELL_CAP cells and reveals the next page on request', () => {
        const total = HEAT_CELL_CAP + 50;
        const stationList = Array.from({ length: total }, (_, i) => ({
            id: `s${i}`, name: `station ${i}`, kind: 'folder' as const, entry: false, refs: [], files: 1, layer: 'application', anti: 1,
            findingIds: [], use: 0.5, changed: false, patterns: [], dup: 0, unused: 0, facts: 0, claims: 0,
        }));
        const stations = { stations: stationList, byId: new Map(stationList.map((s) => [s.id, s])), stationOf: new Map() };
        const surface = {
            stations, lit: null, station: null, selectStation: vi.fn(),
            overlay: { bindings: { size: 'cx', colour: 'anti', ring: 'cov' }, style: () => ({ size: 5, tone: 'accent', ring: null }) },
        };
        render(<HeatGrid {...({ labels: L, surface } as unknown as SceneProps)} />);
        expect(document.querySelectorAll('[data-cell]')).toHaveLength(HEAT_CELL_CAP);
        fireEvent.click(screen.getByText(fillTemplate(L.surface.heat.showMore, { count: 50 })));
        expect(document.querySelectorAll('[data-cell]')).toHaveLength(total);
        expect(document.querySelector('[data-heat-more]')).toBeNull();
    });
});
