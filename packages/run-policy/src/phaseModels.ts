/**
 * The run's PHASE MODELS — the optional model per phase a host seeds a run policy with, and
 * the reads {@link nextTurn} and the reducer make of them: which model reviews the change,
 * whether a verify-phase turn is a review, and the plan / code model a run with no model of
 * its own asks for. Split out of `policy.ts` so the reducer does not grow. Pure.
 */

import type { RunPhase, RunPolicyState } from './policy.js';

/**
 * The optional model per phase. `review` is the model that judges the run's change in its
 * `verify` phase; a `verify` entry is that model's legacy name and applies only when no
 * `review` entry is set (read through {@link reviewPhaseModel}).
 */
export type PhaseModels = Partial<Record<RunPhase | 'review', string | null>>;

/**
 * The model that reviews the run's change: `phaseModels.review`, else the legacy
 * `phaseModels.verify`, else the legacy `reviewModel` option. ONE rule for every host that
 * seeds or resumes a run policy.
 */
export function reviewPhaseModel(
  phaseModels: PhaseModels | undefined,
  legacyReviewModel?: string | null,
): string | undefined {
  for (const candidate of [phaseModels?.review, phaseModels?.verify, legacyReviewModel]) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return undefined;
}

/** A configured pin for one phase. Verify reads the review model ({@link reviewPhaseModel}). */
export function configuredPhaseModel(
  options: RunPolicyState['options'],
  phase: RunPhase,
): string | undefined {
  if (phase === 'verify') return reviewPhaseModel(options.phaseModels, options.reviewModel);
  const fromMap = options.phaseModels?.[phase];
  return typeof fromMap === 'string' && fromMap.trim() ? fromMap.trim() : undefined;
}

/**
 * Whether the run's model turns are reviews: it is in its verify phase and was not
 * delegated mechanical checking. A `verify` child (build, compile, run the tests) keeps the
 * cheap role and is never handed the review model.
 */
export function reviewing(state: RunPolicyState): boolean {
  return state.phase === 'verify' && state.options.fixedRole !== 'verify';
}

/**
 * The plan / code model a run with no model of its own asks for: its phase's entry in
 * `phaseModels`, unless the run has a fixed role (a delegated `explore` slice is not
 * the phase's work) or the model already broke in this run.
 */
export function phaseDefaultModel(state: RunPolicyState): string | undefined {
  if (state.phase === 'verify' || state.options.fixedRole) return undefined;
  const model = configuredPhaseModel(state.options, state.phase);
  return model && !state.broken.includes(model) ? model : undefined;
}
