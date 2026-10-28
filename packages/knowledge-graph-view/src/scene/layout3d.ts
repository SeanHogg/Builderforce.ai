/**
 * The 3D layout — PURE and DETERMINISTIC (PRD 38 §4.6): equal input gives equal
 * coordinates, byte for byte, on every host.
 *
 *   partition → a horizontal plane (y). Planes are ordered by flow: a partition that
 *               mostly USES others sits above the ones it uses (presentation over
 *               domain), ties by name; an unpartitioned plane is last.
 *   area      → a centre on a seeded golden-angle spiral, most important first.
 *   node      → seeded jitter around its area, then a FIXED number of relaxation
 *               iterations (repulsion inside the area, springs along edges, a pull home).
 *
 * The seed is the root id's hash, so two roots never share a layout by accident, and no
 * `Math.random` is involved anywhere. Coordinates are rounded to 1e-4.
 */

import type { KEdge, KNode } from '@seanhogg/builderforce-memory/knowledge';

export interface Layout3D {
    /** ref → [x, y, z] */
    positions: Map<string, readonly [number, number, number]>;
    /** Planes top-down: the partition (or `''` for none) and its y. */
    planes: Array<{ partition: string; y: number }>;
}

export interface LayoutOptions {
    /** Explicit plane order (a pack's registry), top first. Absent ⇒ ordered by flow. */
    partitionOrder?: readonly string[];
    iterations?: number;
}

export const PLANE_GAP = 6;
export const LAYOUT_ITERATIONS = 40;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const AREA_SPACING = 4.5;
const NONE = '';

/** FNV-1a 32-bit. */
export function hash32(text: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
}

/** mulberry32 — a tiny seeded PRNG. */
function rng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const round = (n: number): number => Math.round(n * 1e4) / 1e4;

/** Partitions top-down: by explicit order, else by net outgoing cross-partition edges. */
export function planeOrder(nodes: readonly KNode[], edges: readonly KEdge[], explicit?: readonly string[]): string[] {
    const present = [...new Set(nodes.map((n) => n.partition ?? NONE))];
    const partOf = new Map(nodes.map((n) => [n.ref, n.partition ?? NONE] as const));
    const score = new Map<string, number>(present.map((p) => [p, 0]));
    for (const e of edges) {
        const a = partOf.get(e.from), b = partOf.get(e.to);
        if (a === undefined || b === undefined || a === b) continue;
        score.set(a, (score.get(a) ?? 0) + 1);
        score.set(b, (score.get(b) ?? 0) - 1);
    }
    const rank = (p: string): number => {
        if (p === NONE) return Number.POSITIVE_INFINITY;
        const at = explicit?.indexOf(p) ?? -1;
        return at >= 0 ? at : Number.NaN;
    };
    return present.sort((a, b) => {
        const ra = rank(a), rb = rank(b);
        if (ra === Number.POSITIVE_INFINITY || rb === Number.POSITIVE_INFINITY) return ra === rb ? 0 : ra === Number.POSITIVE_INFINITY ? 1 : -1;
        if (!Number.isNaN(ra) && !Number.isNaN(rb)) return ra - rb;
        if (!Number.isNaN(ra)) return -1;
        if (!Number.isNaN(rb)) return 1;
        return (score.get(b) ?? 0) - (score.get(a) ?? 0) || cmp(a, b);
    });
}

