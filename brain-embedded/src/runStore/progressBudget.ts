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
import { asksForChange, isContinuationDirective } from '@builderforce/agent-stall';
import { PLAN_TURN_BUDGET, changeDue, handOffDue } from '@builderforce/run-policy';
import { isCodeChangeTool } from '../localWorkspaceTools';
import { HAND_OFF_TOOL, HAND_OFF_TOOL_SPEC } from '../planHandoff';
import type { BrainToolSpec, ChatCompletionMessage } from '../streamChatCompletion';
import { nowIso, pushTrace } from './runCells';
import { reportToPolicy, type RunLoopContext } from './runLoopContext';

const HAND_OFF_DUE_BRIEF =
  `ANALYSIS IS OVER. You have spent ${PLAN_TURN_BUDGET} turns analysing without changing anything. ` +
  'Call hand_off NOW. summary = the research for the coders: everything you and any research sub-agents established that the change needs ' +
  '(files, functions, what they do today, decisions, traps). tasks = each one standalone: the files, the change, and how to know it is done. ' +
  'The coding agents start from exactly what you write here; they do not see this conversation.';

const changeDueBrief = (turns: number): string =>
  `STOP READING. You have spent ${turns} coding turns without changing anything. ` +
  'Make the change now with what you already know — the edit tools are the only ones offered this turn. ' +
  'If something genuinely blocks the change, call ask_user and say exactly what.';

/** A turn a budget decides: the tools it offers, a call required, and the brief. */
export interface ForcedTurn {
  tools: BrainToolSpec[];
  toolChoice: 'required';
  brief: ChatCompletionMessage;
}

/** Is this run asked to CHANGE something — the only kind any progress rule forces. */
export function budgeted(run: RunLoopContext): boolean {
  return run.metadata.mode !== 'chat' && (asksForChange(run.userRequest) || isContinuationDirective(run.userRequest));
}

/**
 * The analysis budget's turn, called BEFORE the turn's tools are selected so a planning
 * run that ends here selects as a coding run (no `hand_off` on the menu). Null for an
 * ordinary turn — and, once the forced turn has come and gone without a hand-off (or
 * `hand_off` cannot be offered here), null after ending planning.
 */
export function planBudgetTurn(run: RunLoopContext, step: number): ForcedTurn | null {
  if (!handOffDue(run.policy) || !budgeted(run)) return null;
  if (run.policy.handOffForced || !run.canAskUser) {
    reportToPolicy(run, { type: 'plan_budget_spent' });
    pushTrace(run.c, {
      ts: nowIso(),
      category: 'message',
      label: 'loop.plan_budget_spent',
      args: { step, planTurns: run.policy.planTurns },
      result: run.canAskUser
        ? 'The forced hand-off turn did not hand off — analysis ends here and the coding role takes the next turn.'
        : 'Analysis budget spent where hand_off cannot be offered — analysis ends here and the coding role takes the next turn.',
    });
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
export function changeToolsOf(run: RunLoopContext, selected: readonly BrainToolSpec[]): BrainToolSpec[] | null {
  const tools = selected.filter((t) => isCodeChangeTool(t.function.name) || (run.canAskUser && t.function.name === ASK_USER_TOOL));
  return tools.some((t) => isCodeChangeTool(t.function.name)) ? tools : null;
}

/**
 * The coding budget's turn, called AFTER selection with the tools this turn would offer:
 * the change tools among them (and `ask_user`) become the whole menu. Null when the run
 * has changed code or handed it off, when it is not due, or when this turn offers no
 * change tool to force.
 */
export function changeBudgetTurn(run: RunLoopContext, step: number, selected: readonly BrainToolSpec[]): ForcedTurn | null {
  const progressed = run.c.codeChanged || run.usedTools.has(HAND_OFF_TOOL);
  if (!changeDue(run.policy, progressed) || !budgeted(run)) return null;
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
  return { tools, toolChoice: 'required', brief: { role: 'user', content: changeDueBrief(run.policy.codeTurns) } };
}
