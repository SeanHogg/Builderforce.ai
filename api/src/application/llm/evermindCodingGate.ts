/**
 * THE Evermind coding-quality gate — ONE bar, ONE predicate.
 *
 * Operator decision (2026-09-12): "Evermind for IDE coding ⇒ quality has to be 90%."
 * Evermind could already be ROUTED for coding turns (`inference_enabled` → the
 * `evermind/<ref>` pin, constrained-decoding tool calls, coherence auto-quarantine),
 * but a project's head today is the randomly-initialised STARTER base plus whatever
 * its runs distilled — routing coding turns to it would serve incoherent code until
 * quarantine tripped: a quality regression dressed as a saving.
 *
 * So a head may serve a CODING turn (IDE/VS Code completions, agent task runs) only
 * when it carries a RECORDED coding-eval score that is ≥ {@link EVERMIND_CODING_QUALITY_BAR}
 * of the frontier baseline's score ON THE SAME EVAL, taken against THIS head version.
 * Every routing surface consults {@link evermindQualifiesForCoding} and falls back to
 * its normal model when it says no — never an error. With no qualifying checkpoint the
 * gate stays closed; nothing is flipped on by this module.
 *
 * Version-exact by design: every merge changes the weights, so a score recorded for
 * v12 says nothing about v13. A merge therefore CLOSES the gate until the eval is re-run
 * against the new head — the same reasoning that re-benchmarks coherence after every
 * merge in the coordinator.
 *
 * Pure (no I/O), so the route, the routers and the console all compute the SAME verdict.
 * The comparison rules themselves — the ratio, the tolerance at the bar, "the same eval"
 * — are the memory package's eval baseline rules, the ones `evaluateGate`'s
 * `minBaselineRatio` applies, so an offline launch gate and this routing gate agree.
 */

import { baselineRatio, meetsBaselineRatio, sameEvalProblem } from '@seanhogg/builderforce-memory/eval';

/** The bar: Evermind must reach this fraction of the frontier baseline's coding-eval
 *  score. Operator decision 2026-09-12. The ONE definition — never restate 0.9. */
export const EVERMIND_CODING_QUALITY_BAR = 0.9;

/** A recorded coding eval of one head version against a frontier baseline. */
export interface EvermindCodingEval {
  /** The head version the eval scored. Only meaningful while it IS the head. */
  version: number;
  /** Evermind's mean score on the coding eval (0..1, EvalHarness `meanScore`). */
  score: number;
  /** The frontier baseline's mean score on the SAME eval (0..1). */
  baselineScore: number;
  /** The frontier model the baseline ran on, when recorded. */
  baselineModel: string | null;
  /** The eval dataset name both reports were produced from. */
  dataset: string;
  /** ISO timestamp the eval was recorded, when known. */
  evaluatedAt: string | null;
}

/** Why the gate is open or closed — the console renders a message per reason. */
export type EvermindCodingGateReason =
  | 'qualified'
  | 'unseeded'
  | 'quarantined'
  | 'no_eval'
  | 'stale_eval'
  | 'below_bar';

/** The gate's verdict for one head — what routing reads and what the console shows. */
export interface EvermindCodingGate {
  qualified: boolean;
  reason: EvermindCodingGateReason;
  /** The bar applied ({@link EVERMIND_CODING_QUALITY_BAR}) — shipped so a UI never restates it. */
  bar: number;
  /** Recorded score ÷ baseline score (null when no usable eval is recorded). */
  ratio: number | null;
  headVersion: number;
  /** The version the recorded eval scored (null when none). */
  evaluatedVersion: number | null;
  baselineModel: string | null;
  dataset: string | null;
}

/**
 * THE predicate: may this head serve a coding turn? Order is the operator's reading
 * order — nothing to serve, then switched off for incoherence, then no evidence, then
 * evidence about a DIFFERENT version, then evidence that falls short.
 */
