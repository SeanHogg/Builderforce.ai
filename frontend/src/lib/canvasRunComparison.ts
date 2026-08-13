/**
 * Ranking N training runs against a baseline.
 *
 * ── THE DEFECT THIS CLOSES ───────────────────────────────────────────────────────
 * Nothing on the board held several runs side by side with their hyperparameters and
 * their metrics. `projectComparison` existed for projects; runs got nothing. So "which
 * configuration won, by how much, and was the difference bigger than the noise" — the
 * question the whole model stage exists to answer — was answered in a spreadsheet
 * somewhere else, which is the same failure the CMO review names for campaign ROI.
 *
 * ── WHY THE DELTA IS SIGNED BY DIRECTION, NOT BY SUBTRACTION ────────────────────
 * `hallucinationRate` is better when LOW. A comparison that ranked every axis
 * descending would crown the most hallucinatory run, and one that displayed a raw
 * subtraction would show a "-0.3" that is an IMPROVEMENT next to a "-0.3" that is a
 * regression, in the same column. `improvement` is therefore always "how much better
 * than the baseline", whichever way the axis points, and the raw `delta` travels beside
 * it for anyone who wants the arithmetic.
 */

import { axisHigherIsBetter } from './canvasTrainingRun';

export interface ComparisonRunInput {
  /** Canvas object id of the `trainingRun`. */
  objectId: string;
  label: string;
  scorecard?: ReadonlyArray<{ axis: string; score: number }> | null;
  hyperparameters?: ReadonlyArray<{ name: string; value: string | number }> | null;
}

export interface ComparisonRow {
  objectId: string;
  run: string;
  score: number | null;
  /** Raw arithmetic difference from the baseline. */
  delta: number | null;
  /** Signed so positive always means BETTER, whichever way the axis points. */
  improvement: number | null;
  baseline: boolean;
  /** Only the settings that DIFFER from the baseline — the actual explanation. */
  hyperparameters: string;
}

export interface RunComparison {
  rows: ComparisonRow[];
  rankBy: string;
  baselineObjectId: string | null;
  verdict: { key: 'wins' | 'ties' | 'regresses' | 'unscored'; values: Record<string, string | number> } | null;
}

function scoreFor(run: ComparisonRunInput, axis: string): number | null {
  const entry = run.scorecard?.find((item) => item.axis === axis);
  return typeof entry?.score === 'number' && Number.isFinite(entry.score) ? entry.score : null;
}

function round(value: number): number {
  return Number(value.toFixed(4));
}

/**
 * Render only the hyperparameters that DIFFER from the baseline.
 *
 * Showing all four on every row is how a comparison table becomes unreadable at five
 * runs; showing only the differences is the whole reason someone opened it — the
 * question is never "what were the settings", it is "what did we change".
 */
function differingParameters(
  run: ComparisonRunInput,
  baseline: ComparisonRunInput | null,
): string {
  const own = run.hyperparameters ?? [];
  if (!baseline || run.objectId === baseline.objectId) {
    return own.map((entry) => `${entry.name}=${entry.value}`).join(' · ');
  }
  const base = new Map((baseline.hyperparameters ?? []).map((entry) => [entry.name, String(entry.value)]));
  const changed = own.filter((entry) => base.get(entry.name) !== String(entry.value));
  return changed.length ? changed.map((entry) => `${entry.name}=${entry.value}`).join(' · ') : '—';
}

/**
 * Rank runs on one axis against a chosen baseline.
 *
 * A run with no score on the ranking axis sorts LAST and keeps its row rather than
 * being dropped: an unevaluated run is a finding — usually the finding that somebody
 * forgot to evaluate it — and omitting it makes a comparison look complete when it is
 * missing the config you actually care about.
 */
export function compareRuns(
  runs: readonly ComparisonRunInput[],
  rankBy: string = 'evalScore',
  baselineObjectId?: string | null,
): RunComparison {
  if (!runs.length) return { rows: [], rankBy, baselineObjectId: baselineObjectId ?? null, verdict: null };

  const baseline = runs.find((run) => run.objectId === baselineObjectId) ?? runs[0];
  const baselineScore = scoreFor(baseline, rankBy);
  const higherIsBetter = axisHigherIsBetter(rankBy);

  const rows: ComparisonRow[] = runs.map((run) => {
    const score = scoreFor(run, rankBy);
    const delta = score != null && baselineScore != null ? round(score - baselineScore) : null;
    return {
      objectId: run.objectId,
      run: run.label,
      score,
      delta,
      improvement: delta == null ? null : round(higherIsBetter ? delta : -delta),
      baseline: run.objectId === baseline.objectId,
      hyperparameters: differingParameters(run, baseline),
    };
  });

  // Unscored rows sink to the bottom; among scored rows the best improvement leads.
  rows.sort((left, right) => {
    if (left.score == null && right.score == null) return 0;
    if (left.score == null) return 1;
    if (right.score == null) return -1;
    return higherIsBetter ? right.score - left.score : left.score - right.score;
  });

  return { rows, rankBy, baselineObjectId: baseline.objectId, verdict: verdictFor(rows, rankBy) };
}

function verdictFor(rows: readonly ComparisonRow[], rankBy: string): RunComparison['verdict'] {
  const scored = rows.filter((row) => row.score != null);
  if (scored.length < 2) return { key: 'unscored', values: { scored: scored.length, total: rows.length } };
  const best = scored[0];
  if (best.baseline) {
    const challenger = scored.find((row) => !row.baseline);
    return {
      key: 'regresses',
      values: { run: challenger?.run ?? '', axis: rankBy, behind: Math.abs(challenger?.improvement ?? 0) },
    };
  }
  if (!best.improvement) return { key: 'ties', values: { run: best.run, axis: rankBy } };
  return { key: 'wins', values: { run: best.run, axis: rankBy, improvement: best.improvement } };
}
