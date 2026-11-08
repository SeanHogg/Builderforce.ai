/**
 * The ONE canonical order of edges: by `from`, then `to`, then `kind`, all in string order. `rank` maps each ref to
 * its position in the sorted list of refs, so comparing ranks equals comparing refs and a sort of 150k edges
 * does no string work per comparison. Edges with an end outside `rank` are dropped. Used by the layout (springs) and
 * the edge budget (ranking), so the two never disagree about which edge comes first.
 *
 * It is computed ONCE per (edges array, rank): the edge ranking, the 2D layout and the 3D layout all ask for the same
 * order of the same edges, and share one result (the memo holds the in-flight computation too, so two tasks that start
 * together advance one sort). The sort itself is a native numeric sort of ONE packed key per edge
 * (`((from * N + to) * K + kind) * M + position`), so ties keep the arrival order exactly as a stable comparator would.
 */

import type { KEdge } from '@seanhogg/builderforce-memory/knowledge';
import { devFreeze } from '../memo';
import { cmp } from '../order';

/** The edges resolved per step (one step is a few milliseconds even at 150k edges). */
const SLICE = 30_000;

export interface CanonicalTask {
    /** Does one slice of the work; true when the order is ready. Safe to call again once done. */
    step(): boolean;
    result(): KEdge[];
}

interface Entry { rank: ReadonlyMap<string, number>; task: CanonicalTask }

const memo = new WeakMap<readonly KEdge[], Entry[]>();
const KEEP = 4;

const sameRank = (a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>): boolean => {
    if (a === b) return true;
    if (a.size !== b.size) return false;
    for (const [ref, at] of a) if (b.get(ref) !== at) return false;
    return true;
};

/** Packed keys must stay exact integers: above this the comparator sort is used instead. */
const PACKED_KEY_LIMIT = 2 ** 53;

/** Exported for tests only: `packedKeyLimit` lets a small graph take the comparator fallback. */
export function buildCanonicalTask(edges: readonly KEdge[], rank: ReadonlyMap<string, number>, packedKeyLimit: number = PACKED_KEY_LIMIT): CanonicalTask {
    const count = edges.length;
    let kinds: Map<string, number> | null = null;
    const from = new Int32Array(count), to = new Int32Array(count), kind = new Int32Array(count), at = new Int32Array(count);
    let seen = 0, placed = 0, top = 0, plain = true;
    let sorted: KEdge[] | null = null;

    const phases: Array<() => boolean> = [
        () => {
            kinds = new Map();
            let last: string | null = null;
            for (let i = 0; i < count; i++) {
                const k = edges[i]!.kind;
                if (k !== last) { last = k; if (!kinds.has(k)) kinds.set(k, 0); }
            }
            [...kinds.keys()].sort(cmp).forEach((k, i) => kinds!.set(k, i));
            return true;
        },
        () => {
            const end = Math.min(count, seen + SLICE);
            const ids = kinds!;
            let lastKind: string | null = null, lastId = 0;
            for (; seen < end; seen++) {
                const e = edges[seen]!;
                const f = rank.get(e.from);
                if (f === undefined) continue;
                const t = rank.get(e.to);
                if (t === undefined) continue;
                if (e.kind !== lastKind) { lastKind = e.kind; lastId = ids.get(e.kind)!; }
                if (!(Number.isInteger(f) && Number.isInteger(t) && f >= 0 && t >= 0)) plain = false;
                else { if (f > top) top = f; if (t > top) top = t; }
                from[placed] = f; to[placed] = t; kind[placed] = lastId; at[placed] = seen;
                placed++;
            }
            return seen >= count;
        },
        () => {
            const n = top + 1, k = kinds!.size;
            const out: KEdge[] = new Array(placed);
            if (plain && n * n * Math.max(1, k) * Math.max(1, placed) < packedKeyLimit) {
                const keys = new Float64Array(placed);
                for (let j = 0; j < placed; j++) keys[j] = ((from[j]! * n + to[j]!) * k + kind[j]!) * placed + j;
                keys.sort();
                for (let j = 0; j < placed; j++) out[j] = edges[at[keys[j]! % placed]!]!;
            } else {
                const order = Array.from({ length: placed }, (_, j) => j);
                order.sort((a, b) => from[a]! - from[b]! || to[a]! - to[b]! || kind[a]! - kind[b]!);
                for (let j = 0; j < placed; j++) out[j] = edges[at[order[j]!]!]!;
            }
            sorted = devFreeze(out);
            return true;
        },
    ];

    return {
        step() {
            if (phases.length === 0) return true;
            if (phases[0]!()) phases.shift();
            return phases.length === 0;
        },
        result() {
            if (!sorted) throw new Error('canonicalEdges: result() read before step() returned true');
            return sorted;
        },
    };
}

/** The canonical order as steps; every caller for the same edges and rank gets the same shared computation. */
export function canonicalEdgesTask(edges: readonly KEdge[], rank: ReadonlyMap<string, number>): CanonicalTask {
    const entries = memo.get(edges) ?? [];
    let entry = entries.find((e) => sameRank(e.rank, rank));
    if (!entry) {
        entry = { rank, task: buildCanonicalTask(edges, rank) };
        entries.push(entry);
        if (entries.length > KEEP) entries.shift();
        memo.set(edges, entries);
    }
    return entry.task;
}

/** The whole order in one go. The array is shared with every other caller for these edges: read it, never change it. */
export function canonicalEdges(edges: readonly KEdge[], rank: ReadonlyMap<string, number>): KEdge[] {
    const task = canonicalEdgesTask(edges, rank);
    while (!task.step());
    return task.result();
}