export function evermindQualifiesForCoding(head: {
  version: number;
  quarantinedAt?: string | null;
  codingEval?: EvermindCodingEval | null;
}): EvermindCodingGate {
  const ev = head.codingEval ?? null;
  const ratio = ev ? baselineRatio(ev.score, ev.baselineScore) : null;
  const verdict = (reason: EvermindCodingGateReason): EvermindCodingGate => ({
    qualified: reason === 'qualified',
    reason,
    bar: EVERMIND_CODING_QUALITY_BAR,
    ratio,
    headVersion: head.version,
    evaluatedVersion: ev?.version ?? null,
    baselineModel: ev?.baselineModel ?? null,
    dataset: ev?.dataset ?? null,
  });
  if (!(head.version > 0)) return verdict('unseeded');
  if (head.quarantinedAt) return verdict('quarantined');
  if (!ev) return verdict('no_eval');
  if (ev.version !== head.version) return verdict('stale_eval');
  if (!meetsBaselineRatio(ratio, EVERMIND_CODING_QUALITY_BAR)) return verdict('below_bar');
  return verdict('qualified');
}

/** True for a direct Evermind route (`evermind/<ref>`). */
export function isEvermindModelId(model: string | undefined | null): model is string {
  return typeof model === 'string' && model.startsWith('evermind/');
}

/**
 * The persisted columns (`project_evermind.coding_eval_*`) → the eval, or null when no
 * complete eval is recorded. A partial row (one column set, another not) is treated as
 * NO eval — the gate must never open on half a record.
 */
export function codingEvalFromRow(row: {
  codingEvalVersion?: number | null;
  codingEvalScore?: number | null;
  codingEvalBaselineScore?: number | null;
  codingEvalBaselineModel?: string | null;
  codingEvalDataset?: string | null;
  codingEvalAt?: Date | null;
}): EvermindCodingEval | null {
  if (row.codingEvalVersion == null || row.codingEvalScore == null || row.codingEvalBaselineScore == null || !row.codingEvalDataset) {
    return null;
  }
  return {
    version: row.codingEvalVersion,
    score: row.codingEvalScore,
    baselineScore: row.codingEvalBaselineScore,
    baselineModel: row.codingEvalBaselineModel ?? null,
    dataset: row.codingEvalDataset,
    evaluatedAt: row.codingEvalAt ? row.codingEvalAt.toISOString() : null,
  };
}

const MAX_MODEL_ID_CHARS = 200;
const MAX_DATASET_CHARS = 200;

function readSummary(raw: unknown, which: string): { ok: true; summary: { dataset: string; meanScore: number; cases: number } } | { ok: false; error: string } {
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
 * Turn the two EvalHarness reports — Evermind's and the frontier baseline's — into the
 * eval to persist. "The same eval" is enforced, not assumed: both reports must name the
 * same dataset and have scored the same number of cases, or the ratio compares nothing.
 */
export function codingEvalFromReports(args: {
  version: number;
  evermind: unknown;
  baseline: unknown;
  baselineModel?: unknown;
  evaluatedAt: Date;
}): { ok: true; eval: EvermindCodingEval } | { ok: false; error: string } {
  if (!Number.isInteger(args.version) || args.version <= 0) return { ok: false, error: 'version must be the positive head version the eval scored' };
  const ev = readSummary(args.evermind, 'evermind');
  if (!ev.ok) return ev;
  const base = readSummary(args.baseline, 'baseline');
  if (!base.ok) return base;
  const notSameEval = sameEvalProblem(ev.summary, base.summary);
  if (notSameEval) return { ok: false, error: notSameEval };
  if (!(base.summary.meanScore > 0)) return { ok: false, error: 'baseline meanScore must be above 0 to compare against' };
  const baselineModel = typeof args.baselineModel === 'string' && args.baselineModel.trim()
    ? args.baselineModel.trim().slice(0, MAX_MODEL_ID_CHARS)
    : null;
  return {
    ok: true,
    eval: {
      version: args.version,
      score: ev.summary.meanScore,
      baselineScore: base.summary.meanScore,
      baselineModel,
      dataset: ev.summary.dataset,
      evaluatedAt: args.evaluatedAt.toISOString(),
    },
  };
}