export function layout3d(
    rootId: string,
    nodesIn: readonly KNode[],
    edgesIn: readonly KEdge[],
    opts: LayoutOptions = {},
): Layout3D {
    const nodes = [...nodesIn].sort((a, b) => cmp(a.ref, b.ref));
    const edges = [...edgesIn].sort((a, b) => cmp(a.from, b.from) || cmp(a.to, b.to) || cmp(a.kind, b.kind));
    const order = planeOrder(nodes, edges, opts.partitionOrder);
    const planeY = new Map(order.map((p, i) => [p, round((order.length - 1 - i) * PLANE_GAP)] as const));
    const random = rng(hash32(rootId));

    // Areas: the node's area, else its partition plane as one area.
    const areaKey = (n: KNode): string => `${n.partition ?? NONE}\u0000${n.area ?? n.partition ?? NONE}`;
    const areaWeight = new Map<string, number>();
    for (const n of nodes) areaWeight.set(areaKey(n), (areaWeight.get(areaKey(n)) ?? 0) + n.importance);
    const byPlane = new Map<string, string[]>();
    for (const key of [...areaWeight.keys()].sort(cmp)) {
        const plane = key.slice(0, key.indexOf('\u0000'));
        (byPlane.get(plane) ?? byPlane.set(plane, []).get(plane)!).push(key);
    }
    const centre = new Map<string, [number, number]>();
    for (const keys of byPlane.values()) {
        keys.sort((a, b) => (areaWeight.get(b) ?? 0) - (areaWeight.get(a) ?? 0) || cmp(a, b));
        keys.forEach((key, i) => {
            const r = AREA_SPACING * Math.sqrt(i);
            const t = i * GOLDEN_ANGLE;
            centre.set(key, [r * Math.cos(t), r * Math.sin(t)]);
        });
    }

    const index = new Map(nodes.map((n, i) => [n.ref, i] as const));
    const x = new Float64Array(nodes.length);
    const z = new Float64Array(nodes.length);
    const home: Array<[number, number]> = nodes.map((n) => centre.get(areaKey(n)) ?? [0, 0]);
    nodes.forEach((_, i) => {
        const [cx, cz] = home[i]!;
        x[i] = cx + (random() - 0.5) * 2;
        z[i] = cz + (random() - 0.5) * 2;
    });

    const members = new Map<string, number[]>();
    nodes.forEach((n, i) => (members.get(areaKey(n)) ?? members.set(areaKey(n), []).get(areaKey(n))!).push(i));
    const springs = edges
        .map((e) => [index.get(e.from), index.get(e.to)] as const)
        .filter((p): p is readonly [number, number] => p[0] !== undefined && p[1] !== undefined && p[0] !== p[1]);

    const iterations = opts.iterations ?? LAYOUT_ITERATIONS;
    for (let step = 0; step < iterations; step++) {
        const cool = 1 - step / iterations;
        const dx = new Float64Array(nodes.length);
        const dz = new Float64Array(nodes.length);
        for (const group of members.values()) {
            for (let a = 0; a < group.length; a++) {
                for (let b = a + 1; b < group.length; b++) {
                    const i = group[a]!, j = group[b]!;
                    const ddx = x[i]! - x[j]!, ddz = z[i]! - z[j]!;
                    const d2 = Math.max(ddx * ddx + ddz * ddz, 0.01);
                    const f = 0.6 / d2;
                    dx[i]! += ddx * f; dz[i]! += ddz * f;
                    dx[j]! -= ddx * f; dz[j]! -= ddz * f;
                }
            }
        }
        for (const [i, j] of springs) {
            const ddx = x[j]! - x[i]!, ddz = z[j]! - z[i]!;
            dx[i]! += ddx * 0.02; dz[i]! += ddz * 0.02;
            dx[j]! -= ddx * 0.02; dz[j]! -= ddz * 0.02;
        }
        for (let i = 0; i < nodes.length; i++) {
            const [hx, hz] = home[i]!;
            dx[i]! += (hx - x[i]!) * 0.05;
            dz[i]! += (hz - z[i]!) * 0.05;
            const len = Math.hypot(dx[i]!, dz[i]!);
            const cap = 0.8 * cool + 0.05;
            const s = len > cap ? cap / len : 1;
            x[i] = x[i]! + dx[i]! * s;
            z[i] = z[i]! + dz[i]! * s;
        }
    }

    const positions = new Map<string, readonly [number, number, number]>();
    nodes.forEach((n, i) => positions.set(n.ref, [round(x[i]!), planeY.get(n.partition ?? NONE) ?? 0, round(z[i]!)]));
    return { positions, planes: order.map((partition) => ({ partition, y: planeY.get(partition) ?? 0 })) };
}
