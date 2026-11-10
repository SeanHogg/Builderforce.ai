/**
 * The pick grid's BUILD (PRD 43 B5), the work of a settle: ONE pass over the Float32 position buffer with the projection's
 * screen matrix inlined (no call or allocation per slot), culling what a pointer on the stage cannot reach, then a
 * counting sort of the survivors into a CSR cell table — all in typed arrays, reused from the previous settle when the
 * sizes match (no allocation, no first-touch page faults). `pick.ts` queries it. Pure, no DOM, no three.
 */

import { screenMatrixOf, type Projector } from './projector';
import { FLAG, type LinkBatch, type Placement } from './types';

export interface GridOptions {
    links?: readonly LinkBatch[];
    /** Decoration points that select their slot. */
    glyphs?: ReadonlyArray<{ slot: Uint32Array; position: Float32Array }>;
    /** The cell size and the reach of a query (px). */
    targetPx: number;
    /** The depth control (0..1): a mark's drawn height is `extrude × extrudeScale` (the shader's `uDepth`). */
    extrudeScale: number;
}

export type GridMarks = Pick<Placement, 'position' | 'scale'> & { extrude?: Float32Array };

export interface Segments { x0: Float64Array; y0: Float64Array; x1: Float64Array; y1: Float64Array; batch: Int32Array; seg: Int32Array; group: Int32Array; slot: Int32Array }

const CULLED = -1, MULTI = -2;

export class PickGrid {
    /** Points projected (a shown flat mark is one, an extruded one two, a line point one). */
    projected = 0;
    readonly n: number;
    /** Per entry (mark slots, then glyphs): base and top on screen; `ok` = projected. */
    readonly ax: Float64Array; readonly ay: Float64Array;
    readonly bx: Float64Array; readonly by: Float64Array;
    readonly ok: Uint8Array;
    readonly glyphSlot: Int32Array;
    segs: Segments | null = null;
    readonly cols: number; readonly rows: number; readonly cell: number;
    /** CSR: entries of cell `c` are `items[start[c] .. start[c + 1])`; a segment entry is `-1 - index`. */
    start = new Uint32Array(1); items = new Int32Array(0);
    /** Per entry: its one cell, {@link CULLED}, or {@link MULTI} (spans cells: listed in `multi`). */
    private readonly cellOf: Int32Array;
    private readonly counts: Uint32Array;
    private readonly multi: number[] = [];

    /**
     * Builds the grid of `marks` under `projector`. `recycle`: the grid this one replaces (the stage bus's previous
     * settle) — its buffers are taken when the sizes match, so it must not be queried after this.
     */
    constructor(private readonly marks: GridMarks, readonly projector: Projector, private readonly opts: GridOptions, recycle: PickGrid | null) {
        this.cell = opts.targetPx;
        this.cols = Math.max(1, Math.ceil(projector.width / this.cell) + 2);
        this.rows = Math.max(1, Math.ceil(projector.height / this.cell) + 2);
        this.n = marks.scale.length;
        const g = (opts.glyphs ?? []).reduce((sum, b) => sum + b.slot.length, 0), e = this.n + g;
        const r = recycle && recycle.ax.length === e && recycle.n === this.n && recycle.counts.length === this.cols * this.rows ? recycle : null;
        if (r) {
            this.ax = r.ax; this.ay = r.ay; this.bx = r.bx; this.by = r.by; this.ok = r.ok.fill(0); this.glyphSlot = r.glyphSlot;
            this.cellOf = r.cellOf.fill(CULLED); this.counts = r.counts.fill(0);
        } else {
            this.ax = new Float64Array(e); this.ay = new Float64Array(e); this.bx = new Float64Array(e); this.by = new Float64Array(e);
            this.ok = new Uint8Array(e);
            this.glyphSlot = new Int32Array(g);
            this.cellOf = new Int32Array(e).fill(CULLED);
            this.counts = new Uint32Array(this.cols * this.rows);
        }
        this.projectMarks();
        this.projectGlyphs();
        this.projectLinks();
        this.bucket();
    }

    /** The slot an entry stands for (a glyph selects its slot). */
    slotOf(entry: number): number { return entry < this.n ? entry : this.glyphSlot[entry - this.n]!; }

