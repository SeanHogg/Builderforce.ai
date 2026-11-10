/** The order of the 3D layout's planes (placements: a partition, else a community — `placementKeyOf`), as steps so the edge tally never blocks for the whole edge list. */

import type { KEdge, KNode } from '@seanhogg/builderforce-memory/knowledge';
import { cmp } from '../order';
import { EDGE_SLICE } from './canonicalEdges';
import { placementRankOf, planeKeyOf } from '../placement';

/** The partition name of a node with none. */
export const NONE_PARTITION = '';

export interface PlaneOrderTask {
    /** Tallies one slice of the edges; true when the order is ready. */
    step(): boolean;
    result(): string[];
}

/** Planes top-down: by explicit order, else pack partitions above communities, each by net outgoing cross-plane edges. */
export function planeOrderTask(nodes: readonly KNode[], edges: readonly KEdge[], explicit?: readonly string[]): PlaneOrderTask {
    const keys = nodes.map((n) => planeKeyOf(n, nodes) ?? NONE_PARTITION);
    const present = [...new Set(keys)];
    // Partitions as small integers, so the edge loop adds to a typed array instead of rewriting a string-keyed map twice per edge.
    const slot = new Map(present.map((p, i) => [p, i] as const));
    const partOf = new Map<string, number>();
    nodes.forEach((n, i) => partOf.set(n.ref, slot.get(keys[i]!)!));
    const tally = new Float64Array(present.length);
    let at = 0;
    let ordered: string[] | null = null;

    const order = (): string[] => {
        const score = new Map<string, number>(present.map((p, i) => [p, tally[i]!] as const));
        const rank = (p: string): number => {
            if (p === NONE_PARTITION) return Number.POSITIVE_INFINITY;
            const place = explicit?.indexOf(p) ?? -1;
            return place >= 0 ? place : Number.NaN;
        };
        return present.sort((a, b) => {
            const ra = rank(a), rb = rank(b);
            if (ra === Number.POSITIVE_INFINITY || rb === Number.POSITIVE_INFINITY) return ra === rb ? 0 : ra === Number.POSITIVE_INFINITY ? 1 : -1;
            if (!Number.isNaN(ra) && !Number.isNaN(rb)) return ra - rb;
            if (!Number.isNaN(ra)) return -1;
            if (!Number.isNaN(rb)) return 1;
            // Pack partitions above communities (placementRankOf), then by flow.
            return placementRankOf(a) - placementRankOf(b) || (score.get(b) ?? 0) - (score.get(a) ?? 0) || cmp(a, b);
        });
    };

    return {
        step() {
            if (ordered) return true;
            const end = Math.min(edges.length, at + EDGE_SLICE);
            for (; at < end; at++) {
                const e = edges[at]!;
                const a = partOf.get(e.from);
                if (a === undefined) continue;
                const b = partOf.get(e.to);
                if (b === undefined || a === b) continue;
                tally[a]! += 1;
                tally[b]! -= 1;
            }
            if (at < edges.length) return false;
            ordered = order();
            return true;
        },
        result() {
            if (!ordered) throw new Error('planeOrder: result() read before step() returned true');
            return ordered;
        },
    };
}

/** The whole order in one go. */
export function planeOrder(nodes: readonly KNode[], edges: readonly KEdge[], explicit?: readonly string[]): string[] {
    const task = planeOrderTask(nodes, edges, explicit);
    while (!task.step());
    return task.result();
}
