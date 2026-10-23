/**
 * THE frontier-parity admission rule — ONE bar, ONE comparison, used by every gate
 * that lets a cheaper model serve work a frontier model would otherwise do.
 *
 * Two gates read it today:
 *   • the Evermind coding gate (`evermindCodingGate.ts`) — a project head may serve a
 *     coding turn only at ≥ the bar of the frontier baseline on the same coding eval;
 *   • the E2 specialist admissions (`specialists/evalSweep.ts`) — a small model may
 *     serve ONE narrow job only at ≥ the bar of the frontier model on that job's
 *     held-out eval set.
 *
 * Both were the same three steps (read two eval summaries, refuse to compare two
 * different evals, compare the ratio to the bar), so the steps live here once. The
 * ratio arithmetic, the tolerance at the bar and "the same eval" are the memory
 * package's eval baseline rules — the ones `evaluateGate`'s `minBaselineRatio`
 * applies — so an offline launch gate and these routing gates agree.
 *
 * Pure (no I/O).
 */

import { baselineRatio, meetsBaselineRatio, sameEvalProblem } from '@seanhogg/builderforce-memory/eval';

/** The bar: a candidate must reach this fraction of the frontier's score on the same
 *  eval. Operator decision 2026-09-12 ("quality has to be 90%"). The ONE definition —
 *  never restate 0.9. */
export const FRONTIER_PARITY_BAR = 0.9;

/** One eval report reduced to what a parity comparison needs. */
export interface EvalSummary {
  /** The eval dataset the report was produced from. */
  dataset: string;
  /** Mean score over the cases (0..1). */
  meanScore: number;
  /** How many cases were scored. */
  cases: number;
}

/** The comparison's verdict. `problem` names why no ratio could be taken. */
export interface ParityVerdict {
  admitted: boolean;
  /** candidate ÷ frontier (null when the two are not comparable). */
  ratio: number | null;
  bar: number;
  problem: string | null;
}

/** candidate ÷ frontier, or null when the frontier score cannot be divided by. */
export function parityRatio(score: number, frontierScore: number): number | null {
  return baselineRatio(score, frontierScore);
}

/** True when `ratio` reaches `bar` (within the memory package's tolerance). */
export function meetsParity(ratio: number | null, bar: number = FRONTIER_PARITY_BAR): boolean {
  return meetsBaselineRatio(ratio, bar);
}

/** Why two summaries cannot be compared, or null when they can: a different eval, or
 *  a frontier score of zero (nothing to divide by). */
function comparabilityProblem(candidate: EvalSummary, frontier: EvalSummary, frontierName: string): string | null {
  const notSameEval = sameEvalProblem(candidate, frontier);
  if (notSameEval) return notSameEval;
  if (!(frontier.meanScore > 0)) return `${frontierName} meanScore must be above 0 to compare against`;
  return null;
}

/**
 * Compare a candidate's eval summary with the frontier's on the SAME eval. "The same
 * eval" is enforced, not assumed: both must name the same dataset and have scored
 * the same number of cases, and the frontier must have scored above zero.
 */
export function frontierParity(candidate: EvalSummary, frontier: EvalSummary, bar: number = FRONTIER_PARITY_BAR): ParityVerdict {
  const problem = comparabilityProblem(candidate, frontier, 'frontier');
  if (problem) return { admitted: false, ratio: null, bar, problem };
  const ratio = parityRatio(candidate.meanScore, frontier.meanScore);
  return { admitted: meetsParity(ratio, bar), ratio, bar, problem: null };
}

const MAX_DATASET_CHARS = 200;

/**
 * Read an untrusted EvalHarness-style report (`{ dataset, meanScore, cases }`, where
 * `cases` is the case array or its count) into an {@link EvalSummary}. `which` names
 * the report in the error ("evermind", "baseline", …).
 */
export function readEvalSummary(raw: unknown, which: string): { ok: true; summary: EvalSummary } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: `${which} report is required` };
  const r = raw as Record<string, unknown>;
  const dataset = typeof r.dataset === 'string' ? r.dataset.trim() : '';
  const meanScore = typeof r.meanScore === 'number' ? r.meanScore : Number.NaN;
  const cases = Array.isArray(r.cases) ? r.cases.length : typeof r.cases === 'number' ? r.cases : Number.NaN;
  if (!dataset || dataset.length > MAX_DATASET_CHARS) return { ok: false, error: `${which} report needs a dataset name` };
  if (!Number.isFinite(meanScore) || meanScore < 0 || meanScore > 1) return { ok: false, error: `${which} meanScore must be in [0, 1]` };
  if (!Number.isInteger(cases) || cases <= 0) return { ok: false, error: `${which} report needs at least one case` };
  return { ok: true, summary: { dataset, meanScore, cases } };
}

/**
 * Read a candidate report and a frontier report as ONE comparable pair: both valid,
 * the same eval, and a frontier score above zero. The error names the first problem.
 */
export function readComparablePair(
  candidate: unknown,
  frontier: unknown,
  names: { candidate: string; frontier: string },
): { ok: true; candidate: EvalSummary; frontier: EvalSummary } | { ok: false; error: string } {
  const c = readEvalSummary(candidate, names.candidate);
  if (!c.ok) return c;
  const f = readEvalSummary(frontier, names.frontier);
  if (!f.ok) return f;
  const problem = comparabilityProblem(c.summary, f.summary, names.frontier);
  if (problem) return { ok: false, error: problem };
  return { ok: true, candidate: c.summary, frontier: f.summary };
}
