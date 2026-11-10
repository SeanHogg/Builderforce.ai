/**
 * key → slot, and slot → (batch, instance), for the life of a MarkSet. Capacity is preallocated (the slot count plus
 * drill headroom), so a drill APPENDS into the headroom with a ranged upload and only an overflow rebuilds (B1a rule 1,
 * B3). A removed slot becomes a zero-scale hole; the table is compacted only on a full rebuild, so a key keeps its slot.
 * Pure: the worker sizes `MarkSet.capacity` with {@link capacityFor} and the renderer sizes each batch with it.
 */

import type { MarkSet } from './types';

/** Slots allocated for `count`: a quarter more, at least {@link MIN_HEADROOM}, so a drill's symbols fit without a rebuild. */
export function capacityFor(count: number): number {
    return count + Math.max(MIN_HEADROOM, Math.ceil(count / 4));
}

/** A drilled level shows at most 60 members (`drillView.MAX_MEMBERS`): one level always fits an empty batch. */
const MIN_HEADROOM = 64;

export class SlotTable {
    private readonly byKey = new Map<string, number>();
    /** Per slot: its batch, and its instance index inside that batch's mesh. */
    readonly batchOf: Int32Array;
    readonly instanceOf: Int32Array;
    /** Per batch: the slot of each instance (`batchSlots[b][i]`), and how many instances are used. */
    readonly batchSlots: Uint32Array[];
    readonly batchCount: number[];
    readonly batchType: number[];
    private used: number;

    constructor(set: Pick<MarkSet, 'keys' | 'batches' | 'capacity'>) {
        const capacity = Math.max(set.capacity, set.keys.length);
        this.batchOf = new Int32Array(capacity).fill(-1);
        this.instanceOf = new Int32Array(capacity).fill(-1);
        set.keys.forEach((k, i) => this.byKey.set(k, i));
        this.used = set.keys.length;
        this.batchType = set.batches.map((b) => b.type);
        this.batchCount = set.batches.map((b) => b.slots.length);
        this.batchSlots = set.batches.map((b, bi) => {
            const slots = new Uint32Array(capacityFor(b.slots.length));
            slots.set(b.slots);
            b.slots.forEach((s, i) => { this.batchOf[s] = bi; this.instanceOf[s] = i; });
            return slots;
        });
    }

    get size(): number { return this.used; }
    get capacity(): number { return this.batchOf.length; }

    slotOf(key: string): number { return this.byKey.get(key) ?? -1; }

    /** The instance capacity of batch `b` (what its mesh was created with). */
    batchCapacity(b: number): number { return this.batchSlots[b]!.length; }

    /**
     * Appends `key` of `type` (a drilled symbol). Returns its slot, or -1 when the table or the type's batch is full:
     * the caller rebuilds (the only path that creates a mesh). A known key returns its slot.
     */
    append(key: string, type: number): number {
        const known = this.byKey.get(key);
        if (known !== undefined) return known;
        const b = this.batchType.indexOf(type);
        if (b < 0 || this.used >= this.capacity || this.batchCount[b]! >= this.batchCapacity(b)) return -1;
        const slot = this.used++;
        const i = this.batchCount[b]!++;
        this.byKey.set(key, slot);
        this.batchOf[slot] = b;
        this.instanceOf[slot] = i;
        this.batchSlots[b]![i] = slot;
        return slot;
    }

    /**
     * Appends a placement's run of slots (`Placement.append`: keys numbered from `base`, in order). Keys already held keep
     * their slot. False when a key would land on another slot than the run names, or a batch is full: the caller rebuilds.
     */
    appendRun(run: { base: number; keys: readonly string[]; type: ArrayLike<number> }): boolean {
        for (let i = 0; i < run.keys.length; i++) {
            const want = run.base + i, key = run.keys[i]!;
            const known = this.byKey.get(key);
            if (known !== undefined) { if (known !== want) return false; continue; }
            if (this.used !== want || this.append(key, run.type[i]!) !== want) return false;
        }
        return true;
    }
}
