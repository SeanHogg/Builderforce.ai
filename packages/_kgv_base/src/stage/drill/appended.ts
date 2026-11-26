/**
 * The slots a drill appended after the MarkSet (PRD 43 B1a rule 1), remembered by the renderer for the life of the
 * MarkSet. A placement built for the plain MarkSet (the world map after "Out") does not cover them: {@link pad} extends
 * it so each appended slot sits hidden (scale 0) at its station, else its folder — so going out collapses the drilled
 * symbols back into the station they grew from. Pure.
 */

import { batchesOf } from '../../compute/tasks/markSet';
import { capacityFor } from '../slots';
import type { MarkSet, Placement, SlotAppend } from '../types';

/**
 * The MarkSet with `run` folded in — the overflow path only (a drill that does not fit the headroom): the stage rebuilds
 * its meshes from it, the one time a mesh is created outside a new graph. Same generation, so paint and placements apply.
 */
export function withAppended(m: MarkSet, run: SlotAppend): MarkSet {
    const keep = Math.max(0, m.keys.length - run.base);
    const k = run.keys.length - keep;
    if (k <= 0) return m;
    const grow = <T extends Uint8Array | Int32Array | Float32Array>(a: T, b: T, make: (n: number) => T): T => { const out = make(a.length + k); out.set(a); out.set(b.subarray(keep), a.length); return out; };
    const type = grow(m.type, run.type, (n) => new Uint8Array(n));
    return {
        ...m,
        keys: [...m.keys, ...run.keys.slice(keep)], label: [...m.label, ...run.label.slice(keep)], tooltip: [...m.tooltip, ...run.tooltip.slice(keep)],
        slotKind: grow(m.slotKind, run.slotKind, (n) => new Uint8Array(n)), type, importance: grow(m.importance, run.importance, (n) => new Float32Array(n)),
        parentStation: grow(m.parentStation, run.parentStation, (n) => new Int32Array(n)), parentFolder: grow(m.parentFolder, run.parentFolder, (n) => new Int32Array(n)),
        batches: batchesOf(type), capacity: capacityFor(type.length),
    };
}

export class AppendedSlots {
    private base = -1;
    private parentStation: number[] = [];
    private parentFolder: number[] = [];

    /** How many slots exist in all (the MarkSet's plus the appended); 0 before any append. */
    get total(): number { return this.base < 0 ? 0 : this.base + this.parentStation.length; }

    reset(): void { this.base = -1; this.parentStation = []; this.parentFolder = []; }

    add(run: SlotAppend): void {
        if (this.base < 0) this.base = run.base;
        for (let i = 0; i < run.keys.length; i++) {
            const at = run.base + i - this.base;
            if (at < this.parentStation.length) continue;
            this.parentStation.push(run.parentStation[i]!);
            this.parentFolder.push(run.parentFolder[i]!);
        }
    }

    /** `p` covering every appended slot (the same object when it already does). */
    pad(p: Placement): Placement {
        const total = this.total, have = p.scale.length;
        if (total <= have) return p;
        const position = new Float32Array(total * 3), scale = new Float32Array(total), extrude = new Float32Array(total);
        position.set(p.position); scale.set(p.scale); extrude.set(p.extrude);
        const { min, max } = p.bounds;
        for (let s = have; s < total; s++) {
            const k = s - this.base;
            const parent = [this.parentStation[k]!, this.parentFolder[k]!].find((q) => q >= 0 && q < have);
            for (let c = 0; c < 3; c++) position[s * 3 + c] = parent === undefined ? (min[c]! + max[c]!) / 2 : p.position[parent * 3 + c]!;
        }
        return { ...p, position, scale, extrude };
    }
}
