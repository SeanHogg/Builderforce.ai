/** The codecs of the tasks that read a whole graph (and the mind map, which reads a node and finding subset of one). */

import { lookupOf } from '../stationLookup';
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

export const path: Codec<'path'> = {
    encode: ({ graph, refs, stations }, residency) => {
        const id = residency.graphId(graph);
        return { graph: id, req: { graph: id, refs: [...refs], stations: lookupOf(stations) } };
    },
    decode: (raw) => raw,
};

export const insights: Codec<'insights'> = {
    encode: ({ graph }, residency) => { const id = residency.graphId(graph); return { graph: id, req: { graph: id } }; },
    decode: (raw) => raw,
};

export const partitionMatrix: Codec<'partitionMatrix'> = {
    encode: ({ graph }, residency) => { const id = residency.graphId(graph); return { graph: id, req: { graph: id } }; },
    decode: (raw) => raw,
};

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
