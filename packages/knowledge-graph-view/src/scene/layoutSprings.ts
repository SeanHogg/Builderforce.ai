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
    // One pass resolves every edge to its [from, to] indexes (typed arrays: no pair is allocated for an edge that is not kept).
    const n = edges.length;
    const a = new Int32Array(n), b = new Int32Array(n);
    const structure = new Uint8Array(n);
    let total = 0, preferredCount = 0;
    for (let i = 0; i < n; i++) {
        const e = edges[i]!;
        const from = index.get(e.from);
        if (from === undefined) continue;
        const to = index.get(e.to);
        if (to === undefined || from === to) continue;
        a[total] = from; b[total] = to;
        if (e.kind === 'contains') structure[total] = 1; else preferredCount++;
        total++;
    }
    const pair = (j: number): Pair => [a[j]!, b[j]!];
    if (total <= max) {
        const all: Pair[] = new Array(total);
        for (let j = 0; j < total; j++) all[j] = pair(j);
        return all;
    }
    const preferred: number[] = [], structural: number[] = [];
    for (let j = 0; j < total; j++) (structure[j] ? structural : preferred).push(j);
    return [...strideSample(preferred, max), ...strideSample(structural, Math.max(0, max - preferredCount))].map(pair);
}
