/**
 * The agent's say over a Brain turn's menu (`PlatformTools.turn`, PRD 35 §4 WS4 "the forced menu"): the plan budget's hand-off
 * turn, the change budget, a run circling its read cache and A3's escalation or pause decide a turn that offers a narrower
 * set of tools with a call required and a brief on the request's volatile tail. The decisions are the Brain's own
 * (`runStore/progressBudget.ts`, `cacheServedStreak.ts`, `progressGuard.ts`) - this only asks them and answers in the agent's shape.
 */

import { offersHandOff } from '@builderforce/run-policy';
import { roleToolLimit, type TurnEnv, type TurnMenu } from '@builderforce/agent-run';
import type { ToolSchema } from '@builderforce/agent-tools';
import type { BrainToolSpec } from '../streamChatCompletion';
import { HAND_OFF_TOOL } from '../planHandoff';
import { routerToolSpecs } from '../toolRouter';
import { nowIso, pushTrace } from '../runStore/runCells';
import { userTextOf } from '../runStore/convoText';
import { changeBudgetTurn, planBudgetTurn, type ForcedTurn } from '../runStore/progressBudget';
import { noProgressTurn } from '../runStore/cacheServedStreak';
import { progressGuardTurn } from '../runStore/progressGuard';
import type { BrainRunContext } from '../runStore/brainRunContext';

/**
 * The turn a progress rule decides, or null: the plan budget's hand-off turn (decided BEFORE selection, so a forced turn that did
 * not hand off already selects as code), else the change budget, else a run circling its read cache, else A3's escalation or pause.
 */
function forcedTurnFor(run: BrainRunContext, step: number, selected: BrainToolSpec[], handOffTurn: ForcedTurn | null): ForcedTurn | null {
  return handOffTurn ?? changeBudgetTurn(run, step, selected) ?? noProgressTurn(run, step, selected) ?? progressGuardTurn(run, step, selected);
}

export async function brainTurnMenu(run: BrainRunContext, env: TurnEnv, catalogSize: number): Promise<TurnMenu | void> {
  // Analysis that has spent its budget ends HERE, BEFORE selection: the hand-off turn offers `hand_off` alone with a call required.
  const handOffTurn = planBudgetTurn(run, env.step);
  // Once the run is coding, the plan is handed off: `hand_off` is gone from the menu, so a coder can never re-plan the work it was just given.
  const ranked = (await env.select()) as unknown as BrainToolSpec[];
  const selected = offersHandOff(run.policy) ? ranked : ranked.filter((t) => t.function.name !== HAND_OFF_TOOL);
  const forced = forcedTurnFor(run, env.step, selected, handOffTurn);
  // A3's steer (or an escalation it could not force here) opens the turn.
  const steer = run.progress.steerNote();
  const tail = [...(forced ? [userTextOf(forced.brief)] : []), ...(steer ? [steer] : [])];
  if (forced) return { tools: forced.tools as unknown as ToolSchema[], toolChoice: forced.toolChoice, tail };
  // The ROUTER rides along whenever selection trimmed something, so the tools that missed the cut stay REACHABLE. A catalog at or under
  // the limit is never trimmed (the agent's `selectToolsForTurn`): `hand_off` leaving the menu is not a trim. The limit is the turn's role's
  // (a code or verify turn is capped far below the wide default), so the router rides every turn the cap trimmed.
  if (catalogSize > roleToolLimit(run.policy.phase)) {
    pushTrace(run.c, {
      ts: nowIso(),
      category: 'message',
      label: 'tools.selected',
      args: { step: env.step },
      result: `${selected.length} of ${catalogSize} tools advertised this turn (relevance-selected; ${run.usedTools.size} pinned from earlier calls)`,
    });
    return { tools: [...(selected as unknown as ToolSchema[]), ...(routerToolSpecs(catalogSize) as unknown as ToolSchema[])], ...(tail.length > 0 ? { tail } : {}) };
  }
  return { tools: selected as unknown as ToolSchema[], ...(tail.length > 0 ? { tail } : {}) };
}
