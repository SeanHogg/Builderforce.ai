/**
 * The 3D layout — PURE and DETERMINISTIC (PRD 38 §4.6): equal input gives equal
 * coordinates, byte for byte, on every host. The relaxation can run in chunks ({@link layoutTask}); chunking
 * never changes the result.
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
import { cmp, importanceOf, round } from '../order';
import { canonicalEdgesTask } from './canonicalEdges';
import { layoutSpringsTask } from './layoutSprings';
import { NONE_PARTITION, planeOrderTask } from './planeOrder';
import { createRelaxation, type Relaxation } from './layoutRelax';

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

export { planeOrder } from './planeOrder';

export const PLANE_GAP = 6;

/** What a host draws when a layout failed: nothing placed. */
export const EMPTY_LAYOUT_3D: Layout3D = { positions: new Map(), planes: [] };

/**
 * A tower's height from the size channel's level (1 to 5): taller for worse. A node with no
 * level (the channel is off or has no data) stands at a neutral height. The tallest tower
 * (3.1) stays under {@link PLANE_GAP}, so a tower never reaches the plane above it.
 */
export function towerHeight(level: number | undefined): number {
    return level === undefined ? 1.2 : round(0.6 + level * 0.5);
}

export const LAYOUT_ITERATIONS = 40;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const AREA_SPACING = 4.5;
const NONE = NONE_PARTITION;

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

/** A layout in progress: call `step()` (one relaxation pass) until it returns true, then read `result()`. */
export interface LayoutTask {
    step(): boolean;
    result(): Layout3D;
}

export function layoutTask(
    rootId: string,
    nodesIn: readonly KNode[],
    edgesIn: readonly KEdge[],
    opts: LayoutOptions = {},
): LayoutTask {
    const nodes = [...nodesIn].sort((a, b) => cmp(a.ref, b.ref));
    const planes = planeOrderTask(nodes, edgesIn, opts.partitionOrder);
    let order: string[] = [];
    let planeY = new Map<string, number>();
    const random = rng(hash32(rootId));

    // Areas: the node's area, else its partition plane as one area.
    const areaKeys = nodes.map((n) => `${n.partition ?? NONE}\u0000${n.area ?? n.partition ?? NONE}`);
    const areaWeight = new Map<string, number>();
    nodes.forEach((n, i) => areaWeight.set(areaKeys[i]!, (areaWeight.get(areaKeys[i]!) ?? 0) + importanceOf(n)));
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
    const home: Array<[number, number]> = nodes.map((_, i) => centre.get(areaKeys[i]!) ?? [0, 0]);
    nodes.forEach((_, i) => {
        const [cx, cz] = home[i]!;
        x[i] = cx + (random() - 0.5) * 2;
        z[i] = cz + (random() - 0.5) * 2;
    });

    const members = new Map<string, number[]>();
    areaKeys.forEach((key, i) => (members.get(key) ?? members.set(key, []).get(key)!).push(i));
    // The edge work is staged: sorting 150k edges (shared with the edge ranking, computed once) and picking the springs are their own steps.
    let sorted: readonly KEdge[] = [];
    let relax: Relaxation | null = null;
    // Nodes are indexed in ref order, so `index` is the rank the canonical edge order needs.
    const canon = canonicalEdgesTask(edgesIn, index);
    let springTask: ReturnType<typeof layoutSpringsTask> | null = null;
    const stages: Array<() => boolean> = [
        () => {
            if (!planes.step()) return false;
            order = planes.result();
            planeY = new Map(order.map((p, i) => [p, round((order.length - 1 - i) * PLANE_GAP)] as const));
            return true;
        },
        () => { if (!canon.step()) return false; sorted = canon.result(); return true; },
        () => { springTask ??= layoutSpringsTask(sorted, index); return springTask.step(); },
        () => {
            relax = createRelaxation({
                x, z, home, groups: [...members.values()], springs: springTask!.result(), iterations: opts.iterations ?? LAYOUT_ITERATIONS,
            });
            return true;
        },
    ];

    let built: Layout3D | null = null;
    let finished = false;
    return {
        step() {
            if (stages.length > 0) {
                if (stages[0]!()) stages.shift();
                return false;
            }
            finished = relax!.step();
            return finished;
        },
        result() {
            if (!finished) throw new Error('layout3d: result() read before step() returned true');
            if (!built) {
                const positions = new Map<string, readonly [number, number, number]>();
                nodes.forEach((n, i) => positions.set(n.ref, [round(x[i]!), planeY.get(n.partition ?? NONE) ?? 0, round(z[i]!)]));
                built = { positions, planes: order.map((partition) => ({ partition, y: planeY.get(partition) ?? 0 })) };
            }
            return built;
        },
    };
}

/** The whole layout in one go (tests, and hosts with no idle loop). */
export function layout3d(rootId: string, nodes: readonly KNode[], edges: readonly KEdge[], opts: LayoutOptions = {}): Layout3D {
    const task = layoutTask(rootId, nodes, edges, opts);
    while (!task.step());
    return task.result();
}
