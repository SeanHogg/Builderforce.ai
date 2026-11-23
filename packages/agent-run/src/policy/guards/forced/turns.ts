/**
 * policy/guards/forced — the turns a progress rule decides. A change request MAKES PROGRESS, whatever phase it is in:
 *
 *   • ANALYSIS ENDS. When the run has spent its analysis budget (`handOffDue`) the next turn is the hand-off: the hand-off
 *     tool alone with a call required. If even that turn does not hand off, planning ends anyway and the coding role takes
 *     the turns that follow.
 *   • CODING CHANGES SOMETHING. When a coding run has spent the same budget without changing anything or handing it off
 *     (`changeDue`), the next turn offers the change tools alone (plus the question tool) with a call required. Once per run.
 *   • A run circling its own read cache (`CacheServedStreak`) is forced the way the budgets force theirs.
 *
 * Only a run asked to CHANGE something is budgeted: a question answered after thirty reads is an answer. The decisions are
 * pure over the policy state and the surface's facts; every row they leave goes through `note`.
 */

import type { ToolSchema } from "@builderforce/agent-tools";
import { PLAN_TURN_BUDGET, QUICK_CHANGE_TURN_BUDGET, changeDue, handOffDue, offersHandOff, reduceRunPolicy, type RunPolicyEvent } from "@builderforce/run-policy";
import type { PolicyContext } from "../../hooks.js";
import type { CacheServedStreak } from "../../tools/cacheServedStreak.js";
import { changeBrief, circlingReason, changeDueBrief, handOffBrief, handOffDueBrief } from "./briefs.js";
import type { ForcedTurn, ProgressBinding, ProgressTurnOptions } from "./types.js";

/** A row a rule leaves on the run's timeline. */
export type Note = (tool: string, detail: Record<string, unknown>, result: string) => void;

/** How {@link forcedProgressTurn} forces. Absent ⇒ its usual menu. */
export interface ForcedProgressOptions {
  /** Force the change tools only — never the hand-off, even while planning. */
  changeOnly?: boolean;
  /** Leave the question tool off the menu (and out of the brief): the guard's own forced turn never offers a question. */
  noAsk?: boolean;
  /** Where planning ends on this turn, record it (`loop.plan_budget_spent`, with this reason) instead of only moving the policy. */
  endsPlanning?: { step: number; why: string };
}

/** What the rules read: the context, the surface's binding and its vocabulary, and where rows go. */
export interface TurnEnv {
  ctx: PolicyContext;
  bind: ProgressBinding;
  opts: ProgressTurnOptions;
  note: Note;
}

function report(env: TurnEnv, event: RunPolicyEvent): void {
  env.ctx.state.model = reduceRunPolicy(env.ctx.state.model, event);
}

function specOf(env: TurnEnv, name: string): ToolSchema | undefined {
  return env.ctx.tools.find((t) => t.function.name === name);
}

/** Is this run asked to CHANGE something. */
export const budgeted = (env: TurnEnv): boolean => env.bind.facts.budgeted();

/** The ask tool's name when this turn may offer it, else null. */
const askToolIf = (env: TurnEnv, allowed: boolean): string | null => (allowed ? env.opts.askTool : null);

/** Planning ends HERE: the policy moves to the coding role (the next turn selects as `code`), and the run's record says why. */
export function endPlanning(env: TurnEnv, step: number, why: string): void {
  report(env, { type: "plan_budget_spent" });
  env.note("loop.plan_budget_spent", { step, planTurns: env.ctx.state.model.planTurns }, why);
}

/** The menu of a forced change turn: the change tools this turn would offer, plus the question tool where it is advertised. Null when it offers no change tool to force. */
export function changeToolsOf(env: TurnEnv, selected: readonly ToolSchema[], canAsk: boolean): ToolSchema[] | null {
  const change = new Set(env.ctx.policy.codeChangeTools ?? []);
  const tools = selected.filter((t) => change.has(t.function.name) || (canAsk && t.function.name === env.opts.askTool));
  return tools.some((t) => change.has(t.function.name)) ? tools : null;
}

/**
 * The analysis budget's turn, called BEFORE the turn's tools are selected so a planning run that ends here selects as a
 * coding run. Null for an ordinary turn — and, once the forced turn has come and gone without a hand-off (or the hand-off
 * cannot be offered here), null after ending planning.
 */
export function planBudgetTurn(env: TurnEnv, step: number): ForcedTurn | null {
  const model = env.ctx.state.model;
  if (!handOffDue(model) || !budgeted(env)) return null;
  const handOff = specOf(env, env.opts.handOffTool);
  const canAsk = env.bind.facts.canAskUser();
  if (model.handOffForced || !canAsk || !handOff) {
    endPlanning(env, step, canAsk
      ? "The forced hand-off turn did not hand off — analysis ends here and the coding role takes the next turn."
      : "Analysis budget spent where hand_off cannot be offered — analysis ends here and the coding role takes the next turn.");
    return null;
  }
  report(env, { type: "hand_off_forced" });
  env.note("loop.hand_off_due", { step, planTurns: model.planTurns }, `${model.planTurns} analysis turn(s) with no change and no hand-off — this turn offers hand_off alone and requires the call.`);
  return { tools: [handOff], toolChoice: "required", brief: handOffDueBrief(env.opts.handOffTool) };
}

