/**
 * The pure geometry behind the Project 360 sunburst — polar projection, annular-sector
 * path building, label placement and label wrapping.
 *
 * Split out of `Sunburst.tsx` for one reason: a chart drawn with hand-rolled trigonometry
 * has no chart library to be right on its behalf, so its maths is exactly the part that
 * needs assertions — and maths buried inside a React component body cannot be asserted
 * without mounting a DOM. These functions are pure `number → number`, so they are tested
 * directly. `Sunburst.tsx` keeps the presentation and imports every coordinate from here;
 * there is no second copy of any of it.
 *
 * Conventions, fixed by this module so the component cannot disagree with the tests:
 *  - Angles are DEGREES, `0` at twelve o'clock, increasing CLOCKWISE.
 *  - The viewBox is 320×320 with the wheel centred at (160, 160).
 */

/** SVG viewBox width/height the wheel is drawn into. */
export const VIEWBOX = 320;
/** Wheel centre X. */
export const CX = 160;
/** Wheel centre Y. */
export const CY = 160;
/** Radius of the centre disc that shows the overall score. */
export const R_CENTER = 46;
/** Inner ring (pillars): inner and outer radius. */
export const R_INNER_0 = 48;
export const R_INNER_1 = 96;
/** Outer ring (dimensions): inner and outer radius. */
export const R_OUTER_0 = 100;
export const R_OUTER_1 = 150;

/**
 * Project a polar coordinate onto the SVG plane.
 *
 * `0°` is straight UP and angles increase clockwise, which is the reading order of the
 * wheel — hence the `-90` rotation off the mathematical convention (0° = east,
 * counter-clockwise) and NOT a sign error.
 */
export function polar(r: number, angleDeg: number): [number, number] {
  const a = ((angleDeg - 90) * Math.PI) / 180;
  return [CX + r * Math.cos(a), CY + r * Math.sin(a)];
}

/**
 * An annular sector (a ring segment) from `startDeg` to `endDeg`, clockwise, between two
 * radii — the shape of one arc in either ring.
 *
 * The outer edge is swept clockwise (`sweep-flag 1`) and the inner edge back
 * counter-clockwise (`sweep-flag 0`), so the path closes on itself rather than crossing.
 * `large-arc-flag` is set past 180°, without which any sector wider than a semicircle is
 * silently drawn as its complement — the failure mode of a single-pillar wheel.
 */
export function sector(rInner: number, rOuter: number, startDeg: number, endDeg: number): string {
  const large = endDeg - startDeg > 180 ? 1 : 0;
  const [ox0, oy0] = polar(rOuter, startDeg);
  const [ox1, oy1] = polar(rOuter, endDeg);
  const [ix1, iy1] = polar(rInner, endDeg);
  const [ix0, iy0] = polar(rInner, startDeg);
  return [
    `M${ox0.toFixed(2)},${oy0.toFixed(2)}`,
    `A${rOuter},${rOuter} 0 ${large} 1 ${ox1.toFixed(2)},${oy1.toFixed(2)}`,
    `L${ix1.toFixed(2)},${iy1.toFixed(2)}`,
    `A${rInner},${rInner} 0 ${large} 0 ${ix0.toFixed(2)},${iy0.toFixed(2)}`,
    "Z",
  ].join(" ");
}

/** Where a label sits for an arc: the mid-radius point at the given angle. */
export function labelAt(r: number, angleDeg: number): { x: number; y: number } {
  const [x, y] = polar(r, angleDeg);
  return { x, y };
}

/**
 * Split a label onto two lines when it is too long to fit inside one arc.
 *
 * Breaks at the first space at or after the middle so the two lines are close to even,
 * and returns a SINGLE line when there is no such space — an unbreakable word is better
 * overflowing than chopped mid-token.
 */
export function twoLines(label: string): string[] {
  if (label.length <= 9) return [label];
  const mid = label.indexOf(" ", Math.floor(label.length / 2) - 3);
  if (mid > 0) return [label.slice(0, mid), label.slice(mid + 1)];
  return [label];
}

/**
 * The angular slice one arc occupies: `[startDeg, endDeg]` for item `index` of `count`
 * evenly dividing `spanDeg`, starting at `startDeg`.
 *
 * `count` of 0 is treated as 1 so an empty pillar still yields a whole, drawable slice
 * instead of a division by zero (which would put `NaN` into the path `d` and silently
 * blank the arc).
 */
export function slice(
  startDeg: number,
  spanDeg: number,
  index: number,
  count: number,
): [number, number] {
  const each = spanDeg / (count || 1);
  const from = startDeg + index * each;
  return [from, from + each];
}

/**
 * Inset an arc's edges by `padDeg` on each side so neighbouring arcs read as separate
 * wedges rather than one continuous ring.
 *
 * A slice narrower than twice the padding would invert (end before start) and render as
 * a garbage path, so such a slice collapses to its midpoint instead — a hairline, which
 * is the honest picture of an arc too thin to draw.
 */
export function padSlice(startDeg: number, endDeg: number, padDeg: number): [number, number] {
  if (endDeg - startDeg <= padDeg * 2) {
    const mid = (startDeg + endDeg) / 2;
    return [mid, mid];
  }
  return [startDeg + padDeg, endDeg - padDeg];
}

/** The gap left between adjacent arcs, in degrees, on each side. */
export const ARC_PAD_DEG = 0.6;
