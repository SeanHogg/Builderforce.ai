/** The ONE way a per-node incident-edge list is built: an edge is listed under both its ends (once for a self-link). */

import type { KEdge } from '@seanhogg/builderforce-memory/knowledge';

/** Appends `e` to the list of `ref`, creating it on first use. */
export function linkEdge(index: Map<string, KEdge[]>, ref: string, e: KEdge): void {
    const l = index.get(ref);
    if (l) l.push(e); else index.set(ref, [e]);
}

/** Lists `e` under its `from` and (unless a self-link) its `to`. */
export function linkBothEnds(index: Map<string, KEdge[]>, e: KEdge): void {
    linkEdge(index, e.from, e);
    if (e.to !== e.from) linkEdge(index, e.to, e);
}
