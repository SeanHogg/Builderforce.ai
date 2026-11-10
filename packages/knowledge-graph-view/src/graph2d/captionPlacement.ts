/**
 * Where the 2D graph's text goes, and which captions have room. PURE, in layout units. A band caption sits at its
 * band's top-left; a node caption sits right of its node, or left of it when the right is taken, and is dropped when
 * both sides would overlap a caption already placed (the node's tab stop and `aria-label` still carry the name).
 * Captions are placed in the order given — the caller passes the selection first, then importance order — so the
 * captions that matter most always win. Text sizes come from the mind map's label budget (ONE estimate of glyph size).
 */

import { LINE_EM, textWidth } from '../map/labelBudget';
import type { Band, Bounds } from './layout2d';

export interface Box { x: number; y: number; w: number; h: number }

export interface CaptionCandidate {
    ref: string;
    x: number;
    y: number;
    /** The node's radius, in layout units. */
    r: number;
    text: string;
    /** Placed even with no free side (the selection's name is never dropped); it still claims its box. */
    always?: boolean;
}

export interface PlacedCaption {
    ref: string;
    /** The text's anchor point and baseline. */
    x: number;
    y: number;
    anchor: 'start' | 'end';
    box: Box;
}

/** Where a band's caption is drawn (start-anchored, at its baseline), and the box it covers. */
export function bandCaption(band: Band, bounds: Bounds, font: number, text: string): { x: number; y: number; box: Box } {
    const x = bounds.minX + font, y = band.top + font * 1.6;
    return { x, y, box: { x, y: y - font, w: textWidth(text.length, font), h: font * LINE_EM } };
}

export const overlaps = (a: Box, b: Box): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** A uniform grid over placed boxes, so each test reads only the boxes near it (thousands of neighbours stay cheap). */
class BoxGrid {
    private readonly cells = new Map<string, Box[]>();
    constructor(private readonly cell: number) {}
    private span(b: Box): [number, number, number, number] {
        const c = this.cell;
        return [Math.floor(b.x / c), Math.floor((b.x + b.w) / c), Math.floor(b.y / c), Math.floor((b.y + b.h) / c)];
    }
    hits(b: Box): boolean {
        const [x0, x1, y0, y1] = this.span(b);
        for (let i = x0; i <= x1; i++) for (let j = y0; j <= y1; j++) {
            for (const o of this.cells.get(`${i},${j}`) ?? []) if (overlaps(o, b)) return true;
        }
        return false;
    }
    add(b: Box): void {
        const [x0, x1, y0, y1] = this.span(b);
        for (let i = x0; i <= x1; i++) for (let j = y0; j <= y1; j++) {
            const k = `${i},${j}`;
            const list = this.cells.get(k);
            if (list) list.push(b); else this.cells.set(k, [b]);
        }
    }
}

/**
 * The captions that fit, in placement order: none overlaps another or any of `obstacles` (the band captions).
 * `font` is the label size in layout units.
 */
export function placeCaptions(candidates: readonly CaptionCandidate[], font: number, obstacles: readonly Box[] = []): PlacedCaption[] {
    if (!(font > 0)) return [];
    const h = font * LINE_EM;
    const grid = new BoxGrid(h * 4);
    for (const o of obstacles) grid.add(o);
    const out: PlacedCaption[] = [];
    for (const c of candidates) {
        const w = textWidth(c.text.length, font), gap = c.r + font * 0.4;
        const top = c.y - h / 2, baseline = c.y + font * 0.35;
        const right: PlacedCaption = { ref: c.ref, x: c.x + gap, y: baseline, anchor: 'start', box: { x: c.x + gap, y: top, w, h } };
        const left: PlacedCaption = { ref: c.ref, x: c.x - gap, y: baseline, anchor: 'end', box: { x: c.x - gap - w, y: top, w, h } };
        const spot = !grid.hits(right.box) ? right : !grid.hits(left.box) ? left : c.always ? right : null;
        if (!spot) continue;
        grid.add(spot.box);
        out.push(spot);
    }
    return out;
}
