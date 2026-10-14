/**
 * The proof scoreboard's derivations (PRD 33 §5.3), pure.
 *
 * The API says `collecting | met | missed`; a founder watching a two-week window
 * also wants to know whether it is heading the right way. `onTrack` / `atRisk`
 * project the counts so far over the whole window — but only once a tenth of it
 * has passed, because a projection from the first afternoon is noise.
 */

import {
  filterToQuery,
  nonConvertingFilter,
  thresholdMet,
  type ProofEvaluationDto,
  type ProofMeasure,
} from '@builderforce/interaction-contract';

export const SCOREBOARD_STATUSES = ['collecting', 'onTrack', 'atRisk', 'met', 'missed'] as const;
export type ScoreboardStatus = (typeof SCOREBOARD_STATUSES)[number];

const DAY_MS = 86_400_000;
/** Below this share of the window elapsed, a projection is not shown. */
const MIN_ELAPSED_FOR_PROJECTION = 0.1;

/** A status pill's colour token, never a literal. */
export const STATUS_TONE: Readonly<Record<ScoreboardStatus, string>> = {
  collecting: 'var(--text-secondary)',
  onTrack: 'var(--accent)',
  atRisk: 'var(--warning)',
  met: 'var(--success)',
  missed: 'var(--error)',
};

export function scoreboardStatus(
  evaluation: Pick<ProofEvaluationDto, 'status' | 'sampleN' | 'sampleMin' | 'value' | 'threshold' | 'windowStartedAt' | 'windowEndsAt'>,
  verdict: 'met' | 'missed' | 'abandoned' | null,
  now: Date,
): ScoreboardStatus {
  if (verdict === 'met' || verdict === 'missed') return verdict;
  if (evaluation.status !== 'collecting') return evaluation.status;
  if (!evaluation.windowStartedAt || !evaluation.windowEndsAt) return 'collecting';
  const start = new Date(evaluation.windowStartedAt).getTime();
  const end = new Date(evaluation.windowEndsAt).getTime();
  const elapsed = Math.min(1, Math.max(0, (now.getTime() - start) / Math.max(1, end - start)));
  if (elapsed < MIN_ELAPSED_FOR_PROJECTION) return 'collecting';
  const sampleOnPace = evaluation.sampleN / elapsed >= evaluation.sampleMin;
  // A count grows with the window; a rate is already its own projection.
  const projected = evaluation.threshold.unit === 'count' ? evaluation.value / elapsed : evaluation.value;
  return sampleOnPace && thresholdMet(projected, evaluation.threshold) ? 'onTrack' : 'atRisk';
}

/** Whole days until the window closes; null before it opens. */
export function daysLeft(windowEndsAt: string | null, now: Date): number | null {
  if (!windowEndsAt) return null;
  return Math.max(0, Math.ceil((new Date(windowEndsAt).getTime() - now.getTime()) / DAY_MS));
}

/** 0–100, for a progress bar. */
export function percentOf(n: number, of: number): number {
  if (of <= 0) return n > 0 ? 100 : 0;
  return Math.max(0, Math.min(100, Math.round((n / of) * 100)));
}

/** "Watch the visitors who didn't": the Insights issues panel over the non-converting sample. */
export function nonConvertingHref(siteId: string, measure: ProofMeasure): string {
  const params = filterToQuery(nonConvertingFilter(measure));
  params.set('site', siteId);
  params.set('panel', 'issues');
  return `/apps/insights?${params.toString()}`;
}

/** "Read again with what we learned": the Realize page, re-reading this idea with this proof's grade. */
export function readAgainHref(input: { realizationId: string; idea: string; sessionId: string | null }): string {
  const params = new URLSearchParams({ prior: input.realizationId, idea: input.idea.slice(0, 2_000) });
  if (input.sessionId) params.set('session', input.sessionId);
  return `/realize?${params.toString()}`;
}
