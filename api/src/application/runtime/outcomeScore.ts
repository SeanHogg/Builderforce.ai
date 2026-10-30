/**
 * The OUTCOME score of a run (PRD 13 D3) and the two run-quality verdicts computed from what a
 * finished run left behind: the composite 0..1 routing score, the Evermind learn weight and the
 * productive-run test. Pure. Split out of `scoreRunOutcome.ts`, which gathers the inputs and persists.
 */

import { clamp01 } from '../../domain/shared/numbers';
import type { TerminalStatus } from '@builderforce/learned-routing';

// ── D3 score weights + efficiency normalization (named so they're tunable without a
//    schema change — see the Gap Register note on score calibration). ────────────
export const SCORE_WEIGHTS = {
  merge: 0.5,
  ci: 0.2,
  completion: 0.15,
  efficiency: 0.15,
} as const;
/** Steps at/above this count score 0 on the step half of efficiency (a run that
 *  loops forever is inefficient); 0 steps = max efficient. */
export const EFFICIENCY_STEP_NORM = 20;
/** Per-run cost (millicents) at/above which the cost half of efficiency hits 0
 *  ($2.00). Cheaper runs score proportionally higher. */
export const EFFICIENCY_COST_NORM_MC = 200_000;

export interface OutcomeScoreInputs {
  terminalStatus: TerminalStatus;
  merged: boolean;
  ciGreen: boolean;
  degraded: boolean;
  steps: number;
  /** Millicents the run cost; absent/null = the run reported none (unknown, not free). */
  costMc?: number | null;
  /** A human approval for this run resolved to `approve` — pins completion to full. */
  approved: boolean;
}

export interface OutcomeScore {
  score: number;
  terms: { merge: number; ci: number; completion: number; efficiency: number };
}


/**
 * Composite 0..1 outcome score (D3). A failed/cancelled run scores exactly 0 (no
 * merge, no CI, no credit for an unfinished run). A completed run earns: merge (0.5)
 * + green CI (0.2) + finished-without-degradation (0.15, pinned full by a human
 * approve) + efficiency (0.15, inverse of steps & cost). PURE — unit-tested directly.
 */
export function computeOutcomeScore(inputs: OutcomeScoreInputs): OutcomeScore {
  if (inputs.terminalStatus !== 'completed') {
    return { score: 0, terms: { merge: 0, ci: 0, completion: 0, efficiency: 0 } };
  }
  const merge = inputs.merged ? 1 : 0;
  const ci = inputs.ciGreen ? 1 : 0;
  // Completed without degradation = full; degraded run loses the term; a human
  // approval overrides to full regardless (a person signed off on the result).
  const completion = inputs.approved ? 1 : inputs.degraded ? 0 : 1;
  const stepScore = clamp01(1 - inputs.steps / EFFICIENCY_STEP_NORM);
  // A run that reported no cost is unknown, not free: it must not earn the cost half of efficiency.
  // Efficiency is then the step half alone (renormalised), never a free-run bonus.
  const efficiency = inputs.costMc == null
    ? stepScore
    : (stepScore + clamp01(1 - inputs.costMc / EFFICIENCY_COST_NORM_MC)) / 2;

  const score = clamp01(
    SCORE_WEIGHTS.merge * merge +
      SCORE_WEIGHTS.ci * ci +
      SCORE_WEIGHTS.completion * completion +
      SCORE_WEIGHTS.efficiency * efficiency,
  );
  return { score, terms: { merge, ci, completion, efficiency } };
}

/**
 * Coarse learn-contribution weight (0..1) from what's known at run FINALIZE — before
 * CI/routing outcome is scored. This is the FedAvg sample weight for the run's Evermind
 * contribution: a clean auto-merge teaches the model most, a no-op/failed run barely
 * teaches. It is DISTINCT from {@link computeOutcomeScore} (which scores a CI-known run
 * for model routing); it exists because the old learn path weighted by raw TEXT LENGTH,
 * so a long, failed run taught exactly as hard as a short, merged one. Floored at 0.2 so
 * the coordinator's `weight > 0` gate still accepts (and lightly learns from) a
 * low-quality run instead of silently snapping it back to the default weight of 1.
 */
export function finalizeLearnWeight(s: {
  merged: boolean;
  prOpened: boolean;
  autoMergeFailed: boolean;
  producedChanges: boolean;
}): number {
  if (s.merged) return 1;             // shipped clean — the strongest signal
  if (s.autoMergeFailed) return 0.3;  // opened a PR but the auto-merge broke
  if (s.prOpened) return 0.7;         // real change, awaiting approval/CI
  if (s.producedChanges) return 0.4;  // wrote files but no PR opened
  return 0.2;                         // text-only / no-op
}

/** What a finished run left behind — the inputs both the learn weight and the
 *  productivity verdict are computed from, so the two can never disagree. */
export interface RunProduct {
  merged: boolean;
  prOpened: boolean;
  /** The run committed at least one file. */
  producedChanges: boolean;
  /** The run moved the ticket to a different lane / status. */
  movedTicket?: boolean;
}

/**
 * Did this run leave ANYTHING behind? PURE.
 *
 * ── WHY THE PLATFORM NEEDED THIS AND DID NOT HAVE IT ─────────────────────────────
 * {@link finalizeLearnWeight} right above already answers "how good was this run?" —
 * merged > opened > wrote-files > no-op — and has since it replaced text-length as the
 * teaching weight. The platform therefore ALWAYS knew which runs accomplished nothing.
 * It spent that verdict on teaching the model and threw it away for the one decision
 * that would have stopped the burn: whether to dispatch the ticket AGAIN.
 *
 * The autonomy circuit breaker (`MAX_CONSECUTIVE_AUTORUN_FAILURES`) and its cooldown
 * were keyed on `status === 'failed'` alone. A run that COMPLETES and ships nothing
 * reset the streak to zero and owed no backoff, so it was re-dispatched on the very
 * next five-minute tick, forever. Measured on project 11, 2026-07-29: **5,931 agent
 * runs completed and 10 failed in one day; 3 tickets finished and 2 PRs merged.** One
 * agent — Bob Developer — accounted for **5,796 runs and 0 finished tickets**. The
 * breaker never armed once, because nothing ever failed.
 *
 * That burn is also why 371 tickets on the same board had NEVER run: the tenant's
 * 25-dispatches-per-tick ceiling was ~80% consumed, all day, re-running tickets that
 * had already run and produced nothing.
 *
 * This is the same lesson the manager's stall register learned and wrote down — "the
 * ceiling exists to catch a remedy that RUNS AND DOES NOT WORK" — applied to the layer
 * that actually spends the money. It is deliberately GENEROUS: any artifact at all
 * counts, so a run that writes one file, opens a PR, or advances the ticket is
 * productive. Only a run that ends with nothing to show for itself is not.
 */
export function runProducedOutput(s: RunProduct): boolean {
  return s.merged || s.prOpened || s.producedChanges || s.movedTicket === true;
}
