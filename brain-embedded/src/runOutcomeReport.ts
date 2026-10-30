/**
 * What a settled work run reports to learned routing — so a run in the editor teaches
 * the router the way a cloud run does: a change graded on whether it shipped, and a run
 * asked for a change that delivered none graded as the failure it was.
 *
 * Before this, only cloud runs were ever scored: an IDE run changed code, shipped it or
 * failed, and the router never heard. Now a run that changed code reports how its CODER
 * did — the model that made the edits (after an analysis→code hand-off, the coding model;
 * under a pin, the pinned one) — under the `code` role, which is exactly the evidence the
 * gateway reads when it picks the coder for the next run.
 *
 * Field names are the `POST /llm/v1/run-outcome` wire contract (`RunOutcomeRequest` in
 * `@builderforce/learned-routing`); the host owns the transport. Pure.
 */

import { isRateLimitFailure, isTenantBudgetFailure } from '@builderforce/learned-routing';
import type { BrainTraceEvent } from './brainTriage';
import { attemptedDelegation } from './delegationRequest';
import { modelScorecard } from './modelScorecard';

export interface BrainRunOutcome {
  /** Idempotency key — one outcome per run. */
  clientRunId: string;
  /** The model that made this run's code changes. */
  model: string;
  role: 'code';
  source: 'ide';
  terminalStatus: 'completed' | 'failed';
  /** The change landed on the base branch (the run's own push). */
  merged: boolean;
  /** Completed model turns — the efficiency half of the score. */
  steps: number;
  /**
   * What the run cost in millicents. Present ONLY as 0, and only when every completed turn was served by a
   * model on this machine (the hybrid local tier): that run was genuinely free and stays "priced at 0". An
   * unknown cost is ABSENT - never 0 - so a gateway or BYO run is not mistaken for a free one.
   */
  costMc?: 0;
  projectId?: number;
  /** The run failed because the TENANT ran out of quota/budget (the platform's one reading of that failure,
   *  `isTenantBudgetFailure`): stored, never taught to routing - it says nothing about the model. Present only when true. */
  quotaExhausted?: true;
  /** The run died on a provider rate limit / capacity ceiling (`isRateLimitFailure`, which already excludes a tenant
   *  budget): an AVAILABILITY fact that demotes the model without calling it a bad coder. Present only when true. */
  rateLimited?: true;
}

/** A turn that reported its own cost as exactly 0 (served on this device - `servedOnDevice`). */
const reportedFree = (e: BrainTraceEvent): boolean => (e.args as { costMc?: unknown } | null | undefined)?.costMc === 0;

/** A run's idempotency key: one chat runs one run at a time, so chat + start is unique. */
export function runOutcomeId(chatId: number, startedAtMs: number): string {
  return `ide:${chatId}:${startedAtMs}`;
}

/**
 * Completed model turns after which a run that was asked for a change and delivered none
 * is evidence against the model that served it. Below it, a run that ended empty-handed
 * is more likely a misread request or a quick Stop than a model that cannot do the work.
 */
export const NO_DELIVERABLE_MIN_STEPS = 20;

/**
 * The outcome to report for a settled run, or null when there is nothing to learn.
 *
 * A run that CHANGED code grades its coder, as before — except on a user Stop (an
 * interrupted change grades no one).
 *
 * A run that was asked for a change and, after {@link NO_DELIVERABLE_MIN_STEPS} turns,
 * changed nothing and delegated nothing is graded `failed` against the model that served
 * most of its turns — stopped or not. The caller decides whether the run is one to grade
 * this way at all (`askedForChange`): a sub-agent's brief, or an owner woken by its
 * children's reports, is not the person's change request. Learned routing scores DELIVERED work, and before this the
 * empty-handed runs were never reported at all: a model that spent a night reading and
 * re-planning (VS Code chat #6, ~1,000 turns on one Flash model) kept only the evidence of
 * its successes, and kept leading the next coding call on it.
 */
export function codeRunOutcome(args: {
  runId: string;
  codeModel: string | null;
  codeChanged: boolean;
  aborted: boolean;
  failed: boolean;
  shipped: boolean;
  /** The run's failure message (`RunCell.error`), when it failed - read for the tenant-budget fact, nothing else. */
  error?: string;
  /** THIS run's trace — the completed turns are counted from it. */
  trace: readonly BrainTraceEvent[];
  projectId?: number | null;
  /** The run's request asked for a change (`asksForChange`). */
  askedForChange?: boolean;
}): BrainRunOutcome | null {
  if (!args.runId) return null;
  const turns = args.trace.filter((e) => e.label === 'llm.complete' && !e.isError);
  const steps = turns.length;
  // Free only when EVERY turn reported 0 (served on this machine); one turn with no cost leaves the run's unknown.
  const allLocal = steps > 0 && turns.every(reportedFree);
  const base = { clientRunId: args.runId, role: 'code' as const, source: 'ide' as const, steps, ...(allLocal ? { costMc: 0 as const } : {}), ...(args.projectId != null ? { projectId: args.projectId } : {}) };
  // Classified ONCE, here, by the shared taxonomy (never a local copy): the tenant's own budget first, else a
  // provider throttle - mutually exclusive by the rule itself. A run that did not fail carries neither.
  const why = args.failed ? failureFlags(args.error) : {};
  if (args.codeChanged) {
    if (args.aborted || !args.codeModel) return null;
    return { ...base, ...why, model: args.codeModel, terminalStatus: args.failed ? 'failed' : 'completed', merged: args.shipped };
  }
  const emptyHanded = args.askedForChange && steps >= NO_DELIVERABLE_MIN_STEPS && !attemptedDelegation(args.trace);
  const model = emptyHanded ? busiestModel(args.trace) : null;
  if (!model) return null;
  return { ...base, ...why, model, terminalStatus: 'failed', merged: false };
}

/** Why a failed run failed, in the wire's two availability-vs-allowance flags. */
function failureFlags(error: string | undefined): Pick<BrainRunOutcome, 'quotaExhausted' | 'rateLimited'> {
  if (isTenantBudgetFailure(error)) return { quotaExhausted: true };
  if (isRateLimitFailure(error)) return { rateLimited: true };
  return {};
}

/** The model that served the most completed turns — not merely the last one, which may be
 *  the planner that wrote the closing summary. */
function busiestModel(trace: readonly BrainTraceEvent[]): string | null {
  let best: { model: string; turns: number } | null = null;
  for (const s of modelScorecard([...trace])) if (!best || s.turns > best.turns) best = s;
  return best && best.turns > 0 ? best.model : null;
}
