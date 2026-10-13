/**
 * Mark vocabulary and the heatmap grid (PRD 33 §3.4).
 *
 * One set of kind strings for the recorder, the ingest, the Insights views and
 * the QA heat ranking — a click captured as `'click'` is a click in every
 * consumer. The grid is the same: a cell the recorder writes is a cell the
 * heatmap paints.
 */

export const MARK_KINDS = [
  'page',
  'click',
  'event',
  'rage',
  'dead',
  'quickback',
  'excessive_scroll',
  'error',
  'vital',
  'scroll',
] as const;

export type MarkKind = (typeof MARK_KINDS)[number];

/** The mark kinds that count as frustration (the `frustration` filter's values). */
export const FRUSTRATION_MARK_KINDS = ['rage', 'dead', 'quickback', 'excessive_scroll', 'error'] as const;

export type FrustrationMarkKind = (typeof FRUSTRATION_MARK_KINDS)[number];

export function isMarkKind(value: unknown): value is MarkKind {
  return typeof value === 'string' && (MARK_KINDS as readonly string[]).includes(value);
}

/**
 * Cells per axis. A click is placed on a GRID × GRID lattice laid over the
 * whole document, so cells line up across viewports of different sizes.
 */
export const GRID = 50;

export interface GridCell {
  gx: number;
  gy: number;
}

function cell(value: number, extent: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(extent) || extent <= 0) return 0;
  const index = Math.floor((value / extent) * GRID);
  return Math.min(GRID - 1, Math.max(0, index));
}

/**
 * The grid cell of a document point. `x, y` are document coordinates
 * (page offsets, not viewport), `docW, docH` the document's scroll size.
 * Always inside `0..GRID-1` on both axes.
 */
export function toGridCell(x: number, y: number, docW: number, docH: number): GridCell {
  return { gx: cell(x, docW), gy: cell(y, docH) };
}
