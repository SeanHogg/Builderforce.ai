/**
 * The edge tasks: the ranking, and the drawn edges of the 2D and 3D views. The ranking is per subset of the graph and is
 * kept (under the subset's key), so the paths or buffers asked for next read it instead of ranking again.
 */

import type { KEdge } from '@seanhogg/builderforce-memory/knowledge';
import { pathsOf } from '../../graph2d/edgePaths';
import { edgeBuffers, groupEdges } from '../../scene/buffers';
import { pickEdges, rankEdges, rankTask, type RankedEdges } from '../../scene/edgeBudget';
import type { Layout3D } from '../../scene/layout3d';
import { unpackPlaced } from '../placed';
import type { RankRaw, Refs } from '../protocol';
import type { ComputeStore } from '../store';
import { once, type Handler } from './handler';

const rankKey = (refs: Refs): string => `${refs.key}|ranked`;

/** The ranking of a request's edges: the kept one, else computed in one go. */
function rankedFor(store: ComputeStore, refs: Refs): RankedEdges {
    const { nodes, edges } = store.subset(refs);
    return store.remember(rankKey(refs), () => rankEdges(edges, nodes));
}

/** The ranking by position in `edges`, flat. */
function packRanked(ranked: RankedEdges, edges: readonly KEdge[]): RankRaw {
    const at = new Map<KEdge, number>(edges.map((e, i) => [e, i] as const));
    const places = (list: readonly KEdge[]): Uint32Array => Uint32Array.from(list, (e) => at.get(e)!);
    const refs = [...ranked.incident.keys()];
    const offsets = new Uint32Array(refs.length + 1);
    refs.forEach((ref, i) => { offsets[i + 1] = offsets[i]! + ranked.incident.get(ref)!.length; });
    const flat = new Uint32Array(offsets[refs.length]!);
    refs.forEach((ref, i) => flat.set(places(ranked.incident.get(ref)!), offsets[i]!));
    return { total: ranked.total, breaking: places(ranked.breaking), rest: places(ranked.rest), refs, offsets, edges: flat };
}

export const rankEdgesTask: Handler<'rankEdges'> = (store, { refs }) => {
    const { nodes, edges } = store.subset(refs);
    const kept = store.recall<RankedEdges>(rankKey(refs));
    if (kept) return once(() => packRanked(kept, edges));
    const task = rankTask(edges, nodes);
    return {
        step: () => task.step(),
        result: () => packRanked(store.keep(rankKey(refs), task.result()), edges),
    };
};

export const edgePaths: Handler<'edgePaths'> = (store, { refs, placed }) => once(() => {
    const ranked = rankedFor(store, refs);
    const at = unpackPlaced(store.subset(refs).nodes, placed);
    return pathsOf(groupEdges(pickEdges(ranked, null), (ref) => at.get(ref) as [number, number] | undefined));
});

export const edgeBufferTask: Handler<'edgeBuffers'> = (store, { refs, placed, selected }) => once(() => {
    const ranked = rankedFor(store, refs);
    const positions = unpackPlaced(store.subset(refs).nodes, placed) as unknown as Layout3D['positions'];
    return edgeBuffers(pickEdges(ranked, selected), { positions, planes: [] });
});
