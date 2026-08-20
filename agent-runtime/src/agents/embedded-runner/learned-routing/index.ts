/**
 * Learned Model Routing (PRD 13) — the on-prem CONSUMER, assembled.
 *
 * Two entry points, and the embedded runner uses only these:
 *
 *   {@link seedLearnedModel}   before a run — label the work, read the fleet's
 *                              ranking for that label, nudge it with this host's own
 *                              recent history, and hand back the model candidates
 *                              re-ordered best-first.
 *   {@link completeLearnedRun} after a run  — remember the outcome locally and teach
 *                              the fleet, fire-and-forget.
 *
 * The asymmetry between them is the design (see `settings.ts`): the WRITE is on by
 * default because it only adds evidence, the READ is opt-in because on-prem model
 * config is an explicit operator pin and reordering it silently would override a
 * deliberate choice.
 *
 * Every step degrades to "do what you were going to do anyway": no link, no network,
 * no evidence, a thrown error — all end with the caller's configured order intact and
 * the run unaffected.
 */

import {
  rankModelsForAction,
  scopeHasSignal,
  type ActionType,
  type TerminalStatus,
} from "@builderforce/learned-routing";
import { logDebug } from "../../../logger.js";
import { classifyRunAction } from "./action-classifier.js";
import { alignStatsToCandidates, candidateKey, type ModelCandidate } from "./candidate-keys.js";
import { computeLocalBias } from "./local-bias.js";
import { readLocalOutcomes, recordLocalOutcome } from "./local-history.js";
import { buildRunOutcomeReport, reportRunOutcome } from "./outcome-reporter.js";
import { fetchScopeRanking } from "./routing-table-client.js";
import { learnedSeedingOn, resolveScopeTokens } from "./settings.js";

export { classifyRunAction, type ActionClassification } from "./action-classifier.js";
export { alignStatsToCandidates, candidateKey, type ModelCandidate } from "./candidate-keys.js";
export { computeLocalBias, type LocalOutcome } from "./local-bias.js";
export { clearLocalOutcomes, readLocalOutcomes, recordLocalOutcome } from "./local-history.js";
export {
  buildRunOutcomeReport,
  clientRunIdFor,
  reportRunOutcome,
  type RunOutcomeFacts,
} from "./outcome-reporter.js";
export { clearRoutingCache, fetchScopeRanking } from "./routing-table-client.js";
export { learnedRoutingOn, learnedSeedingOn } from "./settings.js";

export interface SeedInput {
  /** The user prompt the run starts from — the only text the action label is derived
   *  from, and it never leaves this process. */
  prompt?: string | null;
  /** This host's model candidates in their CURATED order (primary first, then the
   *  configured fallbacks) — exactly the order that stands if nothing is learned. */
  candidates: readonly ModelCandidate[];
  projectId?: number;
  now?: number;
}

export interface SeedResult {
  /** The shared-taxonomy label for this run. Always present — the write-back needs it
   *  even when the read side is switched off. */
  actionType: ActionType;
  confidence: number;
  /** The candidates, best-first. ALWAYS a permutation of the input, never a new model
   *  and never a shorter list. Equal to the input when nothing was learned. */
  ranked: ModelCandidate[];
  /** True when the fleet's evidence actually changed the order. */
  reordered: boolean;
  /** The scope whose ranking was used, when one had signal. */
  scope?: string;
  /** True when this host's local history contributed a nudge. */
  biasApplied: boolean;
}

/**
 * Label the run and (when opted in) re-order its model candidates from the fleet's
 * learned table, nudged by this host's own recent outcomes.
 *
 * Scope precedence is the SAME ladder the cloud router walks — project → tenant →
 * global — stopping at the finest scope that has real evidence for this action type
 * ({@link scopeHasSignal}), so a project that has learned something is not overruled
 * by the platform average.
 */
export async function seedLearnedModel(input: SeedInput): Promise<SeedResult> {
  const { actionType, confidence } = classifyRunAction(input.prompt);
  const ranked = [...input.candidates];
  const base: SeedResult = { actionType, confidence, ranked, reordered: false, biasApplied: false };

  if (!learnedSeedingOn() || input.candidates.length < 2) {
    return base;
  }

  try {
    const now = input.now ?? Date.now();
    for (const scope of resolveScopeTokens(input.projectId)) {
      const ranking = await fetchScopeRanking(scope, now);
      const stats = alignStatsToCandidates(input.candidates, ranking[actionType]);
      if (!scopeHasSignal(stats)) {
        continue;
      }

      const bias = computeLocalBias(readLocalOutcomes(), { now, actionType });
      const biasApplied = Object.keys(bias).length > 0;
      const keys = input.candidates.map(candidateKey);
      const order = rankModelsForAction(keys, stats, biasApplied ? { bias } : undefined);
      const byKey = new Map(input.candidates.map((c) => [candidateKey(c), c] as const));
      // `rankModelsForAction` returns a permutation by contract; the filter is a belt
      // on that brace, so a future change there can never silently drop a candidate
      // this host is able to run.
      const reorderedList = order.map((k) => byKey.get(k)).filter((c): c is ModelCandidate => !!c);
      if (reorderedList.length !== input.candidates.length) {
        return base;
      }

      const changed = reorderedList.some((c, i) => candidateKey(c) !== keys[i]);
      logDebug(
        `[learned-routing] action=${actionType} scope=${scope} seed=${candidateKey(reorderedList[0])} reordered=${changed} bias=${biasApplied}`,
      );
      return {
        actionType,
        confidence,
        ranked: reorderedList,
        reordered: changed,
        scope,
        biasApplied,
      };
    }
  } catch (err) {
    // Learned routing is an optimisation. Anything that goes wrong here means the run
    // proceeds on the operator's configured order — which is what it would have done
    // if the feature had never been switched on.
    logDebug(`[learned-routing] seeding failed, keeping configured order: ${String(err)}`);
  }
  return base;
}

export interface CompleteRunInput {
  runId: string;
  /** The model the run LOCKED ONTO, as `provider/model` — the same key space the
   *  ranker and the local history use. */
  model: string;
  actionType: ActionType;
  terminalStatus: TerminalStatus;
  rateLimited?: boolean;
  degraded?: boolean;
  steps?: number;
  projectId?: number;
  now?: number;
}

/**
 * Close the loop on one run: remember it locally (so the next run's bias knows) and
 * report it to the fleet (so every other host's ranking knows). Never throws, never
 * blocks — the returned promise may be voided.
 */
export async function completeLearnedRun(input: CompleteRunInput): Promise<void> {
  const model = input.model?.trim();
  if (!model) {
    return;
  }
  recordLocalOutcome({
    model,
    actionType: input.actionType,
    succeeded: input.terminalStatus === "completed",
    ...(input.rateLimited != null ? { rateLimited: input.rateLimited } : {}),
    at: input.now ?? Date.now(),
  });
  await reportRunOutcome(
    buildRunOutcomeReport({
      runId: input.runId,
      model,
      actionType: input.actionType,
      terminalStatus: input.terminalStatus,
      ...(input.rateLimited != null ? { rateLimited: input.rateLimited } : {}),
      ...(input.degraded != null ? { degraded: input.degraded } : {}),
      ...(input.steps != null ? { steps: input.steps } : {}),
      ...(input.projectId != null ? { projectId: input.projectId } : {}),
    }),
  );
}
