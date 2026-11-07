/**
 * Station labels, one side each (right, left, bottom or top of the mark), chosen so that no
 * label sits on another label, a station or an obstacle (a terminus glyph). Each label is the
 * name plus an optional 10px note line. Stations are placed in the order given (the busiest
 * first), each taking its first free side; if none is free the side with the least overlap
 * wins. Pure and deterministic.
 */

import { round } from '../../order';
import { clipName } from '../stationName';

export type Side = 'right' | 'left' | 'bottom' | 'top';
export interface Box { x: number; y: number; w: number; h: number }

export interface LabelItem {
    id: string;
    x: number;
    y: number;
    /** The mark's radius. */
    r: number;
    /** The space the mark really takes, when it is not a circle of radius `r` (a tower's body): other labels keep off all of it. */
    mark?: Box | undefined;
    name: string;
    note: string | null;
}

export interface PlacedLabel {
    id: string;
    side: Side;
    anchor: 'start' | 'end' | 'middle';
    /** The text origin of the name (x, baseline y). */
    x: number;
    y: number;
    /** The baseline of the note line; null when there is none. */
    noteY: number | null;
    text: string;
    note: string | null;
    box: Box;
}

const NAME_CHAR = 6.6;
const NOTE_CHAR = 6;
export const MAX_NAME = 28;
export const MAX_NOTE = 32;
const GAP = 7;
const NAME_H = 13;
const NOTE_H = 12;
/** Preference: under the mark first (the reading position), then beside it, then above. */
const SIDES: readonly Side[] = ['bottom', 'right', 'left', 'top'];

export const clip = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

const overlap = (a: Box, b: Box): number => {
    const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    return w > 0 && h > 0 ? w * h : 0;
};

function place(item: LabelItem, side: Side, text: string, note: string | null): PlacedLabel {
    const w = Math.max(text.length * NAME_CHAR, note ? note.length * NOTE_CHAR : 0);
    const h = NAME_H + (note ? NOTE_H : 0);
    let x0: number, y0: number, anchor: PlacedLabel['anchor'], tx: number;
    const reach = item.r + GAP;
    if (side === 'right') { x0 = item.x + reach; y0 = item.y - h / 2; anchor = 'start'; tx = x0; }
    else if (side === 'left') { x0 = item.x - reach - w; y0 = item.y - h / 2; anchor = 'end'; tx = item.x - reach; }
    else if (side === 'bottom') { x0 = item.x - w / 2; y0 = item.y + reach; anchor = 'middle'; tx = item.x; }
    else { x0 = item.x - w / 2; y0 = item.y - reach - h; anchor = 'middle'; tx = item.x; }
    const nameY = y0 + NAME_H - 2;
    return {
        id: item.id, side, anchor, x: round(tx), y: round(nameY), noteY: note ? round(nameY + NOTE_H) : null,
        text, note, box: { x: round(x0), y: round(y0), w: round(w), h },
    };
}

export interface PlaceOptions {
    /** The drawing's width: a label never leaves it. */
    width: number;
    /** The drawing's height: nor does it leave through the bottom (absent ⇒ unbounded). */
    height?: number;
    /** Boxes a label must not cover (terminus glyphs). */
    obstacles?: readonly Box[];
}

export function placeLabels(items: readonly LabelItem[], opts: PlaceOptions): Map<string, PlacedLabel> {
    const marks: Box[] = items.map((i) => i.mark ?? { x: i.x - i.r - 3, y: i.y - i.r - 3, w: (i.r + 3) * 2, h: (i.r + 3) * 2 });
    const fixed = [...marks, ...(opts.obstacles ?? [])];
    const placed = new Map<string, PlacedLabel>();
    const taken: Box[] = [];
    const cost = (label: PlacedLabel, own: number): number => {
        let c = 0;
        fixed.forEach((b, i) => { if (i !== own) c += overlap(label.box, b); });
        for (const b of taken) c += overlap(label.box, b);
        // Off the drawing is as bad as a collision.
        if (label.box.x < 0) c += -label.box.x * label.box.h * 2;
        if (label.box.x + label.box.w > opts.width) c += (label.box.x + label.box.w - opts.width) * label.box.h * 2;
        if (label.box.y < 0) c += -label.box.y * label.box.w * 2;
        if (opts.height !== undefined && label.box.y + label.box.h > opts.height) c += (label.box.y + label.box.h - opts.height) * label.box.w * 2;
        return c;
    };
    items.forEach((item, own) => {
        const text = clipName(item.name, MAX_NAME), note = item.note ? clip(item.note, MAX_NOTE) : null;
        let best: PlacedLabel | null = null, bestCost = Infinity;
        for (const side of SIDES) {
            const candidate = place(item, side, text, note);
            const c = cost(candidate, own);
            if (c < bestCost) { best = candidate; bestCost = c; }
            if (c === 0) break;
        }
        placed.set(item.id, best!);
        taken.push(best!.box);
    });
    return placed;
}
