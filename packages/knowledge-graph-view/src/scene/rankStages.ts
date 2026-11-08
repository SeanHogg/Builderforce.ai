/**
 * The stages of the edge ranking ({@link rankTask}), each small enough to run inside one idle slice even at 150k links.
 * The importance sort is an INDEX sort on precomputed numbers: every quiet link's weight becomes the dense rank of its
 * value, packed with its position into one number (`(heaviest first) * count + position`), and a native numeric sort of
 * those numbers equals a stable comparator sort (ties keep the canonical order) with no comparator calls.
 */

import type { KEdge, KNode } from '@seanhogg/builderforce-memory/knowledge';
import { cmp, importanceOf } from '../order';
import { isLoudEdge } from './buffers';
import { canonicalEdgesTask, EDGE_SLICE } from './canonicalEdges';
import { chunkedSort, type SortTask } from './chunkedSort';
import type { RankedEdges } from './edgeBudget';
import { linkBothEnds } from './incident';


export interface RankStages {
    /** One slice of work; true when the whole ranking is done. */
    step(): boolean;
    result(): RankedEdges;
}

/** The first index in the ascending `values` that is not below `v` (exact values only). */
function lowerBound(values: Float64Array, v: number): number {
    let lo = 0, hi = values.length;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (values[mid]! < v) lo = mid + 1; else hi = mid;
    }
    return lo;
}

export function rankStages(edges: readonly KEdge[], nodes: readonly Pick<KNode, 'ref' | 'importance'>[]): RankStages {
    let importance = new Map<string, number>();
    let refRank = new Map<string, number>();
    let canonical: KEdge[] = [];
    let canon: ReturnType<typeof canonicalEdgesTask> | null = null;
    let breaking: KEdge[] = [];
    let rest: KEdge[] = [];
    const incident = new Map<string, KEdge[]>();

    // Split state.
    let at = 0;
    let loud: Uint8Array = new Uint8Array(0);
    let weights = new Float64Array(0), quietAt = new Uint32Array(0), quiet = 0;
    let distinct = new Float64Array(0);
    let keys = new Float64Array(0);
    let linked = 0;
    let sorter: SortTask | null = null;
    let sortedWeights = new Float64Array(0);

    const stages: Array<() => boolean> = [
        () => {
            importance = new Map(nodes.map((n) => [n.ref as string, importanceOf(n)] as const));
            refRank = new Map([...importance.keys()].sort(cmp).map((r, i) => [r, i] as const));
            return true;
        },
        // The canonical order is shared (computed once for the ranking and both layouts) and itself in slices.
        () => {
            canon ??= canonicalEdgesTask(edges, refRank);
            if (!canon.step()) return false;
            canonical = canon.result();
            loud = new Uint8Array(canonical.length);
            weights = new Float64Array(canonical.length);
            quietAt = new Uint32Array(canonical.length);
            return true;
        },
        // Classify: warning links first, the rest weighted by their end points' importance.
        () => {
            const end = Math.min(canonical.length, at + EDGE_SLICE);
            for (; at < end; at++) {
                const e = canonical[at]!;
                if (isLoudEdge(e)) { loud[at] = 1; continue; }
                weights[quiet] = importance.get(e.from)! + importance.get(e.to)!;
                quietAt[quiet] = at;
                quiet++;
            }
            if (at < canonical.length) return false;
            at = 0;
            return true;
        },
        // The distinct weights, ascending: a weight's rank among them replaces the weight in the packed key.
        () => {
            if (!sorter) { sortedWeights = weights.slice(0, quiet); sorter = chunkedSort(sortedWeights); }
            if (!sorter.step()) return false;
            sorter = null;
            const sorted = sortedWeights;
            let n = 0;
            for (let i = 0; i < sorted.length; i++) if (i === 0 || sorted[i] !== sorted[n - 1]) sorted[n++] = sorted[i]!;
            distinct = sorted.subarray(0, n);
            keys = new Float64Array(quiet);
            return true;
        },
        () => {
            const end = Math.min(quiet, at + EDGE_SLICE);
            const top = distinct.length - 1;
            for (; at < end; at++) keys[at] = (top - lowerBound(distinct, weights[at]!)) * quiet + at;
            if (at < quiet) return false;
            at = 0;
            return true;
        },
        () => {
            sorter ??= chunkedSort(keys);
            if (!sorter.step()) return false;
            sorter = null;
            return true;
        },
        // Materialise both lists in their final order.
        () => {
            if (at === 0) { breaking = []; rest = new Array(quiet); }
            const end = Math.min(quiet, at + EDGE_SLICE);
            for (; at < end; at++) rest[at] = canonical[quietAt[keys[at]! % quiet]!]!;
            if (at < quiet) return false;
            for (let i = 0; i < canonical.length; i++) if (loud[i]) breaking.push(canonical[i]!);
            at = 0;
            return true;
        },
        // The incident index: breaking links first, then the rest, each in priority order.
        () => {
            const total = breaking.length + rest.length;
            const end = Math.min(total, linked + EDGE_SLICE);
            for (; linked < end; linked++) {
                const e = linked < breaking.length ? breaking[linked]! : rest[linked - breaking.length]!;
                linkBothEnds(incident, e);
            }
            return linked >= total;
        },
    ];

    let done = false;
    return {
        step() {
            if (stages.length > 0 && stages[0]!()) stages.shift();
            done = stages.length === 0;
            return done;
        },
        result() {
            if (!done) throw new Error('rankTask: result() read before step() returned true');
            return { total: breaking.length + rest.length, breaking, rest, incident };
        },
    };
}