    /** Grid column of screen x: column 0 holds everything left of the viewport, the last everything right of it. */
    col(x: number): number { const c = Math.floor(x / this.cell) + 1; return c < 0 ? 0 : c >= this.cols ? this.cols - 1 : c; }
    row(y: number): number { const r = Math.floor(y / this.cell) + 1; return r < 0 ? 0 : r >= this.rows ? this.rows - 1 : r; }

    /** The settle's one tight loop: the screen matrix inlined over the Float32 position buffer; cull and count as it goes. */
    private projectMarks(): void {
        const { position: pos, scale } = this.marks, ext = this.marks.extrude, k = this.opts.extrudeScale;
        const m = screenMatrixOf(this.projector);
        if (!m) { this.projectEach(); return; }
        const m0 = m[0]!, m1 = m[1]!, m3 = m[3]!, m4 = m[4]!, m5 = m[5]!, m7 = m[7]!, m8 = m[8]!, m9 = m[9]!, m11 = m[11]!, m12 = m[12]!, m13 = m[13]!, m15 = m[15]!;
        const { ax, ay, bx, by, ok, cellOf, counts, cols, rows } = this;
        // The flat mark's cull and cell, inlined (the common case); a raised body goes through `classify`.
        const t = this.opts.targetPx, minX = -t, minY = -t, maxX = this.projector.width + t, maxY = this.projector.height + t;
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
        this.projected = projected;
    }

    /** A projector with no matrix (a perspective one that only `project`s): one call per point. */
    private projectEach(): void {
        const { position: pos, scale } = this.marks, ext = this.marks.extrude, k = this.opts.extrudeScale;
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
        this.projected = projected;
    }

    private projectGlyphs(): void {
        const out = new Float64Array(2), scale = this.marks.scale;
        let e = this.n;
        for (const b of this.opts.glyphs ?? []) {
            for (let q = 0; q < b.slot.length; q++, e++) {
                const slot = b.slot[q]!;
                this.glyphSlot[e - this.n] = slot;
                if (!(scale[slot]! > 0) || !this.projector.project(b.position[q * 3]!, b.position[q * 3 + 1]!, b.position[q * 3 + 2]!, out)) continue;
                this.projected++;
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
        const segs: Segments = { x0: f(), y0: f(), x1: f(), y1: f(), batch: i(), seg: i(), group: i(), slot: i() };
        let k = 0;
        batches.forEach((b, bi) => {
            const p = b.points;
            let seg = 0, px = NaN, py = NaN;
            for (let q = 0; q < p.length / 3; q++) {
                const x = p[q * 3]!;
                const ok = !Number.isNaN(x) && this.projector.project(x, p[q * 3 + 1]!, p[q * 3 + 2]!, out);
                if (!Number.isNaN(x)) this.projected++;
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
        const cut = <T extends Float64Array | Int32Array>(a: T): T => a.subarray(0, k) as T;
        this.segs = { x0: cut(segs.x0), y0: cut(segs.y0), x1: cut(segs.x1), y1: cut(segs.y1), batch: cut(segs.batch), seg: cut(segs.seg), group: cut(segs.group), slot: cut(segs.slot) };
        for (let s = 0; s < k; s++) this.classify(-1 - s, segs.x0[s]!, segs.y0[s]!, segs.x1[s]!, segs.y1[s]!);
    }

    /**
     * Culls an entry a pointer on the stage cannot reach (off the viewport by more than the target, so a zoomed-in view's
     * thousands of off-screen marks never pile into the border cells), else counts it into its cell(s).
     */
    private classify(e: number, x0: number, y0: number, x1: number, y1: number): void {
        const t = this.opts.targetPx, w = this.projector.width, h = this.projector.height;
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
            const s = this.segs;
            const [x0, y0, x1, y1] = e >= 0 ? [this.ax[e]!, this.ay[e]!, this.bx[e]!, this.by[e]!] : [s!.x0[-1 - e]!, s!.y0[-1 - e]!, s!.x1[-1 - e]!, s!.y1[-1 - e]!];
            const c0 = this.col(Math.min(x0, x1)), c1 = this.col(Math.max(x0, x1)), r0 = this.row(Math.min(y0, y1)), r1 = this.row(Math.max(y0, y1));
            for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) items[fill[r * this.cols + c]!++] = e;
        }
        this.start = start; this.items = items;
    }
}
