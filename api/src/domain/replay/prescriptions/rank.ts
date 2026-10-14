/**
 * The order fixes are shown in (PRD 33 §5.1.2 "Ranked by impact ÷ effort") — pure.
 *
 * Every finding with a measured impact (medium or high confidence) comes before any
 * low-confidence one: a guess must never outrank a measurement, however big the
 * guess. Inside each group the score is impact ÷ effort, where impact is the point
 * estimate, else the top of the range, else the visits touched (a low-confidence
 * finding still ranks by how many people it reaches). Ties break on the stable key,
 * so the same data always produces the same list.
 */

import type { ReplayImpactDto } from '@builderforce/interaction-contract';

export interface Rankable {
  key: string;
  impact: ReplayImpactDto;
  effort: number;
  affected: number;
}

/** The value impact ÷ effort divides. */
export function impactValue(item: Rankable): number {
  const { estimate, high } = item.impact;
  if (estimate !== null) return estimate;
  if (high !== null && high > 0) return high;
  return item.affected;
}

export function rankScore(item: Rankable): number {
  return impactValue(item) / Math.max(1, item.effort);
}

const lowFirst = (item: Rankable): number => (item.impact.confidence === 'low' ? 1 : 0);

/** A new array, do-first first. */
export function rankPrescriptions<T extends Rankable>(items: readonly T[]): T[] {
  return [...items].sort((a, b) =>
    lowFirst(a) - lowFirst(b)
    || rankScore(b) - rankScore(a)
    || a.key.localeCompare(b.key));
}
