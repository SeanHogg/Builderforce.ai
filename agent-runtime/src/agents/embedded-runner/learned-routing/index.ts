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

import type { ModelRole } from "@builderforce/agent-tools";
import { scopeHasSignal, type ActionType, type TerminalStatus } from "@builderforce/learned-routing";
import type { CatalogView } from "@builderforce/model-catalog";
import {
  estimateTokensFromChars,
  profileWorkload,
  type ArcStage,
  type WorkloadProfile,
} from "@builderforce/workload";
import { logDebug } from "../../../logger.js";
import { rankCandidates, type RankCandidatesOptions } from "../../candidate-ranking.js";
import { alignStatsToCandidates, candidateKey, type ModelCandidate } from "./candidate-keys.js";
import { computeLocalBias } from "./local-bias.js";
import { readLocalOutcomes, recordLocalOutcome } from "./local-history.js";
import { buildRunOutcomeReport, reportRunOutcome } from "./outcome-reporter.js";
import { fetchScopeRanking } from "./routing-table-client.js";
import { learnedSeedingOn, resolveScopeTokens } from "./settings.js";

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
  /** What the call is FOR, when the caller declared it, plus this host's catalog. With
   *  it the shared router orders the candidates by role (and arc stage) even when no
   *  learned evidence exists; without it only learned evidence can reorder. */
  routing?: { role: ModelRole; arcStage?: ArcStage; view: CatalogView };
}

export interface SeedResult {
  /** The shared-taxonomy label for this run. Always present — the write-back needs it
   *  even when the read side is switched off. */
  actionType: ActionType;
  confidence: number;
  /** The shared workload reading of this call (role · arc stage · action · tokens) —
   *  the same profile every other host routes on. */
  workload: WorkloadProfile;
  /** The candidates, best-first. ALWAYS a permutation of the input, never a new model
   *  and never a shorter list. Equal to the input when nothing was learned. */
  ranked: ModelCandidate[];
  /** True when the role or the fleet's evidence actually changed the order. */
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
  const prompt = input.prompt ?? "";
  const workload = profileWorkload({
    role: input.routing?.role,
    arcStage: input.routing?.arcStage,
    instruction: prompt,
    inputTokens: estimateTokensFromChars(prompt.length),
  });
  const { actionType, actionConfidence: confidence } = workload;
  const keys = input.candidates.map(candidateKey);
  const changedFrom = (list: readonly ModelCandidate[]) =>
    list.some((c, i) => candidateKey(c) !== keys[i]);
  const order = (learned: Pick<RankCandidatesOptions, "stats" | "bias">): ModelCandidate[] =>
    rankCandidates(input.candidates, {
      ...(input.routing ? { routing: input.routing } : {}),
      ...learned,
    });

  // The role's own order — what stands when nothing has been learned (or seeding is off).
  const roleOrdered = order({});
  const base: SeedResult = {
    actionType,
    confidence,
    workload,
    ranked: roleOrdered,
    reordered: changedFrom(roleOrdered),
    biasApplied: false,
  };

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
      const ranked = order({ stats, ...(biasApplied ? { bias } : {}) });
      const changed = changedFrom(ranked);
      logDebug(
        `[learned-routing] action=${actionType} role=${input.routing?.role ?? "none"} scope=${scope} seed=${candidateKey(ranked[0])} reordered=${changed} bias=${biasApplied}`,
      );
      return { actionType, confidence, workload, ranked, reordered: changed, scope, biasApplied };
    }
  } catch (err) {
    // Learned routing is an optimisation. Anything that goes wrong here means the run
    // proceeds on the role's order (or the operator's configured order when no role was
    // declared) — which is what it would have done if the feature had never been on.
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
