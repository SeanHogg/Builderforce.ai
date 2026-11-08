/**
 * How many links the scenes draw, and which. 114,000 line segments is more than the eye can read and more
 * than a first paint should wait for, so a scene draws at most {@link MAX_DRAWN_EDGES}, chosen in this order:
 *
 *   1. EVERY link of the selected node (bounded by its degree, and by the budget),
 *   2. rule-breaking and cyclic links (what the picture is for),
 *   3. the rest: the more important end points first, then a stride sample for spread.
 *
 * PURE and DETERMINISTIC: equal input gives the equal selection, whatever order the edges arrive in. The ranking
 * ({@link rankTask}, or {@link rankEdges} in one go) is the expensive part and is independent of the selection, so a
 * host computes it once per graph, in idle steps; picking for a selection ({@link pickEdges}) then needs no sort and no
 * per-edge allocation: one pass over the ranked links with a Set lookup each (linear in the edges, a few milliseconds
 * at 150k), and the answer fills the budget whenever enough links remain after the selection's own.
 */

import type { KEdge, KNode } from '@seanhogg/builderforce-memory/knowledge';
import type { IdleTask } from '../useIdleSteps';
import { rankStages } from './rankStages';
import { strideSample } from './stride';

/** The most links a scene draws (15,000). */
export const MAX_DRAWN_EDGES = 15_000;

/** At or under this many links the ranking and the drawn paths are built in the same render; above it, on idle, after the nodes are on screen. */
export const DEFER_EDGES_ABOVE = 2000;

/** What the ranking needs of ref → links: a `Map` satisfies it, and so does the lazy view over a worker reply. */
export type IncidentIndex = Pick<ReadonlyMap<string, KEdge[]>, 'get' | 'has' | 'size' | 'keys'>;

/** The edges ranked once per graph:`breaking` and `rest` each in priority order, plus every ref's links. */
export interface RankedEdges {
    /** The links that can be drawn (both ends are nodes): what the caption counts. */
    total: number;
    breaking: KEdge[];
    rest: KEdge[];
    /** ref → its links, in priority order. */
    incident: Map<string, KEdge[]>;
}

/**
 * The ranking as steps (index maps; the canonical order; the split and the importance sort; the incident index), so a host
 * can run it a slice at a time. Splits and orders the links that can be drawn; independent of the selection. The canonical
 * order is shared with the layouts (`canonicalEdges`, computed once); the importance sort is stable, so ties keep that order.
 * The stages live in `rankStages`.
 */
export function rankTask(edges: readonly KEdge[], nodes: readonly Pick<KNode, 'ref' | 'importance'>[]): IdleTask<RankedEdges> {
    return rankStages(edges, nodes);
}

/** The whole ranking in one go (tests, small graphs). */
export function rankEdges(edges: readonly KEdge[], nodes: readonly Pick<KNode, 'ref' | 'importance'>[]): RankedEdges {
    const task = rankTask(edges, nodes);
    while (!task.step());
    return task.result();
}

/** Every link of `ref` that can be drawn, in priority order (empty for none). */
export const incidentOf = (ranked: RankedEdges, ref: string | null): readonly KEdge[] => (ref === null ? [] : ranked.incident.get(ref) ?? []);

/** A stride sample of the `items` that are not `taken`: filtered first, so the skips can never leave it short of `n` while links remain. */
function take(items: readonly KEdge[], n: number, taken: ReadonlySet<KEdge>): KEdge[] {
    if (n <= 0) return [];
    return strideSample(items.filter((e) => !taken.has(e)), n);
}

/** The links to draw: at most `cap`, in the priority order above. One linear pass over the ranked links (a Set lookup each); never picks a link twice. */
export function pickEdges(ranked: RankedEdges, selected: string | null, cap: number = MAX_DRAWN_EDGES): KEdge[] {
    const mine = incidentOf(ranked, selected).slice(0, cap);
    const taken = new Set(mine);
    const room = cap - mine.length;
    const breaking = take(ranked.breaking, room, taken);
    if (breaking.length >= room) return [...mine, ...breaking];
    const left = room - breaking.length;
    // Half of what is left goes to the most important links, the other half is spread over the remainder.
    const top = Math.ceil(left / 2);
    // The head is the first `top` links not already chosen; the tail samples only what comes after the head's last link, so nothing is picked twice.
    const head: KEdge[] = [];
    let at = 0;
    for (; at < ranked.rest.length && head.length < top; at++) {
        const e = ranked.rest[at]!;
        if (!taken.has(e)) head.push(e);
    }
    const tail = take(ranked.rest.slice(at), left - head.length, taken);
    return [...mine, ...breaking, ...head, ...tail];
}

/** What the camera says: `shown` of `total` links, and whether anything was left out. */
export function edgeCaption(total: number, cap: number = MAX_DRAWN_EDGES): { shown: number; total: number; capped: boolean } {
    return { shown: Math.min(total, cap), total, capped: total > cap };
}
