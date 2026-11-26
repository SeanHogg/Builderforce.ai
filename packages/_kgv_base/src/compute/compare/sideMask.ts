/**
 * sideMask (PRD 43 Part C5): Before / After as two placements of ONE union MarkSet. The union holds every slot of both
 * sides, so the stage lays it out once; a side is that placement with the slots the side does not have shrunk to scale 0
 * and parked on their anchor (B1a rule 4: a hidden slot grows out of its parent). A new mark therefore grows out of its
 * origin and a removed one merges back when the side flips: the same slots, new positions and scales, so the stage's
 * placement tween does the motion. A post-step over the placement output, never a second placement. Pure.
 *
 * Anchor of an absent slot: the mark it came from (`anchors`: a restructure's `bornFrom`, and its inverse for a removed
 * one), else the station it belongs to, else its folder, else it stays where the placement put it. The links that end on
 * an absent mark's spot follow it there (collapsed onto the anchor), so Before draws no edge to a mark that is not yet.
 */

import type { LabelRun, Placement } from '../../stage/types';
import { collapseLinks, FOOTPRINT_EPS, type CollapseShown, type CollapseSource } from './linkCollapse';

/** The MarkSet fields the mask reads. */
export interface MaskMarks { keys: readonly string[]; parentStation: Int32Array; parentFolder: Int32Array }

const NODE = 'node:';

export function applySideMask(p: Placement, marks: MaskMarks, absent: ReadonlySet<string>, anchors: ReadonlyMap<string, string>): Placement {
    if (absent.size === 0) return p;
    const slotOf = new Map<string, number>();
    marks.keys.forEach((k, i) => { slotOf.set(k.startsWith(NODE) ? k.slice(NODE.length) : k, i); }); // a station is named by its whole key (`st:…`)
    const hidden = new Set<number>();
    for (const ref of absent) { const s = slotOf.get(ref); if (s !== undefined) hidden.add(s); }
    if (hidden.size === 0) return p;

    const position = Float32Array.from(p.position), scale = Float32Array.from(p.scale), extrude = Float32Array.from(p.extrude);
    // The nearest shown mark an absent one comes from or belongs to: its born-from mark, its station, its folder, then
    // theirs in turn, so an anchor that is itself absent is walked past to the first shown ancestor.
    const refOf = (slot: number): string => marks.keys[slot]!.startsWith(NODE) ? marks.keys[slot]!.slice(NODE.length) : marks.keys[slot]!;
    const anchorOf = (slot: number, seen: Set<number>): number => {
        seen.add(slot);
        const born = anchors.get(refOf(slot));
        for (const c of [born === undefined ? undefined : slotOf.get(born), marks.parentStation[slot], marks.parentFolder[slot]]) {
            if (c === undefined || c < 0 || seen.has(c)) continue;
            if (!hidden.has(c)) return c;
            const up = anchorOf(c, seen);
            if (up >= 0) return up;
        }
        return -1;
    };
    // The absent marks the placement actually showed (scale > 0) are the links' sources; one the placement already parked
    // at scale 0 stands nowhere, so no link is "on" it.
    const sources: CollapseSource[] = [];
    for (const slot of hidden) {
        const r = Math.max(p.scale[slot] ?? 0, 0);
        const anchor = anchorOf(slot, new Set());
        if (anchor >= 0) for (let c = 0; c < 3; c++) position[slot * 3 + c] = p.position[anchor * 3 + c]!;
        scale[slot] = 0;
        extrude[slot] = 0;
        if (r <= 0) continue;
        sources.push({
            x: p.position[slot * 3]!, y: p.position[slot * 3 + 1]!, z: p.position[slot * 3 + 2]!, r: Math.max(r, FOOTPRINT_EPS),
            to: anchor >= 0 ? [position[slot * 3]!, position[slot * 3 + 2]!] : null, station: marks.keys[slot]!.startsWith('st:'),
        });
    }
    const shown: CollapseShown[] = [];
    for (let slot = 0; slot < p.scale.length; slot++) {
        if (!hidden.has(slot) && (p.scale[slot] ?? 0) > 0) shown.push({ x: p.position[slot * 3]!, z: p.position[slot * 3 + 2]!, r: Math.max(p.scale[slot]!, FOOTPRINT_EPS) });
    }
    // A shrunk mark names nothing: its caption and its a11y proxy go with it.
    const labels: LabelRun[] = p.labels.filter((l) => !hidden.has(l.slot));
    return { ...p, position, scale, extrude, labels, links: collapseLinks(p.links, sources, shown), a11y: p.a11y.filter((a) => !hidden.has(a.slot)) };
}
