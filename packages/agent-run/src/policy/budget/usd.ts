/**
 * policy/budget/usd - the run's USD cap (`RunPolicy.budgets.usd`).
 *
 * Ports `brain-embedded/src/runStore/runSpendBudget.ts`: two moments over ONE running total. After each turn the turn's
 * price accrues; before the next the run is held to the cap with the SAME rule the cloud cost loop uses
 * (`@builderforce/spend-contract` `runBudget.ts`): at 80% the model is told once to converge, and at the cap the run
 * stops with a contained answer - a reply that says what it spent and why it stopped, never an error.
 *
 * The total is the meter's. A surface that shares one meter across a run tree (a sub-agent accrues into its owner's) holds the
 * whole tree to one cap; a run on its own keeps a meter of its own. What a turn is worth is the TRANSPORT's to say
 * (`ModelUsage.pricedMc`, from the surface's own price book): a turn with no price is counted as unpriced, never as free,
 * so the total is a floor and every sentence about it says so.
 *
 * No cap (absent, 0, or not a positive number) means no budget at all, so an uncapped run is exactly the run it was.
 * Never branches on `RunPolicy.entryPoint`. No `node:*` imports, no DOM.
 */

import { MILLICENTS_PER_USD, runBudgetBreach, runBudgetWarnDue, type RunBudgetCaps } from "@builderforce/spend-contract";
import type { ModelUsage, SpendMeter } from "../../contract.js";

const usd = (millicents: number): string => `$${(millicents / MILLICENTS_PER_USD).toFixed(2)}`;

/** The cap in millicents, or null when the run is uncapped. */
export function runBudgetCapMillicents(maxRunBudgetUsd: number | undefined): number | null {
  return typeof maxRunBudgetUsd === "number" && Number.isFinite(maxRunBudgetUsd) && maxRunBudgetUsd > 0
    ? Math.round(maxRunBudgetUsd * MILLICENTS_PER_USD)
    : null;
}

/** What a tree with unpriced calls adds to every spend sentence - null when every call was priced. */
function noPriceNote(unpricedCalls: number): string | null {
  return unpricedCalls > 0 ? `${unpricedCalls} ${unpricedCalls === 1 ? "call" : "calls"} had no known price` : null;
}

/** What the model reads once the run has used 80% of its budget. */
export function budgetWarning(spentMc: number, capMc: number, unpricedCalls = 0): string {
  const note = noPriceNote(unpricedCalls);
  const spent = note ? `at least ${usd(spentMc)} (${note})` : usd(spentMc);
  return `[Run budget] This run has spent ${spent} of its ${usd(capMc)} budget — over 80%. Stop exploring and converge: `
    + "finish the essential change now, then answer with what you did and exactly what is left.";
}

/** The reply a run stopped at its cap settles with. */
export function budgetContainedReply(spentMc: number, capMc: number, unpricedCalls = 0): string {
  const note = noPriceNote(unpricedCalls);
  const spent = note ? `at least ${usd(spentMc)} spent — ${note}` : `${usd(spentMc)} spent`;
  return `Run stopped: it reached its ${usd(capMc)} spend budget (${spent}). `
    + "Nothing was rolled back — the changes made so far are in place. Ask to continue to resume from here, "
    + 'or raise the "builderforce.maxRunBudgetUsd" setting (0 turns the cap off).';
}

/** A meter of one run's own: the default when a surface shares none. */
export function localSpendMeter(): SpendMeter {
  let spent = 0;
  let unpriced = 0;
  return {
    spentMc: () => spent,
    unpricedCalls: () => unpriced,
    add: (pricedMc) => {
      if (pricedMc === undefined) unpriced += 1;
      else spent += pricedMc;
    },
  };
}

/** What the budget decides before a turn. */
export type BudgetVerdict =
  | { kind: "contain"; text: string; spentMc: number; capMc: number; unpricedCalls: number }
  | { kind: "warn"; text: string; spentMc: number; capMc: number; unpricedCalls: number };

/** One run's hold on its cap. */
export interface UsdBudget {
  /** Judge the run before a turn: contained at the cap, warned once at 80%, otherwise nothing. */
  beforeTurn(): BudgetVerdict | undefined;
  /** One turn answered: accrue its price. Returns true the first time a turn had none (said once per run). */
  afterTurn(usage: ModelUsage | undefined): boolean;
}

/** The budget for a run, or undefined when it has no cap. A child is held to the tighter of its own cap and its owner's. */
export function usdBudget(usdCap: number | undefined, meter: SpendMeter): UsdBudget | undefined {
  const own = runBudgetCapMillicents(usdCap);
  if (own == null) return undefined;
  const inherited = meter.capMc?.();
  const capMc = inherited !== undefined ? Math.min(own, inherited) : own;
  const caps: RunBudgetCaps = { maxSpendMillicents: capMc };
  // Each run of the tree is told once - each is a model that must converge.
  let warned = false;
  let unpricedSaid = false;
  return {
    beforeTurn() {
      const spentMc = meter.spentMc();
      const unpricedCalls = meter.unpricedCalls();
      const usage = { spendMillicents: spentMc };
      if (runBudgetBreach(caps, usage)) return { kind: "contain", text: budgetContainedReply(spentMc, capMc, unpricedCalls), spentMc, capMc, unpricedCalls };
      if (!warned && runBudgetWarnDue(caps, usage)) {
        warned = true;
        return { kind: "warn", text: budgetWarning(spentMc, capMc, unpricedCalls), spentMc, capMc, unpricedCalls };
      }
      return undefined;
    },
    afterTurn(usage) {
      const priced = usage?.pricedMc;
      meter.add(priced);
      if (priced !== undefined || unpricedSaid) return false;
      unpricedSaid = true;
      return true;
    },
  };
}
