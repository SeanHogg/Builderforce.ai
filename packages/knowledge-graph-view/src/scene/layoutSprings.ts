/**
 * Which edges pull on the 3D layout. Relaxation costs one pass over the springs per iteration, so a
 * graph with 100k+ edges would block the layout for seconds; the layout only needs enough springs to
 * keep linked nodes near each other, so at most {@link LAYOUT_MAX_SPRINGS} are used.
 */

import type { KEdge } from '@seanhogg/builderforce-memory/knowledge';
import { strideSample } from './stride';

/** The spring budget of the layout (20,000): beyond this the extra springs only slow it down, not change its shape. */
export const LAYOUT_MAX_SPRINGS = 20_000;

type Pair = readonly [number, number];

/**
 * The springs of the layout as [from, to] index pairs. `edges` must already be in the layout's sorted order and
 * `index` maps a ref to its node index; an edge with an unplaced end, or a self loop, is dropped. At or under the
 * budget every edge is a spring, in the given order. Over it, edges that are not `contains` come first (structure
 * says little about how files cluster), and what is left of the budget is a stride sample of the rest, so the
 * same input always picks the same springs.
 */
export function layoutSprings(
    edges: readonly KEdge[], index: ReadonlyMap<string, number>, max: number = LAYOUT_MAX_SPRINGS,
): Pair[] {
    const pairOf = (e: KEdge): Pair | null => {
        const a = index.get(e.from), b = index.get(e.to);
        return a === undefined || b === undefined || a === b ? null : [a, b];
    };
    // Count first: over the budget, the full list of pairs is never built.
    let total = 0;
    for (const e of edges) if (pairOf(e)) total++;
    if (total <= max) {
        const all: Pair[] = [];
        for (const e of edges) { const pair = pairOf(e); if (pair) all.push(pair); }
        return all;
    }
    const preferred: Pair[] = [];
    const structural: Pair[] = [];
    for (const e of edges) {
        const pair = pairOf(e);
        if (pair) (e.kind === 'contains' ? structural : preferred).push(pair);
    }
    return [...strideSample(preferred, max), ...strideSample(structural, Math.max(0, max - preferred.length))];
}