/**
 * The forced turn a progress rule decides once it has fired — the circling breaker and A3's escalation: while planning, the
 * hand-off alone (when it can be offered and has not been forced yet); otherwise the change tools alone, which ends a planning
 * run that could not hand off. Reports the policy event. Null when this turn offers no change tool to force — and when the
 * run has ALREADY changed code: forcing the change tools on a run whose edits are in makes it invent one (VS Code chat #146477),
 * so the caller shows its note instead.
 */
export function forcedProgressTurn(
  env: TurnEnv,
  selected: readonly ToolSchema[],
  reason: string,
  opts: ForcedProgressOptions = {},
): { turn: ForcedTurn; forced: "hand_off" | "change" } | null {
  const model = env.ctx.state.model;
  const handOff = specOf(env, env.opts.handOffTool);
  if (!opts.changeOnly && handOff && offersHandOff(model) && env.bind.facts.canAskUser() && !model.handOffForced) {
    report(env, { type: "hand_off_forced" });
    return { forced: "hand_off", turn: { tools: [handOff], toolChoice: "required", brief: handOffBrief(reason, env.opts.handOffTool) } };
  }
  // The run already changed code itself: never force another change. (A hand-off alone is not a change made HERE — that run
  // is still forced, so `progressed` is not the test.)
  if (env.bind.facts.codeChanged()) return null;
  // No change tool on this turn's menu: nothing to force yet.
  const canAsk = env.bind.facts.canAskUser() && !opts.noAsk;
  const tools = changeToolsOf(env, selected.filter((t) => t.function.name !== env.opts.handOffTool), canAsk);
  if (!tools) return null;
  // Planning whose forced hand-off already came and went ends here, as the budget's does.
  if (offersHandOff(model)) {
    if (opts.endsPlanning) endPlanning(env, opts.endsPlanning.step, opts.endsPlanning.why);
    else report(env, { type: "plan_budget_spent" });
  }
  report(env, { type: "change_forced" });
  return { forced: "change", turn: { tools, toolChoice: "required", brief: changeBrief(reason, askToolIf(env, canAsk)) } };
}

/**
 * The coding budget's turn, called AFTER selection with the tools this turn would offer: the change tools among them (and the
 * question tool) become the whole menu. Null when the run has changed code or handed it off, when it is not due, or when this
 * turn offers no change tool to force.
 */
export function changeBudgetTurn(env: TurnEnv, step: number, selected: readonly ToolSchema[]): ForcedTurn | null {
  // A QUICK pass is one small change with nothing to plan: its budget is a quick pass's.
  const budget = env.ctx.policy.skipVerifyStage ? QUICK_CHANGE_TURN_BUDGET : PLAN_TURN_BUDGET;
  const model = env.ctx.state.model;
  if (!changeDue(model, env.bind.facts.progressed(), budget) || !budgeted(env)) return null;
  const canAsk = env.bind.facts.canAskUser();
  const tools = changeToolsOf(env, selected, canAsk);
  if (!tools) return null;
  report(env, { type: "change_forced" });
  env.note("loop.change_due", { step, codeTurns: model.codeTurns }, `${model.codeTurns} coding turn(s) with no change and no hand-off — this turn offers the change tools alone and requires a call.`);
  return { tools, toolChoice: "required", brief: changeDueBrief(model.codeTurns, askToolIf(env, canAsk)) };
}

/**
 * The no-progress breaker's turn: a run whose calls keep being answered from its OWN read cache is circling. Past the streak's
 * thresholds, the next turn of a change request that has NOT yet made its change is forced the way the budgets force theirs.
 * Never while verifying — a review re-reads the author's files by design.
 */
export function noProgressTurn(env: TurnEnv, step: number, selected: readonly ToolSchema[], cache: CacheServedStreak): ForcedTurn | null {
  if (!budgeted(env) || env.bind.facts.progressed() || env.ctx.state.model.phase === "verify" || !cache.due()) return null;
  const n = cache.count;
  // No change tool on this turn's menu: the streak waits for one.
  const out = forcedProgressTurn(env, selected, circlingReason(n));
  if (!out) return null;
  cache.consume();
  env.note("loop.no_progress", { step, streak: n, forced: out.forced }, `${n} consecutive call(s) answered from the read cache — this turn offers ${out.forced === "hand_off" ? "hand_off alone" : "the change tools alone"} and requires a call.`);
  return out.turn;
}
