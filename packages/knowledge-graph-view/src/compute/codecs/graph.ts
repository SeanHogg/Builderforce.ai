/** The codecs of the tasks that read a whole graph (and the mind map, which reads a node and finding subset of one). */

import type { KindResult } from '../kinds';
import { lookupOf } from '../stationLookup';
import type { TransitLayout } from '../../surface/transitLayout';
import { mapBack, type Codec } from './codec';

export const mindMap: Codec<'mindMap'> = {
    encode: ({ nodes, findings, opts }, residency) => {
        const refs = residency.locate({ nodes, findings });
        return { graph: refs.graph, req: { refs, opts } };
    },
    decode: (raw) => raw,
};

export const surface: Codec<'surface'> = {
    encode: ({ graph, changed, repoConfigName }, residency) => {
        const id = residency.graphId(graph);
        return { graph: id, req: { graph: id, changed: [...changed], ...(repoConfigName ? { repoConfigName } : {}) } };
    },
    decode: (raw) => raw,
};

/** The transit layout is a pure function of the worker-produced stations and lines (no graph residency needed): passes through. */
/** The layout reads no graph (a pure function of the stations and lines): name this shared empty one so the
 *  client's in-process paths (`runSync` for a small surface, the idle-step fallback) can adopt a store for it. */
const NO_GRAPH = {
    scope: { rootId: '', packs: [], digest: '' },
    nodes: [], edges: [], findings: [],
    stats: { sources: 0, nodes: 0, edges: 0, stale: 0, truncated: false },
} as never;

export const transitLayout: Codec<'transitLayout'> = {
    encode: ({ stations, lines, width, order }, residency) => ({
        graph: residency.graphId(NO_GRAPH),
        req: { stations, lines, width, ...(order ? { order } : {}) },
    }),
    decode: (raw): KindResult<'transitLayout'> => {
        // Rebuild the two Maps the view reads; bands and drawn cross as plain arrays.
        const positions = new Map(raw.layout.positions.map((p) => [p.id, { x: p.x, y: p.y }] as const));
        const bandIndex = new Map(raw.layout.bandIndex.map((b) => [b.id, b.band] as const));
        const routes = raw.routes.map((r) => ({ lineId: r.lineId, index: r.index, from: r.from, to: r.to, d: r.d, pts: r.pts, mid: r.mid }));
        return {
            layout: {
                width: raw.layout.width, height: raw.layout.height, bands: raw.layout.bands,
                positions, bandIndex, drawn: raw.layout.drawn, routes, hiddenOnLine: raw.layout.hiddenOnLine,
            },
            routes,
        };
    },
};

export const path: Codec<'path'> = {
    encode: ({ graph, refs, stations }, residency) => {
        const id = residency.graphId(graph);
        return { graph: id, req: { graph: id, refs: [...refs], stations: lookupOf(stations) } };
    },
    decode: (raw) => raw,
};

/** The codec of a task that reads a whole graph and answers in plain data: names the graph, returns the reply as it is. */
const wholeGraph = <K extends 'insights' | 'partitionMatrix'>(): Codec<K> => ({
    encode: ({ graph }, residency) => { const id = residency.graphId(graph); return { graph: id, req: { graph: id } } as unknown as ReturnType<Codec<K>['encode']>; },
    decode: (raw) => raw as unknown as KindResult<K>,
});

export const insights = wholeGraph<'insights'>();
export const partitionMatrix = wholeGraph<'partitionMatrix'>();

export const antiPatterns: Codec<'antiPatterns'> = {
    encode: ({ graph, layer, stations }, residency) => {
        const id = residency.graphId(graph);
        // The stations matter only to narrow by a layer: without one they are not sent.
        return { graph: id, req: { graph: id, layer, ...(layer ? { stations: lookupOf(stations) } : {}) } };
    },
    decode: (raw, { graph }) => raw.map(({ findings, ...group }) => ({ ...group, findings: mapBack(findings, graph.findings) })),
};

export const focus: Codec<'focus'> = {
    encode: ({ graph, max, keep }, residency) => {
        const id = residency.graphId(graph);
        return { graph: id, req: { graph: id, max, keep: [...keep] } };
    },
    decode: (raw, { graph }) => (raw.whole ? { nodes: graph.nodes, edges: graph.edges } : { nodes: mapBack(raw.nodes, graph.nodes), edges: mapBack(raw.edges, graph.edges) }),
};
