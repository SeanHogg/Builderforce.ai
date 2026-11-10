/**
 * Main-thread picking (PRD 43 B5): the slots' world positions are re-projected through the CURRENT camera into a screen
 * grid when the camera settles (a worker-built grid would go stale on tilt and orbit; the build is `pickGrid.ts`), and a
 * pointer query reads only the cells around it. The exact phase is `hitTest.nearestHit`'s rule: the nearest centre in
 * screen pixels within a 40 px target, ties to the higher importance (the MarkSet's — the reading `nearestHit`'s callers
 * use), then the smaller id. It covers:
 *
 *   - the marks, an extruded body as the segment from its base to its top (a flat mark is a point, so it is exactly
 *     `nearestHit`);
 *   - the selectable line segments of the placement's links (a route pick names the batch, segment, polyline and line);
 *   - glyph points (decorations that select their slot).
 *
 * A mark always wins over a line. Hidden slots (scale 0) are never picked. The counters let a unit benchmark check the
 * cost by work done, not by wall clock.
 */

import type { CallSite } from '@seanhogg/builderforce-memory/knowledge';
import { cmp } from '../order';
import { PickGrid, type GridMarks } from './pickGrid';
import { frameProjector, type Projector, type ScreenFrame } from './projector';
import type { LinkBatch } from './types';

export { cameraProjector, frameOf, frameProjector, screenMatrixOf, toScreen, type Projector, type ScreenFrame } from './projector';

export const PICK_TARGET_PX = 40;
/** How close a pointer must come to a line to pick it (half a fat route plus a finger's slack). */
export const LINK_TARGET_PX = 10;

export interface PickCounters {
    /** Points projected by the last build (a shown flat mark is one, an extruded one two, a line point one). */
    projected: number;
    /** Cells read and candidates tested by the last query. */
    cellsVisited: number;
    candidatesTested: number;
}

export interface PickOptions {
    /** Slot ids for the final tie-break (`cmp`, as `nearestHit`); absent ⇒ the lower slot. */
    keys?: readonly string[];
    /** Per-slot importance for the tie-break (the MarkSet's `importance`); absent ⇒ the mark's scale. */
    importance?: ArrayLike<number> | null;
    links?: readonly LinkBatch[];
    /** Decoration points that select their slot. */
    glyphs?: ReadonlyArray<{ slot: Uint32Array; position: Float32Array }>;
    targetPx?: number;
    /** The depth control (0..1): a mark's drawn height is `extrude × extrudeScale` (the shader's `uDepth`). Default 1. */
    extrudeScale?: number;
}

export type StageHit =
    | { kind: 'mark'; slot: number }
    | { kind: 'link'; batch: number; segment: number; group: number; slot: number; line: string | null; site: CallSite | null };

export class PickIndex {
    readonly counters: PickCounters;

    private constructor(private readonly grid: PickGrid, private readonly marks: GridMarks, private readonly opts: PickOptions, private readonly target: number) {
        this.counters = { projected: grid.projected, cellsVisited: 0, candidatesTested: 0 };
    }

    /**
     * Projects every shown slot (and the selectable line segments) once and buckets them into screen cells. `recycle`: the
     * index this one replaces (the stage bus's previous settle, never queried again) — its buffers are reused.
     */
    static build(marks: GridMarks, projector: Projector, opts: PickOptions = {}, recycle: PickIndex | null = null): PickIndex {
        const target = opts.targetPx ?? PICK_TARGET_PX;
        const grid = new PickGrid(marks, projector, { links: opts.links, glyphs: opts.glyphs, targetPx: target, extrudeScale: opts.extrudeScale ?? 1 }, recycle?.grid ?? null);
        return new PickIndex(grid, marks, opts, target);
    }

    /** Where slot `s` is on screen (its base), or null when it is hidden or behind the camera. */
    screenOf(s: number): [number, number] | null {
        const g = this.grid;
        return s >= 0 && s < g.n && g.ok[s] ? [g.ax[s]!, g.ay[s]!] : null;
    }

