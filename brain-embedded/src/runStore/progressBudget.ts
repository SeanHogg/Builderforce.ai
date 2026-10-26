/**
 * Analysis ENDS. When a change request has spent its analysis budget
 * (`handOffDue` in `@builderforce/run-policy`) the next turn is the hand-off: `hand_off`
 * is the only tool offered and a tool call is required, so the planner writes the
 * summary and the tasks the coders run from. If even that turn does not hand off,
 * planning ends anyway and the coding role takes the turns that follow.
 *
 * Before this, nothing ended analysis but the planner's own choice. Chat #6 spent 778
 * `plan` turns on MiniMax Flash: no edit, no `hand_off`, nothing filed for the agents.
 *
 * Only a run asked to CHANGE something is budgeted — a question answered after thirty
 * reads is an answer, and must not be turned into tickets.
 *
 * Called BEFORE the turn's tools are selected, so a planning run that ends here selects
 * as a coding run (no `hand_off` on the menu).
 */

import { asksForChange, isContinuationDirective } from '@builderforce/agent-stall';
import { PLAN_TURN_BUDGET, handOffDue } from '@builderforce/run-policy';
import { HAND_OFF_TOOL_SPEC } from '../planHandoff';
import type { BrainToolSpec, ChatCompletionMessage } from '../streamChatCompletion';
import { nowIso, pushTrace } from './runCells';
import { reportToPolicy, type RunLoopContext } from './runLoopContext';

const HAND_OFF_DUE_BRIEF =
  `ANALYSIS IS OVER. You have spent ${PLAN_TURN_BUDGET} turns analysing without changing anything. ` +
  'Call hand_off NOW. summary = the research for the coders: everything you and any research sub-agents established that the change needs ' +
  '(files, functions, what they do today, decisions, traps). tasks = each one standalone: the files, the change, and how to know it is done. ' +
  'The coding agents start from exactly what you write here; they do not see this conversation.';

/** The turn the budget decides: `hand_off` alone, a call required, and the brief. */
export interface PlanBudgetTurn {
  tools: BrainToolSpec[];
  toolChoice: 'required';
  brief: ChatCompletionMessage;
}

function budgeted(run: RunLoopContext): boolean {
  return run.metadata.mode !== 'chat' && (asksForChange(run.userRequest) || isContinuationDirective(run.userRequest));
}

/**
 * What this turn must be, given the analysis budget. Null for an ordinary turn — and,
 * once the forced turn has come and gone without a hand-off (or `hand_off` cannot be
 * offered here), null after ending planning: the policy is then `code`, and the chat
 * starts its next run there rather than buying a fresh budget.
 */
export function planBudgetTurn(run: RunLoopContext, step: number): PlanBudgetTurn | null {
  if (!handOffDue(run.policy) || !budgeted(run)) return null;
  if (run.policy.handOffForced || !run.canAskUser) {
    reportToPolicy(run, { type: 'plan_budget_spent' });
    run.c.codePhaseReached = true;
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
