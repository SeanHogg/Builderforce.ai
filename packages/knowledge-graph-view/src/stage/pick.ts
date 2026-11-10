/**
 * Main-thread picking (PRD 43 B5): the slots' world positions are re-projected through the CURRENT camera into a screen
 * grid when the camera settles (a worker-built grid would go stale on tilt and orbit), and a pointer query reads only the
 * cells around it. The exact phase is `hitTest.nearestHit`'s rule: the nearest centre in screen pixels within a 40 px
 * target, ties to the higher importance, then the smaller id. It covers:
 *
 *   - the marks, an extruded body as the segment from its base to its top (a flat mark is a point, so it is exactly
 *     `nearestHit`);
 *   - the selectable line segments of the placement's links (a route pick names the batch, segment, polyline and line);
 *   - glyph points (decorations that select their slot).
 *
 * A mark always wins over a line. Hidden slots (scale 0) are never picked. A settle is ONE pass over the Float32
 * position buffer with the projection matrix inlined (no call or allocation per slot), culling anything a pointer on the
 * stage cannot reach, then a counting sort of the survivors into a CSR cell table — all in preallocated typed arrays.
 * The counters let a unit benchmark check the cost by work done, not by wall clock.
 */

import { cmp } from '../order';
import { frameProjector, screenMatrixOf, type Projector, type ScreenFrame } from './projector';
import { FLAG, type LinkBatch, type Placement } from './types';

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
    /** Per-slot importance for the tie-break; absent ⇒ the mark's scale (the bigger mark). */
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
    | { kind: 'link'; batch: number; segment: number; group: number; slot: number; line: string | null };

type Marks = Pick<Placement, 'position' | 'scale'> & { extrude?: Float32Array };

const CULLED = -1, MULTI = -2;

export class PickIndex {
    readonly counters: PickCounters = { projected: 0, cellsVisited: 0, candidatesTested: 0 };
    private readonly n: number;
    /** Per entry (mark slots, then glyphs): base and top on screen; `ok` = projected. */
    private readonly ax: Float64Array; private readonly ay: Float64Array;
    private readonly bx: Float64Array; private readonly by: Float64Array;
    private readonly ok: Uint8Array;
    private readonly glyphSlot: Int32Array;
    private segs: { x0: Float64Array; y0: Float64Array; x1: Float64Array; y1: Float64Array; batch: Int32Array; seg: Int32Array; group: Int32Array; slot: Int32Array } | null = null;
    private readonly cols: number; private readonly rows: number; private readonly cell: number;
    private readonly target: number;
    private start = new Uint32Array(1); private items = new Int32Array(0);
    /** Per entry: its one cell, {@link CULLED}, or {@link MULTI} (spans cells: listed in `multi`). */
    private readonly cellOf: Int32Array;
    private readonly counts: Uint32Array;
    private readonly multi: number[] = [];

    private constructor(private readonly marks: Marks, private readonly projector: Projector, private readonly opts: PickOptions, recycle: PickIndex | null) {
        this.target = opts.targetPx ?? PICK_TARGET_PX;
        this.cell = this.target;
        this.cols = Math.max(1, Math.ceil(projector.width / this.cell) + 2);
        this.rows = Math.max(1, Math.ceil(projector.height / this.cell) + 2);
        this.n = marks.scale.length;
        const g = (opts.glyphs ?? []).reduce((sum, b) => sum + b.slot.length, 0), e = this.n + g;
        // A settle's buffers are the previous settle's, when it had the same sizes: no allocation, no first-touch faults.
        const r = recycle && recycle.ax.length === e && recycle.n === this.n && recycle.counts.length === this.cols * this.rows ? recycle : null;
        if (r) {
            this.ax = r.ax; this.ay = r.ay; this.bx = r.bx; this.by = r.by; this.ok = r.ok.fill(0); this.glyphSlot = r.glyphSlot;
            this.cellOf = r.cellOf.fill(CULLED); this.counts = r.counts.fill(0);
            r.retired = true;
        } else {
            this.ax = new Float64Array(e); this.ay = new Float64Array(e); this.bx = new Float64Array(e); this.by = new Float64Array(e);
            this.ok = new Uint8Array(e);
            this.glyphSlot = new Int32Array(g);
            this.cellOf = new Int32Array(e).fill(CULLED);
            this.counts = new Uint32Array(this.cols * this.rows);
        }
    }

    /** True once a later build took this index's buffers: it must not be queried any more. */
    retired = false;

