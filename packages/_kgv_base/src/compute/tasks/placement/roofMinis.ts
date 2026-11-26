/**
 * ROOF MINIATURES (the design's): an enterable shape on the Map shows what is inside it, small, on its roof. The children of
 * a drawn station (the slots whose `parentStation` it is) are placed as small marks standing on its roof — at most
 * {@link MINIS_MAX} each, in a grid over the roof's footprint — so entering the station grows the children out of those roof
 * positions (visibility is scale: the same slots, shown at full size on the next level's floor). Skipped on a crowded level
 * (the existing large-graph caps: more than {@link MINIS_LEVEL_MAX} stations draw no roofs). Pure.
 */

import { SLOT_NODE } from '../../../stage/types';
import type { StageModel } from '../stageModel';
import { VISIBLE, show, type Draft } from './anchor';

/** The design's cap on miniatures per roof. */
export const MINIS_MAX = 12;
/** More drawn stations than this and no roofs are built (a crowded level reads as a map, not as shapes to look into). */
export const MINIS_LEVEL_MAX = 80;
/** A mini is this share of its parent's half-size across, and this share tall. */
const MINI_SHARE = 0.22, MINI_RISE = 0.14;
/** A mini's half-size at most this share of its grid cell, so neighbours keep a gap. */
const MINI_CELL_FILL = 0.4;

export function roofMinis(model: StageModel, d: Draft, drawn: readonly string[]): void {
    if (drawn.length > MINIS_LEVEL_MAX) return;
    const { marks, stationSlot } = model;
    const kids = new Map<number, number[]>();
    for (let i = 0; i < marks.parentStation.length; i++) {
        const parent = marks.parentStation[i]!;
        if (parent < 0 || marks.slotKind[i] !== SLOT_NODE || d.placed[i] === VISIBLE) continue;
        const list = kids.get(parent);
        if (!list) kids.set(parent, [i]); else if (list.length < MINIS_MAX) list.push(i);
    }
    for (const id of drawn) {
        const slot = stationSlot.get(id);
        const list = slot === undefined ? undefined : kids.get(slot);
        if (slot === undefined || !list || d.scale[slot]! <= 0) continue;
        const size = d.scale[slot]!, cols = Math.ceil(Math.sqrt(list.length)), cell = (size * 1.5) / cols;
        // A mini never outgrows its grid cell (a full roof of 12 would otherwise overlap its neighbours).
        const half = Math.min(size * MINI_SHARE, cell * MINI_CELL_FILL);
        const roof = d.extrude[slot]!;
        list.forEach((child, k) => {
            const cx = (k % cols) - (cols - 1) / 2, cz = Math.floor(k / cols) - (Math.ceil(list.length / cols) - 1) / 2;
            show(d, child, d.position[slot * 3]! + cx * cell, roof, d.position[slot * 3 + 2]! + cz * cell, half, size * MINI_RISE);
        });
    }
}
