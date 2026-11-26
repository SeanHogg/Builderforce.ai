/**
 * Edge bundling (PRD 43 B4, Bundles). The edges a camera would draw (the ONE ranking's `pickEdges` order: rule-breaking
 * first, then the important ones, then a spread sample) are split into:
 *
 *   - **singles** — the first `budget.singles` drawable edges, each drawn on its own (so every loud edge is a single
 *     whenever the budget holds them);
 *   - **bundles** — the rest, merged per (aggregate pair, tone bucket): one polyline between the two aggregate marks
 *     carrying the member count. Only the top `budget.bundles` by count are kept (ties by key, so the cut is stable);
 *   - **hidden** — what is left: edges inside one aggregate, and the bundles past the cut. Counted, never drawn.
 *
 * An aggregate is whatever the caller names (`aggregateOf`: a station slot, or a node's own slot when it has none). The
 * direction is folded (A→B and B→A share a bundle), as a drawn bundle carries no arrow. Pure; linear in the edges.
 */

import type { KEdge } from '@seanhogg/builderforce-memory/knowledge';
import { edgeBucket } from '../../scene/buffers';
import type { ThemeTone } from '../../scene/themeColors';

/** Aggregate ids are slots (< 2^26), so `a · 2^26 + b` is an exact, unique number key for the pair. */
const PAIR_STRIDE = 2 ** 26;

export interface BundleBudget {
    /** Edges drawn individually. */
    singles: number;
    /** Bundles kept (by member count). */
    bundles: number;
}

export interface EdgeBundle {
    /** The lower aggregate id, then the higher. */
    a: number;
    b: number;
    bucket: string;
    tone: ThemeTone;
    count: number;
}

export interface BundledEdges {
    singles: KEdge[];
    bundles: EdgeBundle[];
    /** Edges drawn (singles + the kept bundles' members). */
    drawn: number;
    /** Edges counted but not drawn (inside one aggregate, or in a bundle past the cut). */
    hidden: number;
}

/**
 * Splits `picked` into singles, the top bundles and the hidden rest. An edge whose end has no aggregate (`undefined`:
 * not placed) is neither drawn nor counted — the same edges `groupEdges` skips.
 */
export function bundleEdges(picked: readonly KEdge[], aggregateOf: (ref: string) => number | undefined, budget: BundleBudget): BundledEdges {
    const singles: KEdge[] = [];
    // bucket → (a, b) packed as one number → bundle: no string per edge.
    const byBucket = new Map<string, Map<number, EdgeBundle>>();
    const all: EdgeBundle[] = [];
    let hidden = 0;
    for (const e of picked) {
        const x = aggregateOf(e.from), y = aggregateOf(e.to);
        if (x === undefined || y === undefined) continue;
        if (singles.length < budget.singles) { singles.push(e); continue; }
        if (x === y) { hidden++; continue; }
        const a = Math.min(x, y), b = Math.max(x, y);
        const { bucket, tone } = edgeBucket(e);
        const pairs = byBucket.get(bucket) ?? byBucket.set(bucket, new Map()).get(bucket)!;
        const key = a * PAIR_STRIDE + b;
        const known = pairs.get(key);
        if (known) known.count++;
        else { const k = { a, b, bucket, tone, count: 1 }; pairs.set(key, k); all.push(k); }
    }
    const ranked = all.sort((p, q) => q.count - p.count || p.a - q.a || p.b - q.b || (p.bucket < q.bucket ? -1 : p.bucket > q.bucket ? 1 : 0));
    const bundles = ranked.slice(0, Math.max(0, budget.bundles));
    let drawn = singles.length;
    for (const k of bundles) drawn += k.count;
    for (const k of ranked.slice(bundles.length)) hidden += k.count;
    return { singles, bundles, drawn, hidden };
}
