/** The stage tasks' codecs (PRD 43 B1a): the request names the resident graph by id; the reply is already wire data (typed arrays). */

import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import type { GraphId } from '../protocol';
import type { Residency } from '../residency';
import type { Codec } from './codec';

const named = <T extends { graph: KnowledgeGraph }>(input: T, residency: Residency): { graph: GraphId; req: Omit<T, 'graph'> & { graph: GraphId } } => {
    const id = residency.graphId(input.graph);
    return { graph: id, req: { ...input, graph: id } };
};

export const markSet: Codec<'markSet'> = {
    encode: ({ graph, changed, strings }, residency) => named({ graph, changed: [...changed], strings: { ...strings } }, residency),
    decode: (raw) => raw,
};

export const markPaint: Codec<'markPaint'> = { encode: (input, residency) => named(input, residency), decode: (raw) => raw };

export const placement: Codec<'placement'> = { encode: (input, residency) => named(input, residency), decode: (raw) => raw };

export const stageIncident: Codec<'stageIncident'> = { encode: (input, residency) => named(input, residency), decode: (raw) => raw };
