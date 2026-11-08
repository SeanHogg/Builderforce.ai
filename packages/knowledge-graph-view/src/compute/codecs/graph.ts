/** The codecs of the tasks that read a whole graph (and the mind map, which reads a node and finding subset of one). */

import type { KindResult } from '../kinds';
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
