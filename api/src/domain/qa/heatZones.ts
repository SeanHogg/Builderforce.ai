/**
 * THE recency-weighted heat ranking.
 *
 * `count × 0.97^ageDays` — a zone hot last week outranks one equally hot
 * last year (~23-day half-life). QaHeatmapService is the only caller today;
 * session-replay Insights will rank the same way, so the rule lives here
 * rather than inside the service.
 */

import { DAY_MS } from '../shared/time';

/** Recency decay applied per day since a zone's last interaction. */
export const HEAT_DECAY_PER_DAY = 0.97;

export function heatScore(count: number, lastSeen: Date, now: Date): number {
  const ageDays = Math.max(0, (now.getTime() - lastSeen.getTime()) / DAY_MS);
  return count * Math.pow(HEAT_DECAY_PER_DAY, ageDays);
}

export function rankHeatZones<T extends { count: number; lastSeen: Date }>(
  rows: T[],
  now: Date,
  limit: number,
): Array<T & { score: number }> {
  const capped = Math.max(0, limit);
  return rows
    .map((row) => ({ ...row, score: heatScore(row.count, row.lastSeen, now) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, capped);
}