    /** Inside the viewport (with `margin` px of slack). */
    onScreen(s: number, margin = 0): boolean {
        const g = this.grid;
        if (!(s >= 0 && s < g.n && g.ok[s])) return false;
        const x = g.ax[s]!, y = g.ay[s]!;
        return x >= -margin && y >= -margin && x <= g.projector.width + margin && y <= g.projector.height + margin;
    }

    /** The mark under (`sx`, `sy`): `nearestHit` over the cells within the target; -1 for none. */
    pickMark(sx: number, sy: number): number {
        const g = this.grid, t = this.target;
        let best = -1, bestD = t * t, cells = 0, tested = 0;
        const c0 = g.col(sx - t), c1 = g.col(sx + t), r0 = g.row(sy - t), r1 = g.row(sy + t);
        for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
            const at = r * g.cols + c, end = g.start[at + 1]!;
            cells++;
            for (let k = g.start[at]!; k < end; k++) {
                tested++;
                const e = g.items[k]!;
                if (e < 0) continue;
                const d = distSq(sx, sy, g.ax[e]!, g.ay[e]!, g.bx[e]!, g.by[e]!);
                if (d > bestD) continue;
                if (best < 0 || d < bestD || this.beats(g.slotOf(e), g.slotOf(best))) { best = e; bestD = d; }
            }
        }
        this.counters.cellsVisited = cells; this.counters.candidatesTested = tested;
        return best < 0 ? -1 : g.slotOf(best);
    }

    /** A mark first; else the nearest selectable line segment within {@link LINK_TARGET_PX}. */
    pick(sx: number, sy: number): StageHit | null {
        const slot = this.pickMark(sx, sy);
        if (slot >= 0) return { kind: 'mark', slot };
        const g = this.grid, segs = g.segs;
        if (!segs) return null;
        const t = LINK_TARGET_PX;
        let best = -1, bestD = t * t;
        const c0 = g.col(sx - t), c1 = g.col(sx + t), r0 = g.row(sy - t), r1 = g.row(sy + t);
        for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
            const at = r * g.cols + c, end = g.start[at + 1]!;
            for (let k = g.start[at]!; k < end; k++) {
                const e = g.items[k]!;
                if (e >= 0) continue;
                const i = -1 - e;
                const d = distSq(sx, sy, segs.x0[i]!, segs.y0[i]!, segs.x1[i]!, segs.y1[i]!);
                if (d < bestD || (d === bestD && i > best)) { best = i; bestD = d; }
            }
        }
        if (best < 0) return null;
        const batch = segs.batch[best]!, group = segs.group[best]!;
        const b = this.opts.links?.[batch];
        return { kind: 'link', batch, segment: segs.seg[best]!, group, slot: segs.slot[best]!, line: b?.lineIds?.[group] ?? null, site: b?.callSites?.[group] ?? null };
    }

    /** `nearestHit`'s tie rule at equal distance: the higher importance, then the smaller id. */
    private beats(a: number, b: number): boolean {
        const imp = this.opts.importance ?? this.marks.scale;
        const ia = imp[a] ?? 0, ib = imp[b] ?? 0;
        if (ia !== ib) return ia > ib;
        const keys = this.opts.keys;
        return keys ? cmp(keys[a] ?? '', keys[b] ?? '') < 0 : a < b;
    }
}

/** Squared distance from (px, py) to the segment a→b (a point when a = b). */
function distSq(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
    const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
    const t = len > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
    const x = ax + t * dx - px, y = ay + t * dy - py;
    return x * x + y * y;
}

/** The slot under screen point (`sx`, `sy`) in a fitted frame, or -1 (a one-off index; the stage keeps one per settle). */
export function nearestSlot(p: GridMarks, f: ScreenFrame, sx: number, sy: number, targetPx = PICK_TARGET_PX): number {
    return PickIndex.build(p, frameProjector(f), { targetPx }).pickMark(sx, sy);
}
