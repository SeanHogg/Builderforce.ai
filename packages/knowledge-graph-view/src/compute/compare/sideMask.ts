/**
 * sideMask (PRD 43 Part C5): Before / After as two placements of ONE union MarkSet. The union holds every slot of both
 * sides, so the stage lays it out once; a side is that placement with the slots the side does not have shrunk to scale 0
 * and parked on their anchor (B1a rule 4: a hidden slot grows out of its parent). A new mark therefore grows out of its
 * origin and a removed one merges back when the side flips: the same slots, new positions and scales, so the stage's
 * placement tween does the motion. A post-step over the placement output, never a second placement. Pure.
 *
 * Anchor of an absent slot: the mark it came from (`anchors`: a restructure's `bornFrom`, and its inverse for a removed
 * one), else the station it belongs to, else its folder, else it stays where the placement put it.
 */

import type { LabelRun, Placement } from '../../stage/types';

/** The MarkSet fields the mask reads. */
export interface MaskMarks { keys: readonly string[]; parentStation: Int32Array; parentFolder: Int32Array }

const NODE = 'node:';

export function applySideMask(p: Placement, marks: MaskMarks, absent: ReadonlySet<string>, anchors: ReadonlyMap<string, string>): Placement {
    if (absent.size === 0) return p;
    const slotOf = new Map<string, number>();
    marks.keys.forEach((k, i) => { if (k.startsWith(NODE)) slotOf.set(k.slice(NODE.length), i); });
    const hidden = new Set<number>();
    for (const ref of absent) { const s = slotOf.get(ref); if (s !== undefined) hidden.add(s); }
    if (hidden.size === 0) return p;

    const position = Float32Array.from(p.position), scale = Float32Array.from(p.scale), extrude = Float32Array.from(p.extrude);
    for (const slot of hidden) {
        const bornFrom = anchors.get(marks.keys[slot]!.slice(NODE.length));
        const origin = bornFrom === undefined ? undefined : slotOf.get(bornFrom);
        const anchor = origin !== undefined && !hidden.has(origin) ? origin : marks.parentStation[slot]! >= 0 ? marks.parentStation[slot]! : marks.parentFolder[slot]!;
        if (anchor >= 0 && !hidden.has(anchor)) for (let c = 0; c < 3; c++) position[slot * 3 + c] = p.position[anchor * 3 + c]!;
        scale[slot] = 0;
        extrude[slot] = 0;
    }
    // A shrunk mark names nothing: its caption and its a11y proxy go with it.
    const labels: LabelRun[] = p.labels.filter((l) => !hidden.has(l.slot));
    return { ...p, position, scale, extrude, labels, a11y: p.a11y.filter((a) => !hidden.has(a.slot)) };
}