    /**
     * Projects every shown slot (and the selectable line segments) once and buckets them into screen cells. `recycle`: the
     * index this one replaces (the stage bus's previous settle) — its buffers are reused and it is retired.
     */
    static build(marks: Marks, projector: Projector, opts: PickOptions = {}, recycle: PickIndex | null = null): PickIndex {
        const ix = new PickIndex(marks, projector, opts, recycle);
        ix.projectMarks();
        ix.projectGlyphs();
        ix.projectLinks();
        ix.bucket();
        return ix;
    }

    /** Where slot `s` is on screen (its base), or null when it is hidden or behind the camera. */
    screenOf(s: number): [number, number] | null {
        return s >= 0 && s < this.n && this.ok[s] ? [this.ax[s]!, this.ay[s]!] : null;
    }

    /** Inside the viewport (with `margin` px of slack). */
    onScreen(s: number, margin = 0): boolean {
        if (!(s >= 0 && s < this.n && this.ok[s])) return false;
        const x = this.ax[s]!, y = this.ay[s]!;
        return x >= -margin && y >= -margin && x <= this.projector.width + margin && y <= this.projector.height + margin;
    }

    /** The mark under (`sx`, `sy`): `nearestHit` over the cells within the target; -1 for none. */
    pickMark(sx: number, sy: number): number {
        let best = -1, bestD = this.target * this.target, cells = 0, tested = 0;
        const c0 = this.col(sx - this.target), c1 = this.col(sx + this.target), r0 = this.row(sy - this.target), r1 = this.row(sy + this.target);
        for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
            const at = r * this.cols + c, end = this.start[at + 1]!;
            cells++;
            for (let k = this.start[at]!; k < end; k++) {
                tested++;
                const e = this.items[k]!;
                if (e < 0) continue;
                const d = distSq(sx, sy, this.ax[e]!, this.ay[e]!, this.bx[e]!, this.by[e]!);
                if (d > bestD) continue;
                if (best < 0 || d < bestD || this.beats(this.slotOf(e), this.slotOf(best))) { best = e; bestD = d; }
            }
        }
        this.counters.cellsVisited = cells; this.counters.candidatesTested = tested;
        return best < 0 ? -1 : this.slotOf(best);
    }

    /** A mark first; else the nearest selectable line segment within {@link LINK_TARGET_PX}. */
    pick(sx: number, sy: number): StageHit | null {
        const slot = this.pickMark(sx, sy);
        if (slot >= 0) return { kind: 'mark', slot };
        const segs = this.segs;
        if (!segs) return null;
        const t = LINK_TARGET_PX;
        let best = -1, bestD = t * t;
        const c0 = this.col(sx - t), c1 = this.col(sx + t), r0 = this.row(sy - t), r1 = this.row(sy + t);
        for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
            const at = r * this.cols + c, end = this.start[at + 1]!;
            for (let k = this.start[at]!; k < end; k++) {
                const e = this.items[k]!;
                if (e >= 0) continue;
                const i = -1 - e;
                const d = distSq(sx, sy, segs.x0[i]!, segs.y0[i]!, segs.x1[i]!, segs.y1[i]!);
                if (d < bestD || (d === bestD && i > best)) { best = i; bestD = d; }
            }
        }
        if (best < 0) return null;
        const batch = segs.batch[best]!, group = segs.group[best]!;
        return { kind: 'link', batch, segment: segs.seg[best]!, group, slot: segs.slot[best]!, line: this.opts.links?.[batch]?.lineIds?.[group] ?? null };
    }

    private slotOf(entry: number): number { return entry < this.n ? entry : this.glyphSlot[entry - this.n]!; }

    /** `nearestHit`'s tie rule at equal distance: the higher importance, then the smaller id. */
    private beats(a: number, b: number): boolean {
        const imp = this.opts.importance ?? this.marks.scale;
        const ia = imp[a] ?? 0, ib = imp[b] ?? 0;
        if (ia !== ib) return ia > ib;
        const keys = this.opts.keys;
        return keys ? cmp(keys[a] ?? '', keys[b] ?? '') < 0 : a < b;
    }

    /** The settle's one tight loop: the screen matrix inlined over the Float32 position buffer; cull and count as it goes. */
    private projectMarks(): void {
        const { position: pos, scale } = this.marks, ext = this.marks.extrude, k = this.opts.extrudeScale ?? 1;
        const m = screenMatrixOf(this.projector);
        if (!m) { this.projectEach(); return; }
        const m0 = m[0]!, m1 = m[1]!, m3 = m[3]!, m4 = m[4]!, m5 = m[5]!, m7 = m[7]!, m8 = m[8]!, m9 = m[9]!, m11 = m[11]!, m12 = m[12]!, m13 = m[13]!, m15 = m[15]!;
        const { ax, ay, bx, by, ok, cellOf, counts, cols, rows } = this;
        // The flat mark's cull and cell, inlined (the common case); a raised body goes through `classify`.
        const t = this.target, minX = -t, minY = -t, maxX = this.projector.width + t, maxY = this.projector.height + t;
        const cell = this.cell, lastC = cols - 1, lastR = rows - 1, n = this.n;
        let projected = 0;
        for (let s = 0; s < n; s++) {
            if (!(scale[s]! > 0)) continue;
            const i3 = s * 3, x = pos[i3]!, y = pos[i3 + 1]!, z = pos[i3 + 2]!;
            const w = m3 * x + m7 * y + m11 * z + m15;
            if (w <= 1e-9) continue;
            const nx = m0 * x + m4 * y + m8 * z + m12, ny = m1 * x + m5 * y + m9 * z + m13;
            const X = nx / w, Y = ny / w;
            ok[s] = 1; ax[s] = X; ay[s] = Y; projected++;
            const h = ext === undefined ? 0 : ext[s]! * k;
            if (h > 0) {
                const w2 = w + m7 * h;
                if (w2 > 1e-9) { bx[s] = (nx + m4 * h) / w2; by[s] = (ny + m5 * h) / w2; projected++; } else { bx[s] = X; by[s] = Y; }
                this.classify(s, X, Y, bx[s]!, by[s]!);
                continue;
            }
            bx[s] = X; by[s] = Y;
            if (X < minX || X > maxX || Y < minY || Y > maxY) continue;
            // X ≥ −cell here, so X / cell + 1 ≥ 0 and `| 0` is the floor.
            let c = (X / cell + 1) | 0, r = (Y / cell + 1) | 0;
            if (c > lastC) c = lastC;
            if (r > lastR) r = lastR;
            const at = r * cols + c;
            cellOf[s] = at;
            counts[at]!++;
        }
        this.counters.projected = projected;
    }

    /** A projector with no matrix (a perspective one that only `project`s): one call per point. */
    private projectEach(): void {
        const { position: pos, scale } = this.marks, ext = this.marks.extrude, k = this.opts.extrudeScale ?? 1;
        const out = new Float64Array(2);
        let projected = 0;
        for (let s = 0; s < this.n; s++) {
            if (!(scale[s]! > 0)) continue;
            const x = pos[s * 3]!, y = pos[s * 3 + 1]!, z = pos[s * 3 + 2]!;
            if (!this.projector.project(x, y, z, out)) continue;
            this.ok[s] = 1; this.ax[s] = out[0]!; this.ay[s] = out[1]!; projected++;
            const h = ext ? ext[s]! * k : 0;
            if (h > 0 && this.projector.project(x, y + h, z, out)) { this.bx[s] = out[0]!; this.by[s] = out[1]!; projected++; } else { this.bx[s] = this.ax[s]!; this.by[s] = this.ay[s]!; }
            this.classify(s, this.ax[s]!, this.ay[s]!, this.bx[s]!, this.by[s]!);
        }
        this.counters.projected = projected;
    }

    private projectGlyphs(): void {
        const out = new Float64Array(2), scale = this.marks.scale;
        let e = this.n;
        for (const b of this.opts.glyphs ?? []) {
            for (let q = 0; q < b.slot.length; q++, e++) {
                const slot = b.slot[q]!;
                this.glyphSlot[e - this.n] = slot;
                if (!(scale[slot]! > 0) || !this.projector.project(b.position[q * 3]!, b.position[q * 3 + 1]!, b.position[q * 3 + 2]!, out)) continue;
                this.counters.projected++;
                this.ok[e] = 1; this.ax[e] = this.bx[e] = out[0]!; this.ay[e] = this.by[e] = out[1]!;
                this.classify(e, out[0]!, out[1]!, out[0]!, out[1]!);
            }
        }
    }

    private projectLinks(): void {
        const batches = this.opts.links ?? [];
        let count = 0;
        for (const b of batches) for (let s = 0; s < b.flags.length; s++) if (b.flags[s]! & FLAG.SELECTABLE) count++;
        if (count === 0) return;
        const out = new Float64Array(2);
        const f = () => new Float64Array(count), i = () => new Int32Array(count);
        const segs = { x0: f(), y0: f(), x1: f(), y1: f(), batch: i(), seg: i(), group: i(), slot: i() };
        let k = 0;
        batches.forEach((b, bi) => {
            const p = b.points;
            let seg = 0, px = NaN, py = NaN;
            for (let q = 0; q < p.length / 3; q++) {
                const x = p[q * 3]!;
                const ok = !Number.isNaN(x) && this.projector.project(x, p[q * 3 + 1]!, p[q * 3 + 2]!, out);
                if (!Number.isNaN(x)) this.counters.projected++;
                if (q > 0 && !Number.isNaN(x) && !Number.isNaN(p[(q - 1) * 3]!)) {
                    if (ok && !Number.isNaN(px) && (b.flags[seg]! & FLAG.SELECTABLE)) {
                        segs.x0[k] = px; segs.y0[k] = py; segs.x1[k] = out[0]!; segs.y1[k] = out[1]!;
                        segs.batch[k] = bi; segs.seg[k] = seg; segs.group[k] = b.group[seg] ?? 0; segs.slot[k] = b.slot?.[seg] ?? -1;
                        k++;
                    }
                    seg++;
                }
                px = ok ? out[0]! : NaN; py = ok ? out[1]! : NaN;
            }
        });
        this.segs = { x0: segs.x0.subarray(0, k), y0: segs.y0.subarray(0, k), x1: segs.x1.subarray(0, k), y1: segs.y1.subarray(0, k), batch: segs.batch.subarray(0, k), seg: segs.seg.subarray(0, k), group: segs.group.subarray(0, k), slot: segs.slot.subarray(0, k) };
        for (let s = 0; s < k; s++) this.classify(-1 - s, segs.x0[s]!, segs.y0[s]!, segs.x1[s]!, segs.y1[s]!);
    }

    /**
     * Culls an entry a pointer on the stage cannot reach (off the viewport by more than the target, so a zoomed-in view's
     * thousands of off-screen marks never pile into the border cells), else counts it into its cell(s).
     */
    private classify(e: number, x0: number, y0: number, x1: number, y1: number): void {
        const t = this.target, w = this.projector.width, h = this.projector.height;
        const lx = x0 < x1 ? x0 : x1, hx = x0 < x1 ? x1 : x0, ly = y0 < y1 ? y0 : y1, hy = y0 < y1 ? y1 : y0;
        if (hx < -t || lx > w + t || hy < -t || ly > h + t) return;
        const c0 = this.col(lx), c1 = this.col(hx), r0 = this.row(ly), r1 = this.row(hy);
        if (c0 === c1 && r0 === r1) {
            const at = r0 * this.cols + c0;
            this.counts[at]!++;
            if (e >= 0) this.cellOf[e] = at; else this.multi.push(e);
            return;
        }
        if (e >= 0) this.cellOf[e] = MULTI;
        this.multi.push(e);
        for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) this.counts[r * this.cols + c]!++;
    }

    /** CSR: a prefix sum over the counts, then one placement pass (a counting sort by cell). */
    private bucket(): void {
        const cells = this.counts.length;
        const start = new Uint32Array(cells + 1);
        for (let c = 0; c < cells; c++) start[c + 1] = start[c]! + this.counts[c]!;
        const items = new Int32Array(start[cells]!);
        const fill = this.counts; // reused as the write cursor
        for (let c = 0; c < cells; c++) fill[c] = start[c]!;
        for (let e = 0; e < this.cellOf.length; e++) { const at = this.cellOf[e]!; if (at >= 0) items[fill[at]!++] = e; }
        for (const e of this.multi) {
            const [x0, y0, x1, y1] = e >= 0 ? [this.ax[e]!, this.ay[e]!, this.bx[e]!, this.by[e]!] : this.segOf(-1 - e);
            const c0 = this.col(Math.min(x0, x1)), c1 = this.col(Math.max(x0, x1)), r0 = this.row(Math.min(y0, y1)), r1 = this.row(Math.max(y0, y1));
            for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) items[fill[r * this.cols + c]!++] = e;
        }
        this.start = start; this.items = items;
    }

    private segOf(i: number): [number, number, number, number] {
        const s = this.segs!;
        return [s.x0[i]!, s.y0[i]!, s.x1[i]!, s.y1[i]!];
    }

    /** Grid column of screen x: column 0 holds everything left of the viewport, the last everything right of it. */
    private col(x: number): number { const c = Math.floor(x / this.cell) + 1; return c < 0 ? 0 : c >= this.cols ? this.cols - 1 : c; }
    private row(y: number): number { const r = Math.floor(y / this.cell) + 1; return r < 0 ? 0 : r >= this.rows ? this.rows - 1 : r; }
}

/** Squared distance from (px, py) to the segment a→b (a point when a = b). */
function distSq(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
    const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
    const t = len > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
    const x = ax + t * dx - px, y = ay + t * dy - py;
    return x * x + y * y;
}

/** The slot under screen point (`sx`, `sy`) in a fitted frame, or -1 (a one-off index; the stage keeps one per settle). */
export function nearestSlot(p: Marks, f: ScreenFrame, sx: number, sy: number, targetPx = PICK_TARGET_PX): number {
    return PickIndex.build(p, frameProjector(f), { targetPx }).pickMark(sx, sy);
}
