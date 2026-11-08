/**
 * Which mind-map labels have room. A label is drawn only when it fits where it sits; otherwise the dot stays unlabelled
 * and its label shows on hover, focus or tap (the `<title>` and `aria-label` always carry it). PURE: lengths are in the
 * same units (the map's viewBox units).
 *
 * Labels are laid out horizontally. A branch near the left or right of the map has its label run RADIALLY, so its
 * neighbours on the ring are stacked beside it: the arc between them only has to clear the text's HEIGHT, and the text's
 * WIDTH must fit in the radial room before the next ring. A branch near the top or bottom has its label run ALONG the
 * ring, so the arc must hold the text's width.
 */

/** A glyph is about this wide, as a fraction of the font size. */
export const GLYPH_EM = 0.6;
/** A line of text is about this tall, as a fraction of the font size. */
export const LINE_EM = 1.2;
/** A branch whose |cos(angle)| is above this has a side label (radial); below it, a top or bottom one (along the ring). */
export const SIDE_COS = 0.5;

/** The estimated width of `chars` characters at `font`. */
export const textWidth = (chars: number, font: number): number => chars * font * GLYPH_EM;

/** The arc a branch owns on its ring: `2π·r·span/total`, i.e. the radius times its share in radians. */
export const arcLength = (radius: number, spanRadians: number): number => radius * spanRadians;

/** True when the label fits in the branch's arc, ignoring direction. The root (radius 0, no ring) is always labelled by the caller. */
export function labelFits(radius: number, spanRadians: number, chars: number, font: number): boolean {
    return arcLength(radius, spanRadians) >= textWidth(chars, font);
}

export interface LabelSpot {
    radius: number;
    /** The branch's share of its ring, in radians. */
    span: number;
    /** Where the branch sits around the map, in radians. */
    angle: number;
    /** The radial room before the next ring (Infinity for a leaf). */
    room: number;
    chars: number;
    font: number;
}

/** True when the label fits where this branch sits, by the direction it runs in (see the module comment). */
export function labelFitsAt(s: LabelSpot): boolean {
    const arc = arcLength(s.radius, s.span);
    if (Math.abs(Math.cos(s.angle)) > SIDE_COS) return arc >= s.font * LINE_EM && textWidth(s.chars, s.font) <= s.room;
    return arc >= textWidth(s.chars, s.font);
}
