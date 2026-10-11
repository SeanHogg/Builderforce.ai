/**
 * Interaction and mark vocabularies, plus the heatmap grid.
 *
 * One set of kind strings for the recorder, the ingest, the Insights views
 * and the QA heat ranking — a click captured as `'click'` is a click in
 * every consumer. The 50 px grid is the same: a cell the recorder writes
 * is a cell the heatmap can paint.
 */

export const INTERACTION_KINDS = [
  'pageview',
  'click',
  'nav',
  'error',
  'submit',
  'rage',
  'dead',
  'scroll',
  'input',
  'change',
  'resize',
  'visibility',
  'webvital',
] as const;

export type InteractionKind = (typeof INTERACTION_KINDS)[number];

export const MARK_KINDS = [
  'rage',
  'dead',
  'quickback',
  'excessive_scroll',
  'error',
] as const;

export type MarkKind = (typeof MARK_KINDS)[number];

export function isInteractionKind(value: string): value is InteractionKind {
  return (INTERACTION_KINDS as readonly string[]).includes(value);
}

export function isMarkKind(value: string): value is MarkKind {
  return (MARK_KINDS as readonly string[]).includes(value);
}

/** Heatmap / rage-click cell size in CSS pixels. */
export const GRID_PX = 50;

export interface GridCell {
  gx: number;
  gy: number;
}

/** Snap a point to the 50 px heatmap grid. */
export function toGridCell(x: number, y: number): GridCell {
  return { gx: Math.floor(x / GRID_PX), gy: Math.floor(y / GRID_PX) };
}
