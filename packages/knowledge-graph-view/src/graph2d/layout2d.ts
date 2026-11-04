/**
 * The 2D layout — PURE and DETERMINISTIC, derived from `layout3d` (never a second force
 * layout): the 3D layout already decides each node's partition plane and its x/z place
 * inside it. Here the planes become horizontal BANDS stacked top-down in plane order (the
 * most-using partition on top) and each node's x/z is projected into its band, at the same
 * scale in both axes so distances keep their meaning.
 */

import type { KEdge, KNode } from '@seanhogg/builderforce-memory/knowledge';
import { layout3d, type LayoutOptions } from '../scene/layout3d';
import { cmp, round } from '../order';
import type { ViewBox } from '../usePanZoom';

export interface Bounds { minX: number; maxX: number; minY: number; maxY: number }

export interface Band {
    /** The partition, or `''` for none. */
    partition: string;
    top: number;
    height: number;
}

export interface Layout2D {
    /** ref → [x, y] */
    positions: Map<string, readonly [number, number]>;
    /** Bands top-down, in plane order. */
    bands: Band[];
    /** Every band's full extent: the width is shared so columns line up across bands. */
    bounds: Bounds;
}

export const BAND_PAD = 2.5;
export const BAND_GAP = 1.5;
export const BAND_CAPTION = 2.5;
const MIN_BAND_HEIGHT = 6;

/** A node's radius in layout units, from its 0–1 importance. */
export function nodeRadius(importance: number): number {
    return 0.35 + 0.9 * Math.sqrt(Math.max(0, Math.min(1, importance)));
}

export function layout2d(rootId: string, nodes: readonly KNode[], edges: readonly KEdge[], opts: LayoutOptions = {}): Layout2D {
    const l3 = layout3d(rootId, nodes, edges, opts);
    const byPlane = new Map<string, KNode[]>();
    // Canonical order: the output never depends on the order the nodes arrived in.
    for (const n of [...nodes].sort((a, b) => cmp(a.ref, b.ref))) {
        if (!l3.positions.has(n.ref)) continue;
        const key = n.partition ?? '';
        (byPlane.get(key) ?? byPlane.set(key, []).get(key)!).push(n);
    }
    let minX = Infinity, maxX = -Infinity;
    for (const [x] of l3.positions.values()) { if (x < minX) minX = x; if (x > maxX) maxX = x; }
    if (!Number.isFinite(minX)) { minX = 0; maxX = 0; }

    const positions = new Map<string, readonly [number, number]>();
    const bands: Band[] = [];
    let top = 0;
    for (const plane of l3.planes) {
        const members = byPlane.get(plane.partition) ?? [];
        let minZ = Infinity, maxZ = -Infinity;
        for (const n of members) { const z = l3.positions.get(n.ref)![2]; if (z < minZ) minZ = z; if (z > maxZ) maxZ = z; }
        const span = members.length ? maxZ - minZ : 0;
        const height = round(Math.max(MIN_BAND_HEIGHT, span + 2 * BAND_PAD + BAND_CAPTION));
        for (const n of members) {
            const [x, , z] = l3.positions.get(n.ref)!;
            positions.set(n.ref, [x, round(top + BAND_CAPTION + BAND_PAD + (z - minZ))]);
        }
        bands.push({ partition: plane.partition, top: round(top), height });
        top = round(top + height + BAND_GAP);
    }
    const bottom = bands.length ? top - BAND_GAP : MIN_BAND_HEIGHT;
    return { positions, bands, bounds: { minX: round(minX - BAND_PAD), maxX: round(maxX + BAND_PAD), minY: 0, maxY: round(bottom) } };
}

/** The viewBox that fits the layout's bounds in a `width` × `height` area, centred, with a small margin. */
export function fitView(layout: { bounds: Bounds }, width: number, height: number): ViewBox {
    const margin = 1;
    const b = layout.bounds;
    let w = Math.max(1, b.maxX - b.minX) + 2 * margin;
    let h = Math.max(1, b.maxY - b.minY) + 2 * margin;
    const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
    const aspect = width > 0 && height > 0 ? width / height : w / h;
    if (w / h < aspect) w = h * aspect; else h = w / aspect;
    return { x: round(cx - w / 2), y: round(cy - h / 2), w: round(w), h: round(h) };
}
