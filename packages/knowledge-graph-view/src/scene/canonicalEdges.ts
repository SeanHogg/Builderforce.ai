/**
 * The ONE canonical order of edges: by `from`, then `to`, then `kind`, all in string order. `rank` maps each ref to
 * its position in the sorted list of refs, so comparing ranks equals comparing refs and a sort of 150k edges
 * does no string work per comparison. Edges with an end outside `rank` are dropped. Used by the layout (springs) and
 * the edge budget (ranking), so the two never disagree about which edge comes first.
 */

import type { KEdge } from '@seanhogg/builderforce-memory/knowledge';
import { cmp } from '../order';

export function canonicalEdges(edges: readonly KEdge[], rank: ReadonlyMap<string, number>): KEdge[] {
    const kinds = new Map([...new Set(edges.map((e) => e.kind))].sort(cmp).map((k, i) => [k, i] as const));
    const placed: KEdge[] = [];
    for (const e of edges) if (rank.has(e.from) && rank.has(e.to)) placed.push(e);
    const from = new Int32Array(placed.length), to = new Int32Array(placed.length), kind = new Int32Array(placed.length);
    placed.forEach((e, i) => { from[i] = rank.get(e.from)!; to[i] = rank.get(e.to)!; kind[i] = kinds.get(e.kind)!; });
    return Array.from(placed.keys()).sort((a, b) => from[a]! - from[b]! || to[a]! - to[b]! || kind[a]! - kind[b]!).map((i) => placed[i]!);
}
