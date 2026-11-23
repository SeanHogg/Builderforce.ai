/**
 * The Brain's binding of the agent's A3 progress detector and forced-turn ladder (PRD 35 §4 WS4, `GuardPorts.progress`).
 *
 * The DETECTOR and the LADDER are the agent's (`@builderforce/agent-run` `policy/guards`): trips, the plan and change budgets, the
 * circling breaker, the forced finish with its record turns. What the Brain supplies is DATA and facts, nothing that decides: which of
 * its calls only read, which mutate unscoped, which tickets count as platform progress, its hand-off and question tools, how many
 * turns a finish may record for, and the facts a rule reads of the run (`runStore/changeRequest.ts`). Its trace rows are the rows the
 * agent reports (`GuardPorts.onEvent`): the detector's `loop.progress_check` / `loop.progress_advisory`, the ladder's
 * `loop.progress_forced`, `loop.hand_off_due`, `loop.change_due`, `loop.no_progress`, `loop.plan_budget_spent`.
 */

import { ASK_USER_TOOL } from '@builderforce/agent-loop';
import { asksForChange } from '@builderforce/agent-stall';
import type { GuardPorts } from '@builderforce/agent-run';
import { isMutatingPlatformTool } from '../chatWorkLinking';
import { HAND_OFF_TOOL } from '../planHandoff';
import { isUnscopedMutation } from '../readCoverage';
import { isReadOnlyShellCall } from '../readOnlyShell';
import { isRouterTool } from '../toolRouter';
import { isDedupableRead, type BrainRunContext } from '../runStore/brainRunContext';
import { budgeted, progressed } from '../runStore/changeRequest';
import { nowIso, pushTrace } from '../runStore/runCells';
import { FINISH_RECORD_TURNS } from '../runStore/progressFinishFacts';

/** A call that only reads: a deduplicable read, a read-only shell command, a router lookup. */
export function isReadOnlyCall(tool: string, args: unknown): boolean {
  return isDedupableRead(tool) || isReadOnlyShellCall(tool, args) || isRouterTool(tool);
}

/** The guards' ports for one Brain run: the detector's facts, the ladder's vocabulary and where its rows go. */
export function brainGuardPorts(run: BrainRunContext): GuardPorts {
  return {
    progress: {
      isReadOnly: isReadOnlyCall,
      isUnscopedMutation,
      isPlatformProgress: isMutatingPlatformTool,
      // Only a run asked for a CHANGE trips on a read-only streak — a review reads and answers.
      expectsChange: () => asksForChange(run.userRequest),
      // A child's report delivered to the inbox (not through `wait_agents`): its files and outcome reach the detector as data.
      childReports: () => run.childReports.splice(0),
      facts: {
        budgeted: () => budgeted(run),
        codeChanged: () => run.c.codeChanged,
        progressed: () => progressed(run),
        canAskUser: () => run.canAskUser,
        // The tools the work-linking directive declares as obligations: a finish may offer ONLY these (VS Code chat #157440).
        obligationTools: () => run.promptTools?.obligation ?? [],
      },
      turns: { handOffTool: HAND_OFF_TOOL, askTool: ASK_USER_TOOL, recordTurns: FINISH_RECORD_TURNS },
    },
    onEvent: (row, at) => {
      pushTrace(run.c, { ts: nowIso(), category: 'message', label: row.tool, args: { ...(at ? { step: at.step } : {}), ...row.detail }, result: row.result });
    },
  };
}
