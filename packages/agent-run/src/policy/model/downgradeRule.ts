/**
 * policy/model/downgradeRule - the ONE rule that says whether a turn answered by another model than the run expected is worth a
 * `llm.model_downgrade` step, and which of three kinds it is. Pure.
 *
 *   - FAILOVER: the run ASKED for a model (a pin, a lock, a phase default) and another answered. Said every turn it happens.
 *   - BYO: the run asked for nothing (auto-routed) and a connected account could not be used, so routing landed elsewhere.
 *     Said once per served model.
 *   - PLAN TIER: the run asked for nothing, no code has changed yet (the plan phase), and routing landed on a Flash-class
 *     (non-agentic tier) model with no BYO signal at all. Said once per served model. An unpriced model is unknown, not weak.
 *
 * What differs between the two homes is the INPUT each supplies, never the rule: the agent (`preflight.ts` `modelDowngrade`) reads the
 * BYO signal from its preflight's verdict and "said already" from `RunState`; the Brain (`brain-embedded` `modelDowngrade.ts`) reads
 * the BYO signal from each turn's gateway header and "said already" from its own trace. Each keeps its own wording and its own record.
 *
 * Also the Flash-class rule itself ({@link planModelWarning}), which the preflight shares.
 *
 * No `node:*` imports, no DOM: this file is compiled into the Worker, the browser and Node.
 */

import { isAgenticTier, listPriceOf, resolveModelTier, snapshotPriceBook, type ModelTier, type PriceBook } from "@builderforce/model-catalog";

/** A model whose catalog tier is Flash-class (not an agentic tier). */
export interface PlanModelWarning {
  model: string;
  tier: ModelTier;
}

/**
 * Would the run's PLAN phase land on a Flash-class model? Only answerable for a model the
 * run names; an unpriced model (a local one) is unknown, not weak.
 */
export function planModelWarning(model: string | undefined, book: PriceBook = snapshotPriceBook()): PlanModelWarning | null {
  if (!model || model === "default") return null;
  const price = listPriceOf(book, model);
  const tier = price ? resolveModelTier({ price }) : undefined;
  return tier && isAgenticTier(tier) === false ? { model, tier } : null;
}

/** What one turn's answering model is judged on. */
export interface DowngradeInput {
  /** The model the turn ASKED for, or undefined when it asked for nothing (auto-routed: absent, or the gateway's `default`). */
  asked: string | undefined;
  /** The model that answered. */
  served: string | undefined;
  /** The BYO signal this home sees for the turn: the unresolved accounts, or "" when there are none. */
  byo: string;
  /** True while the run has changed no code - the turns that plan the change. */
  planPhase: boolean;
  /** True when this served model has already been announced for an auto-routed turn in this run. */
  seen: boolean;
  /** The price book the tier is read from - the release's bundled one when absent. */
  book?: PriceBook;
}

/** Which kind of downgrade a turn is. */
export type DowngradeKind = { kind: "failover" } | { kind: "byo" } | { kind: "plan_tier"; tier: ModelTier };

/** The kind of downgrade this turn is, or null when it is not one (or was already announced). */
export function downgradeDecision(input: DowngradeInput): DowngradeKind | null {
  const { asked, served } = input;
  if (!served || served === "default") return null;
  if (asked !== undefined) return served === asked ? null : { kind: "failover" };
  const byo = input.byo.trim();
  const flash = !byo && input.planPhase ? planModelWarning(served, input.book) : null;
  if (!byo && !flash) return null;
  if (input.seen) return null;
  return byo ? { kind: "byo" } : { kind: "plan_tier", tier: flash!.tier };
}
