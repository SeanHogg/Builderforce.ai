/**
 * A change request MAKES PROGRESS, whatever phase it is in — the same two rules for every
 * run, whatever the chat's history:
 *
 *   • ANALYSIS ENDS. When the run has spent its analysis budget (`handOffDue` in
 *     `@builderforce/run-policy`) the next turn is the hand-off: `hand_off` is the only
 *     tool offered and a call is required, so the planner writes the summary and the tasks
 *     the coders run from. If even that turn does not hand off, planning ends anyway and
 *     the coding role takes the turns that follow.
 *   • CODING CHANGES SOMETHING. When a coding run has spent the same budget without
 *     changing anything or handing it off (`changeDue`), the next turn offers the change
 *     tools alone (plus `ask_user`) with a call required: make the change, or say what
 *     blocks it. Once per run.
 *
 * Before these, nothing ended analysis but the planner's own choice (VS Code chat #6: 778
 * `plan` turns, no edit, nothing filed), and nothing bounded coding at all — a run that
 * started in `code`, or reached it, could read for its whole life (chat #5739).
 *
 * Only a run asked to CHANGE something is budgeted — a question answered after thirty
 * reads is an answer, and must not be turned into tickets or edits.
 */

import { ASK_USER_TOOL } from '@builderforce/agent-loop';
import { classifyRequest } from '@builderforce/agent-stall';
import { PLAN_TURN_BUDGET, QUICK_CHANGE_TURN_BUDGET, changeDue, handOffDue, offersHandOff } from '@builderforce/run-policy';
import { isCodeChangeTool } from '../localWorkspaceTools';
import { HAND_OFF_TOOL, HAND_OFF_TOOL_SPEC } from '../planHandoff';
import type { BrainToolSpec, ChatCompletionMessage } from '../streamChatCompletion';
import { nowIso, pushTrace } from './runCells';
import { reportToPolicy, type BrainRunContext } from './brainRunContext';


/** A forced hand-off's brief: why it is forced, then the one hand-off instruction. */
export function handOffBrief(reason: string): string {
  return `${reason} ` +
    'Call hand_off NOW. summary = the research for the coders: everything you and any research sub-agents established that the change needs ' +
    '(files, functions, what they do today, decisions, traps). tasks = each one standalone: the files, the change, and how to know it is done. ' +
    'The coding agents start from exactly what you write here; they do not see this conversation.';
}

/** A forced change's brief: why it is forced, then the one change instruction — naming
 *  `ask_user` only when this turn offers it. */
export function changeBrief(reason: string, canAskUser: boolean): string {
  return `${reason} ` +
    'Make the change now with what you already know — the edit tools are the only ones offered this turn.' +
    (canAskUser ? ' If something genuinely blocks the change, call ask_user and say exactly what.' : '');
}

const HAND_OFF_DUE_BRIEF = handOffBrief(`ANALYSIS IS OVER. You have spent ${PLAN_TURN_BUDGET} turns analysing without changing anything.`);

/** A turn a progress rule decides: the tools it offers, a call required, and the brief — or,
 *  for A3's `finish`, NO tools and no call required: the final report. */
export interface ForcedTurn {
  tools: BrainToolSpec[];
  toolChoice?: 'required';
  brief: ChatCompletionMessage;
  /** A finish / record turn: its brief is the whole say, so no steer note rides along. */
  finishing?: true;
}

/** Is `text`, in a run of `mode`, a request to CHANGE something — the only kind any
 *  progress rule forces, and the only kind the chat's asks ledger carries. The ONE
 *  classifier decides (`classifyRequest`): a question — even one whose paste is full
 *  of change verbs — is never budgeted, and a bare continuation resumes change work. */
export function isChangeRequest(mode: string | undefined, text: string): boolean {
  return mode !== 'chat' && classifyRequest(text).intent === 'change';
}

/** Is this run asked to CHANGE something (see {@link isChangeRequest}). */
export function budgeted(run: BrainRunContext): boolean {
  return isChangeRequest(run.metadata.mode, run.userRequest);
}

/**
 * Has the run made its change — edited code itself or handed it to coders? An INLINE hand-off started no coder: the run itself
 * takes every task, so it has made no progress until it edits (VS Code chat #165961: the coder after an inline hand-off read for
 * nine turns, was exempt from the change budget and the stalled-finish deferral, and finished with no edit).
 */
export function progressed(run: BrainRunContext): boolean {
  return run.c.codeChanged || (run.usedTools.has(HAND_OFF_TOOL) && run.handOffInline !== true);
}

/** Planning ends HERE: the policy moves to the coding role (the next turn selects as `code`), and the run's record says why. */
export function endPlanning(run: BrainRunContext, step: number, why: string): void {
  reportToPolicy(run, { type: 'plan_budget_spent' });
  pushTrace(run.c, { ts: nowIso(), category: 'message', label: 'loop.plan_budget_spent', args: { step, planTurns: run.policy.planTurns }, result: why });
}

/**
 * The analysis budget's turn, called BEFORE the turn's tools are selected so a planning
 * run that ends here selects as a coding run (no `hand_off` on the menu). Null for an
 * ordinary turn — and, once the forced turn has come and gone without a hand-off (or
 * `hand_off` cannot be offered here), null after ending planning.
 */
