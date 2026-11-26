import { describe, expect, it, vi } from 'vitest';
import type { KEdge } from '@seanhogg/builderforce-memory/knowledge';
import { CODECS } from './codecs';
import { packPlaced } from './placed';
import { Residency } from './residency';
import { ComputeStore } from './store';
import { makeGraph } from './testKit';
import type { StationLookup } from './protocol';

describe('codecs', () => {
    it('rankEdges: encodes edges as indices and decodes back onto the caller\'s own objects', () => {
        const r = new Residency(vi.fn());
        const g = makeGraph(3);
        const input = { nodes: g.nodes, edges: g.edges };
        const { req } = CODECS.rankEdges.encode(input, r);
        expect(Array.from(req.refs.edges!)).toEqual([0, 1]);
        const result = CODECS.rankEdges.decode(
            { total: 2, breaking: Uint32Array.of(1), rest: Uint32Array.of(0), refs: ['n0'], offsets: Uint32Array.of(0, 2), edges: Uint32Array.of(0, 1) }, input,
        );
        expect(result.breaking[0]).toBe(g.edges[1]);
        expect(result.rest[0]).toBe(g.edges[0]);
        expect(result.incident.get('n0')).toEqual([g.edges[0], g.edges[1]] as KEdge[]);
    });

    it('layout2d: a placed block round-trips to ref → position', () => {
        const g = makeGraph(2);
        const positions = new Map<string, number[]>([['n1', [3.25, -1]], ['n0', [0.1, 0.2]]]);
        const placed = packPlaced(g.nodes, positions, 2);
        const layout = CODECS.layout2d.decode({ placed, bands: [], bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 } } as never, { rootId: 'r', nodes: g.nodes, edges: g.edges });
        expect(layout.positions.get('n1' as never)).toEqual([3.25, -1]);
        expect(layout.positions.get('n0' as never)).toEqual([0.1, 0.2]);
    });

    it('whole-graph kinds name the graph and return the reply as it is', () => {
        const r = new Residency(vi.fn());
        const g = makeGraph(1);
        for (const kind of ['insights', 'partitionMatrix'] as const) {
            const { graph, req } = CODECS[kind].encode({ graph: g }, r);
            expect(graph).toBe(r.graphId(g));
            expect(req).toEqual({ graph });
            const raw = { x: 1 } as never;
            expect(CODECS[kind].decode(raw, { graph: g })).toBe(raw);
        }
    });

    it('focus: a partial answer maps back to the caller\'s nodes; a whole one returns the graph\'s own arrays', () => {
        const g = makeGraph(3);
        const part = CODECS.focus.decode({ whole: false, nodes: Uint32Array.of(2, 0), edges: Uint32Array.of(1) }, { graph: g, max: 2, keep: [] });
        expect(part.nodes).toEqual([g.nodes[2], g.nodes[0]]);
        const whole = CODECS.focus.decode({ whole: true, nodes: new Uint32Array(0), edges: new Uint32Array(0) }, { graph: g, max: 9, keep: [] });
        expect(whole.nodes).toBe(g.nodes);
    });
});

describe('ComputeStore memo', () => {
    it('rankings live in their own pool: a burst of subsets does not evict them', () => {
        const store = new ComputeStore();
        store.keep('1:a|ranked', 'ranking', 'ranked');
        for (let i = 0; i < 40; i++) store.keep(`1:s${i}`, i);
        expect(store.recall('1:a|ranked', 'ranked')).toBe('ranking');
    });

    it('keeps one station lookup per graph while its key holds, and one edges array for the graph\'s life', () => {
        const store = new ComputeStore();
        store.adopt(1, makeGraph(2));
        const mk = (key: number): StationLookup => ({ key, stationOf: new Map(), byId: new Map() });
        const first = store.stationLookup(1, mk(7));
        expect(store.stationLookup(1, mk(7))).toBe(first);
        expect(store.stationLookup(1, mk(8))).not.toBe(first);
        expect(store.surfaceEdges(1)).toBe(store.surfaceEdges(1));
        store.drop(1);
    });
});
