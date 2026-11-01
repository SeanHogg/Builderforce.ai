/**
 * The agent's say over a Brain turn's menu (`PlatformTools.turn`, PRD 35 §4 WS4 "the forced menu"): the plan budget's hand-off
 * turn, the change budget, a run circling its read cache and A3's escalation or pause decide a turn that offers a narrower
 * set of tools with a call required and a brief on the request's volatile tail. The decisions are the Brain's own
 * (`runStore/turnMenu.ts`, `progressBudget.ts`, `progressGuard.ts`) - this only asks them and answers in the agent's shape.
 */

import type { TurnEnv, TurnMenu } from '@builderforce/agent-run';
import type { ToolSchema } from '@builderforce/agent-tools';
import type { BrainToolSpec } from '../streamChatCompletion';
import { DEFAULT_TOOL_LIMIT } from '../selectTools';
import { routerToolSpecs } from '../toolRouter';
import { nowIso, pushTrace } from '../runStore/runCells';
import { userTextOf } from '../runStore/convoText';
import { planBudgetTurn } from '../runStore/progressBudget';
import type { RunLoopContext } from '../runStore/runLoopContext';
import { forcedTurnFor } from '../runStore/turnMenu';

export async function loopTurnMenu(run: RunLoopContext, env: TurnEnv, catalogSize: number): Promise<TurnMenu | void> {
  // Analysis that has spent its budget ends HERE, BEFORE selection: the hand-off turn offers `hand_off` alone with a call required.
  const handOffTurn = planBudgetTurn(run, env.step);
  const selected = (await env.select()) as unknown as BrainToolSpec[];
  const forced = forcedTurnFor(run, env.step, selected, handOffTurn);
  // A3's steer (or an escalation it could not force here) opens the turn.
  const steer = run.progress.steerNote();
  const tail = [...(forced ? [userTextOf(forced.brief)] : []), ...(steer ? [steer] : [])];
  if (forced) return { tools: forced.tools as unknown as ToolSchema[], toolChoice: forced.toolChoice, tail };
  // The ROUTER rides along whenever selection trimmed something, so the tools that missed the cut stay REACHABLE. A catalog at or under
  // the limit is never trimmed (`selectToolsForTurn`): `hand_off` leaving the menu is not a trim.
  if (catalogSize > DEFAULT_TOOL_LIMIT) {
    pushTrace(run.c, {
      ts: nowIso(),
      category: 'message',
      label: 'tools.selected',
      args: { step: env.step },
      result: `${selected.length} of ${catalogSize} tools advertised this turn (relevance-selected; ${run.usedTools.size} pinned from earlier calls)`,
    });
    return { tools: [...(selected as unknown as ToolSchema[]), ...(routerToolSpecs(catalogSize) as unknown as ToolSchema[])], ...(tail.length > 0 ? { tail } : {}) };
  }
  return tail.length > 0 ? { tail } : undefined;
}