export function planBudgetTurn(run: BrainRunContext, step: number): ForcedTurn | null {
  if (!handOffDue(run.policy) || !budgeted(run)) return null;
  if (run.policy.handOffForced || !run.canAskUser) {
    endPlanning(run, step, run.canAskUser
      ? 'The forced hand-off turn did not hand off — analysis ends here and the coding role takes the next turn.'
      : 'Analysis budget spent where hand_off cannot be offered — analysis ends here and the coding role takes the next turn.');
    return null;
  }
  reportToPolicy(run, { type: 'hand_off_forced' });
  pushTrace(run.c, {
    ts: nowIso(),
    category: 'message',
    label: 'loop.hand_off_due',
    args: { step, planTurns: run.policy.planTurns },
    result: `${run.policy.planTurns} analysis turn(s) with no change and no hand-off — this turn offers hand_off alone and requires the call.`,
  });
  return { tools: [HAND_OFF_TOOL_SPEC], toolChoice: 'required', brief: { role: 'user', content: HAND_OFF_DUE_BRIEF } };
}

/** The menu of a forced change turn: the change tools this turn would offer, plus
 *  `ask_user` where it is advertised. Null when the turn offers no change tool to force. */
export function changeToolsOf(run: BrainRunContext, selected: readonly BrainToolSpec[], canAsk: boolean = run.canAskUser): BrainToolSpec[] | null {
  const tools = selected.filter((t) => isCodeChangeTool(t.function.name) || (canAsk && t.function.name === ASK_USER_TOOL));
  return tools.some((t) => isCodeChangeTool(t.function.name)) ? tools : null;
}

/**
 * The forced turn a progress rule decides once it has fired — the circling breaker
 * (`cacheServedStreak.ts`) and A3's escalation (`progressGuard.ts`): while planning,
 * `hand_off` alone (when it can be offered and has not been forced yet); otherwise the
 * change tools alone, which ends a planning run that could not hand off. Reports the
 * policy event. Null when this turn offers no change tool to force — and when the run has
 * ALREADY changed code (`codeChanged`): forcing the change tools on a run whose
 * edits are in makes it invent one (VS Code chat #146477 replaced "Create Your account"
 * with "REMOVED"), so the caller shows its note instead.
 */
export function forcedProgressTurn(
  run: BrainRunContext,
  selected: readonly BrainToolSpec[],
  reason: string,
  opts: ForcedProgressOptions = {},
): { turn: ForcedTurn; forced: 'hand_off' | 'change' } | null {
  if (!opts.changeOnly && offersHandOff(run.policy) && run.canAskUser && !run.policy.handOffForced) {
    reportToPolicy(run, { type: 'hand_off_forced' });
    return { forced: 'hand_off', turn: { tools: [HAND_OFF_TOOL_SPEC], toolChoice: 'required', brief: { role: 'user', content: handOffBrief(reason) } } };
  }
  // The run already changed code itself: never force another change. (A hand-off alone is not a change made HERE — that run
  // is still forced, so `progressed` is not the test.)
  if (run.c.codeChanged) return null;
  // No change tool on this turn's menu: nothing to force yet.
  const canAsk = run.canAskUser && !opts.noAsk;
  const tools = changeToolsOf(run, selected.filter((t) => t.function.name !== HAND_OFF_TOOL), canAsk);
  if (!tools) return null;
  // Planning whose forced hand-off already came and went ends here, as the budget's does.
  if (offersHandOff(run.policy)) {
    if (opts.endPlanning) endPlanning(run, opts.endPlanning.step, opts.endPlanning.why);
    else reportToPolicy(run, { type: 'plan_budget_spent' });
  }
  reportToPolicy(run, { type: 'change_forced' });
  return { forced: 'change', turn: { tools, toolChoice: 'required', brief: { role: 'user', content: changeBrief(reason, canAsk) } } };
}

/** How {@link forcedProgressTurn} forces. Absent ⇒ its usual menu. */
export interface ForcedProgressOptions {
  /** Force the change tools only — never `hand_off`, even while planning. */
  changeOnly?: boolean;
  /** Leave `ask_user` off the menu (and out of the brief): the guard's own forced turn never offers a question. */
  noAsk?: boolean;
  /** Where planning ends on this turn, record it (`loop.plan_budget_spent`, with this reason) instead of only moving the policy. */
  endPlanning?: { step: number; why: string };
}

/**
 * The coding budget's turn, called AFTER selection with the tools this turn would offer:
 * the change tools among them (and `ask_user`) become the whole menu. Null when the run
 * has changed code or handed it off, when it is not due, or when this turn offers no
 * change tool to force.
 */
export function changeBudgetTurn(run: BrainRunContext, step: number, selected: readonly BrainToolSpec[]): ForcedTurn | null {
  // A QUICK pass is one small change with nothing to plan: its budget is a quick pass's.
  const budget = run.route.skipsVerify ? QUICK_CHANGE_TURN_BUDGET : PLAN_TURN_BUDGET;
  if (!changeDue(run.policy, progressed(run), budget) || !budgeted(run)) return null;
  const tools = changeToolsOf(run, selected);
  if (!tools) return null;
  reportToPolicy(run, { type: 'change_forced' });
  pushTrace(run.c, {
    ts: nowIso(),
    category: 'message',
    label: 'loop.change_due',
    args: { step, codeTurns: run.policy.codeTurns },
    result: `${run.policy.codeTurns} coding turn(s) with no change and no hand-off — this turn offers the change tools alone and requires a call.`,
  });
  return { tools, toolChoice: 'required', brief: { role: 'user', content: changeBrief(`STOP READING. You have spent ${run.policy.codeTurns} coding turns without changing anything.`, run.canAskUser) } };
}
