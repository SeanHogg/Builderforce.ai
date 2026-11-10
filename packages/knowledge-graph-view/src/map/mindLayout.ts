/**
 * The mind map's radial layout — PURE and DETERMINISTIC. A branch's angular span is proportional to its leaves;
 * its depth picks the ring. A ring's radius grows with how crowded it is: at least {@link RING} past the ring
 * inside it, and far enough out that the thinnest branch on it (never counted as thinner than a quarter of an even
 * share) owns {@link BRANCH_GAP} of arc, so the dots of a crowded ring do not touch.
 */

import { round } from '../order';
import type { MapBranch, MapKind, MindMap, PlacedBranch } from './mindTypes';

/** The least distance between two rings. */
export const RING = 14;
/** A branch's mark radius by kind, in layout units (the SVG mind map and the stage's Mind map placement read the same). */
export const BRANCH_RADIUS: Readonly<Record<MapKind, number>> = { root: 1.8, folder: 1.2, file: 0.7, more: 0.7 };
/** The longest branch name drawn in full; a longer one is clipped with an ellipsis (its full name stays in the tooltip / aria). */
export const MAX_BRANCH_LABEL = 24;
export const clipBranchName = (s: string): string => (s.length > MAX_BRANCH_LABEL ? `${s.slice(0, MAX_BRANCH_LABEL - 1)}…` : s);
/** The least arc a branch owns on its ring, in the same units. */
export const BRANCH_GAP = 6;

const leaves = (b: MapBranch): number => (b.children.length ? b.children.reduce((n, c) => n + leaves(c), 0) : 1);

export function layoutMindMap(tree: MapBranch): MindMap {
    const branches: PlacedBranch[] = [];
    const place = (b: MapBranch, depth: number, from: number, to: number, parent?: string): void => {
        branches.push({ ...b, depth, angle: round((from + to) / 2), span: to - from, x: 0, y: 0, radius: 0, room: Infinity, ...(parent !== undefined ? { parent } : {}) });
        const total = b.children.reduce((n, c) => n + leaves(c), 0);
        let cursor = from;
        for (const c of b.children) {
            const span = ((to - from) * leaves(c)) / total;
            place(c, depth + 1, cursor, cursor + span, b.id);
            cursor += span;
        }
    };
    place(tree, 0, -Math.PI / 2, (3 * Math.PI) / 2);

    const thinnest: number[] = [];
    const count: number[] = [];
    for (const b of branches) {
        thinnest[b.depth] = Math.min(thinnest[b.depth] ?? Infinity, b.span);
        count[b.depth] = (count[b.depth] ?? 0) + 1;
    }
    const radii: number[] = [0];
    // One very thin branch must not push the whole ring out: its share is clamped to a quarter of an even share, and the label budget hides what has no room.
    for (let d = 1; d < thinnest.length; d++) {
        const share = Math.max(thinnest[d]!, (2 * Math.PI) / (4 * count[d]!));
        radii[d] = round(Math.max(radii[d - 1]! + RING, BRANCH_GAP / share));
    }
    for (const b of branches) {
        b.room = b.children.length ? radii[b.depth + 1]! - radii[b.depth]! : Infinity;
        b.radius = radii[b.depth]!;
        // `+ 0` turns a -0 (the root: radius 0 times a negative cosine) into 0.
        b.x = round(b.radius * Math.cos(b.angle)) + 0;
        b.y = round(b.radius * Math.sin(b.angle)) + 0;
    }

    const xs = branches.map((p) => p.x), ys = branches.map((p) => p.y);
    // Labels sit beside the dots: leave room for them in x.
    const room = RING * 0.9;
    return { branches, bounds: { minX: Math.min(...xs) - room, maxX: Math.max(...xs) + room, minY: Math.min(...ys) - RING / 2, maxY: Math.max(...ys) + RING / 2 } };
}
