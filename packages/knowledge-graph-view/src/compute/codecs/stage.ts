/** The stage tasks' codecs (PRD 43 B1a): the request names the resident graph by id; the reply is already wire data (typed arrays). */

import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import type { GraphId, ModelInputs } from '../protocol';
import type { Residency } from '../residency';
import { placementCacheKey } from '../tasks/placement/request';
import type { Codec } from './codec';

const named = <T extends { graph: KnowledgeGraph }>(input: T, residency: Residency): { graph: GraphId; req: Omit<T, 'graph'> & { graph: GraphId } } => {
    const id = residency.graphId(input.graph);
    return { graph: id, req: { ...input, graph: id } };
};

/** Each graph's last markSet inputs: the paint / placement / incident requests carry them, so any realm builds the same model. */
const MODEL_INPUTS = new WeakMap<KnowledgeGraph, ModelInputs>();
const withModel = <T extends { graph: KnowledgeGraph; model?: ModelInputs }>(input: T): T => {
    const model = input.model ?? MODEL_INPUTS.get(input.graph);
    return model ? { ...input, model } : input;
};

export const markSet: Codec<'markSet'> = {
    encode: ({ graph, changed, strings }, residency) => {
        MODEL_INPUTS.set(graph, { changed: [...changed], strings: { ...strings } });
        return named({ graph, changed: [...changed], strings: { ...strings } }, residency);
    },
    decode: (raw) => raw,
};

export const markPaint: Codec<'markPaint'> = { encode: (input, residency) => named(withModel(input), residency), decode: (raw) => raw };

/**
 * PRD 43 B1a rule 6: returning to a placement (Out, re-entering a level, a viewport band crossed back) is a buffer swap
 * with NO worker call. The answer is kept under the graph and its own `cacheKey` (`placementCacheKey`: the MarkSet
 * generation — a build of graph + changed + the localized strings' digest — then camera, drill, unfold, path, band,
 * LOD, depth, channels); a request is looked up by the same function. 24 answers: the Map and Graph at each of a few
 * bands, a drill stack of three levels each way, with room for tilt; at ~11k slots one answer is ≈ 0.25 MB of arrays.
 */
const PLACEMENTS_KEPT = 24;

export const placement: Codec<'placement'> = {
    encode: (input, residency) => named(withModel(input), residency),
    decode: (raw) => raw,
    cache: {
        size: PLACEMENTS_KEPT,
        keyOf: (req, graph) => `${graph}|${placementCacheKey(String(req.generation), req)}`,
        keyOfRaw: (raw, graph) => `${graph}|${raw.cacheKey}`,
    },
};

export const stageIncident: Codec<'stageIncident'> = { encode: (input, residency) => named(withModel(input), residency), decode: (raw) => raw };
