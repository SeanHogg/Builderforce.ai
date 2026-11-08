import type { KEdge, KNode } from '@seanhogg/builderforce-memory/knowledge';
import type { RankedEdges } from '../../scene/edgeBudget';
import { packPlaced } from '../placed';
import { mapBack, type Codec } from './codec';

export const rankEdges: Codec<'rankEdges'> = {
    encode: ({ nodes, edges }, residency) => {
        const refs = residency.locate({ nodes: nodes as readonly KNode[], edges });
        return { graph: refs.graph, req: { refs } };
    },
    decode: (raw, { edges }) => {
        const incident = new LazyIncident(raw.refs, raw.offsets, raw.edges, edges);
        return { total: raw.total, breaking: mapBack(raw.breaking, edges), rest: mapBack(raw.rest, edges), incident } satisfies RankedEdges;
    },
};

export const edgePaths: Codec<'edgePaths'> = {
    encode: ({ nodes, edges, layout }, residency) => {
        const refs = residency.locate({ nodes, edges });
        return { graph: refs.graph, req: { refs, placed: packPlaced(nodes, layout.positions, 2) } };
    },
    decode: (raw) => raw,
};

export const edgeBuffers: Codec<'edgeBuffers'> = {
    encode: ({ nodes, edges, layout, selected }, residency) => {
        const refs = residency.locate({ nodes, edges });
        return { graph: refs.graph, req: { refs, placed: packPlaced(nodes, layout.positions, 3), selected } };
    },
    decode: (raw) => raw,
};
