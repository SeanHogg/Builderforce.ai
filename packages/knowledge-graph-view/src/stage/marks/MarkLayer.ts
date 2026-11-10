/**
 * The marks on the stage (PRD 43 B1a rules 1, 4, 5; B3 Marks): ONE `InstancedMesh` per type batch of the MarkSet, sized
 * at the batch's capacity, created in {@link MarkLayer.setMarks} only (a new graph, or an overflow). Per instance it holds
 * two placement sets, A and B — `placeA` / `placeB` (position xyz + scale) and `extrudeAB` — and the paint (tone, tone2,
 * fill, flags as one vec4). Packed because D3D11 ANGLE links at most 16 vertex attributes (instanceMatrix takes 4).
 *
 * A placement swap writes the incoming placement into the STALE set (2 ranged uploads per batch: its `place` and
 * `extrudeAB`) and flips which set is the target; the shared uniform `uT` tweens between them. Paint is one upload, made
 * only when paint changes. Framework-free (plain three.js), so the R3F stage, the measurement page and the tests drive
 * the same object.
 */

import { DynamicDrawUsage, Group, InstancedBufferAttribute, InstancedMesh, type ShaderMaterial } from 'three';
import { DASHED_SHAPES, MARK_TYPE_ORDER, SHAPE_OUTLINES, TYPE_SHAPE } from '../../shapes';
import { SlotTable } from '../slots';
import { uploadRange, type StageStats } from '../stats';
import type { MarkPaint, MarkSet, Placement, SlotAppend } from '../types';
import { markGeometry } from './geometry';
import { markMaterial, type SharedMarkUniforms } from './shader';

interface Batch {
    mesh: InstancedMesh;
    /** placeA, placeB: xyz + scale per instance. */
    place: [InstancedBufferAttribute, InstancedBufferAttribute];
    /** extrude A in x, B in y. */
    extrude: InstancedBufferAttribute;
    paint: InstancedBufferAttribute;
}

const dynamic = (capacity: number, itemSize: number): InstancedBufferAttribute =>
    new InstancedBufferAttribute(new Float32Array(capacity * itemSize), itemSize).setUsage(DynamicDrawUsage);

export class MarkLayer {
    readonly group = new Group();
    private batches: Batch[] = [];
    private table: SlotTable | null = null;
    /** Which set holds the current target: 0 = A, 1 = B. */
    private target: 0 | 1 = 1;
    private placed = false;

    constructor(private readonly stats: StageStats, private readonly uniforms: SharedMarkUniforms) {}

    get slots(): SlotTable | null { return this.table; }

    /** Builds one mesh per batch: the ONLY place a mark mesh is created. */
    setMarks(set: MarkSet): void {
        this.dispose();
        const table = new SlotTable(set);
        this.table = table;
        this.forest = set;
        this.appendedParent.clear();
        this.batches = set.batches.map((b, bi) => {
            const capacity = table.batchCapacity(bi);
            const shape = TYPE_SHAPE[MARK_TYPE_ORDER[b.type] ?? 'external'];
            const geometry = markGeometry(shape);
            const batch = { place: [dynamic(capacity, 4), dynamic(capacity, 4)] as [InstancedBufferAttribute, InstancedBufferAttribute], extrude: dynamic(capacity, 2), paint: dynamic(capacity, 4) };
            geometry.setAttribute('placeA', batch.place[0]);
            geometry.setAttribute('placeB', batch.place[1]);
            geometry.setAttribute('extrudeAB', batch.extrude);
            geometry.setAttribute('paint', batch.paint);
            const mesh = new InstancedMesh(geometry, markMaterial(this.uniforms, SHAPE_OUTLINES[shape], DASHED_SHAPES.has(shape)), capacity);
            this.stats.meshesCreated++;
            mesh.count = table.batchCount[bi]!;
            mesh.frustumCulled = false;
            mesh.renderOrder = 2;
            mesh.name = `marks:${shape}`;
            this.group.add(mesh);
            return { mesh, ...batch };
        });
        this.placed = false;
        this.target = 1;
    }

    /** The forest of the MarkSet the meshes were built from (an overflow rebuild's includes the appended slots). */
    private forest: Pick<MarkSet, 'parentStation' | 'parentFolder'> | null = null;
    /** Appended runs since: their parents, by slot. */
    private readonly appendedParent = new Map<number, number>();

    private parentOf(s: number): number {
        const f = this.forest;
        if (f && s < f.parentStation.length) return f.parentStation[s]! >= 0 ? f.parentStation[s]! : f.parentFolder[s]!;
        return this.appendedParent.get(s) ?? -1;
    }

    setPaint(paint: MarkPaint): void {
        const table = this.table;
        if (!table) return;
        this.batches.forEach((b, bi) => {
            const slots = table.batchSlots[bi]!, count = table.batchCount[bi]!;
            const out = b.paint.array as Float32Array;
            for (let i = 0; i < count; i++) {
                let s = slots[i]!;
                // An appended slot (a drilled symbol) the paint predates is painted like its station (else folder);
                // one with neither, held since an append, keeps what it has.
                if (s >= paint.tone.length) {
                    const parent = this.parentOf(s);
                    if (parent < 0 || parent >= paint.tone.length) continue;
                    s = parent;
                }
                out[i * 4] = paint.tone[s] ?? 0; out[i * 4 + 1] = paint.tone2[s] ?? 0; out[i * 4 + 2] = paint.fill[s] ?? 0; out[i * 4 + 3] = paint.flags[s] ?? 0;
            }
            uploadRange(this.stats, b.paint, 0, count, bi);
        });
    }

