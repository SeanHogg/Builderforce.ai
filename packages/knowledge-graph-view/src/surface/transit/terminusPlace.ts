/**
 * Where a line's end stands: beside its last station when that spot is free, else under or over it, and
 * never on another station's mark or on another end. Pure.
 */

import type { Point } from './geometry';
import type { Box } from './labelPlacement';

/** The room a glyph and its name take, so labels and stations keep off it. */
export const TERMINUS_W = 96;
export const TERMINUS_H = 52;
/** How far right of its station a line's end stands. */
const SIDE_OFFSET = 42;
const VERTICAL_OFFSET = 56;

export const terminusBox = (at: Point): Box => ({ x: at.x - TERMINUS_W / 2, y: at.y - 14, w: TERMINUS_W, h: TERMINUS_H });

const meets = (a: Box, b: Box): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * `marks` are the boxes of the stations' marks (the terminus's own included: it is skipped by position);
 * `taken` the boxes of the ends already placed.
 */
export function placeTerminus(from: Point, size: number, marks: readonly Box[], taken: readonly Box[]): Point {
    const candidates: Point[] = [
        { x: from.x + size + SIDE_OFFSET, y: from.y },
        { x: from.x, y: from.y + VERTICAL_OFFSET },
        { x: from.x, y: from.y - VERTICAL_OFFSET },
        { x: from.x + size + SIDE_OFFSET * 2.2, y: from.y },
    ];
    const ownMark = (m: Box): boolean => from.x >= m.x && from.x <= m.x + m.w && from.y >= m.y && from.y <= m.y + m.h;
    const free = (p: Point): boolean => {
        const box = terminusBox(p);
        return !marks.some((m) => !ownMark(m) && meets(box, m)) && !taken.some((t) => meets(box, t));
    };
    return candidates.find(free) ?? candidates[0]!;
}
