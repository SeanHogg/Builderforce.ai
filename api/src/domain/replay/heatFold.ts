/**
 * Pure folds over `replay_heat_daily` cells (PRD 33 §3.2, §8 S4): per-element counts
 * with an interaction-weighted median row, and scroll reach from depth deciles.
 *
 * The service reads grouped rows; everything here is arithmetic over them, so the
 * numbers the heatmap, the element table and the insight rules show are one fold.
 */

import type { HeatElementStat } from './heatInsightRules';

/** One grouped heat row: an element's cells of one kind on one grid row. */
export interface ElementCellRow {
  selector: string;
  label: string | null;
  kind: string;
  gy: number;
  n: number;
  /** The latest day the element was interacted with (any kind). */
  lastSeen: Date;
}

export interface ElementStat extends HeatElementStat {
  lastSeen: Date;
}

/** The weighted median of `value` by `weight`; null when there is no weight. */
export function weightedMedian(points: ReadonlyArray<{ value: number; weight: number }>): number | null {
  const sorted = points.filter((p) => p.weight > 0).sort((a, b) => a.value - b.value);
  const total = sorted.reduce((sum, p) => sum + p.weight, 0);
  if (total <= 0) return null;
  let seen = 0;
  for (const point of sorted) {
    seen += point.weight;
    if (seen * 2 >= total) return point.value;
  }
  return sorted[sorted.length - 1]!.value;
}

/** Fold grouped cells into one stat per selector (click/rage/dead counts, median row, last seen). */
export function foldElementCells(rows: readonly ElementCellRow[]): ElementStat[] {
  const bySelector = new Map<string, { stat: ElementStat; rows: Array<{ value: number; weight: number }> }>();
  for (const row of rows) {
    if (!row.selector) continue;
    let entry = bySelector.get(row.selector);
    if (!entry) {
      entry = {
        stat: { selector: row.selector, label: null, clicks: 0, rage: 0, dead: 0, medianGy: null, lastSeen: row.lastSeen },
        rows: [],
      };
      bySelector.set(row.selector, entry);
    }
    const { stat } = entry;
    if (!stat.label && row.label) stat.label = row.label;
    if (row.lastSeen.getTime() > stat.lastSeen.getTime()) stat.lastSeen = row.lastSeen;
    if (row.kind === 'click') stat.clicks += row.n;
    else if (row.kind === 'rage') stat.rage += row.n;
    else if (row.kind === 'dead') stat.dead += row.n;
    else continue;
    entry.rows.push({ value: row.gy, weight: row.n });
  }
  return [...bySelector.values()].map(({ stat, rows: points }) => ({ ...stat, medianGy: weightedMedian(points) }));
}

/**
 * Scroll reach from the deepest-decile counts (one per page view): `reach[i]` is the
 * share of page views whose deepest decile is ≥ i. All zeros when nothing reported.
 */
export function scrollReach(deciles: ReadonlyArray<{ decile: number; n: number }>): { sessions: number; reach: number[] } {
  const counts = new Array<number>(10).fill(0);
  for (const { decile, n } of deciles) {
    if (!Number.isFinite(decile) || n <= 0) continue;
    const index = Math.max(0, Math.min(9, Math.trunc(decile)));
    counts[index] = (counts[index] ?? 0) + n;
  }
  const sessions = counts.reduce((a, b) => a + b, 0);
  const reach = new Array<number>(10).fill(0);
  if (sessions === 0) return { sessions, reach };
  let atOrDeeper = 0;
  for (let i = 9; i >= 0; i--) {
    atOrDeeper += counts[i] ?? 0;
    reach[i] = atOrDeeper / sessions;
  }
  return { sessions, reach };
}