    /**
     * Writes `p` into the stale set and makes it the target; returns the `uFlip` value to tween with. The first placement
     * fills both sets (there is nothing to tween from).
     *
     * `midTween` (the eased `uT` of a tween still running): a placement replacing one mid-flight. The marks are baked
     * where they are NOW — the stale set gets the current mix — and `p` goes into the target set, so the next tween
     * continues from the marks' on-screen positions instead of snapping to the old target first. 3 uploads per batch.
     */
    setPlacement(p: Placement, midTween?: number): number {
        const table = this.table;
        if (!table) return this.target === 1 ? 0 : 1;
        if (this.placed && midTween !== undefined && midTween < 1) return this.retarget(p, midTween, table);
        const into: 0 | 1 = this.placed ? (this.target === 1 ? 0 : 1) : 1;
        const writeSets: Array<0 | 1> = this.placed ? [into] : [0, 1];
        this.batches.forEach((b, bi) => {
            const slots = table.batchSlots[bi]!, count = table.batchCount[bi]!;
            const extrude = b.extrude.array as Float32Array;
            for (const w of writeSets) {
                const place = b.place[w].array as Float32Array;
                for (let i = 0; i < count; i++) {
                    const s = slots[i]!;
                    place[i * 4] = p.position[s * 3]!; place[i * 4 + 1] = p.position[s * 3 + 1]!; place[i * 4 + 2] = p.position[s * 3 + 2]!;
                    place[i * 4 + 3] = p.scale[s]!;
                    extrude[i * 2 + w] = p.extrude[s]!;
                }
                uploadRange(this.stats, b.place[w], 0, count, bi);
            }
            uploadRange(this.stats, b.extrude, 0, count, bi);
        });
        this.placed = true;
        this.target = into;
        // uFlip = 0 tweens A → B (target B); 1 tweens B → A (target A).
        return into === 1 ? 0 : 1;
    }

    /** Mid-tween replacement: stale ← mix(stale, target, t) (where the marks are), target ← `p`; the target set stays. */
    private retarget(p: Placement, t: number, table: SlotTable): number {
        const to = this.target, from: 0 | 1 = to === 1 ? 0 : 1;
        this.batches.forEach((b, bi) => {
            const slots = table.batchSlots[bi]!, count = table.batchCount[bi]!;
            const a = b.place[from].array as Float32Array, z = b.place[to].array as Float32Array, ex = b.extrude.array as Float32Array;
            for (let i = 0; i < count; i++) {
                for (let c = 0; c < 4; c++) a[i * 4 + c] = a[i * 4 + c]! + (z[i * 4 + c]! - a[i * 4 + c]!) * t;
                ex[i * 2 + from] = ex[i * 2 + from]! + (ex[i * 2 + to]! - ex[i * 2 + from]!) * t;
                const s = slots[i]!;
                z[i * 4] = p.position[s * 3]!; z[i * 4 + 1] = p.position[s * 3 + 1]!; z[i * 4 + 2] = p.position[s * 3 + 2]!;
                z[i * 4 + 3] = p.scale[s]!;
                ex[i * 2 + to] = p.extrude[s]!;
            }
            uploadRange(this.stats, b.place[from], 0, count, bi);
            uploadRange(this.stats, b.place[to], 0, count, bi);
            uploadRange(this.stats, b.extrude, 0, count, bi);
        });
        return to === 1 ? 0 : 1;
    }

    /**
     * Appends a placement's run of slots into the batches' headroom (B1a rule 1: a drill appends, ranged; no mesh is
     * created). Each new instance starts where its station or folder stands in `from` (the placement on screen) at scale
     * 0, painted like it, so the next placement grows it out of its parent. False on overflow: the caller rebuilds.
     */
    append(run: SlotAppend, from: Placement | null): boolean {
        const table = this.table;
        if (!table) return false;
        const before = table.batchCount.slice();
        if (!table.appendRun(run)) return false;
        const set = this.target;
        this.batches.forEach((b, bi) => {
            const start = before[bi]!, count = table.batchCount[bi]! - start;
            if (count <= 0) return;
            const place = b.place[set].array as Float32Array, other = b.place[set === 1 ? 0 : 1].array as Float32Array;
            const extrude = b.extrude.array as Float32Array, paint = b.paint.array as Float32Array;
            for (let i = start; i < start + count; i++) {
                const k = table.batchSlots[bi]![i]! - run.base;
                const parent = run.parentStation[k]! >= 0 ? run.parentStation[k]! : run.parentFolder[k]!;
                this.appendedParent.set(run.base + k, parent);
                for (let c = 0; c < 3; c++) place[i * 4 + c] = other[i * 4 + c] = parent >= 0 && from ? from.position[parent * 3 + c] ?? 0 : 0;
                place[i * 4 + 3] = other[i * 4 + 3] = 0;
                extrude[i * 2] = extrude[i * 2 + 1] = 0;
                const pb = parent >= 0 ? table.batchOf[parent]! : -1;
                if (pb >= 0) for (let c = 0; c < 4; c++) paint[i * 4 + c] = (this.batches[pb]!.paint.array as Float32Array)[table.instanceOf[parent]! * 4 + c]!;
            }
            uploadRange(this.stats, b.place[0], start, count, bi);
            uploadRange(this.stats, b.place[1], start, count, bi);
            uploadRange(this.stats, b.extrude, start, count, bi);
            uploadRange(this.stats, b.paint, start, count, bi);
            b.mesh.count = table.batchCount[bi]!;
        });
        return true;
    }

    /** The meshes, for the renderer spy and the draw-call count. */
    get meshes(): readonly InstancedMesh[] { return this.batches.map((b) => b.mesh); }

    dispose(): void {
        for (const b of this.batches) {
            this.group.remove(b.mesh);
            b.mesh.geometry.dispose();
            (b.mesh.material as ShaderMaterial).dispose();
        }
        this.batches = [];
        this.table = null;
    }
}
