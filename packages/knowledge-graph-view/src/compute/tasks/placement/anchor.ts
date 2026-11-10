/**
 * Visibility is scale (PRD 43 B1a rule 4). A placement sets position, scale and extrude for the slots it SHOWS; this
 * places every other slot at scale 0 where it should grow from, so a tween between two cameras is continuous:
 *
 *   - a hidden aggregate (station, folder) sits at the centroid of its visible members;
 *   - a hidden node sits at its nearest placed ancestor (the placement's scheme first: its station, or its folder chain;
 *     the other scheme when that has nothing placed);
 *   - anything left (no placed relative at all) sits at the placement's centre.
 *
 * So Map → Graph grows each station's members out of the station while the station shrinks into their centroid. Pure.
 */

import { SLOT_NODE, type MarkSet, type Vec3 } from '../../../stage/types';

export interface Draft {
    position: Float32Array;
    scale: Float32Array;
    extrude: Float32Array;
    /** 1 = placed by the camera (visible), 2 = anchored (hidden, but has a position), 0 = not placed yet. */
    placed: Uint8Array;
}

export const VISIBLE = 1;
const ANCHORED = 2;

export function draftFor(slots: number): Draft {
    return { position: new Float32Array(slots * 3), scale: new Float32Array(slots), extrude: new Float32Array(slots), placed: new Uint8Array(slots) };
}

/** Shows slot `i` at (x, y, z) with `scale` and `extrude`. */
export function show(d: Draft, i: number, x: number, y: number, z: number, scale: number, extrude = 0): void {
    d.position[i * 3] = x; d.position[i * 3 + 1] = y; d.position[i * 3 + 2] = z;
    d.scale[i] = scale; d.extrude[i] = extrude; d.placed[i] = VISIBLE;
}

type Marks = Pick<MarkSet, 'slotKind' | 'parentStation' | 'parentFolder'>;

export function anchorHidden(marks: Marks, d: Draft, scheme: 'station' | 'folder', centre: Vec3): void {
    const n = d.scale.length;
    const sum = new Float64Array(n * 3), count = new Uint32Array(n);
    const add = (to: number, from: number) => {
        if (to < 0 || d.placed[to] === VISIBLE) return;
        for (let k = 0; k < 3; k++) sum[to * 3 + k] = sum[to * 3 + k]! + d.position[from * 3 + k]!;
        count[to] = count[to]! + 1;
    };
    // Every visible slot votes for its hidden station and every hidden folder above it.
    for (let i = 0; i < n; i++) {
        if (d.placed[i] !== VISIBLE) continue;
        add(marks.parentStation[i]!, i);
        for (let f = marks.parentFolder[i]!, guard = 0; f >= 0 && guard < 64; f = marks.parentFolder[f]!, guard++) add(f, i);
    }
    for (let i = 0; i < n; i++) {
        if (d.placed[i] === VISIBLE || marks.slotKind[i] === SLOT_NODE || count[i] === 0) continue;
        hide(d, i, sum[i * 3]! / count[i]!, sum[i * 3 + 1]! / count[i]!, sum[i * 3 + 2]! / count[i]!);
    }
    // Hidden nodes, then any aggregate still unplaced, at their nearest placed ancestor.
    for (const pass of [true, false]) {
        for (let i = 0; i < n; i++) {
            if (d.placed[i] !== 0 || (marks.slotKind[i] === SLOT_NODE) !== pass) continue;
            const at = ancestorOf(marks, d, i, scheme);
            if (at >= 0) hide(d, i, d.position[at * 3]!, d.position[at * 3 + 1]!, d.position[at * 3 + 2]!);
            else hide(d, i, centre[0], centre[1], centre[2]);
        }
    }
}

function hide(d: Draft, i: number, x: number, y: number, z: number): void {
    d.position[i * 3] = x; d.position[i * 3 + 1] = y; d.position[i * 3 + 2] = z;
    d.scale[i] = 0; d.extrude[i] = 0; d.placed[i] = ANCHORED;
}

/** The nearest placed (visible or anchored) ancestor, the scheme's chain first; -1 for none. */
function ancestorOf(marks: Marks, d: Draft, i: number, scheme: 'station' | 'folder'): number {
    const station = (): number => { const s = marks.parentStation[i]!; return s >= 0 && d.placed[s] !== 0 ? s : -1; };
    const folder = (): number => {
        for (let f = marks.parentFolder[i]!, guard = 0; f >= 0 && guard < 64; f = marks.parentFolder[f]!, guard++) if (d.placed[f] !== 0) return f;
        return -1;
    };
    if (scheme === 'station') { const s = station(); return s >= 0 ? s : folder(); }
    const f = folder();
    return f >= 0 ? f : station();
}
